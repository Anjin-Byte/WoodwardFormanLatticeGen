import type { BeamGraph, TriangleMesh, SkinGraph } from './pipeline-types.js';
import { BEAM_REMOVED } from './pipeline-types.js';
import { createTriangleMesh } from './triangle-mesh.js';

// ─── Types ──────────────────────────────────────────────────────────────────

type ManifoldModule = typeof import('manifold-3d');
type ManifoldClass = Awaited<ReturnType<ManifoldModule['default']>>['Manifold'];
type ManifoldInstance = InstanceType<ManifoldClass>;

let cachedModule: { Manifold: ManifoldClass } | null = null;

async function getManifold(wasmUrl?: string): Promise<{ Manifold: ManifoldClass }> {
  if (cachedModule) return cachedModule;
  const Module = (await import('manifold-3d')).default;
  const wasm = wasmUrl
    ? await Module({ locateFile: () => wasmUrl })
    : await Module();
  wasm.setup();
  cachedModule = { Manifold: wasm.Manifold };
  return cachedModule;
}

// ─── Beam → Manifold Cylinder ───────────────────────────────────────────────

function beamToCylinder(
  Manifold: ManifoldClass,
  p0x: number, p0y: number, p0z: number,
  p1x: number, p1y: number, p1z: number,
  radius: number,
  segments: number,
): ManifoldInstance | null {
  let dx = p1x - p0x;
  let dy = p1y - p0y;
  let dz = p1z - p0z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-12) return null;

  const cyl = Manifold.cylinder(len, radius, radius, segments, false);

  dx /= len; dy /= len; dz /= len;

  let ux: number, uy: number, uz: number;
  if (Math.abs(dz) < 0.999) {
    const cx = -dy, cy = dx;
    const cl = Math.sqrt(cx * cx + cy * cy);
    ux = cx / cl; uy = cy / cl; uz = 0;
  } else {
    const cy = -dz, cz = dy;
    const cl = Math.sqrt(cy * cy + cz * cz);
    ux = 0; uy = cy / cl; uz = cz / cl;
  }

  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;

  const m: [number, number, number, number,
            number, number, number, number,
            number, number, number, number] = [
    ux, vx, dx, p0x,
    uy, vy, dy, p0y,
    uz, vz, dz, p0z,
  ];

  return cyl.transform(m as unknown as import('manifold-3d').Mat4);
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface IntersectOptions {
  segments?: number;
  wasmUrl?: string;
  onProgress?: (phase: string, pct: number) => void;
}

export interface IntersectResult {
  mesh: TriangleMesh;
  timings: { tessMs: number; unionMs: number; intersectMs: number; totalMs: number };
}

/**
 * Create per-beam Manifold cylinders, boolean-union them into a single
 * manifold, then boolean-intersect with the domain mesh.
 *
 * This is the mathematically exact approach:
 *   1. Each beam → Manifold.cylinder() + transform (valid manifold)
 *   2. Manifold.union(allCylinders) (handles overlapping joints correctly)
 *   3. Manifold.intersection(lattice, domain) (exact boundary conformance)
 *
 * No classification, no trimming, no per-beam clipping, no leakage.
 */
export async function intersectLatticeWithDomain(
  graph: BeamGraph,
  skin: SkinGraph | null,
  domainMesh: TriangleMesh,
  options?: IntersectOptions,
): Promise<IntersectResult> {
  const t0 = performance.now();
  const segments = options?.segments ?? 8;
  const onProgress = options?.onProgress;

  // Phase 1: Init Manifold
  onProgress?.('init', 0);
  const { Manifold } = await getManifold(options?.wasmUrl);
  onProgress?.('init', 1);

  // Phase 2: Create per-beam Manifold cylinders
  onProgress?.('tessellate', 0);
  const tTess0 = performance.now();

  const manifolds: ManifoldInstance[] = [];

  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const r = graph.beamRadii[b];
    const cyl = beamToCylinder(
      Manifold,
      graph.positions[n0 * 3], graph.positions[n0 * 3 + 1], graph.positions[n0 * 3 + 2],
      graph.positions[n1 * 3], graph.positions[n1 * 3 + 1], graph.positions[n1 * 3 + 2],
      r, segments,
    );
    if (cyl) manifolds.push(cyl);
  }

  if (skin) {
    for (let s = 0; s < skin.beamCount; s++) {
      const n0 = skin.edges[s * 2];
      const n1 = skin.edges[s * 2 + 1];
      const r = skin.beamRadii[s];
      const cyl = beamToCylinder(
        Manifold,
        skin.positions[n0 * 3], skin.positions[n0 * 3 + 1], skin.positions[n0 * 3 + 2],
        skin.positions[n1 * 3], skin.positions[n1 * 3 + 1], skin.positions[n1 * 3 + 2],
        r, segments,
      );
      if (cyl) manifolds.push(cyl);
    }
  }

  const tessMs = performance.now() - tTess0;
  onProgress?.('tessellate', 1);

  if (manifolds.length === 0) {
    return {
      mesh: createTriangleMesh(new Float32Array(0), new Uint32Array(0)),
      timings: { tessMs, unionMs: 0, intersectMs: 0, totalMs: performance.now() - t0 },
    };
  }

  // Phase 3: Union all beam cylinders
  onProgress?.('union', 0);
  const tUnion0 = performance.now();
  const latticeManifold = Manifold.union(manifolds);
  const unionMs = performance.now() - tUnion0;
  onProgress?.('union', 1);

  // Phase 4: Intersect with domain
  onProgress?.('intersect', 0);
  const tIntersect0 = performance.now();

  const domainManifold = new Manifold({
    numProp: 3,
    vertProperties: new Float32Array(domainMesh.positions),
    triVerts: new Uint32Array(domainMesh.indices),
  } as any);

  const result = Manifold.intersection(latticeManifold, domainManifold);
  const resultMesh = result.getMesh();

  const intersectMs = performance.now() - tIntersect0;
  onProgress?.('intersect', 1);

  // Extract positions from interleaved vertProperties
  const stride = resultMesh.numProp;
  const numVerts = resultMesh.vertProperties.length / stride;
  const positions = new Float32Array(numVerts * 3);
  for (let v = 0; v < numVerts; v++) {
    positions[v * 3] = resultMesh.vertProperties[v * stride];
    positions[v * 3 + 1] = resultMesh.vertProperties[v * stride + 1];
    positions[v * 3 + 2] = resultMesh.vertProperties[v * stride + 2];
  }

  return {
    mesh: createTriangleMesh(positions, resultMesh.triVerts),
    timings: { tessMs, unionMs, intersectMs, totalMs: performance.now() - t0 },
  };
}

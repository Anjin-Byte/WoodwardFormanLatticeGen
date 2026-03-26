import type { BeamGraph, TrimResult, SkinGraph } from './pipeline-types.js';
import { BEAM_REMOVED } from './pipeline-types.js';
import { getEffectivePosition } from './render-data.js';
import { exportSTL } from './export-stl.js';
import type { ExportResult } from './export-pipeline.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CsgExportOptions {
  /** Number of sides per cylinder cross-section. Default 12. */
  segments?: number;
  /** URL to the manifold.wasm binary (e.g. from public/). Required in worker contexts. */
  wasmUrl?: string;
  /** Progress callback: phase name + fraction [0,1] */
  onProgress?: (phase: string, pct: number) => void;
}

// ─── Manifold Init ──────────────────────────────────────────────────────────

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

  // Manifold.cylinder creates a Z-aligned cylinder at the origin
  const cyl = Manifold.cylinder(len, radius, radius, segments, false);

  // Build rotation + translation matrix to place cylinder from p0→p1
  dx /= len; dy /= len; dz /= len;

  // Build orthonormal basis: Z-axis = beam direction
  let ux: number, uy: number, uz: number;
  if (Math.abs(dz) < 0.999) {
    // cross([0,0,1], d) → perpendicular
    const cx = -dy, cy = dx, cz = 0;
    const cl = Math.sqrt(cx * cx + cy * cy);
    ux = cx / cl; uy = cy / cl; uz = 0;
  } else {
    // Beam is nearly Z-aligned; use X-axis cross
    const cx = 0, cy = -dz, cz = dy;
    const cl = Math.sqrt(cy * cy + cz * cz);
    ux = 0; uy = cy / cl; uz = cz / cl;
  }

  // v = cross(d, u)
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;

  // Column-major 4x4: columns are u, v, d, translation(p0)
  // Manifold.transform takes row-major Mat4 (4x3 subset):
  // [[r00, r01, r02, tx], [r10, r11, r12, ty], [r20, r21, r22, tz]]
  // where columns of rotation map X→u, Y→v, Z→d
  const m: [number, number, number, number,
            number, number, number, number,
            number, number, number, number] = [
    ux, vx, dx, p0x,
    uy, vy, dy, p0y,
    uz, vz, dz, p0z,
  ];

  return cyl.transform(m as unknown as import('manifold-3d').Mat4);
}

// ─── Balanced Binary Union ──────────────────────────────────────────────────

function balancedUnion(
  Manifold: ManifoldClass,
  manifolds: ManifoldInstance[],
  onProgress?: (pct: number) => void,
): ManifoldInstance {
  // Use Manifold.union(array) for batch union — internally balanced
  onProgress?.(0);
  const result = Manifold.union(manifolds);
  onProgress?.(1);
  return result;
}

// ─── CSG Export Pipeline ────────────────────────────────────────────────────

export async function exportLatticeCsg(
  graph: BeamGraph,
  trim: TrimResult | null,
  skin: SkinGraph | null,
  absoluteRadius: number,
  options?: CsgExportOptions,
): Promise<ExportResult> {
  const t0 = performance.now();
  const segments = options?.segments ?? 12;
  const onProgress = options?.onProgress;

  // Phase 1: Initialize Manifold WASM
  onProgress?.('init', 0);
  const { Manifold } = await getManifold(options?.wasmUrl);
  onProgress?.('init', 1);
  const initMs = performance.now() - t0;

  // Phase 2: Create cylinder manifolds per beam
  onProgress?.('tessellate', 0);
  const tTess0 = performance.now();

  // Count non-removed beams for progress
  let totalBeams = 0;
  for (let b = 0; b < graph.beamCount; b++) {
    if (!(graph.beamFlags[b] & BEAM_REMOVED)) totalBeams++;
  }
  totalBeams += skin ? skin.beamCount : 0;
  const progressInterval = Math.max(1, Math.floor(totalBeams / 50));

  const manifolds: ManifoldInstance[] = [];
  let processed = 0;

  // Main graph beams
  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const p0 = getEffectivePosition(graph, trim, n0);
    const p1 = getEffectivePosition(graph, trim, n1);
    const r = graph.beamRadii[b];

    const cyl = beamToCylinder(Manifold, p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], r, segments);
    if (cyl) manifolds.push(cyl);

    processed++;
    if (processed % progressInterval === 0) {
      onProgress?.('tessellate', processed / totalBeams);
    }
  }

  // Skin beams
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

      processed++;
      if (processed % progressInterval === 0) {
        onProgress?.('tessellate', processed / totalBeams);
      }
    }
  }

  onProgress?.('tessellate', 1);
  const tessMs = performance.now() - tTess0;

  if (manifolds.length === 0) {
    onProgress?.('stl', 1);
    return {
      stl: new ArrayBuffer(84),
      triangleCount: 0,
      fileSizeBytes: 84,
      timings: { accelMs: initMs, sdfMs: tessMs, mcMs: 0, stlMs: 0, totalMs: performance.now() - t0 },
    };
  }

  // Phase 3: Boolean union
  onProgress?.('union', 0);
  const tUnion0 = performance.now();
  const merged = balancedUnion(Manifold, manifolds, (pct) => onProgress?.('union', pct));
  const unionMs = performance.now() - tUnion0;

  // Phase 4: Extract mesh
  const mesh = merged.getMesh();
  const numVerts = mesh.numProp >= 3 ? mesh.vertProperties.length / mesh.numProp : 0;
  const triCount = mesh.triVerts.length / 3;

  // Extract position-only data from interleaved vertProperties
  const stride = mesh.numProp;
  const positions = new Float32Array(numVerts * 3);
  for (let v = 0; v < numVerts; v++) {
    positions[v * 3] = mesh.vertProperties[v * stride];
    positions[v * 3 + 1] = mesh.vertProperties[v * stride + 1];
    positions[v * 3 + 2] = mesh.vertProperties[v * stride + 2];
  }

  // Phase 5: STL export
  onProgress?.('stl', 0);
  const tStl0 = performance.now();
  const stl = exportSTL(positions, mesh.triVerts, triCount);
  onProgress?.('stl', 1);
  const stlMs = performance.now() - tStl0;

  return {
    stl,
    triangleCount: triCount,
    fileSizeBytes: stl.byteLength,
    timings: {
      accelMs: initMs,
      sdfMs: tessMs,
      mcMs: unionMs,
      stlMs,
      totalMs: performance.now() - t0,
    },
  };
}

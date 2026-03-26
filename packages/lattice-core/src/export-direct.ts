import type { BeamGraph, TrimResult, SkinGraph } from './pipeline-types.js';
import { BEAM_REMOVED } from './pipeline-types.js';
import { getEffectivePosition } from './render-data.js';
import { exportSTL } from './export-stl.js';
import type { ExportResult } from './export-pipeline.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface DirectExportOptions {
  /** Number of sides per cylinder cross-section. Default 8. */
  segments?: number;
  /** Whether to generate end caps. Default true. */
  caps?: boolean;
  /** Progress callback: phase name + fraction [0,1] */
  onProgress?: (phase: string, pct: number) => void;
}

// ─── Cylinder Tessellation ──────────────────────────────────────────────────

/**
 * Tessellate a capped cylinder from p0 to p1 with given radius,
 * appending positions and indices to the output arrays.
 * Returns the number of triangles added.
 */
function tessellateCylinder(
  p0x: number, p0y: number, p0z: number,
  p1x: number, p1y: number, p1z: number,
  radius: number,
  segments: number,
  caps: boolean,
  positions: number[],
  indices: number[],
  baseVertex: number,
): number {
  // Axis direction
  let dx = p1x - p0x;
  let dy = p1y - p0y;
  let dz = p1z - p0z;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-12) return 0;
  dx /= len; dy /= len; dz /= len;

  // Build orthonormal basis (u, v) perpendicular to axis d
  let ux: number, uy: number, uz: number;
  if (Math.abs(dy) < 0.9) {
    // cross(d, [0,1,0])
    ux = dz; uy = 0; uz = -dx;
  } else {
    // cross(d, [1,0,0])
    ux = 0; uy = -dz; uz = dy;
  }
  const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= uLen; uy /= uLen; uz /= uLen;

  // v = cross(d, u)
  const vx = dy * uz - dz * uy;
  const vy = dz * ux - dx * uz;
  const vz = dx * uy - dy * ux;

  // Generate ring vertices at p0 and p1
  const angleStep = (2 * Math.PI) / segments;
  const v0Base = baseVertex;

  for (let ring = 0; ring < 2; ring++) {
    const cx = ring === 0 ? p0x : p1x;
    const cy = ring === 0 ? p0y : p1y;
    const cz = ring === 0 ? p0z : p1z;
    for (let s = 0; s < segments; s++) {
      const angle = s * angleStep;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      positions.push(
        cx + radius * (cos * ux + sin * vx),
        cy + radius * (cos * uy + sin * vy),
        cz + radius * (cos * uz + sin * vz),
      );
    }
  }

  let triCount = 0;

  // Barrel quads (2 triangles each)
  for (let s = 0; s < segments; s++) {
    const s1 = (s + 1) % segments;
    const a = v0Base + s;            // bottom ring
    const b = v0Base + s1;           // bottom ring next
    const c = v0Base + segments + s; // top ring
    const d = v0Base + segments + s1;// top ring next

    indices.push(a, c, b);
    indices.push(b, c, d);
    triCount += 2;
  }

  // Caps (triangle fans)
  if (caps) {
    // Bottom cap center
    const botCenter = v0Base + segments * 2;
    positions.push(p0x, p0y, p0z);
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      indices.push(botCenter, v0Base + s1, v0Base + s);
      triCount++;
    }

    // Top cap center
    const topCenter = botCenter + 1;
    positions.push(p1x, p1y, p1z);
    for (let s = 0; s < segments; s++) {
      const s1 = (s + 1) % segments;
      indices.push(topCenter, v0Base + segments + s, v0Base + segments + s1);
      triCount++;
    }
  }

  return triCount;
}

// ─── Direct Export Pipeline ─────────────────────────────────────────────────

/**
 * Export lattice as direct cylinder meshes (no boolean merge).
 * Each beam becomes a tessellated capped cylinder. Fast but joints
 * are not blended — cylinders overlap at nodes.
 */
export function exportLatticeDirect(
  graph: BeamGraph,
  trim: TrimResult | null,
  skin: SkinGraph | null,
  absoluteRadius: number,
  options?: DirectExportOptions,
): ExportResult {
  const t0 = performance.now();
  const segments = options?.segments ?? 8;
  const caps = options?.caps ?? true;
  const onProgress = options?.onProgress;

  // Count non-removed beams
  let beamCount = 0;
  for (let b = 0; b < graph.beamCount; b++) {
    if (!(graph.beamFlags[b] & BEAM_REMOVED)) beamCount++;
  }
  const skinCount = skin ? skin.beamCount : 0;
  const totalBeams = beamCount + skinCount;

  // Estimate sizes: per cylinder = segments*2 verts (+2 for caps), segments*2 + segments*2 tris
  const vertsPerBeam = segments * 2 + (caps ? 2 : 0);
  const trisPerBeam = segments * 2 + (caps ? segments * 2 : 0);
  const positions: number[] = [];
  const indices: number[] = [];

  // Reserve approximate capacity
  positions.length = 0;
  indices.length = 0;

  // Report progress ~50 times during tessellation
  const progressInterval = Math.max(1, Math.floor(totalBeams / 50));

  let totalTris = 0;
  let processedBeams = 0;

  onProgress?.('tessellate', 0);

  // Main graph beams
  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const p0 = getEffectivePosition(graph, trim, n0);
    const p1 = getEffectivePosition(graph, trim, n1);
    const r = graph.beamRadii[b];

    const baseVertex = positions.length / 3;
    totalTris += tessellateCylinder(
      p0[0], p0[1], p0[2],
      p1[0], p1[1], p1[2],
      r, segments, caps,
      positions, indices, baseVertex,
    );
    processedBeams++;
    if (processedBeams % progressInterval === 0) {
      onProgress?.('tessellate', processedBeams / totalBeams);
    }
  }

  // Skin beams
  if (skin) {
    for (let s = 0; s < skin.beamCount; s++) {
      const n0 = skin.edges[s * 2];
      const n1 = skin.edges[s * 2 + 1];
      const r = skin.beamRadii[s];

      const baseVertex = positions.length / 3;
      totalTris += tessellateCylinder(
        skin.positions[n0 * 3], skin.positions[n0 * 3 + 1], skin.positions[n0 * 3 + 2],
        skin.positions[n1 * 3], skin.positions[n1 * 3 + 1], skin.positions[n1 * 3 + 2],
        r, segments, caps,
        positions, indices, baseVertex,
      );
      processedBeams++;
      if (processedBeams % progressInterval === 0) {
        onProgress?.('tessellate', processedBeams / totalBeams);
      }
    }
  }

  onProgress?.('tessellate', 1);
  const tessMs = performance.now() - t0;

  // Convert to typed arrays
  const tStl0 = performance.now();
  onProgress?.('stl', 0);
  const posArr = new Float32Array(positions);
  const idxArr = new Uint32Array(indices);
  const stl = exportSTL(posArr, idxArr, totalTris);
  onProgress?.('stl', 1);
  const stlMs = performance.now() - tStl0;

  return {
    stl,
    triangleCount: totalTris,
    fileSizeBytes: stl.byteLength,
    timings: {
      accelMs: 0,
      sdfMs: tessMs,
      mcMs: 0,
      stlMs,
      totalMs: performance.now() - t0,
    },
  };
}

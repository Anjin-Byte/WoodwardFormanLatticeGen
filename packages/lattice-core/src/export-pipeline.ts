import type { BeamGraph, TrimResult, SkinGraph } from './pipeline-types.js';
import { gridMin, gridMax } from './grid.js';
import { buildSdfAccel, latticeSdf } from './sdf.js';
import { marchingCubes } from './marching-cubes.js';
import { exportSTL } from './export-stl.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ExportOptions {
  /**
   * Samples per lattice cell edge. Higher = finer mesh.
   * The actual MC step is derived as cellSize / mcDensity.
   * Must be high enough that mcStep ≤ radius to resolve strut geometry.
   * Default: auto-computed from r* to guarantee ≥ 3 samples across strut diameter.
   */
  mcDensity?: number;
  /**
   * Smooth-min fillet radius as a multiple of absoluteRadius.
   * 0 = sharp joints, 0.5 = subtle, 1.0 = smooth organic.
   * Default: 0.5
   */
  filletK?: number;
  /** Progress callback: phase name + fraction [0,1] */
  onProgress?: (phase: string, pct: number) => void;
}

export interface ExportResult {
  stl: ArrayBuffer;
  triangleCount: number;
  fileSizeBytes: number;
  timings: {
    accelMs: number;
    sdfMs: number;
    mcMs: number;
    stlMs: number;
    totalMs: number;
  };
}

// ─── Export Pipeline ────────────────────────────────────────────────────────

/**
 * Full export pipeline: SDF evaluation → Marching Cubes → STL binary.
 * Async to yield to event loop during SDF eval (the bottleneck).
 */
export async function exportLattice(
  graph: BeamGraph,
  trim: TrimResult | null,
  skin: SkinGraph | null,
  absoluteRadius: number,
  options?: ExportOptions,
): Promise<ExportResult> {
  const t0 = performance.now();
  const grid = graph.grid;
  const cs = grid.cellSize[0];
  const rStar = absoluteRadius / cs;

  // Auto density: guarantee ≥ 3 samples across the strut diameter (2 * radius).
  // mcStep = cs / density, need mcStep ≤ 2*radius / 3 → density ≥ cs / (2*radius/3) = 3/(2*r*)
  const autoDensity = Math.max(4, Math.ceil(3 / (2 * rStar)));
  const density = options?.mcDensity ?? autoDensity;
  const mcStep = cs / density;

  const filletK = options?.filletK ?? 0.5;
  const sminK = filletK * absoluteRadius;
  const onProgress = options?.onProgress;

  // ── 1. Compute MC grid bounds ──────────────────────────────────────────
  const gMin = gridMin(grid);
  const gMax = gridMax(grid);
  const margin = absoluteRadius + sminK + mcStep;

  const mcOrigin: [number, number, number] = [
    gMin[0] - margin,
    gMin[1] - margin,
    gMin[2] - margin,
  ];
  const mcMax: [number, number, number] = [
    gMax[0] + margin,
    gMax[1] + margin,
    gMax[2] + margin,
  ];

  const dims: [number, number, number] = [
    Math.max(2, Math.ceil((mcMax[0] - mcOrigin[0]) / mcStep) + 1),
    Math.max(2, Math.ceil((mcMax[1] - mcOrigin[1]) / mcStep) + 1),
    Math.max(2, Math.ceil((mcMax[2] - mcOrigin[2]) / mcStep) + 1),
  ];

  // ── 2. Build spatial acceleration ──────────────────────────────────────
  onProgress?.('accel', 0);
  const tAccel0 = performance.now();
  const accel = buildSdfAccel(graph, trim, skin, { sminK });
  const accelMs = performance.now() - tAccel0;
  onProgress?.('accel', 1);

  // ── 3. Evaluate SDF on MC grid ─────────────────────────────────────────
  const tSdf0 = performance.now();
  const [nx, ny, nz] = dims;
  const sdfValues = new Float32Array(nx * ny * nz);

  for (let z = 0; z < nz; z++) {
    const pz = mcOrigin[2] + z * mcStep;
    for (let y = 0; y < ny; y++) {
      const py = mcOrigin[1] + y * mcStep;
      for (let x = 0; x < nx; x++) {
        const px = mcOrigin[0] + x * mcStep;
        sdfValues[x + nx * (y + ny * z)] = latticeSdf(px, py, pz, accel, sminK);
      }
    }
    // Yield to event loop every z-slice
    if (z % 4 === 0) {
      onProgress?.('sdf', z / nz);
      await new Promise<void>(r => setTimeout(r, 0));
    }
  }
  onProgress?.('sdf', 1);
  const sdfMs = performance.now() - tSdf0;

  // ── 4. Marching cubes ──────────────────────────────────────────────────
  const tMc0 = performance.now();
  onProgress?.('mc', 0);
  const mc = marchingCubes(sdfValues, mcOrigin, dims, mcStep);
  onProgress?.('mc', 1);
  const mcMs = performance.now() - tMc0;

  // ── 5. Export STL ──────────────────────────────────────────────────────
  const tStl0 = performance.now();
  onProgress?.('stl', 0);
  const stl = exportSTL(mc.positions, mc.indices, mc.triangleCount);
  onProgress?.('stl', 1);
  const stlMs = performance.now() - tStl0;

  return {
    stl,
    triangleCount: mc.triangleCount,
    fileSizeBytes: stl.byteLength,
    timings: {
      accelMs,
      sdfMs,
      mcMs,
      stlMs,
      totalMs: performance.now() - t0,
    },
  };
}

import type { BeamGraph, TrimResult, SkinGraph } from './pipeline-types.js';
import type { ExportOptions, ExportResult } from './export-pipeline.js';
import { gridMin, gridMax } from './grid.js';
import { buildSdfAccel, buildSdfAccelCsr } from './sdf.js';
import { exportSTL } from './export-stl.js';
import { exportLattice } from './export-pipeline.js';

// ─── GPU Handle Interface ───────────────────────────────────────────────────

/** Handle to a GPU SDF exporter (provided by the WASM layer). */
export interface GpuSdfExporterHandle {
  export(
    beam_p0: Float32Array, beam_p1: Float32Array, beam_r: Float32Array,
    cell_offsets: Uint32Array, beam_indices: Uint32Array,
    hash_table_size: number,
    accel_cell_size: number, accel_origin_x: number, accel_origin_y: number, accel_origin_z: number,
    origin_x: number, origin_y: number, origin_z: number,
    dims_x: number, dims_y: number, dims_z: number,
    step: number, smin_k: number,
  ): Promise<Float32Array>;
}

export interface GpuExportOptions extends ExportOptions {
  /** GPU exporter handle. When null/undefined, falls back to JS pipeline. */
  gpuExporter?: GpuSdfExporterHandle | null;
}

// ─── GPU Export Pipeline ────────────────────────────────────────────────────

/**
 * GPU-accelerated lattice export: SDF eval + marching cubes on the GPU,
 * STL serialization on CPU. Falls back to the JS path when no gpuExporter
 * is provided or if the GPU dispatch fails at runtime.
 */
export async function exportLatticeGpu(
  graph: BeamGraph,
  trim: TrimResult | null,
  skin: SkinGraph | null,
  absoluteRadius: number,
  options?: GpuExportOptions,
): Promise<ExportResult> {
  const exporter = options?.gpuExporter ?? null;
  if (!exporter) {
    return exportLattice(graph, trim, skin, absoluteRadius, options);
  }

  const t0 = performance.now();
  const onProgress = options?.onProgress;

  // Same parameter computation as export-pipeline.ts
  const grid = graph.grid;
  const cs = grid.cellSize[0];
  const rStar = absoluteRadius / cs;
  const autoDensity = Math.max(4, Math.ceil(3 / (2 * rStar)));
  const density = options?.mcDensity ?? autoDensity;
  const mcStep = cs / density;
  const filletK = options?.filletK ?? 0.5;
  const sminK = filletK * absoluteRadius;

  const gMin = gridMin(grid);
  const gMax = gridMax(grid);
  const margin = absoluteRadius + sminK + mcStep;

  const mcOrigin: [number, number, number] = [
    gMin[0] - margin, gMin[1] - margin, gMin[2] - margin,
  ];
  const mcMax: [number, number, number] = [
    gMax[0] + margin, gMax[1] + margin, gMax[2] + margin,
  ];
  const dims: [number, number, number] = [
    Math.max(2, Math.ceil((mcMax[0] - mcOrigin[0]) / mcStep) + 1),
    Math.max(2, Math.ceil((mcMax[1] - mcOrigin[1]) / mcStep) + 1),
    Math.max(2, Math.ceil((mcMax[2] - mcOrigin[2]) / mcStep) + 1),
  ];

  // Flatten beams + build CSR spatial hash for GPU upload
  onProgress?.('accel', 0);
  const tAccel0 = performance.now();
  const accel = buildSdfAccel(graph, trim, skin, { sminK });
  const csr = buildSdfAccelCsr(accel);
  const accelMs = performance.now() - tAccel0;
  onProgress?.('accel', 1);

  // GPU SDF eval + marching cubes (no intermediate progress — single dispatch)
  onProgress?.('gpu', 0);
  const tGpu0 = performance.now();
  let positions: Float32Array;
  try {
    positions = await exporter.export(
      accel.beamP0, accel.beamP1, accel.beamR,
      csr.cellOffsets, csr.beamIndices,
      csr.tableSize,
      accel.cellSize, accel.originX, accel.originY, accel.originZ,
      mcOrigin[0], mcOrigin[1], mcOrigin[2],
      dims[0], dims[1], dims[2],
      mcStep, sminK,
    );
  } catch {
    return exportLattice(graph, trim, skin, absoluteRadius, options);
  }
  const gpuMs = performance.now() - tGpu0;
  onProgress?.('gpu', 1);

  const triangleCount = positions.length / 9;
  const vertexCount = triangleCount * 3;

  // Build trivial indices (non-welded: 0,1,2,3,4,5,...)
  const indices = new Uint32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) indices[i] = i;

  // STL export (CPU)
  const tStl0 = performance.now();
  onProgress?.('stl', 0);
  const stl = exportSTL(positions, indices, triangleCount);
  onProgress?.('stl', 1);
  const stlMs = performance.now() - tStl0;

  return {
    stl,
    triangleCount,
    fileSizeBytes: stl.byteLength,
    timings: {
      accelMs,
      sdfMs: gpuMs,
      mcMs: 0,
      stlMs,
      totalMs: performance.now() - t0,
    },
  };
}

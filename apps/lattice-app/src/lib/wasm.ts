// WASM module loader with GPU voxelizer support.
// Tier 1: GPU voxelizer (WebGPU compute shader via wgpu)
// Tier 2: CPU SAT voxelizer (WASM, single-threaded)
// Tier 3: JS fallback (BVH raycasting, handled by caller)

import type { WasmGpuVoxelizer, WasmGpuSdfExporter } from 'lattice-wasm';
import type { GpuSdfExporterHandle } from '@lattice/core';

let wasmReady = false;
let gpuReady = false;
let sdfExporterReady = false;
let wasmModule: typeof import('lattice-wasm') | null = null;
let gpuVoxelizer: WasmGpuVoxelizer | null = null;
let sdfExporter: WasmGpuSdfExporter | null = null;
let initPromise: Promise<void> | null = null;

export async function initWasm(): Promise<void> {
  if (wasmReady) return;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      const wasm = await import('lattice-wasm');
      await wasm.default();
      wasmModule = wasm;
      wasmReady = true;
      console.log('[wasm] CPU SAT voxelizer ready');

      // Try GPU initialization (non-blocking — GPU failure doesn't affect CPU path)
      try {
        gpuVoxelizer = await wasm.gpu_voxelizer_new();
        gpuReady = true;
        console.log('[wasm] GPU voxelizer ready (WebGPU)');
      } catch (e) {
        console.warn('[wasm] GPU voxelizer unavailable, using CPU SAT:', e);
        gpuReady = false;
      }

      // Try GPU SDF exporter (non-blocking)
      try {
        sdfExporter = await wasm.gpu_sdf_exporter_new();
        sdfExporterReady = true;
        console.log('[wasm] GPU SDF exporter ready (WebGPU)');
      } catch (e) {
        console.warn('[wasm] GPU SDF exporter unavailable, using JS pipeline:', e);
        sdfExporterReady = false;
      }
    } catch (e) {
      console.warn('[wasm] WASM initialization failed, using JS fallback:', e);
      wasmReady = false;
    }
  })();

  return initPromise;
}

export function isWasmReady(): boolean {
  return wasmReady;
}

export function isGpuReady(): boolean {
  return gpuReady;
}

/** CPU SAT voxelizer (synchronous, WASM). */
export function voxelizeMesh(
  positions: Float32Array,
  indices: Uint32Array,
  originX: number,
  originY: number,
  originZ: number,
  voxelSize: number,
  nx: number,
  ny: number,
  nz: number,
): Uint32Array | null {
  if (!wasmReady || !wasmModule) return null;
  return wasmModule.voxelize_mesh(positions, indices, originX, originY, originZ, voxelSize, nx, ny, nz);
}

/** GPU voxelizer (async, WebGPU compute shader). Returns null if GPU unavailable. */
export async function voxelizeMeshGpu(
  positions: Float32Array,
  indices: Uint32Array,
  originX: number,
  originY: number,
  originZ: number,
  voxelSize: number,
  nx: number,
  ny: number,
  nz: number,
): Promise<Uint32Array | null> {
  if (!gpuReady || !gpuVoxelizer) return null;
  try {
    return await gpuVoxelizer.voxelize(positions, indices, originX, originY, originZ, voxelSize, nx, ny, nz);
  } catch (e) {
    console.warn('[wasm] GPU voxelize failed, falling back to CPU:', e);
    return null;
  }
}

export function getVoxelizerTier(): 'gpu' | 'cpu-wasm' | 'js' {
  if (gpuReady) return 'gpu';
  if (wasmReady) return 'cpu-wasm';
  return 'js';
}

/** Returns the GPU SDF exporter handle, or null if unavailable. */
export function getSdfExporter(): GpuSdfExporterHandle | null {
  return sdfExporter as GpuSdfExporterHandle | null;
}

export function getSdfExporterTier(): 'gpu' | 'js' {
  return sdfExporterReady ? 'gpu' : 'js';
}

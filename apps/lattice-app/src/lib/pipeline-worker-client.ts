// Main-thread client for the pipeline Web Worker.
// Follows the same pattern as export-worker-client.ts.

import type {
  BeamGraph, TrimResult, SkinGraph, LatticeGrid,
  BeamRenderData, TriangleMesh, ClippedBeamResult,
} from '@lattice/core';
import type { PipelineStage } from '$lib/stores/lattice.svelte';

// ─── Serialized types (must match pipeline.worker.ts) ──────────────────────

interface SerializedTrimResult {
  trimKeys: number[];
  trimValues: number[];
  removedBeams: number[];
}

interface SerializedClippedBeam {
  beamIndex: number;
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

// ─── Deserialization ────────────────────────────────────────────────────────

function deserializeTrim(s: SerializedTrimResult): TrimResult {
  const trimmedPositions = new Map<number, [number, number, number]>();
  for (let i = 0; i < s.trimKeys.length; i++) {
    trimmedPositions.set(s.trimKeys[i], [
      s.trimValues[i * 3],
      s.trimValues[i * 3 + 1],
      s.trimValues[i * 3 + 2],
    ]);
  }
  return {
    trimmedPositions,
    removedBeams: new Set(s.removedBeams),
  };
}

function deserializeClipped(items: SerializedClippedBeam[]): ClippedBeamResult[] {
  return items.map(s => ({
    beamIndex: s.beamIndex,
    mesh: {
      positions: s.positions,
      indices: s.indices,
      vertexCount: s.vertexCount,
      triangleCount: s.triangleCount,
    },
  }));
}

// ─── Singleton Worker ───────────────────────────────────────────────────────

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('./pipeline.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return worker;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export interface PipelineWorkerOptions {
  unitCellId: string;
  rStar: number;
  cellWidth: number;
  padding: number;
  manualNx: number;
  manualNy: number;
  manualNz: number;
  domainEnabled: boolean;
  domainSource: 'generated' | 'file';
  domainShape: 'box' | 'sphere' | 'cylinder';
  domainRadius: number;
  domainLength: number;
  domainSize: number;
  meshFileBuffer: ArrayBuffer | null;
  meshFileName: string;
  meshNativeExtent: number;
  clippingMode: 'approximate' | 'exact';
  skinEnabled: boolean;
  renderCylinderSegments: number;
  wasmUrl: string;
  onProgress?: (phase: string, pct: number) => void;
}

export interface PipelineStats {
  stages: PipelineStage[];
  nodeCount: number;
  beamCount: number;
  visibleBeamCount: number;
  removedBeamCount: number;
  skinBeamCount: number;
  cellsTotal: number;
  cellsInterior: number;
  cellsBoundary: number;
  cellsExterior: number;
  pipelineTimeMs: number;
  voxelizerTier: string;
  classificationMethod: string;
}

export interface PipelineWorkerResult {
  renderData: BeamRenderData;
  stats: PipelineStats;
  domainMesh: TriangleMesh | null;
  clippedBeams: ClippedBeamResult[];
  intersectedMesh: TriangleMesh | null;
  graph: BeamGraph;
  trim: TrimResult | null;
  skin: SkinGraph | null;
  grid: LatticeGrid;
}

export function runPipelineInWorker(
  options: PipelineWorkerOptions,
  signal?: AbortSignal,
): Promise<PipelineWorkerResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();

    const cleanup = () => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errHandler);
      signal?.removeEventListener('abort', onAbort);
    };

    const onAbort = () => {
      cleanup();
      w.terminate();
      worker = null;
      reject(new DOMException('Pipeline aborted', 'AbortError'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        options.onProgress?.(msg.phase, msg.pct);
      } else if (msg.type === 'result') {
        cleanup();
        resolve({
          renderData: msg.renderData,
          stats: msg.stats,
          domainMesh: msg.domainMesh,
          clippedBeams: deserializeClipped(msg.clippedBeams),
          intersectedMesh: msg.intersectedMesh,
          graph: msg.graph,
          trim: msg.trim ? deserializeTrim(msg.trim) : null,
          skin: msg.skin,
          grid: msg.grid,
        });
      } else if (msg.type === 'error') {
        cleanup();
        reject(new Error(msg.message));
      }
    };

    const errHandler = (e: ErrorEvent) => {
      cleanup();
      reject(new Error(e.message || 'Pipeline worker error'));
    };

    w.addEventListener('message', handler);
    w.addEventListener('error', errHandler);

    // Send pipeline request — all values are primitives or ArrayBuffer
    const transfer: Transferable[] = [];
    let meshBuffer = options.meshFileBuffer;
    if (meshBuffer) {
      meshBuffer = meshBuffer.slice(0); // copy — main thread still needs original
      transfer.push(meshBuffer);
    }

    w.postMessage({
      type: 'pipeline',
      unitCellId: options.unitCellId,
      rStar: options.rStar,
      cellWidth: options.cellWidth,
      padding: options.padding,
      manualNx: options.manualNx,
      manualNy: options.manualNy,
      manualNz: options.manualNz,
      domainEnabled: options.domainEnabled,
      domainSource: options.domainSource,
      domainShape: options.domainShape,
      domainRadius: options.domainRadius,
      domainLength: options.domainLength,
      domainSize: options.domainSize,
      meshFileBuffer: meshBuffer,
      meshFileName: options.meshFileName,
      meshNativeExtent: options.meshNativeExtent,
      clippingMode: options.clippingMode,
      skinEnabled: options.skinEnabled,
      renderCylinderSegments: options.renderCylinderSegments,
      wasmUrl: options.wasmUrl,
    }, { transfer });
  });
}

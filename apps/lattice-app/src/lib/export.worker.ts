// Web Worker for lattice STL export.
// Runs SDF→MC (JS) and direct tessellation off the main thread.

import {
  exportLattice,
  exportLatticeDirect,
  exportLatticeCsg,
} from '@lattice/core';
import type {
  BeamGraph, TrimResult, SkinGraph,
  ExportResult,
} from '@lattice/core';

// ─── Message Types ──────────────────────────────────────────────────────────

/** Serializable TrimResult (Map/Set → flat arrays for structured clone). */
interface SerializedTrimResult {
  trimKeys: number[];
  trimValues: number[];   // flattened [x,y,z, x,y,z, ...]
  removedBeams: number[];
}

interface ExportRequest {
  type: 'export';
  mode: 'js' | 'direct' | 'csg';
  graph: BeamGraph;
  trim: SerializedTrimResult | null;
  skin: SkinGraph | null;
  absoluteRadius: number;
  mcDensity?: number;
  filletK?: number;
  segments?: number;
  wasmUrl?: string;
}

interface ProgressMessage {
  type: 'progress';
  phase: string;
  pct: number;
}

interface ResultMessage {
  type: 'result';
  stl: ArrayBuffer;
  triangleCount: number;
  fileSizeBytes: number;
  timings: ExportResult['timings'];
}

interface ErrorMessage {
  type: 'error';
  message: string;
}

// ─── TrimResult Reconstruction ──────────────────────────────────────────────

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

// ─── Worker Entry ───────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  const req = e.data;
  if (req.type !== 'export') return;

  const trim = req.trim ? deserializeTrim(req.trim) : null;

  const onProgress = (phase: string, pct: number) => {
    self.postMessage({ type: 'progress', phase, pct } satisfies ProgressMessage);
  };

  try {
    let result: ExportResult;

    if (req.mode === 'csg') {
      result = await exportLatticeCsg(
        req.graph, trim, req.skin, req.absoluteRadius,
        { segments: req.segments, wasmUrl: req.wasmUrl, onProgress },
      );
    } else if (req.mode === 'direct') {
      result = exportLatticeDirect(
        req.graph, trim, req.skin, req.absoluteRadius,
        { segments: req.segments, onProgress },
      );
    } else {
      result = await exportLattice(
        req.graph, trim, req.skin, req.absoluteRadius,
        {
          mcDensity: req.mcDensity,
          filletK: req.filletK,
          onProgress,
        },
      );
    }

    const msg: ResultMessage = {
      type: 'result',
      stl: result.stl,
      triangleCount: result.triangleCount,
      fileSizeBytes: result.fileSizeBytes,
      timings: result.timings,
    };

    // Transfer the ArrayBuffer (zero-copy)
    self.postMessage(msg, { transfer: [result.stl] });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies ErrorMessage);
  }
};

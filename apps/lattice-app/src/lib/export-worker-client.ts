// Main-thread client for the export Web Worker.
// Handles serialization of Map/Set types and stripping Svelte $state proxies.

import type {
  BeamGraph, TrimResult, SkinGraph, LatticeGrid,
  ExportResult,
} from '@lattice/core';

// ─── Serialization ──────────────────────────────────────────────────────────
// Svelte 5 $state wraps objects in Proxies that can't be structured-cloned.
// We extract raw typed arrays and primitives into plain objects.

interface SerializedTrimResult {
  trimKeys: number[];
  trimValues: number[];
  removedBeams: number[];
}

function serializeTrim(trim: TrimResult): SerializedTrimResult {
  const trimKeys: number[] = [];
  const trimValues: number[] = [];
  for (const [k, v] of trim.trimmedPositions) {
    trimKeys.push(k);
    trimValues.push(v[0], v[1], v[2]);
  }
  return {
    trimKeys,
    trimValues,
    removedBeams: Array.from(trim.removedBeams),
  };
}

function serializeGrid(g: LatticeGrid): LatticeGrid {
  return {
    nx: g.nx, ny: g.ny, nz: g.nz,
    cellSize: [g.cellSize[0], g.cellSize[1], g.cellSize[2]],
    origin: [g.origin[0], g.origin[1], g.origin[2]],
  };
}

function serializeGraph(g: BeamGraph): BeamGraph {
  return {
    positions: g.positions,
    edges: g.edges,
    nodeCount: g.nodeCount,
    beamCount: g.beamCount,
    nodeFlags: g.nodeFlags,
    beamFlags: g.beamFlags,
    beamRadii: g.beamRadii,
    nodeBeamPtr: g.nodeBeamPtr,
    nodeBeams: g.nodeBeams,
    grid: serializeGrid(g.grid),
    edgesPerCell: g.edgesPerCell,
  };
}

function serializeSkin(s: SkinGraph): SkinGraph {
  return {
    positions: s.positions,
    edges: s.edges,
    nodeCount: s.nodeCount,
    beamCount: s.beamCount,
    beamRadii: s.beamRadii,
  };
}

// ─── Worker Client ──────────────────────────────────────────────────────────

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL('./export.worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return worker;
}

export interface WorkerExportOptions {
  mode: 'js' | 'direct' | 'csg';
  graph: BeamGraph;
  trim: TrimResult | null;
  skin: SkinGraph | null;
  absoluteRadius: number;
  mcDensity?: number;
  filletK?: number;
  segments?: number;
  wasmUrl?: string;
  onProgress?: (phase: string, pct: number) => void;
}

export function runExportInWorker(options: WorkerExportOptions): Promise<ExportResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();

    const handler = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === 'progress') {
        options.onProgress?.(msg.phase, msg.pct);
      } else if (msg.type === 'result') {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errHandler);
        resolve({
          stl: msg.stl,
          triangleCount: msg.triangleCount,
          fileSizeBytes: msg.fileSizeBytes,
          timings: msg.timings,
        });
      } else if (msg.type === 'error') {
        w.removeEventListener('message', handler);
        w.removeEventListener('error', errHandler);
        reject(new Error(msg.message));
      }
    };

    const errHandler = (e: ErrorEvent) => {
      w.removeEventListener('message', handler);
      w.removeEventListener('error', errHandler);
      reject(new Error(e.message || 'Worker error'));
    };

    w.addEventListener('message', handler);
    w.addEventListener('error', errHandler);

    // Strip Svelte $state proxies by extracting raw fields
    w.postMessage({
      type: 'export',
      mode: options.mode,
      graph: serializeGraph(options.graph),
      trim: options.trim ? serializeTrim(options.trim) : null,
      skin: options.skin ? serializeSkin(options.skin) : null,
      absoluteRadius: options.absoluteRadius,
      mcDensity: options.mcDensity,
      filletK: options.filletK,
      segments: options.segments,
      wasmUrl: options.wasmUrl,
    });
  });
}

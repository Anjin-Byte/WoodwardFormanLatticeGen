import {
  createUnitCell, createGrid, populate, buildBeamGraph, buildRenderData,
  totalCells,
  createBoxDomain, createSphereDomain, createMeshDomain,
  tessellateBox, tessellateSphere,
  classifyCells, applyClassification, trimBeams,
  generateSkin,
  computeLatticeProperties,
  occupancyToClassification,
  clipBoundaryBeams, buildDomainIndex,
  parseSTL, parseOBJ,
  UNIT_CELL_IDS, CellClass,
} from '@lattice/core';
import type {
  BeamRenderData, LatticeProperties, TriangleMesh, ClippedBeamResult,
  CellClassification, TrimResult, SkinGraph, Domain, LatticeGrid,
} from '@lattice/core';
import { initWasm, isWasmReady, voxelizeMesh, voxelizeMeshGpu, getVoxelizerTier, isGpuReady, getSdfExporter, getSdfExporterTier } from '$lib/wasm';

initWasm();

// ─── Parameters ─────────────────────────────────────────────────────────────

let unitCellId    = $state<string>('cubic');
let rStar         = $state(0.08);
let resolution    = $state(8);
let padding       = $state(1);
let manualNx      = $state(4);
let manualNy      = $state(4);
let manualNz      = $state(4);
let manualCellSize = $state(1.0);
let domainEnabled  = $state(false);
let domainShape    = $state<'box' | 'sphere'>('sphere');
let domainRadius   = $state(1.5);
let domainSource   = $state<'generated' | 'file'>('generated');
let meshFileBuffer = $state<ArrayBuffer | null>(null);
let meshFileName   = $state('');
let meshInfo       = $state<{ vertices: number; triangles: number } | null>(null);
let skinEnabled    = $state(false);

// ─── Render layers ──────────────────────────────────────────────────────────

let showBeams        = $state(true);
let showSkin         = $state(true);
let showDomainMesh   = $state(true);
let showGridBounds   = $state(false);
let showAxes         = $state(true);
let domainDisplayMode = $state<'solid' | 'wireframe' | 'transparent'>('transparent');
let voxelizerTierOverride = $state<'auto' | 'gpu' | 'cpu-wasm' | 'js'>('auto');

// ─── Pipeline types ─────────────────────────────────────────────────────────

export interface PipelineStage {
  name: string;
  method: string;
  timeMs: number;
  output: string;
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

interface PipelineResult {
  renderData: BeamRenderData;
  stats: PipelineStats;
  domainMesh: TriangleMesh | null;
  clippedBeams: ClippedBeamResult[];
  graph: import('@lattice/core').BeamGraph;
  trim: import('@lattice/core').TrimResult | null;
  skin: import('@lattice/core').SkinGraph | null;
}

// ─── Grid computation ───────────────────────────────────────────────────────

function getDomainAABB(): { min: [number, number, number]; max: [number, number, number] } | null {
  if (!domainEnabled) return null;
  if (domainSource === 'file' && meshFileBuffer) {
    try {
      const mesh = meshFileName.toLowerCase().endsWith('.obj')
        ? parseOBJ(new TextDecoder().decode(meshFileBuffer))
        : parseSTL(meshFileBuffer);
      return { min: mesh.aabbMin, max: mesh.aabbMax };
    } catch { return null; }
  }
  const r = domainRadius;
  return { min: [-r, -r, -r], max: [r, r, r] };
}

function computeGridFromDomain(): LatticeGrid | null {
  const aabb = getDomainAABB();
  if (!aabb) return null;
  const rangeX = aabb.max[0] - aabb.min[0];
  const rangeY = aabb.max[1] - aabb.min[1];
  const rangeZ = aabb.max[2] - aabb.min[2];
  const maxRange = Math.max(rangeX, rangeY, rangeZ);
  if (maxRange <= 0) return null;
  const cs = maxRange / resolution;
  const nx = Math.max(1, Math.ceil(rangeX / cs) + padding * 2);
  const ny = Math.max(1, Math.ceil(rangeY / cs) + padding * 2);
  const nz = Math.max(1, Math.ceil(rangeZ / cs) + padding * 2);
  const cx = (aabb.min[0] + aabb.max[0]) / 2;
  const cy = (aabb.min[1] + aabb.max[1]) / 2;
  const cz = (aabb.min[2] + aabb.max[2]) / 2;
  return createGrid(nx, ny, nz, [cs, cs, cs], [cx - nx * cs / 2, cy - ny * cs / 2, cz - nz * cs / 2]);
}

let activeGrid = $derived.by<LatticeGrid>(() => {
  if (domainEnabled) {
    const g = computeGridFromDomain();
    if (g) return g;
  }
  return createGrid(manualNx, manualNy, manualNz, [manualCellSize, manualCellSize, manualCellSize]);
});

let latticeProps = $derived.by<LatticeProperties | null>(() => {
  const cell = createUnitCell(unitCellId);
  if (!cell) return null;
  return computeLatticeProperties(cell, activeGrid, rStar * activeGrid.cellSize[0]);
});

// ─── Pipeline ───────────────────────────────────────────────────────────────

let pipelineOutput = $state<PipelineResult | null>(null);
let pipelineGen = 0;

function resolveClassifyTier(): 'gpu' | 'cpu-wasm' | 'js' {
  if (voxelizerTierOverride === 'gpu') return isGpuReady() ? 'gpu' : 'js';
  if (voxelizerTierOverride === 'cpu-wasm') return isWasmReady() ? 'cpu-wasm' : 'js';
  if (voxelizerTierOverride === 'js') return 'js';
  // auto: prefer GPU > CPU-WASM > JS
  if (isGpuReady()) return 'gpu';
  if (isWasmReady()) return 'cpu-wasm';
  return 'js';
}

async function runPipeline(gen: number): Promise<void> {
  const t0 = performance.now();
  const stages: PipelineStage[] = [];
  const time = (name: string, method: string, fn: () => string) => {
    const s = performance.now();
    const out = fn();
    stages.push({ name, method, timeMs: performance.now() - s, output: out });
  };

  const cell = createUnitCell(unitCellId);
  if (!cell) { pipelineOutput = null; return; }

  const grid = activeGrid;
  const absoluteRadius = rStar * grid.cellSize[0];

  let pop: ReturnType<typeof populate>;
  time('Populate', `${cell.id}`, () => {
    pop = populate(cell, grid);
    return `${pop.nodeCount}n ${pop.beamCount}b`;
  });
  pop = pop!;

  let graph: ReturnType<typeof buildBeamGraph>;
  time('BeamGraph', 'csr', () => {
    graph = buildBeamGraph(pop, grid, absoluteRadius);
    return `r=${absoluteRadius.toFixed(4)}`;
  });
  graph = graph!;

  let classification: CellClassification | null = null;
  let trim: TrimResult | null = null;
  let skin: SkinGraph | null = null;
  let domainMesh: TriangleMesh | null = null;
  let domainObj: Domain | null = null;
  let classMethod = 'none';

  if (domainEnabled) {
    // Build domain
    if (domainSource === 'file' && meshFileBuffer) {
      time('Parse', meshFileName.toLowerCase().endsWith('.obj') ? 'obj' : 'stl', () => {
        try {
          domainMesh = meshFileName.toLowerCase().endsWith('.obj')
            ? parseOBJ(new TextDecoder().decode(meshFileBuffer!))
            : parseSTL(meshFileBuffer!);
          domainObj = createMeshDomain(domainMesh!);
          return `${domainMesh!.vertexCount}v ${domainMesh!.triangleCount}t`;
        } catch { return 'error'; }
      });
    } else {
      time('Domain', domainShape, () => {
        const o = grid.origin;
        const cx = o[0] + grid.nx * grid.cellSize[0] / 2;
        const cy = o[1] + grid.ny * grid.cellSize[1] / 2;
        const cz = o[2] + grid.nz * grid.cellSize[2] / 2;
        if (domainShape === 'sphere') {
          domainObj = createSphereDomain([cx, cy, cz], domainRadius);
          domainMesh = tessellateSphere([cx, cy, cz], domainRadius, 24, 48);
        } else {
          const r = domainRadius;
          domainObj = createBoxDomain([cx - r, cy - r, cz - r], [cx + r, cy + r, cz + r]);
          domainMesh = tessellateBox([cx - r, cy - r, cz - r], [cx + r, cy + r, cz + r]);
        }
        return `${domainMesh!.triangleCount}t`;
      });
    }

    // Classify + trim
    if (domainObj && domainMesh) {
      const tier = resolveClassifyTier();
      const dm: TriangleMesh = domainMesh;
      const dObj: Domain = domainObj;

      if (tier === 'gpu') {
        // Async GPU voxelization
        const tClassify = performance.now();
        console.log('[pipeline] Dispatching GPU voxelizer...');
        const occ = await voxelizeMeshGpu(
          dm.positions, dm.indices,
          grid.origin[0], grid.origin[1], grid.origin[2],
          grid.cellSize[0], grid.nx, grid.ny, grid.nz,
        );
        // Check if a newer pipeline run superseded this one
        if (gen !== pipelineGen) return;

        if (occ) {
          classification = occupancyToClassification(occ, grid);
          classMethod = 'gpu';
          console.log(`[pipeline] GPU voxelizer complete: ${(performance.now() - tClassify).toFixed(1)} ms`);
        } else {
          // GPU returned null (failed) — fall back to CPU-WASM or JS
          console.warn('[pipeline] GPU voxelizer returned null, falling back');
          if (isWasmReady()) {
            const occCpu = voxelizeMesh(
              dm.positions, dm.indices,
              grid.origin[0], grid.origin[1], grid.origin[2],
              grid.cellSize[0], grid.nx, grid.ny, grid.nz,
            );
            if (occCpu) { classification = occupancyToClassification(occCpu, grid); classMethod = 'cpu-wasm'; }
          }
          if (!classification) { classification = classifyCells(graph, dObj); classMethod = 'js-bvh'; }
        }
        stages.push({ name: 'Classify', method: classMethod, timeMs: performance.now() - tClassify, output: classMethod });
      } else {
        time('Classify', '', () => {
          if (tier === 'cpu-wasm') {
            const occ = voxelizeMesh(
              domainMesh!.positions, domainMesh!.indices,
              grid.origin[0], grid.origin[1], grid.origin[2],
              grid.cellSize[0], grid.nx, grid.ny, grid.nz,
            );
            if (occ) { classification = occupancyToClassification(occ, grid); classMethod = 'cpu-wasm'; }
          }
          if (!classification) { classification = classifyCells(graph, domainObj!); classMethod = 'js-bvh'; }
          stages[stages.length - 1].method = classMethod;
          return classMethod;
        });
      }

      time('Trim', 'intersect', () => {
        applyClassification(graph, classification!);
        trim = trimBeams(graph, domainObj!);
        let tc = 0, rc = 0;
        for (let b = 0; b < graph.beamCount; b++) {
          if (graph.beamFlags[b] & 0b00000100) tc++;
          if (graph.beamFlags[b] & 0b00010000) rc++;
        }
        return `${tc} trimmed ${rc} removed`;
      });

      if (skinEnabled) {
        time('Skin', 'face-stitch', () => {
          skin = generateSkin(graph, trim!, cell, classification!);
          return `${skin!.beamCount}b`;
        });
      }
    }
  }

  // Clip boundary beams
  let clippedBeams: ClippedBeamResult[] = [];
  if (domainObj && domainMesh && trim) {
    time('Clip', 'csg', () => {
      const idx = buildDomainIndex(domainMesh!, grid);
      clippedBeams = clipBoundaryBeams(graph, domainObj!, domainMesh!, idx, trim);
      return `${clippedBeams.length} clipped`;
    });
  }

  // Render data
  const skinCount = skin ? (skin as SkinGraph).beamCount : 0;
  let renderData: BeamRenderData;
  time('Render', 'instanced', () => {
    renderData = buildRenderData(graph, trim, skin as SkinGraph | null, clippedBeams.length > 0);
    return `${renderData!.count} instances`;
  });
  renderData = renderData!;

  // Cell breakdown
  let ci = 0, cb = 0, ce = 0;
  const tc = totalCells(grid);
  if (classification) {
    for (let c = 0; c < tc; c++) {
      if (classification[c] === CellClass.INTERIOR) ci++;
      else if (classification[c] === CellClass.BOUNDARY) cb++;
      else ce++;
    }
  } else { ci = tc; }

  // Final staleness check before committing
  if (gen !== pipelineGen) return;

  pipelineOutput = {
    renderData,
    stats: {
      stages,
      nodeCount: graph.nodeCount,
      beamCount: graph.beamCount,
      visibleBeamCount: renderData.count - skinCount,
      removedBeamCount: graph.beamCount - (renderData.count - skinCount),
      skinBeamCount: skinCount,
      cellsTotal: tc, cellsInterior: ci, cellsBoundary: cb, cellsExterior: ce,
      pipelineTimeMs: performance.now() - t0,
      voxelizerTier: getVoxelizerTier(),
      classificationMethod: classMethod,
    },
    domainMesh,
    clippedBeams,
    graph,
    trim,
    skin: skin as import('@lattice/core').SkinGraph | null,
  };
}

// Reactive effect: re-run pipeline when any dependency changes.
// Uses $effect.root() since this is a module-level store, not a component.
$effect.root(() => {
  $effect(() => {
    // Touch all reactive deps so Svelte tracks them
    const _deps = [
      unitCellId, rStar, activeGrid,
      domainEnabled, domainSource, domainShape, domainRadius,
      meshFileBuffer, meshFileName,
      skinEnabled, voxelizerTierOverride,
    ];
    void _deps;

    const gen = ++pipelineGen;
    runPipeline(gen);
  });
});

// ─── Public API: outputs ────────────────────────────────────────────────────

export function getLatticeRenderData(): BeamRenderData | null { return pipelineOutput?.renderData ?? null; }
export function getLatticeProperties(): LatticeProperties | null { return latticeProps; }
export function getPipelineStats(): PipelineStats | null { return pipelineOutput?.stats ?? null; }
export function getDomainTriangleMesh(): TriangleMesh | null { return pipelineOutput?.domainMesh ?? null; }
export function getClippedBeams(): ClippedBeamResult[] { return pipelineOutput?.clippedBeams ?? []; }
export function getActiveGrid(): LatticeGrid { return activeGrid; }
export function getAbsoluteRadius(): number { return rStar * activeGrid.cellSize[0]; }

// ─── Public API: parameters ─────────────────────────────────────────────────

export function getUnitCellId(): string { return unitCellId; }
export function setUnitCellId(id: string) { unitCellId = id; }
export function getUnitCellIds(): readonly string[] { return UNIT_CELL_IDS; }

export function getResolution(): number { return resolution; }
export function setResolution(v: number) { resolution = Math.max(2, Math.round(v)); }
export function getPadding(): number { return padding; }
export function setPadding(v: number) { padding = Math.max(0, Math.round(v)); }

export function getManualNx(): number { return manualNx; }
export function getManualNy(): number { return manualNy; }
export function getManualNz(): number { return manualNz; }
export function setManualNx(v: number) { manualNx = Math.max(1, Math.round(v)); }
export function setManualNy(v: number) { manualNy = Math.max(1, Math.round(v)); }
export function setManualNz(v: number) { manualNz = Math.max(1, Math.round(v)); }
export function getManualCellSize(): number { return manualCellSize; }
export function setManualCellSize(v: number) { manualCellSize = Math.max(0.01, v); }

export function getRStar(): number { return rStar; }
export function setRStar(v: number) { rStar = Math.max(0.01, Math.min(0.45, v)); }

export function getDomainEnabled(): boolean { return domainEnabled; }
export function setDomainEnabled(v: boolean) { domainEnabled = v; }
export function getDomainShape(): 'box' | 'sphere' { return domainShape; }
export function setDomainShape(v: 'box' | 'sphere') { domainShape = v; }
export function getDomainRadius(): number { return domainRadius; }
export function setDomainRadius(v: number) { domainRadius = Math.max(0.1, v); }
export function getDomainSource(): 'generated' | 'file' { return domainSource; }
export function setDomainSource(v: 'generated' | 'file') { domainSource = v; }
export function getMeshFileName(): string { return meshFileName; }
export function getMeshInfo(): { vertices: number; triangles: number } | null { return meshInfo; }
export function getSkinEnabled(): boolean { return skinEnabled; }
export function setSkinEnabled(v: boolean) { skinEnabled = v; }

export function setMeshFile(buffer: ArrayBuffer, name: string) {
  meshFileBuffer = buffer;
  meshFileName = name;
  try {
    const mesh = name.toLowerCase().endsWith('.obj')
      ? parseOBJ(new TextDecoder().decode(buffer))
      : parseSTL(buffer);
    meshInfo = { vertices: mesh.vertexCount, triangles: mesh.triangleCount };
  } catch { meshInfo = null; }
}

// ─── Public API: render layers ──────────────────────────────────────────────

export function getShowBeams(): boolean { return showBeams; }
export function setShowBeams(v: boolean) { showBeams = v; }
export function getShowSkin(): boolean { return showSkin; }
export function setShowSkin(v: boolean) { showSkin = v; }
export function getShowDomainMesh(): boolean { return showDomainMesh; }
export function setShowDomainMesh(v: boolean) { showDomainMesh = v; }
export function getShowGridBounds(): boolean { return showGridBounds; }
export function setShowGridBounds(v: boolean) { showGridBounds = v; }
export function getShowAxes(): boolean { return showAxes; }
export function setShowAxes(v: boolean) { showAxes = v; }
export function getDomainDisplayMode(): 'solid' | 'wireframe' | 'transparent' { return domainDisplayMode; }
export function setDomainDisplayMode(v: 'solid' | 'wireframe' | 'transparent') { domainDisplayMode = v; }
export function getVoxelizerTierOverride(): 'auto' | 'gpu' | 'cpu-wasm' | 'js' { return voxelizerTierOverride; }
export function setVoxelizerTierOverride(v: 'auto' | 'gpu' | 'cpu-wasm' | 'js') { voxelizerTierOverride = v; }

// ─── Public API: export ─────────────────────────────────────────────────────

let exportInProgress = $state(false);
let exportMcDensity = $state<number | null>(null);
let exportFilletK   = $state<number | null>(null);
let exportProgress  = $state(0);
let exportPhase     = $state('');
let exportTierUsed  = $state<'gpu' | 'js' | 'direct' | 'csg' | ''>('');
let exportTierOverride = $state<'auto' | 'gpu' | 'js' | 'direct' | 'csg'>('auto');
let lastExportStatus = $state<'ok' | 'error' | ''>('');
let lastExportSummary = $state('');

export function getExportInProgress(): boolean { return exportInProgress; }
export function getExportProgress(): number { return exportProgress; }
export function getExportPhase(): string { return exportPhase; }
export function getExportTierUsed(): 'gpu' | 'js' | 'direct' | 'csg' | '' { return exportTierUsed; }
export function getLastExportStatus(): 'ok' | 'error' | '' { return lastExportStatus; }
export function getLastExportSummary(): string { return lastExportSummary; }
export function getExportMcDensity(): number | null { return exportMcDensity; }
export function setExportMcDensity(v: number | null) { exportMcDensity = v; }
export function getExportFilletK(): number | null { return exportFilletK; }
export function setExportFilletK(v: number | null) { exportFilletK = v; }
export function getExportTierOverride(): 'auto' | 'gpu' | 'js' | 'direct' | 'csg' { return exportTierOverride; }
export function setExportTierOverride(v: 'auto' | 'gpu' | 'js' | 'direct' | 'csg') { exportTierOverride = v; }

/** Auto MC density: ≥ 3 samples across strut diameter. */
export function getAutoMcDensity(): number {
  const r = rStar;
  return Math.max(4, Math.ceil(3 / (2 * r)));
}

export function getExportTierAvailable(): 'gpu' | 'js' {
  return getSdfExporterTier();
}

export async function triggerExport(): Promise<void> {
  const output = pipelineOutput;
  if (!output || exportInProgress) return;
  exportInProgress = true;
  exportProgress = 0;
  exportPhase = '';
  exportTierUsed = '';
  lastExportStatus = '';
  lastExportSummary = '';

  const useCsg = exportTierOverride === 'csg';
  const useDirect = exportTierOverride === 'direct';
  const useGpu = !useCsg && !useDirect && (exportTierOverride === 'gpu'
    || (exportTierOverride === 'auto' && getSdfExporterTier() === 'gpu'));
  const gpuExporter = useGpu ? getSdfExporter() : null;
  const tier = useCsg ? 'CSG' : useDirect ? 'Direct' : gpuExporter ? 'GPU' : 'JS';

  console.log(`[export] Starting export — pipeline: ${tier}, override: ${exportTierOverride}, gpu available: ${getSdfExporterTier()}`);
  console.log(`[export] Beams: ${output.graph.beamCount}, radius: ${getAbsoluteRadius().toFixed(4)}`);

  const t0 = performance.now();

  try {
    const onProgress = (phase: string, pct: number) => {
      exportPhase = phase;
      exportProgress = pct;
      if (pct === 0) console.log(`[export] Phase: ${phase}`);
    };

    let result: import('@lattice/core').ExportResult;

    if (gpuExporter) {
      // GPU path stays on main thread (needs WebGPU device context)
      exportTierUsed = 'gpu';
      console.log('[export] Dispatching GPU SDF eval + marching cubes...');
      const { exportLatticeGpu } = await import('@lattice/core');
      result = await exportLatticeGpu(
        output.graph,
        output.trim,
        output.skin,
        getAbsoluteRadius(),
        {
          mcDensity: exportMcDensity ?? undefined,
          filletK: exportFilletK ?? undefined,
          gpuExporter,
          onProgress,
        },
      );
    } else {
      // JS, Direct, and CSG paths run in a Web Worker to keep UI responsive
      exportTierUsed = useCsg ? 'csg' : useDirect ? 'direct' : 'js';
      const mode = useCsg ? 'csg' as const : useDirect ? 'direct' as const : 'js' as const;
      console.log(`[export] Running ${tier} export in Web Worker...`);
      const { runExportInWorker } = await import('$lib/export-worker-client');
      result = await runExportInWorker({
        mode,
        graph: output.graph,
        trim: output.trim,
        skin: output.skin,
        absoluteRadius: getAbsoluteRadius(),
        mcDensity: exportMcDensity ?? undefined,
        filletK: exportFilletK ?? undefined,
        wasmUrl: useCsg ? `${import.meta.env.BASE_URL}manifold.wasm` : undefined,
        onProgress,
      });
    }

    const elapsed = performance.now() - t0;
    const sizeMB = (result.fileSizeBytes / (1024 * 1024)).toFixed(2);
    const summary = `${result.triangleCount.toLocaleString()} tris, ${sizeMB} MB, ${elapsed.toFixed(0)} ms`;

    console.log(`[export] Complete — ${tier} pipeline`);
    console.log(`[export]   Triangles: ${result.triangleCount.toLocaleString()}`);
    console.log(`[export]   File size: ${sizeMB} MB`);
    console.log(`[export]   Total: ${elapsed.toFixed(0)} ms (accel: ${result.timings.accelMs.toFixed(0)}, sdf: ${result.timings.sdfMs.toFixed(0)}, mc: ${result.timings.mcMs.toFixed(0)}, stl: ${result.timings.stlMs.toFixed(0)})`);

    lastExportStatus = 'ok';
    lastExportSummary = summary;

    const blob = new Blob([result.stl], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'lattice.stl';
    a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    const elapsed = performance.now() - t0;
    console.error(`[export] Failed after ${elapsed.toFixed(0)} ms — ${tier} pipeline:`, e);
    lastExportStatus = 'error';
    lastExportSummary = `${tier} export failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    exportInProgress = false;
    exportProgress = 1;
    exportPhase = '';
  }
}

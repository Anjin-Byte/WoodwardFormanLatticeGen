import {
  createUnitCell, createGrid, populate, buildBeamGraph, buildRenderData,
  totalCells,
  createBoxDomain, createSphereDomain, createMeshDomain, createTriangleMesh,
  tessellateBox, tessellateSphere,
  classifyCells, applyClassification, reclassifyLeakedBeams, trimBeams,
  generateSkin,
  computeLatticeProperties,
  occupancyToClassification,
  clipBoundaryBeams, buildDomainIndex, intersectLatticeWithDomain,
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

let unitCellId    = $state<string>('bccxy');
let rStar         = $state(0.08);
let cellWidth     = $state(1.0); // l_c in mm (paper: Woodward & Fromen)
let padding       = $state(1);
let manualNx      = $state(4);
let manualNy      = $state(4);
let manualNz      = $state(4);
let domainEnabled  = $state(true);
let domainShape    = $state<'box' | 'sphere'>('sphere');
let domainRadius   = $state(1.5);
let domainSource   = $state<'generated' | 'file'>('generated');
let meshFileBuffer = $state<ArrayBuffer | null>(null);
let meshFileName   = $state('');
let meshInfo       = $state<{ vertices: number; triangles: number } | null>(null);
let meshNativeExtent = $state(0);    // longest axis of raw mesh (before scaling)
let domainSize     = $state(10);     // target longest axis in mm
let skinEnabled    = $state(false);

// ─── Render layers & quality ────────────────────────────────────────────────

let showBeams        = $state(true);
let showSkin         = $state(true);
let showDomainMesh   = $state(true);
let showGridBounds   = $state(false);
let showAxes         = $state(true);
let domainDisplayMode = $state<'solid' | 'wireframe' | 'transparent'>('transparent');
let voxelizerTierOverride = $state<'auto' | 'gpu' | 'cpu-wasm' | 'js'>('auto');
let renderCylinderSegments = $state(8);
let renderFlatShading      = $state(true);
let renderWireframe        = $state(false);
let renderVersion          = $state(0);
let clippingMode           = $state<'approximate' | 'exact'>('approximate');

// ─── Deferred pipeline execution ────────────────────────────────────────────

let paramsDirty = $state(true);
let pipelineInProgress = $state(false);
let pipelineProgress   = $state(0);
let pipelinePhase      = $state('');
let pipelineAbort: AbortController | null = null;

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
  intersectedMesh: TriangleMesh | null;
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
      // Scale mesh so longest axis = domainSize (mm)
      const native = meshNativeExtent;
      if (native > 0) {
        const s = domainSize / native;
        return {
          min: [mesh.aabbMin[0] * s, mesh.aabbMin[1] * s, mesh.aabbMin[2] * s],
          max: [mesh.aabbMax[0] * s, mesh.aabbMax[1] * s, mesh.aabbMax[2] * s],
        };
      }
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
  const cs = cellWidth;
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
  return createGrid(manualNx, manualNy, manualNz, [cellWidth, cellWidth, cellWidth]);
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
  let intersectedMesh: TriangleMesh | null = null;
  let classMethod = 'none';

  if (domainEnabled) {
    // Build domain
    if (domainSource === 'file' && meshFileBuffer) {
      time('Parse', meshFileName.toLowerCase().endsWith('.obj') ? 'obj' : 'stl', () => {
        try {
          domainMesh = meshFileName.toLowerCase().endsWith('.obj')
            ? parseOBJ(new TextDecoder().decode(meshFileBuffer!))
            : parseSTL(meshFileBuffer!);
          // Scale mesh to target domainSize (mm)
          if (meshNativeExtent > 0) {
            const s = domainSize / meshNativeExtent;
            const sp = new Float32Array(domainMesh!.positions.length);
            for (let i = 0; i < sp.length; i++) sp[i] = domainMesh!.positions[i] * s;
            domainMesh = createTriangleMesh(sp, domainMesh!.indices);
          }
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

    if (clippingMode === 'exact' && domainMesh) {
      // Exact: Manifold boolean intersection (slow but mathematically correct)
      const dm: TriangleMesh = domainMesh;
      const tIntersect = performance.now();
      console.log('[pipeline] Running Manifold boolean intersection (exact mode)...');
      try {
        const intersectResult = await intersectLatticeWithDomain(
          graph, skin, dm,
          {
            segments: renderCylinderSegments,
            wasmUrl: `${import.meta.env.BASE_URL}manifold.wasm`,
          },
        );
        if (gen !== pipelineGen) return;
        intersectedMesh = intersectResult.mesh;
        classMethod = 'manifold';
        stages.push({
          name: 'Intersect', method: 'manifold',
          timeMs: performance.now() - tIntersect,
          output: `${intersectResult.mesh.triangleCount}t (tess:${intersectResult.timings.tessMs.toFixed(0)} union:${intersectResult.timings.unionMs.toFixed(0)} isect:${intersectResult.timings.intersectMs.toFixed(0)})`,
        });
        console.log(`[pipeline] Manifold intersection complete: ${(performance.now() - tIntersect).toFixed(0)} ms, ${intersectResult.mesh.triangleCount} triangles`);
      } catch (e) {
        console.error('[pipeline] Manifold intersection failed, falling back to approximate:', e);
        if (domainObj) {
          classification = classifyCells(graph, domainObj);
          classMethod = 'js-bvh (fallback)';
          applyClassification(graph, classification);
          reclassifyLeakedBeams(graph, domainObj, domainMesh!);
          trim = trimBeams(graph, domainObj);
          stages.push({ name: 'Classify+Trim', method: classMethod, timeMs: performance.now() - tIntersect, output: 'fallback' });
        }
      }
    } else if (domainObj && domainMesh) {
      // Approximate: classify → trim → clip (fast but may leak at thin features)
      const dm: TriangleMesh = domainMesh;
      const dObj: Domain = domainObj;
      time('Classify', 'bvh', () => {
        classification = classifyCells(graph, dObj);
        classMethod = 'js-bvh';
        return classMethod;
      });
      time('Trim', 'intersect', () => {
        applyClassification(graph, classification!);
        reclassifyLeakedBeams(graph, dObj, dm);
        trim = trimBeams(graph, dObj);
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

  // Clip boundary beams (only needed in fallback mode — no intersected mesh)
  let clippedBeams: ClippedBeamResult[] = [];
  if (!intersectedMesh && domainObj && domainMesh && trim) {
    time('Clip', 'csg', () => {
      const idx = buildDomainIndex(domainMesh!, grid);
      clippedBeams = clipBoundaryBeams(graph, domainObj!, domainMesh!, idx, trim, renderCylinderSegments);
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
    intersectedMesh,
    graph,
    trim,
    skin: skin as import('@lattice/core').SkinGraph | null,
  };
}

/** Mark params as dirty — called by all parameter setters. */
function markDirty() { paramsDirty = true; }

/** Commit current params and run the pipeline in a Web Worker. */
export async function commitAndGenerate(): Promise<void> {
  paramsDirty = false;
  const gen = ++pipelineGen;

  // Cancel any in-flight worker
  if (pipelineAbort) {
    pipelineAbort.abort();
    pipelineAbort = null;
  }

  pipelineInProgress = true;
  pipelineProgress = 0;
  pipelinePhase = '';

  const abort = new AbortController();
  pipelineAbort = abort;

  try {
    const { runPipelineInWorker } = await import('$lib/pipeline-worker-client');

    const result = await runPipelineInWorker({
      unitCellId,
      rStar,
      cellWidth,
      padding,
      manualNx,
      manualNy,
      manualNz,
      domainEnabled,
      domainSource,
      domainShape,
      domainRadius,
      domainSize,
      meshFileBuffer,
      meshFileName,
      meshNativeExtent,
      clippingMode,
      skinEnabled,
      renderCylinderSegments,
      wasmUrl: `${import.meta.env.BASE_URL}manifold.wasm`,
      onProgress: (phase, pct) => {
        pipelinePhase = phase;
        pipelineProgress = pct;
      },
    }, abort.signal);

    // Staleness check
    if (gen !== pipelineGen) return;

    pipelineOutput = {
      renderData: result.renderData,
      stats: result.stats,
      domainMesh: result.domainMesh,
      clippedBeams: result.clippedBeams,
      intersectedMesh: result.intersectedMesh,
      graph: result.graph,
      trim: result.trim,
      skin: result.skin,
    };
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return;
    console.error('[pipeline] Worker failed:', e);
    pipelineOutput = null;
  } finally {
    if (gen === pipelineGen) {
      pipelineInProgress = false;
      pipelineProgress = 1;
      pipelinePhase = '';
      pipelineAbort = null;
    }
  }
}

export function isParamsDirty(): boolean { return paramsDirty; }
export function getPipelineInProgress(): boolean { return pipelineInProgress; }
export function getPipelineProgress(): number { return pipelineProgress; }
export function getPipelinePhase(): string { return pipelinePhase; }

// Auto-generate on first load
setTimeout(() => commitAndGenerate(), 0);

// ─── Public API: outputs ────────────────────────────────────────────────────

export function getLatticeRenderData(): BeamRenderData | null { return pipelineOutput?.renderData ?? null; }
export function getLatticeProperties(): LatticeProperties | null { return latticeProps; }
export function getPipelineStats(): PipelineStats | null { return pipelineOutput?.stats ?? null; }
export function getDomainTriangleMesh(): TriangleMesh | null { return pipelineOutput?.domainMesh ?? null; }
export function getClippedBeams(): ClippedBeamResult[] { return pipelineOutput?.clippedBeams ?? []; }
export function getIntersectedMesh(): TriangleMesh | null { return pipelineOutput?.intersectedMesh ?? null; }
export function getActiveGrid(): LatticeGrid { return activeGrid; }
export function getAbsoluteRadius(): number { return rStar * activeGrid.cellSize[0]; }

// ─── Public API: parameters ─────────────────────────────────────────────────

export function getUnitCellId(): string { return unitCellId; }
export function setUnitCellId(id: string) { unitCellId = id; markDirty(); }
export function getUnitCellIds(): readonly string[] { return UNIT_CELL_IDS; }

export function getCellWidth(): number { return cellWidth; }
export function setCellWidth(v: number) { cellWidth = Math.max(0.001, v); markDirty(); }

/** Returns {min, max, step} for the l_c slider, scaled to domain extent. */
export function getCellWidthRange(): { min: number; max: number; step: number } {
  if (domainEnabled) {
    // Use domainSize for file meshes, domainRadius*2 for generated shapes
    const extent = (domainSource === 'file' && meshNativeExtent > 0)
      ? domainSize
      : domainRadius * 2;
    if (extent > 0) {
      const min = +(extent / 60).toPrecision(1);
      const max = +(extent / 2).toPrecision(2);
      const step = +(extent / 200).toPrecision(1);
      return { min: Math.max(0.001, min), max, step: Math.max(0.001, step) };
    }
  }
  return { min: 0.01, max: 10, step: 0.05 };
}
export function getPadding(): number { return padding; }
export function setPadding(v: number) { padding = Math.max(0, Math.round(v)); markDirty(); }

export function getManualNx(): number { return manualNx; }
export function getManualNy(): number { return manualNy; }
export function getManualNz(): number { return manualNz; }
export function setManualNx(v: number) { manualNx = Math.max(1, Math.round(v)); markDirty(); }
export function setManualNy(v: number) { manualNy = Math.max(1, Math.round(v)); markDirty(); }
export function setManualNz(v: number) { manualNz = Math.max(1, Math.round(v)); markDirty(); }

export function getRStar(): number { return rStar; }
export function setRStar(v: number) { rStar = Math.max(0.01, Math.min(0.45, v)); markDirty(); }

export function getDomainEnabled(): boolean { return domainEnabled; }
export function setDomainEnabled(v: boolean) { domainEnabled = v; markDirty(); }
export function getDomainShape(): 'box' | 'sphere' { return domainShape; }
export function setDomainShape(v: 'box' | 'sphere') { domainShape = v; markDirty(); }
export function getDomainRadius(): number { return domainRadius; }
export function setDomainRadius(v: number) { domainRadius = Math.max(0.1, v); markDirty(); }
export function getDomainSize(): number { return domainSize; }
export function setDomainSize(v: number) {
  const prev = domainSize;
  domainSize = Math.max(0.1, v);
  // Scale cellWidth proportionally so the cell count stays roughly the same
  if (prev > 0) cellWidth = +(cellWidth * domainSize / prev).toPrecision(3);
  markDirty();
}
export function getDomainSource(): 'generated' | 'file' { return domainSource; }
export function setDomainSource(v: 'generated' | 'file') { domainSource = v; markDirty(); }
export function getMeshFileName(): string { return meshFileName; }
export function getMeshInfo(): { vertices: number; triangles: number } | null { return meshInfo; }
export function getSkinEnabled(): boolean { return skinEnabled; }
export function setSkinEnabled(v: boolean) { skinEnabled = v; markDirty(); }

export function setMeshFile(buffer: ArrayBuffer, name: string) {
  meshFileBuffer = buffer;
  meshFileName = name;
  try {
    const mesh = name.toLowerCase().endsWith('.obj')
      ? parseOBJ(new TextDecoder().decode(buffer))
      : parseSTL(buffer);
    meshInfo = { vertices: mesh.vertexCount, triangles: mesh.triangleCount };
    const rx = mesh.aabbMax[0] - mesh.aabbMin[0];
    const ry = mesh.aabbMax[1] - mesh.aabbMin[1];
    const rz = mesh.aabbMax[2] - mesh.aabbMin[2];
    meshNativeExtent = Math.max(rx, ry, rz);
    // Auto-set cellWidth to ~8 cells across target domainSize
    if (domainSize > 0) {
      cellWidth = +(domainSize / 8).toPrecision(2);
    }
  } catch { meshInfo = null; }
  // File upload is an explicit action — auto-generate
  commitAndGenerate();
}

// ─── Public API: render layers & quality ──────────────────────────────────────────────

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
export function setVoxelizerTierOverride(v: 'auto' | 'gpu' | 'cpu-wasm' | 'js') { voxelizerTierOverride = v; markDirty(); }

export function getRenderCylinderSegments(): number { return renderCylinderSegments; }
export function setRenderCylinderSegments(v: number) { renderCylinderSegments = Math.max(3, Math.min(32, Math.round(v))); renderVersion++; markDirty(); }
export function getRenderFlatShading(): boolean { return renderFlatShading; }
export function setRenderFlatShading(v: boolean) { renderFlatShading = v; renderVersion++; }
export function getRenderVersion(): number { return renderVersion; }
export function getClippingMode(): 'approximate' | 'exact' { return clippingMode; }
export function setClippingMode(v: 'approximate' | 'exact') { clippingMode = v; markDirty(); }

// ─── Public API: export ─────────────────────────────────────────────────────

let exportInProgress = $state(false);
let exportMcDensity = $state<number | null>(null);
let exportFilletK   = $state<number | null>(null);
let exportCylinderSegments = $state(16);
let exportProgress  = $state(0);
let exportPhase     = $state('');
let exportTierUsed  = $state<'gpu' | 'js' | 'direct' | 'csg' | ''>('');
let exportTierOverride = $state<'auto' | 'gpu' | 'js' | 'direct' | 'csg'>('direct');
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
export function getExportCylinderSegments(): number { return exportCylinderSegments; }
export function setExportCylinderSegments(v: number) { exportCylinderSegments = Math.max(6, Math.min(64, Math.round(v))); }

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
        segments: exportCylinderSegments,
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

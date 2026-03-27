// Web Worker for lattice generation pipeline.
// Runs the full pipeline off the main thread to keep the UI responsive.

import {
  createUnitCell, createGrid, populate, buildBeamGraph, buildRenderData,
  totalCells,
  createBoxDomain, createSphereDomain, createMeshDomain, createTriangleMesh,
  tessellateBox, tessellateSphere,
  classifyCells, applyClassification, reclassifyLeakedBeams, trimBeams,
  generateSkin,
  clipBoundaryBeams, buildDomainIndex,
  intersectLatticeWithDomain,
  parseSTL, parseOBJ,
  CellClass,
} from '@lattice/core';
import type {
  BeamRenderData, TriangleMesh, LatticeGrid,
  CellClassification, TrimResult, SkinGraph, Domain, ClippedBeamResult,
} from '@lattice/core';

// ─── Message Types ──────────────────────────────────────────────────────────

interface PipelineRequest {
  type: 'pipeline';
  unitCellId: string;
  rStar: number;
  cellWidth: number;
  padding: number;
  manualNx: number;
  manualNy: number;
  manualNz: number;
  domainEnabled: boolean;
  domainSource: 'generated' | 'file';
  domainShape: 'box' | 'sphere';
  domainRadius: number;
  domainSize: number;
  meshFileBuffer: ArrayBuffer | null;
  meshFileName: string;
  meshNativeExtent: number;
  clippingMode: 'approximate' | 'exact';
  skinEnabled: boolean;
  renderCylinderSegments: number;
  wasmUrl: string;
}

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

export interface PipelineStage {
  name: string;
  method: string;
  timeMs: number;
  output: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function serializeTrim(trim: TrimResult): SerializedTrimResult {
  const trimKeys: number[] = [];
  const trimValues: number[] = [];
  for (const [k, v] of trim.trimmedPositions) {
    trimKeys.push(k);
    trimValues.push(v[0], v[1], v[2]);
  }
  return { trimKeys, trimValues, removedBeams: Array.from(trim.removedBeams) };
}

function serializeClipped(clipped: ClippedBeamResult[]): SerializedClippedBeam[] {
  return clipped.map(c => ({
    beamIndex: c.beamIndex,
    positions: c.mesh.positions,
    indices: c.mesh.indices,
    vertexCount: c.mesh.vertexCount,
    triangleCount: c.mesh.triangleCount,
  }));
}

function progress(phase: string, pct: number) {
  self.postMessage({ type: 'progress', phase, pct });
}

// ─── Grid Computation (mirrors main thread activeGrid) ──────────────────────

function computeGrid(req: PipelineRequest): LatticeGrid {
  if (req.domainEnabled) {
    let aabbMin: [number, number, number];
    let aabbMax: [number, number, number];

    if (req.domainSource === 'file' && req.meshFileBuffer) {
      try {
        const mesh = req.meshFileName.toLowerCase().endsWith('.obj')
          ? parseOBJ(new TextDecoder().decode(req.meshFileBuffer))
          : parseSTL(req.meshFileBuffer);
        if (req.meshNativeExtent > 0) {
          const s = req.domainSize / req.meshNativeExtent;
          aabbMin = [mesh.aabbMin[0] * s, mesh.aabbMin[1] * s, mesh.aabbMin[2] * s];
          aabbMax = [mesh.aabbMax[0] * s, mesh.aabbMax[1] * s, mesh.aabbMax[2] * s];
        } else {
          aabbMin = [...mesh.aabbMin] as [number, number, number];
          aabbMax = [...mesh.aabbMax] as [number, number, number];
        }
      } catch {
        return createGrid(req.manualNx, req.manualNy, req.manualNz,
          [req.cellWidth, req.cellWidth, req.cellWidth]);
      }
    } else {
      const r = req.domainRadius;
      aabbMin = [-r, -r, -r];
      aabbMax = [r, r, r];
    }

    const rangeX = aabbMax[0] - aabbMin[0];
    const rangeY = aabbMax[1] - aabbMin[1];
    const rangeZ = aabbMax[2] - aabbMin[2];
    const maxRange = Math.max(rangeX, rangeY, rangeZ);
    if (maxRange <= 0) {
      return createGrid(req.manualNx, req.manualNy, req.manualNz,
        [req.cellWidth, req.cellWidth, req.cellWidth]);
    }

    const cs = req.cellWidth;
    const nx = Math.max(1, Math.ceil(rangeX / cs) + req.padding * 2);
    const ny = Math.max(1, Math.ceil(rangeY / cs) + req.padding * 2);
    const nz = Math.max(1, Math.ceil(rangeZ / cs) + req.padding * 2);
    const cx = (aabbMin[0] + aabbMax[0]) / 2;
    const cy = (aabbMin[1] + aabbMax[1]) / 2;
    const cz = (aabbMin[2] + aabbMax[2]) / 2;
    return createGrid(nx, ny, nz, [cs, cs, cs],
      [cx - nx * cs / 2, cy - ny * cs / 2, cz - nz * cs / 2]);
  }

  return createGrid(req.manualNx, req.manualNy, req.manualNz,
    [req.cellWidth, req.cellWidth, req.cellWidth]);
}

// ─── Pipeline ───────────────────────────────────────────────────────────────

self.onmessage = async (e: MessageEvent<PipelineRequest>) => {
  const req = e.data;
  if (req.type !== 'pipeline') return;

  try {
    const t0 = performance.now();
    const stages: PipelineStage[] = [];
    const time = (name: string, method: string, fn: () => string) => {
      const s = performance.now();
      const out = fn();
      stages.push({ name, method, timeMs: performance.now() - s, output: out });
    };

    // Unit cell
    progress('unit-cell', 0);
    const cell = createUnitCell(req.unitCellId);
    if (!cell) {
      self.postMessage({ type: 'error', message: `Unknown unit cell: ${req.unitCellId}` });
      return;
    }

    // Grid
    const grid = computeGrid(req);
    const absoluteRadius = req.rStar * grid.cellSize[0];

    // Populate
    progress('populate', 0.1);
    let pop: ReturnType<typeof populate>;
    time('Populate', cell.id, () => {
      pop = populate(cell, grid);
      return `${pop.nodeCount}n ${pop.beamCount}b`;
    });
    pop = pop!;

    // BeamGraph
    progress('beam-graph', 0.2);
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

    if (req.domainEnabled) {
      // Build domain
      progress('domain', 0.3);
      if (req.domainSource === 'file' && req.meshFileBuffer) {
        time('Parse', req.meshFileName.toLowerCase().endsWith('.obj') ? 'obj' : 'stl', () => {
          try {
            domainMesh = req.meshFileName.toLowerCase().endsWith('.obj')
              ? parseOBJ(new TextDecoder().decode(req.meshFileBuffer!))
              : parseSTL(req.meshFileBuffer!);
            if (req.meshNativeExtent > 0) {
              const s = req.domainSize / req.meshNativeExtent;
              const sp = new Float32Array(domainMesh!.positions.length);
              for (let i = 0; i < sp.length; i++) sp[i] = domainMesh!.positions[i] * s;
              domainMesh = createTriangleMesh(sp, domainMesh!.indices);
            }
            domainObj = createMeshDomain(domainMesh!);
            return `${domainMesh!.vertexCount}v ${domainMesh!.triangleCount}t`;
          } catch { return 'error'; }
        });
      } else {
        time('Domain', req.domainShape, () => {
          const o = grid.origin;
          const cx = o[0] + grid.nx * grid.cellSize[0] / 2;
          const cy = o[1] + grid.ny * grid.cellSize[1] / 2;
          const cz = o[2] + grid.nz * grid.cellSize[2] / 2;
          if (req.domainShape === 'sphere') {
            domainObj = createSphereDomain([cx, cy, cz], req.domainRadius);
            domainMesh = tessellateSphere([cx, cy, cz], req.domainRadius, 24, 48);
          } else {
            const r = req.domainRadius;
            domainObj = createBoxDomain([cx - r, cy - r, cz - r], [cx + r, cy + r, cz + r]);
            domainMesh = tessellateBox([cx - r, cy - r, cz - r], [cx + r, cy + r, cz + r]);
          }
          return `${domainMesh!.triangleCount}t`;
        });
      }

      if (req.clippingMode === 'exact' && domainMesh) {
        progress('intersect', 0.5);
        const dm = domainMesh;
        const tI = performance.now();
        try {
          const res = await intersectLatticeWithDomain(graph, skin, dm, {
            segments: req.renderCylinderSegments,
            wasmUrl: req.wasmUrl,
          });
          intersectedMesh = res.mesh;
          classMethod = 'manifold';
          stages.push({
            name: 'Intersect', method: 'manifold',
            timeMs: performance.now() - tI,
            output: `${res.mesh.triangleCount}t`,
          });
        } catch (err) {
          // Fallback to approximate
          if (domainObj) {
            classification = classifyCells(graph, domainObj);
            classMethod = 'js-bvh (fallback)';
            applyClassification(graph, classification);
            reclassifyLeakedBeams(graph, domainObj, domainMesh!);
            trim = trimBeams(graph, domainObj);
            stages.push({ name: 'Classify+Trim', method: classMethod, timeMs: performance.now() - tI, output: 'fallback' });
          }
        }
      } else if (domainObj && domainMesh) {
        progress('classify', 0.5);
        const dm = domainMesh;
        const dObj = domainObj;
        time('Classify', 'bvh', () => {
          classification = classifyCells(graph, dObj);
          classMethod = 'js-bvh';
          return classMethod;
        });
        progress('trim', 0.6);
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

        if (req.skinEnabled) {
          progress('skin', 0.7);
          time('Skin', 'face-stitch', () => {
            skin = generateSkin(graph, trim!, cell, classification!);
            return `${skin!.beamCount}b`;
          });
        }
      }
    }

    // Clip (approximate mode only)
    let clippedBeams: ClippedBeamResult[] = [];
    if (!intersectedMesh && domainObj && domainMesh && trim) {
      progress('clip', 0.8);
      time('Clip', 'csg', () => {
        const idx = buildDomainIndex(domainMesh!, grid);
        clippedBeams = clipBoundaryBeams(graph, domainObj!, domainMesh!, idx, trim, req.renderCylinderSegments);
        return `${clippedBeams.length} clipped`;
      });
    }

    // Render data
    progress('render-data', 0.9);
    const skinOut = skin as SkinGraph | null;
    const skinCount = skinOut ? skinOut.beamCount : 0;
    let renderData: BeamRenderData;
    time('Render', 'instanced', () => {
      renderData = buildRenderData(graph, trim, skinOut, clippedBeams.length > 0);
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

    // Build result
    const stats = {
      stages,
      nodeCount: graph.nodeCount,
      beamCount: graph.beamCount,
      visibleBeamCount: renderData.count - skinCount,
      removedBeamCount: graph.beamCount - (renderData.count - skinCount),
      skinBeamCount: skinCount,
      cellsTotal: tc, cellsInterior: ci, cellsBoundary: cb, cellsExterior: ce,
      pipelineTimeMs: performance.now() - t0,
      voxelizerTier: 'worker',
      classificationMethod: classMethod,
    };

    // Collect transferable buffers
    const transfer: Transferable[] = [
      renderData.matrices.buffer,
      renderData.renderToBeam.buffer,
      graph.positions.buffer,
      graph.edges.buffer,
      graph.nodeFlags.buffer,
      graph.beamFlags.buffer,
      graph.beamRadii.buffer,
      graph.nodeBeamPtr.buffer,
      graph.nodeBeams.buffer,
    ];
    const domainMeshOut = domainMesh as TriangleMesh | null;
    if (domainMeshOut) {
      transfer.push(domainMeshOut.positions.buffer, domainMeshOut.indices.buffer);
    }
    const intersectedOut = intersectedMesh as TriangleMesh | null;
    if (intersectedOut) {
      transfer.push(intersectedOut.positions.buffer, intersectedOut.indices.buffer);
    }
    if (skinOut) {
      transfer.push(skinOut.positions.buffer, skinOut.edges.buffer, skinOut.beamRadii.buffer);
    }
    const serializedClipped = serializeClipped(clippedBeams);
    for (const sc of serializedClipped) {
      transfer.push(sc.positions.buffer, sc.indices.buffer);
    }

    // Deduplicate buffers (some typed arrays may share underlying ArrayBuffer)
    const uniqueTransfer = [...new Set(transfer)];

    self.postMessage({
      type: 'result',
      renderData,
      stats,
      domainMesh: domainMeshOut,
      clippedBeams: serializedClipped,
      intersectedMesh: intersectedOut,
      graph,
      trim: trim ? serializeTrim(trim) : null,
      skin: skinOut,
      grid,
    }, { transfer: uniqueTransfer });

  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};

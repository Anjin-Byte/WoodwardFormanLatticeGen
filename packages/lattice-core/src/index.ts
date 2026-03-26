export { clamp, lerp, mapRange } from './math.js';
export type { Vec3 } from './types.js';

export type {
  Face,
  UnitCell,
  LatticeGrid,
  PopulationResult,
  BeamGraph,
  Domain,
  DomainIndex,
  CellClassification,
  TrimResult,
  BeamRenderData,
  LatticeProperties,
  TriangleMesh,
  SkinGraph,
} from './pipeline-types.js';

export {
  NODE_INTERIOR, NODE_BOUNDARY, NODE_EXTERIOR, NODE_SKIN,
  BEAM_INTERIOR, BEAM_BOUNDARY, BEAM_TRIMMED, BEAM_SKIN, BEAM_REMOVED,
  CellClass,
} from './pipeline-types.js';

export { createUnitCell, computeFaceNodes, UNIT_CELL_IDS } from './unit-cell.js';
export {
  createGrid, totalCells, cellIndex, cellCoords,
  localToWorld, cellOrigin, cellCenter, gridMin, gridMax,
} from './grid.js';
export { populate, computeBeamCount } from './population.js';
export { buildBeamGraph, beamsInCell, cellOfBeam, cellCoordsOfBeam, getPosition } from './beam-graph.js';
export { buildRenderData, computeBeamTransform, getEffectivePosition } from './render-data.js';
export { createBoxDomain, createSphereDomain } from './domain.js';
export { createMeshDomain } from './mesh-domain.js';
export { buildDomainIndex } from './domain-index.js';
export { classifyCells, applyClassification, trimBeams } from './boundary.js';
export { computeLatticeProperties, computePressureDrop } from './derived-properties.js';
export type { StrutShape } from './derived-properties.js';
export { createTriangleMesh, tessellateBox, tessellateSphere, triangleBounds } from './triangle-mesh.js';
export { generateSkin } from './skin.js';
export { parseSTL } from './stl-parser.js';
export { parseOBJ } from './obj-parser.js';
export { buildBVH, bvhRaycast, bvhIntersectSegment } from './bvh.js';
export type { BVH } from './bvh.js';
export { occupancyToClassification } from './voxelize-wasm.js';
export { clipBoundaryBeams } from './clip.js';
export type { ClippedBeamResult } from './clip.js';
export { validateUnitCell, validateGrid } from './validate.js';

// SDF + Marching Cubes + Export
export { sdCappedCylinder, smin, buildSdfAccel, buildSdfAccelCsr, latticeSdf } from './sdf.js';
export type { SdfAccel, SdfAccelOptions, SdfAccelCsr } from './sdf.js';
export { marchingCubes, MC_EDGE_TABLE, MC_TRI_TABLE } from './marching-cubes.js';
export type { McResult } from './marching-cubes.js';
export { exportSTL } from './export-stl.js';
export { exportLattice } from './export-pipeline.js';
export { exportLatticeGpu } from './export-pipeline-gpu.js';
export { exportLatticeDirect, tessellateCylinder } from './export-direct.js';
export type { DirectExportOptions } from './export-direct.js';
export { exportLatticeCsg } from './export-csg.js';
export type { CsgExportOptions } from './export-csg.js';
export type { GpuSdfExporterHandle, GpuExportOptions } from './export-pipeline-gpu.js';
export type { ExportOptions, ExportResult } from './export-pipeline.js';

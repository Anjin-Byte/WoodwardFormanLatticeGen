// ─── Face / Axis ────────────────────────────────────────────────────────────

export type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

// ─── Unit Cell ──────────────────────────────────────────────────────────────

export interface UnitCell {
  id: string;
  nodes: Float64Array;
  edges: Uint32Array;
  nodeCount: number;
  edgeCount: number;
  faceNodes: Record<Face, Uint32Array>;
}

// ─── Grid ───────────────────────────────────────────────────────────────────

export interface LatticeGrid {
  nx: number;
  ny: number;
  nz: number;
  cellSize: [number, number, number];
  origin: [number, number, number];
}

// ─── Population ─────────────────────────────────────────────────────────────

export interface PopulationResult {
  positions: Float32Array;
  edges: Uint32Array;
  nodeCount: number;
  beamCount: number;
  edgesPerCell: number;
}

// ─── Beam Graph ─────────────────────────────────────────────────────────────

export interface BeamGraph {
  positions: Float32Array;
  edges: Uint32Array;
  nodeCount: number;
  beamCount: number;

  nodeFlags: Uint8Array;
  beamFlags: Uint8Array;
  beamRadii: Float32Array;

  nodeBeamPtr: Uint32Array;
  nodeBeams: Uint32Array;

  grid: LatticeGrid;
  edgesPerCell: number;
}

export const NODE_INTERIOR = 0b0000_0001;
export const NODE_BOUNDARY = 0b0000_0010;
export const NODE_EXTERIOR = 0b0000_0100;
export const NODE_SKIN     = 0b0000_1000;

export const BEAM_INTERIOR = 0b0000_0001;
export const BEAM_BOUNDARY = 0b0000_0010;
export const BEAM_TRIMMED  = 0b0000_0100;
export const BEAM_SKIN     = 0b0000_1000;
export const BEAM_REMOVED  = 0b0001_0000;

// ─── Boundary ───────────────────────────────────────────────────────────────

export interface Domain {
  contains(x: number, y: number, z: number): boolean;
  intersectSegment(
    p0x: number, p0y: number, p0z: number,
    p1x: number, p1y: number, p1z: number,
  ): number | null;
}

export interface DomainIndex {
  triPtr: Uint32Array;
  triIndices: Uint32Array;
  entryCount: number;
}

export const enum CellClass {
  EXTERIOR = 0,
  INTERIOR = 1,
  BOUNDARY = 2,
}

export type CellClassification = Uint8Array;

export interface TrimResult {
  trimmedPositions: Map<number, [number, number, number]>;
  removedBeams: Set<number>;
}

// ─── Triangle Mesh ──────────────────────────────────────────────────────────

export interface TriangleMesh {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
  aabbMin: [number, number, number];
  aabbMax: [number, number, number];
}

// ─── Skin Graph ─────────────────────────────────────────────────────────────

export interface SkinGraph {
  positions: Float32Array;
  edges: Uint32Array;
  nodeCount: number;
  beamCount: number;
  beamRadii: Float32Array;
}

// ─── Rendering ──────────────────────────────────────────────────────────────

export interface BeamRenderData {
  matrices: Float32Array;
  colors: Float32Array | null;
  count: number;
  renderToBeam: Uint32Array;
  skinOffset: number;
}

// ─── Derived Properties ─────────────────────────────────────────────────────

export interface LatticeProperties {
  openPorosity: number;
  totalPorosity: number;
  strutDiameter: number;
  windowDiameter: number;
  cellDiameter: number;
  specificSurfaceArea: number;
  tortuosity: number;
  hydraulicDiameter: number;
}

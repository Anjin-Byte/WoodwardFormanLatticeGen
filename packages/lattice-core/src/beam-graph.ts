import type { PopulationResult, LatticeGrid, BeamGraph } from './pipeline-types.js';
import { BEAM_INTERIOR, NODE_INTERIOR } from './pipeline-types.js';
import { cellCoords } from './grid.js';

const DEFAULT_RADIUS = 0.05;

export function buildBeamGraph(
  pop: PopulationResult,
  grid: LatticeGrid,
  defaultRadius: number = DEFAULT_RADIUS,
): BeamGraph {
  const { positions, edges, nodeCount, beamCount, edgesPerCell } = pop;

  // Initialize flags to INTERIOR
  const nodeFlags = new Uint8Array(nodeCount);
  nodeFlags.fill(NODE_INTERIOR);
  const beamFlags = new Uint8Array(beamCount);
  beamFlags.fill(BEAM_INTERIOR);

  // Uniform radii
  const beamRadii = new Float32Array(beamCount);
  beamRadii.fill(defaultRadius);

  // Build node → beams CSR
  const { nodeBeamPtr, nodeBeams } = buildNodeAdjacencyCSR(edges, nodeCount, beamCount);

  return {
    positions,
    edges,
    nodeCount,
    beamCount,
    nodeFlags,
    beamFlags,
    beamRadii,
    nodeBeamPtr,
    nodeBeams,
    grid,
    edgesPerCell,
  };
}

function buildNodeAdjacencyCSR(
  edges: Uint32Array,
  nodeCount: number,
  beamCount: number,
): { nodeBeamPtr: Uint32Array; nodeBeams: Uint32Array } {
  // Step 1: Count beams per node
  const counts = new Uint32Array(nodeCount);
  for (let b = 0; b < beamCount; b++) {
    counts[edges[b * 2]]++;
    counts[edges[b * 2 + 1]]++;
  }

  // Step 2: Prefix sum → nodeBeamPtr
  const nodeBeamPtr = new Uint32Array(nodeCount + 1);
  nodeBeamPtr[0] = 0;
  for (let n = 0; n < nodeCount; n++) {
    nodeBeamPtr[n + 1] = nodeBeamPtr[n] + counts[n];
  }

  // Step 3: Scatter beam indices
  const totalEntries = beamCount * 2;
  const nodeBeams = new Uint32Array(totalEntries);
  const offsets = new Uint32Array(nodeCount); // zero-initialized
  for (let b = 0; b < beamCount; b++) {
    const n0 = edges[b * 2];
    const n1 = edges[b * 2 + 1];
    nodeBeams[nodeBeamPtr[n0] + offsets[n0]++] = b;
    nodeBeams[nodeBeamPtr[n1] + offsets[n1]++] = b;
  }

  return { nodeBeamPtr, nodeBeams };
}

// ─── Cell↔Beam Arithmetic ───────────────────────────────────────────────────

export function beamsInCell(graph: BeamGraph, cellIdx: number): [number, number] {
  const start = cellIdx * graph.edgesPerCell;
  return [start, start + graph.edgesPerCell];
}

export function cellOfBeam(graph: BeamGraph, beamIdx: number): number {
  return Math.floor(beamIdx / graph.edgesPerCell);
}

export function cellCoordsOfBeam(graph: BeamGraph, beamIdx: number): [number, number, number] {
  return cellCoords(graph.grid, cellOfBeam(graph, beamIdx));
}

export function getPosition(graph: BeamGraph, nodeIdx: number): [number, number, number] {
  return [
    graph.positions[nodeIdx * 3],
    graph.positions[nodeIdx * 3 + 1],
    graph.positions[nodeIdx * 3 + 2],
  ];
}

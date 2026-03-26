import type { BeamGraph, TrimResult, CellClassification, UnitCell, SkinGraph, Face } from './pipeline-types.js';
import { CellClass, BEAM_TRIMMED } from './pipeline-types.js';
import { totalCells } from './grid.js';
import { beamsInCell } from './beam-graph.js';

/**
 * Generate skin beams at the boundary by connecting adjacent trimmed
 * endpoints that share a unit-cell face.
 */
export function generateSkin(
  graph: BeamGraph,
  trim: TrimResult,
  cell: UnitCell,
  classification: CellClassification,
  defaultRadius?: number,
): SkinGraph {
  const radius = defaultRadius ?? (graph.beamRadii.length > 0 ? graph.beamRadii[0] : 0.05);
  const tc = totalCells(graph.grid);

  // Build face membership lookup for the unit cell:
  // For each node, which faces does it sit on?
  const nodeFaces: Set<Face>[] = Array.from({ length: cell.nodeCount }, () => new Set());
  const faces: Face[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
  for (const face of faces) {
    for (const nodeIdx of cell.faceNodes[face]) {
      nodeFaces[nodeIdx].add(face);
    }
  }

  // Collect skin edges: pairs of trimmed node indices that share a face
  const skinEdgeSet = new Set<string>();
  const skinEdges: [number, number][] = [];

  for (let c = 0; c < tc; c++) {
    if (classification[c] !== CellClass.BOUNDARY) continue;

    const [beamStart, beamEnd] = beamsInCell(graph, c);

    // Find trimmed nodes in this cell
    // A trimmed node is the "outside" endpoint of a TRIMMED beam
    const trimmedNodes: number[] = [];

    for (let b = beamStart; b < beamEnd; b++) {
      if (!(graph.beamFlags[b] & BEAM_TRIMMED)) continue;

      const n0 = graph.edges[b * 2];
      const n1 = graph.edges[b * 2 + 1];

      if (trim.trimmedPositions.has(n0)) trimmedNodes.push(n0);
      if (trim.trimmedPositions.has(n1)) trimmedNodes.push(n1);
    }

    // Deduplicate within this cell
    const uniqueTrimmed = [...new Set(trimmedNodes)];

    if (uniqueTrimmed.length < 2) continue;

    // For each pair, check if their original unit-cell nodes share a face.
    // Map global node index back to unit-cell-local index:
    // Since beams are emitted in cell order, beam b is in cell c = floor(b / edgesPerCell).
    // The local edge index within the cell is b - beamStart.
    // The local node indices are cell.edges[(b - beamStart) * 2] and cell.edges[(b - beamStart) * 2 + 1].
    //
    // We need to map global node → local unit cell node.
    // Build this for the trimmed nodes in this cell.

    const globalToLocal = new Map<number, number>();
    for (let b = beamStart; b < beamEnd; b++) {
      const localEdgeIdx = b - beamStart;
      const localA = cell.edges[localEdgeIdx * 2];
      const localB = cell.edges[localEdgeIdx * 2 + 1];
      const globalA = graph.edges[b * 2];
      const globalB = graph.edges[b * 2 + 1];
      globalToLocal.set(globalA, localA);
      globalToLocal.set(globalB, localB);
    }

    // Connect pairs that share a face
    for (let i = 0; i < uniqueTrimmed.length; i++) {
      for (let j = i + 1; j < uniqueTrimmed.length; j++) {
        const gA = uniqueTrimmed[i];
        const gB = uniqueTrimmed[j];
        const lA = globalToLocal.get(gA);
        const lB = globalToLocal.get(gB);
        if (lA === undefined || lB === undefined) continue;

        // Check if they share at least one face
        const facesA = nodeFaces[lA];
        const facesB = nodeFaces[lB];
        let shared = false;
        for (const f of facesA) {
          if (facesB.has(f)) { shared = true; break; }
        }

        if (shared) {
          const key = gA < gB ? `${gA},${gB}` : `${gB},${gA}`;
          if (!skinEdgeSet.has(key)) {
            skinEdgeSet.add(key);
            skinEdges.push(gA < gB ? [gA, gB] : [gB, gA]);
          }
        }
      }
    }
  }

  // Build SkinGraph from collected edges
  // Skin node positions come from the trim overlay
  const nodeMap = new Map<number, number>(); // global node idx → skin node idx
  const positions: number[] = [];
  const edges: number[] = [];

  for (const [gA, gB] of skinEdges) {
    if (!nodeMap.has(gA)) {
      const pos = trim.trimmedPositions.get(gA);
      if (!pos) continue; // shouldn't happen
      const skinIdx = positions.length / 3;
      positions.push(pos[0], pos[1], pos[2]);
      nodeMap.set(gA, skinIdx);
    }
    if (!nodeMap.has(gB)) {
      const pos = trim.trimmedPositions.get(gB);
      if (!pos) continue;
      const skinIdx = positions.length / 3;
      positions.push(pos[0], pos[1], pos[2]);
      nodeMap.set(gB, skinIdx);
    }

    edges.push(nodeMap.get(gA)!, nodeMap.get(gB)!);
  }

  const nodeCount = positions.length / 3;
  const beamCount = edges.length / 2;
  const beamRadii = new Float32Array(beamCount);
  beamRadii.fill(radius);

  return {
    positions: new Float32Array(positions),
    edges: new Uint32Array(edges),
    nodeCount,
    beamCount,
    beamRadii,
  };
}

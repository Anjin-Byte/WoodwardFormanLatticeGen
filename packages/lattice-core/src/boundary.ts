import type { BeamGraph, Domain, CellClassification, TrimResult } from './pipeline-types.js';
import { CellClass, NODE_BOUNDARY, NODE_EXTERIOR, BEAM_BOUNDARY, BEAM_REMOVED, BEAM_TRIMMED } from './pipeline-types.js';
import { totalCells, cellCenter } from './grid.js';
import { beamsInCell, getPosition } from './beam-graph.js';

export function classifyCells(
  graph: BeamGraph,
  domain: Domain,
): CellClassification {
  const tc = totalCells(graph.grid);
  const result = new Uint8Array(tc) as CellClassification;

  for (let c = 0; c < tc; c++) {
    // Test all beam endpoints in this cell against the domain
    const [beamStart, beamEnd] = beamsInCell(graph, c);
    let anyInside = false;
    let anyOutside = false;

    for (let b = beamStart; b < beamEnd; b++) {
      const n0 = graph.edges[b * 2];
      const n1 = graph.edges[b * 2 + 1];

      for (const n of [n0, n1]) {
        const x = graph.positions[n * 3];
        const y = graph.positions[n * 3 + 1];
        const z = graph.positions[n * 3 + 2];
        if (domain.contains(x, y, z)) {
          anyInside = true;
        } else {
          anyOutside = true;
        }
        if (anyInside && anyOutside) break;
      }
      if (anyInside && anyOutside) break;
    }

    if (anyInside && anyOutside) {
      result[c] = CellClass.BOUNDARY;
    } else if (anyInside) {
      result[c] = CellClass.INTERIOR;
    } else {
      result[c] = CellClass.EXTERIOR;
    }
  }

  return result;
}

export function applyClassification(
  graph: BeamGraph,
  classification: CellClassification,
): void {
  const tc = totalCells(graph.grid);

  for (let c = 0; c < tc; c++) {
    const [beamStart, beamEnd] = beamsInCell(graph, c);

    if (classification[c] === CellClass.EXTERIOR) {
      for (let b = beamStart; b < beamEnd; b++) {
        graph.beamFlags[b] |= BEAM_REMOVED;
        graph.nodeFlags[graph.edges[b * 2]]     |= NODE_EXTERIOR;
        graph.nodeFlags[graph.edges[b * 2 + 1]] |= NODE_EXTERIOR;
      }
    } else if (classification[c] === CellClass.BOUNDARY) {
      for (let b = beamStart; b < beamEnd; b++) {
        graph.beamFlags[b] |= BEAM_BOUNDARY;
        graph.nodeFlags[graph.edges[b * 2]]     |= NODE_BOUNDARY;
        graph.nodeFlags[graph.edges[b * 2 + 1]] |= NODE_BOUNDARY;
      }
    }
  }

  // Second pass: flag interior beams with boundary endpoints
  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    if ((graph.nodeFlags[n0] | graph.nodeFlags[n1]) & NODE_BOUNDARY) {
      graph.beamFlags[b] |= BEAM_BOUNDARY;
    }
  }
}

export function trimBeams(
  graph: BeamGraph,
  domain: Domain,
): TrimResult {
  const trimmedPositions = new Map<number, [number, number, number]>();
  const removedBeams = new Set<number>();

  for (let b = 0; b < graph.beamCount; b++) {
    if (!(graph.beamFlags[b] & BEAM_BOUNDARY)) continue;
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;

    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const p0 = getPosition(graph, n0);
    const p1 = getPosition(graph, n1);

    const p0Inside = domain.contains(p0[0], p0[1], p0[2]);
    const p1Inside = domain.contains(p1[0], p1[1], p1[2]);

    if (p0Inside && p1Inside) continue;

    if (!p0Inside && !p1Inside) {
      removedBeams.add(b);
      graph.beamFlags[b] |= BEAM_REMOVED;
      continue;
    }

    // One inside, one outside — trim at intersection
    const t = domain.intersectSegment(
      p0[0], p0[1], p0[2],
      p1[0], p1[1], p1[2],
    );
    if (t === null || t === 0) continue;

    const outsideNode = p0Inside ? n1 : n0;
    const ix = p0[0] + t * (p1[0] - p0[0]);
    const iy = p0[1] + t * (p1[1] - p0[1]);
    const iz = p0[2] + t * (p1[2] - p0[2]);

    trimmedPositions.set(outsideNode, [ix, iy, iz]);
    graph.beamFlags[b] |= BEAM_TRIMMED;
    graph.nodeFlags[outsideNode] |= NODE_BOUNDARY;
  }

  return { trimmedPositions, removedBeams };
}

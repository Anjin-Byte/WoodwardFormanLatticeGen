import type { BeamGraph, Domain, CellClassification, TrimResult, TriangleMesh } from './pipeline-types.js';
import { CellClass, NODE_BOUNDARY, NODE_EXTERIOR, BEAM_BOUNDARY, BEAM_REMOVED, BEAM_TRIMMED } from './pipeline-types.js';
import { totalCells, cellCenter } from './grid.js';
import { beamsInCell, getPosition } from './beam-graph.js';
import { buildBVH, bvhSegmentCrossingCount } from './bvh.js';

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

/**
 * Post-classification pass: verify that interior beams are truly inside the
 * domain. Catches two failure modes:
 *
 * 1. **Endpoint leakage** — cell center is inside but beam endpoints (at cell
 *    corners) protrude outside. Detected by `domain.contains()` on each endpoint.
 *
 * 2. **Bridging** — both endpoints are inside the mesh (in opposite walls of a
 *    thin feature like a handle) but the beam crosses through exterior space.
 *    Detected by counting surface crossings along the beam segment — if the
 *    segment crosses the mesh surface ≥ 2 times, it exits and re-enters.
 *
 * Reclassified beams get BEAM_BOUNDARY so trimBeams and clipBoundaryBeams
 * process them. Beams where both endpoints are outside are REMOVED.
 */
export function reclassifyLeakedBeams(
  graph: BeamGraph,
  domain: Domain,
  domainMesh: TriangleMesh,
): void {
  const bvh = buildBVH(domainMesh);

  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    if (graph.beamFlags[b] & BEAM_BOUNDARY) continue;

    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const p0x = graph.positions[n0 * 3], p0y = graph.positions[n0 * 3 + 1], p0z = graph.positions[n0 * 3 + 2];
    const p1x = graph.positions[n1 * 3], p1y = graph.positions[n1 * 3 + 1], p1z = graph.positions[n1 * 3 + 2];

    const inside0 = domain.contains(p0x, p0y, p0z);
    const inside1 = domain.contains(p1x, p1y, p1z);

    // Case 1: endpoint(s) outside → mark boundary or remove
    if (!inside0 && !inside1) {
      graph.beamFlags[b] |= BEAM_REMOVED;
      continue;
    }
    if (!inside0 || !inside1) {
      graph.beamFlags[b] |= BEAM_BOUNDARY;
      if (!inside0) graph.nodeFlags[n0] |= NODE_BOUNDARY;
      if (!inside1) graph.nodeFlags[n1] |= NODE_BOUNDARY;
      continue;
    }

    // Case 2: both inside but beam bridges through exterior (thin features).
    // Count mesh surface crossings along the segment.
    const crossings = bvhSegmentCrossingCount(bvh, domainMesh, p0x, p0y, p0z, p1x, p1y, p1z);
    if (crossings >= 2) {
      // Beam exits and re-enters the mesh — remove it since there's no
      // single trim point that can fix a beam passing through exterior space.
      graph.beamFlags[b] |= BEAM_REMOVED;
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

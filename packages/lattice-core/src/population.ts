import type { UnitCell, LatticeGrid, PopulationResult, Face } from './pipeline-types.js';
import { cellIndex } from './grid.js';

const EPS = 1e-10;

// Pre-computed lookup: for each node, which negative faces it sits on
// and its index within that face's array. Built once per populate() call.
interface FaceMembership {
  face: Face;
  faceIdx: number;
}

function buildFaceMemberships(cell: UnitCell): FaceMembership[][] {
  const result: FaceMembership[][] = Array.from({ length: cell.nodeCount }, () => []);
  const negFaces: Face[] = ['-x', '-y', '-z'];

  for (const face of negFaces) {
    const arr = cell.faceNodes[face];
    for (let fi = 0; fi < arr.length; fi++) {
      result[arr[fi]].push({ face, faceIdx: fi });
    }
  }

  return result;
}

// Positive face counterpart for reuse bank writing
const POSITIVE_FACE: Record<Face, Face> = {
  '-x': '+x', '+x': '-x',
  '-y': '+y', '+y': '-y',
  '-z': '+z', '+z': '-z',
};

export function computeBeamCount(cell: UnitCell, grid: LatticeGrid): number {
  return cell.edgeCount * grid.nx * grid.ny * grid.nz;
}

export function populate(cell: UnitCell, grid: LatticeGrid): PopulationResult {
  const { nx, ny, nz } = grid;
  const totalBeams = computeBeamCount(cell, grid);

  // Upper bound for node count (no dedup). We'll truncate after.
  const maxNodes = cell.nodeCount * nx * ny * nz;

  const positions = new Float32Array(maxNodes * 3);
  const edges = new Uint32Array(totalBeams * 2);

  // Face node counts for reuse banks
  const fxCount = cell.faceNodes['+x'].length;
  const fyCount = cell.faceNodes['+y'].length;
  const fzCount = cell.faceNodes['+z'].length;

  // Reuse banks: store global indices for positive-face nodes of processed cells.
  // xBank[j * nz + k][fi] = global index for +x face node fi of cell at prev i
  const xBank = new Uint32Array(ny * nz * fxCount);
  // yBank[k][fi] = global index for +y face node fi of cell at prev j
  const yBank = new Uint32Array(nz * fyCount);
  // zBank[fi] = global index for +z face node fi of cell at prev k
  const zBank = new Uint32Array(fzCount);

  // Pre-compute: for each node, build lookup for positive face membership
  // (used when writing to reuse banks after processing a cell)
  const posFaceMembership: { face: Face; faceIdx: number }[][] =
    Array.from({ length: cell.nodeCount }, () => []);
  for (const face of ['+x', '+y', '+z'] as Face[]) {
    const arr = cell.faceNodes[face];
    for (let fi = 0; fi < arr.length; fi++) {
      posFaceMembership[arr[fi]].push({ face, faceIdx: fi });
    }
  }

  // Pre-compute: for each node, which negative faces it's on (for reuse lookup)
  const negFaceMembership = buildFaceMemberships(cell);

  let nodeWriteIdx = 0;
  let edgeWriteIdx = 0;

  const localToGlobal = new Uint32Array(cell.nodeCount);

  for (let i = 0; i < nx; i++) {
    for (let j = 0; j < ny; j++) {
      for (let k = 0; k < nz; k++) {

        // --- Emit or reuse nodes ---
        for (let n = 0; n < cell.nodeCount; n++) {
          let reused = false;

          // Check negative face reuse (in priority order: -x, -y, -z)
          for (const mem of negFaceMembership[n]) {
            if (reused) break;

            if (mem.face === '-x' && i > 0) {
              // Reuse from cell (i-1,j,k)'s +x face
              const bankOffset = (j * nz + k) * fxCount + mem.faceIdx;
              localToGlobal[n] = xBank[bankOffset];
              reused = true;
            } else if (mem.face === '-y' && j > 0) {
              const bankOffset = k * fyCount + mem.faceIdx;
              localToGlobal[n] = yBank[bankOffset];
              reused = true;
            } else if (mem.face === '-z' && k > 0) {
              localToGlobal[n] = zBank[mem.faceIdx];
              reused = true;
            }
          }

          if (!reused) {
            // New node: compute world position
            const lx = cell.nodes[n * 3];
            const ly = cell.nodes[n * 3 + 1];
            const lz = cell.nodes[n * 3 + 2];
            positions[nodeWriteIdx * 3]     = grid.origin[0] + (i + lx) * grid.cellSize[0];
            positions[nodeWriteIdx * 3 + 1] = grid.origin[1] + (j + ly) * grid.cellSize[1];
            positions[nodeWriteIdx * 3 + 2] = grid.origin[2] + (k + lz) * grid.cellSize[2];
            localToGlobal[n] = nodeWriteIdx;
            nodeWriteIdx++;
          }
        }

        // --- Write positive face banks for future neighbors ---
        for (let n = 0; n < cell.nodeCount; n++) {
          for (const mem of posFaceMembership[n]) {
            if (mem.face === '+x') {
              xBank[(j * nz + k) * fxCount + mem.faceIdx] = localToGlobal[n];
            } else if (mem.face === '+y') {
              yBank[k * fyCount + mem.faceIdx] = localToGlobal[n];
            } else if (mem.face === '+z') {
              zBank[mem.faceIdx] = localToGlobal[n];
            }
          }
        }

        // --- Emit edges ---
        for (let e = 0; e < cell.edgeCount; e++) {
          const a = cell.edges[e * 2];
          const b = cell.edges[e * 2 + 1];
          const ga = localToGlobal[a];
          const gb = localToGlobal[b];
          edges[edgeWriteIdx * 2]     = Math.min(ga, gb);
          edges[edgeWriteIdx * 2 + 1] = Math.max(ga, gb);
          edgeWriteIdx++;
        }
      }
    }
  }

  // Copy to a correctly-sized buffer (not a view into the oversized allocation)
  const finalPositions = positions.slice(0, nodeWriteIdx * 3);

  return {
    positions: finalPositions,
    edges,
    nodeCount: nodeWriteIdx,
    beamCount: totalBeams,
    edgesPerCell: cell.edgeCount,
  };
}

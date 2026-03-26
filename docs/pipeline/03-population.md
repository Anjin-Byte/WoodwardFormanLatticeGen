# Stage 3: Population (Assembly)

## Purpose

Population transforms a UnitCell + Grid into a BeamGraph. This is the assembly step: it places the unit cell topology into every grid cell, deduplicates shared boundary nodes between neighbors, and builds the CSR spatial indices.

This is the most performance-critical construction step and the strongest candidate for Rust/WASM.

## Algorithm Overview

```
1. Allocate output arrays (pre-computed sizes).
2. Initialize reuse banks for shared face nodes.
3. Iterate cells in row-major order (i outer, k inner).
4. For each cell:
   a. Emit or reuse nodes (dedup shared face nodes via reuse banks).
   b. Emit edges with global node indices.
5. Return positions, edges, counts, edgesPerCell.
```

Cell→beam mapping is implicit in the emission order (see "Cell→Beam Relationship" below).
Node adjacency CSR is built later during BeamGraph construction (stage 4).

## Pre-computation: Array Sizing

Before iterating, we can compute exact output sizes:

```
Shared nodes between two adjacent cells on one face = faceNodes[face].length

Total unique nodes = nodeCount * totalCells
                   - sharedPerFace_x * ny * nz * (nx - 1)    // x-adjacent sharing
                   - sharedPerFace_y * nx * nz * (ny - 1)    // y-adjacent sharing
                   - sharedPerFace_z * nx * ny * (nz - 1)    // z-adjacent sharing
                   + (edge and corner sharing corrections)
```

For simplicity, the exact count can be computed by noting that each interior face is shared once:

```ts
function computeNodeCount(cell: UnitCell, grid: LatticeGrid): number {
  const { nx, ny, nz } = grid;
  const base = cell.nodeCount * nx * ny * nz;
  const sharedX = cell.faceNodes['+x'].length * (nx - 1) * ny * nz;
  const sharedY = cell.faceNodes['+y'].length * nx * (ny - 1) * nz;
  const sharedZ = cell.faceNodes['+z'].length * nx * ny * (nz - 1);
  // Nodes on shared edges (where two face sharings overlap) get double-subtracted.
  // Nodes on shared corners (three face sharings) get triple-subtracted, then added back, etc.
  // For correctness, use inclusion-exclusion or just count during assembly.
  // In practice: allocate pessimistically (base - sharedX - sharedY - sharedZ)
  // and track actual count during emission.
  return base - sharedX - sharedY - sharedZ;
  // This is a lower bound; exact count requires edge/corner correction.
  // We allocate this + a small buffer, then truncate.
}

function computeBeamCount(cell: UnitCell, grid: LatticeGrid): number {
  // Every cell contributes all its edges. No edge deduplication —
  // edges are interior to cells, not shared across faces.
  // (Shared face NODES connect edges from adjacent cells, but
  // the edges themselves are distinct.)
  return cell.edgeCount * grid.nx * grid.ny * grid.nz;
}
```

**Key insight:** Edges are never shared between cells. Only nodes are shared. Each cell contributes exactly `edgeCount` edges to the global graph. The deduplication is purely on nodes.

## Node Emission and Deduplication

### Strategy: Backward-looking reuse

When processing cell (i,j,k) in row-major order, cells (i-1,j,k), (i,j-1,k), and (i,j,k-1) have already been processed. Their boundary nodes are available for reuse.

For each node in the unit cell:
1. Compute its world position from `localToWorld(i, j, k, lx, ly, lz)`.
2. Check if this node sits on a face shared with an already-processed neighbor.
3. If yes, look up the existing global index for that node.
4. If no, assign a new global index and write the position.

### Node Index Lookup Table

We need a fast way to find "what global index did my neighbor assign to the node that I share?"

**Approach:** For each cell, maintain a local→global index map of size `nodeCount`. After processing a cell, the face nodes' global indices are available for the next cell's reuse.

```ts
// During processing of cell (i,j,k):
// localToGlobal[localIdx] = globalIdx for each of this cell's nodes
const localToGlobal = new Uint32Array(cell.nodeCount);
```

For backward reuse, we need the previous cell's `localToGlobal` for its positive-face nodes:

```
// Reuse from -x neighbor (cell i-1,j,k):
// My -x face nodes reuse their +x face nodes' global indices.
// faceNodes['-x'][n] in my cell  ←→  faceNodes['+x'][n] in cell (i-1,j,k)
//
// Since face node arrays are pre-sorted by on-face coordinates (see 01-unit-cell.md),
// the mapping is index-for-index.
```

### Efficient Storage for Neighbor Lookups

We don't need to store all previous cells' mappings. We only need:

- **x-neighbor reuse:** The `localToGlobal` of the immediately preceding cell in the i-direction. Since we iterate i in the outer loop, this is the previous i-iteration's data for the same (j,k). Store one `ny × nz` bank of face-node global indices for the +x face.

- **y-neighbor reuse:** The `localToGlobal` of the cell at (i, j-1, k). Since j is the middle loop, this is from the previous j-iteration. Store one `nz`-length bank of +y face-node global indices.

- **z-neighbor reuse:** The `localToGlobal` of cell (i, j, k-1). This is simply the previous iteration's data. Store one set of +z face-node global indices.

```ts
// Pre-allocate reuse banks:
// xBank[j * nz + k] = Uint32Array of +x face node global indices for cell at previous i
const xBank = new Array(ny * nz).fill(null).map(() => new Uint32Array(faceNodesX));
// yBank[k] = +y face node global indices for cell at previous j
const yBank = new Array(nz).fill(null).map(() => new Uint32Array(faceNodesY));
// zBank = +z face node global indices for previous k
let zBank = new Uint32Array(faceNodesZ);
```

After processing each cell, write its +x, +y, +z face node global indices into the appropriate bank for future reuse.

## Edge Emission

Straightforward: for each edge (a, b) in the unit cell, emit (localToGlobal[a], localToGlobal[b]) into the global edges array.

Canonical ordering (a < b) is maintained by the unit cell definition. After dedup, the remapped indices may violate this, so re-canonicalize:

```ts
const ga = localToGlobal[a];
const gb = localToGlobal[b];
edges[edgeWriteIdx * 2]     = Math.min(ga, gb);
edges[edgeWriteIdx * 2 + 1] = Math.max(ga, gb);
```

## Cell→Beam Relationship

Because the triple loop emits all edges for cell 0, then all for cell 1, etc., the beam index implicitly encodes cell ownership:

```
cellOfBeam(b) = floor(b / edgesPerCell)
beamsInCell(c) = [c * edgesPerCell .. (c+1) * edgesPerCell)
```

No explicit association array is needed. This is an invariant of the emission order — the loop must process cells in `cellIndex` order and emit all of a cell's edges contiguously. See [04-beam-graph.md](04-beam-graph.md) for the arithmetic API.

## Control Flow (Pseudocode)

```
function populate(cell: UnitCell, grid: LatticeGrid): PopulationResult {
  const totalBeams = cell.edgeCount * grid.nx * grid.ny * grid.nz;
  const maxNodes = cell.nodeCount * grid.nx * grid.ny * grid.nz; // upper bound

  // Output buffers
  const positions = new Float32Array(maxNodes * 3);
  const edges = new Uint32Array(totalBeams * 2);

  // Reuse banks
  const xBank = allocXBank(grid, cell);
  const yBank = allocYBank(grid, cell);
  let zBank = new Uint32Array(cell.faceNodes['+z'].length);

  let nodeWriteIdx = 0;
  let edgeWriteIdx = 0;

  for (let i = 0; i < grid.nx; i++) {
    for (let j = 0; j < grid.ny; j++) {
      for (let k = 0; k < grid.nz; k++) {
        const localToGlobal = new Uint32Array(cell.nodeCount);

        // --- Emit or reuse nodes ---
        for (let n = 0; n < cell.nodeCount; n++) {
          let reused = false;

          // Check -x neighbor reuse
          if (i > 0 && isOnFace(cell, n, '-x')) {
            const faceIdx = faceIndex(cell, n, '-x');
            localToGlobal[n] = xBank[(j * grid.nz + k) * faceNodesX + faceIdx];
            reused = true;
          }
          // Check -y neighbor reuse (only if not already reused)
          if (!reused && j > 0 && isOnFace(cell, n, '-y')) {
            const faceIdx = faceIndex(cell, n, '-y');
            localToGlobal[n] = yBank[k * faceNodesY + faceIdx];
            reused = true;
          }
          // Check -z neighbor reuse
          if (!reused && k > 0 && isOnFace(cell, n, '-z')) {
            const faceIdx = faceIndex(cell, n, '-z');
            localToGlobal[n] = zBank[faceIdx];
            reused = true;
          }

          if (!reused) {
            // New node — compute world position and write
            const [lx, ly, lz] = getNodeLocal(cell, n);
            const [wx, wy, wz] = localToWorld(grid, i, j, k, lx, ly, lz);
            positions[nodeWriteIdx * 3]     = wx;
            positions[nodeWriteIdx * 3 + 1] = wy;
            positions[nodeWriteIdx * 3 + 2] = wz;
            localToGlobal[n] = nodeWriteIdx;
            nodeWriteIdx++;
          }
        }

        // --- Write face banks for future neighbors ---
        writeFaceBank(xBank, j, k, cell, localToGlobal, '+x');
        writeFaceBank(yBank, k, cell, localToGlobal, '+y');
        writeFaceBank(zBank, cell, localToGlobal, '+z');

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

  // Truncate positions to actual node count
  const finalPositions = positions.subarray(0, nodeWriteIdx * 3);

  return { positions: finalPositions, edges, nodeCount: nodeWriteIdx, beamCount: totalBeams };
}
```

## Node on Multiple Faces

A node can sit on a corner (3 faces) or an edge of the unit cube (2 faces). The reuse logic must handle this: once a node is reused from one neighbor, it should not be emitted again. The check order (-x, then -y, then -z) with the `reused` flag handles this — the first match wins, and subsequent checks are skipped.

**Corner correctness:** A corner node (e.g., at local (0,0,0)) is on faces -x, -y, and -z simultaneously. It will be reused from whichever neighbor was processed first. Since we check -x before -y before -z, it reuses from the x-neighbor. This is correct because the x-neighbor would have already reused it from its own y-neighbor (or z-neighbor), creating a chain back to the cell that originally emitted the node.

## Performance Notes

- The inner loop body is ~20 arithmetic ops per node, ~6 per edge. For a 100³ grid with a cubic cell (8 nodes, 12 edges), that's 8M node ops and 12M edge ops — sub-second in WASM.
- The reuse banks are small: O(faceNodes * max(ny*nz, nz, 1)). For a cubic cell with 4 face nodes and a 100³ grid, the x-bank is 4 * 10000 = 40K entries.
- Memory: positions dominate at 12 bytes * nodeCount. For 100³ cubic (≈700K unique nodes), that's ~8 MB.

## Output

```ts
interface PopulationResult {
  positions: Float32Array;       // [x,y,z, ...], length = nodeCount * 3
  edges: Uint32Array;            // [a,b, ...], length = beamCount * 2
  nodeCount: number;
  beamCount: number;
  edgesPerCell: number;          // cell.edgeCount — carried forward for arithmetic
}
```

This is the raw material for constructing the BeamGraph (next stage).

## Testing

- **Cubic 1×1×1:** 8 nodes, 12 edges. No sharing. Verify positions match unit cell scaled by cellSize.
- **Cubic 2×1×1:** 12 nodes (not 16 — 4 shared on +x/-x face). 24 edges. Verify shared nodes have identical positions.
- **Cubic 2×2×2:** Verify exact node count with full sharing formula. Verify no duplicate positions in the output.
- **Edge canonicalization:** All emitted edges satisfy `edges[i*2] < edges[i*2+1]`.
- **No orphan nodes:** Every node index appears in at least one edge.
- **Beam ordering:** Beams `[0, edgesPerCell)` belong to cell 0, `[edgesPerCell, 2*edgesPerCell)` to cell 1, etc. Verify `cellOfBeam(b)` is consistent with the cell that produced beam b.
- **Position accuracy:** For a cell at known (i,j,k), its non-shared nodes' world positions match `localToWorld` computation within 1e-7.
- **Determinism:** Same inputs produce bitwise-identical outputs (important for WASM reproducibility).

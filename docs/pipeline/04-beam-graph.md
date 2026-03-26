# Stage 4: Beam Graph

## Purpose

The BeamGraph is the single source of truth for the lattice at runtime. It is constructed from the PopulationResult and enriched with per-element metadata and a node adjacency index. All downstream stages — rendering, boundary work, property computation, export — read from the BeamGraph.

## Key Design Decision: No Cell→Beam CSR

The grid is fully populated — every cell gets the same unit cell, same edge count. The relationship from cell to beams is a uniform stride:

```
beamsForCell(c) = [c * edgeCount, c * edgeCount + 1, ..., c * edgeCount + edgeCount - 1]
cellOfBeam(b)   = floor(b / edgeCount)
```

This is arithmetic, not data. A CSR for this relationship wastes memory on a uniform array that encodes nothing the stride doesn't already tell you.

**What does earn a sparse index:** the host domain's mesh triangles against the grid. Most cells have zero domain triangles intersecting them — only the boundary shell does. That sparse relationship is indexed by the `DomainIndex` in [05-boundary.md](05-boundary.md), not here.

## Data Structure

```ts
interface BeamGraph {
  // ─── Geometry ───────────────────────────────────────────────────────

  /** World-space node positions. Flat packed [x,y,z, ...].
   *  Length = nodeCount * 3. Immutable after construction (boundary work
   *  writes to a trimmed-position overlay, not here). */
  positions: Float32Array;

  /** Edge pairs as global node indices. Flat packed [a,b, ...].
   *  Length = beamCount * 2.
   *  Invariant: edges[i*2] < edges[i*2+1] (canonical order). */
  edges: Uint32Array;

  nodeCount: number;
  beamCount: number;

  // ─── Per-element metadata ───────────────────────────────────────────

  /** Per-node flags. Length = nodeCount. */
  nodeFlags: Uint8Array;

  /** Per-beam flags. Length = beamCount. */
  beamFlags: Uint8Array;

  /** Per-beam strut radius. Length = beamCount.
   *  Initialized to a uniform value; boundary work or grading may vary it. */
  beamRadii: Float32Array;

  // ─── Topology: node → beams (adjacency) ─────────────────────────────

  /** CSR row pointer. Length = nodeCount + 1.
   *  Beams touching node n: nodeBeams[nodeBeamPtr[n] .. nodeBeamPtr[n+1]). */
  nodeBeamPtr: Uint32Array;

  /** CSR column data. Flat list of beam indices.
   *  Length = beamCount * 2 (each beam contributes to two nodes). */
  nodeBeams: Uint32Array;

  // ─── Grid + Cell reference ──────────────────────────────────────────

  /** The grid used to construct this graph. Retained for coordinate lookups. */
  grid: LatticeGrid;

  /** Edge count per cell (from the UnitCell). Used for cell↔beam arithmetic. */
  edgesPerCell: number;
}
```

## Cell↔Beam Arithmetic

No stored index. Pure functions:

```ts
/** All beam indices belonging to cell c. */
function beamsInCell(graph: BeamGraph, cellIdx: number): [number, number] {
  const start = cellIdx * graph.edgesPerCell;
  return [start, start + graph.edgesPerCell];
}

/** Which cell owns beam b. */
function cellOfBeam(graph: BeamGraph, beamIdx: number): number {
  return Math.floor(beamIdx / graph.edgesPerCell);
}

/** (i,j,k) of the cell that owns beam b. */
function cellCoordsOfBeam(graph: BeamGraph, beamIdx: number): [number, number, number] {
  return cellCoords(graph.grid, cellOfBeam(graph, beamIdx));
}
```

This works because population emits beams in cell order: all beams for cell 0, then all for cell 1, etc. This is an invariant of the population stage (see [03-population.md](03-population.md)).

## Node Adjacency CSR (node → beams)

This CSR *is* worth storing. Node valence varies — shared boundary nodes connect to beams from multiple cells. This index is needed for:

- Trimming conflict detection (how many beams share this node?)
- Joint rendering (what's the max radius at this node?)
- Selection (click a node → highlight its beams)

### Construction

```
Input:  edges[beamIdx*2], edges[beamIdx*2+1] for each beam
Output: nodeBeamPtr, nodeBeams

Step 1: Count beams per node (each beam touches 2 nodes).
  counts = new Uint32Array(nodeCount);
  for beam in 0..beamCount:
    counts[edges[beam * 2]]++;
    counts[edges[beam * 2 + 1]]++;

Step 2: Prefix sum → nodeBeamPtr.
  nodeBeamPtr = new Uint32Array(nodeCount + 1);
  nodeBeamPtr[0] = 0;
  for n in 0..nodeCount:
    nodeBeamPtr[n + 1] = nodeBeamPtr[n] + counts[n];

Step 3: Scatter beam indices into nodeBeams.
  nodeBeams = new Uint32Array(beamCount * 2);
  offsets = new Uint32Array(nodeCount);  // zero-initialized
  for beam in 0..beamCount:
    const n0 = edges[beam * 2];
    const n1 = edges[beam * 2 + 1];
    nodeBeams[nodeBeamPtr[n0] + offsets[n0]++] = beam;
    nodeBeams[nodeBeamPtr[n1] + offsets[n1]++] = beam;
```

## Flag Definitions

```ts
const NODE_INTERIOR  = 0b0000_0001;
const NODE_BOUNDARY  = 0b0000_0010;
const NODE_EXTERIOR  = 0b0000_0100;
const NODE_SKIN      = 0b0000_1000;

const BEAM_INTERIOR  = 0b0000_0001;
const BEAM_BOUNDARY  = 0b0000_0010;
const BEAM_TRIMMED   = 0b0000_0100;
const BEAM_SKIN      = 0b0000_1000;
const BEAM_REMOVED   = 0b0001_0000;
```

Flags are bitfields — a beam can be both BOUNDARY and TRIMMED. After population, all flags start as INTERIOR. Boundary classification and trimming update them.

## Construction from PopulationResult

```
function buildBeamGraph(pop: PopulationResult, grid: LatticeGrid, edgesPerCell: number): BeamGraph {
  1. Copy positions, edges, nodeCount, beamCount directly.
  2. Initialize beamRadii to uniform default.
  3. Initialize nodeFlags and beamFlags to INTERIOR.
  4. Build node adjacency CSR (node → beams) from edges.
  5. Store grid reference and edgesPerCell.
}
```

## Invariants

### Structural
1. `positions.length === nodeCount * 3`.
2. `edges.length === beamCount * 2`.
3. All edge node indices in [0, nodeCount).
4. `edges[i*2] < edges[i*2+1]` for all i (canonical order).
5. No duplicate edges.
6. `beamCount === grid.nx * grid.ny * grid.nz * edgesPerCell`.

### Cell↔Beam arithmetic
7. Beams are emitted in cell order: for beam b, `cellOfBeam(b) <= cellOfBeam(b+1)`.
8. Each cell owns exactly `edgesPerCell` beams.
9. `beamsInCell(c)` returns `[c * edgesPerCell, (c+1) * edgesPerCell)`.

### CSR: node → beams
10. `nodeBeamPtr.length === nodeCount + 1`.
11. `nodeBeamPtr[0] === 0`.
12. `nodeBeamPtr[nodeCount] === beamCount * 2`.
13. `nodeBeamPtr` is monotonically non-decreasing.
14. For each entry `nodeBeams[j] = beamIdx`, the row's node n is an endpoint of beam beamIdx.

### Flags
15. After construction, all nodeFlags are NODE_INTERIOR.
16. After construction, all beamFlags are BEAM_INTERIOR.
17. Flags are only mutated by boundary classification and boundary work stages.

### Consistency
18. For every beam b, both `edges[b*2]` and `edges[b*2+1]` have b in their `nodeBeams` list.
19. `beamRadii.length === beamCount`.
20. `nodeFlags.length === nodeCount`.
21. `beamFlags.length === beamCount`.

## Memory Budget

For a 100³ grid with cubic unit cell (8 nodes/cell, 12 edges/cell):
- Unique nodes ≈ 706,000 (after deduplication)
- Beams = 100³ × 12 = 12,000,000

| Array | Type | Elements | Bytes |
|---|---|---|---|
| positions | f32×3 | 706K | 8.5 MB |
| edges | u32×2 | 12M | 96 MB |
| beamRadii | f32 | 12M | 48 MB |
| beamFlags | u8 | 12M | 12 MB |
| nodeFlags | u8 | 706K | 0.7 MB |
| nodeBeamPtr | u32 | 706K+1 | 2.8 MB |
| nodeBeams | u32 | 24M | 96 MB |
| **Total** | | | **~264 MB** |

~100 MB savings versus the previous design by dropping the cell→beam CSR and cellOfBeam array. The node adjacency CSR is the largest single cost (96 MB). If memory is tight, it can be built on demand rather than stored.

## Testing

- **Cubic 1×1×1:** Build graph, verify all invariants.
- **Cubic 2×1×1:** Verify shared nodes appear in node adjacency for beams from both cells.
- **Cell↔beam arithmetic:** For every beam in a 3×3×3 graph, verify `cellOfBeam(b)` falls in [0, 27) and `beamsInCell(cellOfBeam(b))` contains b.
- **Node adjacency correctness:** For every node, every beam in its adjacency list references that node in its edge pair.
- **No orphan nodes:** Every node in [0, nodeCount) appears in at least one edge.
- **Flag initialization:** All flags are INTERIOR after construction.
- **Beam ordering:** Beams 0..edgesPerCell-1 belong to cell 0, beams edgesPerCell..2*edgesPerCell-1 to cell 1, etc.

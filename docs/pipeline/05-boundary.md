# Stage 5: Boundary Classification, Trimming, and Skin

## Purpose

The lattice grid is typically larger than or misaligned with the host domain (the shape being filled). Boundary work determines which cells are inside, outside, or crossing the domain surface, then trims crossing beams and optionally generates skin connectivity along the boundary.

This stage is the only one that mutates BeamGraph flags after construction.

## 5a: Domain Representation

The host domain is the shape the lattice fills. We need to test points and segments against it.

```ts
interface Domain {
  /** Returns true if the point is inside or on the surface. */
  contains(x: number, y: number, z: number): boolean;

  /** Returns the parameter t in [0,1] where the segment (p0→p1) first exits
   *  the domain. Returns null if the segment is entirely inside.
   *  If entirely outside, returns 0. */
  intersectSegment(
    p0x: number, p0y: number, p0z: number,
    p1x: number, p1y: number, p1z: number,
  ): number | null;
}
```

Initial implementations:
- **Box domain:** Axis-aligned box. `contains` is 6 comparisons. `intersectSegment` is ray-AABB.
- **Sphere domain:** Center + radius. `contains` is distance check. `intersectSegment` is ray-sphere.
- **Mesh domain:** Triangle mesh with BVH. `contains` via raycasting parity. `intersectSegment` via BVH traversal. This is the general case for arbitrary primitives from Woodward & Fromen.

The Domain interface is deliberately minimal — boundary work only needs these two queries.

## 5b: Domain Index (Sparse CSR: cell → domain triangles)

This is where the CSR structure earns its keep. The lattice grid is fully populated — cell→beam is just arithmetic (see [04-beam-graph.md](04-beam-graph.md)). But the relationship between grid cells and the host domain's mesh triangles is *sparse*. Most cells don't intersect the domain surface at all. Only the boundary shell does.

The DomainIndex maps grid cells to the domain triangles that intersect them, so trimming and skin generation can find the relevant surface geometry without scanning the entire mesh.

```ts
interface DomainIndex {
  /** CSR row pointer. Length = totalCells + 1.
   *  Domain triangles intersecting cell c:
   *    triIndices[triPtr[c] .. triPtr[c+1])
   *  For interior/exterior cells, triPtr[c] === triPtr[c+1] (empty row). */
  triPtr: Uint32Array;

  /** CSR column data. Triangle indices into the domain mesh.
   *  Only boundary cells have entries. */
  triIndices: Uint32Array;

  /** Total number of cell-triangle intersections (triIndices.length).
   *  Much smaller than totalCells × triangleCount. */
  entryCount: number;
}
```

### Construction

```
function buildDomainIndex(grid: LatticeGrid, domainMesh: TriangleMesh): DomainIndex {
  // Step 1: For each domain triangle, find which grid cells it overlaps.
  //         Triangle-AABB test against each cell, or rasterize the triangle
  //         into grid space (faster for large grids).

  // Accumulator: list of (cellIdx, triIdx) pairs.
  const pairs: [number, number][] = [];

  for (let t = 0; t < domainMesh.triangleCount; t++) {
    const triAABB = domainMesh.triangleBounds(t);
    // Find grid cell range overlapping this AABB
    const [iMin, jMin, kMin] = worldToCell(grid, triAABB.min);
    const [iMax, jMax, kMax] = worldToCell(grid, triAABB.max);

    for (let i = iMin; i <= iMax; i++)
      for (let j = jMin; j <= jMax; j++)
        for (let k = kMin; k <= kMax; k++) {
          // Optional: exact triangle-cell AABB test to prune false positives
          const cellIdx = cellIndex(grid, i, j, k);
          pairs.push([cellIdx, t]);
        }
  }

  // Step 2: Sort pairs by cellIdx (or use counting sort since cellIdx ∈ [0, totalCells)).

  // Step 3: Build CSR from sorted pairs (standard count → prefix-sum → scatter).

  return { triPtr, triIndices, entryCount: pairs.length };
}
```

### Sparsity

For a sphere domain inside a 100³ grid:
- Total cells: 1,000,000
- Boundary cells (sphere shell): ~60,000 (≈6% of cells)
- Domain triangles per boundary cell: typically 1–4
- Total entries: ~150,000

The CSR is very sparse. `triPtr` has 1M+1 entries (4 MB), but `triIndices` is only ~600 KB. The row pointer cost is fixed regardless of sparsity — if that's a concern for very large grids, a hash map from cellIdx→triangle list is an alternative, but CSR is simpler and cache-friendlier for the scan pattern boundary work uses.

## 5c: Cell Classification

Classify every grid cell as interior, boundary, or exterior.

```ts
const enum CellClass {
  EXTERIOR = 0,
  INTERIOR = 1,
  BOUNDARY = 2,
}

type CellClassification = Uint8Array;  // length = totalCells
```

### Algorithm

With the DomainIndex, classification is direct:

```
function classifyCells(
  grid: LatticeGrid,
  domain: Domain,
  domainIndex: DomainIndex,
): CellClassification {
  const result = new Uint8Array(totalCells);

  for (let c = 0; c < totalCells; c++) {
    const hasTriangles = domainIndex.triPtr[c] < domainIndex.triPtr[c + 1];

    if (hasTriangles) {
      // Domain surface passes through this cell.
      result[c] = BOUNDARY;
    } else {
      // No triangles intersect. Test a single point (cell center) to
      // determine inside vs outside.
      const [cx, cy, cz] = cellCenter(grid, c);
      result[c] = domain.contains(cx, cy, cz) ? INTERIOR : EXTERIOR;
    }
  }

  return result;
}
```

**Why this works:** If a cell has no domain triangles, the domain surface doesn't cross it, so the cell is entirely on one side. A single containment test resolves which side.

**Edge case:** A cell entirely inside a concavity could have no intersecting triangles but still be near the surface. The single-point test handles this correctly — the point is either inside or outside, and with no surface crossing through the cell, that classification is correct for the whole cell.

### Propagating to BeamGraph Flags

```
function applyClassification(
  graph: BeamGraph,
  classification: CellClassification,
): void {
  for (let c = 0; c < totalCells; c++) {
    const [beamStart, beamEnd] = beamsInCell(graph, c);

    if (classification[c] === EXTERIOR) {
      for (let b = beamStart; b < beamEnd; b++) {
        graph.beamFlags[b] |= BEAM_REMOVED;
        graph.nodeFlags[graph.edges[b * 2]]     |= NODE_EXTERIOR;
        graph.nodeFlags[graph.edges[b * 2 + 1]] |= NODE_EXTERIOR;
      }
    } else if (classification[c] === BOUNDARY) {
      for (let b = beamStart; b < beamEnd; b++) {
        graph.beamFlags[b] |= BEAM_BOUNDARY;
        graph.nodeFlags[graph.edges[b * 2]]     |= NODE_BOUNDARY;
        graph.nodeFlags[graph.edges[b * 2 + 1]] |= NODE_BOUNDARY;
      }
    }
    // INTERIOR: flags stay as initialized (INTERIOR).
  }

  // Second pass: beams in interior cells whose endpoints reach into
  // boundary cells also need the BOUNDARY flag.
  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    if ((graph.nodeFlags[n0] | graph.nodeFlags[n1]) & NODE_BOUNDARY) {
      graph.beamFlags[b] |= BEAM_BOUNDARY;
    }
  }
}
```

## 5d: Trimming

Trim beams that cross the domain boundary. Only beams with BEAM_BOUNDARY flag are processed.

### Algorithm

For mesh domains, trimming can use the DomainIndex to find the specific triangles relevant to each beam, rather than testing against the entire mesh:

```
function trimBeams(
  graph: BeamGraph,
  domain: Domain,
  domainIndex: DomainIndex,
): TrimResult {
  const trimmedPositions: Map<number, [number, number, number]> = new Map();
  const removedBeams: Set<number> = new Set();

  for (let b = 0; b < graph.beamCount; b++) {
    if (!(graph.beamFlags[b] & BEAM_BOUNDARY)) continue;

    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const p0 = getPosition(graph, n0);
    const p1 = getPosition(graph, n1);

    const p0Inside = domain.contains(p0[0], p0[1], p0[2]);
    const p1Inside = domain.contains(p1[0], p1[1], p1[2]);

    if (p0Inside && p1Inside) continue;        // fully inside, untrimmed

    if (!p0Inside && !p1Inside) {              // fully outside, remove
      removedBeams.add(b);
      graph.beamFlags[b] |= BEAM_REMOVED;
      continue;
    }

    // One inside, one outside — trim at intersection.
    const t = domain.intersectSegment(
      p0[0], p0[1], p0[2],
      p1[0], p1[1], p1[2],
    );
    if (t === null) continue;

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
```

### Position Overlay

Trimming does NOT mutate `graph.positions`. Trimmed node positions are stored in a `Map<number, [number, number, number]>` overlay. Rendering and export check the overlay first:

```ts
function getEffectivePosition(
  graph: BeamGraph,
  trim: TrimResult | null,
  nodeIdx: number,
): [number, number, number] {
  if (trim) {
    const override = trim.trimmedPositions.get(nodeIdx);
    if (override) return override;
  }
  return [
    graph.positions[nodeIdx * 3],
    graph.positions[nodeIdx * 3 + 1],
    graph.positions[nodeIdx * 3 + 2],
  ];
}
```

**Why overlay, not mutation:** A node can be shared by multiple beams. One beam may need the node trimmed to one position, another beam from a different boundary cell may need a different trim point. The overlay is keyed per-node, so the last write wins. For correctness with complex boundaries, we may need to split the node (duplicate it with a different position per beam). Start with last-wins; upgrade to split if artifacts appear.

### TrimResult

```ts
interface TrimResult {
  /** Overridden positions for trimmed nodes. */
  trimmedPositions: Map<number, [number, number, number]>;
  /** Beam indices that were fully removed. */
  removedBeams: Set<number>;
}
```

## 5e: Skin Generation (Deferred)

Woodward & Fromen's skin generation creates new struts along the domain boundary, connecting trimmed beam endpoints to form a conformal open lattice skin.

**Deferred:** Skin generation is not required for the initial rendering pipeline. The lattice renders correctly with just trimming. Skin is needed for structural integrity in exported prints.

When implemented, the DomainIndex is the key enabler: for each boundary cell, retrieve its domain triangles, compute intersection curves with the unit cell connectivity surfaces, and generate skin beams along those curves.

## Testing

### DomainIndex
- **Empty mesh:** All rows empty. `entryCount === 0`.
- **Single triangle:** Only cells it overlaps have entries.
- **Full enclosure:** Mesh fully outside grid → no entries. Mesh fully inside → boundary cells on mesh surface have entries.
- **CSR consistency:** `triPtr` monotonic. `triPtr[last] === entryCount`. All triangle indices in range.

### Cell Classification
- **Box domain ⊃ grid:** All cells INTERIOR.
- **Box domain ∩ grid = ∅:** All cells EXTERIOR.
- **Box domain cutting grid in half:** Correct INTERIOR/BOUNDARY/EXTERIOR counts.
- **Sphere domain:** Boundary cells form a shell. DomainIndex entries exist only for boundary cells.
- **Classification matches DomainIndex:** Every BOUNDARY cell has nonzero entries in DomainIndex. Every cell with DomainIndex entries is BOUNDARY.

### Trimming
- **Beam entirely inside:** Not trimmed, not removed.
- **Beam entirely outside:** REMOVED.
- **Beam crossing boundary:** TRIMMED, override at intersection.
- **Trim position accuracy:** Known beam + box domain → override within ε of analytic intersection.

### Flag Consistency
- After classification: no beam has both INTERIOR and REMOVED simultaneously.
- After trimming: TRIMMED implies BOUNDARY.
- REMOVED beams are not TRIMMED (removed takes precedence).
- Every EXTERIOR node is an endpoint of at least one REMOVED beam.

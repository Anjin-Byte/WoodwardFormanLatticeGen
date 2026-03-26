# Global Invariants

Invariants that hold across the entire pipeline. Each stage documents its own local invariants; this file captures cross-stage contracts.

## Ownership

| Data | Owner | Mutated By | Read By |
|---|---|---|---|
| `UnitCell` | Catalog (immutable) | Never | Population, Derived Properties |
| `LatticeGrid` | User params (immutable after creation) | Never | Population, Derived Properties, Rendering |
| `BeamGraph.positions` | Population | Never (overlay for trims) | Rendering, Export, Boundary |
| `BeamGraph.edges` | Population | Never | All downstream |
| `BeamGraph.*Flags` | Population (init) | Boundary Classification, Trimming | Rendering, Export |
| `BeamGraph.beamRadii` | Population (init) | User interaction (grading) | Rendering, Export, Derived Props |
| `BeamGraph.edgesPerCell` | Population | Never | Cell↔beam arithmetic everywhere |
| `BeamGraph.nodeBeamPtr/nodeBeams` | Population | Never | Boundary work, Rendering |
| `DomainIndex` | Boundary stage | Only by re-indexing | Classification, Trimming, Skin |
| `TrimResult` | Trimming | Only by re-trimming | Rendering, Export |
| `CellClassification` | Boundary Classification | Only by re-classification | Trimming |

## Immutability Rules

1. **UnitCell and LatticeGrid are value types.** Once created, they are never mutated. Changing parameters means creating a new instance and re-running the pipeline.

2. **BeamGraph geometry (positions, edges) is write-once.** Set during population, never modified. Trimming uses an overlay, not mutation.

3. **BeamGraph node adjacency CSR is write-once.** Built during construction, never modified. If the graph topology changes (e.g., skin beams added), a new BeamGraph is constructed. Cell↔beam mapping is arithmetic (uniform stride), not stored.

4. **Flags are append-only (bitwise OR).** A flag bit, once set, is never cleared within a pipeline run. A fresh pipeline run starts with all flags at INTERIOR.

5. **beamRadii is the only user-mutable field.** Radius grading changes radii without rebuilding the graph. All downstream stages (rendering, derived properties) re-read radii.

## Pipeline Re-run Triggers

| User Action | Pipeline Stages Re-run |
|---|---|
| Change unit cell type | All (new UnitCell → new everything) |
| Change grid dimensions (nx, ny, nz) | All (new Grid → new everything) |
| Change cell size | All (new Grid → new everything) |
| Change strut radius (uniform) | Rendering, Derived Properties only |
| Change domain mesh | DomainIndex, Classification, Trimming, Rendering |
| Move/resize domain | DomainIndex, Classification, Trimming, Rendering |

"All" means population + BeamGraph construction + classification + trimming + rendering. The UnitCell catalog lookup and Grid construction are trivial and don't need optimization.

## Array Length Contracts

These hold at all times after BeamGraph construction:

```
positions.length     === nodeCount * 3
edges.length         === beamCount * 2
nodeFlags.length     === nodeCount
beamFlags.length     === beamCount
beamRadii.length     === beamCount
beamCount            === totalCells * edgesPerCell
nodeBeamPtr.length   === nodeCount + 1
nodeBeams.length     === beamCount * 2
```

## Numeric Contracts

- All positions are finite (no NaN, no Infinity).
- All radii are > 0 and finite.
- All indices are in their valid range (edge node indices < nodeCount, beam indices < beamCount, cell indices < totalCells).
- CSR pointers are monotonically non-decreasing.
- CSR final pointer equals the total count of the indexed elements.

## Ordering Contracts

- Edges are canonically ordered: `edges[i*2] < edges[i*2+1]`.
- Face node arrays in UnitCell are sorted by on-face coordinates.
- Cell iteration is row-major (i outer, k inner), matching `cellIndex` layout.
- Beams are emitted in cell order: beam `b` belongs to cell `floor(b / edgesPerCell)`.
- Beam indices within a node adjacency CSR row are not required to be sorted. Do not depend on ordering within a CSR row.

## Error Handling

The pipeline does not throw exceptions during normal operation. Invalid inputs are caught at the boundary:

- `createUnitCell(id)` returns null for unknown IDs.
- `LatticeGrid` construction validates `nx,ny,nz > 0` and `cellSize > 0`.
- `Domain.intersectSegment` returns null for no intersection (not an error).
- Derived property functions return NaN for degenerate inputs (zero porosity, zero radius).

Internal invariant violations (e.g., CSR pointer mismatch) are assertion failures during development, not user-facing errors. They indicate bugs in the pipeline, not bad user input.

## Thread Safety

The pipeline is single-threaded. All computation happens on the main thread or in a dedicated Web Worker. There is no shared mutable state between threads.

If population moves to a Web Worker:
- Input (UnitCell, LatticeGrid) is transferred as structured clones.
- Output (PopulationResult) is transferred back via `Transferable` (zero-copy for TypedArrays).
- The main thread constructs the BeamGraph from the transferred result.
- No concurrent access to the BeamGraph.

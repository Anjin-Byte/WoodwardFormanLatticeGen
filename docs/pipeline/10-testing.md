# Testing Strategy

## Principles

1. **Each pipeline stage is tested in isolation** with known inputs and expected outputs.
2. **Invariant validation functions** are reusable and composable — they're called in tests and optionally in debug builds at runtime.
3. **Reference cases** use small grids (1×1×1, 2×1×1, 2×2×2) with the cubic unit cell, where hand-computed expected values are feasible.
4. **Property-based checks** verify structural invariants (CSR consistency, flag constraints, array lengths) for larger random inputs without hand-computing exact values.
5. **No mocking of pipeline stages.** Each stage takes plain data structures; pass real data.

## Test Infrastructure

- **Framework:** Vitest (already configured in `@lattice/core`).
- **Location:** Tests live next to the code they test, in `packages/lattice-core/src/`.
- **Naming:** `*.test.ts` files.
- **Helpers:** A shared `validate.ts` module exports invariant checkers.

## Per-Stage Test Plan

### 1. Unit Cell (`unit-cell.test.ts`)

| Test | Input | Assertion |
|---|---|---|
| Catalog completeness | Each known cell ID | `createUnitCell` returns non-null |
| Node count | Cubic | 8 nodes |
| Edge count | Cubic | 12 edges |
| Node range | All cells | All coordinates in [0,1] |
| Edge range | All cells | All indices in [0, nodeCount) |
| Edge canonical | All cells | `a < b` for every edge |
| No duplicate edges | All cells | Set of (a,b) pairs has no repeats |
| No duplicate nodes | All cells | No two nodes within ε=1e-10 |
| Face node symmetry | All cells | `faceNodes['+x'].length === faceNodes['-x'].length` (and y, z) |
| Face node sorting | All cells | Face arrays sorted by on-face coords |
| Connectivity | All cells | Graph is connected (BFS/DFS from node 0 reaches all) |
| `validateUnitCell` | All cells | Returns empty violation list |

### 2. Grid (`grid.test.ts`)

| Test | Input | Assertion |
|---|---|---|
| Index roundtrip | Random (i,j,k) | `cellCoords(cellIndex(i,j,k)) === (i,j,k)` |
| Origin transform | Grid with offset origin | `localToWorld(0,0,0, 0,0,0) === origin` |
| Max corner | Any grid | `localToWorld(nx-1,ny-1,nz-1, 1,1,1) === gridMax` |
| Neighbor face alignment | 2×1×1 grid | Cell 0's +x face === Cell 1's -x face |
| Invalid grid | nx=0 | Throws or returns error |

### 3. Population (`population.test.ts`)

| Test | Input | Assertion |
|---|---|---|
| Single cell | Cubic, 1×1×1 | 8 nodes, 12 beams, positions match scaled unit cell |
| Two cells x-axis | Cubic, 2×1×1 | 12 nodes (4 shared), 24 beams |
| Two cells y-axis | Cubic, 1×2×1 | 12 nodes (4 shared), 24 beams |
| Two cells z-axis | Cubic, 1×1×2 | 12 nodes (4 shared), 24 beams |
| Full sharing | Cubic, 2×2×2 | Exact node count from sharing formula, 96 beams |
| No duplicate positions | Cubic, 3×3×3 | All positions unique within ε=1e-7 |
| Edge canonical | Any | All edges satisfy a < b |
| Beam ordering | Any | Beams `[0, edgesPerCell)` belong to cell 0, `[edgesPerCell, 2*edgesPerCell)` to cell 1, etc. |
| Position accuracy | Cubic, 1×1×1, cellSize=[2,3,4] | Node at local (1,1,1) → world (2,3,4) + origin |
| Determinism | Same input twice | Bitwise identical outputs |

### 4. Beam Graph Construction (`beam-graph.test.ts`)

| Test | Input | Assertion |
|---|---|---|
| Array lengths | Any PopulationResult | All length contracts from 09-invariants.md |
| Cell↔beam arithmetic | 3×3×3 | `cellOfBeam(b)` in [0,27), `beamsInCell(cellOfBeam(b))` contains b |
| beamCount = totalCells × edgesPerCell | Any | Exact equality |
| Node adjacency valid | Any | `nodeBeamPtr` monotonic, `nodeBeamPtr[last] === beamCount*2` |
| Node adjacency correct | Any | For each entry `nodeBeams[j]=b`, node n is an endpoint of beam b |
| No orphan nodes | Any | Every node in [0, nodeCount) appears in at least one edge |
| Flag initialization | Any | All nodeFlags === NODE_INTERIOR, all beamFlags === BEAM_INTERIOR |
| `validateBeamGraph` | Various sizes | Returns empty violation list |

### 5. Boundary (`boundary.test.ts`)

**DomainIndex (`domain-index.test.ts`)**

| Test | Input | Assertion |
|---|---|---|
| Empty mesh | No triangles | All rows empty, entryCount === 0 |
| Single triangle | One tri spanning 2 cells | Exactly those 2 cells have entries |
| CSR consistency | Any | `triPtr` monotonic, `triPtr[last] === entryCount`, all triIndices in range |
| Sparsity | Sphere mesh in 10³ grid | Most cells have zero entries, boundary shell cells have > 0 |

**Classification + Trimming (`boundary.test.ts`)**

| Test | Input | Assertion |
|---|---|---|
| Full containment | Box domain ⊃ grid | All cells INTERIOR, no flags changed |
| No containment | Box domain ∩ grid = ∅ | All cells EXTERIOR, all beams REMOVED |
| Half cut | Box domain = left half | Correct INTERIOR/BOUNDARY/EXTERIOR counts |
| Classification ↔ DomainIndex | Any | BOUNDARY cells have DomainIndex entries and vice versa |
| Trim both-inside | Beam fully inside | Not trimmed |
| Trim both-outside | Beam fully outside | REMOVED |
| Trim crossing | Beam with one end out | TRIMMED, override at intersection |
| Trim position accuracy | Known beam + box | Override position within ε of analytic intersection |
| Flag consistency | After classification | No beam has both INTERIOR and REMOVED |
| Flag consistency | After trimming | TRIMMED implies BOUNDARY |
| Sphere domain | Sphere at grid center | Boundary cells form a shell, interior count matches expectation |

### 6. Rendering (`rendering.test.ts`)

| Test | Input | Assertion |
|---|---|---|
| Visible count | Graph with 2 removed beams | count === beamCount - 2 |
| Transform identity | Beam along Y-axis | Rotation ≈ identity |
| Transform position | Beam from (0,0,0)→(2,0,0) | Midpoint at (1,0,0) |
| Transform scale | Beam length=3, radius=0.5 | Y-scale=3, X/Z-scale=0.5 |
| renderToBeam | Any | All referenced beams are not REMOVED |
| Zero-length beam | Degenerate | Skipped or handled without NaN |

### 7. Derived Properties (`derived-properties.test.ts`)

| Test | Input | Assertion |
|---|---|---|
| Porosity limits | radius → 0 | porosity → 1 |
| Porosity limits | radius → max | porosity → 0 |
| Tortuosity at ε_o=1 | limit | τ → 1 |
| Pressure drop at V=0 | Any lattice | ΔP = 0 |
| Pressure drop monotonic | Increasing V | ΔP strictly increasing |
| Pressure drop monotonic | Decreasing porosity | ΔP strictly increasing |
| Dimensionless consistency | Same inputs | Hg = A·Re + B·Re² matches dimensional ΔP |
| Inayat Table 1 crosscheck | Al foam 45 PPI, ε_o=0.978 | S_{v-geo} ≈ 4092 (within 5%) |

## Validation Functions

Reusable invariant checkers that return a list of violation strings (empty = valid):

```ts
function validateUnitCell(cell: UnitCell): string[];
function validateGrid(grid: LatticeGrid): string[];
function validatePopulationResult(pop: PopulationResult, cell: UnitCell, grid: LatticeGrid): string[];
function validateBeamGraph(graph: BeamGraph): string[];
function validateCellClassification(classification: CellClassification, graph: BeamGraph): string[];
function validateTrimResult(trim: TrimResult, graph: BeamGraph): string[];
```

These are tested themselves (a known-invalid input produces the expected violation message) and used as assertions in integration tests.

## Integration Test

One end-to-end test that runs the full pipeline:

```
1. Create cubic unit cell.
2. Create 4×4×4 grid.
3. Populate → PopulationResult.
4. Build BeamGraph.
5. Classify against a sphere domain centered in the grid.
6. Trim boundary beams.
7. Build render data.
8. Compute derived properties.
9. Run all validate* functions — all pass.
10. Verify: render count = beamCount - removed count.
11. Verify: porosity is in (0, 1).
12. Verify: pressure drop at V=1 m/s, air at STP, is > 0.
```

## Performance Benchmark (not a test, but tracked)

```
Benchmark: populate cubic 50×50×50 grid
  Expected: < 500ms (TS), < 50ms (WASM)
  Metric: wall-clock time

Benchmark: build BeamGraph from 50×50×50 population
  Expected: < 200ms
  Metric: wall-clock time

Benchmark: build render data for 1M beams
  Expected: < 100ms
  Metric: wall-clock time
```

Run benchmarks in CI with `vitest bench` or a custom harness. Track regressions.

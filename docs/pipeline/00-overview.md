# Lattice Generation Pipeline

## Pipeline Stages

```
┌─────────────┐    ┌──────────┐    ┌────────────┐    ┌─────────────┐
│  UnitCell    │───►│   Grid   │───►│ Population │───►│  BeamGraph  │
│  (topology)  │    │ (spatial) │    │ (assembly)  │    │  (global)   │
└─────────────┘    └──────────┘    └────────────┘    └──────┬──────┘
                                                           │
                                        ┌──────────────────┼──────────────────┐
                                        ▼                  ▼                  ▼
                  ┌──────────────┐
                  │ Domain Mesh  │
                  └──────┬───────┘
                         ▼
                  ┌──────────────┐    ┌──────────────┐   ┌────────────┐
                  │ DomainIndex  │    │  Rendering   │   │  Derived   │
                  │ (sparse CSR) │    │  (Three.js)  │   │  Properties│
                  └──────┬───────┘    │  instanced   │   │  (physics) │
                         ▼            └──────────────┘   └────────────┘
                  ┌───────────┐
                  │ Boundary   │
                  │ classify   │
                  │ + trim     │
                  └─────┬─────┘
                                        │
                                        ▼
                                  ┌───────────┐
                                  │  Export    │
                                  │  (mesh)   │
                                  └───────────┘
```

## Data Flow Summary

| Stage | Input | Output | Where It Runs |
|---|---|---|---|
| UnitCell | JSON or hardcoded catalog | `UnitCell` | TS (pure data) |
| Grid | User params (nx,ny,nz, cellSize) | `LatticeGrid` | TS (pure data) |
| Population | UnitCell + Grid | `BeamGraph` | Rust/WASM or TS fallback |
| Domain Indexing | Grid + Domain Mesh | `DomainIndex` (sparse CSR: cell → triangles) | TS or WASM |
| Boundary Classification | BeamGraph + DomainIndex + Domain | `CellClassification` + flag updates | TS |
| Trimming | BeamGraph + Domain | `TrimResult` (position overlay + removals) | TS |
| Rendering | BeamGraph | Three.js InstancedMesh | TS (main thread) |
| Derived Properties | BeamGraph + Grid + UnitCell | `LatticeProperties` | TS (pure math) |
| Export | BeamGraph + strut radii | Triangle mesh (STL/3MF) | WASM (offline) |

## Ownership Rules

- The `BeamGraph` is the single source of truth for the lattice state.
- Rendering reads the BeamGraph but never mutates it.
- Boundary work is the only stage that mutates a BeamGraph after population.
- Export produces a new artifact (mesh); it does not modify the BeamGraph.
- Derived properties are computed on demand from the BeamGraph, never cached as state.

## Files in This Directory

- [01-unit-cell.md](01-unit-cell.md) — Unit cell topology definition and catalog
- [02-grid.md](02-grid.md) — Spatial grid mapping
- [03-population.md](03-population.md) — Assembly algorithm and node deduplication
- [04-beam-graph.md](04-beam-graph.md) — Core data structure, CSR indices, invariants
- [05-boundary.md](05-boundary.md) — Classification, trimming, skin generation
- [06-rendering.md](06-rendering.md) — Three.js instanced rendering from BeamGraph
- [07-derived-properties.md](07-derived-properties.md) — Porosity, pressure drop, tortuosity
- [08-export.md](08-export.md) — Mesh finalization for printing
- [09-invariants.md](09-invariants.md) — Global invariants across the pipeline
- [10-testing.md](10-testing.md) — Test strategy per stage

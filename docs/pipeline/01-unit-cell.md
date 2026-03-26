# Stage 1: Unit Cell Definition

## Purpose

A unit cell is the atomic repeating element of a lattice. It defines a topology — nodes connected by edges — in a normalized local coordinate space. It carries no world position, no strut radius, no material. Those are applied later by the grid and beam graph.

## Data Structure

```ts
interface UnitCell {
  /** Unique identifier: "cubic", "kelvin", "bccxy", "rd", "wp", etc. */
  id: string;

  /** Node positions in [0,1]³ local coordinates.
   *  Flat packed: [x0,y0,z0, x1,y1,z1, ...].
   *  Length = nodeCount * 3. */
  nodes: Float64Array;

  /** Edge pairs as node indices.
   *  Flat packed: [a0,b0, a1,b1, ...].
   *  Length = edgeCount * 2.
   *  Invariant: a < b for every pair (canonical ordering). */
  edges: Uint32Array;

  /** Node count (nodes.length / 3). */
  nodeCount: number;

  /** Edge count (edges.length / 2). */
  edgeCount: number;

  /** For each face of the unit cube, which node indices sit on that face.
   *  Used during population to identify shared nodes between adjacent cells.
   *  A node is "on" a face if its coordinate along the face's axis equals 0 or 1
   *  (within tolerance). */
  faceNodes: {
    '+x': Uint32Array;  // nodes where x ≈ 1
    '-x': Uint32Array;  // nodes where x ≈ 0
    '+y': Uint32Array;  // nodes where y ≈ 1
    '-y': Uint32Array;  // nodes where y ≈ 0
    '+z': Uint32Array;  // nodes where z ≈ 1
    '-z': Uint32Array;  // nodes where z ≈ 0
  };
}

type Face = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
```

## Face Node Matching

When cell (i,j,k) is placed next to cell (i+1,j,k), the +x face of the first cell coincides with the -x face of the second. Nodes on these faces must merge into single global nodes during population.

**Matching rule:** The +x face nodes of cell A match the -x face nodes of cell B if, after transforming both to world coordinates, they occupy the same position. In practice, since all cells use the same unit cell definition and uniform grid spacing, matching reduces to: for each node on A's +x face, find the node on B's -x face with the same (y,z) local coordinates.

**Face node pairing:** `faceNodes` arrays must be ordered so that index-for-index, the +x array of one cell corresponds to the -x array of its +x neighbor. This means the face node arrays are pre-sorted by their coordinates on the face plane.

Sort order for face pairs:
- `+x` / `-x`: sort by (y, z)
- `+y` / `-y`: sort by (x, z)
- `+z` / `-z`: sort by (x, y)

This makes deduplication O(1) per shared node during population — no searching required.

## Invariants

1. All node coordinates are in [0,1]³.
2. No duplicate nodes (within floating-point tolerance ε = 1e-10).
3. No self-loop edges (a ≠ b for every edge).
4. No duplicate edges.
5. Edges are canonically ordered: a < b.
6. Face node arrays are sorted by their on-face coordinates.
7. Opposing face pairs have equal length: `faceNodes['+x'].length === faceNodes['-x'].length`.
8. `nodeCount === nodes.length / 3`.
9. `edgeCount === edges.length / 2`.
10. Every edge index is in [0, nodeCount).

## Unit Cell Catalog

From Woodward & Fromen, the supported topologies:

| ID | Nodes | Edges | Description |
|---|---|---|---|
| `cubic` | 8 | 12 | Simple cubic — nodes at cube corners, edges along cube edges |
| `kelvin` | 24 | 36 | Truncated octahedron — the Kelvin cell, recommended by Inayat et al. for foam modeling |
| `bccxy` | 9 | 20 | Body-centered cubic with XY connections |
| `rd` | 14 | 24 | Rhombic dodecahedron |
| `wp` | 24 | 36 | Weaire-Phelan — space-filling with two cell types (simplified to single repeating unit) |

## Construction

Unit cells are built by a factory function, not parsed at runtime:

```ts
function createUnitCell(id: string): UnitCell
```

Each cell type is a pure function that returns the hardcoded node positions and edge connectivity, with `faceNodes` computed from the node positions by filtering on axis-aligned coordinates.

```ts
function computeFaceNodes(nodes: Float64Array, nodeCount: number): UnitCell['faceNodes']
```

This is derived, not hand-authored — it scans all nodes and bins them by which faces they touch. A node can appear on multiple faces (e.g., corner nodes appear on three faces).

## Testing

- **Invariant checks:** A `validateUnitCell(cell: UnitCell): string[]` function that returns a list of violations. Run against every catalog entry.
- **Symmetry:** For cubic, verify 8 nodes, 12 edges. For kelvin, verify 24/36. Etc.
- **Face pairing:** For each face pair (+x/-x, +y/-y, +z/-z), verify that the arrays have equal length and that corresponding entries share the same on-face coordinates.
- **Roundtrip:** Transform nodes to world coords and back; verify identity within tolerance.
- **Coverage:** Every node is reachable from every other node via edges (the cell graph is connected).

# Stage 8: Export (Mesh Finalization)

## Purpose

Convert the analytic BeamGraph into a printable triangle mesh for additive manufacturing. This is an offline operation — not interactive, not part of the render loop. The output is an indexed triangle mesh suitable for STL or 3MF export.

## Scope

Export is intentionally deferred in the initial implementation. This document specifies the design for when it's built.

## Pipeline

```
BeamGraph + TrimResult
   │
   ├──► Per-beam: generate cylinder mesh at strut radius
   ├──► Per-node: generate joint geometry (sphere hull or convex blend)
   ├──► Combine into single indexed mesh
   ├──► (Optional) Boolean union for watertight output
   └──► Write STL / 3MF
```

## Per-Beam Cylinder Mesh

For each visible beam (not REMOVED):

```
Input:  p0, p1 (endpoints), radius, angular resolution (N segments)
Output: 2N vertices (N per cap), 2N triangles (N quad sides = 2N tris + 2×N cap tris)

Total triangles per beam = 4N (2N side + N top cap + N bottom cap)
For N=8: 32 triangles per beam.
For 1M beams: 32M triangles.
```

This is a strong candidate for WASM — the vertex generation is a tight loop of sin/cos + matrix transforms.

## Per-Node Joint Geometry

At each node where multiple beams meet, the cylinder ends overlap. Options:

1. **Sphere:** Place a sphere of radius = max adjacent beam radius. Simple, fast.
2. **Convex hull:** Compute the convex hull of all cylinder cap vertices at the node. More precise but expensive.
3. **Nothing:** Accept the visual artifacts from overlapping cylinders. Fine for export to tools that do their own boolean cleanup.

Start with sphere joints.

## Boolean Union (Optional)

Some export formats (STL for certain slicers) require a single watertight manifold mesh. Boolean union merges all overlapping cylinders and spheres into one surface.

This is extremely expensive for large lattices. Options:
- **Skip it:** Export non-manifold mesh. Most modern slicers handle this.
- **Implicit surface approach:** Convert beams to an SDF (signed distance field), then extract the isosurface with marching cubes. This naturally produces a watertight mesh. This is what Woodward & Fromen do via Dendro.
- **Per-cell union:** Union within each cell, then stitch. Exploits the grid structure.

## Output Format

```ts
interface ExportMesh {
  /** Vertex positions. Flat packed [x,y,z, ...]. */
  positions: Float32Array;
  /** Triangle indices. Flat packed [a,b,c, ...]. */
  indices: Uint32Array;
  /** Vertex count. */
  vertexCount: number;
  /** Triangle count. */
  triangleCount: number;
}
```

### STL Export

STL is per-triangle normals + vertices, no indexing:

```ts
function exportSTL(mesh: ExportMesh): ArrayBuffer {
  // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes per triangle
  const size = 80 + 4 + mesh.triangleCount * 50;
  const buffer = new ArrayBuffer(size);
  // ... write header, count, then per-triangle: normal (3×f32) + 3 vertices (9×f32) + attribute (u16)
  return buffer;
}
```

### 3MF Export

3MF is XML + binary mesh data in a ZIP container. More complex but supports color, materials, and multi-object. Defer to a library or implement minimal spec.

## Memory and Performance

For 1M beams at N=8 cylinder segments:
- Vertices: 1M × 16 = 16M vertices × 12 bytes = 192 MB
- Triangles: 1M × 32 = 32M triangles × 12 bytes = 384 MB
- Total mesh: ~576 MB

This is large. Mitigation:
- Stream to disk rather than holding in memory.
- Use lower angular resolution (N=6) for smaller prints.
- Chunk by grid region.

## Testing

- **Single beam:** Export one cylinder, verify vertex positions are on the cylinder surface within tolerance.
- **Two connected beams:** Verify vertices are generated for both; sphere joint at shared node.
- **STL validity:** Exported STL has correct byte count. Triangle normals face outward.
- **Roundtrip:** Export → import (via a parser) → verify vertex count and bounding box match expectations.

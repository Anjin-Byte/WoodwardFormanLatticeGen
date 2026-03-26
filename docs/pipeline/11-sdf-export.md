# SDF Export Pipeline: Lattice → Marching Cubes → STL

## Overview

Convert the analytic lattice (BeamGraph) into a watertight triangle mesh via signed distance field evaluation and marching cubes isosurface extraction. This is the same fundamental approach used by Woodward & Fromen's Dendro plugin.

```
BeamGraph + Domain
    │
    ▼
Lattice SDF Function
  (point → distance to nearest beam surface)
    │
    ▼
Marching Cubes Grid
  (evaluate SDF at each grid vertex)
    │
    ▼
Isosurface Extraction
  (triangulate where SDF = 0)
    │
    ▼
Domain Intersection (optional)
  (clip to domain boundary)
    │
    ▼
STL Binary Export
```

---

## Stage 1: Lattice SDF Function

### Core Primitive — Capped Cylinder SDF

For a beam from point `a` to point `b` with radius `r`, the signed distance from any point `p` is:

```
sdCappedCylinder(p, a, b, r):
  ba = b - a
  pa = p - a
  baba = dot(ba, ba)        // squared length of beam axis
  paba = dot(pa, ba)        // projection of pa onto beam axis

  // Distance to infinite cylinder (perpendicular to axis)
  x = length(pa * baba - ba * paba) - r * baba

  // Distance to end caps (along axis)
  y = abs(paba - baba * 0.5) - baba * 0.5

  x2 = x * x
  y2 = y * y * baba

  d = (max(x, y) < 0.0)
    ? -min(x2, y2)                             // inside: negative
    : ((x > 0 ? x2 : 0) + (y > 0 ? y2 : 0))  // outside: positive

  return sign(d) * sqrt(abs(d)) / baba
```

This returns:
- Negative values inside the cylinder
- Zero on the surface
- Positive values outside

Cost: ~15 multiplies, 2 sqrts per evaluation. O(1) per beam.

### Smooth Union — Joint Blending

At lattice nodes where multiple beams meet, a hard `min()` union produces sharp creases. Smooth min (`smin`) blends them with a fillet of radius `k`:

```
smin(a, b, k):
  k *= 4.0
  h = max(k - abs(a - b), 0.0)
  return min(a, b) - h * h * 0.25 / k
```

The parameter `k` controls fillet radius in world units. For lattice beams:
- `k = 0` → hard union (sharp edges at joints)
- `k = r * 0.5` → small fillet (subtle rounding)
- `k = r * 1.0` → smooth organic joints

### Spatial Acceleration — Beam Lookup

Evaluating all N beams for every SDF query point is O(N). With spatial indexing it's O(k) where k = nearby beams.

**Data structure: uniform grid hash** (separate from the lattice grid).

```
SdfAccel:
  cellSize: number                  // typically 2-3× beam length
  cells: Map<int, Uint32Array>      // hash(ix,iy,iz) → beam indices
```

**Build:**
For each beam, compute its AABB (expanded by radius + smin_k), hash the overlapping grid cells, insert beam index.

**Query:**
For point p, compute grid cell, gather beam indices from that cell + 26 neighbors (3×3×3 neighborhood), evaluate SDF for each, return smooth min.

**Why not reuse BeamGraph's CSR?** The lattice grid cells are too fine — each contains exactly `edgesPerCell` beams and the MC grid resolution is different from the lattice resolution. A separate coarse spatial hash tuned for the MC grid is more efficient.

### Composite SDF Function

```
latticeSdf(p, accel, beams, radii, smin_k):
  nearbyBeams = accel.query(p)
  d = +Infinity
  for each beam b in nearbyBeams:
    p0 = beams.positions[b.n0]
    p1 = beams.positions[b.n1]
    r  = beams.radii[b]
    bd = sdCappedCylinder(p, p0, p1, r)
    d = smin(d, bd, smin_k)
  return d
```

### Domain Clipping (Optional)

If a domain is active, intersect the lattice SDF with the domain SDF:

```
domainSdf(p, domain):
  // For mesh domains: negative inside, positive outside
  // Use BVH raycast parity or precomputed SDF grid
  return domain.contains(p) ? -distance_to_surface : +distance_to_surface

exportSdf(p) = max(latticeSdf(p), -domainSdf(p))
```

This clips the lattice to the domain interior. The `max` operation is CSG intersection.

For analytic domains (sphere, box), the domain SDF is trivial:
```
sdSphere(p, center, r) = length(p - center) - r
sdBox(p, min, max) = length(max(abs(p - center) - halfSize, 0))
```

---

## Stage 2: Marching Cubes Grid

### Grid Specification

```
McGrid:
  origin: [number, number, number]    // min corner in world space
  dims: [number, number, number]      // vertex count per axis (cells = dims - 1)
  step: number                        // distance between adjacent vertices
```

**Sizing from lattice AABB:**
```
// Expand lattice AABB by max beam radius + smin_k for margin
margin = maxRadius + smin_k
mcMin = latticeAABB.min - margin
mcMax = latticeAABB.max + margin

// Resolution: user-specified or derived from lattice cell size
// Typical: mcStep = latticeGrid.cellSize * 0.25 (4× finer than lattice cells)
mcStep = user_specified or latticeGrid.cellSize / 4
dims = ceil((mcMax - mcMin) / mcStep) + 1
```

**Memory budget:**
Each MC vertex stores one f32 SDF value. For a 200³ grid: 200³ × 4 bytes = 32 MB. This is the dominant memory cost.

### SDF Evaluation

```
sdfValues: Float32Array  // length = dims[0] * dims[1] * dims[2]

for z in 0..dims[2]:
  for y in 0..dims[1]:
    for x in 0..dims[0]:
      px = origin[0] + x * step
      py = origin[1] + y * step
      pz = origin[2] + z * step
      sdfValues[x + dims[0] * (y + dims[1] * z)] = latticeSdf([px, py, pz], accel, ...)
```

This is the most expensive step. For a 200³ grid with ~10K beams and ~5 nearby beams per query point: 8M points × 5 SDF evals = 40M cylinder SDF evaluations. At ~15 FLOPs each: ~600M FLOPs.

**In WASM:** ~0.5–2 seconds (single-threaded).
**On GPU (compute shader):** ~10–50ms.

### Parallelization

The SDF evaluation loop is embarrassingly parallel:
- Each grid point is independent
- No shared mutable state
- Perfect for WASM threads (SharedArrayBuffer + Atomics) or GPU compute

For the Rust/WASM path:
```rust
// Rayon parallel iteration (requires wasm-bindgen-rayon for WASM threads)
sdf_values.par_chunks_mut(dims[0])
    .enumerate()
    .for_each(|(yz, row)| {
        let y = yz % dims[1];
        let z = yz / dims[1];
        for x in 0..dims[0] {
            let p = origin + Vec3::new(x as f32, y as f32, z as f32) * step;
            row[x] = lattice_sdf(p, &accel, &beams, &radii, smin_k);
        }
    });
```

---

## Stage 3: Marching Cubes Isosurface Extraction

### Algorithm

For each cube in the MC grid (8 vertices):
1. Look up the 8 SDF values
2. Build a case index: bit i = 1 if vertex i is inside (SDF < 0)
3. Look up the edge table for this case → which of the 12 cube edges have a zero crossing
4. For each crossing edge, interpolate the vertex position: `p = lerp(v0, v1, sdf0 / (sdf0 - sdf1))`
5. Look up the triangle table for this case → which edges form triangles
6. Emit triangles

### Data Structures

```
MC_EDGE_TABLE: Uint16Array[256]        // 256 cases → 12-bit edge mask
MC_TRI_TABLE: Int8Array[256 * 16]      // 256 cases → up to 5 triangles (15 edge indices + -1 terminator)
```

These are static lookup tables (~5 KB total). Well-documented, available in every MC implementation.

### Output

```
McOutput:
  positions: Float32Array    // [x,y,z, ...] — interpolated vertex positions
  indices: Uint32Array       // [a,b,c, ...] — triangle vertex indices
  vertexCount: number
  triangleCount: number
```

### Vertex Welding

Adjacent MC cells share edges. Without welding, each cell emits its own vertices and the output has duplicate vertices along shared edges. For STL export this is fine (STL is per-triangle, no indexing). For further processing, welding via position hashing produces a clean indexed mesh.

---

## Stage 4: STL Binary Export

### Format

```
Header:    80 bytes (ASCII text, usually blank)
Count:     4 bytes (uint32 LE, number of triangles)
Triangles: 50 bytes each:
  Normal:  12 bytes (3 × float32 LE)
  V0:      12 bytes (3 × float32 LE)
  V1:      12 bytes (3 × float32 LE)
  V2:      12 bytes (3 × float32 LE)
  Attr:    2 bytes (uint16, usually 0)
```

Total size: `80 + 4 + triangleCount × 50` bytes.

For a lattice with 50K output triangles: ~2.5 MB STL file.

### Implementation

```
function exportSTL(positions: Float32Array, indices: Uint32Array, triCount: number): ArrayBuffer {
  const size = 80 + 4 + triCount * 50;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  // Header (80 bytes of zeros)
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    const i0 = indices[t * 3], i1 = indices[t * 3 + 1], i2 = indices[t * 3 + 2];

    // Vertices
    const v0 = [positions[i0*3], positions[i0*3+1], positions[i0*3+2]];
    const v1 = [positions[i1*3], positions[i1*3+1], positions[i1*3+2]];
    const v2 = [positions[i2*3], positions[i2*3+1], positions[i2*3+2]];

    // Face normal = normalize(cross(v1-v0, v2-v0))
    const e1 = [v1[0]-v0[0], v1[1]-v0[1], v1[2]-v0[2]];
    const e2 = [v2[0]-v0[0], v2[1]-v0[1], v2[2]-v0[2]];
    const nx = e1[1]*e2[2] - e1[2]*e2[1];
    const ny = e1[2]*e2[0] - e1[0]*e2[2];
    const nz = e1[0]*e2[1] - e1[1]*e2[0];
    const nl = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;

    view.setFloat32(offset, nx/nl, true); offset += 4;
    view.setFloat32(offset, ny/nl, true); offset += 4;
    view.setFloat32(offset, nz/nl, true); offset += 4;

    for (const v of [v0, v1, v2]) {
      view.setFloat32(offset, v[0], true); offset += 4;
      view.setFloat32(offset, v[1], true); offset += 4;
      view.setFloat32(offset, v[2], true); offset += 4;
    }

    offset += 2; // attribute byte count (0)
  }

  return buffer;
}
```

---

## Data Structures Summary

| Structure | Type | Purpose | Size (typical) |
|---|---|---|---|
| `SdfAccel` | uniform grid hash | Beam spatial lookup for SDF queries | ~50 KB |
| `sdfValues` | `Float32Array` | SDF evaluated at every MC grid vertex | 32 MB (200³) |
| `MC_EDGE_TABLE` | `Uint16Array[256]` | MC case → edge mask | 512 bytes |
| `MC_TRI_TABLE` | `Int8Array[4096]` | MC case → triangle edges | 4 KB |
| `McOutput.positions` | `Float32Array` | Output mesh vertex positions | ~2 MB (50K verts) |
| `McOutput.indices` | `Uint32Array` | Output mesh triangle indices | ~600 KB (50K tris) |

---

## Parameters

| Parameter | Default | Range | Effect |
|---|---|---|---|
| `mcStep` | `cellSize / 4` | `cellSize/8` to `cellSize` | MC grid resolution. Smaller = finer mesh, more SDF evals |
| `smin_k` | `r * 0.5` | `0` to `r * 2` | Joint fillet radius. 0 = sharp, larger = smoother |
| `accelCellSize` | `cellSize * 2` | `cellSize` to `cellSize * 4` | Spatial hash cell size for SDF queries |

---

## Implementation Plan

### Files to Create

| File | Location | Purpose |
|---|---|---|
| `sdf.ts` | `packages/lattice-core/src/` | `sdCappedCylinder`, `smin`, `latticeSdf`, `SdfAccel` build + query |
| `marching-cubes.ts` | `packages/lattice-core/src/` | MC tables, `marchingCubes(sdfValues, dims, step, origin)` → positions + indices |
| `export-stl.ts` | `packages/lattice-core/src/` | `exportSTL(positions, indices)` → `ArrayBuffer`, browser download trigger |
| `export-pipeline.ts` | `packages/lattice-core/src/` | Orchestrator: `exportLattice(graph, domain?, options)` → runs SDF eval + MC + STL |
| `sdf.test.ts` | `packages/lattice-core/src/` | Cylinder SDF correctness, smin properties, spatial accel query correctness |
| `marching-cubes.test.ts` | `packages/lattice-core/src/` | Sphere SDF → MC → verify watertight, correct vertex count range |
| `export-stl.test.ts` | `packages/lattice-core/src/` | STL binary format correctness, byte count |

### Future: Rust/WASM Acceleration

The SDF evaluation loop is the bottleneck. Port `latticeSdf` + `marchingCubes` to Rust in `crates/lattice-wasm/src/`:
- `sdf_eval(accel, beams, radii, smin_k, grid) → Float32Array`
- `marching_cubes(sdf_values, dims, step, origin) → (positions, indices)`

Both are tight loops with no JS interop needed — pure compute on typed arrays. Expected 10-50× speedup over JS.

### Future: GPU Compute

The SDF eval is embarrassingly parallel. A WGSL compute shader evaluates one grid point per thread:
```wgsl
@compute @workgroup_size(64)
fn eval_sdf(@builtin(global_invocation_id) id: vec3<u32>) {
    let p = origin + vec3<f32>(id) * step;
    var d = 1e10;
    for (var i = accel_start; i < accel_end; i++) {
        d = smin(d, sd_capped_cylinder(p, beams[i].p0, beams[i].p1, beams[i].r), k);
    }
    sdf_grid[id.x + dims.x * (id.y + dims.x * id.z)] = d;
}
```

This reuses the wgpu infrastructure already compiled into lattice-wasm.

---

## Invariants

1. MC output is guaranteed watertight if the SDF is continuous (cylinder SDF + smin are both continuous).
2. SDF values at MC grid boundary should be positive (outside) — ensure margin is sufficient.
3. Every MC output triangle has outward-facing normal (by convention of the MC table winding).
4. STL file size = 80 + 4 + triangleCount × 50 bytes exactly.
5. `smin(a, b, 0) = min(a, b)` — zero fillet reduces to hard union.
6. `sdCappedCylinder` returns exact Euclidean distance (not approximate).

---

## Testing Strategy

| Test | Input | Assertion |
|---|---|---|
| Cylinder SDF sign | Point inside cylinder | SDF < 0 |
| Cylinder SDF sign | Point outside cylinder | SDF > 0 |
| Cylinder SDF surface | Point on cylinder surface | SDF ≈ 0 (within ε) |
| Cylinder SDF distance | Point at known distance | SDF ≈ expected distance |
| smin identity | `smin(a, b, 0) = min(a, b)` | Exact equality |
| smin symmetry | `smin(a, b, k) = smin(b, a, k)` | Exact equality |
| smin smoothness | `smin(0.1, -0.1, 0.5)` | Between min and max, smooth |
| Spatial accel | Query near beam | Returns that beam's index |
| Spatial accel | Query far from all beams | Returns empty |
| MC sphere | Sphere SDF, 32³ grid | Output has >0 triangles, all vertices ≈ radius from center |
| MC watertight | Any closed SDF | Euler characteristic χ = 2 (or check: every edge shared by exactly 2 triangles) |
| STL format | Known mesh | File size = 80 + 4 + N×50, parseable |
| Roundtrip | Export STL → parse STL | Triangle count matches, vertex positions within ε |
| Lattice export | 2×2×2 cubic lattice | Output mesh is watertight, vertices near beam surfaces |

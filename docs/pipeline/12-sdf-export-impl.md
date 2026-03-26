# SDF Export Pipeline — Implementation Reference

Technical specification of the SDF → Marching Cubes → STL export pipeline as implemented in `packages/lattice-core/src/`. Covers data structures, algorithms, performance characteristics, and GPU acceleration paths.

---

## Architecture

```
BeamGraph + TrimResult + SkinGraph
    │
    ▼
buildSdfAccel()          ← Flatten beams, build spatial hash
    │
    ▼
latticeSdf()             ← Evaluate at every MC grid vertex (bottleneck)
    │
    ▼
marchingCubes()          ← Extract isosurface triangles
    │
    ▼
exportSTL()              ← Serialize to binary STL
```

Four source files, each a pure function with no shared state:

| File | Purpose | Hot path? |
|------|---------|-----------|
| `sdf.ts` | Cylinder SDF, smooth min, spatial acceleration | Yes — SDF eval is O(dims³ × k) |
| `marching-cubes.ts` | MC lookup tables, isosurface extraction | Moderate — O(dims³) |
| `export-stl.ts` | Binary STL serialization | No — O(triangles) |
| `export-pipeline.ts` | Orchestrator, async yield, timing | No — glue |

---

## 1. Signed Distance Functions (`sdf.ts`)

### 1.1 Capped Cylinder SDF

Inigo Quilez's exact signed distance to a capped cylinder from `a` to `b` with radius `r`. All scalar arguments — no object allocation in the hot loop.

```
sdCappedCylinder(p, a, b, r):
  ba = b - a
  pa = p - a
  baba = dot(ba, ba)                              // squared axis length
  paba = dot(pa, ba)                              // projection onto axis

  // Perpendicular distance to infinite cylinder
  d = pa * baba - ba * paba
  x = length(d) - r * baba

  // Axial distance to caps
  y = |paba - baba/2| - baba/2

  x² = x²
  y² = y² * baba

  // Sign logic:
  //   x > 0 && y > 0 → outside both (barrel + cap)  → d = x² + y²
  //   x > 0 only     → outside barrel                → d = x²
  //   y > 0 only     → outside cap                   → d = y²
  //   both ≤ 0       → inside                        → d = -min(x², y²)

  return sign(d) * sqrt(|d|) / baba
```

**Cost**: ~15 multiplies, 1 sqrt, 1 abs per evaluation. O(1) per beam.

**Returns**: negative inside, zero on surface, positive outside. Exact Euclidean distance.

**Degenerate case**: zero-length beams (`baba = 0`) produce NaN via division by zero. Callers must exclude zero-length beams — the pipeline guarantees this since `buildBeamGraph` requires `edgeCount > 0` with distinct endpoints.

### 1.2 Smooth Min (smin)

Polynomial smooth minimum for joint blending at lattice nodes where multiple beams meet:

```
smin(a, b, k):
  if k ≤ 0: return min(a, b)
  k4 = k × 4
  h = max(k4 - |a - b|, 0)
  return min(a, b) - h² × 0.25 / k4
```

**Properties**:
- `smin(a, b, 0) = min(a, b)` — identity (sharp joints)
- `smin(a, b, k) = smin(b, a, k)` — symmetric
- `smin(a, b, k) ≤ min(a, b)` for k > 0 — always blends inward
- C¹ continuous — no derivative discontinuities in the SDF field

**Parameter `k`**: fillet radius in world units. Controlled by `filletK × absoluteRadius` where `filletK` is the dimensionless user parameter (default 0.5).

### 1.3 Spatial Acceleration

**Problem**: evaluating all N beams for every SDF query is O(N). With spatial indexing, it's O(k) where k = nearby beams.

**Structure**:

```typescript
SdfAccel {
  cellSize: number          // uniform grid cell size
  invCellSize: number       // 1 / cellSize (precomputed)
  originX, originY, originZ // grid origin (min corner - 1 cell)
  cells: Map<number, Uint32Array>  // hash → beam indices
  beamP0: Float32Array      // [x,y,z,...] per beam (flattened)
  beamP1: Float32Array      // [x,y,z,...] per beam (flattened)
  beamR: Float32Array       // radius per beam
  beamCount: number
}
```

**Spatial hash function**:

```
hash(ix, iy, iz) = (ix × 73856093) ^ (iy × 19349663) ^ (iz × 83492791)
```

Standard hash primes. Result truncated to int32 via `| 0`. Hash collisions are acceptable — they add false positives to beam queries but never miss a beam (conservative).

**Build (`buildSdfAccel`)**:

1. **Collect beams**: iterate `BeamGraph.beamFlags`, skip `BEAM_REMOVED`. Append `SkinGraph` beams. Use `getEffectivePosition()` to respect trimmed endpoints.
2. **Flatten**: pack endpoints into contiguous `Float32Array` buffers (cache-friendly for SDF eval).
3. **Cell sizing**: compute beam lengths, sort, take median. `cellSize = max(medianLength × 2, 1e-6)`. The 2× factor ensures most beams span 1-2 hash cells.
4. **Origin**: expand global AABB of all beams by `radius + sminK` per side, then subtract one cell.
5. **Insertion**: for each beam, compute AABB expanded by `radius + sminK`, convert to grid cell range, insert beam index into every overlapping cell.
6. **Finalize**: convert `number[]` lists to `Uint32Array` for memory compactness.

**Query (`latticeSdf`)**:

```
latticeSdf(px, py, pz, accel, sminK):
  ix = floor((px - originX) × invCellSize)
  iy = floor((py - originY) × invCellSize)
  iz = floor((pz - originZ) × invCellSize)

  d = +∞
  for dx in [-1, 0, +1]:
    for dy in [-1, 0, +1]:
      for dz in [-1, 0, +1]:
        beams = accel.cells[hash(ix+dx, iy+dy, iz+dz)]
        for each beam bi in beams:
          bd = sdCappedCylinder(p, beamP0[bi], beamP1[bi], beamR[bi])
          d = smin(d, bd, sminK)
  return d
```

3×3×3 = 27 cells queried per point. This over-fetches compared to single-cell lookup but avoids missing beams whose AABB straddles cell boundaries.

---

## 2. Marching Cubes (`marching-cubes.ts`)

### 2.1 Lookup Tables

Two static tables encode the 256 possible configurations of a cube with 8 signed corners:

| Table | Type | Size | Purpose |
|-------|------|------|---------|
| `MC_EDGE_TABLE` | `Uint16Array[256]` | 512 B | Case → 12-bit edge crossing mask |
| `MC_TRI_TABLE` | `Int8Array[4096]` | 4 KB | Case → up to 5 triangles (15 edge indices + -1 terminators) |

Source: Paul Bourke's canonical reference tables.

### 2.2 Cube Geometry

**8 vertices** (unit cube offsets):

```
0: (0,0,0)  1: (1,0,0)  2: (1,1,0)  3: (0,1,0)
4: (0,0,1)  5: (1,0,1)  6: (1,1,1)  7: (0,1,1)
```

**12 edges** (vertex pairs):

```
Bottom: [0,1] [1,2] [2,3] [3,0]
Top:    [4,5] [5,6] [6,7] [7,4]
Sides:  [0,4] [1,5] [2,6] [3,7]
```

### 2.3 Algorithm

For each cube in the grid (dims - 1 per axis):

1. **Case index**: read 8 SDF values from grid corners. If value < 0, set corresponding bit → 8-bit case index (0-255).

2. **Edge mask**: `MC_EDGE_TABLE[caseIndex]` → 12-bit mask of which edges have a zero crossing.

3. **Vertex interpolation**: for each active edge, linear interpolation between the two corner positions weighted by their SDF values:
   ```
   t = sdf0 / (sdf0 - sdf1)
   position = origin + lerp(corner0, corner1, t) × step
   ```

4. **Triangle emission**: `MC_TRI_TABLE[caseIndex × 16 .. +15]` → groups of 3 edge indices forming triangles, terminated by -1. Each triangle gets 3 new vertices (no welding).

### 2.4 Memory Layout

SDF grid indexing: `sdfValues[x + dims[0] × (y + dims[1] × z)]` — x-minor order, consistent with the evaluation loop.

**Output**: non-welded mesh — each triangle has its own 3 vertices. This is optimal for STL (which stores per-triangle data) and avoids a hash table in the MC hot loop.

**Pre-allocation**: worst case 5 triangles × 3 vertices per cube. Output arrays are `subarray`'d to actual size after extraction. No reallocation.

---

## 3. Binary STL Export (`export-stl.ts`)

### 3.1 Format

```
Offset  Bytes  Field
──────  ─────  ─────────────────────────
0       80     Header (ASCII, "Exported by LatticeGen")
80      4      Triangle count (uint32 LE)
84      50×N   Triangles
```

**Per triangle (50 bytes)**:

```
Offset  Bytes  Field
──────  ─────  ─────────────────────
0       12     Face normal (3 × f32 LE)
12      12     Vertex 0 (3 × f32 LE)
24      12     Vertex 1 (3 × f32 LE)
36      12     Vertex 2 (3 × f32 LE)
48      2      Attribute byte count (u16, always 0)
```

**Total**: `80 + 4 + triangleCount × 50` bytes.

### 3.2 Normal Computation

Face normals computed as `normalize(cross(v1 - v0, v2 - v0))`. Degenerate triangles (zero-area) produce zero normal (guarded by `|| 1` in length divisor).

### 3.3 Round-trip

`exportSTL → parseSTL` is validated in tests. The existing `parseSTL` in `stl-parser.ts` performs vertex welding via position quantization (`toFixed(6)`), so the parsed mesh has shared vertices while the exported mesh does not. Triangle count and vertex positions are preserved within f32 precision.

---

## 4. Export Pipeline (`export-pipeline.ts`)

### 4.1 Dimensionless Parameters

Both user-facing parameters are dimensionless and scale with lattice resolution:

| Parameter | Symbol | Default | Formula | Effect |
|-----------|--------|---------|---------|--------|
| MC Density | `mcDensity` | auto | `ceil(3 / (2 × r*))` | Samples per lattice cell edge |
| Fillet | `filletK` | 0.5 | `filletK × absoluteRadius` | Joint smoothing as fraction of strut radius |

**Auto density derivation**: the MC grid must have ≥ 3 samples across the strut diameter (2 × radius) to properly resolve cylindrical geometry.

```
mcStep = cellSize / density
requirement: mcStep ≤ (2 × radius) / 3
substituting: cellSize / density ≤ (2 × r* × cellSize) / 3
simplifying: density ≥ 3 / (2 × r*)
```

For `r* = 0.08`: auto density = 19 (mcStep = cellSize/19).
For `r* = 0.20`: auto density = 8 (mcStep = cellSize/8).
Minimum density clamped to 4.

### 4.2 MC Grid Bounds

```
gMin, gMax = lattice grid corners (gridMin/gridMax)
margin = absoluteRadius + sminK + mcStep
mcOrigin = gMin - margin       (ensures SDF boundary is positive)
mcMax = gMax + margin
dims[i] = max(2, ceil((mcMax[i] - mcOrigin[i]) / mcStep) + 1)
```

The margin ensures all beams near the lattice boundary have positive SDF at the MC grid edges — required for watertight output.

### 4.3 Async Execution

The SDF evaluation loop yields to the browser event loop every 4 z-slices:

```typescript
if (z % 4 === 0) {
  onProgress?.('sdf', z / nz);
  await new Promise<void>(r => setTimeout(r, 0));
}
```

This prevents "page unresponsive" warnings for large grids. Cost is ~50-100 `setTimeout` calls for a 200-deep grid — negligible.

### 4.4 Timing

Each phase is independently timed via `performance.now()`:

```typescript
ExportResult.timings: {
  accelMs   // buildSdfAccel
  sdfMs     // SDF grid evaluation (dominant)
  mcMs      // marchingCubes
  stlMs     // exportSTL
  totalMs   // wall clock
}
```

---

## 5. Performance Model

### 5.1 Complexity

| Stage | Time Complexity | Space Complexity |
|-------|-----------------|------------------|
| buildSdfAccel | O(B) where B = beam count | O(B × cells_per_beam) |
| SDF eval | O(D³ × K) where D = grid dim, K = avg nearby beams | O(D³) for sdfValues |
| Marching cubes | O(D³) | O(T) where T = output triangles |
| STL export | O(T) | O(T × 50) bytes |

### 5.2 Memory Budget

| Structure | Size (200³ grid, 50K triangles) |
|-----------|-------------------------------|
| SDF grid (`Float32Array`) | 200³ × 4 = 32 MB |
| MC output positions | 50K × 3 × 3 × 4 = 1.8 MB |
| MC output indices | 50K × 3 × 4 = 600 KB |
| STL binary | 80 + 4 + 50K × 50 = 2.5 MB |
| SdfAccel | ~50 KB (depends on beam count) |

The SDF grid dominates. A 300³ grid requires 108 MB.

### 5.3 JS Performance

For a 200³ grid with ~10K beams and ~5 nearby beams per query:
- 8M grid points × 5 SDF evals = 40M cylinder evaluations
- ~15 FLOPs per cylinder SDF
- ~600M FLOPs total
- **Expected: 2-5 seconds** in a modern browser (single-threaded JS)

Marching cubes and STL export are typically < 100ms combined.

---

## 6. GPU Compute Acceleration

The SDF evaluation loop is embarrassingly parallel — each grid point is independent with no shared mutable state. The existing wgpu compute infrastructure in `crates/lattice-wasm/` provides the foundation.

### 6.1 SDF Evaluation Shader

Maps directly to a compute shader: one invocation per MC grid vertex.

```wgsl
struct Beam {
  p0: vec3<f32>,
  p1: vec3<f32>,
  r: f32,
}

@group(0) @binding(0) var<storage, read> beams: array<Beam>;
@group(0) @binding(1) var<uniform> params: Params;  // origin, step, dims, sminK, beamCount
@group(0) @binding(2) var<storage, read_write> sdf_grid: array<f32>;

@compute @workgroup_size(64)
fn eval_sdf(@builtin(global_invocation_id) gid: vec3<u32>) {
    if (gid.x >= params.dims.x || gid.y >= params.dims.y || gid.z >= params.dims.z) { return; }

    let p = params.origin + vec3<f32>(gid) * params.step;
    var d: f32 = 1e10;

    for (var i: u32 = 0u; i < params.beam_count; i++) {
        let bd = sd_capped_cylinder(p, beams[i].p0, beams[i].p1, beams[i].r);
        d = smin(d, bd, params.smin_k);
    }

    let idx = gid.x + params.dims.x * (gid.y + params.dims.y * gid.z);
    sdf_grid[idx] = d;
}
```

**For small lattices (< 50K beams)**: brute-force all beams — GPU parallelism compensates for the O(N) per-point cost. No spatial hash needed on GPU.

**For large lattices**: upload spatial hash as a flat buffer with CSR-style indexing. The `csr.rs` module in the existing crate already builds tile-triangle CSR structures — the same pattern applies to cell-beam indexing.

**Expected performance**: 200³ grid = 8M invocations. At 64 threads per workgroup = 125K workgroups. On a midrange GPU: **10-50ms** vs 2-5s in JS — a 50-200× speedup.

### 6.2 Marching Cubes Shader

Parallelizable per-cube but requires variable-length output handling. Standard GPU MC uses a two-pass approach:

**Pass 1 — Classify**: one invocation per cube, compute 8-bit case index, write triangle count to a per-cube buffer.

```wgsl
@compute @workgroup_size(64)
fn mc_classify(@builtin(global_invocation_id) gid: vec3<u32>) {
    // Read 8 SDF corners, build case index, write tri_count[cube_idx]
    let case_idx = /* ... */;
    tri_counts[cube_linear_idx] = tri_count_for_case[case_idx];
}
```

**Prefix sum**: compute exclusive scan over `tri_counts` → output offsets. This is a well-known GPU primitive (parallel scan with work-efficient Blelloch algorithm or hardware-accelerated via subgroup operations).

**Pass 2 — Emit**: one invocation per cube, interpolate edge vertices, write triangles at computed offsets.

```wgsl
@compute @workgroup_size(64)
fn mc_emit(@builtin(global_invocation_id) gid: vec3<u32>) {
    let offset = tri_offsets[cube_linear_idx];
    // Interpolate edges, write to out_positions[offset * 3 .. ]
}
```

**Existing infrastructure reuse**:
- `GpuVoxelizer` device/queue lifecycle → shared across all compute
- `map_buffer_f32()` readback pattern → read SDF grid and MC output
- Atomic counter pattern (from compact passes) → alternative to prefix sum for output indexing
- Storage buffer validation (`ensure_storage_fits`) → check 32MB SDF grid allocation

### 6.3 Data Flow

```
              CPU                           GPU
              ───                           ───
  BeamGraph ──→ flatten beams ──upload──→ beams_buf (storage)
  Grid params ─────────────────upload──→ params_buf (uniform)
                                          │
                                   eval_sdf dispatch
                                          │
                                          ▼
                                   sdf_grid (storage, D³ × f32)
                                          │
                                   mc_classify dispatch
                                          │
                                          ▼
                                   tri_counts (storage)
                                          │
                                   prefix_sum dispatch
                                          │
                                          ▼
                                   tri_offsets (storage)
                                          │
                                   mc_emit dispatch
                                          │
                                          ▼
                                   positions + indices (storage)
                                          │
                              ←──readback──┘
                                          │
  exportSTL(positions, indices) ←─────────┘
```

Total GPU dispatches: 4 (SDF eval + classify + scan + emit). Total buffer transfers: 1 upload (beams) + 1 readback (mesh).

### 6.4 Spatial Hash on GPU

For lattices exceeding ~50K beams, brute-force per-point iteration becomes the GPU bottleneck. Two options:

**Option A — Uniform grid as flat buffer**: pre-build the spatial hash on CPU, upload as two storage buffers mimicking CSR:
- `cell_ptr: array<u32>` — offset into beam_indices per cell (prefix sum)
- `beam_indices: array<u32>` — packed beam indices

The shader queries `cell_ptr[hash(ix,iy,iz)]` to `cell_ptr[hash(ix,iy,iz)+1]` and iterates `beam_indices` in that range. This is the same CSR pattern used by `csr.rs` for tile-triangle indexing.

**Option B — Brute-force with early exit**: upload beams sorted by spatial locality. Each thread iterates all beams but exits early when accumulated `smin` distance is far below the current minimum. Simpler to implement, effective for moderate beam counts.

---

## 7. Invariants

1. **Watertight output**: guaranteed if the SDF is continuous. `sdCappedCylinder` + `smin` are both C¹ continuous → MC output is always a closed manifold.
2. **Positive boundary**: the margin ensures all SDF values at MC grid edges are positive → no open edges at grid boundary.
3. **Winding consistency**: MC triangle table uses consistent winding order → outward-facing normals by convention.
4. **File size**: `exportSTL` output is exactly `80 + 4 + triangleCount × 50` bytes.
5. **Density scales with r***: auto-density guarantees ≥ 3 MC samples across the strut diameter at any resolution.
6. **No vertex welding**: MC output has 3 unique vertices per triangle. Adjacent triangles do not share vertices. This is correct for STL (per-triangle format) and avoids hash overhead.

---

## 8. Testing

| Test | Input | Assertion |
|------|-------|-----------|
| Cylinder SDF sign | Point at beam center | SDF < 0 |
| Cylinder SDF surface | Point on barrel | SDF ≈ 0 (ε < 1e-6) |
| Cylinder SDF distance | Point at (1, 1, 0), r=0.5 | SDF ≈ 0.5 |
| smin identity | k=0 | `smin(a, b, 0) = min(a, b)` |
| smin symmetry | any k | `smin(a, b, k) = smin(b, a, k)` |
| smin bound | k > 0 | `smin(a, b, k) ≤ min(a, b)` |
| SdfAccel build | 2×2×2 cubic | `beamCount = graph.beamCount`, cells > 0 |
| latticeSdf inside | beam midpoint | SDF < 0 |
| latticeSdf far | (100, 100, 100) | SDF > 0 |
| MC sphere | 20³ grid, r=1 | triangles > 0, vertices ≈ radius ± step√3 |
| MC all-positive | flat 1.0 | 0 triangles |
| MC all-negative | flat -1.0 | 0 triangles |
| MC indices valid | any output | all indices < vertexCount |
| STL byte count | 2-triangle quad | size = 80 + 4 + 2×50 |
| STL round-trip | export → parseSTL | triangle count matches, positions within ε |
| STL normals | any triangle | normal length ≈ 1.0 |
| Pipeline end-to-end | 2×2×2 cubic, density 10 | triangleCount > 0, valid ArrayBuffer |
| Pipeline auto-density | r*=0.08 | density = 19, triangleCount > 0 |
| Pipeline density scaling | density 6 vs 12 | higher density → more triangles |
| Pipeline timing | any | all timing fields ≥ 0 |
| Pipeline progress | any | callbacks for sdf, mc, stl phases |

All tests pass via `pnpm --filter @lattice/core test` (227 total, 27 new).

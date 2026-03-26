/// WGSL compute shaders for GPU-accelerated SDF evaluation and marching cubes.

pub const EVAL_SDF_WGSL: &str = r#"
struct SdfParams {
  origin: vec4<f32>,
  dims: vec4<u32>,
  smin_k: f32,
  hash_table_size: u32,
  accel_cell_size: f32,
  _pad0: f32,
  accel_origin: vec4<f32>,
};

struct Beam {
  p0: vec4<f32>,
  p1: vec4<f32>,
};

@group(0) @binding(0) var<storage, read> beams: array<Beam>;
@group(0) @binding(1) var<uniform> params: SdfParams;
@group(0) @binding(2) var<storage, read_write> sdf_grid: array<f32>;
@group(0) @binding(3) var<storage, read> cell_offsets: array<u32>;
@group(0) @binding(4) var<storage, read> beam_indices: array<u32>;

const P1: u32 = 73856093u;
const P2: u32 = 19349663u;
const P3: u32 = 83492791u;

fn hash_cell(ix: i32, iy: i32, iz: i32, table_size: u32) -> u32 {
  let h = u32(ix) * P1 ^ u32(iy) * P2 ^ u32(iz) * P3;
  return h % table_size;
}

fn sd_capped_cylinder(px: f32, py: f32, pz: f32, ax: f32, ay: f32, az: f32, bx: f32, by: f32, bz: f32, r: f32) -> f32 {
  let bax = bx - ax;
  let bay = by - ay;
  let baz = bz - az;
  let pax = px - ax;
  let pay = py - ay;
  let paz = pz - az;

  let baba = bax * bax + bay * bay + baz * baz;
  let paba = pax * bax + pay * bay + paz * baz;

  let dx = pax * baba - bax * paba;
  let dy = pay * baba - bay * paba;
  let dz = paz * baba - baz * paba;
  let x = sqrt(dx * dx + dy * dy + dz * dz) - r * baba;

  let y = abs(paba - baba * 0.5) - baba * 0.5;

  let x2 = x * x;
  let y2 = y * y * baba;

  var d: f32;
  if (x > 0.0 && y > 0.0) {
    d = x2 + y2;
  } else if (x > 0.0) {
    d = x2;
  } else if (y > 0.0) {
    d = y2;
  } else {
    d = -min(x2, y2);
  }

  return sign(d) * sqrt(abs(d)) / baba;
}

fn smin_f(a: f32, b: f32, k: f32) -> f32 {
  if (k <= 0.0) { return min(a, b); }
  let k4 = k * 4.0;
  let h = max(k4 - abs(a - b), 0.0);
  return min(a, b) - (h * h * 0.25) / k4;
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nx = params.dims.x;
  let ny = params.dims.y;
  let nz = params.dims.z;

  if (gid.x >= nx || gid.y >= ny || gid.z >= nz) { return; }

  let step = params.origin.w;
  let px = params.origin.x + f32(gid.x) * step;
  let py = params.origin.y + f32(gid.y) * step;
  let pz = params.origin.z + f32(gid.z) * step;

  let inv_cs = params.accel_origin.w;
  let ix = i32(floor((px - params.accel_origin.x) * inv_cs));
  let iy = i32(floor((py - params.accel_origin.y) * inv_cs));
  let iz = i32(floor((pz - params.accel_origin.z) * inv_cs));

  var d: f32 = 1e10;
  let k = params.smin_k;
  let ts = params.hash_table_size;

  // 3x3x3 neighborhood query — same as CPU latticeSdf
  for (var dxx: i32 = -1; dxx <= 1; dxx = dxx + 1) {
    for (var dyy: i32 = -1; dyy <= 1; dyy = dyy + 1) {
      for (var dzz: i32 = -1; dzz <= 1; dzz = dzz + 1) {
        let bucket = hash_cell(ix + dxx, iy + dyy, iz + dzz, ts);
        let start = cell_offsets[bucket];
        let end = cell_offsets[bucket + 1u];
        for (var j: u32 = start; j < end; j = j + 1u) {
          let bi = beam_indices[j];
          let beam = beams[bi];
          let bd = sd_capped_cylinder(
            px, py, pz,
            beam.p0.x, beam.p0.y, beam.p0.z,
            beam.p1.x, beam.p1.y, beam.p1.z,
            beam.p0.w,
          );
          d = smin_f(d, bd, k);
        }
      }
    }
  }

  let idx = gid.x + nx * (gid.y + ny * gid.z);
  sdf_grid[idx] = d;
}
"#;

/// Combined MC classify + emit using atomic counter.
/// Each thread processes one cube, claims output slots via atomicAdd,
/// and writes positions directly. Eliminates the classify→readback→emit round-trip.
pub const MC_EMIT_ATOMIC_WGSL: &str = r#"
struct McParams {
  dims: vec4<u32>,
  origin: vec4<f32>,
  max_triangles: u32,
  _pad: vec3<u32>,
};

@group(0) @binding(0) var<storage, read> sdf_grid: array<f32>;
@group(0) @binding(1) var<uniform> params: McParams;
@group(0) @binding(2) var<storage, read> tri_table: array<i32>;
@group(0) @binding(3) var<storage, read_write> out_positions: array<f32>;
@group(0) @binding(4) var<storage, read_write> counter: array<atomic<u32>>;

const VERT_X = array<u32, 8>(0u, 1u, 1u, 0u, 0u, 1u, 1u, 0u);
const VERT_Y = array<u32, 8>(0u, 0u, 1u, 1u, 0u, 0u, 1u, 1u);
const VERT_Z = array<u32, 8>(0u, 0u, 0u, 0u, 1u, 1u, 1u, 1u);
const EDGE_V0 = array<u32, 12>(0u, 1u, 2u, 3u, 4u, 5u, 6u, 7u, 0u, 1u, 2u, 3u);
const EDGE_V1 = array<u32, 12>(1u, 2u, 3u, 0u, 5u, 6u, 7u, 4u, 4u, 5u, 6u, 7u);

fn lerp_f(a: f32, b: f32, t: f32) -> f32 {
  return a + (b - a) * t;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let nx = params.dims.x;
  let ny = params.dims.y;
  let cells_x = nx - 1u;
  let cells_y = ny - 1u;
  let cells_z = params.dims.z - 1u;
  let num_cubes = cells_x * cells_y * cells_z;

  let cube_idx = gid.x;
  if (cube_idx >= num_cubes) { return; }

  let cx = cube_idx % cells_x;
  let cy = (cube_idx / cells_x) % cells_y;
  let cz = cube_idx / (cells_x * cells_y);

  // Read 8 SDF corners, build case index
  var vals: array<f32, 8>;
  var case_index: u32 = 0u;
  for (var i: u32 = 0u; i < 8u; i = i + 1u) {
    let vx = cx + VERT_X[i];
    let vy = cy + VERT_Y[i];
    let vz = cz + VERT_Z[i];
    vals[i] = sdf_grid[vx + nx * (vy + ny * vz)];
    if (vals[i] < 0.0) {
      case_index = case_index | (1u << i);
    }
  }

  // Count triangles for this cube
  let tri_base = case_index * 16u;
  var tri_count: u32 = 0u;
  for (var t: u32 = 0u; t < 15u; t = t + 3u) {
    if (tri_table[tri_base + t] == -1i) { break; }
    tri_count = tri_count + 1u;
  }
  if (tri_count == 0u) { return; }

  // Claim output slots atomically
  let write_offset = atomicAdd(&counter[0], tri_count);
  if (write_offset + tri_count > params.max_triangles) { return; }

  let step = params.origin.w;
  var tri_idx: u32 = 0u;
  for (var t: u32 = 0u; t < 15u; t = t + 3u) {
    let e0i = tri_table[tri_base + t];
    if (e0i == -1i) { break; }
    let e1i = tri_table[tri_base + t + 1u];
    let e2i = tri_table[tri_base + t + 2u];

    let edges = array<u32, 3>(u32(e0i), u32(e1i), u32(e2i));

    for (var v: u32 = 0u; v < 3u; v = v + 1u) {
      let e = edges[v];
      let v0 = EDGE_V0[e];
      let v1 = EDGE_V1[e];
      let s0 = vals[v0];
      let s1 = vals[v1];
      let t_interp = s0 / (s0 - s1);

      let x0 = f32(cx + VERT_X[v0]);
      let y0 = f32(cy + VERT_Y[v0]);
      let z0 = f32(cz + VERT_Z[v0]);
      let x1 = f32(cx + VERT_X[v1]);
      let y1 = f32(cy + VERT_Y[v1]);
      let z1 = f32(cz + VERT_Z[v1]);

      let pos_idx = (write_offset + tri_idx) * 9u + v * 3u;
      out_positions[pos_idx]      = params.origin.x + lerp_f(x0, x1, t_interp) * step;
      out_positions[pos_idx + 1u] = params.origin.y + lerp_f(y0, y1, t_interp) * step;
      out_positions[pos_idx + 2u] = params.origin.z + lerp_f(z0, z1, t_interp) * step;
    }

    tri_idx = tri_idx + 1u;
  }
}
"#;

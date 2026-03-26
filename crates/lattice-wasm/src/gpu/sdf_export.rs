//! GPU-accelerated SDF evaluation and marching cubes export.
//!
//! Two dispatches in a single command encoder: eval_sdf → mc_emit_atomic.
//! The emit shader uses atomicAdd to claim output slots, eliminating the
//! classify→readback→prefix-sum→emit round-trip.

use bytemuck::{Pod, Zeroable};
use wgpu::util::DeviceExt;

use super::buffers::map_buffer_u32;
use super::sdf_shaders::{EVAL_SDF_WGSL, MC_EMIT_ATOMIC_WGSL};

// ─── MC Lookup Table ────────────────────────────────────────────────────────

#[rustfmt::skip]
const MC_TRI_TABLE: [i32; 4096] = [
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,8,3,9,8,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,1,2,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,2,10,0,2,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,8,3,2,10,8,10,9,8,-1,-1,-1,-1,-1,-1,-1,
  3,11,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,11,2,8,11,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,9,0,2,3,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,11,2,1,9,11,9,8,11,-1,-1,-1,-1,-1,-1,-1,
  3,10,1,11,10,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,10,1,0,8,10,8,11,10,-1,-1,-1,-1,-1,-1,-1,
  3,9,0,3,11,9,11,10,9,-1,-1,-1,-1,-1,-1,-1,
  9,8,10,10,8,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,3,0,7,3,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,8,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,1,9,4,7,1,7,3,1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,8,4,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,4,7,3,0,4,1,2,10,-1,-1,-1,-1,-1,-1,-1,
  9,2,10,9,0,2,8,4,7,-1,-1,-1,-1,-1,-1,-1,
  2,10,9,2,9,7,2,7,3,7,9,4,-1,-1,-1,-1,
  8,4,7,3,11,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,4,7,11,2,4,2,0,4,-1,-1,-1,-1,-1,-1,-1,
  9,0,1,8,4,7,2,3,11,-1,-1,-1,-1,-1,-1,-1,
  4,7,11,9,4,11,9,11,2,9,2,1,-1,-1,-1,-1,
  3,10,1,3,11,10,7,8,4,-1,-1,-1,-1,-1,-1,-1,
  1,11,10,1,4,11,1,0,4,7,11,4,-1,-1,-1,-1,
  4,7,8,9,0,11,9,11,10,11,0,3,-1,-1,-1,-1,
  4,7,11,4,11,9,9,11,10,-1,-1,-1,-1,-1,-1,-1,
  9,5,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,5,4,0,8,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,5,4,1,5,0,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,5,4,8,3,5,3,1,5,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,9,5,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,0,8,1,2,10,4,9,5,-1,-1,-1,-1,-1,-1,-1,
  5,2,10,5,4,2,4,0,2,-1,-1,-1,-1,-1,-1,-1,
  2,10,5,3,2,5,3,5,4,3,4,8,-1,-1,-1,-1,
  9,5,4,2,3,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,11,2,0,8,11,4,9,5,-1,-1,-1,-1,-1,-1,-1,
  0,5,4,0,1,5,2,3,11,-1,-1,-1,-1,-1,-1,-1,
  2,1,5,2,5,8,2,8,11,4,8,5,-1,-1,-1,-1,
  10,3,11,10,1,3,9,5,4,-1,-1,-1,-1,-1,-1,-1,
  4,9,5,0,8,1,8,10,1,8,11,10,-1,-1,-1,-1,
  5,4,0,5,0,11,5,11,10,11,0,3,-1,-1,-1,-1,
  5,4,8,5,8,10,10,8,11,-1,-1,-1,-1,-1,-1,-1,
  9,7,8,5,7,9,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,3,0,9,5,3,5,7,3,-1,-1,-1,-1,-1,-1,-1,
  0,7,8,0,1,7,1,5,7,-1,-1,-1,-1,-1,-1,-1,
  1,5,3,3,5,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,7,8,9,5,7,10,1,2,-1,-1,-1,-1,-1,-1,-1,
  10,1,2,9,5,0,5,3,0,5,7,3,-1,-1,-1,-1,
  8,0,2,8,2,5,8,5,7,10,5,2,-1,-1,-1,-1,
  2,10,5,2,5,3,3,5,7,-1,-1,-1,-1,-1,-1,-1,
  7,9,5,7,8,9,3,11,2,-1,-1,-1,-1,-1,-1,-1,
  9,5,7,9,7,2,9,2,0,2,7,11,-1,-1,-1,-1,
  2,3,11,0,1,8,1,7,8,1,5,7,-1,-1,-1,-1,
  11,2,1,11,1,7,7,1,5,-1,-1,-1,-1,-1,-1,-1,
  9,5,8,8,5,7,10,1,3,10,3,11,-1,-1,-1,-1,
  5,7,0,5,0,9,7,11,0,1,0,10,11,10,0,-1,
  11,10,0,11,0,3,10,5,0,8,0,7,5,7,0,-1,
  11,10,5,7,11,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  10,6,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,5,10,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,0,1,5,10,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,8,3,1,9,8,5,10,6,-1,-1,-1,-1,-1,-1,-1,
  1,6,5,2,6,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,6,5,1,2,6,3,0,8,-1,-1,-1,-1,-1,-1,-1,
  9,6,5,9,0,6,0,2,6,-1,-1,-1,-1,-1,-1,-1,
  5,9,8,5,8,2,5,2,6,3,2,8,-1,-1,-1,-1,
  2,3,11,10,6,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,0,8,11,2,0,10,6,5,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,2,3,11,5,10,6,-1,-1,-1,-1,-1,-1,-1,
  5,10,6,1,9,2,9,11,2,9,8,11,-1,-1,-1,-1,
  6,3,11,6,5,3,5,1,3,-1,-1,-1,-1,-1,-1,-1,
  0,8,11,0,11,5,0,5,1,5,11,6,-1,-1,-1,-1,
  3,11,6,0,3,6,0,6,5,0,5,9,-1,-1,-1,-1,
  6,5,9,6,9,11,11,9,8,-1,-1,-1,-1,-1,-1,-1,
  5,10,6,4,7,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,3,0,4,7,3,6,5,10,-1,-1,-1,-1,-1,-1,-1,
  1,9,0,5,10,6,8,4,7,-1,-1,-1,-1,-1,-1,-1,
  10,6,5,1,9,7,1,7,3,7,9,4,-1,-1,-1,-1,
  6,1,2,6,5,1,4,7,8,-1,-1,-1,-1,-1,-1,-1,
  1,2,5,5,2,6,3,0,4,3,4,7,-1,-1,-1,-1,
  8,4,7,9,0,5,0,6,5,0,2,6,-1,-1,-1,-1,
  7,3,9,7,9,4,3,2,9,5,9,6,2,6,9,-1,
  3,11,2,7,8,4,10,6,5,-1,-1,-1,-1,-1,-1,-1,
  5,10,6,4,7,2,4,2,0,2,7,11,-1,-1,-1,-1,
  0,1,9,4,7,8,2,3,11,5,10,6,-1,-1,-1,-1,
  9,2,1,9,11,2,9,4,11,7,11,4,5,10,6,-1,
  8,4,7,3,11,5,3,5,1,5,11,6,-1,-1,-1,-1,
  5,1,11,5,11,6,1,0,11,7,11,4,0,4,11,-1,
  0,5,9,0,6,5,0,3,6,11,6,3,8,4,7,-1,
  6,5,9,6,9,11,4,7,9,7,11,9,-1,-1,-1,-1,
  10,4,9,6,4,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,10,6,4,9,10,0,8,3,-1,-1,-1,-1,-1,-1,-1,
  10,0,1,10,6,0,6,4,0,-1,-1,-1,-1,-1,-1,-1,
  8,3,1,8,1,6,8,6,4,6,1,10,-1,-1,-1,-1,
  1,4,9,1,2,4,2,6,4,-1,-1,-1,-1,-1,-1,-1,
  3,0,8,1,2,9,2,4,9,2,6,4,-1,-1,-1,-1,
  0,2,4,4,2,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,3,2,8,2,4,4,2,6,-1,-1,-1,-1,-1,-1,-1,
  10,4,9,10,6,4,11,2,3,-1,-1,-1,-1,-1,-1,-1,
  0,8,2,2,8,11,4,9,10,4,10,6,-1,-1,-1,-1,
  3,11,2,0,1,6,0,6,4,6,1,10,-1,-1,-1,-1,
  6,4,1,6,1,10,4,8,1,2,1,11,8,11,1,-1,
  9,6,4,9,3,6,9,1,3,11,6,3,-1,-1,-1,-1,
  8,11,1,8,1,0,11,6,1,9,1,4,6,4,1,-1,
  3,11,6,3,6,0,0,6,4,-1,-1,-1,-1,-1,-1,-1,
  6,4,8,11,6,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,10,6,7,8,10,8,9,10,-1,-1,-1,-1,-1,-1,-1,
  0,7,3,0,10,7,0,9,10,6,7,10,-1,-1,-1,-1,
  10,6,7,1,10,7,1,7,8,1,8,0,-1,-1,-1,-1,
  10,6,7,10,7,1,1,7,3,-1,-1,-1,-1,-1,-1,-1,
  1,2,6,1,6,8,1,8,9,8,6,7,-1,-1,-1,-1,
  2,6,9,2,9,1,6,7,9,0,9,3,7,3,9,-1,
  7,8,0,7,0,6,6,0,2,-1,-1,-1,-1,-1,-1,-1,
  7,3,2,6,7,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,3,11,10,6,8,10,8,9,8,6,7,-1,-1,-1,-1,
  2,0,7,2,7,11,0,9,7,6,7,10,9,10,7,-1,
  1,8,0,1,7,8,1,10,7,6,7,10,2,3,11,-1,
  11,2,1,11,1,7,10,6,1,6,7,1,-1,-1,-1,-1,
  8,9,6,8,6,7,9,1,6,11,6,3,1,3,6,-1,
  0,9,1,11,6,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,8,0,7,0,6,3,11,0,11,6,0,-1,-1,-1,-1,
  7,11,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,6,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,0,8,11,7,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,1,9,11,7,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,1,9,8,3,1,11,7,6,-1,-1,-1,-1,-1,-1,-1,
  10,1,2,6,11,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,3,0,8,6,11,7,-1,-1,-1,-1,-1,-1,-1,
  2,9,0,2,10,9,6,11,7,-1,-1,-1,-1,-1,-1,-1,
  6,11,7,2,10,3,10,8,3,10,9,8,-1,-1,-1,-1,
  7,2,3,6,2,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  7,0,8,7,6,0,6,2,0,-1,-1,-1,-1,-1,-1,-1,
  2,7,6,2,3,7,0,1,9,-1,-1,-1,-1,-1,-1,-1,
  1,6,2,1,8,6,1,9,8,8,7,6,-1,-1,-1,-1,
  10,7,6,10,1,7,1,3,7,-1,-1,-1,-1,-1,-1,-1,
  10,7,6,1,7,10,1,8,7,1,0,8,-1,-1,-1,-1,
  0,3,7,0,7,10,0,10,9,6,10,7,-1,-1,-1,-1,
  7,6,10,7,10,8,8,10,9,-1,-1,-1,-1,-1,-1,-1,
  6,8,4,11,8,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,6,11,3,0,6,0,4,6,-1,-1,-1,-1,-1,-1,-1,
  8,6,11,8,4,6,9,0,1,-1,-1,-1,-1,-1,-1,-1,
  9,4,6,9,6,3,9,3,1,11,3,6,-1,-1,-1,-1,
  6,8,4,6,11,8,2,10,1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,3,0,11,0,6,11,0,4,6,-1,-1,-1,-1,
  4,11,8,4,6,11,0,2,9,2,10,9,-1,-1,-1,-1,
  10,9,3,10,3,2,9,4,3,11,3,6,4,6,3,-1,
  8,2,3,8,4,2,4,6,2,-1,-1,-1,-1,-1,-1,-1,
  0,4,2,4,6,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,9,0,2,3,4,2,4,6,4,3,8,-1,-1,-1,-1,
  1,9,4,1,4,2,2,4,6,-1,-1,-1,-1,-1,-1,-1,
  8,1,3,8,6,1,8,4,6,6,10,1,-1,-1,-1,-1,
  10,1,0,10,0,6,6,0,4,-1,-1,-1,-1,-1,-1,-1,
  4,6,3,4,3,8,6,10,3,0,3,9,10,9,3,-1,
  10,9,4,6,10,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,9,5,7,6,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,4,9,5,11,7,6,-1,-1,-1,-1,-1,-1,-1,
  5,0,1,5,4,0,7,6,11,-1,-1,-1,-1,-1,-1,-1,
  11,7,6,8,3,4,3,5,4,3,1,5,-1,-1,-1,-1,
  9,5,4,10,1,2,7,6,11,-1,-1,-1,-1,-1,-1,-1,
  6,11,7,1,2,10,0,8,3,4,9,5,-1,-1,-1,-1,
  7,6,11,5,4,10,4,2,10,4,0,2,-1,-1,-1,-1,
  3,4,8,3,5,4,3,2,5,10,5,2,11,7,6,-1,
  7,2,3,7,6,2,5,4,9,-1,-1,-1,-1,-1,-1,-1,
  9,5,4,0,8,6,0,6,2,6,8,7,-1,-1,-1,-1,
  3,6,2,3,7,6,1,5,0,5,4,0,-1,-1,-1,-1,
  6,2,8,6,8,7,2,1,8,4,8,5,1,5,8,-1,
  9,5,4,10,1,6,1,7,6,1,3,7,-1,-1,-1,-1,
  1,6,10,1,7,6,1,0,7,8,7,0,9,5,4,-1,
  4,0,10,4,10,5,0,3,10,6,10,7,3,7,10,-1,
  7,6,10,7,10,8,5,4,10,4,8,10,-1,-1,-1,-1,
  6,9,5,6,11,9,11,8,9,-1,-1,-1,-1,-1,-1,-1,
  3,6,11,0,6,3,0,5,6,0,9,5,-1,-1,-1,-1,
  0,11,8,0,5,11,0,1,5,5,6,11,-1,-1,-1,-1,
  6,11,3,6,3,5,5,3,1,-1,-1,-1,-1,-1,-1,-1,
  1,2,10,9,5,11,9,11,8,11,5,6,-1,-1,-1,-1,
  0,11,3,0,6,11,0,9,6,5,6,9,1,2,10,-1,
  11,8,5,11,5,6,8,0,5,10,5,2,0,2,5,-1,
  6,11,3,6,3,5,2,10,3,10,5,3,-1,-1,-1,-1,
  5,8,9,5,2,8,5,6,2,3,8,2,-1,-1,-1,-1,
  9,5,6,9,6,0,0,6,2,-1,-1,-1,-1,-1,-1,-1,
  1,5,8,1,8,0,5,6,8,3,8,2,6,2,8,-1,
  1,5,6,2,1,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,3,6,1,6,10,3,8,6,5,6,9,8,9,6,-1,
  10,1,0,10,0,6,9,5,0,5,6,0,-1,-1,-1,-1,
  0,3,8,5,6,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  10,5,6,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,5,10,7,5,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  11,5,10,11,7,5,8,3,0,-1,-1,-1,-1,-1,-1,-1,
  5,11,7,5,10,11,1,9,0,-1,-1,-1,-1,-1,-1,-1,
  10,7,5,10,11,7,9,8,1,8,3,1,-1,-1,-1,-1,
  11,1,2,11,7,1,7,5,1,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,1,2,7,1,7,5,7,2,11,-1,-1,-1,-1,
  9,7,5,9,2,7,9,0,2,2,11,7,-1,-1,-1,-1,
  7,5,2,7,2,11,5,9,2,3,2,8,9,8,2,-1,
  2,5,10,2,3,5,3,7,5,-1,-1,-1,-1,-1,-1,-1,
  8,2,0,8,5,2,8,7,5,10,2,5,-1,-1,-1,-1,
  9,0,1,5,10,3,5,3,7,3,10,2,-1,-1,-1,-1,
  9,8,2,9,2,1,8,7,2,10,2,5,7,5,2,-1,
  1,3,5,3,7,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,8,7,0,7,1,1,7,5,-1,-1,-1,-1,-1,-1,-1,
  9,0,3,9,3,5,5,3,7,-1,-1,-1,-1,-1,-1,-1,
  9,8,7,5,9,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  5,8,4,5,10,8,10,11,8,-1,-1,-1,-1,-1,-1,-1,
  5,0,4,5,11,0,5,10,11,11,3,0,-1,-1,-1,-1,
  0,1,9,8,4,10,8,10,11,10,4,5,-1,-1,-1,-1,
  10,11,4,10,4,5,11,3,4,9,4,1,3,1,4,-1,
  2,5,1,2,8,5,2,11,8,4,5,8,-1,-1,-1,-1,
  0,4,11,0,11,3,4,5,11,2,11,1,5,1,11,-1,
  0,2,5,0,5,9,2,11,5,4,5,8,11,8,5,-1,
  9,4,5,2,11,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,5,10,3,5,2,3,4,5,3,8,4,-1,-1,-1,-1,
  5,10,2,5,2,4,4,2,0,-1,-1,-1,-1,-1,-1,-1,
  3,10,2,3,5,10,3,8,5,4,5,8,0,1,9,-1,
  5,10,2,5,2,4,1,9,2,9,4,2,-1,-1,-1,-1,
  8,4,5,8,5,3,3,5,1,-1,-1,-1,-1,-1,-1,-1,
  0,4,5,1,0,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  8,4,5,8,5,3,9,0,5,0,3,5,-1,-1,-1,-1,
  9,4,5,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,11,7,4,9,11,9,10,11,-1,-1,-1,-1,-1,-1,-1,
  0,8,3,4,9,7,9,11,7,9,10,11,-1,-1,-1,-1,
  1,10,11,1,11,4,1,4,0,7,4,11,-1,-1,-1,-1,
  3,1,4,3,4,8,1,10,4,7,4,11,10,11,4,-1,
  4,11,7,9,11,4,9,2,11,9,1,2,-1,-1,-1,-1,
  9,7,4,9,11,7,9,1,11,2,11,1,0,8,3,-1,
  11,7,4,11,4,2,2,4,0,-1,-1,-1,-1,-1,-1,-1,
  11,7,4,11,4,2,8,3,4,3,2,4,-1,-1,-1,-1,
  2,9,10,2,7,9,2,3,7,7,4,9,-1,-1,-1,-1,
  9,10,7,9,7,4,10,2,7,8,7,0,2,0,7,-1,
  3,7,10,3,10,2,7,4,10,1,10,0,4,0,10,-1,
  1,10,2,8,7,4,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,9,1,4,1,7,7,1,3,-1,-1,-1,-1,-1,-1,-1,
  4,9,1,4,1,7,0,8,1,8,7,1,-1,-1,-1,-1,
  4,0,3,7,4,3,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  4,8,7,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  9,10,8,10,11,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,0,9,3,9,11,11,9,10,-1,-1,-1,-1,-1,-1,-1,
  0,1,10,0,10,8,8,10,11,-1,-1,-1,-1,-1,-1,-1,
  3,1,10,11,3,10,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,2,11,1,11,9,9,11,8,-1,-1,-1,-1,-1,-1,-1,
  3,0,9,3,9,11,1,2,9,2,11,9,-1,-1,-1,-1,
  0,2,11,8,0,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  3,2,11,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,3,8,2,8,10,10,8,9,-1,-1,-1,-1,-1,-1,-1,
  9,10,2,0,9,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  2,3,8,2,8,10,0,1,8,1,10,8,-1,-1,-1,-1,
  1,10,2,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  1,3,8,9,1,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,9,1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  0,3,8,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
];

// ─── Param Structs ──────────────────────────────────────────────────────────

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SdfParams {
    origin: [f32; 4],        // xyz = MC grid origin, w = step
    dims: [u32; 4],          // xyz = grid dims, w = beam_count
    smin_k: f32,
    hash_table_size: u32,
    accel_cell_size: f32,
    _pad0: f32,
    accel_origin: [f32; 4],  // xyz = spatial hash origin, w = inv_cell_size
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct McParams {
    dims: [u32; 4],      // SDF vertex dims xyz, w unused
    origin: [f32; 4],    // xyz + step in w
    max_triangles: u32,
    _pad: [u32; 3],
}

// ─── Result ─────────────────────────────────────────────────────────────────

pub struct SdfExportResult {
    pub positions: Vec<f32>,
    pub triangle_count: u32,
}

// ─── GpuSdfExporter ─────────────────────────────────────────────────────────

pub struct GpuSdfExporter {
    device: wgpu::Device,
    queue: wgpu::Queue,
    eval_sdf_pipeline: wgpu::ComputePipeline,
    eval_sdf_bgl: wgpu::BindGroupLayout,
    mc_emit_pipeline: wgpu::ComputePipeline,
    mc_emit_bgl: wgpu::BindGroupLayout,
    max_storage_buffer_binding_size: u64,
    max_compute_workgroups_per_dimension: u32,
}

impl GpuSdfExporter {
    pub async fn new() -> Result<Self, String> {
        let instance = wgpu::Instance::default();
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions::default())
            .await
            .ok_or("No GPU adapter available")?;

        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor::default(), None)
            .await
            .map_err(|e| format!("Failed to request device: {e}"))?;

        let limits = device.limits();
        let max_storage_buffer_binding_size = limits.max_storage_buffer_binding_size as u64;
        let max_compute_workgroups_per_dimension = limits.max_compute_workgroups_per_dimension;

        let (eval_sdf_pipeline, eval_sdf_bgl) = create_pipeline(
            &device,
            "sdf_export.eval_sdf",
            EVAL_SDF_WGSL,
            &[
                storage_entry(0, true),  // beams
                uniform_entry(1),        // params
                storage_entry(2, false), // sdf_grid
                storage_entry(3, true),  // cell_offsets
                storage_entry(4, true),  // beam_indices
            ],
        );

        let (mc_emit_pipeline, mc_emit_bgl) = create_pipeline(
            &device,
            "sdf_export.mc_emit",
            MC_EMIT_ATOMIC_WGSL,
            &[
                storage_entry(0, true),  // sdf_grid
                uniform_entry(1),        // params
                storage_entry(2, true),  // tri_table
                storage_entry(3, false), // out_positions
                storage_entry(4, false), // counter
            ],
        );

        Ok(Self {
            device,
            queue,
            eval_sdf_pipeline,
            eval_sdf_bgl,
            mc_emit_pipeline,
            mc_emit_bgl,
            max_storage_buffer_binding_size,
            max_compute_workgroups_per_dimension,
        })
    }

    /// Run the full GPU SDF eval + MC pipeline. Returns flat positions (9 floats per triangle).
    #[allow(clippy::too_many_arguments)]
    pub async fn export(
        &self,
        beam_p0: &[f32],
        beam_p1: &[f32],
        beam_r: &[f32],
        cell_offsets: &[u32],
        beam_indices: &[u32],
        hash_table_size: u32,
        accel_cell_size: f32,
        accel_origin: [f32; 3],
        origin: [f32; 3],
        dims: [u32; 3],
        step: f32,
        smin_k: f32,
    ) -> Result<SdfExportResult, String> {
        let beam_count = beam_r.len() as u32;
        let [nx, ny, nz] = dims;
        let grid_size = (nx as u64) * (ny as u64) * (nz as u64) * 4;
        self.ensure_fits(grid_size, "SDF grid")?;

        // ── Pack beams ──────────────────────────────────────────────────────
        let mut beam_data = Vec::with_capacity(beam_count as usize * 8);
        for i in 0..beam_count as usize {
            beam_data.push(beam_p0[i * 3]);
            beam_data.push(beam_p0[i * 3 + 1]);
            beam_data.push(beam_p0[i * 3 + 2]);
            beam_data.push(beam_r[i]);
            beam_data.push(beam_p1[i * 3]);
            beam_data.push(beam_p1[i * 3 + 1]);
            beam_data.push(beam_p1[i * 3 + 2]);
            beam_data.push(0.0_f32);
        }

        // ── Estimate max triangles (worst case: 5 per cube, capped at storage limit) ──
        let cells_x = nx - 1;
        let cells_y = ny - 1;
        let cells_z = nz - 1;
        let num_cubes = (cells_x as u64) * (cells_y as u64) * (cells_z as u64);
        // Empirically, lattices produce ~0.5-2% of worst case. Cap at 10% or storage limit.
        let max_triangles_by_heuristic = (num_cubes / 10).max(1024);
        let max_triangles_by_storage = self.max_storage_buffer_binding_size / (9 * 4);
        let max_triangles = max_triangles_by_heuristic.min(max_triangles_by_storage) as u32;

        let out_size = (max_triangles as u64) * 9 * 4;
        self.ensure_fits(out_size, "out_positions")?;

        // ── Create all buffers ──────────────────────────────────────────────
        let beams_buf = self.init_buf("beams", bytemuck::cast_slice(&beam_data), wgpu::BufferUsages::STORAGE);

        let inv_cell_size = if accel_cell_size > 0.0 { 1.0 / accel_cell_size } else { 0.0 };
        let sdf_params = SdfParams {
            origin: [origin[0], origin[1], origin[2], step],
            dims: [nx, ny, nz, beam_count],
            smin_k,
            hash_table_size,
            accel_cell_size,
            _pad0: 0.0,
            accel_origin: [accel_origin[0], accel_origin[1], accel_origin[2], inv_cell_size],
        };
        let sdf_params_buf = self.init_buf("sdf_params", bytemuck::bytes_of(&sdf_params), wgpu::BufferUsages::UNIFORM);

        let sdf_grid_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sdf_export.sdf_grid"),
            size: grid_size,
            usage: wgpu::BufferUsages::STORAGE,
            mapped_at_creation: false,
        });

        let cell_offsets_buf = self.init_buf("cell_offsets", bytemuck::cast_slice(cell_offsets), wgpu::BufferUsages::STORAGE);
        let beam_indices_buf = self.init_buf("beam_indices", bytemuck::cast_slice(beam_indices), wgpu::BufferUsages::STORAGE);

        let mc_params = McParams {
            dims: [nx, ny, nz, 0],
            origin: [origin[0], origin[1], origin[2], step],
            max_triangles,
            _pad: [0; 3],
        };
        let mc_params_buf = self.init_buf("mc_params", bytemuck::bytes_of(&mc_params), wgpu::BufferUsages::UNIFORM);

        let tri_table_buf = self.init_buf("tri_table", bytemuck::cast_slice(&MC_TRI_TABLE), wgpu::BufferUsages::STORAGE);

        let out_positions_buf = self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("sdf_export.out_positions"),
            size: out_size,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
            mapped_at_creation: false,
        });

        let counter_init = [0u32];
        let counter_buf = self.init_buf(
            "counter",
            bytemuck::cast_slice(&counter_init),
            wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_SRC,
        );

        // ── Bind groups ─────────────────────────────────────────────────────
        let eval_bg = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sdf_export.eval_sdf.bg"),
            layout: &self.eval_sdf_bgl,
            entries: &[
                bg_entry(0, &beams_buf),
                bg_entry(1, &sdf_params_buf),
                bg_entry(2, &sdf_grid_buf),
                bg_entry(3, &cell_offsets_buf),
                bg_entry(4, &beam_indices_buf),
            ],
        });

        let emit_bg = self.device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("sdf_export.mc_emit.bg"),
            layout: &self.mc_emit_bgl,
            entries: &[
                bg_entry(0, &sdf_grid_buf),
                bg_entry(1, &mc_params_buf),
                bg_entry(2, &tri_table_buf),
                bg_entry(3, &out_positions_buf),
                bg_entry(4, &counter_buf),
            ],
        });

        // ── Single command encoder: eval_sdf → mc_emit → copy readbacks ─────
        let wg_x = (nx + 3) / 4;
        let wg_y = (ny + 3) / 4;
        let wg_z = (nz + 3) / 4;
        self.ensure_wg_fits(wg_x, "eval_sdf x")?;
        self.ensure_wg_fits(wg_y, "eval_sdf y")?;
        self.ensure_wg_fits(wg_z, "eval_sdf z")?;

        let emit_wg = ((num_cubes + 63) / 64) as u32;
        self.ensure_wg_fits(emit_wg, "mc_emit")?;

        let counter_read = self.readback_buf("counter_read", 4);
        let out_read = self.readback_buf("out_positions_read", out_size);

        let mut encoder = self.device.create_command_encoder(&wgpu::CommandEncoderDescriptor {
            label: Some("sdf_export"),
        });

        // Pass 1: SDF evaluation
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("eval_sdf"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.eval_sdf_pipeline);
            pass.set_bind_group(0, &eval_bg, &[]);
            pass.dispatch_workgroups(wg_x, wg_y, wg_z);
        }

        // Pass 2: MC emit with atomic counter
        {
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("mc_emit"),
                timestamp_writes: None,
            });
            pass.set_pipeline(&self.mc_emit_pipeline);
            pass.set_bind_group(0, &emit_bg, &[]);
            pass.dispatch_workgroups(emit_wg, 1, 1);
        }

        // Copy results to staging buffers
        encoder.copy_buffer_to_buffer(&counter_buf, 0, &counter_read, 0, 4);
        encoder.copy_buffer_to_buffer(&out_positions_buf, 0, &out_read, 0, out_size);

        // Single submit, single wait
        self.queue.submit([encoder.finish()]);
        self.device.poll(wgpu::Maintain::Wait);

        // ── Readback ────────────────────────────────────────────────────────
        let counter_data = map_buffer_u32(&counter_read, &self.device).await;
        let total_triangles = counter_data[0].min(max_triangles);

        if total_triangles == 0 {
            return Ok(SdfExportResult {
                positions: Vec::new(),
                triangle_count: 0,
            });
        }

        let positions = map_buffer_f32_raw(&out_read, &self.device, total_triangles as usize * 9).await;

        Ok(SdfExportResult {
            positions,
            triangle_count: total_triangles,
        })
    }

    fn ensure_fits(&self, bytes: u64, label: &str) -> Result<(), String> {
        if bytes > self.max_storage_buffer_binding_size {
            return Err(format!("{label}: {bytes} bytes exceeds max {}", self.max_storage_buffer_binding_size));
        }
        Ok(())
    }

    fn ensure_wg_fits(&self, count: u32, label: &str) -> Result<(), String> {
        if count > self.max_compute_workgroups_per_dimension {
            return Err(format!("{label}: {count} workgroups exceeds max {}", self.max_compute_workgroups_per_dimension));
        }
        Ok(())
    }

    fn init_buf(&self, label: &str, data: &[u8], usage: wgpu::BufferUsages) -> wgpu::Buffer {
        self.device.create_buffer_init(&wgpu::util::BufferInitDescriptor {
            label: Some(label),
            contents: data,
            usage,
        })
    }

    fn readback_buf(&self, label: &str, size: u64) -> wgpu::Buffer {
        self.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some(label),
            size,
            usage: wgpu::BufferUsages::MAP_READ | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        })
    }
}

// ─── Pipeline Creation ──────────────────────────────────────────────────────

fn create_pipeline(
    device: &wgpu::Device,
    label: &str,
    shader_src: &str,
    entries: &[wgpu::BindGroupLayoutEntry],
) -> (wgpu::ComputePipeline, wgpu::BindGroupLayout) {
    let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
        label: Some(&format!("{label}.wgsl")),
        source: wgpu::ShaderSource::Wgsl(shader_src.into()),
    });

    let bgl = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
        label: Some(&format!("{label}.bgl")),
        entries,
    });

    let layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
        label: Some(&format!("{label}.layout")),
        bind_group_layouts: &[&bgl],
        push_constant_ranges: &[],
    });

    let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
        label: Some(&format!("{label}.pipeline")),
        layout: Some(&layout),
        module: &shader,
        entry_point: "main",
        compilation_options: wgpu::PipelineCompilationOptions::default(),
        cache: None,
    });

    (pipeline, bgl)
}

fn storage_entry(binding: u32, read_only: bool) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Storage { read_only },
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn uniform_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::COMPUTE,
        ty: wgpu::BindingType::Buffer {
            ty: wgpu::BufferBindingType::Uniform,
            has_dynamic_offset: false,
            min_binding_size: None,
        },
        count: None,
    }
}

fn bg_entry(binding: u32, buffer: &wgpu::Buffer) -> wgpu::BindGroupEntry<'_> {
    wgpu::BindGroupEntry {
        binding,
        resource: buffer.as_entire_binding(),
    }
}

// ─── Buffer Readback ────────────────────────────────────────────────────────

/// Read back only `count` f32 values from a mapped buffer (avoids copying the entire worst-case allocation).
async fn map_buffer_f32_raw(buffer: &wgpu::Buffer, device: &wgpu::Device, count: usize) -> Vec<f32> {
    let slice = buffer.slice(..);
    let (sender, receiver) = futures::channel::oneshot::channel();
    slice.map_async(wgpu::MapMode::Read, move |result| {
        let _ = sender.send(result);
    });
    device.poll(wgpu::Maintain::Wait);
    receiver.await.expect("map buffer").expect("map buffer");
    let data = slice.get_mapped_range();
    let all: &[f32] = bytemuck::cast_slice(&data);
    let result = all[..count.min(all.len())].to_vec();
    drop(data);
    buffer.unmap();
    result
}

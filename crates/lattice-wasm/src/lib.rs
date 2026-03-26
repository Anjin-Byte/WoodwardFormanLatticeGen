use wasm_bindgen::prelude::*;

pub mod vox_types;
pub mod csr;
pub mod gpu;
pub mod reference_cpu;
pub mod voxelize;

pub use crate::vox_types::{
    CompactVoxel, DispatchStats, MeshInput, SparseVoxelizationOutput,
    TileSpec, VoxelGridSpec, VoxelizationOutput, VoxelizeOpts,
};
pub use crate::gpu::{GpuSdfExporter, GpuVoxelizer, GpuVoxelizerConfig, SdfExportResult};

/// CPU SAT voxelizer — takes flat arrays, returns occupancy bitfield.
/// This is the fast path when WebGPU is not available.
#[wasm_bindgen]
pub fn voxelize_mesh(
    positions: &[f32],
    indices: &[u32],
    origin_x: f32,
    origin_y: f32,
    origin_z: f32,
    voxel_size: f32,
    nx: u32,
    ny: u32,
    nz: u32,
) -> Vec<u32> {
    voxelize::voxelize_surface(
        positions,
        indices,
        [origin_x, origin_y, origin_z],
        voxel_size,
        [nx, ny, nz],
    )
}

/// GPU-accelerated voxelizer handle, exposed to JS.
/// Create with `gpu_voxelizer_new()`, use with `gpu_voxelize()`.
#[wasm_bindgen]
pub struct WasmGpuVoxelizer {
    inner: GpuVoxelizer,
}

/// Initialize the GPU voxelizer. Returns a handle for repeated use.
/// Requires WebGPU support in the browser.
#[wasm_bindgen]
pub async fn gpu_voxelizer_new() -> Result<WasmGpuVoxelizer, JsValue> {
    let inner = GpuVoxelizer::new(GpuVoxelizerConfig::default())
        .await
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(WasmGpuVoxelizer { inner })
}

/// Run GPU voxelization on a triangle mesh. Returns occupancy bitfield.
#[wasm_bindgen]
impl WasmGpuVoxelizer {
    pub async fn voxelize(
        &self,
        positions: &[f32],
        indices: &[u32],
        origin_x: f32,
        origin_y: f32,
        origin_z: f32,
        voxel_size: f32,
        nx: u32,
        ny: u32,
        nz: u32,
    ) -> Result<Vec<u32>, JsValue> {
        use glam::Vec3;

        let grid = VoxelGridSpec {
            origin_world: Vec3::new(origin_x, origin_y, origin_z),
            voxel_size,
            dims: [nx, ny, nz],
            world_to_grid: None,
        };
        grid.validate().map_err(|e| JsValue::from_str(&e))?;

        // Build triangle list from flat arrays
        let tri_count = indices.len() / 3;
        let mut triangles = Vec::with_capacity(tri_count);
        for t in 0..tri_count {
            let i0 = indices[t * 3] as usize;
            let i1 = indices[t * 3 + 1] as usize;
            let i2 = indices[t * 3 + 2] as usize;
            triangles.push([
                Vec3::new(positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]),
                Vec3::new(positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]),
                Vec3::new(positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]),
            ]);
        }

        let mesh = MeshInput {
            triangles,
            material_ids: None,
        };

        let tiles = TileSpec::new([4, 4, 4], grid.dims)
            .map_err(|e| JsValue::from_str(&e))?;

        let opts = VoxelizeOpts {
            epsilon: 1e-4,
            store_owner: false,
            store_color: false,
        };

        let output = self.inner.voxelize_surface(&mesh, &grid, &tiles, &opts)
            .await
            .map_err(|e| JsValue::from_str(&e))?;

        Ok(output.occupancy)
    }
}

/// Generate a flat grid of vertex positions as [x, y, z, x, y, z, ...].
#[wasm_bindgen]
pub fn generate_grid(size: u32, spacing: f32) -> Vec<f32> {
    let count = (size * size) as usize;
    let mut positions = Vec::with_capacity(count * 3);
    let offset = (size as f32 - 1.0) * spacing * 0.5;

    for z in 0..size {
        for x in 0..size {
            positions.push(x as f32 * spacing - offset);
            positions.push(0.0);
            positions.push(z as f32 * spacing - offset);
        }
    }

    positions
}

/// GPU-accelerated SDF export handle, exposed to JS.
#[wasm_bindgen]
pub struct WasmGpuSdfExporter {
    inner: GpuSdfExporter,
}

/// Initialize the GPU SDF exporter. Returns a handle for repeated use.
#[wasm_bindgen]
pub async fn gpu_sdf_exporter_new() -> Result<WasmGpuSdfExporter, JsValue> {
    let inner = GpuSdfExporter::new()
        .await
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(WasmGpuSdfExporter { inner })
}

#[wasm_bindgen]
impl WasmGpuSdfExporter {
    /// Run GPU SDF eval + marching cubes. Returns flat positions (9 floats per triangle).
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
        accel_origin_x: f32,
        accel_origin_y: f32,
        accel_origin_z: f32,
        origin_x: f32,
        origin_y: f32,
        origin_z: f32,
        dims_x: u32,
        dims_y: u32,
        dims_z: u32,
        step: f32,
        smin_k: f32,
    ) -> Result<Vec<f32>, JsValue> {
        let result = self
            .inner
            .export(
                beam_p0,
                beam_p1,
                beam_r,
                cell_offsets,
                beam_indices,
                hash_table_size,
                accel_cell_size,
                [accel_origin_x, accel_origin_y, accel_origin_z],
                [origin_x, origin_y, origin_z],
                [dims_x, dims_y, dims_z],
                step,
                smin_k,
            )
            .await
            .map_err(|e| JsValue::from_str(&e))?;
        Ok(result.positions)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn voxelize_mesh_basic() {
        let positions = vec![
            0.1_f32, 0.1, 0.1,
            2.0, 0.1, 0.1,
            0.1, 2.0, 0.1,
        ];
        let indices = vec![0_u32, 1, 2];
        let occupancy = voxelize_mesh(&positions, &indices, 0.0, 0.0, 0.0, 1.0, 4, 4, 4);
        let occupied: u32 = occupancy.iter().map(|w| w.count_ones()).sum();
        assert!(occupied > 0);
    }

    #[test]
    fn grid_vertex_count() {
        let grid = generate_grid(4, 1.0);
        assert_eq!(grid.len(), 4 * 4 * 3);
    }
}

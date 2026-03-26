//! Surface voxelization using the Separating Axis Theorem (SAT).
//! Adapted from the Gestalt GPU voxelizer's CPU reference path.
//!
//! Given a triangle mesh and a voxel grid, produces an occupancy bitfield
//! marking which cells the mesh surface passes through.

use glam::Vec3;

/// SAT-based triangle-box overlap test (Akenine-Möller).
/// Tests 13 separating axes: 9 edge cross products, 3 AABB axes, 1 triangle normal.
pub fn triangle_box_overlap(box_center: Vec3, box_half: Vec3, v0: Vec3, v1: Vec3, v2: Vec3) -> bool {
    let v0 = v0 - box_center;
    let v1 = v1 - box_center;
    let v2 = v2 - box_center;

    let e0 = v1 - v0;
    let e1 = v2 - v1;
    let e2 = v0 - v2;

    // 9 edge-cross-product axes
    let axes = [
        Vec3::new(0.0, -e0.z, e0.y),
        Vec3::new(0.0, -e1.z, e1.y),
        Vec3::new(0.0, -e2.z, e2.y),
        Vec3::new(e0.z, 0.0, -e0.x),
        Vec3::new(e1.z, 0.0, -e1.x),
        Vec3::new(e2.z, 0.0, -e2.x),
        Vec3::new(-e0.y, e0.x, 0.0),
        Vec3::new(-e1.y, e1.x, 0.0),
        Vec3::new(-e2.y, e2.x, 0.0),
    ];

    for axis in axes.iter() {
        let p0 = v0.dot(*axis);
        let p1 = v1.dot(*axis);
        let p2 = v2.dot(*axis);
        let min_p = p0.min(p1.min(p2));
        let max_p = p0.max(p1.max(p2));
        let r = box_half.x * axis.x.abs() + box_half.y * axis.y.abs() + box_half.z * axis.z.abs();
        if min_p > r || max_p < -r {
            return false;
        }
    }

    // 3 AABB axes
    if v0.x.min(v1.x.min(v2.x)) > box_half.x
        || v0.x.max(v1.x.max(v2.x)) < -box_half.x
        || v0.y.min(v1.y.min(v2.y)) > box_half.y
        || v0.y.max(v1.y.max(v2.y)) < -box_half.y
        || v0.z.min(v1.z.min(v2.z)) > box_half.z
        || v0.z.max(v1.z.max(v2.z)) < -box_half.z
    {
        return false;
    }

    // Triangle face normal
    let normal = e0.cross(e1);
    let d = -normal.dot(v0);
    let r = box_half.x * normal.x.abs() + box_half.y * normal.y.abs() + box_half.z * normal.z.abs();
    let s = d; // normal.dot(origin=0) + d
    if s.abs() > r {
        return false;
    }

    true
}

/// Voxelize a triangle mesh surface against a uniform grid.
///
/// # Parameters
/// - `positions`: flat [x,y,z,...] vertex positions
/// - `indices`: flat [a,b,c,...] triangle vertex indices
/// - `origin`: grid world-space origin [x,y,z]
/// - `voxel_size`: cell edge length
/// - `dims`: grid dimensions [nx, ny, nz]
///
/// # Returns
/// Occupancy bitfield as Vec<u32>. Bit `n` of word `n/32` is set if voxel
/// at linear index `n` (x + nx*(y + ny*z)) intersects the mesh surface.
pub fn voxelize_surface(
    positions: &[f32],
    indices: &[u32],
    origin: [f32; 3],
    voxel_size: f32,
    dims: [u32; 3],
) -> Vec<u32> {
    let num_voxels = (dims[0] as usize) * (dims[1] as usize) * (dims[2] as usize);
    let word_count = (num_voxels + 31) / 32;
    let mut occupancy = vec![0u32; word_count];

    let inv_size = 1.0 / voxel_size;
    let half = Vec3::splat(0.5);
    let epsilon = 1e-4_f32;
    let tri_count = indices.len() / 3;

    for t in 0..tri_count {
        let i0 = indices[t * 3] as usize;
        let i1 = indices[t * 3 + 1] as usize;
        let i2 = indices[t * 3 + 2] as usize;

        // Transform to grid space
        let v0 = Vec3::new(
            (positions[i0 * 3]     - origin[0]) * inv_size,
            (positions[i0 * 3 + 1] - origin[1]) * inv_size,
            (positions[i0 * 3 + 2] - origin[2]) * inv_size,
        );
        let v1 = Vec3::new(
            (positions[i1 * 3]     - origin[0]) * inv_size,
            (positions[i1 * 3 + 1] - origin[1]) * inv_size,
            (positions[i1 * 3 + 2] - origin[2]) * inv_size,
        );
        let v2 = Vec3::new(
            (positions[i2 * 3]     - origin[0]) * inv_size,
            (positions[i2 * 3 + 1] - origin[1]) * inv_size,
            (positions[i2 * 3 + 2] - origin[2]) * inv_size,
        );

        let min_v = v0.min(v1).min(v2) - Vec3::splat(epsilon);
        let max_v = v0.max(v1).max(v2) + Vec3::splat(epsilon);

        let min_cell = [
            (min_v.x.floor() as i32).clamp(0, dims[0] as i32 - 1),
            (min_v.y.floor() as i32).clamp(0, dims[1] as i32 - 1),
            (min_v.z.floor() as i32).clamp(0, dims[2] as i32 - 1),
        ];
        let max_cell = [
            (max_v.x.floor() as i32).clamp(0, dims[0] as i32 - 1),
            (max_v.y.floor() as i32).clamp(0, dims[1] as i32 - 1),
            (max_v.z.floor() as i32).clamp(0, dims[2] as i32 - 1),
        ];

        for z in min_cell[2]..=max_cell[2] {
            for y in min_cell[1]..=max_cell[1] {
                for x in min_cell[0]..=max_cell[0] {
                    let center = Vec3::new(x as f32 + 0.5, y as f32 + 0.5, z as f32 + 0.5);
                    if triangle_box_overlap(center, half, v0, v1, v2) {
                        let linear = (x as usize)
                            + (dims[0] as usize) * ((y as usize) + (dims[1] as usize) * (z as usize));
                        let word = linear >> 5;
                        let bit = linear & 31;
                        occupancy[word] |= 1u32 << bit;
                    }
                }
            }
        }
    }

    occupancy
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_triangle_produces_occupied_voxels() {
        let positions = vec![
            0.1, 0.1, 0.1,
            1.2, 0.1, 0.1,
            0.1, 1.2, 0.1,
        ];
        let indices = vec![0, 1, 2];
        let occupancy = voxelize_surface(&positions, &indices, [0.0, 0.0, 0.0], 1.0, [4, 4, 4]);
        let occupied: u32 = occupancy.iter().map(|w| w.count_ones()).sum();
        assert!(occupied > 0, "expected at least one occupied voxel");
    }

    #[test]
    fn triangle_outside_grid_produces_no_voxels() {
        let positions = vec![
            10.0, 10.0, 10.0,
            11.0, 10.0, 10.0,
            10.0, 11.0, 10.0,
        ];
        let indices = vec![0, 1, 2];
        let occupancy = voxelize_surface(&positions, &indices, [0.0, 0.0, 0.0], 1.0, [4, 4, 4]);
        let occupied: u32 = occupancy.iter().map(|w| w.count_ones()).sum();
        assert_eq!(occupied, 0);
    }

    #[test]
    fn sat_box_overlap_works() {
        let center = Vec3::new(0.5, 0.5, 0.5);
        let half = Vec3::splat(0.5);
        // Triangle passing through the box
        let v0 = Vec3::new(0.0, 0.0, 0.0);
        let v1 = Vec3::new(1.0, 0.0, 0.0);
        let v2 = Vec3::new(0.0, 1.0, 0.0);
        assert!(triangle_box_overlap(center, half, v0, v1, v2));

        // Triangle far away
        let v0 = Vec3::new(5.0, 5.0, 5.0);
        let v1 = Vec3::new(6.0, 5.0, 5.0);
        let v2 = Vec3::new(5.0, 6.0, 5.0);
        assert!(!triangle_box_overlap(center, half, v0, v1, v2));
    }
}

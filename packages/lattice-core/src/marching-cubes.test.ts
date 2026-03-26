import { describe, it, expect } from 'vitest';
import { marchingCubes, MC_EDGE_TABLE, MC_TRI_TABLE } from './marching-cubes.js';

function buildSphereSdf(
  center: [number, number, number],
  radius: number,
  origin: [number, number, number],
  dims: [number, number, number],
  step: number,
): Float32Array {
  const [nx, ny, nz] = dims;
  const values = new Float32Array(nx * ny * nz);
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const px = origin[0] + x * step;
        const py = origin[1] + y * step;
        const pz = origin[2] + z * step;
        const dx = px - center[0];
        const dy = py - center[1];
        const dz = pz - center[2];
        values[x + nx * (y + ny * z)] = Math.sqrt(dx * dx + dy * dy + dz * dz) - radius;
      }
    }
  }
  return values;
}

describe('MC lookup tables', () => {
  it('edge table has 256 entries', () => {
    expect(MC_EDGE_TABLE.length).toBe(256);
  });

  it('triangle table has 256×16 entries', () => {
    expect(MC_TRI_TABLE.length).toBe(256 * 16);
  });

  it('case 0 (all outside) has no edges or triangles', () => {
    expect(MC_EDGE_TABLE[0]).toBe(0);
    expect(MC_TRI_TABLE[0]).toBe(-1);
  });

  it('case 255 (all inside) has no edges or triangles', () => {
    expect(MC_EDGE_TABLE[255]).toBe(0);
    expect(MC_TRI_TABLE[255 * 16]).toBe(-1);
  });
});

describe('marchingCubes', () => {
  it('extracts a sphere isosurface', () => {
    const dims: [number, number, number] = [20, 20, 20];
    const step = 0.2;
    const origin: [number, number, number] = [-2, -2, -2];
    const center: [number, number, number] = [0, 0, 0];
    const radius = 1.0;

    const sdf = buildSphereSdf(center, radius, origin, dims, step);
    const result = marchingCubes(sdf, origin, dims, step);

    expect(result.triangleCount).toBeGreaterThan(0);
    expect(result.vertexCount).toBe(result.triangleCount * 3); // non-welded

    // All vertices should be approximately on the sphere surface
    for (let i = 0; i < result.vertexCount; i++) {
      const x = result.positions[i * 3];
      const y = result.positions[i * 3 + 1];
      const z = result.positions[i * 3 + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);
      // MC interpolation error bounded by step * sqrt(3)
      expect(Math.abs(dist - radius)).toBeLessThan(step * Math.sqrt(3));
    }
  });

  it('returns 0 triangles for all-positive SDF', () => {
    const dims: [number, number, number] = [4, 4, 4];
    const values = new Float32Array(4 * 4 * 4).fill(1.0);
    const result = marchingCubes(values, [0, 0, 0], dims, 1.0);
    expect(result.triangleCount).toBe(0);
    expect(result.vertexCount).toBe(0);
  });

  it('returns 0 triangles for all-negative SDF', () => {
    const dims: [number, number, number] = [4, 4, 4];
    const values = new Float32Array(4 * 4 * 4).fill(-1.0);
    const result = marchingCubes(values, [0, 0, 0], dims, 1.0);
    expect(result.triangleCount).toBe(0);
    expect(result.vertexCount).toBe(0);
  });

  it('indices reference valid vertices', () => {
    const dims: [number, number, number] = [10, 10, 10];
    const sdf = buildSphereSdf([0, 0, 0], 0.5, [-1, -1, -1], dims, 0.2);
    const result = marchingCubes(sdf, [-1, -1, -1], dims, 0.2);

    for (let i = 0; i < result.triangleCount * 3; i++) {
      expect(result.indices[i]).toBeLessThan(result.vertexCount);
      expect(result.indices[i]).toBeGreaterThanOrEqual(0);
    }
  });
});

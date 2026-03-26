import { describe, it, expect } from 'vitest';
import { createTriangleMesh, tessellateBox, tessellateSphere, triangleBounds } from './triangle-mesh.js';

describe('createTriangleMesh', () => {
  it('computes correct AABB', () => {
    const positions = new Float32Array([0, 0, 0, 1, 2, 3, -1, 0, 5]);
    const indices = new Uint32Array([0, 1, 2]);
    const mesh = createTriangleMesh(positions, indices);
    expect(mesh.aabbMin).toEqual([-1, 0, 0]);
    expect(mesh.aabbMax).toEqual([1, 2, 5]);
  });

  it('computes vertex and triangle counts', () => {
    const positions = new Float32Array(9);
    const indices = new Uint32Array([0, 1, 2]);
    const mesh = createTriangleMesh(positions, indices);
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.triangleCount).toBe(1);
  });

  it('throws for out-of-range indices', () => {
    const positions = new Float32Array(9);
    const indices = new Uint32Array([0, 1, 5]);
    expect(() => createTriangleMesh(positions, indices)).toThrow('out of range');
  });

  it('throws for non-divisible-by-3 positions', () => {
    const positions = new Float32Array(7);
    const indices = new Uint32Array([0, 1, 2]);
    expect(() => createTriangleMesh(positions, indices)).toThrow('divisible by 3');
  });
});

describe('tessellateBox', () => {
  const mesh = tessellateBox([0, 0, 0], [1, 2, 3]);

  it('has 8 vertices', () => {
    expect(mesh.vertexCount).toBe(8);
  });

  it('has 12 triangles', () => {
    expect(mesh.triangleCount).toBe(12);
  });

  it('AABB matches input', () => {
    expect(mesh.aabbMin[0]).toBeCloseTo(0);
    expect(mesh.aabbMin[1]).toBeCloseTo(0);
    expect(mesh.aabbMin[2]).toBeCloseTo(0);
    expect(mesh.aabbMax[0]).toBeCloseTo(1);
    expect(mesh.aabbMax[1]).toBeCloseTo(2);
    expect(mesh.aabbMax[2]).toBeCloseTo(3);
  });

  it('all indices in range', () => {
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeLessThan(mesh.vertexCount);
    }
  });
});

describe('tessellateSphere', () => {
  const mesh = tessellateSphere([0, 0, 0], 1, 8, 16);

  it('has expected vertex count', () => {
    // 2 poles + (latSegments - 1) rings × lonSegments = 2 + 7*16 = 114
    expect(mesh.vertexCount).toBe(2 + (8 - 1) * 16);
  });

  it('has expected triangle count', () => {
    // Top cap: lonSegments, bottom cap: lonSegments, body: (latSegments-2)*lonSegments*2
    expect(mesh.triangleCount).toBe(16 + 16 + (8 - 2) * 16 * 2);
  });

  it('all vertices are approximately on the sphere surface', () => {
    for (let i = 0; i < mesh.vertexCount; i++) {
      const x = mesh.positions[i * 3];
      const y = mesh.positions[i * 3 + 1];
      const z = mesh.positions[i * 3 + 2];
      const dist = Math.sqrt(x * x + y * y + z * z);
      expect(dist).toBeCloseTo(1, 5);
    }
  });

  it('AABB approximates [-r, r]³', () => {
    expect(mesh.aabbMin[0]).toBeLessThan(-0.95);
    expect(mesh.aabbMin[1]).toBeCloseTo(-1, 5);
    expect(mesh.aabbMax[0]).toBeGreaterThan(0.95);
    expect(mesh.aabbMax[1]).toBeCloseTo(1, 5);
  });

  it('all indices in range', () => {
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeLessThan(mesh.vertexCount);
    }
  });
});

describe('triangleBounds', () => {
  it('computes correct bounds for a triangle', () => {
    const mesh = tessellateBox([0, 0, 0], [1, 1, 1]);
    const bounds = triangleBounds(mesh, 0);
    // First triangle of the box — bounds should be within [0,1]³
    for (let d = 0; d < 3; d++) {
      expect(bounds.min[d]).toBeGreaterThanOrEqual(0);
      expect(bounds.max[d]).toBeLessThanOrEqual(1);
    }
  });
});

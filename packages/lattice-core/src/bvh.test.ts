import { describe, it, expect } from 'vitest';
import { buildBVH, bvhRaycast, bvhIntersectSegment, rayTriangleIntersect } from './bvh.js';
import { tessellateBox, tessellateSphere } from './triangle-mesh.js';

describe('rayTriangleIntersect', () => {
  it('hits a triangle in the XY plane', () => {
    const t = rayTriangleIntersect(
      0.25, 0.25, -1,  // origin
      0, 0, 1,          // direction (+z)
      0, 0, 0,          // v0
      1, 0, 0,          // v1
      0, 1, 0,          // v2
    );
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(1);
  });

  it('misses a triangle', () => {
    const t = rayTriangleIntersect(
      5, 5, -1,  0, 0, 1,
      0, 0, 0,  1, 0, 0,  0, 1, 0,
    );
    expect(t).toBeNull();
  });
});

describe('buildBVH', () => {
  it('builds on a box mesh', () => {
    const mesh = tessellateBox([0, 0, 0], [1, 1, 1]);
    const bvh = buildBVH(mesh);
    expect(bvh.nodeCount).toBeGreaterThan(0);
    expect(bvh.triOrder.length).toBe(mesh.triangleCount);
  });

  it('builds on a sphere mesh', () => {
    const mesh = tessellateSphere([0, 0, 0], 1, 8, 16);
    const bvh = buildBVH(mesh);
    expect(bvh.nodeCount).toBeGreaterThan(0);
  });
});

describe('bvhRaycast', () => {
  it('ray through box center: even hit count (2 face crossings)', () => {
    const mesh = tessellateBox([0, 0, 0], [1, 1, 1]);
    const bvh = buildBVH(mesh);
    // Ray from (-1, 0.3, 0.3) in +x — avoid triangle edges
    const count = bvhRaycast(bvh, mesh, -1, 0.3, 0.3, 1, 0, 0);
    expect(count).toBeGreaterThan(0);
    expect(count % 2).toBe(0); // even = entered and exited
  });

  it('ray missing box: 0 hits', () => {
    const mesh = tessellateBox([0, 0, 0], [1, 1, 1]);
    const bvh = buildBVH(mesh);
    const count = bvhRaycast(bvh, mesh, 5, 5, 5, 1, 0, 0);
    expect(count).toBe(0);
  });

  it('ray from inside box: odd hit count', () => {
    const mesh = tessellateBox([0, 0, 0], [2, 2, 2]);
    const bvh = buildBVH(mesh);
    // Slightly off-axis ray to avoid edge/vertex degeneracies
    const count = bvhRaycast(bvh, mesh, 1, 0.7, 0.7, 0.99, 0.01, 0.003);
    expect(count).toBeGreaterThan(0);
    expect(count % 2).toBe(1); // odd = inside
  });
});

describe('bvhIntersectSegment', () => {
  it('segment from inside to outside box: valid t', () => {
    const mesh = tessellateBox([0, 0, 0], [1, 1, 1]);
    const bvh = buildBVH(mesh);
    // Segment from (0.5, 0.5, 0.5) to (2, 0.5, 0.5) — exits at x=1
    const t = bvhIntersectSegment(bvh, mesh, 0.5, 0.5, 0.5, 2, 0.5, 0.5);
    expect(t).not.toBeNull();
    // t should be about 0.5/1.5 ≈ 0.333
    expect(t!).toBeCloseTo(1 / 3, 1);
  });

  it('segment fully outside: null', () => {
    const mesh = tessellateBox([0, 0, 0], [1, 1, 1]);
    const bvh = buildBVH(mesh);
    const t = bvhIntersectSegment(bvh, mesh, 5, 5, 5, 6, 5, 5);
    expect(t).toBeNull();
  });

  it('segment fully inside: returns nearest wall hit', () => {
    const mesh = tessellateBox([0, 0, 0], [2, 2, 2]);
    const bvh = buildBVH(mesh);
    // Segment from (1,1,1) to (1,1,0.5) — both inside, but wall at z=0 is at t > 1
    // Actually both inside means no hit in [0,1]... but the segment might intersect walls
    // Let's test: (1,1,1) to (1,1,3) — exits at z=2
    const t = bvhIntersectSegment(bvh, mesh, 1, 1, 1, 1, 1, 3);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0.5, 1); // (2-1)/(3-1) = 0.5
  });
});

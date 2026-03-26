import { describe, it, expect } from 'vitest';
import { createMeshDomain } from './mesh-domain.js';
import { createBoxDomain, createSphereDomain } from './domain.js';
import { tessellateBox, tessellateSphere } from './triangle-mesh.js';

describe('createMeshDomain (box)', () => {
  const meshDomain = createMeshDomain(tessellateBox([0, 0, 0], [2, 2, 2]));
  const analyticDomain = createBoxDomain([0, 0, 0], [2, 2, 2]);

  it('contains matches analytic for interior points', () => {
    const testPoints: [number, number, number][] = [
      [1, 1, 1], [0.5, 0.5, 0.5], [1.5, 1.5, 1.5], [0.1, 0.1, 0.1],
    ];
    for (const [x, y, z] of testPoints) {
      expect(meshDomain.contains(x, y, z)).toBe(analyticDomain.contains(x, y, z));
    }
  });

  it('contains matches analytic for exterior points', () => {
    const testPoints: [number, number, number][] = [
      [3, 1, 1], [-1, 1, 1], [1, 3, 1], [1, 1, -1],
    ];
    for (const [x, y, z] of testPoints) {
      expect(meshDomain.contains(x, y, z)).toBe(analyticDomain.contains(x, y, z));
    }
  });

  it('intersectSegment: fully inside returns null', () => {
    expect(meshDomain.intersectSegment(0.5, 0.5, 0.5, 1.5, 1.5, 1.5)).toBeNull();
  });

  it('intersectSegment: crossing returns valid t', () => {
    const t = meshDomain.intersectSegment(1, 1, 1, 4, 1, 1);
    expect(t).not.toBeNull();
    // Exit at x=2, so t ≈ (2-1)/(4-1) = 0.333
    expect(t!).toBeCloseTo(1 / 3, 1);
  });
});

describe('createMeshDomain (sphere)', () => {
  const meshDomain = createMeshDomain(tessellateSphere([0, 0, 0], 2, 32, 64));
  const analyticDomain = createSphereDomain([0, 0, 0], 2);

  it('contains matches analytic for clearly interior points', () => {
    const testPoints: [number, number, number][] = [
      [0, 0, 0], [0.5, 0.5, 0.5], [1, 0, 0], [0, 1, 0],
    ];
    for (const [x, y, z] of testPoints) {
      expect(meshDomain.contains(x, y, z)).toBe(true);
    }
  });

  it('contains matches analytic for clearly exterior points', () => {
    const testPoints: [number, number, number][] = [
      [3, 0, 0], [0, 3, 0], [0, 0, 3], [2.5, 2.5, 2.5],
    ];
    for (const [x, y, z] of testPoints) {
      expect(meshDomain.contains(x, y, z)).toBe(false);
    }
  });

  it('intersectSegment from center outward returns valid t', () => {
    const t = meshDomain.intersectSegment(0, 0, 0, 4, 0.1, 0.1);
    expect(t).not.toBeNull();
    // Sphere radius 2, direction ≈ (4, 0.1, 0.1), length ≈ 4.003
    // Exit at distance ≈ 2 from center, t ≈ 2/4 ≈ 0.5
    expect(t!).toBeGreaterThan(0.3);
    expect(t!).toBeLessThan(0.7);
  });
});

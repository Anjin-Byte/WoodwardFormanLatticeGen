import { describe, it, expect } from 'vitest';
import { createBoxDomain, createCylinderDomain, createSphereDomain } from './domain.js';

describe('createBoxDomain', () => {
  const box = createBoxDomain([0, 0, 0], [1, 1, 1]);

  it('contains interior point', () => {
    expect(box.contains(0.5, 0.5, 0.5)).toBe(true);
  });

  it('contains corner point', () => {
    expect(box.contains(0, 0, 0)).toBe(true);
    expect(box.contains(1, 1, 1)).toBe(true);
  });

  it('rejects exterior point', () => {
    expect(box.contains(2, 0.5, 0.5)).toBe(false);
    expect(box.contains(-1, 0.5, 0.5)).toBe(false);
  });

  it('intersectSegment: fully inside returns null', () => {
    expect(box.intersectSegment(0.2, 0.2, 0.2, 0.8, 0.8, 0.8)).toBeNull();
  });

  it('intersectSegment: crossing returns valid t', () => {
    // Segment from (0.5, 0.5, 0.5) to (2, 0.5, 0.5) — exits at x=1
    const t = box.intersectSegment(0.5, 0.5, 0.5, 2, 0.5, 0.5);
    expect(t).not.toBeNull();
    // t should be 0.5/1.5 ≈ 0.333
    expect(t!).toBeCloseTo(1 / 3, 2);
  });

  it('intersectSegment: fully outside returns 0', () => {
    const t = box.intersectSegment(2, 2, 2, 3, 3, 3);
    expect(t).toBe(0);
  });
});

describe('createSphereDomain', () => {
  const sphere = createSphereDomain([0, 0, 0], 1);

  it('contains center', () => {
    expect(sphere.contains(0, 0, 0)).toBe(true);
  });

  it('contains point on surface', () => {
    expect(sphere.contains(1, 0, 0)).toBe(true);
  });

  it('rejects exterior point', () => {
    expect(sphere.contains(2, 0, 0)).toBe(false);
  });

  it('intersectSegment: fully inside returns null', () => {
    expect(sphere.intersectSegment(0, 0, 0, 0.5, 0, 0)).toBeNull();
  });

  it('intersectSegment: crossing returns valid t', () => {
    // From (0, 0, 0) to (2, 0, 0) — exits at x=1, so t=0.5
    const t = sphere.intersectSegment(0, 0, 0, 2, 0, 0);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0.5, 5);
  });

  it('intersectSegment: fully outside returns 0', () => {
    const t = sphere.intersectSegment(3, 0, 0, 4, 0, 0);
    expect(t).toBe(0);
  });
});

describe('createCylinderDomain', () => {
  const cylinder = createCylinderDomain([0, 0, 0], 1, 4);

  it('contains center', () => {
    expect(cylinder.contains(0, 0, 0)).toBe(true);
  });

  it('contains points on sidewall and caps', () => {
    expect(cylinder.contains(1, 0, 0)).toBe(true);
    expect(cylinder.contains(0, 0, 2)).toBe(true);
  });

  it('rejects points outside radius or length', () => {
    expect(cylinder.contains(1.1, 0, 0)).toBe(false);
    expect(cylinder.contains(0, 0, 2.1)).toBe(false);
  });

  it('intersectSegment: fully inside returns null', () => {
    expect(cylinder.intersectSegment(0, 0, -1, 0, 0, 1)).toBeNull();
  });

  it('intersectSegment: sidewall crossing returns valid t', () => {
    const t = cylinder.intersectSegment(0, 0, 0, 2, 0, 0);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0.5, 5);
  });

  it('intersectSegment: cap crossing returns valid t', () => {
    const t = cylinder.intersectSegment(0, 0, 0, 0, 0, 4);
    expect(t).not.toBeNull();
    expect(t!).toBeCloseTo(0.5, 5);
  });

  it('intersectSegment: outside-to-outside through cylinder returns first hit', () => {
    const t = cylinder.intersectSegment(-2, 0, 0, 2, 0, 0);
    expect(t).toBeCloseTo(0.25, 5);
  });

  it('intersectSegment: fully outside returns 0', () => {
    expect(cylinder.intersectSegment(2, 2, 0, 3, 3, 0)).toBe(0);
  });
});

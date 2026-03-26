import { describe, it, expect } from 'vitest';
import { clamp, lerp, mapRange } from './math.js';

describe('clamp', () => {
  it('clamps below min', () => {
    expect(clamp(-1, 0, 10)).toBe(0);
  });
  it('clamps above max', () => {
    expect(clamp(15, 0, 10)).toBe(10);
  });
  it('passes through values in range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });
});

describe('lerp', () => {
  it('interpolates at t=0', () => {
    expect(lerp(0, 10, 0)).toBe(0);
  });
  it('interpolates at t=1', () => {
    expect(lerp(0, 10, 1)).toBe(10);
  });
  it('interpolates at t=0.5', () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe('mapRange', () => {
  it('maps value from one range to another', () => {
    expect(mapRange(5, 0, 10, 0, 100)).toBe(50);
  });
});

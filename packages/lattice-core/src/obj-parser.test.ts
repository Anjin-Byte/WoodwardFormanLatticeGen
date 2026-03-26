import { describe, it, expect } from 'vitest';
import { parseOBJ } from './obj-parser.js';

describe('parseOBJ', () => {
  it('parses a single triangle', () => {
    const text = `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
    const mesh = parseOBJ(text);
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.triangleCount).toBe(1);
  });

  it('parses a cube (8 vertices, 6 quads → 12 triangles)', () => {
    const text = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
v 0 0 1
v 1 0 1
v 1 1 1
v 0 1 1
f 1 2 3 4
f 5 8 7 6
f 1 5 6 2
f 2 6 7 3
f 3 7 8 4
f 4 8 5 1
`;
    const mesh = parseOBJ(text);
    expect(mesh.vertexCount).toBe(8);
    expect(mesh.triangleCount).toBe(12); // 6 quads × 2
  });

  it('handles v/vt/vn style indices', () => {
    const text = `
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 1
vt 0 0
f 1/1/1 2/1/1 3/1/1
`;
    const mesh = parseOBJ(text);
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.triangleCount).toBe(1);
  });

  it('handles v/vt style indices', () => {
    const text = `
v 0 0 0
v 1 0 0
v 0 1 0
vt 0 0
f 1/1 2/1 3/1
`;
    const mesh = parseOBJ(text);
    expect(mesh.triangleCount).toBe(1);
  });

  it('fan-triangulates n-gon faces', () => {
    const text = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0.5 1.5 0
v 0 1 0
f 1 2 3 4 5
`;
    const mesh = parseOBJ(text);
    // Pentagon → 3 triangles
    expect(mesh.triangleCount).toBe(3);
  });

  it('ignores comments and unsupported lines', () => {
    const text = `
# This is a comment
mtllib material.mtl
usemtl default
o MyObject
g Group1
s 1
v 0 0 0
v 1 0 0
v 0 1 0
vn 0 0 1
f 1 2 3
`;
    const mesh = parseOBJ(text);
    expect(mesh.vertexCount).toBe(3);
    expect(mesh.triangleCount).toBe(1);
  });

  it('all indices are in range', () => {
    const text = `
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1 2 3 4
`;
    const mesh = parseOBJ(text);
    for (let i = 0; i < mesh.indices.length; i++) {
      expect(mesh.indices[i]).toBeLessThan(mesh.vertexCount);
    }
  });
});

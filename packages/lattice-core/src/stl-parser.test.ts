import { describe, it, expect } from 'vitest';
import { parseSTL } from './stl-parser.js';

function makeBinarySTL(triangles: [number, number, number][][]): ArrayBuffer {
  const triCount = triangles.length;
  const buffer = new ArrayBuffer(80 + 4 + triCount * 50);
  const view = new DataView(buffer);

  // Header (80 bytes of zeros)
  view.setUint32(80, triCount, true);

  let offset = 84;
  for (const tri of triangles) {
    // Normal (skip — 12 bytes of zeros)
    offset += 12;
    // 3 vertices
    for (const [x, y, z] of tri) {
      view.setFloat32(offset, x, true); offset += 4;
      view.setFloat32(offset, y, true); offset += 4;
      view.setFloat32(offset, z, true); offset += 4;
    }
    // Attribute byte count
    offset += 2;
  }

  return buffer;
}

describe('parseSTL (binary)', () => {
  it('parses a single triangle', () => {
    const buffer = makeBinarySTL([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
    ]);
    const mesh = parseSTL(buffer);
    expect(mesh.triangleCount).toBe(1);
    expect(mesh.vertexCount).toBe(3);
  });

  it('parses a tetrahedron (4 triangles)', () => {
    const buffer = makeBinarySTL([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[0, 0, 0], [1, 0, 0], [0, 0, 1]],
      [[0, 0, 0], [0, 1, 0], [0, 0, 1]],
      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    ]);
    const mesh = parseSTL(buffer);
    expect(mesh.triangleCount).toBe(4);
    // 4 unique vertices after welding
    expect(mesh.vertexCount).toBe(4);
  });

  it('welds shared vertices', () => {
    // Two triangles sharing an edge
    const buffer = makeBinarySTL([
      [[0, 0, 0], [1, 0, 0], [0, 1, 0]],
      [[1, 0, 0], [1, 1, 0], [0, 1, 0]],
    ]);
    const mesh = parseSTL(buffer);
    expect(mesh.triangleCount).toBe(2);
    // 4 unique vertices (2 shared)
    expect(mesh.vertexCount).toBe(4);
  });
});

describe('parseSTL (ASCII)', () => {
  it('parses ASCII STL', () => {
    const text = `solid test
facet normal 0 0 1
  outer loop
    vertex 0 0 0
    vertex 1 0 0
    vertex 0 1 0
  endloop
endfacet
facet normal 0 0 1
  outer loop
    vertex 1 0 0
    vertex 1 1 0
    vertex 0 1 0
  endloop
endfacet
endsolid test`;

    // Force ASCII path by making it not match binary size check
    const encoder = new TextEncoder();
    const buffer = encoder.encode(text).buffer;
    const mesh = parseSTL(buffer);

    expect(mesh.triangleCount).toBe(2);
    expect(mesh.vertexCount).toBe(4);
  });
});

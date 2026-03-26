import { describe, it, expect } from 'vitest';
import { exportSTL } from './export-stl.js';
import { parseSTL } from './stl-parser.js';

// A simple 2-triangle quad for testing
function makeQuad() {
  const positions = new Float32Array([
    0, 0, 0,
    1, 0, 0,
    1, 1, 0,
    0, 1, 0,
  ]);
  const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);
  return { positions, indices, triangleCount: 2 };
}

describe('exportSTL', () => {
  it('produces correct byte count', () => {
    const { positions, indices, triangleCount } = makeQuad();
    const buffer = exportSTL(positions, indices, triangleCount);
    expect(buffer.byteLength).toBe(80 + 4 + triangleCount * 50);
  });

  it('writes correct triangle count in header', () => {
    const { positions, indices, triangleCount } = makeQuad();
    const buffer = exportSTL(positions, indices, triangleCount);
    const view = new DataView(buffer);
    expect(view.getUint32(80, true)).toBe(triangleCount);
  });

  it('round-trips through parseSTL', () => {
    const { positions, indices, triangleCount } = makeQuad();
    const buffer = exportSTL(positions, indices, triangleCount);
    const parsed = parseSTL(buffer);

    expect(parsed.triangleCount).toBe(triangleCount);

    // Verify vertex positions survive the round-trip
    // parseSTL welds vertices, so we check triangle-by-triangle
    for (let t = 0; t < triangleCount; t++) {
      for (let v = 0; v < 3; v++) {
        const origIdx = indices[t * 3 + v];
        const parsedIdx = parsed.indices[t * 3 + v];
        const ox = positions[origIdx * 3];
        const oy = positions[origIdx * 3 + 1];
        const oz = positions[origIdx * 3 + 2];
        const px = parsed.positions[parsedIdx * 3];
        const py = parsed.positions[parsedIdx * 3 + 1];
        const pz = parsed.positions[parsedIdx * 3 + 2];
        expect(px).toBeCloseTo(ox, 4);
        expect(py).toBeCloseTo(oy, 4);
        expect(pz).toBeCloseTo(oz, 4);
      }
    }
  });

  it('produces unit-length normals', () => {
    const { positions, indices, triangleCount } = makeQuad();
    const buffer = exportSTL(positions, indices, triangleCount);
    const view = new DataView(buffer);

    let offset = 84;
    for (let t = 0; t < triangleCount; t++) {
      const nx = view.getFloat32(offset, true);
      const ny = view.getFloat32(offset + 4, true);
      const nz = view.getFloat32(offset + 8, true);
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      expect(len).toBeCloseTo(1.0, 4);
      offset += 50;
    }
  });

  it('handles single triangle', () => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    const buffer = exportSTL(positions, indices, 1);
    expect(buffer.byteLength).toBe(80 + 4 + 50);

    const parsed = parseSTL(buffer);
    expect(parsed.triangleCount).toBe(1);
  });
});

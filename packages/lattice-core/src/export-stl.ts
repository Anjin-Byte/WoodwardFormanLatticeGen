/**
 * Binary STL writer. Inverse of stl-parser.ts.
 * Format: 80-byte header + uint32 triangle count + 50 bytes per triangle.
 */
export function exportSTL(
  positions: Float32Array,
  indices: Uint32Array,
  triangleCount: number,
): ArrayBuffer {
  const size = 80 + 4 + triangleCount * 50;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);

  // Header: 80 bytes ASCII
  const header = 'Exported by LatticeGen';
  for (let i = 0; i < header.length && i < 80; i++) {
    view.setUint8(i, header.charCodeAt(i));
  }

  // Triangle count
  view.setUint32(80, triangleCount, true);

  let offset = 84;
  for (let t = 0; t < triangleCount; t++) {
    const i0 = indices[t * 3];
    const i1 = indices[t * 3 + 1];
    const i2 = indices[t * 3 + 2];

    const v0x = positions[i0 * 3], v0y = positions[i0 * 3 + 1], v0z = positions[i0 * 3 + 2];
    const v1x = positions[i1 * 3], v1y = positions[i1 * 3 + 1], v1z = positions[i1 * 3 + 2];
    const v2x = positions[i2 * 3], v2y = positions[i2 * 3 + 1], v2z = positions[i2 * 3 + 2];

    // Face normal = normalize(cross(v1-v0, v2-v0))
    const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
    const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    // Normal
    view.setFloat32(offset, nx, true); offset += 4;
    view.setFloat32(offset, ny, true); offset += 4;
    view.setFloat32(offset, nz, true); offset += 4;

    // Vertex 0
    view.setFloat32(offset, v0x, true); offset += 4;
    view.setFloat32(offset, v0y, true); offset += 4;
    view.setFloat32(offset, v0z, true); offset += 4;

    // Vertex 1
    view.setFloat32(offset, v1x, true); offset += 4;
    view.setFloat32(offset, v1y, true); offset += 4;
    view.setFloat32(offset, v1z, true); offset += 4;

    // Vertex 2
    view.setFloat32(offset, v2x, true); offset += 4;
    view.setFloat32(offset, v2y, true); offset += 4;
    view.setFloat32(offset, v2z, true); offset += 4;

    // Attribute byte count (0)
    view.setUint16(offset, 0, true); offset += 2;
  }

  return buffer;
}

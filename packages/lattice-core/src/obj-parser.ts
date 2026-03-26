import { createTriangleMesh } from './triangle-mesh.js';
import type { TriangleMesh } from './pipeline-types.js';

export function parseOBJ(text: string): TriangleMesh {
  const positions: number[] = [];
  const indices: number[] = [];

  const lines = text.split('\n');

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (line.length === 0 || line[0] === '#') continue;

    const parts = line.split(/\s+/);
    const type = parts[0];

    if (type === 'v' && parts.length >= 4) {
      positions.push(
        parseFloat(parts[1]),
        parseFloat(parts[2]),
        parseFloat(parts[3]),
      );
    } else if (type === 'f' && parts.length >= 4) {
      // Parse face vertex indices (1-based, may have v/vt/vn format)
      const faceIndices: number[] = [];
      for (let i = 1; i < parts.length; i++) {
        const vertexStr = parts[i].split('/')[0];
        const idx = parseInt(vertexStr, 10);
        // OBJ is 1-based; negative indices count from end
        if (idx > 0) {
          faceIndices.push(idx - 1);
        } else if (idx < 0) {
          faceIndices.push(positions.length / 3 + idx);
        }
      }

      // Fan-triangulate: for n vertices, emit (n-2) triangles
      for (let i = 1; i < faceIndices.length - 1; i++) {
        indices.push(faceIndices[0], faceIndices[i], faceIndices[i + 1]);
      }
    }
    // Ignore vn, vt, mtllib, usemtl, g, o, s, etc.
  }

  return createTriangleMesh(
    new Float32Array(positions),
    new Uint32Array(indices),
  );
}

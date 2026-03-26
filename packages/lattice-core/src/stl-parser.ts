import { createTriangleMesh } from './triangle-mesh.js';
import type { TriangleMesh } from './pipeline-types.js';

export function parseSTL(buffer: ArrayBuffer): TriangleMesh {
  if (isBinarySTL(buffer)) {
    return parseBinarySTL(buffer);
  }
  return parseAsciiSTL(new TextDecoder().decode(buffer));
}

function isBinarySTL(buffer: ArrayBuffer): boolean {
  if (buffer.byteLength < 84) return false;
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);
  const expectedSize = 80 + 4 + triCount * 50;
  return buffer.byteLength === expectedSize;
}

function parseBinarySTL(buffer: ArrayBuffer): TriangleMesh {
  const view = new DataView(buffer);
  const triCount = view.getUint32(80, true);

  // Each triangle: 12 bytes normal + 36 bytes (3 vertices × 3 floats × 4 bytes) + 2 bytes attribute = 50
  const rawPositions: number[] = [];
  const rawIndices: number[] = [];
  const vertexMap = new Map<string, number>();

  let offset = 84;
  for (let t = 0; t < triCount; t++) {
    offset += 12; // skip normal

    for (let v = 0; v < 3; v++) {
      const x = view.getFloat32(offset, true); offset += 4;
      const y = view.getFloat32(offset, true); offset += 4;
      const z = view.getFloat32(offset, true); offset += 4;

      const key = quantizeKey(x, y, z);
      let idx = vertexMap.get(key);
      if (idx === undefined) {
        idx = rawPositions.length / 3;
        rawPositions.push(x, y, z);
        vertexMap.set(key, idx);
      }
      rawIndices.push(idx);
    }

    offset += 2; // skip attribute byte count
  }

  return createTriangleMesh(
    new Float32Array(rawPositions),
    new Uint32Array(rawIndices),
  );
}

function parseAsciiSTL(text: string): TriangleMesh {
  const rawPositions: number[] = [];
  const rawIndices: number[] = [];
  const vertexMap = new Map<string, number>();

  const vertexRegex = /vertex\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)\s+([\-\d.eE+]+)/g;
  let match: RegExpExecArray | null;

  while ((match = vertexRegex.exec(text)) !== null) {
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const z = parseFloat(match[3]);

    const key = quantizeKey(x, y, z);
    let idx = vertexMap.get(key);
    if (idx === undefined) {
      idx = rawPositions.length / 3;
      rawPositions.push(x, y, z);
      vertexMap.set(key, idx);
    }
    rawIndices.push(idx);
  }

  return createTriangleMesh(
    new Float32Array(rawPositions),
    new Uint32Array(rawIndices),
  );
}

function quantizeKey(x: number, y: number, z: number): string {
  return `${x.toFixed(6)},${y.toFixed(6)},${z.toFixed(6)}`;
}

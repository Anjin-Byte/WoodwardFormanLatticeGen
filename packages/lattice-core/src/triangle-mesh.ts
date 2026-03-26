import type { TriangleMesh } from './pipeline-types.js';

export function createTriangleMesh(
  positions: Float32Array,
  indices: Uint32Array,
): TriangleMesh {
  const vertexCount = positions.length / 3;
  const triangleCount = indices.length / 3;

  if (positions.length % 3 !== 0) {
    throw new Error(`positions length must be divisible by 3, got ${positions.length}`);
  }
  if (indices.length % 3 !== 0) {
    throw new Error(`indices length must be divisible by 3, got ${indices.length}`);
  }
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] >= vertexCount) {
      throw new Error(`index out of range: indices[${i}] = ${indices[i]}, vertexCount = ${vertexCount}`);
    }
  }

  const aabbMin: [number, number, number] = [Infinity, Infinity, Infinity];
  const aabbMax: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < vertexCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    if (x < aabbMin[0]) aabbMin[0] = x;
    if (y < aabbMin[1]) aabbMin[1] = y;
    if (z < aabbMin[2]) aabbMin[2] = z;
    if (x > aabbMax[0]) aabbMax[0] = x;
    if (y > aabbMax[1]) aabbMax[1] = y;
    if (z > aabbMax[2]) aabbMax[2] = z;
  }

  return { positions, indices, vertexCount, triangleCount, aabbMin, aabbMax };
}

export function triangleBounds(
  mesh: TriangleMesh,
  triIdx: number,
): { min: [number, number, number]; max: [number, number, number] } {
  const i0 = mesh.indices[triIdx * 3];
  const i1 = mesh.indices[triIdx * 3 + 1];
  const i2 = mesh.indices[triIdx * 3 + 2];

  const min: [number, number, number] = [
    Math.min(mesh.positions[i0 * 3], mesh.positions[i1 * 3], mesh.positions[i2 * 3]),
    Math.min(mesh.positions[i0 * 3 + 1], mesh.positions[i1 * 3 + 1], mesh.positions[i2 * 3 + 1]),
    Math.min(mesh.positions[i0 * 3 + 2], mesh.positions[i1 * 3 + 2], mesh.positions[i2 * 3 + 2]),
  ];
  const max: [number, number, number] = [
    Math.max(mesh.positions[i0 * 3], mesh.positions[i1 * 3], mesh.positions[i2 * 3]),
    Math.max(mesh.positions[i0 * 3 + 1], mesh.positions[i1 * 3 + 1], mesh.positions[i2 * 3 + 1]),
    Math.max(mesh.positions[i0 * 3 + 2], mesh.positions[i1 * 3 + 2], mesh.positions[i2 * 3 + 2]),
  ];

  return { min, max };
}

export function tessellateBox(
  min: [number, number, number],
  max: [number, number, number],
): TriangleMesh {
  const positions = new Float32Array([
    min[0], min[1], min[2],  // 0
    max[0], min[1], min[2],  // 1
    max[0], max[1], min[2],  // 2
    min[0], max[1], min[2],  // 3
    min[0], min[1], max[2],  // 4
    max[0], min[1], max[2],  // 5
    max[0], max[1], max[2],  // 6
    min[0], max[1], max[2],  // 7
  ]);

  // 6 faces × 2 triangles each = 12 triangles, CCW winding (outward normals)
  const indices = new Uint32Array([
    // -z face
    0, 2, 1,  0, 3, 2,
    // +z face
    4, 5, 6,  4, 6, 7,
    // -y face
    0, 1, 5,  0, 5, 4,
    // +y face
    3, 6, 2,  3, 7, 6,
    // -x face
    0, 4, 7,  0, 7, 3,
    // +x face
    1, 2, 6,  1, 6, 5,
  ]);

  return createTriangleMesh(positions, indices);
}

export function tessellateSphere(
  center: [number, number, number],
  radius: number,
  latSegments: number = 16,
  lonSegments: number = 32,
): TriangleMesh {
  const verts: number[] = [];
  const tris: number[] = [];

  // Top pole
  verts.push(center[0], center[1] + radius, center[2]);

  // Latitude rings (excluding poles)
  for (let lat = 1; lat < latSegments; lat++) {
    const theta = (lat / latSegments) * Math.PI;
    const sinTheta = Math.sin(theta);
    const cosTheta = Math.cos(theta);

    for (let lon = 0; lon < lonSegments; lon++) {
      const phi = (lon / lonSegments) * 2 * Math.PI;
      const x = center[0] + radius * sinTheta * Math.cos(phi);
      const y = center[1] + radius * cosTheta;
      const z = center[2] + radius * sinTheta * Math.sin(phi);
      verts.push(x, y, z);
    }
  }

  // Bottom pole
  const bottomPole = verts.length / 3;
  verts.push(center[0], center[1] - radius, center[2]);

  // Top cap triangles (pole → first ring)
  for (let lon = 0; lon < lonSegments; lon++) {
    const next = (lon + 1) % lonSegments;
    tris.push(0, 1 + lon, 1 + next);
  }

  // Body quads (ring to ring)
  for (let lat = 0; lat < latSegments - 2; lat++) {
    const ringStart = 1 + lat * lonSegments;
    const nextRingStart = ringStart + lonSegments;
    for (let lon = 0; lon < lonSegments; lon++) {
      const next = (lon + 1) % lonSegments;
      const a = ringStart + lon;
      const b = ringStart + next;
      const c = nextRingStart + next;
      const d = nextRingStart + lon;
      tris.push(a, d, b);
      tris.push(b, d, c);
    }
  }

  // Bottom cap triangles (last ring → pole)
  const lastRingStart = 1 + (latSegments - 2) * lonSegments;
  for (let lon = 0; lon < lonSegments; lon++) {
    const next = (lon + 1) % lonSegments;
    tris.push(lastRingStart + lon, bottomPole, lastRingStart + next);
  }

  return createTriangleMesh(
    new Float32Array(verts),
    new Uint32Array(tris),
  );
}

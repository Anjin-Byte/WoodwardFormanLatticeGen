import type { TriangleMesh } from './pipeline-types.js';

// ─── BVH Data Structure ────────────────────────────────────────────────────
// Flat array: 8 floats per node.
// [aabbMinX, aabbMinY, aabbMinZ, leftOrStart,
//  aabbMaxX, aabbMaxY, aabbMaxZ, rightOrCount]
//
// If rightOrCount < 0: leaf node.
//   leftOrStart = start index into triOrder
//   |rightOrCount| = triangle count
// Otherwise: interior node.
//   leftOrStart = left child node index
//   rightOrCount = right child node index

export interface BVH {
  nodes: Float32Array;
  nodeCount: number;
  triOrder: Uint32Array;
}

const MAX_LEAF_TRIS = 4;

export function buildBVH(mesh: TriangleMesh): BVH {
  const { triangleCount } = mesh;
  if (triangleCount === 0) {
    return { nodes: new Float32Array(8), nodeCount: 1, triOrder: new Uint32Array(0) };
  }

  // Compute triangle centroids
  const centroids = new Float32Array(triangleCount * 3);
  for (let t = 0; t < triangleCount; t++) {
    const i0 = mesh.indices[t * 3], i1 = mesh.indices[t * 3 + 1], i2 = mesh.indices[t * 3 + 2];
    centroids[t * 3]     = (mesh.positions[i0 * 3]     + mesh.positions[i1 * 3]     + mesh.positions[i2 * 3])     / 3;
    centroids[t * 3 + 1] = (mesh.positions[i0 * 3 + 1] + mesh.positions[i1 * 3 + 1] + mesh.positions[i2 * 3 + 1]) / 3;
    centroids[t * 3 + 2] = (mesh.positions[i0 * 3 + 2] + mesh.positions[i1 * 3 + 2] + mesh.positions[i2 * 3 + 2]) / 3;
  }

  // Triangle order (will be reordered during build)
  const triOrder = new Uint32Array(triangleCount);
  for (let i = 0; i < triangleCount; i++) triOrder[i] = i;

  // Allocate nodes (upper bound: 2 * triangleCount)
  const maxNodes = Math.max(2 * triangleCount, 8);
  const nodes = new Float32Array(maxNodes * 8);
  let nodeCount = 0;

  function allocNode(): number {
    return nodeCount++;
  }

  function triAABB(start: number, count: number): [number, number, number, number, number, number] {
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = start; i < start + count; i++) {
      const t = triOrder[i];
      const i0 = mesh.indices[t * 3], i1 = mesh.indices[t * 3 + 1], i2 = mesh.indices[t * 3 + 2];
      for (const vi of [i0, i1, i2]) {
        const x = mesh.positions[vi * 3], y = mesh.positions[vi * 3 + 1], z = mesh.positions[vi * 3 + 2];
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
        if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
      }
    }
    return [minX, minY, minZ, maxX, maxY, maxZ];
  }

  function buildNode(start: number, count: number): number {
    const idx = allocNode();
    const [minX, minY, minZ, maxX, maxY, maxZ] = triAABB(start, count);
    const base = idx * 8;
    nodes[base] = minX; nodes[base + 1] = minY; nodes[base + 2] = minZ;
    nodes[base + 4] = maxX; nodes[base + 5] = maxY; nodes[base + 6] = maxZ;

    if (count <= MAX_LEAF_TRIS) {
      nodes[base + 3] = start;
      nodes[base + 7] = -count; // negative = leaf
      return idx;
    }

    // Find longest centroid axis
    let cMinX = Infinity, cMinY = Infinity, cMinZ = Infinity;
    let cMaxX = -Infinity, cMaxY = -Infinity, cMaxZ = -Infinity;
    for (let i = start; i < start + count; i++) {
      const t = triOrder[i];
      const cx = centroids[t * 3], cy = centroids[t * 3 + 1], cz = centroids[t * 3 + 2];
      if (cx < cMinX) cMinX = cx; if (cx > cMaxX) cMaxX = cx;
      if (cy < cMinY) cMinY = cy; if (cy > cMaxY) cMaxY = cy;
      if (cz < cMinZ) cMinZ = cz; if (cz > cMaxZ) cMaxZ = cz;
    }
    const extX = cMaxX - cMinX, extY = cMaxY - cMinY, extZ = cMaxZ - cMinZ;
    const axis = extX >= extY && extX >= extZ ? 0 : extY >= extZ ? 1 : 2;

    // Sort triangles by centroid along axis
    const subarray = triOrder.subarray(start, start + count);
    subarray.sort((a, b) => centroids[a * 3 + axis] - centroids[b * 3 + axis]);

    const mid = Math.floor(count / 2);
    const left = buildNode(start, mid);
    const right = buildNode(start + mid, count - mid);

    nodes[base + 3] = left;
    nodes[base + 7] = right;
    return idx;
  }

  buildNode(0, triangleCount);

  return {
    nodes: nodes.subarray(0, nodeCount * 8),
    nodeCount,
    triOrder,
  };
}

// ─── Ray-Triangle Intersection (Moller-Trumbore) ───────────────────────────

const EPSILON = 1e-8;

export function rayTriangleIntersect(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  v0x: number, v0y: number, v0z: number,
  v1x: number, v1y: number, v1z: number,
  v2x: number, v2y: number, v2z: number,
): number | null {
  const e1x = v1x - v0x, e1y = v1y - v0y, e1z = v1z - v0z;
  const e2x = v2x - v0x, e2y = v2y - v0y, e2z = v2z - v0z;

  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;

  const det = e1x * px + e1y * py + e1z * pz;
  if (Math.abs(det) < EPSILON) return null;

  const invDet = 1 / det;
  const tx = ox - v0x, ty = oy - v0y, tz = oz - v0z;
  const u = (tx * px + ty * py + tz * pz) * invDet;
  if (u < 0 || u > 1) return null;

  const qx = ty * e1z - tz * e1y;
  const qy = tz * e1x - tx * e1z;
  const qz = tx * e1y - ty * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * invDet;
  if (v < 0 || u + v > 1) return null;

  const t = (e2x * qx + e2y * qy + e2z * qz) * invDet;
  return t;
}

// ─── BVH Traversal ─────────────────────────────────────────────────────────

function slabTest(
  o: number, invD: number, bmin: number, bmax: number,
): [number, number] {
  // Handle axis-aligned rays (invD = ±Infinity) correctly
  let t0 = (bmin - o) * invD;
  let t1 = (bmax - o) * invD;
  // When invD is Infinity and (bmin - o) is 0, t0 = NaN. Fix:
  if (!Number.isFinite(t0)) t0 = (bmin <= o && o <= bmax) ? -1e30 : 1e30;
  if (!Number.isFinite(t1)) t1 = (bmin <= o && o <= bmax) ? 1e30 : -1e30;
  if (t0 > t1) return [t1, t0];
  return [t0, t1];
}

function intersectsAABB(
  ox: number, oy: number, oz: number,
  invDx: number, invDy: number, invDz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
  tMax: number,
): boolean {
  const [txMin, txMax] = slabTest(ox, invDx, minX, maxX);
  const [tyMin, tyMax] = slabTest(oy, invDy, minY, maxY);
  const [tzMin, tzMax] = slabTest(oz, invDz, minZ, maxZ);

  const tmin = Math.max(0, txMin, tyMin, tzMin);
  const tmax = Math.min(tMax, txMax, tyMax, tzMax);

  return tmin <= tmax;
}

/** Count all ray-triangle intersections (for parity/containment test). */
export function bvhRaycast(
  bvh: BVH,
  mesh: TriangleMesh,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
): number {
  if (bvh.nodeCount === 0) return 0;

  const invDx = 1 / dx, invDy = 1 / dy, invDz = 1 / dz;
  const stack = new Int32Array(64);
  let stackPtr = 0;
  stack[stackPtr++] = 0; // root node
  let hitCount = 0;

  while (stackPtr > 0) {
    const nodeIdx = stack[--stackPtr];
    const base = nodeIdx * 8;
    const minX = bvh.nodes[base], minY = bvh.nodes[base + 1], minZ = bvh.nodes[base + 2];
    const maxX = bvh.nodes[base + 4], maxY = bvh.nodes[base + 5], maxZ = bvh.nodes[base + 6];

    if (!intersectsAABB(ox, oy, oz, invDx, invDy, invDz, minX, minY, minZ, maxX, maxY, maxZ, 1e30)) {
      continue;
    }

    const leftOrStart = bvh.nodes[base + 3];
    const rightOrCount = bvh.nodes[base + 7];

    if (rightOrCount < 0) {
      // Leaf
      const triStart = leftOrStart | 0;
      const triCount = (-rightOrCount) | 0;
      for (let i = triStart; i < triStart + triCount; i++) {
        const t = bvh.triOrder[i];
        const i0 = mesh.indices[t * 3], i1 = mesh.indices[t * 3 + 1], i2 = mesh.indices[t * 3 + 2];
        const hit = rayTriangleIntersect(
          ox, oy, oz, dx, dy, dz,
          mesh.positions[i0 * 3], mesh.positions[i0 * 3 + 1], mesh.positions[i0 * 3 + 2],
          mesh.positions[i1 * 3], mesh.positions[i1 * 3 + 1], mesh.positions[i1 * 3 + 2],
          mesh.positions[i2 * 3], mesh.positions[i2 * 3 + 1], mesh.positions[i2 * 3 + 2],
        );
        if (hit !== null && hit > EPSILON) hitCount++;
      }
    } else {
      stack[stackPtr++] = leftOrStart | 0;
      stack[stackPtr++] = rightOrCount | 0;
    }
  }

  return hitCount;
}

/** Find nearest intersection parameter t ∈ [0,1] for a segment p0→p1. */
export function bvhIntersectSegment(
  bvh: BVH,
  mesh: TriangleMesh,
  p0x: number, p0y: number, p0z: number,
  p1x: number, p1y: number, p1z: number,
): number | null {
  if (bvh.nodeCount === 0) return null;

  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
  const invDx = 1 / dx, invDy = 1 / dy, invDz = 1 / dz;

  const stack = new Int32Array(64);
  let stackPtr = 0;
  stack[stackPtr++] = 0;
  let nearest: number | null = null;

  while (stackPtr > 0) {
    const nodeIdx = stack[--stackPtr];
    const base = nodeIdx * 8;
    const minX = bvh.nodes[base], minY = bvh.nodes[base + 1], minZ = bvh.nodes[base + 2];
    const maxX = bvh.nodes[base + 4], maxY = bvh.nodes[base + 5], maxZ = bvh.nodes[base + 6];

    const tMax = nearest !== null ? nearest : 1;
    if (!intersectsAABB(p0x, p0y, p0z, invDx, invDy, invDz, minX, minY, minZ, maxX, maxY, maxZ, tMax)) {
      continue;
    }

    const leftOrStart = bvh.nodes[base + 3];
    const rightOrCount = bvh.nodes[base + 7];

    if (rightOrCount < 0) {
      const triStart = leftOrStart | 0;
      const triCount = (-rightOrCount) | 0;
      for (let i = triStart; i < triStart + triCount; i++) {
        const t = bvh.triOrder[i];
        const i0 = mesh.indices[t * 3], i1 = mesh.indices[t * 3 + 1], i2 = mesh.indices[t * 3 + 2];
        const hit = rayTriangleIntersect(
          p0x, p0y, p0z, dx, dy, dz,
          mesh.positions[i0 * 3], mesh.positions[i0 * 3 + 1], mesh.positions[i0 * 3 + 2],
          mesh.positions[i1 * 3], mesh.positions[i1 * 3 + 1], mesh.positions[i1 * 3 + 2],
          mesh.positions[i2 * 3], mesh.positions[i2 * 3 + 1], mesh.positions[i2 * 3 + 2],
        );
        if (hit !== null && hit >= 0 && hit <= 1) {
          if (nearest === null || hit < nearest) nearest = hit;
        }
      }
    } else {
      stack[stackPtr++] = leftOrStart | 0;
      stack[stackPtr++] = rightOrCount | 0;
    }
  }

  return nearest;
}

/**
 * Count how many times a segment from p0 to p1 crosses the mesh surface.
 * Used to detect beams that bridge through thin features (both endpoints
 * inside the mesh, but the segment exits and re-enters).
 */
export function bvhSegmentCrossingCount(
  bvh: BVH,
  mesh: TriangleMesh,
  p0x: number, p0y: number, p0z: number,
  p1x: number, p1y: number, p1z: number,
): number {
  if (bvh.nodeCount === 0) return 0;

  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
  const invDx = 1 / dx, invDy = 1 / dy, invDz = 1 / dz;

  const stack = new Int32Array(64);
  let stackPtr = 0;
  stack[stackPtr++] = 0;
  let count = 0;

  while (stackPtr > 0) {
    const nodeIdx = stack[--stackPtr];
    const base = nodeIdx * 8;
    const minX = bvh.nodes[base], minY = bvh.nodes[base + 1], minZ = bvh.nodes[base + 2];
    const maxX = bvh.nodes[base + 4], maxY = bvh.nodes[base + 5], maxZ = bvh.nodes[base + 6];

    if (!intersectsAABB(p0x, p0y, p0z, invDx, invDy, invDz, minX, minY, minZ, maxX, maxY, maxZ, 1)) {
      continue;
    }

    const leftOrStart = bvh.nodes[base + 3];
    const rightOrCount = bvh.nodes[base + 7];

    if (rightOrCount < 0) {
      const triStart = leftOrStart | 0;
      const triCount = (-rightOrCount) | 0;
      for (let i = triStart; i < triStart + triCount; i++) {
        const t = bvh.triOrder[i];
        const i0 = mesh.indices[t * 3], i1 = mesh.indices[t * 3 + 1], i2 = mesh.indices[t * 3 + 2];
        const hit = rayTriangleIntersect(
          p0x, p0y, p0z, dx, dy, dz,
          mesh.positions[i0 * 3], mesh.positions[i0 * 3 + 1], mesh.positions[i0 * 3 + 2],
          mesh.positions[i1 * 3], mesh.positions[i1 * 3 + 1], mesh.positions[i1 * 3 + 2],
          mesh.positions[i2 * 3], mesh.positions[i2 * 3 + 1], mesh.positions[i2 * 3 + 2],
        );
        if (hit !== null && hit > 1e-6 && hit < 1 - 1e-6) {
          count++;
        }
      }
    } else {
      stack[stackPtr++] = leftOrStart | 0;
      stack[stackPtr++] = rightOrCount | 0;
    }
  }

  return count;
}

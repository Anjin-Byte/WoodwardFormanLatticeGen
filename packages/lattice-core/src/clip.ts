/**
 * Per-beam cylinder CSG intersection against domain mesh.
 *
 * For each boundary beam, generates a cylinder mesh and performs a proper
 * boolean intersection with the domain — clipping cylinder fragments that
 * fall outside the domain volume. Uses the Domain.contains() test for
 * inside/outside classification of mesh vertices and fragments.
 */

import type {
  BeamGraph, TrimResult, TriangleMesh, DomainIndex, Domain,
} from './pipeline-types.js';
import { BEAM_BOUNDARY, BEAM_REMOVED } from './pipeline-types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

const CYL_SEGMENTS = 8;

export interface ClippedMesh {
  positions: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

export interface ClippedBeamResult {
  beamIndex: number;
  mesh: ClippedMesh;
}

// ─── Cylinder mesh generation ───────────────────────────────────────────────

function generateCylinder(
  p0: [number, number, number],
  p1: [number, number, number],
  radius: number,
  segments: number = CYL_SEGMENTS,
): ClippedMesh {
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-10) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, triangleCount: 0 };
  }

  const ax = dx / len, ay = dy / len, az = dz / len;
  let ux: number, uy: number, uz: number;
  if (Math.abs(ax) < 0.9) {
    ux = 0; uy = az; uz = -ay;
  } else {
    ux = -az; uy = 0; uz = ax;
  }
  const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz);
  ux /= uLen; uy /= uLen; uz /= uLen;
  const vx = ay * uz - az * uy;
  const vy = az * ux - ax * uz;
  const vz = ax * uy - ay * ux;

  const vertCount = segments * 2 + 2;
  const positions = new Float32Array(vertCount * 3);

  for (let i = 0; i < segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    const cos = Math.cos(angle), sin = Math.sin(angle);
    const rx = (ux * cos + vx * sin) * radius;
    const ry = (uy * cos + vy * sin) * radius;
    const rz = (uz * cos + vz * sin) * radius;

    positions[i * 3]     = p0[0] + rx;
    positions[i * 3 + 1] = p0[1] + ry;
    positions[i * 3 + 2] = p0[2] + rz;

    positions[(segments + i) * 3]     = p1[0] + rx;
    positions[(segments + i) * 3 + 1] = p1[1] + ry;
    positions[(segments + i) * 3 + 2] = p1[2] + rz;
  }

  const c0 = segments * 2, c1 = segments * 2 + 1;
  positions[c0 * 3] = p0[0]; positions[c0 * 3 + 1] = p0[1]; positions[c0 * 3 + 2] = p0[2];
  positions[c1 * 3] = p1[0]; positions[c1 * 3 + 1] = p1[1]; positions[c1 * 3 + 2] = p1[2];

  const triCount = segments * 4;
  const indices = new Uint32Array(triCount * 3);
  let idx = 0;

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices[idx++] = i; indices[idx++] = next; indices[idx++] = segments + next;
    indices[idx++] = i; indices[idx++] = segments + next; indices[idx++] = segments + i;
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices[idx++] = c0; indices[idx++] = next; indices[idx++] = i;
  }
  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    indices[idx++] = c1; indices[idx++] = segments + i; indices[idx++] = segments + next;
  }

  return { positions, indices, vertexCount: vertCount, triangleCount: triCount };
}

// ─── Domain-based vertex classification and mesh clipping ───────────────────

/**
 * Clip a cylinder mesh to the domain interior and generate cap geometry
 * to close the cut cross-sections.
 *
 * Algorithm:
 * 1. Classify each vertex as inside/outside via domain.contains()
 * 2. For mixed triangles, find boundary crossings via binary search
 * 3. Track boundary edge pairs (edges on the cut surface)
 * 4. Order boundary edges into closed loops
 * 5. Fan-triangulate each loop to cap the cut
 */
function clipMeshByDomain(
  mesh: ClippedMesh,
  domain: Domain,
): ClippedMesh {
  if (mesh.triangleCount === 0) return mesh;

  // Classify all vertices
  const inside = new Uint8Array(mesh.vertexCount);
  for (let i = 0; i < mesh.vertexCount; i++) {
    inside[i] = domain.contains(
      mesh.positions[i * 3],
      mesh.positions[i * 3 + 1],
      mesh.positions[i * 3 + 2],
    ) ? 1 : 0;
  }

  const outPositions: number[] = [];
  const outIndices: number[] = [];

  // Copy existing vertices
  for (let i = 0; i < mesh.vertexCount; i++) {
    outPositions.push(mesh.positions[i * 3], mesh.positions[i * 3 + 1], mesh.positions[i * 3 + 2]);
  }
  let outVertCount = mesh.vertexCount;

  // Edge crossing cache
  const edgeMap = new Map<string, number>();

  // Boundary edges: pairs of new vertex indices on the cut surface
  const boundaryEdges: [number, number][] = [];

  function findEdgeCrossing(a: number, b: number): number {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    const existing = edgeMap.get(key);
    if (existing !== undefined) return existing;

    let ax = mesh.positions[a * 3], ay = mesh.positions[a * 3 + 1], az = mesh.positions[a * 3 + 2];
    let bx = mesh.positions[b * 3], by = mesh.positions[b * 3 + 1], bz = mesh.positions[b * 3 + 2];
    const aInside = inside[a] === 1;

    for (let iter = 0; iter < 10; iter++) {
      const mx = (ax + bx) * 0.5, my = (ay + by) * 0.5, mz = (az + bz) * 0.5;
      const mInside = domain.contains(mx, my, mz);
      if (mInside === aInside) {
        ax = mx; ay = my; az = mz;
      } else {
        bx = mx; by = my; bz = mz;
      }
    }

    const cx = (ax + bx) * 0.5, cy = (ay + by) * 0.5, cz = (az + bz) * 0.5;
    const idx = outVertCount++;
    outPositions.push(cx, cy, cz);
    edgeMap.set(key, idx);
    return idx;
  }

  // Process each triangle — clip and track boundary edges
  for (let t = 0; t < mesh.triangleCount; t++) {
    const ia = mesh.indices[t * 3], ib = mesh.indices[t * 3 + 1], ic = mesh.indices[t * 3 + 2];
    const aIn = inside[ia] === 1, bIn = inside[ib] === 1, cIn = inside[ic] === 1;
    const count = (aIn ? 1 : 0) + (bIn ? 1 : 0) + (cIn ? 1 : 0);

    if (count === 3) {
      outIndices.push(ia, ib, ic);
    } else if (count === 0) {
      // discard
    } else if (count === 1) {
      const inv = aIn ? ia : bIn ? ib : ic;
      const out1 = aIn ? ib : bIn ? ic : ia;
      const out2 = aIn ? ic : bIn ? ia : ib;
      const n1 = findEdgeCrossing(inv, out1);
      const n2 = findEdgeCrossing(inv, out2);
      outIndices.push(inv, n1, n2);
      // n1→n2 is a boundary edge on the cut surface
      boundaryEdges.push([n1, n2]);
    } else {
      const outV = !aIn ? ia : !bIn ? ib : ic;
      const in1 = !aIn ? ib : !bIn ? ic : ia;
      const in2 = !aIn ? ic : !bIn ? ia : ib;
      const n1 = findEdgeCrossing(in1, outV);
      const n2 = findEdgeCrossing(in2, outV);
      outIndices.push(in1, n1, in2);
      outIndices.push(in2, n1, n2);
      // n2→n1 is a boundary edge (reversed to maintain winding)
      boundaryEdges.push([n2, n1]);
    }
  }

  // ─── Cap generation: order boundary edges into loops, then triangulate ──

  if (boundaryEdges.length > 0) {
    // Build adjacency: from vertex → next vertex
    const nextMap = new Map<number, number>();
    for (const [a, b] of boundaryEdges) {
      nextMap.set(a, b);
    }

    const visited = new Set<number>();
    // Extract loops
    for (const [start] of boundaryEdges) {
      if (visited.has(start)) continue;

      const loop: number[] = [];
      let current = start;
      let safety = 0;
      while (!visited.has(current) && safety < 1000) {
        visited.add(current);
        loop.push(current);
        const next = nextMap.get(current);
        if (next === undefined) break;
        current = next;
        safety++;
      }

      if (loop.length >= 3) {
        // Compute loop centroid for fan triangulation
        let cx = 0, cy = 0, cz = 0;
        for (const vi of loop) {
          cx += outPositions[vi * 3];
          cy += outPositions[vi * 3 + 1];
          cz += outPositions[vi * 3 + 2];
        }
        cx /= loop.length; cy /= loop.length; cz /= loop.length;

        // Add centroid vertex
        const centerIdx = outVertCount++;
        outPositions.push(cx, cy, cz);

        // Fan triangulate: centroid → each consecutive pair
        // Winding: the cap should face outward (away from domain interior)
        for (let i = 0; i < loop.length; i++) {
          const next = (i + 1) % loop.length;
          outIndices.push(centerIdx, loop[i], loop[next]);
        }
      }
    }
  }

  if (outIndices.length === 0) {
    return { positions: new Float32Array(0), indices: new Uint32Array(0), vertexCount: 0, triangleCount: 0 };
  }

  return {
    positions: new Float32Array(outPositions),
    indices: new Uint32Array(outIndices),
    vertexCount: outVertCount,
    triangleCount: outIndices.length / 3,
  };
}

// ─── Beam cell range (for DomainIndex lookup) ───────────────────────────────

function beamCellRange(
  p0: [number, number, number],
  p1: [number, number, number],
  radius: number,
  grid: { origin: [number, number, number]; cellSize: [number, number, number]; nx: number; ny: number; nz: number },
): { iMin: number; iMax: number; jMin: number; jMax: number; kMin: number; kMax: number } {
  const minX = Math.min(p0[0], p1[0]) - radius;
  const minY = Math.min(p0[1], p1[1]) - radius;
  const minZ = Math.min(p0[2], p1[2]) - radius;
  const maxX = Math.max(p0[0], p1[0]) + radius;
  const maxY = Math.max(p0[1], p1[1]) + radius;
  const maxZ = Math.max(p0[2], p1[2]) + radius;

  return {
    iMin: Math.max(0, Math.floor((minX - grid.origin[0]) / grid.cellSize[0])),
    iMax: Math.min(grid.nx - 1, Math.floor((maxX - grid.origin[0]) / grid.cellSize[0])),
    jMin: Math.max(0, Math.floor((minY - grid.origin[1]) / grid.cellSize[1])),
    jMax: Math.min(grid.ny - 1, Math.floor((maxY - grid.origin[1]) / grid.cellSize[1])),
    kMin: Math.max(0, Math.floor((minZ - grid.origin[2]) / grid.cellSize[2])),
    kMax: Math.min(grid.nz - 1, Math.floor((maxZ - grid.origin[2]) / grid.cellSize[2])),
  };
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * For each boundary beam, generate a cylinder mesh and clip it against the
 * domain using proper CSG (binary search for boundary crossings, vertex
 * classification via domain.contains).
 *
 * Only boundary beams that are not removed are processed.
 * Interior beams are rendered as instances (handled separately).
 */
export function clipBoundaryBeams(
  graph: BeamGraph,
  domain: Domain,
  domainMesh: TriangleMesh,
  domainIndex: DomainIndex,
  trim: TrimResult | null,
  segments: number = CYL_SEGMENTS,
): ClippedBeamResult[] {
  const results: ClippedBeamResult[] = [];
  const grid = graph.grid;

  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    if (!(graph.beamFlags[b] & BEAM_BOUNDARY)) continue;

    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];

    let p0: [number, number, number];
    let p1: [number, number, number];
    if (trim?.trimmedPositions.has(n0)) {
      p0 = trim.trimmedPositions.get(n0)!;
    } else {
      p0 = [graph.positions[n0 * 3], graph.positions[n0 * 3 + 1], graph.positions[n0 * 3 + 2]];
    }
    if (trim?.trimmedPositions.has(n1)) {
      p1 = trim.trimmedPositions.get(n1)!;
    } else {
      p1 = [graph.positions[n1 * 3], graph.positions[n1 * 3 + 1], graph.positions[n1 * 3 + 2]];
    }

    const radius = graph.beamRadii[b];

    // Check if this beam's cylinder actually intersects any domain triangles
    const range = beamCellRange(p0, p1, radius, grid);
    let hasTris = false;
    const nyNz = grid.ny * grid.nz;
    for (let i = range.iMin; i <= range.iMax && !hasTris; i++) {
      for (let j = range.jMin; j <= range.jMax && !hasTris; j++) {
        for (let k = range.kMin; k <= range.kMax && !hasTris; k++) {
          const cellIdx = i * nyNz + j * grid.nz + k;
          if (domainIndex.triPtr[cellIdx] < domainIndex.triPtr[cellIdx + 1]) {
            hasTris = true;
          }
        }
      }
    }
    if (!hasTris) continue;

    // Generate cylinder mesh
    let mesh = generateCylinder(p0, p1, radius, segments);
    if (mesh.triangleCount === 0) continue;

    // Clip using domain containment (proper CSG)
    mesh = clipMeshByDomain(mesh, domain);
    if (mesh.triangleCount === 0) continue;

    results.push({ beamIndex: b, mesh });
  }

  return results;
}

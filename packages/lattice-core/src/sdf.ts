import type { BeamGraph, TrimResult, SkinGraph } from './pipeline-types.js';
import { BEAM_REMOVED } from './pipeline-types.js';
import { getEffectivePosition } from './render-data.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SdfAccel {
  cellSize: number;
  invCellSize: number;
  originX: number;
  originY: number;
  originZ: number;
  cells: Map<number, Uint32Array>;
  beamP0: Float32Array;   // [x,y,z, ...] per beam
  beamP1: Float32Array;   // [x,y,z, ...] per beam
  beamR: Float32Array;    // radius per beam
  beamCount: number;
}

export interface SdfAccelOptions {
  sminK: number;
}

// ─── Capped Cylinder SDF ────────────────────────────────────────────────────

/**
 * Signed distance from point (px,py,pz) to a capped cylinder from (ax,ay,az)
 * to (bx,by,bz) with radius r. Negative inside, zero on surface, positive outside.
 * Inigo Quilez formula — all scalar args for hot-loop performance.
 */
export function sdCappedCylinder(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
): number {
  const bax = bx - ax;
  const bay = by - ay;
  const baz = bz - az;
  const pax = px - ax;
  const pay = py - ay;
  const paz = pz - az;

  const baba = bax * bax + bay * bay + baz * baz;
  const paba = pax * bax + pay * bay + paz * baz;

  // Perpendicular distance to infinite cylinder axis
  const dx = pax * baba - bax * paba;
  const dy = pay * baba - bay * paba;
  const dz = paz * baba - baz * paba;
  const x = Math.sqrt(dx * dx + dy * dy + dz * dz) - r * baba;

  // Distance along axis to end caps
  const y = Math.abs(paba - baba * 0.5) - baba * 0.5;

  const x2 = x * x;
  const y2 = y * y * baba;

  let d: number;
  if (x > 0 && y > 0) {
    d = x2 + y2;
  } else if (x > 0) {
    d = x2;
  } else if (y > 0) {
    d = y2;
  } else {
    d = -Math.min(x2, y2);
  }

  return Math.sign(d) * Math.sqrt(Math.abs(d)) / baba;
}

// ─── Smooth Min ─────────────────────────────────────────────────────────────

/** Polynomial smooth min. When k=0, returns min(a,b). */
export function smin(a: number, b: number, k: number): number {
  if (k <= 0) return Math.min(a, b);
  const k4 = k * 4.0;
  const h = Math.max(k4 - Math.abs(a - b), 0.0);
  return Math.min(a, b) - (h * h * 0.25) / k4;
}

// ─── Spatial Hash ───────────────────────────────────────────────────────────

const P1 = 73856093;
const P2 = 19349663;
const P3 = 83492791;

function hashCell(ix: number, iy: number, iz: number): number {
  return ((ix * P1) ^ (iy * P2) ^ (iz * P3)) | 0;
}

/**
 * Build spatial acceleration for SDF queries. Flattens all non-removed beams
 * (+ skin beams) into contiguous arrays and hashes them into a uniform grid.
 */
export function buildSdfAccel(
  graph: BeamGraph,
  trim: TrimResult | null,
  skin: SkinGraph | null,
  options: SdfAccelOptions,
): SdfAccel {
  const { sminK } = options;

  // Count beams to include
  let count = 0;
  for (let b = 0; b < graph.beamCount; b++) {
    if (!(graph.beamFlags[b] & BEAM_REMOVED)) count++;
  }
  const skinCount = skin ? skin.beamCount : 0;
  const totalBeams = count + skinCount;

  // Flatten beam endpoints and radii
  const beamP0 = new Float32Array(totalBeams * 3);
  const beamP1 = new Float32Array(totalBeams * 3);
  const beamR = new Float32Array(totalBeams);

  let idx = 0;

  // Main graph beams
  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const p0 = getEffectivePosition(graph, trim, n0);
    const p1 = getEffectivePosition(graph, trim, n1);

    beamP0[idx * 3] = p0[0];
    beamP0[idx * 3 + 1] = p0[1];
    beamP0[idx * 3 + 2] = p0[2];
    beamP1[idx * 3] = p1[0];
    beamP1[idx * 3 + 1] = p1[1];
    beamP1[idx * 3 + 2] = p1[2];
    beamR[idx] = graph.beamRadii[b];
    idx++;
  }

  // Skin beams
  if (skin) {
    for (let s = 0; s < skin.beamCount; s++) {
      const n0 = skin.edges[s * 2];
      const n1 = skin.edges[s * 2 + 1];
      beamP0[idx * 3] = skin.positions[n0 * 3];
      beamP0[idx * 3 + 1] = skin.positions[n0 * 3 + 1];
      beamP0[idx * 3 + 2] = skin.positions[n0 * 3 + 2];
      beamP1[idx * 3] = skin.positions[n1 * 3];
      beamP1[idx * 3 + 1] = skin.positions[n1 * 3 + 1];
      beamP1[idx * 3 + 2] = skin.positions[n1 * 3 + 2];
      beamR[idx] = skin.beamRadii[s];
      idx++;
    }
  }

  // Compute median beam length for cell sizing
  const lengths = new Float32Array(totalBeams);
  for (let i = 0; i < totalBeams; i++) {
    const dx = beamP1[i * 3] - beamP0[i * 3];
    const dy = beamP1[i * 3 + 1] - beamP0[i * 3 + 1];
    const dz = beamP1[i * 3 + 2] - beamP0[i * 3 + 2];
    lengths[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  lengths.sort();
  const medianLength = totalBeams > 0 ? lengths[Math.floor(totalBeams / 2)] : 1;
  const cellSize = Math.max(medianLength * 2, 1e-6);
  const invCellSize = 1 / cellSize;

  // Compute global AABB for origin
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  for (let i = 0; i < totalBeams; i++) {
    const r = beamR[i];
    const margin = r + sminK;
    minX = Math.min(minX, beamP0[i * 3] - margin, beamP1[i * 3] - margin);
    minY = Math.min(minY, beamP0[i * 3 + 1] - margin, beamP1[i * 3 + 1] - margin);
    minZ = Math.min(minZ, beamP0[i * 3 + 2] - margin, beamP1[i * 3 + 2] - margin);
  }

  const originX = minX - cellSize;
  const originY = minY - cellSize;
  const originZ = minZ - cellSize;

  // Hash beams into cells
  const cellMap = new Map<number, number[]>();

  for (let i = 0; i < totalBeams; i++) {
    const r = beamR[i];
    const margin = r + sminK;
    const p0x = beamP0[i * 3], p0y = beamP0[i * 3 + 1], p0z = beamP0[i * 3 + 2];
    const p1x = beamP1[i * 3], p1y = beamP1[i * 3 + 1], p1z = beamP1[i * 3 + 2];

    const lo0 = Math.min(p0x, p1x) - margin;
    const lo1 = Math.min(p0y, p1y) - margin;
    const lo2 = Math.min(p0z, p1z) - margin;
    const hi0 = Math.max(p0x, p1x) + margin;
    const hi1 = Math.max(p0y, p1y) + margin;
    const hi2 = Math.max(p0z, p1z) + margin;

    const ixMin = Math.floor((lo0 - originX) * invCellSize);
    const iyMin = Math.floor((lo1 - originY) * invCellSize);
    const izMin = Math.floor((lo2 - originZ) * invCellSize);
    const ixMax = Math.floor((hi0 - originX) * invCellSize);
    const iyMax = Math.floor((hi1 - originY) * invCellSize);
    const izMax = Math.floor((hi2 - originZ) * invCellSize);

    for (let ix = ixMin; ix <= ixMax; ix++) {
      for (let iy = iyMin; iy <= iyMax; iy++) {
        for (let iz = izMin; iz <= izMax; iz++) {
          const h = hashCell(ix, iy, iz);
          let list = cellMap.get(h);
          if (!list) { list = []; cellMap.set(h, list); }
          list.push(i);
        }
      }
    }
  }

  // Convert lists to Uint32Arrays
  const cells = new Map<number, Uint32Array>();
  for (const [h, list] of cellMap) {
    cells.set(h, new Uint32Array(list));
  }

  return {
    cellSize, invCellSize, originX, originY, originZ,
    cells, beamP0, beamP1, beamR, beamCount: totalBeams,
  };
}

// ─── CSR Spatial Hash (for GPU upload) ──────────────────────────────────────

export interface SdfAccelCsr {
  /** Hash table size (power of 2). cell_offsets has tableSize+1 entries. */
  tableSize: number;
  /** Prefix-sum offsets into beamIndices, length = tableSize + 1. */
  cellOffsets: Uint32Array;
  /** Packed beam indices. */
  beamIndices: Uint32Array;
}

/**
 * Convert the Map-based spatial hash into CSR flat arrays for GPU upload.
 * Uses a fixed-size hash table (next power of 2 from key count × 2 for load factor).
 * Collisions are handled by mapping multiple hash keys to the same bucket.
 */
export function buildSdfAccelCsr(accel: SdfAccel): SdfAccelCsr {
  const keys = Array.from(accel.cells.keys());
  const keyCount = keys.length;

  // Hash table size: next power of 2 from keyCount * 2 (50% load factor)
  let tableSize = 1;
  while (tableSize < keyCount * 2) tableSize <<= 1;

  // Count entries per bucket
  const bucketCounts = new Uint32Array(tableSize);
  for (const key of keys) {
    const bucket = ((key % tableSize) + tableSize) % tableSize;
    const beams = accel.cells.get(key)!;
    bucketCounts[bucket] += beams.length;
  }

  // Prefix sum → offsets
  const cellOffsets = new Uint32Array(tableSize + 1);
  for (let i = 0; i < tableSize; i++) {
    cellOffsets[i + 1] = cellOffsets[i] + bucketCounts[i];
  }
  const totalEntries = cellOffsets[tableSize];

  // Fill beam indices
  const beamIndices = new Uint32Array(totalEntries);
  const writePos = new Uint32Array(tableSize); // current write position per bucket
  for (let i = 0; i < tableSize; i++) writePos[i] = cellOffsets[i];

  for (const key of keys) {
    const bucket = ((key % tableSize) + tableSize) % tableSize;
    const beams = accel.cells.get(key)!;
    for (let j = 0; j < beams.length; j++) {
      beamIndices[writePos[bucket]++] = beams[j];
    }
  }

  return { tableSize, cellOffsets, beamIndices };
}

// ─── Composite SDF ──────────────────────────────────────────────────────────

/**
 * Evaluate the lattice SDF at point (px,py,pz). Queries the spatial hash
 * for nearby beams and combines cylinder SDFs via smooth min.
 */
export function latticeSdf(
  px: number, py: number, pz: number,
  accel: SdfAccel,
  sminK: number,
): number {
  const ix = Math.floor((px - accel.originX) * accel.invCellSize);
  const iy = Math.floor((py - accel.originY) * accel.invCellSize);
  const iz = Math.floor((pz - accel.originZ) * accel.invCellSize);

  let d = Infinity;

  // 3×3×3 neighborhood to catch beams in adjacent cells
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        const h = hashCell(ix + dx, iy + dy, iz + dz);
        const beams = accel.cells.get(h);
        if (!beams) continue;

        for (let j = 0; j < beams.length; j++) {
          const bi = beams[j];
          const bd = sdCappedCylinder(
            px, py, pz,
            accel.beamP0[bi * 3], accel.beamP0[bi * 3 + 1], accel.beamP0[bi * 3 + 2],
            accel.beamP1[bi * 3], accel.beamP1[bi * 3 + 1], accel.beamP1[bi * 3 + 2],
            accel.beamR[bi],
          );
          d = smin(d, bd, sminK);
        }
      }
    }
  }

  return d;
}

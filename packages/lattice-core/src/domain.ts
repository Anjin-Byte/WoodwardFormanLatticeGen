import type { Domain } from './pipeline-types.js';

export function createBoxDomain(
  min: [number, number, number],
  max: [number, number, number],
): Domain {
  return {
    contains(x, y, z) {
      return x >= min[0] && x <= max[0]
          && y >= min[1] && y <= max[1]
          && z >= min[2] && z <= max[2];
    },

    intersectSegment(p0x, p0y, p0z, p1x, p1y, p1z) {
      // Ray-AABB intersection (slab method)
      // Parametric: P(t) = p0 + t * (p1 - p0), t ∈ [0,1]
      let tMin = 0;
      let tMax = 1;

      for (let axis = 0; axis < 3; axis++) {
        const p0v = [p0x, p0y, p0z][axis];
        const p1v = [p1x, p1y, p1z][axis];
        const lo = min[axis];
        const hi = max[axis];
        const d = p1v - p0v;

        if (Math.abs(d) < 1e-12) {
          // Parallel to slab
          if (p0v < lo || p0v > hi) return 0; // entirely outside this slab
          continue;
        }

        let t0 = (lo - p0v) / d;
        let t1 = (hi - p0v) / d;
        if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }

        tMin = Math.max(tMin, t0);
        tMax = Math.min(tMax, t1);

        if (tMin > tMax) return tMin <= 1 ? tMin : null;
      }

      // Segment intersects the box from tMin to tMax.
      // If p0 is inside, the exit point is tMax.
      const p0Inside = this.contains(p0x, p0y, p0z);
      const p1Inside = this.contains(p1x, p1y, p1z);

      if (p0Inside && p1Inside) return null; // fully inside
      if (!p0Inside && !p1Inside) return 0;  // fully outside (or just grazes)

      // One inside, one outside: return the crossing parameter
      if (p0Inside) return tMax;  // exits at tMax
      return tMin;                // enters at tMin
    },
  };
}

export function createSphereDomain(
  center: [number, number, number],
  radius: number,
): Domain {
  const r2 = radius * radius;

  function dist2(x: number, y: number, z: number): number {
    const dx = x - center[0];
    const dy = y - center[1];
    const dz = z - center[2];
    return dx * dx + dy * dy + dz * dz;
  }

  return {
    contains(x, y, z) {
      return dist2(x, y, z) <= r2;
    },

    intersectSegment(p0x, p0y, p0z, p1x, p1y, p1z) {
      // Ray-sphere intersection
      // Ray: P(t) = O + t*D where O=p0, D=p1-p0, t ∈ [0,1]
      const ox = p0x - center[0];
      const oy = p0y - center[1];
      const oz = p0z - center[2];
      const dx = p1x - p0x;
      const dy = p1y - p0y;
      const dz = p1z - p0z;

      const a = dx * dx + dy * dy + dz * dz;
      const b = 2 * (ox * dx + oy * dy + oz * dz);
      const c = ox * ox + oy * oy + oz * oz - r2;

      const disc = b * b - 4 * a * c;
      if (disc < 0) {
        // No intersection with sphere
        return this.contains(p0x, p0y, p0z) ? null : 0;
      }

      const sqrtDisc = Math.sqrt(disc);
      const t0 = (-b - sqrtDisc) / (2 * a);
      const t1 = (-b + sqrtDisc) / (2 * a);

      const p0Inside = this.contains(p0x, p0y, p0z);
      const p1Inside = this.contains(p1x, p1y, p1z);

      if (p0Inside && p1Inside) return null;
      if (!p0Inside && !p1Inside) {
        // Both outside — check if segment passes through sphere
        if (t0 >= 0 && t0 <= 1) return t0;
        return 0;
      }

      // One inside, one outside
      if (p0Inside) {
        // Exits at t1
        return (t1 >= 0 && t1 <= 1) ? t1 : null;
      }
      // Enters at t0
      return (t0 >= 0 && t0 <= 1) ? t0 : 0;
    },
  };
}

export function createCylinderDomain(
  center: [number, number, number],
  radius: number,
  length: number,
): Domain {
  const r2 = radius * radius;
  const half = length * 0.5;

  function radialDist2(x: number, z: number): number {
    const dx = x - center[0];
    const dz = z - center[2];
    return dx * dx + dz * dz;
  }

  function isInside(x: number, y: number, z: number): boolean {
    return radialDist2(x, z) <= r2 && Math.abs(y - center[1]) <= half;
  }

  function isValidSideHit(
    p0x: number, p0y: number, p0z: number,
    dx: number, dy: number, dz: number,
    t: number,
  ): boolean {
    if (t < 0 || t > 1) return false;
    const y = p0y + dy * t;
    return Math.abs(y - center[1]) <= half;
  }

  function isValidCapHit(
    p0x: number, p0z: number,
    dx: number, dz: number,
    t: number,
  ): boolean {
    if (t < 0 || t > 1) return false;
    const x = p0x + dx * t;
    const z = p0z + dz * t;
    return radialDist2(x, z) <= r2;
  }

  return {
    contains(x, y, z) {
      return isInside(x, y, z);
    },

    intersectSegment(p0x, p0y, p0z, p1x, p1y, p1z) {
      const dx = p1x - p0x;
      const dy = p1y - p0y;
      const dz = p1z - p0z;
      const candidates: number[] = [];

      const p0Inside = isInside(p0x, p0y, p0z);
      const p1Inside = isInside(p1x, p1y, p1z);

      const ax = p0x - center[0];
      const az = p0z - center[2];
      const a = dx * dx + dz * dz;
      const b = 2 * (ax * dx + az * dz);
      const c = ax * ax + az * az - r2;

      if (a > 1e-12) {
        const disc = b * b - 4 * a * c;
        if (disc >= 0) {
          const sqrtDisc = Math.sqrt(disc);
          const t0 = (-b - sqrtDisc) / (2 * a);
          const t1 = (-b + sqrtDisc) / (2 * a);
          if (isValidSideHit(p0x, p0y, p0z, dx, dy, dz, t0)) candidates.push(t0);
          if (isValidSideHit(p0x, p0y, p0z, dx, dy, dz, t1)) candidates.push(t1);
        }
      }

      if (Math.abs(dy) > 1e-12) {
        const topT = (center[1] + half - p0y) / dy;
        const bottomT = (center[1] - half - p0y) / dy;
        if (isValidCapHit(p0x, p0z, dx, dz, topT)) candidates.push(topT);
        if (isValidCapHit(p0x, p0z, dx, dz, bottomT)) candidates.push(bottomT);
      }

      if (candidates.length === 0) {
        return p0Inside && p1Inside ? null : 0;
      }

      candidates.sort((lhs, rhs) => lhs - rhs);

      const deduped: number[] = [];
      for (const t of candidates) {
        if (deduped.length === 0 || Math.abs(t - deduped[deduped.length - 1]) > 1e-9) {
          deduped.push(t);
        }
      }

      if (p0Inside && p1Inside) return null;
      if (!p0Inside && !p1Inside) return deduped[0] ?? 0;
      if (p0Inside) return deduped[deduped.length - 1] ?? null;
      return deduped[0] ?? 0;
    },
  };
}

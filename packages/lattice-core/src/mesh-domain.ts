import type { TriangleMesh, Domain } from './pipeline-types.js';
import { buildBVH, bvhRaycast, bvhIntersectSegment } from './bvh.js';

export function createMeshDomain(mesh: TriangleMesh): Domain {
  const bvh = buildBVH(mesh);
  // Small perturbation for ray direction to avoid edge degeneracies
  const RAY_PERTURB = 1e-5;

  return {
    contains(x: number, y: number, z: number): boolean {
      // Cast ray in +x with slight perturbation to avoid edge hits
      const count = bvhRaycast(bvh, mesh, x, y, z, 1, RAY_PERTURB, RAY_PERTURB * 0.7);
      return (count % 2) === 1;
    },

    intersectSegment(
      p0x: number, p0y: number, p0z: number,
      p1x: number, p1y: number, p1z: number,
    ): number | null {
      const p0In = this.contains(p0x, p0y, p0z);
      const p1In = this.contains(p1x, p1y, p1z);

      if (p0In && p1In) return null; // fully inside

      const t = bvhIntersectSegment(bvh, mesh, p0x, p0y, p0z, p1x, p1y, p1z);

      if (!p0In && !p1In) {
        // Both outside — return first intersection if it exists, otherwise 0
        return t !== null ? t : 0;
      }

      // One inside, one outside
      if (t !== null) return t;

      // Fallback if BVH missed (shouldn't happen with correct mesh)
      return p0In ? 0.999 : 0.001;
    },
  };
}

import type { BeamGraph, TrimResult, BeamRenderData, SkinGraph } from './pipeline-types.js';
import { BEAM_REMOVED, BEAM_BOUNDARY } from './pipeline-types.js';

export function getEffectivePosition(
  graph: BeamGraph,
  trim: TrimResult | null,
  nodeIdx: number,
): [number, number, number] {
  if (trim) {
    const override = trim.trimmedPositions.get(nodeIdx);
    if (override) return override;
  }
  return [
    graph.positions[nodeIdx * 3],
    graph.positions[nodeIdx * 3 + 1],
    graph.positions[nodeIdx * 3 + 2],
  ];
}

// Compute a 4×4 column-major matrix that transforms a unit cylinder
// (height 1, radius 1, centered at origin, aligned along Y) to the
// beam's world-space position, orientation, and scale.
export function computeBeamTransform(
  p0: [number, number, number],
  p1: [number, number, number],
  radius: number,
): Float32Array {
  const mat = new Float32Array(16);

  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);

  if (length < 1e-12) {
    // Degenerate beam — return identity scaled to zero
    mat[0] = 0; mat[5] = 0; mat[10] = 0; mat[15] = 1;
    return mat;
  }

  // Normalized direction
  const nx = dx / length;
  const ny = dy / length;
  const nz = dz / length;

  // Build rotation matrix that maps Y-axis (0,1,0) to (nx, ny, nz).
  // Using Rodrigues' rotation formula via quaternion.
  // from = (0, 1, 0), to = (nx, ny, nz)
  // cross = from × to = (nz, 0, -nx)
  // dot = from · to = ny

  const dot = ny; // from.y * to.y = ny

  let r00: number, r01: number, r02: number;
  let r10: number, r11: number, r12: number;
  let r20: number, r21: number, r22: number;

  if (dot > 0.99999) {
    // Nearly parallel — identity rotation
    r00 = 1; r01 = 0; r02 = 0;
    r10 = 0; r11 = 1; r12 = 0;
    r20 = 0; r21 = 0; r22 = 1;
  } else if (dot < -0.99999) {
    // Nearly anti-parallel — 180° rotation around X or Z
    r00 = -1; r01 = 0; r02 = 0;
    r10 = 0; r11 = -1; r12 = 0;
    r20 = 0; r21 = 0; r22 = 1;
  } else {
    // cross product (0,1,0) × (nx,ny,nz) = (1*nz - 0*ny, 0*nx - 0*nz, 0*ny - 1*nx) = (nz, 0, -nx)
    const cx = nz;
    const cy = 0;
    const cz = -nx;
    const s = Math.sqrt(cx * cx + cy * cy + cz * cz); // sin(angle)
    const k = (1 - dot) / (s * s); // (1 - cos) / sin²

    r00 = 1 + k * (cy * cy + cz * cz) * (-1) + k * (-cz * cz); // Simplify via skew-symmetric
    // Use the standard Rodrigues formula: R = I + [v]× + [v]×² · (1-cos)/sin²
    // where v = cross / |cross| * sin(angle), but it's cleaner with the direct formula:
    // R = I + sin(θ) · K + (1-cos(θ)) · K²
    // where K is the skew matrix of the normalized axis.

    // Actually, let's just use the direct formula for rotation from (0,1,0) to (nx,ny,nz):
    // axis = normalize(cross((0,1,0), (nx,ny,nz))) = normalize((nz, 0, -nx))
    const ax = cx / s;
    const ay = cy / s;
    const az = cz / s;
    const c = dot; // cos(angle)
    const t = 1 - c;

    r00 = t * ax * ax + c;
    r01 = t * ax * ay - s * az;
    r02 = t * ax * az + s * ay;
    r10 = t * ay * ax + s * az;
    r11 = t * ay * ay + c;
    r12 = t * ay * az - s * ax;
    r20 = t * az * ax - s * ay;
    r21 = t * az * ay + s * ax;
    r22 = t * az * az + c;
  }

  // Midpoint (translation)
  const mx = (p0[0] + p1[0]) / 2;
  const my = (p0[1] + p1[1]) / 2;
  const mz = (p0[2] + p1[2]) / 2;

  // Compose: T * R * S where S = diag(radius, length, radius)
  // Column-major layout
  mat[0]  = r00 * radius;  mat[1]  = r10 * radius;  mat[2]  = r20 * radius;  mat[3]  = 0;
  mat[4]  = r01 * length;  mat[5]  = r11 * length;  mat[6]  = r21 * length;  mat[7]  = 0;
  mat[8]  = r02 * radius;  mat[9]  = r12 * radius;  mat[10] = r22 * radius;  mat[11] = 0;
  mat[12] = mx;            mat[13] = my;             mat[14] = mz;            mat[15] = 1;

  return mat;
}

export function buildRenderData(
  graph: BeamGraph,
  trim: TrimResult | null = null,
  skin: SkinGraph | null = null,
  excludeBoundary: boolean = false,
): BeamRenderData {
  // Count visible main beams
  let mainVisible = 0;
  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    if (excludeBoundary && (graph.beamFlags[b] & BEAM_BOUNDARY)) continue;
    mainVisible++;
  }

  const skinCount = skin ? skin.beamCount : 0;
  const totalCount = mainVisible + skinCount;

  const matrices = new Float32Array(totalCount * 16);
  const renderToBeam = new Uint32Array(totalCount);
  let writeIdx = 0;

  // Main graph beams
  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;
    if (excludeBoundary && (graph.beamFlags[b] & BEAM_BOUNDARY)) continue;

    const n0 = graph.edges[b * 2];
    const n1 = graph.edges[b * 2 + 1];
    const p0 = getEffectivePosition(graph, trim, n0);
    const p1 = getEffectivePosition(graph, trim, n1);
    const radius = graph.beamRadii[b];

    const mat = computeBeamTransform(p0, p1, radius);
    matrices.set(mat, writeIdx * 16);
    renderToBeam[writeIdx] = b;
    writeIdx++;
  }

  const skinOffset = writeIdx;

  // Skin beams
  if (skin) {
    for (let s = 0; s < skin.beamCount; s++) {
      const n0 = skin.edges[s * 2];
      const n1 = skin.edges[s * 2 + 1];
      const p0: [number, number, number] = [
        skin.positions[n0 * 3], skin.positions[n0 * 3 + 1], skin.positions[n0 * 3 + 2],
      ];
      const p1: [number, number, number] = [
        skin.positions[n1 * 3], skin.positions[n1 * 3 + 1], skin.positions[n1 * 3 + 2],
      ];
      const radius = skin.beamRadii[s];

      const mat = computeBeamTransform(p0, p1, radius);
      matrices.set(mat, writeIdx * 16);
      renderToBeam[writeIdx] = graph.beamCount + s; // offset into skin space
      writeIdx++;
    }
  }

  return { matrices, colors: null, count: totalCount, renderToBeam, skinOffset };
}

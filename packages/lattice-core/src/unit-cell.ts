import type { UnitCell, Face } from './pipeline-types.js';

export const UNIT_CELL_IDS = ['cubic', 'kelvin', 'bccxy'] as const;

const FACE_AXIS: Record<Face, { axis: number; value: number }> = {
  '+x': { axis: 0, value: 1 },
  '-x': { axis: 0, value: 0 },
  '+y': { axis: 1, value: 1 },
  '-y': { axis: 1, value: 0 },
  '+z': { axis: 2, value: 1 },
  '-z': { axis: 2, value: 0 },
};

// Sort axes for face node ordering (the two axes that aren't the face normal)
const FACE_SORT_AXES: Record<Face, [number, number]> = {
  '+x': [1, 2], '-x': [1, 2],
  '+y': [0, 2], '-y': [0, 2],
  '+z': [0, 1], '-z': [0, 1],
};

const EPS = 1e-10;

export function computeFaceNodes(
  nodes: Float64Array,
  nodeCount: number,
): UnitCell['faceNodes'] {
  const faces: Face[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
  const result = {} as UnitCell['faceNodes'];

  for (const face of faces) {
    const { axis, value } = FACE_AXIS[face];
    const [sortA, sortB] = FACE_SORT_AXES[face];
    const indices: number[] = [];

    for (let i = 0; i < nodeCount; i++) {
      if (Math.abs(nodes[i * 3 + axis] - value) < EPS) {
        indices.push(i);
      }
    }

    // Sort by on-face coordinates so opposing faces pair index-for-index
    indices.sort((a, b) => {
      const da = nodes[a * 3 + sortA] - nodes[b * 3 + sortA];
      if (Math.abs(da) > EPS) return da;
      return nodes[a * 3 + sortB] - nodes[b * 3 + sortB];
    });

    result[face] = new Uint32Array(indices);
  }

  return result;
}

function createCubicCell(): UnitCell {
  // 8 nodes at unit cube corners
  const nodes = new Float64Array([
    0, 0, 0,  // 0
    1, 0, 0,  // 1
    0, 1, 0,  // 2
    1, 1, 0,  // 3
    0, 0, 1,  // 4
    1, 0, 1,  // 5
    0, 1, 1,  // 6
    1, 1, 1,  // 7
  ]);

  // 12 edges along cube edges, canonically ordered (a < b)
  const edges = new Uint32Array([
    0, 1,  // bottom face
    0, 2,
    1, 3,
    2, 3,
    4, 5,  // top face
    4, 6,
    5, 7,
    6, 7,
    0, 4,  // vertical edges
    1, 5,
    2, 6,
    3, 7,
  ]);

  const nodeCount = 8;
  const edgeCount = 12;
  const faceNodes = computeFaceNodes(nodes, nodeCount);

  return { id: 'cubic', nodes, edges, nodeCount, edgeCount, faceNodes };
}

function createKelvinCell(): UnitCell {
  // Truncated octahedron (Kelvin cell) — 24 nodes, 36 edges.
  // Nodes are at permutations of (0, 0.25, 0.5) scaled to [0,1] unit cube.
  // The Kelvin cell tiles space when placed on a BCC grid, but here we define
  // it within a single unit cube for compatibility with the population algorithm.
  //
  // Node layout: 6 square faces (4 nodes each) = 24 nodes.
  // Using the canonical truncated octahedron vertices scaled to [0,1]³:
  // Permutations of (0, ±1, ±2) / 4 + 0.5  →  [0,1] range
  const s = 0.25; // 1/4
  const h = 0.5;  // 2/4
  const nodes = new Float64Array([
    // x-axis aligned square faces (4 nodes × 2 faces)
    0, h - s, h,     // 0
    0, h + s, h,     // 1
    0, h, h - s,     // 2
    0, h, h + s,     // 3
    1, h - s, h,     // 4
    1, h + s, h,     // 5
    1, h, h - s,     // 6
    1, h, h + s,     // 7
    // y-axis aligned square faces
    h - s, 0, h,     // 8
    h + s, 0, h,     // 9
    h, 0, h - s,     // 10
    h, 0, h + s,     // 11
    h - s, 1, h,     // 12
    h + s, 1, h,     // 13
    h, 1, h - s,     // 14
    h, 1, h + s,     // 15
    // z-axis aligned square faces
    h - s, h, 0,     // 16
    h + s, h, 0,     // 17
    h, h - s, 0,     // 18
    h, h + s, 0,     // 19
    h - s, h, 1,     // 20
    h + s, h, 1,     // 21
    h, h - s, 1,     // 22
    h, h + s, 1,     // 23
  ]);

  // Edges connecting adjacent vertices of the truncated octahedron.
  // Each square face has 4 edges; hexagonal faces share edges between square faces.
  const edgePairs: [number, number][] = [
    // -x square face ring
    [0, 2], [2, 1], [1, 3], [3, 0],
    // +x square face ring
    [4, 6], [6, 5], [5, 7], [7, 4],
    // -y square face ring
    [8, 10], [10, 9], [9, 11], [11, 8],
    // +y square face ring
    [12, 14], [14, 13], [13, 15], [15, 12],
    // -z square face ring
    [16, 18], [18, 17], [17, 19], [19, 16],
    // +z square face ring
    [20, 22], [22, 21], [21, 23], [23, 20],
    // Hex face edges connecting square faces
    [0, 8], [2, 16], [1, 12], [3, 20],
    [4, 9], [6, 17], [5, 13], [7, 21],
    [10, 18], [11, 22], [14, 19], [15, 23],
  ];

  // Canonicalize and pack
  const edges = new Uint32Array(edgePairs.length * 2);
  for (let i = 0; i < edgePairs.length; i++) {
    const [a, b] = edgePairs[i];
    edges[i * 2]     = Math.min(a, b);
    edges[i * 2 + 1] = Math.max(a, b);
  }

  const nodeCount = 24;
  const edgeCount = edgePairs.length;
  const faceNodes = computeFaceNodes(nodes, nodeCount);

  return { id: 'kelvin', nodes, edges, nodeCount, edgeCount, faceNodes };
}

function createBccxyCell(): UnitCell {
  // Body-centered cubic with XY connections — 9 nodes, 20 edges.
  // 8 corner nodes + 1 center node, with edges from center to all corners
  // plus the 12 cube edges.
  const nodes = new Float64Array([
    0, 0, 0,  // 0
    1, 0, 0,  // 1
    0, 1, 0,  // 2
    1, 1, 0,  // 3
    0, 0, 1,  // 4
    1, 0, 1,  // 5
    0, 1, 1,  // 6
    1, 1, 1,  // 7
    0.5, 0.5, 0.5,  // 8 (center)
  ]);

  // 12 cube edges + 8 center-to-corner edges = 20 edges
  const edgePairs: [number, number][] = [
    // Cube edges (same as cubic)
    [0, 1], [0, 2], [1, 3], [2, 3],
    [4, 5], [4, 6], [5, 7], [6, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
    // Center to corners
    [0, 8], [1, 8], [2, 8], [3, 8],
    [4, 8], [5, 8], [6, 8], [7, 8],
  ];

  const edges = new Uint32Array(edgePairs.length * 2);
  for (let i = 0; i < edgePairs.length; i++) {
    const [a, b] = edgePairs[i];
    edges[i * 2]     = Math.min(a, b);
    edges[i * 2 + 1] = Math.max(a, b);
  }

  const nodeCount = 9;
  const edgeCount = edgePairs.length;
  const faceNodes = computeFaceNodes(nodes, nodeCount);

  return { id: 'bccxy', nodes, edges, nodeCount, edgeCount, faceNodes };
}

export function createUnitCell(id: string): UnitCell | null {
  switch (id) {
    case 'cubic': return createCubicCell();
    case 'kelvin': return createKelvinCell();
    case 'bccxy': return createBccxyCell();
    default: return null;
  }
}

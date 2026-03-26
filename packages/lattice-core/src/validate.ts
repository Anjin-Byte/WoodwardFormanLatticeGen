import type { UnitCell, Face, LatticeGrid } from './pipeline-types.js';

const EPS = 1e-10;

export function validateUnitCell(cell: UnitCell): string[] {
  const errors: string[] = [];

  // 1. nodeCount matches array length
  if (cell.nodes.length !== cell.nodeCount * 3) {
    errors.push(`nodes.length (${cell.nodes.length}) !== nodeCount * 3 (${cell.nodeCount * 3})`);
  }

  // 2. edgeCount matches array length
  if (cell.edges.length !== cell.edgeCount * 2) {
    errors.push(`edges.length (${cell.edges.length}) !== edgeCount * 2 (${cell.edgeCount * 2})`);
  }

  // 3. All node coordinates in [0,1]
  for (let i = 0; i < cell.nodes.length; i++) {
    const v = cell.nodes[i];
    if (v < -EPS || v > 1 + EPS) {
      errors.push(`node coordinate out of [0,1]: nodes[${i}] = ${v}`);
    }
  }

  // 4. No duplicate nodes
  for (let i = 0; i < cell.nodeCount; i++) {
    for (let j = i + 1; j < cell.nodeCount; j++) {
      const dx = cell.nodes[i * 3] - cell.nodes[j * 3];
      const dy = cell.nodes[i * 3 + 1] - cell.nodes[j * 3 + 1];
      const dz = cell.nodes[i * 3 + 2] - cell.nodes[j * 3 + 2];
      if (Math.abs(dx) < EPS && Math.abs(dy) < EPS && Math.abs(dz) < EPS) {
        errors.push(`duplicate nodes: ${i} and ${j}`);
      }
    }
  }

  // 5. Edge index range and canonical ordering
  const edgeSet = new Set<string>();
  for (let i = 0; i < cell.edgeCount; i++) {
    const a = cell.edges[i * 2];
    const b = cell.edges[i * 2 + 1];

    if (a >= cell.nodeCount || b >= cell.nodeCount) {
      errors.push(`edge ${i} has out-of-range index: (${a}, ${b}), nodeCount=${cell.nodeCount}`);
    }
    if (a === b) {
      errors.push(`self-loop at edge ${i}: (${a}, ${b})`);
    }
    if (a >= b) {
      errors.push(`edge ${i} not canonically ordered: (${a}, ${b}), expected a < b`);
    }

    const key = `${a},${b}`;
    if (edgeSet.has(key)) {
      errors.push(`duplicate edge: (${a}, ${b})`);
    }
    edgeSet.add(key);
  }

  // 6. Opposing face pairs have equal length
  const pairs: [Face, Face][] = [['+x', '-x'], ['+y', '-y'], ['+z', '-z']];
  for (const [pos, neg] of pairs) {
    if (cell.faceNodes[pos].length !== cell.faceNodes[neg].length) {
      errors.push(`face pair ${pos}/${neg} length mismatch: ${cell.faceNodes[pos].length} vs ${cell.faceNodes[neg].length}`);
    }
  }

  // 7. Face node indices are valid
  const faces: Face[] = ['+x', '-x', '+y', '-y', '+z', '-z'];
  for (const face of faces) {
    for (const idx of cell.faceNodes[face]) {
      if (idx >= cell.nodeCount) {
        errors.push(`faceNodes['${face}'] contains out-of-range index: ${idx}`);
      }
    }
  }

  // 8. Face node arrays are sorted by on-face coordinates
  const sortAxes: Record<Face, [number, number]> = {
    '+x': [1, 2], '-x': [1, 2],
    '+y': [0, 2], '-y': [0, 2],
    '+z': [0, 1], '-z': [0, 1],
  };
  for (const face of faces) {
    const arr = cell.faceNodes[face];
    const [axA, axB] = sortAxes[face];
    for (let i = 1; i < arr.length; i++) {
      const prevA = cell.nodes[arr[i - 1] * 3 + axA];
      const prevB = cell.nodes[arr[i - 1] * 3 + axB];
      const currA = cell.nodes[arr[i] * 3 + axA];
      const currB = cell.nodes[arr[i] * 3 + axB];
      if (currA < prevA - EPS || (Math.abs(currA - prevA) < EPS && currB < prevB - EPS)) {
        errors.push(`faceNodes['${face}'] not sorted at index ${i}`);
      }
    }
  }

  // 9. Graph is connected (BFS from node 0)
  // Only run if structural checks passed (edge indices are valid)
  const actualEdgeCount = cell.edges.length / 2;
  if (cell.nodeCount > 0 && actualEdgeCount > 0 && errors.length === 0) {
    const adj: number[][] = Array.from({ length: cell.nodeCount }, () => []);
    for (let i = 0; i < actualEdgeCount; i++) {
      const a = cell.edges[i * 2];
      const b = cell.edges[i * 2 + 1];
      adj[a].push(b);
      adj[b].push(a);
    }
    const visited = new Set<number>();
    const queue = [0];
    visited.add(0);
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const neighbor of adj[node]) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    if (visited.size !== cell.nodeCount) {
      errors.push(`graph not connected: BFS reached ${visited.size}/${cell.nodeCount} nodes`);
    }
  }

  // 10. Every edge index is in [0, nodeCount)
  // (already checked in step 5)

  return errors;
}

export function validateGrid(grid: LatticeGrid): string[] {
  const errors: string[] = [];
  if (grid.nx <= 0) errors.push(`nx must be > 0: ${grid.nx}`);
  if (grid.ny <= 0) errors.push(`ny must be > 0: ${grid.ny}`);
  if (grid.nz <= 0) errors.push(`nz must be > 0: ${grid.nz}`);
  if (grid.cellSize[0] <= 0) errors.push(`cellSize[0] must be > 0: ${grid.cellSize[0]}`);
  if (grid.cellSize[1] <= 0) errors.push(`cellSize[1] must be > 0: ${grid.cellSize[1]}`);
  if (grid.cellSize[2] <= 0) errors.push(`cellSize[2] must be > 0: ${grid.cellSize[2]}`);
  if (grid.nx * grid.ny * grid.nz > 2 ** 32 - 1) {
    errors.push(`totalCells exceeds Uint32 range: ${grid.nx * grid.ny * grid.nz}`);
  }
  return errors;
}

import { describe, it, expect } from 'vitest';
import { createUnitCell, UNIT_CELL_IDS } from './unit-cell.js';
import { validateUnitCell } from './validate.js';

describe('createUnitCell', () => {
  it('returns null for unknown IDs', () => {
    expect(createUnitCell('nonexistent')).toBeNull();
  });

  for (const id of UNIT_CELL_IDS) {
    describe(id, () => {
      const cell = createUnitCell(id)!;

      it('exists in catalog', () => {
        expect(cell).not.toBeNull();
        expect(cell.id).toBe(id);
      });

      it('passes all invariant checks', () => {
        const errors = validateUnitCell(cell);
        expect(errors).toEqual([]);
      });
    });
  }
});

describe('cubic unit cell', () => {
  const cell = createUnitCell('cubic')!;

  it('has 8 nodes', () => {
    expect(cell.nodeCount).toBe(8);
  });

  it('has 12 edges', () => {
    expect(cell.edgeCount).toBe(12);
  });

  it('all node coordinates are in [0, 1]', () => {
    for (let i = 0; i < cell.nodes.length; i++) {
      expect(cell.nodes[i]).toBeGreaterThanOrEqual(0);
      expect(cell.nodes[i]).toBeLessThanOrEqual(1);
    }
  });

  it('all edges are canonically ordered (a < b)', () => {
    for (let i = 0; i < cell.edgeCount; i++) {
      expect(cell.edges[i * 2]).toBeLessThan(cell.edges[i * 2 + 1]);
    }
  });

  it('has no duplicate edges', () => {
    const seen = new Set<string>();
    for (let i = 0; i < cell.edgeCount; i++) {
      const key = `${cell.edges[i * 2]},${cell.edges[i * 2 + 1]}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });

  it('has no duplicate nodes', () => {
    for (let i = 0; i < cell.nodeCount; i++) {
      for (let j = i + 1; j < cell.nodeCount; j++) {
        const dx = cell.nodes[i * 3] - cell.nodes[j * 3];
        const dy = cell.nodes[i * 3 + 1] - cell.nodes[j * 3 + 1];
        const dz = cell.nodes[i * 3 + 2] - cell.nodes[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
        expect(dist).toBeGreaterThan(1e-10);
      }
    }
  });

  it('face node pairs have equal length', () => {
    expect(cell.faceNodes['+x'].length).toBe(cell.faceNodes['-x'].length);
    expect(cell.faceNodes['+y'].length).toBe(cell.faceNodes['-y'].length);
    expect(cell.faceNodes['+z'].length).toBe(cell.faceNodes['-z'].length);
  });

  it('has 4 nodes per face (cube corners)', () => {
    expect(cell.faceNodes['+x'].length).toBe(4);
    expect(cell.faceNodes['-x'].length).toBe(4);
    expect(cell.faceNodes['+y'].length).toBe(4);
    expect(cell.faceNodes['-y'].length).toBe(4);
    expect(cell.faceNodes['+z'].length).toBe(4);
    expect(cell.faceNodes['-z'].length).toBe(4);
  });

  it('face nodes are sorted by on-face coordinates', () => {
    // +x face: sort by (y, z). Nodes on +x face have x=1.
    const pxNodes = cell.faceNodes['+x'];
    for (let i = 1; i < pxNodes.length; i++) {
      const prevY = cell.nodes[pxNodes[i - 1] * 3 + 1];
      const prevZ = cell.nodes[pxNodes[i - 1] * 3 + 2];
      const currY = cell.nodes[pxNodes[i] * 3 + 1];
      const currZ = cell.nodes[pxNodes[i] * 3 + 2];
      const ok = currY > prevY - 1e-10 || (Math.abs(currY - prevY) < 1e-10 && currZ >= prevZ - 1e-10);
      expect(ok).toBe(true);
    }
  });

  it('opposing face pairs have matching on-face coordinates', () => {
    // +x nodes (y,z) should match -x nodes (y,z) index-for-index
    const px = cell.faceNodes['+x'];
    const mx = cell.faceNodes['-x'];
    for (let i = 0; i < px.length; i++) {
      expect(cell.nodes[px[i] * 3 + 1]).toBeCloseTo(cell.nodes[mx[i] * 3 + 1], 10);
      expect(cell.nodes[px[i] * 3 + 2]).toBeCloseTo(cell.nodes[mx[i] * 3 + 2], 10);
    }
  });

  it('graph is connected', () => {
    const adj: number[][] = Array.from({ length: cell.nodeCount }, () => []);
    for (let i = 0; i < cell.edgeCount; i++) {
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
    expect(visited.size).toBe(cell.nodeCount);
  });
});

describe('kelvin unit cell', () => {
  const cell = createUnitCell('kelvin')!;

  it('has 24 nodes', () => {
    expect(cell.nodeCount).toBe(24);
  });

  it('has 36 edges', () => {
    expect(cell.edgeCount).toBe(36);
  });

  it('passes all invariant checks', () => {
    expect(validateUnitCell(cell)).toEqual([]);
  });
});

describe('bccxy unit cell', () => {
  const cell = createUnitCell('bccxy')!;

  it('has 9 nodes', () => {
    expect(cell.nodeCount).toBe(9);
  });

  it('has 20 edges', () => {
    expect(cell.edgeCount).toBe(20);
  });

  it('passes all invariant checks', () => {
    expect(validateUnitCell(cell)).toEqual([]);
  });
});

describe('validateUnitCell', () => {
  it('catches bad node count', () => {
    const cell = createUnitCell('cubic')!;
    const bad = { ...cell, nodeCount: 99 };
    const errors = validateUnitCell(bad);
    expect(errors.some(e => e.includes('nodeCount'))).toBe(true);
  });

  it('catches bad edge count', () => {
    const cell = createUnitCell('cubic')!;
    const bad = { ...cell, edgeCount: 99 };
    const errors = validateUnitCell(bad);
    expect(errors.some(e => e.includes('edgeCount'))).toBe(true);
  });
});

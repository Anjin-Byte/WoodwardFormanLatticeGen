import { describe, it, expect } from 'vitest';
import { clipBoundaryBeams } from './clip.js';
import { createUnitCell } from './unit-cell.js';
import { createGrid } from './grid.js';
import { populate } from './population.js';
import { buildBeamGraph } from './beam-graph.js';
import { createSphereDomain, createBoxDomain } from './domain.js';
import { classifyCells, applyClassification, trimBeams } from './boundary.js';
import { tessellateSphere, tessellateBox } from './triangle-mesh.js';
import { buildDomainIndex } from './domain-index.js';
import { createMeshDomain } from './mesh-domain.js';

describe('clipBoundaryBeams', () => {
  it('produces clipped meshes for boundary beams with sphere domain', () => {
    const cell = createUnitCell('cubic')!;
    const grid = createGrid(6, 6, 6, [1, 1, 1]);
    const pop = populate(cell, grid);
    const graph = buildBeamGraph(pop, grid, 0.1);

    const sphereMesh = tessellateSphere([3, 3, 3], 2.5, 16, 32);
    const domain = createMeshDomain(sphereMesh);
    const domainIndex = buildDomainIndex(sphereMesh, grid);

    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    const trim = trimBeams(graph, domain);

    const clipped = clipBoundaryBeams(graph, domain, sphereMesh, domainIndex, trim);

    expect(clipped.length).toBeGreaterThan(0);

    // Each clipped mesh should have valid geometry
    for (const c of clipped) {
      expect(c.mesh.vertexCount).toBeGreaterThan(0);
      expect(c.mesh.triangleCount).toBeGreaterThan(0);
      expect(c.mesh.positions.length).toBe(c.mesh.vertexCount * 3);
      expect(c.mesh.indices.length).toBe(c.mesh.triangleCount * 3);

      // All indices in range
      for (let i = 0; i < c.mesh.indices.length; i++) {
        expect(c.mesh.indices[i]).toBeLessThan(c.mesh.vertexCount);
      }

      // No NaN in positions
      for (let i = 0; i < c.mesh.positions.length; i++) {
        expect(Number.isFinite(c.mesh.positions[i])).toBe(true);
      }
    }
  });

  it('produces no clipped meshes when no boundary beams exist', () => {
    const cell = createUnitCell('cubic')!;
    const grid = createGrid(4, 4, 4, [1, 1, 1]);
    const pop = populate(cell, grid);
    const graph = buildBeamGraph(pop, grid, 0.05);

    // Domain fully containing the grid — no boundary beams
    const boxMesh = tessellateBox([-1, -1, -1], [5, 5, 5]);
    const domain = createMeshDomain(boxMesh);
    const domainIndex = buildDomainIndex(boxMesh, grid);

    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    const trim = trimBeams(graph, domain);

    const clipped = clipBoundaryBeams(graph, domain, boxMesh, domainIndex, trim);
    // All beams are interior — no boundary clipping needed
    expect(clipped.length).toBe(0);
  });

  it('clipped vertices are inside the domain (sphere check)', () => {
    const cell = createUnitCell('cubic')!;
    const grid = createGrid(6, 6, 6, [1, 1, 1]);
    const pop = populate(cell, grid);
    const graph = buildBeamGraph(pop, grid, 0.08);

    const center: [number, number, number] = [3, 3, 3];
    const radius = 2.5;
    const sphereMesh = tessellateSphere(center, radius, 16, 32);
    const domain = createMeshDomain(sphereMesh);
    const domainIndex = buildDomainIndex(sphereMesh, grid);

    const cls = classifyCells(graph, domain);
    applyClassification(graph, cls);
    const trim = trimBeams(graph, domain);

    const clipped = clipBoundaryBeams(graph, domain, sphereMesh, domainIndex, trim);

    // Most clipped vertices should be inside or near the sphere surface
    let outsideCount = 0;
    let totalVerts = 0;
    for (const c of clipped) {
      for (let v = 0; v < c.mesh.vertexCount; v++) {
        const x = c.mesh.positions[v * 3] - center[0];
        const y = c.mesh.positions[v * 3 + 1] - center[1];
        const z = c.mesh.positions[v * 3 + 2] - center[2];
        const dist = Math.sqrt(x * x + y * y + z * z);
        // Allow small tolerance beyond sphere surface (tessellation approximation)
        if (dist > radius + 0.15) outsideCount++;
        totalVerts++;
      }
    }

    // Less than 5% of vertices should be outside the sphere
    if (totalVerts > 0) {
      expect(outsideCount / totalVerts).toBeLessThan(0.05);
    }
  });
});

<script lang="ts">
  import { onMount } from 'svelte';
  import { Viewer, createLatticeMesh, updateLatticeMesh } from '@lattice/viewer';
  import {
    getLatticeRenderData, getDomainTriangleMesh, getActiveGrid, getClippedBeams,
    getShowBeams, getShowSkin, getShowDomainMesh, getShowGridBounds, getShowAxes,
    getDomainDisplayMode,
  } from '$lib/stores/lattice.svelte';
  import type { BeamRenderData, TriangleMesh, ClippedBeamResult } from '@lattice/core';
  import * as THREE from 'three';

  let containerEl: HTMLDivElement;
  let viewer: Viewer;

  // Managed Three.js objects
  let latticeMesh: THREE.InstancedMesh | null = null;
  let clippedMeshObj: THREE.Mesh | null = null;
  let domainMeshObj: THREE.Group | null = null;
  let gridBoundsObj: THREE.LineSegments | null = null;
  let axesObj: THREE.AxesHelper | null = null;

  // Reference tracking for incremental updates
  let prevRenderData: BeamRenderData | null = null;
  let prevClipped: ClippedBeamResult[] | null = null;
  let prevDomainMesh: TriangleMesh | null = null;

  onMount(() => {
    viewer = new Viewer();
    viewer.mount(containerEl);
    axesObj = new THREE.AxesHelper(2);
    viewer.add(axesObj);
    return () => viewer.dispose();
  });

  // ─── Lattice instanced beams ──────────────────────────────────────────────

  $effect(() => {
    const data = getLatticeRenderData();
    const show = getShowBeams();
    if (!viewer) return;

    if (data !== prevRenderData) {
      // Try incremental update if count matches
      if (latticeMesh && data && prevRenderData && data.count === prevRenderData.count) {
        updateLatticeMesh(latticeMesh, data);
      } else {
        // Full rebuild
        if (latticeMesh) {
          viewer.remove(latticeMesh);
          latticeMesh.geometry.dispose();
          (latticeMesh.material as THREE.Material).dispose();
          latticeMesh = null;
        }
        if (data && data.count > 0) {
          latticeMesh = createLatticeMesh(data);
          viewer.add(latticeMesh);
        }
      }
      prevRenderData = data;
    }

    if (latticeMesh) latticeMesh.visible = show;
  });

  // ─── Clipped boundary beams ───────────────────────────────────────────────

  $effect(() => {
    const clipped = getClippedBeams();
    const show = getShowBeams();
    if (!viewer) return;

    if (clipped !== prevClipped) {
      if (clippedMeshObj) {
        viewer.remove(clippedMeshObj);
        clippedMeshObj.geometry.dispose();
        (clippedMeshObj.material as THREE.Material).dispose();
        clippedMeshObj = null;
      }
      if (clipped.length > 0) {
        clippedMeshObj = mergeClippedMeshes(clipped);
        viewer.add(clippedMeshObj);
      }
      prevClipped = clipped;
    }

    if (clippedMeshObj) clippedMeshObj.visible = show;
  });

  // ─── Domain mesh ──────────────────────────────────────────────────────────

  $effect(() => {
    const mesh = getDomainTriangleMesh();
    const show = getShowDomainMesh();
    const mode = getDomainDisplayMode();
    if (!viewer) return;

    if (mesh !== prevDomainMesh) {
      if (domainMeshObj) {
        viewer.remove(domainMeshObj);
        domainMeshObj.traverse(o => {
          if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); }
        });
        domainMeshObj = null;
      }
      if (mesh && mesh.triangleCount > 0) {
        domainMeshObj = buildDomainGroup(mesh);
        viewer.add(domainMeshObj);
      }
      prevDomainMesh = mesh;
    }

    if (domainMeshObj) {
      domainMeshObj.visible = show;
      applyDomainMode(domainMeshObj, mode);
    }
  });

  // ─── Grid bounds ──────────────────────────────────────────────────────────

  $effect(() => {
    const show = getShowGridBounds();
    const g = getActiveGrid();
    if (!viewer) return;

    if (gridBoundsObj) { viewer.remove(gridBoundsObj); gridBoundsObj.geometry.dispose(); gridBoundsObj = null; }
    if (show) {
      const sx = g.nx * g.cellSize[0], sy = g.ny * g.cellSize[1], sz = g.nz * g.cellSize[2];
      const geo = new THREE.BoxGeometry(sx, sy, sz);
      const edges = new THREE.EdgesGeometry(geo);
      gridBoundsObj = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x4444aa, opacity: 0.5, transparent: true }));
      gridBoundsObj.position.set(g.origin[0] + sx / 2, g.origin[1] + sy / 2, g.origin[2] + sz / 2);
      viewer.add(gridBoundsObj);
      geo.dispose();
    }
  });

  // ─── Axes ─────────────────────────────────────────────────────────────────

  $effect(() => { if (axesObj) axesObj.visible = getShowAxes(); });

  // ─── Helpers ──────────────────────────────────────────────────────────────

  function mergeClippedMeshes(clipped: ClippedBeamResult[]): THREE.Mesh {
    let tv = 0, tt = 0;
    for (const c of clipped) { tv += c.mesh.vertexCount; tt += c.mesh.triangleCount; }

    const positions = new Float32Array(tv * 3);
    const indices = new Uint32Array(tt * 3);
    let vo = 0, io = 0, vb = 0;

    for (const c of clipped) {
      positions.set(c.mesh.positions, vo);
      for (let i = 0; i < c.mesh.indices.length; i++) indices[io + i] = c.mesh.indices[i] + vb;
      vo += c.mesh.positions.length;
      io += c.mesh.indices.length;
      vb += c.mesh.vertexCount;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(indices, 1));
    geo.computeVertexNormals();

    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0xff8c00, side: THREE.DoubleSide, flatShading: true,
    }));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  function buildDomainGroup(mesh: TriangleMesh): THREE.Group {
    const group = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(mesh.positions.slice(), 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(mesh.indices.slice(), 1));
    geo.computeVertexNormals();

    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      color: 0x448866, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false,
      name: 'solid',
    } as any)));
    group.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0x66aa88, wireframe: true, transparent: true, opacity: 0.3,
      name: 'wire',
    } as any)));

    group.children[0].name = 'solid';
    group.children[1].name = 'wire';
    return group;
  }

  function applyDomainMode(group: THREE.Group, mode: 'solid' | 'wireframe' | 'transparent') {
    const solid = group.getObjectByName('solid') as THREE.Mesh | undefined;
    const wire = group.getObjectByName('wire') as THREE.Mesh | undefined;
    if (!solid || !wire) return;
    if (mode === 'solid') {
      solid.visible = true; wire.visible = false;
      (solid.material as THREE.MeshStandardMaterial).opacity = 0.6;
      (solid.material as THREE.MeshStandardMaterial).depthWrite = true;
    } else if (mode === 'wireframe') {
      solid.visible = false; wire.visible = true;
      (wire.material as THREE.MeshBasicMaterial).opacity = 0.6;
    } else {
      solid.visible = true; wire.visible = true;
      (solid.material as THREE.MeshStandardMaterial).opacity = 0.15;
      (solid.material as THREE.MeshStandardMaterial).depthWrite = false;
      (wire.material as THREE.MeshBasicMaterial).opacity = 0.3;
    }
  }
</script>

<div bind:this={containerEl} class="absolute inset-0" data-testid="viewport"></div>

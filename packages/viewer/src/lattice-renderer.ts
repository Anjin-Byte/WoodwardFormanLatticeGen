import * as THREE from 'three';
import type { BeamRenderData } from '@lattice/core';

const CYLINDER_SEGMENTS = 8;

export function createLatticeMesh(
  data: BeamRenderData,
  material?: THREE.Material,
): THREE.InstancedMesh {
  const geo = new THREE.CylinderGeometry(1, 1, 1, CYLINDER_SEGMENTS, 1);
  const mat = material ?? new THREE.MeshStandardMaterial({ color: 0x6c63ff });
  const mesh = new THREE.InstancedMesh(geo, mat, data.count);

  const tempMatrix = new THREE.Matrix4();
  for (let i = 0; i < data.count; i++) {
    tempMatrix.fromArray(data.matrices, i * 16);
    mesh.setMatrixAt(i, tempMatrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  return mesh;
}

export function updateLatticeMesh(
  mesh: THREE.InstancedMesh,
  data: BeamRenderData,
): boolean {
  if (mesh.count !== data.count) {
    // Count changed — caller must dispose and create a new mesh
    return false;
  }

  const tempMatrix = new THREE.Matrix4();
  for (let i = 0; i < data.count; i++) {
    tempMatrix.fromArray(data.matrices, i * 16);
    mesh.setMatrixAt(i, tempMatrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  return true;
}

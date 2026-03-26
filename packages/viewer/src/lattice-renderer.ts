import * as THREE from 'three';
import type { BeamRenderData } from '@lattice/core';

export interface LatticeMeshOptions {
  segments?: number;
  flatShading?: boolean;
  wireframe?: boolean;
  color?: number;
}

export function createLatticeMesh(
  data: BeamRenderData,
  options?: LatticeMeshOptions,
): THREE.InstancedMesh {
  const segments = options?.segments ?? 8;
  const flatShading = options?.flatShading ?? false;
  const wireframe = options?.wireframe ?? false;
  const color = options?.color ?? 0x6c63ff;

  const geo = new THREE.CylinderGeometry(1, 1, 1, segments, 1);
  const mat = new THREE.MeshStandardMaterial({ color, flatShading, wireframe });
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

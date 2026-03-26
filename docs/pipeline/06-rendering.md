# Stage 6: Rendering

## Purpose

Convert the BeamGraph into GPU-renderable Three.js geometry. Rendering reads the BeamGraph and optional trim overlay but never mutates either.

## Architecture

Each beam is a cylinder. The renderer uses `THREE.InstancedMesh` with a shared cylinder geometry and per-instance transforms.

```
BeamGraph
   │
   ├──► BeamRenderData (compute transforms)
   │
   └──► Three.js InstancedMesh
           ├── base geometry: cylinder (shared)
           ├── instance matrices: Float32Array (4×4 per beam)
           └── instance colors: Float32Array (RGB per beam, optional)
```

## Data Structure

```ts
interface BeamRenderData {
  /** 4×4 column-major matrices, one per visible beam.
   *  Length = visibleBeamCount * 16. */
  matrices: Float32Array;

  /** RGB color per visible beam. Length = visibleBeamCount * 3. Optional. */
  colors: Float32Array | null;

  /** How many beams to render. */
  count: number;

  /** Map from render index back to BeamGraph beam index.
   *  Needed for picking / selection. */
  renderToBeam: Uint32Array;
}
```

## Transform Computation

For each visible beam (not REMOVED), compute a 4×4 matrix that transforms a unit cylinder (height 1, radius 1, centered at origin, aligned along Y) to the beam's world-space position, orientation, and scale.

```
function computeBeamTransform(
  p0: [number, number, number],  // start endpoint
  p1: [number, number, number],  // end endpoint
  radius: number,
): Float32Array {
  // Midpoint (translation)
  const mx = (p0[0] + p1[0]) / 2;
  const my = (p0[1] + p1[1]) / 2;
  const mz = (p0[2] + p1[2]) / 2;

  // Direction vector
  const dx = p1[0] - p0[0];
  const dy = p1[1] - p0[1];
  const dz = p1[2] - p0[2];
  const length = Math.sqrt(dx*dx + dy*dy + dz*dz);

  // Rotation: align Y-axis to beam direction.
  // Use quaternion or build rotation matrix from axis-angle.
  // The "up" vector for the cylinder is (0,1,0).
  // Target direction is (dx, dy, dz) / length.
  const rotation = quaternionFromUnitVectors([0, 1, 0], [dx/length, dy/length, dz/length]);

  // Scale: radius on X/Z, length on Y.
  // Compose: T * R * S

  return mat4_compose(
    translation: [mx, my, mz],
    rotation: rotation,
    scale: [radius, length, radius],
  );
}
```

## Control Flow

```
function buildRenderData(
  graph: BeamGraph,
  trim: TrimResult | null,
): BeamRenderData {
  // Count visible beams
  let visibleCount = 0;
  for (let b = 0; b < graph.beamCount; b++) {
    if (!(graph.beamFlags[b] & BEAM_REMOVED)) visibleCount++;
  }

  const matrices = new Float32Array(visibleCount * 16);
  const renderToBeam = new Uint32Array(visibleCount);
  let writeIdx = 0;

  for (let b = 0; b < graph.beamCount; b++) {
    if (graph.beamFlags[b] & BEAM_REMOVED) continue;

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

  return { matrices, colors: null, count: visibleCount, renderToBeam };
}
```

## Three.js Integration

```ts
// In the Viewer class or a dedicated LatticeRenderer:

function createLatticeMesh(data: BeamRenderData): THREE.InstancedMesh {
  // Shared geometry: cylinder with enough segments to look smooth
  const geo = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  const mat = new THREE.MeshStandardMaterial({ color: 0x6c63ff });

  const mesh = new THREE.InstancedMesh(geo, mat, data.count);

  // Set instance matrices
  const tempMatrix = new THREE.Matrix4();
  for (let i = 0; i < data.count; i++) {
    tempMatrix.fromArray(data.matrices, i * 16);
    mesh.setMatrixAt(i, tempMatrix);
  }

  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}
```

## Update Strategy

When the BeamGraph changes (e.g., user changes strut radius, grid size, or boundary), the render data must be rebuilt. There are two approaches:

**Full rebuild:** Recompute all transforms. Simple, correct. For 1M beams, this is ~50ms in TS — acceptable for parameter changes that don't happen at 60fps.

**Incremental update:** Only update transforms for beams whose data changed. Requires diffing. Not needed initially.

For interactive strut radius changes (slider), the radius only affects scale — a partial update that rewrites just the scale component of each matrix is possible. Defer until needed.

## Coloring

Optional per-beam coloring for visual encoding:

| Encoding | Purpose |
|---|---|
| Uniform | Default: all beams one color |
| By flag | Interior=blue, boundary=orange, trimmed=red, skin=green |
| By cell | Hue from cell index — shows grid structure |
| By radius | Gradient from min to max radius — shows grading |
| By stress | Future: map simulation results to color |

Implementation: set `mesh.instanceColor` with a `THREE.InstancedBufferAttribute`.

## Node Rendering (Optional)

For debugging and visual polish, render spheres at lattice nodes:

```ts
const nodeGeo = new THREE.SphereGeometry(1, 8, 6);
const nodeMesh = new THREE.InstancedMesh(nodeGeo, mat, nodeCount);
// Per-node: translate to position, uniform scale = max adjacent beam radius
```

This is optional and toggled by the user.

## Performance Targets

| Metric | Target |
|---|---|
| Transform computation (1M beams) | < 100ms |
| GPU upload (1M instances) | < 50ms |
| Render framerate (1M instances) | 30+ fps |
| Memory (1M beams, matrices only) | 64 MB |

For lattices exceeding ~2M beams, consider chunked rendering with frustum culling per chunk.

## Testing

- **Single beam:** Verify transform places cylinder correctly between two known points.
- **Zero-length beam:** Degenerate — should be filtered or handled gracefully (skip it).
- **REMOVED beams excluded:** Verify `count` matches expected visible count.
- **renderToBeam mapping:** For each render index, verify the referenced beam is not REMOVED.
- **Matrix correctness:** For a beam from (0,0,0) to (0,1,0) with radius 0.5: expect identity rotation, translation (0, 0.5, 0), scale (0.5, 1, 0.5).
- **Color array length:** If colors are provided, `colors.length === count * 3`.

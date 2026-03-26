# Stage 7: Derived Properties

## Purpose

Compute physical and structural properties of the lattice analytically from the BeamGraph and unit cell parameters. These values inform design decisions and are used for pressure drop prediction per Inayat et al.

All derived properties are computed on demand — they are pure functions of the current lattice state, not cached or stored.

## Data Structure

```ts
interface LatticeProperties {
  /** Open porosity ε_o: fraction of cell volume that is void.
   *  Range [0, 1]. Relevant for fluid dynamics. */
  openPorosity: number;

  /** Total porosity ε_t = ε_o + ε_s (open + strut porosity).
   *  For solid struts (no hollow core), ε_t ≈ ε_o. */
  totalPorosity: number;

  /** Strut diameter d_s = 2 * beam radius. In world units. */
  strutDiameter: number;

  /** Window diameter d_w: average opening size between struts.
   *  Approximated from cell diameter: d_w ≈ d_c / 2.3 (Eq. 40, Inayat). */
  windowDiameter: number;

  /** Cell diameter d_c: characteristic pore size (cell edge length). */
  cellDiameter: number;

  /** Geometric specific surface area S_{v-geo}: total strut surface per unit volume.
   *  Units: 1/length. Computed from Eq. 34 (Inayat). */
  specificSurfaceArea: number;

  /** Geometric tortuosity τ: ratio of effective flow path to straight-line distance.
   *  Dimensionless, ≥ 1. Computed from Eq. 35 (Inayat). */
  tortuosity: number;

  /** Hydraulic diameter d_h = 4·ε_o / S_{v-geo}. (Eq. 16, Inayat). */
  hydraulicDiameter: number;
}
```

## Computation

### Porosity

```
// Volume of one strut (beam) as a cylinder:
V_strut(length, radius) = π · radius² · length

// Total solid volume in one unit cell:
V_solid = Σ V_strut(length_i, radius_i) for each beam in cell
        - overlap correction at nodes (sphere-cylinder intersection)

// For uniform radius and ignoring node overlap (first approximation):
V_solid_approx = π · r² · Σ length_i

// Cell volume:
V_cell = cellSize[0] * cellSize[1] * cellSize[2]

// Open porosity:
ε_o = 1 - V_solid / V_cell
```

Node overlap correction: at each node, N beams meet. The overlapping volume is approximately a sphere of radius r. Subtract (N-1) sphere volumes per node to avoid double-counting. This is a refinement — start without it.

### Specific Surface Area (Eq. 34, Inayat et al.)

For the tetrakaidecahedron (Kelvin cell) model:

```
S_{v-geo} = φ · [1 - 0.971·(1-ε_o)^0.5] / (d_w · (1-ε_o)^0.5) · (1 - ε_o)
```

Where:
- `φ` is a shape constant for the strut cross-section:
  - Cylindrical struts: φ ≈ 4.87
  - Triangular struts: φ ≈ 5.62
  - Concave triangular struts: φ ≈ 6.49
- `d_w` is the window diameter
- `ε_o` is the open porosity

For a lattice generator producing cylindrical struts, use φ = 4.87.

### Tortuosity (Eq. 35, Inayat et al.)

```
τ = 1 + φ · [1 - 0.971·(1-ε_o)^0.5] · (1-ε_o) / (4·ε_o · (1-ε_o)^0.5)
```

### Pressure Drop (Eq. 22, Inayat et al.)

```
ΔP/L = A · (μ / (ε_o · d_h²)) · V + B · (ρ / (ε_o² · d_h)) · V²

where:
  A = 32·τ²                    (Eq. 23)
  B = τ³ / 2                   (Eq. 24)
  d_h = 4·ε_o / S_{v-geo}     (Eq. 16)
  V = fluid velocity (m/s)
  μ = dynamic viscosity (Pa·s)
  ρ = fluid density (kg/m³)
  L = flow length (m)
```

### Dimensionless Form (Eq. 27)

```
Re = d_h · V · ρ / (ε_o · μ)           (Reynolds number, Eq. 25)
Hg = (ΔP/L) · d_h³ · ρ / μ²           (Hagen number, Eq. 26)
Hg = A · Re + B · Re²                  (Eq. 27)
```

## API

```ts
function computeLatticeProperties(
  cell: UnitCell,
  grid: LatticeGrid,
  strutRadius: number,
  strutShape?: 'cylindrical' | 'triangular' | 'concave-triangular',
): LatticeProperties;

function computePressureDrop(
  props: LatticeProperties,
  velocity: number,         // m/s
  fluidDensity: number,     // kg/m³
  fluidViscosity: number,   // Pa·s
  flowLength: number,       // m
): number;                  // ΔP in Pa
```

These are pure functions — no side effects, no state.

## Input Validation

- `strutRadius > 0`.
- `strutRadius < min(cellSize) / 2` (strut can't be wider than the cell).
- `ε_o` must be in (0, 1). If the radius is so large that porosity ≤ 0, the lattice is solid — return NaN or error.
- Pressure drop inputs must be > 0.

## Testing

- **Known cubic cell:** For a cubic unit cell with known dimensions and radius, hand-compute porosity and verify.
- **Porosity limits:** As radius → 0, porosity → 1. As radius → max, porosity → 0.
- **Tortuosity at ε_o = 1:** τ → 1 (no obstructions, straight flow). Verify limit behavior.
- **Pressure drop at V = 0:** ΔP = 0.
- **Dimensionless form:** Verify Hg = A·Re + B·Re² matches the dimensional form for same inputs.
- **Cross-reference with Inayat Table 1:** For aluminum foam at 45 PPI, ε_o = 0.978, verify S_{v-geo} ≈ 4092 m⁻¹ (calculated value from the paper).
- **Monotonicity:** Pressure drop increases with velocity (both terms positive). Pressure drop increases as porosity decreases (denser lattice → more resistance).

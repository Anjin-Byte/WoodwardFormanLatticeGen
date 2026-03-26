import type { UnitCell, LatticeGrid, LatticeProperties } from './pipeline-types.js';

export type StrutShape = 'cylindrical' | 'triangular' | 'concave-triangular';

// Shape constant φ from Inayat et al. Eq. 34
const PHI: Record<StrutShape, number> = {
  'cylindrical': 4.87,
  'triangular': 5.62,
  'concave-triangular': 6.49,
};

export function computeLatticeProperties(
  cell: UnitCell,
  grid: LatticeGrid,
  strutRadius: number,
  strutShape: StrutShape = 'cylindrical',
): LatticeProperties {
  const cellVolume = grid.cellSize[0] * grid.cellSize[1] * grid.cellSize[2];

  // Compute total strut length in one unit cell
  let totalStrutLength = 0;
  for (let e = 0; e < cell.edgeCount; e++) {
    const a = cell.edges[e * 2];
    const b = cell.edges[e * 2 + 1];
    const dx = (cell.nodes[b * 3]     - cell.nodes[a * 3])     * grid.cellSize[0];
    const dy = (cell.nodes[b * 3 + 1] - cell.nodes[a * 3 + 1]) * grid.cellSize[1];
    const dz = (cell.nodes[b * 3 + 2] - cell.nodes[a * 3 + 2]) * grid.cellSize[2];
    totalStrutLength += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // Solid volume = π·r²·totalLength (cylindrical struts, ignoring node overlap)
  const solidVolume = Math.PI * strutRadius * strutRadius * totalStrutLength;

  // Open porosity (Eq. 38 concept: ε_o = 1 - ρ_g/ρ_b, simplified for generated lattices)
  const openPorosity = Math.max(0, Math.min(1, 1 - solidVolume / cellVolume));
  const totalPorosity = openPorosity; // No hollow struts in generated lattices

  const strutDiameter = 2 * strutRadius;

  // Cell diameter ≈ characteristic length of the cell
  const cellDiameter = (grid.cellSize[0] + grid.cellSize[1] + grid.cellSize[2]) / 3;

  // Window diameter approximation: d_w ≈ d_c / 2.3 (Inayat et al. Eq. 40)
  const windowDiameter = cellDiameter / 2.3;

  // Geometric specific surface area S_v-geo (Inayat et al. Eq. 34)
  const phi = PHI[strutShape];
  const eps = openPorosity;

  let specificSurfaceArea: number;
  let tortuosity: number;
  let hydraulicDiameter: number;

  if (eps <= 0 || eps >= 1) {
    specificSurfaceArea = NaN;
    tortuosity = NaN;
    hydraulicDiameter = NaN;
  } else {
    const oneMinusEps = 1 - eps;
    const sqrtOneMinusEps = Math.sqrt(oneMinusEps);
    const bracket = 1 - 0.971 * sqrtOneMinusEps;

    // Eq. 34: S_v-geo = φ · [1 - 0.971·(1-ε_o)^0.5] / (d_w · (1-ε_o)^0.5) · (1-ε_o)
    specificSurfaceArea = phi * bracket * oneMinusEps / (windowDiameter * sqrtOneMinusEps);

    // Eq. 35: τ = 1 + φ·[1-0.971·(1-ε_o)^0.5]·(1-ε_o) / (4·ε_o·(1-ε_o)^0.5)
    tortuosity = 1 + phi * bracket * oneMinusEps / (4 * eps * sqrtOneMinusEps);

    // Eq. 16: d_h = 4·ε_o / S_v-geo
    hydraulicDiameter = 4 * eps / specificSurfaceArea;
  }

  return {
    openPorosity,
    totalPorosity,
    strutDiameter,
    windowDiameter,
    cellDiameter,
    specificSurfaceArea,
    tortuosity,
    hydraulicDiameter,
  };
}

/**
 * Compute pressure drop ΔP across the lattice (Inayat et al. Eq. 22).
 * Returns ΔP in Pa.
 */
export function computePressureDrop(
  props: LatticeProperties,
  velocity: number,       // m/s
  fluidDensity: number,   // kg/m³
  fluidViscosity: number, // Pa·s
  flowLength: number,     // m
): number {
  const { openPorosity: eps, tortuosity: tau, hydraulicDiameter: dh } = props;

  if (!Number.isFinite(tau) || !Number.isFinite(dh) || dh <= 0 || eps <= 0) {
    return NaN;
  }

  // Eq. 23: A = 32·τ²
  const A = 32 * tau * tau;
  // Eq. 24: B = τ³ / 2
  const B = (tau * tau * tau) / 2;

  // Eq. 22: ΔP/L = A·(μ/(ε_o·d_h²))·V + B·(ρ/(ε_o²·d_h))·V²
  const dPperL =
    A * (fluidViscosity / (eps * dh * dh)) * velocity +
    B * (fluidDensity / (eps * eps * dh)) * velocity * velocity;

  return dPperL * flowLength;
}

import { describe, it, expect } from 'vitest';
import { createUnitCell } from './unit-cell.js';
import { createGrid } from './grid.js';
import { computeLatticeProperties, computePressureDrop } from './derived-properties.js';

const cubic = createUnitCell('cubic')!;

describe('computeLatticeProperties', () => {
  it('porosity approaches 1 as radius → 0', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const props = computeLatticeProperties(cubic, grid, 0.001);
    expect(props.openPorosity).toBeGreaterThan(0.99);
  });

  it('porosity decreases as radius increases', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const small = computeLatticeProperties(cubic, grid, 0.01);
    const large = computeLatticeProperties(cubic, grid, 0.1);
    expect(large.openPorosity).toBeLessThan(small.openPorosity);
  });

  it('porosity is in (0, 1) for reasonable radii', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const props = computeLatticeProperties(cubic, grid, 0.05);
    expect(props.openPorosity).toBeGreaterThan(0);
    expect(props.openPorosity).toBeLessThan(1);
  });

  it('strutDiameter is 2 × radius', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const props = computeLatticeProperties(cubic, grid, 0.05);
    expect(props.strutDiameter).toBeCloseTo(0.1);
  });

  it('tortuosity ≥ 1', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const props = computeLatticeProperties(cubic, grid, 0.05);
    expect(props.tortuosity).toBeGreaterThanOrEqual(1);
  });

  it('tortuosity approaches 1 as porosity → 1', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const props = computeLatticeProperties(cubic, grid, 0.001);
    expect(props.tortuosity).toBeLessThan(1.05);
  });

  it('specific surface area is positive', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const props = computeLatticeProperties(cubic, grid, 0.05);
    expect(props.specificSurfaceArea).toBeGreaterThan(0);
  });

  it('hydraulic diameter is positive', () => {
    const grid = createGrid(1, 1, 1, [1, 1, 1]);
    const props = computeLatticeProperties(cubic, grid, 0.05);
    expect(props.hydraulicDiameter).toBeGreaterThan(0);
  });
});

describe('computePressureDrop', () => {
  const grid = createGrid(1, 1, 1, [0.002, 0.002, 0.002]); // 2mm cells
  const props = computeLatticeProperties(cubic, grid, 0.0002); // 0.2mm radius

  it('ΔP = 0 when velocity = 0', () => {
    const dp = computePressureDrop(props, 0, 1.2, 1.8e-5, 0.01);
    expect(dp).toBe(0);
  });

  it('ΔP > 0 for positive velocity', () => {
    const dp = computePressureDrop(props, 1, 1.2, 1.8e-5, 0.01);
    expect(dp).toBeGreaterThan(0);
  });

  it('ΔP increases with velocity (monotonic)', () => {
    const dp1 = computePressureDrop(props, 1, 1.2, 1.8e-5, 0.01);
    const dp2 = computePressureDrop(props, 2, 1.2, 1.8e-5, 0.01);
    const dp5 = computePressureDrop(props, 5, 1.2, 1.8e-5, 0.01);
    expect(dp2).toBeGreaterThan(dp1);
    expect(dp5).toBeGreaterThan(dp2);
  });

  it('ΔP increases as porosity decreases', () => {
    const propsLowPorosity = computeLatticeProperties(cubic, grid, 0.0003); // slightly thicker struts
    const dpHigh = computePressureDrop(props, 1, 1.2, 1.8e-5, 0.01);
    const dpLow = computePressureDrop(propsLowPorosity, 1, 1.2, 1.8e-5, 0.01);
    expect(dpLow).toBeGreaterThan(dpHigh);
  });

  it('dimensionless consistency: Hg = A·Re + B·Re²', () => {
    const V = 2;
    const rho = 1.2;
    const mu = 1.8e-5;
    const L = 0.01;
    const { openPorosity: eps, tortuosity: tau, hydraulicDiameter: dh } = props;

    const Re = dh * V * rho / (eps * mu);
    const A = 32 * tau * tau;
    const B = (tau ** 3) / 2;
    const Hg = A * Re + B * Re * Re;

    // Hg = (ΔP/L) · d_h³ · ρ / μ²
    const dp = computePressureDrop(props, V, rho, mu, L);
    const HgFromDp = (dp / L) * (dh ** 3) * rho / (mu ** 2);

    expect(HgFromDp).toBeCloseTo(Hg, 0);
  });
});

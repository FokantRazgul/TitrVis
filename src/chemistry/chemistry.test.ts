import { describe, expect, it } from 'vitest';
import { activityCoefficient, daviesLog10Gamma, ionicStrength } from './activities';
import { linearSRGBToXYZ, referenceWhite, transmittanceToColour, xyzToLinearSRGB } from './colour';
import { PKW_25C } from './constants';
import { ChemistryError, chargeBalanceOfSpecies, chargeBalanceResidualAt, massBalanceError, solveEquilibrium } from './equilibrium';
import { analyseEquivalence, curveDerivative, detectInflections, indicatorError, indicatorTransitionVolume } from './equivalence';
import { INDICATORS, baseFraction, getIndicator, indicatorAbsorptivities, typicalStockConcentrationM } from './indicators';
import { brent, expandBracket } from './solver';
import { GRID, GRID_LENGTH, evaluateBands, resampleToGrid, spectrumMaximum, spectrumOnGrid } from './spectra';
import { SUBSTANCES, getSubstance, protonCapacity, reactiveSubstances, searchSubstances, substanceLadders } from './substances';
import { buildProblem, computeReferenceCurve, computeTitrationState, pHAt, titrantRole, type TitrationSetup } from './titration';
import type { EquilibriumProblem } from './types';
import { checkNumber, validateDatabases } from './validation';

const ideal = (partial: Partial<EquilibriumProblem>): EquilibriumProblem => ({
  ladders: [],
  spectators: [],
  pKw: PKW_25C,
  activityModel: 'ideal',
  temperatureC: 25,
  ...partial,
});

function setup(overrides: Partial<TitrationSetup> = {}): TitrationSetup {
  return {
    analyte: getSubstance('acetic_acid'),
    analyteConcentrationM: 0.1,
    analyteVolumeML: 50,
    titrant: getSubstance('sodium_hydroxide'),
    titrantConcentrationM: 0.1,
    indicator: null,
    activityModel: 'ideal',
    temperatureC: 25,
    opticalPathCm: 4,
    ...overrides,
  };
}

/** Deterministic PRNG (mulberry32) for property tests. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('root finder', () => {
  it('finds the root of a smooth function to tolerance', () => {
    const r = brent((x) => x * x - 2, 0, 2, { xTolerance: 1e-12, maxIterations: 100 });
    expect(r.converged).toBe(true);
    expect(r.root).toBeCloseTo(Math.SQRT2, 11);
    expect(r.iterations).toBeLessThan(20);
  });
  it('rejects an unbracketed interval', () => {
    expect(() => brent((x) => x * x + 1, 0, 1, { xTolerance: 1e-9, maxIterations: 10 })).toThrow(/not bracketed/);
  });
  it('expands a bracket until a sign change appears', () => {
    const b = expandBracket((x) => x - 7, 0, 1, -100, 100);
    expect(b).not.toBeNull();
    expect(b![0]).toBeLessThan(7);
    expect(b![1]).toBeGreaterThan(7);
  });
});

describe('required chemistry tests', () => {
  it('Test 1: 0.1 M HCl has pH ≈ 1.00', () => {
    const r = solveEquilibrium(ideal({ spectators: [{ formula: 'Cl-', charge: -1, concentration: 0.1, origin: 'hcl' }] }));
    expect(r.pH).toBeCloseTo(1.0, 3);
    expect(r.converged).toBe(true);
  });
  it('Test 2: 0.1 M NaOH has pH ≈ 13.00', () => {
    const r = solveEquilibrium(ideal({ spectators: [{ formula: 'Na+', charge: 1, concentration: 0.1, origin: 'naoh' }] }));
    expect(r.pH).toBeCloseTo(13.0, 3);
  });
  it('Test 3: 0.1 M acetic acid (Ka = 1.8e-5) has pH ≈ 2.88', () => {
    const pKa = -Math.log10(1.8e-5);
    const r = solveEquilibrium(
      ideal({ ladders: [{ pKas: [pKa], maxCharge: 0, totalConcentration: 0.1, speciesFormulas: ['HA', 'A-'], origin: 'hac' }] }),
    );
    expect(r.pH).toBeCloseTo(2.88, 2);
  });
  it('Test 4: half-neutralised acetic acid has pH ≈ pKa = 4.76', () => {
    const s = setup();
    const state = computeTitrationState(s, 25);
    expect(state.pH).toBeCloseTo(4.756, 2);
    expect(state.neutralisationDegree).toBeCloseTo(0.5, 9);
  });
  it('Test 5: acetic acid / NaOH equivalence point pH ≈ 8.7 (model tolerance ±0.05)', () => {
    // 0.05 M acetate: [OH-] = sqrt(Kb·C) with Kb = 1e-14/10^-4.756 → pH 8.73
    const s = setup();
    const eq = analyseEquivalence(s);
    expect(eq.points).toHaveLength(1);
    expect(eq.points[0].volumeML).toBeCloseTo(50, 9);
    expect(eq.points[0].pH).toBeCloseTo(8.73, 1);
    expect(Math.abs(eq.points[0].pH - 8.7)).toBeLessThan(0.05);
    expect(eq.points[0].detectable).toBe(true);
  });
  it('Test 6: phosphoric acid / NaOH shows two detectable equivalence points and an undetectable third', () => {
    const s = setup({ analyte: getSubstance('phosphoric_acid') });
    const eq = analyseEquivalence(s);
    expect(eq.points.map((p) => p.volumeML)).toEqual([50, 100, 150]);
    // First equivalence (H2PO4⁻ dominant): pH ≈ (pKa1 + pKa2)/2 ≈ 4.68
    expect(eq.points[0].pH).toBeCloseTo((2.16 + 7.21) / 2, 0);
    // Second equivalence (HPO4²⁻ dominant): pH ≈ (pKa2 + pKa3)/2 ≈ 9.77
    expect(eq.points[1].pH).toBeGreaterThan(9.3);
    expect(eq.points[1].pH).toBeLessThan(10.0);
    expect(eq.points[0].detectable).toBe(true);
    expect(eq.points[1].detectable).toBe(true);
    expect(eq.points[2].detectable).toBe(false);
    // pH increases monotonically along the curve.
    const curve = computeReferenceCurve(s, 160, 100);
    for (let i = 1; i < curve.length; i++) expect(curve[i].pH).toBeGreaterThanOrEqual(curve[i - 1].pH - 1e-9);
    // Buffer regions sit at the pKa values at half-steps.
    expect(pHAt(s, 25)).toBeCloseTo(2.16, 0);
    expect(pHAt(s, 75)).toBeCloseTo(7.21, 1);
    expect(pHAt(s, 125)).toBeCloseTo(12.32, 0);
  });
  it('Test 7: mass balance holds for every ladder', () => {
    const s = setup({ analyte: getSubstance('citric_acid'), indicator: { indicator: getIndicator('phenolphthalein'), stockConcentrationM: 3e-3, volumeML: 0.1 } });
    const problem = buildProblem(s, 70);
    const r = solveEquilibrium(problem);
    expect(massBalanceError(problem, r.species)).toBeLessThan(1e-12);
    for (const ladder of problem.ladders) {
      const sum = r.species.filter((sp) => sp.origin === ladder.origin && sp.kind === 'ladder').reduce((a, sp) => a + sp.concentration, 0);
      expect(sum).toBeCloseTo(ladder.totalConcentration, 12);
    }
  });
  it('Test 8: charge balance residual < 1e-6 (and scale-aware tolerance) for many states', () => {
    const s = setup({ analyte: getSubstance('phosphoric_acid') });
    for (const v of [0, 10, 49.9, 50, 50.1, 100, 125, 150, 200]) {
      const r = solveEquilibrium(buildProblem(s, v));
      expect(Math.abs(chargeBalanceOfSpecies(r.species))).toBeLessThan(1e-6);
      expect(r.residual).toBeLessThan(1e-10);
    }
  });
  it('Test 9: very dilute HCl (1e-6 M) approaches the water autoionisation regime', () => {
    const r = solveEquilibrium(ideal({ spectators: [{ formula: 'Cl-', charge: -1, concentration: 1e-6, origin: 'hcl' }] }));
    // Exact: [H+] = (C + sqrt(C² + 4Kw))/2 = 1.0099e-6 → pH 5.9957
    expect(r.pH).toBeCloseTo(5.9957, 3);
    const r2 = solveEquilibrium(ideal({ spectators: [{ formula: 'Cl-', charge: -1, concentration: 1e-9, origin: 'hcl' }] }));
    expect(r2.pH).toBeCloseTo(7.0, 2);
    const pure = solveEquilibrium(ideal({}));
    expect(pure.pH).toBeCloseTo(7.0, 9);
  });
});

describe('equilibrium engine details', () => {
  it('solves weak bases from pKb (0.1 M ammonia pH ≈ 11.12)', () => {
    const r = solveEquilibrium(buildProblem(setup({ analyte: getSubstance('ammonia') }), 0));
    expect(r.pH).toBeCloseTo(11.12, 1);
  });
  it('treats sulfuric acid first dissociation as complete', () => {
    const r = solveEquilibrium(buildProblem(setup({ analyte: getSubstance('sulfuric_acid'), analyteConcentrationM: 0.01 }), 0));
    // 0.01 M H2SO4: [H+] between 0.01 and 0.02 → pH between 1.70 and 2.00
    expect(r.pH).toBeGreaterThan(1.7);
    expect(r.pH).toBeLessThan(2.0);
    const hso4 = r.species.find((s) => s.formula === 'HSO4-')!;
    const so4 = r.species.find((s) => s.formula === 'SO4^2-')!;
    expect(hso4.concentration + so4.concentration).toBeCloseTo(0.01, 12);
  });
  it('salts hydrolyse correctly (0.1 M sodium acetate pH ≈ 8.88, 0.1 M NH4Cl pH ≈ 5.13)', () => {
    expect(pHAt(setup({ analyte: getSubstance('sodium_acetate') }), 0)).toBeCloseTo(8.88, 1);
    expect(pHAt(setup({ analyte: getSubstance('ammonium_chloride') }), 0)).toBeCloseTo(5.13, 1);
  });
  it('ampholytes sit near the mean of adjacent pKa values (0.1 M NaHCO3 pH ≈ 8.3)', () => {
    expect(pHAt(setup({ analyte: getSubstance('sodium_bicarbonate') }), 0)).toBeCloseTo((6.35 + 10.33) / 2, 0);
  });
  it('borax hydrolyses to a boric/borate buffer (pH ≈ pKa 9.27)', () => {
    expect(pHAt(setup({ analyte: getSubstance('sodium_tetraborate'), analyteConcentrationM: 0.05 }), 0)).toBeCloseTo(9.27, 1);
  });
  it('rejects invalid problems and never returns NaN', () => {
    expect(() => solveEquilibrium(ideal({ spectators: [{ formula: 'X', charge: 1, concentration: -1, origin: 'x' }] }))).toThrow(ChemistryError);
    expect(() => solveEquilibrium(ideal({ spectators: [{ formula: 'X', charge: 1, concentration: Number.NaN, origin: 'x' }] }))).toThrow(ChemistryError);
    expect(() => solveEquilibrium(ideal({ pKw: Number.NaN }))).toThrow(ChemistryError);
  });
  it('charge-balance residual is monotonically decreasing in pH', () => {
    const problem = buildProblem(setup({ analyte: getSubstance('citric_acid') }), 40);
    let previous = Number.POSITIVE_INFINITY;
    for (let pH = -1; pH <= 15; pH += 0.25) {
      const f = chargeBalanceResidualAt(problem, pH);
      expect(f).toBeLessThan(previous);
      previous = f;
    }
  });
  it('reports solver diagnostics', () => {
    const r = solveEquilibrium(buildProblem(setup(), 30));
    expect(r.diagnostics.rootIterations).toBeGreaterThan(0);
    expect(r.diagnostics.activityIterations).toBe(1);
    expect(r.diagnostics.ionicStrength).toBeGreaterThan(0);
    expect(r.diagnostics.bracket[0]).toBeLessThan(r.pH);
    expect(r.diagnostics.bracket[1]).toBeGreaterThan(r.pH);
  });
});

describe('activity model (Davies)', () => {
  it('computes ionic strength and γ correctly', () => {
    expect(ionicStrength([0.1, 0.1], [1, -1])).toBeCloseTo(0.1, 12);
    expect(ionicStrength([0.1, 0.2], [2, -1])).toBeCloseTo(0.3, 12);
    // Davies at I = 0.1, z = 1: log γ = −0.5085 (0.3162/1.3162 − 0.03) = −0.1069 → γ ≈ 0.782
    expect(daviesLog10Gamma(1, 0.1)).toBeCloseTo(-0.1069, 3);
    expect(activityCoefficient('davies', 1, 0.1)).toBeCloseTo(0.782, 2);
    expect(activityCoefficient('davies', 2, 0.1)).toBeCloseTo(Math.pow(0.782, 4), 2);
    expect(activityCoefficient('ideal', 2, 0.5)).toBe(1);
    expect(activityCoefficient('davies', 0, 0.5)).toBe(1);
  });
  it('lowers the pH of 0.1 M HCl to about 0.11 (γ± ≈ 0.78)', () => {
    const r = solveEquilibrium({
      ...ideal({ spectators: [{ formula: 'Cl-', charge: -1, concentration: 0.1, origin: 'hcl' }] }),
      activityModel: 'davies',
    });
    expect(r.pH).toBeCloseTo(1.107, 2);
    expect(r.hydrogenConcentration).toBeCloseTo(0.1, 9);
    expect(r.diagnostics.activityIterations).toBeGreaterThan(1);
    expect(r.diagnostics.ionicStrength).toBeCloseTo(0.1, 6);
  });
  it('shifts the acetate buffer pH and is deterministic', () => {
    const s = setup({ activityModel: 'davies' });
    const a = computeTitrationState(s, 25);
    const b = computeTitrationState(s, 25);
    expect(a.pH).toBe(b.pH);
    // With 0.033 M Na+/acetate the ionic strength lowers the apparent pKa by ~0.1
    expect(a.pH).toBeLessThan(4.756);
    expect(a.pH).toBeGreaterThan(4.55);
    expect(a.solver.diagnostics.warnings).toHaveLength(0);
  });
  it('warns when the Davies validity range is exceeded', () => {
    const r = solveEquilibrium({
      ...ideal({ spectators: [{ formula: 'Cl-', charge: -1, concentration: 1, origin: 'hcl' }] }),
      activityModel: 'davies',
    });
    expect(r.diagnostics.warnings.some((w) => /Davies/.test(w))).toBe(true);
  });
});

describe('numerical robustness', () => {
  it('handles extreme allowed concentrations without NaN', () => {
    for (const c of [1e-4, 1e-3, 1, 10]) {
      for (const id of ['hydrochloric_acid', 'sodium_hydroxide', 'acetic_acid', 'ammonia', 'phosphoric_acid', 'citric_acid']) {
        const r = solveEquilibrium(buildProblem(setup({ analyte: getSubstance(id), analyteConcentrationM: c }), 0));
        expect(Number.isFinite(r.pH)).toBe(true);
        for (const sp of r.species) expect(sp.concentration).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('is smooth through equivalence (before, at, after)', () => {
    const s = setup();
    const before = pHAt(s, 49.999);
    const at = pHAt(s, 50);
    const after = pHAt(s, 50.001);
    expect(before).toBeLessThan(at);
    expect(at).toBeLessThan(after);
    expect(pHAt(s, 100)).toBeCloseTo(12.5, 1); // 0.05 mmol/mL excess... 5 mmol in 150 mL → 0.0333 M → pH 12.52
  });
  it('property test: random valid configurations solve with finite, balanced results', () => {
    const random = rng(20260905);
    const reactive = reactiveSubstances();
    for (let i = 0; i < 300; i++) {
      const analyte = reactive[Math.floor(random() * reactive.length)];
      const titrant = reactive[Math.floor(random() * reactive.length)];
      const s = setup({
        analyte,
        titrant,
        analyteConcentrationM: Math.pow(10, -4 + 5 * random()),
        titrantConcentrationM: Math.pow(10, -4 + 5 * random()),
        analyteVolumeML: 1 + 999 * random(),
        activityModel: random() < 0.3 ? 'davies' : 'ideal',
        indicator: random() < 0.5 ? { indicator: INDICATORS[Math.floor(random() * INDICATORS.length)], stockConcentrationM: 1e-3, volumeML: 0.1 } : null,
      });
      const v = random() * 2 * s.analyteVolumeML;
      const r = solveEquilibrium(buildProblem(s, v));
      expect(Number.isFinite(r.pH)).toBe(true);
      expect(r.converged).toBe(true);
      expect(Math.abs(chargeBalanceOfSpecies(r.species))).toBeLessThan(1e-6);
      for (const sp of r.species) {
        expect(Number.isFinite(sp.concentration)).toBe(true);
        expect(sp.concentration).toBeGreaterThanOrEqual(0);
      }
    }
  });
  it('repeated additions and reset are deterministic', () => {
    const s = setup();
    const first = [10, 20, 30].map((v) => pHAt(s, v));
    const second = [10, 20, 30].map((v) => pHAt(s, v));
    expect(first).toEqual(second);
  });
});

describe('titration engine', () => {
  it('decides the titrant role from the pure-solution pH values', () => {
    expect(titrantRole(setup())).toBe('base');
    expect(titrantRole(setup({ analyte: getSubstance('ammonia'), titrant: getSubstance('hydrochloric_acid') }))).toBe('acid');
    expect(titrantRole(setup({ analyte: getSubstance('hydrochloric_acid'), titrant: getSubstance('nitric_acid') }))).toBe('none');
  });
  it('dilutes with the total volume including the indicator', () => {
    const ind = { indicator: getIndicator('phenolphthalein'), stockConcentrationM: 3.14e-3, volumeML: 0.1 };
    const state = computeTitrationState(setup({ indicator: ind }), 20);
    expect(state.totalVolumeML).toBeCloseTo(70.1, 9);
    const problem = buildProblem(setup({ indicator: ind }), 20);
    const acetate = problem.ladders.find((l) => l.origin.startsWith('analyte'))!;
    expect(acetate.totalConcentration).toBeCloseTo(5 / 70.1, 9);
    expect(state.indicator!.concentrationM).toBeCloseTo((3.14e-3 * 0.1) / 70.1, 12);
  });
  it('produces an adaptively refined reference curve resolving the jump', () => {
    const curve = computeReferenceCurve(setup(), 100, 50);
    expect(curve.length).toBeGreaterThan(51);
    const near = curve.filter((p) => Math.abs(p.addedVolumeML - 50) < 1);
    expect(near.length).toBeGreaterThan(3);
    const inflections = detectInflections(curve);
    expect(inflections.length).toBeGreaterThanOrEqual(1);
    expect(Math.abs(inflections[0] - 50)).toBeLessThan(0.5);
    const d = curveDerivative(curve);
    expect(Math.max(...d)).toBeGreaterThan(1);
  });
  it('polyfunctional titrant stoichiometry (Ca(OH)2 vs H3PO4)', () => {
    const eq = analyseEquivalence(setup({ analyte: getSubstance('phosphoric_acid'), titrant: getSubstance('calcium_hydroxide'), titrantConcentrationM: 0.02 }));
    // 5 mmol H3PO4; each Ca(OH)2 accepts 2 protons → V_eq1 = 5 / (0.02·2) = 125 mL
    expect(eq.points[0].volumeML).toBeCloseTo(125, 9);
    expect(eq.titrantCapacity).toBe(2);
  });
  it('weak base titrated with strong acid has equivalence below 7', () => {
    const s = setup({ analyte: getSubstance('ammonia'), titrant: getSubstance('hydrochloric_acid') });
    const eq = analyseEquivalence(s);
    expect(eq.role).toBe('acid');
    expect(eq.points[0].volumeML).toBeCloseTo(50, 9);
    expect(eq.points[0].pH).toBeCloseTo(5.28, 1);
  });
});

describe('indicator model', () => {
  it('base fraction follows Ka/(Ka + [H+])', () => {
    const pp = getIndicator('phenolphthalein');
    expect(baseFraction(pp, Math.pow(10, -pp.pKa))).toBeCloseTo(0.5, 12);
    expect(baseFraction(pp, 1e-7)).toBeLessThan(0.01);
    expect(baseFraction(pp, 1e-12)).toBeGreaterThan(0.99);
  });
  it('solved indicator fractions match the closed form and the ratio [HIn]/[In-]', () => {
    const ind = { indicator: getIndicator('bromothymol_blue'), stockConcentrationM: 6.4e-4, volumeML: 0.2 };
    const state = computeTitrationState(setup({ indicator: ind }), 30);
    const expected = baseFraction(ind.indicator, state.solver.hydrogenActivity);
    expect(state.indicator!.fractionBase).toBeCloseTo(expected, 9);
    expect(state.indicator!.ratioAcidToBase).toBeCloseTo((1 - expected) / expected, 6);
  });
  it('transition volume differs from the equivalence volume and yields an indicator error', () => {
    const s = setup({ indicator: { indicator: getIndicator('phenolphthalein'), stockConcentrationM: 3.14e-3, volumeML: 0.1 } });
    const transition = indicatorTransitionVolume(s, 100);
    expect(transition).not.toBeNull();
    expect(transition!.pH).toBeCloseTo(9.4, 9);
    // pH 9.4 is reached slightly after equivalence (pH_eq ≈ 8.73): V_tr > 50 mL but close.
    expect(transition!.volumeML).toBeGreaterThan(50);
    expect(transition!.volumeML).toBeLessThan(50.2);
    const eq = analyseEquivalence(s);
    const err = indicatorError(transition, eq);
    expect(err).not.toBeNull();
    expect(err!.deltaML).toBeGreaterThan(0);
    expect(err!.percent).toBeCloseTo((100 * err!.deltaML) / 50, 9);
    // Methyl orange (pKa 3.46) changes long before equivalence in this titration.
    const mo = setup({ indicator: { indicator: getIndicator('methyl_orange'), stockConcentrationM: 1e-3, volumeML: 0.1 } });
    const trMo = indicatorTransitionVolume(mo, 100);
    expect(trMo!.volumeML).toBeLessThan(5);
    expect(indicatorError(trMo, analyseEquivalence(mo))!.deltaML).toBeLessThan(-40);
  });
  it('returns null when the indicator pKa is never reached', () => {
    const s = setup({ titrant: getSubstance('hydrochloric_acid'), indicator: { indicator: getIndicator('phenolphthalein'), stockConcentrationM: 1e-3, volumeML: 0.1 } });
    expect(indicatorTransitionVolume(s, 100)).toBeNull();
  });
  it('typical stock concentration derives from % w/v', () => {
    // 0.1 % w/v phenolphthalein = 1 g/L / 318.3 g/mol
    expect(typicalStockConcentrationM(getIndicator('phenolphthalein'))).toBeCloseTo(1 / 318.3, 9);
  });
});

describe('spectra', () => {
  it('reconstructed maxima lie within ±10 nm of the cited λmax', () => {
    for (const ind of INDICATORS) {
      const eps = indicatorAbsorptivities(ind);
      for (const [bands, values] of [
        [ind.reconstruction!.acidBands, eps.acid],
        [ind.reconstruction!.baseBands, eps.base],
      ] as const) {
        if (bands.length === 0) {
          expect(values.every((v) => v === 0)).toBe(true);
          continue;
        }
        const strongest = bands.reduce((a, b) => (b.epsilonMax > a.epsilonMax ? b : a));
        const max = spectrumMaximum(values)!;
        expect(Math.abs(max.wavelength - strongest.centreNm)).toBeLessThanOrEqual(10);
        expect(max.value / strongest.epsilonMax).toBeGreaterThan(0.99);
        expect(max.value / strongest.epsilonMax).toBeLessThanOrEqual(1.0 + 1e-9);
      }
    }
  });
  it('resamples arbitrary tables onto the grid with zero outside the range', () => {
    const values = resampleToGrid([
      { wavelength: 400, molarAbsorptivity: 0 },
      { wavelength: 500, molarAbsorptivity: 100 },
      { wavelength: 600, molarAbsorptivity: 0 },
    ]);
    expect(values).toHaveLength(GRID_LENGTH);
    expect(values[GRID.indexOf(450)]).toBeCloseTo(50, 9);
    expect(values[GRID.indexOf(500)]).toBeCloseTo(100, 9);
    expect(values[GRID.indexOf(380)]).toBe(0);
    expect(values[GRID.indexOf(700)]).toBe(0);
    expect(evaluateBands([{ centreNm: 500, fwhmNm: 100, epsilonMax: 10 }], 550)).toBeCloseTo(5, 9);
  });
  it('spectra of the database are on the common grid', () => {
    for (const ind of INDICATORS) {
      expect(spectrumOnGrid(ind.spectra.base)).toHaveLength(GRID_LENGTH);
      expect(ind.spectra.base.data[0].wavelength).toBe(380);
      expect(ind.spectra.base.data[ind.spectra.base.data.length - 1].wavelength).toBe(780);
    }
  });
});

describe('colour pipeline', () => {
  it('pure water under D65 is white', () => {
    const white = referenceWhite();
    expect(white.xyz[1]).toBeCloseTo(1, 9);
    expect(white.linear[0]).toBeCloseTo(1, 2);
    expect(white.linear[1]).toBeCloseTo(1, 2);
    expect(white.linear[2]).toBeCloseTo(1, 2);
    expect(white.hex.toLowerCase()).toMatch(/^#f[e-f]f[e-f]f[e-f]$/);
  });
  it('XYZ ↔ linear sRGB matrices are mutually inverse', () => {
    const rgb: [number, number, number] = [0.2, 0.5, 0.7];
    const back = xyzToLinearSRGB(linearSRGBToXYZ(rgb));
    expect(back[0]).toBeCloseTo(rgb[0], 5);
    expect(back[1]).toBeCloseTo(rgb[1], 5);
    expect(back[2]).toBeCloseTo(rgb[2], 5);
  });
  it('phenolphthalein in base is pink/magenta, bromothymol blue in base is blue, acid form yellow', () => {
    const pathCm = 4;
    const colourOf = (id: string, fBase: number, conc: number) => {
      const ind = getIndicator(id);
      const eps = indicatorAbsorptivities(ind);
      const T = GRID.map((_, i) => Math.pow(10, -((1 - fBase) * eps.acid[i] + fBase * eps.base[i]) * conc * pathCm));
      return transmittanceToColour(T);
    };
    const pink = colourOf('phenolphthalein', 1, 1e-5);
    expect(pink.srgb[0]).toBeGreaterThan(pink.srgb[1]);
    expect(pink.srgb[2]).toBeGreaterThan(pink.srgb[1]);
    const colourless = colourOf('phenolphthalein', 0, 1e-5);
    expect(colourless.linear.every((c) => c > 0.98)).toBe(true);
    const blue = colourOf('bromothymol_blue', 1, 1e-5);
    expect(blue.srgb[2]).toBeGreaterThan(blue.srgb[0]);
    expect(blue.srgb[2]).toBeGreaterThan(blue.srgb[1]);
    const yellow = colourOf('bromothymol_blue', 0, 1e-5);
    expect(yellow.srgb[0]).toBeGreaterThan(yellow.srgb[2]);
    expect(yellow.srgb[1]).toBeGreaterThan(yellow.srgb[2]);
    const red = colourOf('methyl_orange', 0, 1e-5);
    expect(red.srgb[0]).toBeGreaterThan(red.srgb[1]);
    expect(red.srgb[0]).toBeGreaterThan(red.srgb[2]);
  });
  it('the titration state colour is the pipeline colour', () => {
    const s = setup({ indicator: { indicator: getIndicator('phenolphthalein'), stockConcentrationM: 3.14e-3, volumeML: 0.1 } });
    const state = computeTitrationState(s, 55);
    expect(state.indicator!.colour.hex).toMatch(/^#[0-9a-f]{6}$/);
    expect(state.indicator!.colour).toEqual(transmittanceToColour(state.indicator!.transmittance));
    expect(state.indicator!.fractionBase).toBeGreaterThan(0.9);
    expect(state.indicator!.colour.srgb[1]).toBeLessThan(state.indicator!.colour.srgb[0]);
  });
});

describe('databases', () => {
  it('contain at least 50 substances and 10 indicators', () => {
    expect(SUBSTANCES.length).toBeGreaterThanOrEqual(50);
    expect(INDICATORS.length).toBeGreaterThanOrEqual(10);
  });
  it('validate without issues', () => {
    expect(validateDatabases(SUBSTANCES, INDICATORS)).toEqual([]);
  });
  it('derive proton capacities from stoichiometry', () => {
    expect(protonCapacity(getSubstance('hydrochloric_acid'))).toEqual({ donatable: 1, acceptable: 0 });
    expect(protonCapacity(getSubstance('calcium_hydroxide'))).toEqual({ donatable: 0, acceptable: 2 });
    expect(protonCapacity(getSubstance('phosphoric_acid'))).toEqual({ donatable: 3, acceptable: 0 });
    expect(protonCapacity(getSubstance('sodium_bicarbonate'))).toEqual({ donatable: 1, acceptable: 1 });
    expect(protonCapacity(getSubstance('sodium_carbonate'))).toEqual({ donatable: 0, acceptable: 2 });
    expect(protonCapacity(getSubstance('ammonium_chloride'))).toEqual({ donatable: 1, acceptable: 0 });
    expect(protonCapacity(getSubstance('sodium_tetraborate'))).toEqual({ donatable: 2, acceptable: 2 });
    expect(protonCapacity(getSubstance('potassium_hydrogen_phthalate'))).toEqual({ donatable: 1, acceptable: 1 });
    expect(protonCapacity(getSubstance('ammonium_acetate'))).toEqual({ donatable: 1, acceptable: 1 });
    expect(protonCapacity(getSubstance('sodium_chloride'))).toEqual({ donatable: 0, acceptable: 0 });
    expect(protonCapacity(getSubstance('glycine'))).toEqual({ donatable: 1, acceptable: 1 });
  });
  it('converts base systems to ascending ladders', () => {
    const [en] = substanceLadders(getSubstance('ethylenediamine'));
    expect(en.pKas).toEqual([6.86, 9.92]);
    expect(en.maxCharge).toBe(2);
    expect(en.speciesFormulas).toEqual(['enH2^2+', 'enH+', 'en']);
    const [nh3] = substanceLadders(getSubstance('ammonia'));
    expect(nh3.pKas[0]).toBeCloseTo(9.25, 9);
    expect(nh3.maxCharge).toBe(1);
  });
  it('search filters by name and formula in both languages', () => {
    expect(searchSubstances('acet').map((s) => s.id)).toContain('acetic_acid');
    expect(searchSubstances('уксус').map((s) => s.id)).toContain('acetic_acid');
    expect(searchSubstances('NaOH').map((s) => s.id)).toEqual(['sodium_hydroxide']);
    expect(searchSubstances('')).toHaveLength(SUBSTANCES.length);
  });
  it('rejects invalid data loudly', () => {
    const bad = { ...getSubstance('acetic_acid'), id: 'bad', acidSystem: { pKas: [5, 4], charges: [-1, -2], speciesFormulas: ['a', 'b', 'c'] } };
    const issues = validateDatabases([bad], []);
    expect(issues.length).toBeGreaterThan(0);
  });
});

describe('input validation', () => {
  it('checks ranges and finiteness', () => {
    expect(checkNumber('0.1', { min: 0.0001, max: 10 }, 'M')).toEqual({ ok: true, value: 0.1 });
    expect(checkNumber('0,25', { min: 0, max: 1 }, 'M').value).toBeCloseTo(0.25);
    expect(checkNumber('abc', { min: 1, max: 1000 }, 'mL').ok).toBe(false);
    expect(checkNumber('', { min: 1, max: 1000 }, 'mL')).toMatchObject({ ok: false, message: 'Enter a number (mL).' });
    expect(checkNumber(5000, { min: 1, max: 1000 }, 'mL')).toMatchObject({ ok: false, value: 1000 });
    expect(checkNumber(-1, { min: 1, max: 1000 }, 'mL')).toMatchObject({ ok: false, value: 1 });
    expect(checkNumber(Number.POSITIVE_INFINITY, { min: 1, max: 1000 }, 'mL').ok).toBe(false);
  });
});

/**
 * Titration engine.
 *
 * Builds the equilibrium problem for the flask contents at a given added titrant
 * volume (analyte + titrant + indicator, all diluted to the current total volume),
 * solves it, and derives the indicator state and colour from the solved species.
 *
 *   V_total = V_analyte + V_titrant + V_indicator
 *   c_i     = n_i / V_total
 */

import { transmittanceToColour } from './colour';
import { PKW_25C } from './constants';
import { solveEquilibrium } from './equilibrium';
import { indicatorAbsorptivities, indicatorComponents } from './indicators';
import { absorbanceSpectrum, mixtureAbsorptivity, transmittanceSpectrum } from './spectra';
import { protonCapacity, substanceLadderComponents } from './substances';
import type {
  ActivityModel,
  EquilibriumProblem,
  Indicator,
  IndicatorEquilibriumState,
  LadderComponent,
  SolverResult,
  SpectatorComponent,
  Substance,
} from './types';

export interface IndicatorDose {
  indicator: Indicator;
  /** Concentration of the stock solution added, mol/L. */
  stockConcentrationM: number;
  /** Volume of stock solution added, mL. */
  volumeML: number;
}

export interface TitrationSetup {
  analyte: Substance;
  analyteConcentrationM: number;
  analyteVolumeML: number;
  titrant: Substance;
  titrantConcentrationM: number;
  indicator: IndicatorDose | null;
  activityModel: ActivityModel;
  temperatureC: number;
  /** Optical path length (cm) used for the Beer–Lambert colour of the flask contents. */
  opticalPathCm: number;
}

export interface TitrationPoint {
  addedVolumeML: number;
  pH: number;
}

export interface TitrationState {
  addedVolumeML: number;
  totalVolumeML: number;
  pH: number;
  pOH: number;
  /** Fraction of the analyte's titratable capacity that has been consumed (may exceed 1). */
  neutralisationDegree: number;
  solver: SolverResult;
  indicator: IndicatorEquilibriumState | null;
}

export function pKwFor(temperatureC: number): number {
  // The model is defined at 25 °C only (see constants.ts); any other temperature is rejected upstream.
  if (Math.abs(temperatureC - 25) > 1e-9) {
    throw new Error(`Temperature ${temperatureC} °C is not supported; the model is defined at 25 °C`);
  }
  return PKW_25C;
}

export function totalVolumeML(setup: TitrationSetup, addedTitrantML: number): number {
  return setup.analyteVolumeML + addedTitrantML + (setup.indicator ? setup.indicator.volumeML : 0);
}

/** Assemble the equilibrium problem for the flask at the given added titrant volume. */
export function buildProblem(setup: TitrationSetup, addedTitrantML: number): EquilibriumProblem {
  if (!Number.isFinite(addedTitrantML) || addedTitrantML < 0) {
    throw new Error(`Invalid added titrant volume ${addedTitrantML}`);
  }
  const pKw = pKwFor(setup.temperatureC);
  const vTotalL = totalVolumeML(setup, addedTitrantML) / 1000;
  const ladders: LadderComponent[] = [];
  const spectators: SpectatorComponent[] = [];

  const addSubstance = (substance: Substance, moles: number, role: string) => {
    for (const ladder of substanceLadderComponents(substance, moles, vTotalL, pKw)) {
      ladders.push({ ...ladder, origin: `${role}:${ladder.origin}` });
    }
    for (const ion of substance.stoichiometry.spectatorIons) {
      spectators.push({
        formula: ion.formula,
        charge: ion.charge,
        concentration: (moles * ion.count) / vTotalL,
        origin: `${role}:${substance.id}`,
      });
    }
  };

  addSubstance(setup.analyte, (setup.analyteConcentrationM * setup.analyteVolumeML) / 1000, 'analyte');
  addSubstance(setup.titrant, (setup.titrantConcentrationM * addedTitrantML) / 1000, 'titrant');
  if (setup.indicator) {
    const moles = (setup.indicator.stockConcentrationM * setup.indicator.volumeML) / 1000;
    const parts = indicatorComponents(setup.indicator.indicator, moles, vTotalL);
    ladders.push(parts.ladder);
    spectators.push(...parts.spectators);
  }
  return { ladders, spectators, pKw, activityModel: setup.activityModel, temperatureC: setup.temperatureC };
}

/** Which role the titrant plays against this analyte, decided from the pure solutions' pH. */
export type TitrantRole = 'base' | 'acid' | 'none';

export function titrantRole(setup: TitrationSetup): TitrantRole {
  const capA = protonCapacity(setup.analyte);
  const capT = protonCapacity(setup.titrant);
  const pKw = pKwFor(setup.temperatureC);
  const pureA = solveEquilibrium({
    ...buildProblem({ ...setup, indicator: null }, 0),
    pKw,
  }).pH;
  const pureT = solveEquilibrium(
    buildProblem(
      {
        ...setup,
        indicator: null,
        analyte: setup.titrant,
        analyteConcentrationM: setup.titrantConcentrationM,
        analyteVolumeML: 100,
      },
      0,
    ),
  ).pH;
  if (pureT > pureA && capT.acceptable > 0 && capA.donatable > 0) return 'base';
  if (pureT < pureA && capT.donatable > 0 && capA.acceptable > 0) return 'acid';
  return 'none';
}

/** Titratable analyte capacity and titrant capacity for the active direction (per formula unit). */
export function reactionCapacities(setup: TitrationSetup, role: TitrantRole): { analyte: number; titrant: number } {
  const capA = protonCapacity(setup.analyte);
  const capT = protonCapacity(setup.titrant);
  if (role === 'base') return { analyte: capA.donatable, titrant: capT.acceptable };
  if (role === 'acid') return { analyte: capA.acceptable, titrant: capT.donatable };
  return { analyte: 0, titrant: 0 };
}

function indicatorState(
  setup: TitrationSetup,
  solver: SolverResult,
  totalML: number,
): IndicatorEquilibriumState | null {
  if (!setup.indicator) return null;
  const dose = setup.indicator;
  const origin = `indicator:${dose.indicator.id}`;
  const acidSpecies = solver.species.find((s) => s.origin === origin && s.formula === 'HIn');
  const baseSpecies = solver.species.find((s) => s.origin === origin && s.formula === 'In-');
  if (!acidSpecies || !baseSpecies) {
    throw new Error('Indicator species missing from the solved equilibrium');
  }
  const concentrationM = (dose.stockConcentrationM * dose.volumeML) / totalML;
  const fractionBase = baseSpecies.fraction;
  const fractionAcid = acidSpecies.fraction;
  const eps = indicatorAbsorptivities(dose.indicator);
  const molarAbsorptivity = mixtureAbsorptivity(eps.acid, eps.base, fractionBase);
  const absorbance = absorbanceSpectrum(molarAbsorptivity, concentrationM, setup.opticalPathCm);
  const transmittance = transmittanceSpectrum(absorbance);
  return {
    concentrationM,
    fractionBase,
    fractionAcid,
    ratioAcidToBase: fractionBase > 0 ? fractionAcid / fractionBase : Number.POSITIVE_INFINITY,
    absorbance,
    molarAbsorptivity,
    transmittance,
    colour: transmittanceToColour(transmittance),
    pathLengthCm: setup.opticalPathCm,
  };
}

/** Solve the flask at the given added titrant volume. Throws ChemistryError on failure. */
export function computeTitrationState(setup: TitrationSetup, addedTitrantML: number, role?: TitrantRole): TitrationState {
  const problem = buildProblem(setup, addedTitrantML);
  const solver = solveEquilibrium(problem);
  const totalML = totalVolumeML(setup, addedTitrantML);
  const activeRole = role ?? titrantRole(setup);
  const caps = reactionCapacities(setup, activeRole);
  const analyteEquivalents = setup.analyteConcentrationM * setup.analyteVolumeML * caps.analyte;
  const titrantEquivalents = setup.titrantConcentrationM * addedTitrantML * caps.titrant;
  const neutralisationDegree = analyteEquivalents > 0 ? titrantEquivalents / analyteEquivalents : 0;
  return {
    addedVolumeML: addedTitrantML,
    totalVolumeML: totalML,
    pH: solver.pH,
    pOH: solver.pOH,
    neutralisationDegree,
    solver,
    indicator: indicatorState(setup, solver, totalML),
  };
}

/** pH only (cheaper than the full state; used by root finding and curve sampling). */
export function pHAt(setup: TitrationSetup, addedTitrantML: number): number {
  return solveEquilibrium(buildProblem(setup, addedTitrantML)).pH;
}

/**
 * Dense reference curve pH(V) on [0, vMaxML], adaptively refined where the curve is
 * steep so that equivalence jumps are resolved. Computed entirely by the equilibrium
 * solver — it is a sampled model prediction, never a stored curve.
 */
export function computeReferenceCurve(
  setup: TitrationSetup,
  vMaxML: number,
  initialPoints = 200,
  maxPoints = 1500,
  maxDeltaPH = 0.05,
): TitrationPoint[] {
  const points: TitrationPoint[] = [];
  for (let i = 0; i <= initialPoints; i++) {
    const v = (vMaxML * i) / initialPoints;
    points.push({ addedVolumeML: v, pH: pHAt(setup, v) });
  }
  for (let round = 0; round < 8 && points.length < maxPoints; round++) {
    const refined: TitrationPoint[] = [points[0]];
    let inserted = 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1];
      const b = points[i];
      if (Math.abs(b.pH - a.pH) > maxDeltaPH && b.addedVolumeML - a.addedVolumeML > 1e-6 && points.length + inserted < maxPoints) {
        const v = 0.5 * (a.addedVolumeML + b.addedVolumeML);
        refined.push({ addedVolumeML: v, pH: pHAt(setup, v) });
        inserted++;
      }
      refined.push(b);
    }
    points.splice(0, points.length, ...refined);
    if (inserted === 0) break;
  }
  return points;
}

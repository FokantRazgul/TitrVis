/**
 * Aqueous acid–base equilibrium engine.
 *
 * Model
 * -----
 * A solution is described by protonation ladders (each with an analytical total C
 * and successive pKa values) plus spectator ions and the water autoionisation
 * equilibrium. Every equilibrium is written in terms of activities:
 *
 *     Ka,k = a_H · a_{k+1} / a_k          (k-th deprotonation of a ladder)
 *     Kw   = a_H · a_OH
 *     pH   = −log10 a_H
 *
 * with a_i = γ_i c_i. The unknown is x = pH. For a given pH the fraction α_i of each
 * ladder species follows analytically from the pKa values (computed in log space to
 * avoid overflow), so mass balance is satisfied by construction and the only
 * equation to solve is electroneutrality:
 *
 *     f(pH) = [H⁺] − [OH⁻] + Σ_spectators z c + Σ_ladders C Σ_i z_i α_i(pH) = 0
 *
 * f is strictly decreasing in pH (every term is non-increasing and [H⁺] − [OH⁻] is
 * strictly decreasing), so the root is unique and can be bracketed and found with
 * Brent's method. For the Davies activity model the activity coefficients depend on
 * the ionic strength of the solution; the engine iterates the fixed point
 * I → γ(I) → pH → species → I until I converges (deterministically).
 */

import { activityTable, ionicStrength as computeIonicStrength } from './activities';
import {
  CHARGE_ABS_TOL,
  CHARGE_REL_TOL,
  DAVIES_VALID_IONIC_STRENGTH,
  IONIC_STRENGTH_TOLERANCE,
  MASS_BALANCE_TOL,
  MAX_ACTIVITY_ITERATIONS,
  MAX_ROOT_ITERATIONS,
  PH_BRACKET_MAX,
  PH_BRACKET_MIN,
  PH_TOLERANCE,
} from './constants';
import { brent, expandBracket } from './solver';
import type {
  ChemistryErrorInfo,
  EquilibriumProblem,
  LadderComponent,
  SolverDiagnostics,
  SolverResult,
  SpeciesState,
} from './types';

export class ChemistryError extends Error {
  readonly info: ChemistryErrorInfo;
  constructor(info: ChemistryErrorInfo) {
    super(info.message);
    this.name = 'ChemistryError';
    this.info = info;
  }
}

const LOG10 = Math.LN10;

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

/** Largest |charge| appearing anywhere in the problem (at least 1 for H⁺/OH⁻). */
export function maxAbsCharge(problem: EquilibriumProblem): number {
  let zMax = 1;
  for (const ladder of problem.ladders) {
    zMax = Math.max(zMax, Math.abs(ladder.maxCharge), Math.abs(ladder.maxCharge - ladder.pKas.length));
  }
  for (const s of problem.spectators) zMax = Math.max(zMax, Math.abs(s.charge));
  return zMax;
}

/**
 * Species fractions α_i of a ladder at the given pH, written into `out`
 * (length pKas.length + 1, most protonated first).
 * `gamma` is the activity table indexed by charge + zMax.
 */
export function ladderFractions(
  ladder: LadderComponent,
  pH: number,
  gamma: Float64Array,
  zMax: number,
  out: Float64Array,
): void {
  const n = ladder.pKas.length;
  // log10 of the un-normalised weight of species i relative to species 0.
  let logT = 0;
  let maxLog = 0;
  out[0] = 0;
  for (let i = 1; i <= n; i++) {
    const zPrev = ladder.maxCharge - (i - 1);
    const zCur = ladder.maxCharge - i;
    const gPrev = gamma[zPrev + zMax];
    const gCur = gamma[zCur + zMax];
    logT += pH - ladder.pKas[i - 1] + Math.log10(gPrev) - Math.log10(gCur);
    out[i] = logT;
    if (logT > maxLog) maxLog = logT;
  }
  let sum = 0;
  for (let i = 0; i <= n; i++) {
    const w = Math.exp((out[i] - maxLog) * LOG10);
    out[i] = w;
    sum += w;
  }
  for (let i = 0; i <= n; i++) out[i] /= sum;
}

interface ResidualContext {
  problem: EquilibriumProblem;
  gamma: Float64Array;
  zMax: number;
  scratch: Float64Array[];
}

function makeContext(problem: EquilibriumProblem, gamma: Float64Array, zMax: number): ResidualContext {
  return {
    problem,
    gamma,
    zMax,
    scratch: problem.ladders.map((l) => new Float64Array(l.pKas.length + 1)),
  };
}

/** Charge-balance residual f(pH) in mol/L for the given activity coefficients. */
function chargeResidual(ctx: ResidualContext, pH: number): number {
  const { problem, gamma, zMax } = ctx;
  const aH = Math.exp(-pH * LOG10);
  const h = aH / gamma[1 + zMax];
  const oh = Math.exp((pH - problem.pKw) * LOG10) / gamma[-1 + zMax];
  let f = h - oh;
  for (const s of problem.spectators) f += s.charge * s.concentration;
  for (let li = 0; li < problem.ladders.length; li++) {
    const ladder = problem.ladders[li];
    if (ladder.totalConcentration === 0) continue;
    const alpha = ctx.scratch[li];
    ladderFractions(ladder, pH, gamma, zMax, alpha);
    let zAvg = 0;
    for (let i = 0; i < alpha.length; i++) zAvg += (ladder.maxCharge - i) * alpha[i];
    f += zAvg * ladder.totalConcentration;
  }
  return f;
}

/** Sum of |terms| of the charge balance, used for a scale-aware tolerance. */
function chargeScale(ctx: ResidualContext, pH: number): number {
  const { problem, gamma, zMax } = ctx;
  const aH = Math.exp(-pH * LOG10);
  let scale = aH / gamma[1 + zMax] + Math.exp((pH - problem.pKw) * LOG10) / gamma[-1 + zMax];
  for (const s of problem.spectators) scale += Math.abs(s.charge * s.concentration);
  for (const ladder of problem.ladders) {
    scale += Math.max(Math.abs(ladder.maxCharge), Math.abs(ladder.maxCharge - ladder.pKas.length)) * ladder.totalConcentration;
  }
  return scale;
}

function assertValidProblem(problem: EquilibriumProblem): void {
  const fail = (message: string, details?: Record<string, number | string | boolean>): never => {
    throw new ChemistryError({ type: 'invalidInput', message, problem, details });
  };
  if (!Number.isFinite(problem.pKw) || problem.pKw <= 0) fail(`Invalid pKw ${problem.pKw}`);
  for (const ladder of problem.ladders) {
    if (!Number.isFinite(ladder.totalConcentration) || ladder.totalConcentration < 0) {
      fail(`Invalid ladder concentration for ${ladder.origin}`, { concentration: ladder.totalConcentration });
    }
    if (!Number.isInteger(ladder.maxCharge)) fail(`Non-integer ladder charge for ${ladder.origin}`);
    for (const pKa of ladder.pKas) {
      if (!Number.isFinite(pKa)) fail(`Non-finite pKa for ${ladder.origin}`);
    }
    for (let i = 1; i < ladder.pKas.length; i++) {
      if (ladder.pKas[i] < ladder.pKas[i - 1]) {
        fail(`pKa values must be ascending for ${ladder.origin}`, { index: i });
      }
    }
  }
  for (const s of problem.spectators) {
    if (!Number.isFinite(s.concentration) || s.concentration < 0) {
      fail(`Invalid spectator concentration for ${s.origin}`, { concentration: s.concentration });
    }
    if (!Number.isInteger(s.charge)) fail(`Non-integer spectator charge for ${s.origin}`);
  }
}

interface InnerSolve {
  pH: number;
  iterations: number;
  residual: number;
  bracket: [number, number];
  converged: boolean;
}

function solveForFixedGamma(ctx: ResidualContext): InnerSolve {
  const f = (pH: number) => chargeResidual(ctx, pH);
  let bracket: [number, number] | null = [PH_BRACKET_MIN, PH_BRACKET_MAX];
  const fLo = f(bracket[0]);
  const fHi = f(bracket[1]);
  if (!(fLo >= 0 && fHi <= 0)) {
    bracket = expandBracket(f, bracket[0], bracket[1], PH_BRACKET_MIN - 4, PH_BRACKET_MAX + 4);
    if (!bracket) {
      throw new ChemistryError({
        type: 'notBracketed',
        message: 'Charge balance has no sign change in the physically meaningful pH range',
        problem: ctx.problem,
        details: { fLow: fLo, fHigh: fHi },
      });
    }
  }
  const result = brent(f, bracket[0], bracket[1], {
    xTolerance: PH_TOLERANCE,
    maxIterations: MAX_ROOT_ITERATIONS,
  });
  return {
    pH: result.root,
    iterations: result.iterations,
    residual: result.fRoot,
    bracket: result.bracket,
    converged: result.converged,
  };
}

function buildSpecies(ctx: ResidualContext, pH: number): SpeciesState[] {
  const { problem, gamma, zMax } = ctx;
  const aH = Math.exp(-pH * LOG10);
  const species: SpeciesState[] = [];
  species.push({
    formula: 'H+',
    charge: 1,
    concentration: aH / gamma[1 + zMax],
    activityCoefficient: gamma[1 + zMax],
    fraction: 1,
    origin: 'water',
    kind: 'water',
  });
  species.push({
    formula: 'OH-',
    charge: -1,
    concentration: Math.exp((pH - problem.pKw) * LOG10) / gamma[-1 + zMax],
    activityCoefficient: gamma[-1 + zMax],
    fraction: 1,
    origin: 'water',
    kind: 'water',
  });
  for (let li = 0; li < problem.ladders.length; li++) {
    const ladder = problem.ladders[li];
    const alpha = ctx.scratch[li];
    ladderFractions(ladder, pH, gamma, zMax, alpha);
    for (let i = 0; i < alpha.length; i++) {
      const z = ladder.maxCharge - i;
      species.push({
        formula: ladder.speciesFormulas[i] ?? `${ladder.origin}[${i}]`,
        charge: z,
        concentration: alpha[i] * ladder.totalConcentration,
        activityCoefficient: gamma[z + zMax],
        fraction: alpha[i],
        origin: ladder.origin,
        kind: 'ladder',
        ladderIndex: li,
      });
    }
  }
  for (const s of problem.spectators) {
    species.push({
      formula: s.formula,
      charge: s.charge,
      concentration: s.concentration,
      activityCoefficient: gamma[s.charge + zMax],
      fraction: 1,
      origin: s.origin,
      kind: 'spectator',
    });
  }
  return species;
}

/** Largest relative mass-balance error over ladders |Σ species − total| / total. */
export function massBalanceError(problem: EquilibriumProblem, species: SpeciesState[]): number {
  let worst = 0;
  for (let li = 0; li < problem.ladders.length; li++) {
    const ladder = problem.ladders[li];
    if (ladder.totalConcentration === 0) continue;
    let sum = 0;
    for (const s of species) {
      if (s.kind === 'ladder' && s.ladderIndex === li) sum += s.concentration;
    }
    const err = Math.abs(sum - ladder.totalConcentration) / ladder.totalConcentration;
    if (err > worst) worst = err;
  }
  return worst;
}

/** Charge-balance residual Σ zᵢ cᵢ over a computed species list (mol/L). */
export function chargeBalanceOfSpecies(species: SpeciesState[]): number {
  let sum = 0;
  for (const s of species) sum += s.charge * s.concentration;
  return sum;
}

/**
 * Solve the equilibrium problem. Throws ChemistryError when the input is invalid,
 * the root cannot be bracketed, or the solution fails validation. Never returns
 * NaN, Infinity or negative concentrations.
 */
export function solveEquilibrium(problem: EquilibriumProblem): SolverResult {
  const t0 = now();
  assertValidProblem(problem);
  const zMax = maxAbsCharge(problem);
  const warnings: string[] = [];

  let ionicStrength = 0;
  let gamma = activityTable('ideal', 0, zMax);
  let ctx = makeContext(problem, gamma, zMax);
  let inner = solveForFixedGamma(ctx);
  let species = buildSpecies(ctx, inner.pH);
  let activityIterations = 1;

  if (problem.activityModel === 'davies') {
    let previousDelta = Number.POSITIVE_INFINITY;
    for (let k = 0; k < MAX_ACTIVITY_ITERATIONS; k++) {
      const concentrations = species.map((s) => s.concentration);
      const charges = species.map((s) => s.charge);
      const iNew = computeIonicStrength(concentrations, charges);
      const delta = Math.abs(iNew - ionicStrength);
      // Plain fixed-point iteration; fall back to averaging if the update grows (oscillation guard).
      const iNext = delta > previousDelta ? 0.5 * (iNew + ionicStrength) : iNew;
      previousDelta = delta;
      ionicStrength = iNext;
      gamma = activityTable('davies', ionicStrength, zMax);
      ctx = makeContext(problem, gamma, zMax);
      inner = solveForFixedGamma(ctx);
      species = buildSpecies(ctx, inner.pH);
      activityIterations++;
      if (delta <= IONIC_STRENGTH_TOLERANCE * Math.max(iNew, 1e-12)) break;
      if (k === MAX_ACTIVITY_ITERATIONS - 1) {
        throw new ChemistryError({
          type: 'notConverged',
          message: 'Ionic-strength fixed point did not converge',
          problem,
          details: { ionicStrength, delta },
        });
      }
    }
    if (ionicStrength > DAVIES_VALID_IONIC_STRENGTH) {
      warnings.push(
        `Ionic strength ${ionicStrength.toPrecision(3)} M exceeds the Davies validity range (≈0.5 M); activity corrections are approximate.`,
      );
    }
  } else {
    ionicStrength = computeIonicStrength(
      species.map((s) => s.concentration),
      species.map((s) => s.charge),
    );
  }

  if (!inner.converged) {
    throw new ChemistryError({
      type: 'notConverged',
      message: 'Root finder did not converge on the charge balance',
      problem,
      details: { pH: inner.pH, residual: inner.residual, iterations: inner.iterations },
    });
  }

  // Validation: finite, non-negative, charge balance, mass balance.
  const residual = chargeResidual(ctx, inner.pH);
  const scale = chargeScale(ctx, inner.pH);
  const chargeTolerance = CHARGE_ABS_TOL + CHARGE_REL_TOL * scale;
  const mbError = massBalanceError(problem, species);
  const fail = (message: string, details: Record<string, number | string | boolean>): never => {
    throw new ChemistryError({ type: 'validationFailed', message, problem, details });
  };
  if (!Number.isFinite(inner.pH)) fail('Non-finite pH', { pH: inner.pH });
  for (const s of species) {
    if (!Number.isFinite(s.concentration) || s.concentration < 0) {
      fail(`Invalid concentration for ${s.formula}`, { concentration: s.concentration });
    }
  }
  if (!Number.isFinite(residual) || Math.abs(residual) > chargeTolerance) {
    fail('Charge balance not satisfied', { residual, tolerance: chargeTolerance });
  }
  if (!Number.isFinite(mbError) || mbError > MASS_BALANCE_TOL) {
    fail('Mass balance not satisfied', { error: mbError });
  }

  const hydrogen = species[0];
  const hydroxide = species[1];
  const diagnostics: SolverDiagnostics = {
    rootIterations: inner.iterations,
    activityIterations,
    ionicStrength,
    bracket: inner.bracket,
    chargeResidual: Math.abs(residual),
    massBalanceError: mbError,
    warnings,
    elapsedMs: now() - t0,
  };
  return {
    pH: inner.pH,
    pOH: problem.pKw - inner.pH,
    hydrogenActivity: Math.exp(-inner.pH * LOG10),
    hydrogenConcentration: hydrogen.concentration,
    hydroxideConcentration: hydroxide.concentration,
    species,
    converged: true,
    iterations: inner.iterations,
    residual: Math.abs(residual),
    diagnostics,
  };
}

/** Evaluate the charge-balance residual at an arbitrary pH under the ideal model (for tests/diagnostics). */
export function chargeBalanceResidualAt(problem: EquilibriumProblem, pH: number): number {
  const zMax = maxAbsCharge(problem);
  const ctx = makeContext(problem, activityTable('ideal', 0, zMax), zMax);
  return chargeResidual(ctx, pH);
}

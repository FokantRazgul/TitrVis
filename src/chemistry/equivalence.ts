/**
 * Equivalence points, curve features and indicator error.
 *
 * Stoichiometric equivalence volumes follow from proton-transfer stoichiometry:
 *   V_eq,k = k · C_A V_A / (C_T · cap_T),   k = 1 … cap_A
 * where cap_A is the analyte's titratable proton capacity in the active direction and
 * cap_T the titrant's capacity per formula unit. The pH at each V_eq and its sharpness
 * are evaluated with the equilibrium solver; a point is flagged `detectable` when the
 * pH change across ±1 % of V_eq exceeds DETECTABLE_JUMP (a model-derived criterion,
 * not a stored value).
 */

import { brent } from './solver';
import { computeTitrationState, pHAt, reactionCapacities, titrantRole, type TitrationPoint, type TitrationSetup, type TitrantRole } from './titration';

/** Minimum pH change across ±1 % of V_eq for an equivalence point to count as observable. */
export const DETECTABLE_JUMP = 0.5;

export interface EquivalencePoint {
  /** 1-based stoichiometric step index. */
  index: number;
  volumeML: number;
  pH: number;
  /** dpH/dV (pH per mL) estimated from a ±0.5 % central difference. */
  slope: number;
  /** pH(1.01 V_eq) − pH(0.99 V_eq), signed. */
  jump: number;
  detectable: boolean;
}

export interface EquivalenceAnalysis {
  role: TitrantRole;
  points: EquivalencePoint[];
  /** Total titratable steps of the analyte in this direction. */
  analyteCapacity: number;
  titrantCapacity: number;
}

export function analyseEquivalence(setup: TitrationSetup): EquivalenceAnalysis {
  const role = titrantRole(setup);
  const caps = reactionCapacities(setup, role);
  const points: EquivalencePoint[] = [];
  if (role !== 'none' && caps.analyte > 0 && caps.titrant > 0) {
    const molesAnalyte = setup.analyteConcentrationM * setup.analyteVolumeML; // mmol
    for (let k = 1; k <= caps.analyte; k++) {
      const volumeML = (k * molesAnalyte) / (setup.titrantConcentrationM * caps.titrant);
      const h = Math.max(0.005 * volumeML, 1e-4);
      const pH = pHAt(setup, volumeML);
      const pHminus = pHAt(setup, Math.max(0, volumeML - h));
      const pHplus = pHAt(setup, volumeML + h);
      const jump = pHAt(setup, volumeML * 1.01) - pHAt(setup, Math.max(0, volumeML * 0.99));
      points.push({
        index: k,
        volumeML,
        pH,
        slope: (pHplus - pHminus) / (2 * h),
        jump,
        detectable: Math.abs(jump) >= DETECTABLE_JUMP,
      });
    }
  }
  return { role, points, analyteCapacity: caps.analyte, titrantCapacity: caps.titrant };
}

/** Numerical derivative dpH/dV of a sampled curve (central differences, one-sided at the ends). */
export function curveDerivative(points: readonly TitrationPoint[]): number[] {
  const n = points.length;
  const d = new Array<number>(n).fill(0);
  if (n < 2) return d;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const dv = b.addedVolumeML - a.addedVolumeML;
    d[i] = dv > 0 ? (b.pH - a.pH) / dv : 0;
  }
  return d;
}

/** Volumes where |dpH/dV| has a local maximum above `fraction` of the global maximum. */
export function detectInflections(points: readonly TitrationPoint[], fraction = 0.25): number[] {
  const d = curveDerivative(points).map((x) => Math.abs(x));
  const max = Math.max(...d, 0);
  if (max <= 0) return [];
  const out: number[] = [];
  for (let i = 1; i < d.length - 1; i++) {
    if (d[i] >= d[i - 1] && d[i] > d[i + 1] && d[i] >= fraction * max) out.push(points[i].addedVolumeML);
  }
  return out;
}

export interface IndicatorTransition {
  /** Titrant volume at which pH = pKa of the indicator ([HIn] = [In⁻]). */
  volumeML: number;
  pH: number;
}

/**
 * Titrant volume at which the bulk pH equals the indicator pKa, found by root finding on
 * pH(V) − pKa over [0, vMaxML]. Returns null when the pKa is never reached in that range.
 */
export function indicatorTransitionVolume(setup: TitrationSetup, vMaxML: number): IndicatorTransition | null {
  if (!setup.indicator) return null;
  const pKa = setup.indicator.indicator.pKa;
  const g = (v: number) => pHAt(setup, v) - pKa;
  const g0 = g(0);
  const g1 = g(vMaxML);
  if (g0 === 0) return { volumeML: 0, pH: pKa };
  if (g0 * g1 > 0) return null;
  const result = brent(g, 0, vMaxML, { xTolerance: 1e-9, maxIterations: 200 });
  if (!result.converged) return null;
  return { volumeML: result.root, pH: pKa };
}

export interface IndicatorError {
  transitionVolumeML: number;
  equivalenceVolumeML: number;
  equivalenceIndex: number;
  deltaML: number;
  percent: number;
}

/** Indicator error ΔV = V_transition − V_eq against the nearest stoichiometric equivalence point. */
export function indicatorError(transition: IndicatorTransition | null, analysis: EquivalenceAnalysis): IndicatorError | null {
  if (!transition || analysis.points.length === 0) return null;
  const candidates = analysis.points.filter((p) => p.detectable);
  const pool = candidates.length > 0 ? candidates : analysis.points;
  let best = pool[0];
  for (const p of pool) {
    if (Math.abs(p.volumeML - transition.volumeML) < Math.abs(best.volumeML - transition.volumeML)) best = p;
  }
  const deltaML = transition.volumeML - best.volumeML;
  return {
    transitionVolumeML: transition.volumeML,
    equivalenceVolumeML: best.volumeML,
    equivalenceIndex: best.index,
    deltaML,
    percent: best.volumeML > 0 ? (100 * deltaML) / best.volumeML : 0,
  };
}

/** Convenience: full state at an equivalence point (used by tests and the data panel). */
export function stateAtEquivalence(setup: TitrationSetup, point: EquivalencePoint) {
  return computeTitrationState(setup, point.volumeML);
}

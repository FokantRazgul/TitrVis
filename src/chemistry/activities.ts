/**
 * Activity-coefficient models.
 *
 * Ideal model: γᵢ = 1 for every species.
 * Davies model (Davies, 1962):
 *     log10 γᵢ = −A zᵢ² ( √I / (1 + √I) − 0.3 I ),   I = ½ Σ cᵢ zᵢ²
 * valid for I ≲ 0.5 mol/L. Neutral species are assigned γ = 1 (their salting-out
 * coefficients are neglected — see ASSUMPTIONS.md).
 */

import { DAVIES_A_25C, DAVIES_B } from './constants';
import type { ActivityModel } from './types';

/** Ionic strength I = ½ Σ cᵢ zᵢ² from parallel concentration/charge arrays (mol/L). */
export function ionicStrength(concentrations: ArrayLike<number>, charges: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < concentrations.length; i++) {
    const z = charges[i];
    if (z !== 0) sum += concentrations[i] * z * z;
  }
  return 0.5 * sum;
}

/** log10 γ for an ion of charge z at ionic strength I (mol/L) with the Davies equation. */
export function daviesLog10Gamma(charge: number, ionicStrengthM: number, aParameter = DAVIES_A_25C): number {
  if (charge === 0 || ionicStrengthM <= 0) return 0;
  const sqrtI = Math.sqrt(ionicStrengthM);
  return -aParameter * charge * charge * (sqrtI / (1 + sqrtI) - DAVIES_B * ionicStrengthM);
}

/** Activity coefficient γ for an ion of charge z under the given model. */
export function activityCoefficient(model: ActivityModel, charge: number, ionicStrengthM: number): number {
  if (model === 'ideal') return 1;
  return Math.pow(10, daviesLog10Gamma(charge, ionicStrengthM));
}

/**
 * Pre-compute γ for the charge range [−zMax, zMax] so that the residual function can
 * look them up without recomputing exponentials. Index with `charge + zMax`.
 */
export function activityTable(model: ActivityModel, ionicStrengthM: number, zMax: number): Float64Array {
  const table = new Float64Array(2 * zMax + 1);
  for (let z = -zMax; z <= zMax; z++) {
    table[z + zMax] = activityCoefficient(model, z, ionicStrengthM);
  }
  return table;
}

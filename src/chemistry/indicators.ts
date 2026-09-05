/**
 * Indicator database: builds full Indicator objects (with reconstructed spectra on the
 * common grid) from the raw descriptors, and exposes indicator-specific helpers.
 */

import { INDICATOR_DATA, INDICATOR_PROVENANCE } from './data/indicators.data';
import { reconstructSpectrum, spectrumOnGrid } from './spectra';
import type { Indicator, LadderComponent, SpectatorComponent } from './types';

const RECONSTRUCTION_METHOD =
  'Sum of Gaussian bands in wavelength space, ε(λ) = Σ εmax·exp(−4 ln2 ((λ−λmax)/FWHM)²), on the 380–780 nm / 5 nm grid';

export const INDICATORS: readonly Indicator[] = INDICATOR_DATA.map((raw) => ({
  id: raw.id,
  name: raw.name,
  nameRu: raw.nameRu,
  formula: raw.formula,
  smiles: raw.smiles,
  pubchemCid: raw.pubchemCid,
  molecularWeight: raw.molecularWeight,
  pKa: raw.pKa,
  transitionRange: raw.transitionRange,
  acidFormCharge: raw.acidFormCharge,
  spectatorIons: raw.sodiumSalt ? [{ formula: 'Na+', charge: 1, count: 1 }] : [],
  colourNames: raw.colourNames,
  spectra: {
    acid: reconstructSpectrum(raw.acidBands, INDICATOR_PROVENANCE.source, `HIn form of ${raw.name}: ${raw.notes}`),
    base: reconstructSpectrum(raw.baseBands, INDICATOR_PROVENANCE.source, `In⁻ form of ${raw.name}: ${raw.notes}`),
  },
  reconstruction: { acidBands: raw.acidBands, baseBands: raw.baseBands, method: RECONSTRUCTION_METHOD },
  provenance: { ...INDICATOR_PROVENANCE, notes: raw.notes },
}));

const byId = new Map<string, Indicator>(INDICATORS.map((i) => [i.id, i]));

export function getIndicator(id: string): Indicator {
  const ind = byId.get(id);
  if (!ind) throw new Error(`Unknown indicator id "${id}"`);
  return ind;
}

export function findIndicator(id: string): Indicator | undefined {
  return byId.get(id);
}

/** Typical stock-solution concentration (mol/L) derived from the % w/v strength and molecular weight. */
export function typicalStockConcentrationM(indicator: Indicator): number {
  const raw = INDICATOR_DATA.find((r) => r.id === indicator.id);
  const percent = raw ? raw.typicalStockPercentWV : 0.04;
  // % w/v = g per 100 mL → g/L = 10 × percent
  return (10 * percent) / indicator.molecularWeight;
}

/** Grid-sampled molar absorptivities of both forms (memoised per indicator). */
const gridCache = new Map<string, { acid: number[]; base: number[] }>();
export function indicatorAbsorptivities(indicator: Indicator): { acid: number[]; base: number[] } {
  let entry = gridCache.get(indicator.id);
  if (!entry) {
    entry = { acid: spectrumOnGrid(indicator.spectra.acid), base: spectrumOnGrid(indicator.spectra.base) };
    gridCache.set(indicator.id, entry);
  }
  return entry;
}

/** Equilibrium components contributed by `moles` of indicator in `volumeL` litres. */
export function indicatorComponents(
  indicator: Indicator,
  moles: number,
  volumeL: number,
): { ladder: LadderComponent; spectators: SpectatorComponent[] } {
  const concentration = moles / volumeL;
  return {
    ladder: {
      pKas: [indicator.pKa],
      maxCharge: indicator.acidFormCharge,
      totalConcentration: concentration,
      speciesFormulas: ['HIn', 'In-'],
      origin: `indicator:${indicator.id}`,
    },
    spectators: indicator.spectatorIons.map((ion) => ({
      formula: ion.formula,
      charge: ion.charge,
      concentration: concentration * ion.count,
      origin: `indicator:${indicator.id}`,
    })),
  };
}

/**
 * Fraction of indicator in the base form In⁻ from the hydrogen-ion activity:
 *   f_In = Ka / (Ka + a_H)
 * (activity coefficients of HIn/In⁻ are handled by the equilibrium engine when the
 * indicator is part of the solved problem; this closed form is the ideal-model value
 * and is also what the engine returns for the ideal model).
 */
export function baseFraction(indicator: Indicator, hydrogenActivity: number): number {
  const ka = Math.pow(10, -indicator.pKa);
  return ka / (ka + hydrogenActivity);
}

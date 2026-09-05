/**
 * Spectral utilities on the common wavelength grid.
 *
 * All spectra used by the colour model live on WAVELENGTH_GRID (380–780 nm, 5 nm).
 * Arbitrary tabulated spectra are resampled onto the grid with linear interpolation
 * (zero outside the tabulated range). Reconstructed spectra are sums of Gaussian
 * bands in wavelength space:
 *     ε(λ) = Σ_j ε_j · exp(−4 ln2 · ((λ − λ_j)/FWHM_j)²)
 * where λ_j is a cited absorption maximum and ε_j the cited/estimated peak molar
 * absorptivity. The method is documented in CHEMISTRY.md and ASSUMPTIONS.md.
 */

import { WAVELENGTH_GRID, WAVELENGTH_MAX, WAVELENGTH_MIN, WAVELENGTH_STEP } from './data/cie';
import type { SpectralBand, Spectrum } from './types';

export const GRID: readonly number[] = WAVELENGTH_GRID;
export const GRID_LENGTH = WAVELENGTH_GRID.length;

export function gridIndex(wavelengthNm: number): number {
  return Math.round((wavelengthNm - WAVELENGTH_MIN) / WAVELENGTH_STEP);
}

/** Linear interpolation of a sorted (x, y) table onto the common grid; zero outside the table. */
export function resampleToGrid(points: readonly { wavelength: number; molarAbsorptivity: number }[]): number[] {
  const out = new Array<number>(GRID_LENGTH).fill(0);
  if (points.length === 0) return out;
  let j = 0;
  for (let i = 0; i < GRID_LENGTH; i++) {
    const x = GRID[i];
    if (x < points[0].wavelength || x > points[points.length - 1].wavelength) {
      out[i] = 0;
      continue;
    }
    while (j < points.length - 2 && points[j + 1].wavelength < x) j++;
    const p0 = points[j];
    const p1 = points[Math.min(j + 1, points.length - 1)];
    if (p1.wavelength === p0.wavelength) {
      out[i] = p0.molarAbsorptivity;
    } else {
      const t = (x - p0.wavelength) / (p1.wavelength - p0.wavelength);
      out[i] = p0.molarAbsorptivity + t * (p1.molarAbsorptivity - p0.molarAbsorptivity);
    }
  }
  return out;
}

/** Evaluate a sum of Gaussian bands at one wavelength. */
export function evaluateBands(bands: readonly SpectralBand[], wavelengthNm: number): number {
  let eps = 0;
  for (const band of bands) {
    const u = (wavelengthNm - band.centreNm) / band.fwhmNm;
    eps += band.epsilonMax * Math.exp(-4 * Math.LN2 * u * u);
  }
  return eps;
}

/** Reconstruct a Spectrum object on the common grid from Gaussian band descriptors. */
export function reconstructSpectrum(bands: readonly SpectralBand[], source: string, notes: string): Spectrum {
  return {
    unit: 'nm',
    data: GRID.map((wavelength) => ({ wavelength, molarAbsorptivity: evaluateBands(bands, wavelength) })),
    dataQuality: 'reconstructed',
    source,
    notes,
  };
}

/** Molar absorptivity of a spectrum on the common grid (resampling if necessary). */
export function spectrumOnGrid(spectrum: Spectrum): number[] {
  const onGrid =
    spectrum.data.length === GRID_LENGTH && spectrum.data.every((p, i) => p.wavelength === GRID[i]);
  return onGrid ? spectrum.data.map((p) => p.molarAbsorptivity) : resampleToGrid(spectrum.data);
}

/** Wavelength of the largest value on the grid (undefined if the spectrum is identically zero). */
export function spectrumMaximum(values: readonly number[]): { wavelength: number; value: number } | undefined {
  let best = -1;
  let bestValue = 0;
  for (let i = 0; i < values.length; i++) {
    if (values[i] > bestValue) {
      bestValue = values[i];
      best = i;
    }
  }
  return best >= 0 ? { wavelength: GRID[best], value: bestValue } : undefined;
}

/** Mixture ε(λ) = f_HIn ε_HIn(λ) + f_In ε_In(λ). */
export function mixtureAbsorptivity(epsAcid: readonly number[], epsBase: readonly number[], fractionBase: number): number[] {
  const fAcid = 1 - fractionBase;
  const out = new Array<number>(GRID_LENGTH);
  for (let i = 0; i < GRID_LENGTH; i++) out[i] = fAcid * epsAcid[i] + fractionBase * epsBase[i];
  return out;
}

/** Beer–Lambert absorbance A(λ) = ε(λ) c l. */
export function absorbanceSpectrum(eps: readonly number[], concentrationM: number, pathLengthCm: number): number[] {
  const cl = concentrationM * pathLengthCm;
  return eps.map((e) => e * cl);
}

/** Transmittance T(λ) = 10^−A(λ). */
export function transmittanceSpectrum(absorbance: readonly number[]): number[] {
  return absorbance.map((a) => Math.pow(10, -a));
}

export { WAVELENGTH_MIN, WAVELENGTH_MAX, WAVELENGTH_STEP };

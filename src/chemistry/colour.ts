/**
 * Spectral colour pipeline: transmittance → CIE 1931 XYZ → linear sRGB → sRGB.
 *
 *   X = k Σ S(λ) T(λ) x̄(λ),  Y = k Σ S(λ) T(λ) ȳ(λ),  Z = k Σ S(λ) T(λ) z̄(λ)
 *   k = 1 / Σ S(λ) ȳ(λ)   (so the illuminant itself has Y = 1)
 *
 * The XYZ → linear sRGB matrix is the IEC 61966-2-1 (sRGB, D65) matrix; the transfer
 * function is the piecewise sRGB encoding. Out-of-gamut colours are clipped after
 * the matrix transform and flagged.
 *
 * This is the single colour model of the application: the Indicator panel swatch and
 * the liquid renderer both consume the output of `transmittanceToColour`.
 */

import { CIE_XBAR, CIE_YBAR, CIE_ZBAR, ILLUMINANT_D65 } from './data/cie';
import { GRID_LENGTH } from './spectra';
import type { RGBColour } from './types';

/** Pre-computed normalisation so that T ≡ 1 yields Y = 1. */
let illuminantNormalisation = 0;
for (let i = 0; i < GRID_LENGTH; i++) illuminantNormalisation += ILLUMINANT_D65[i] * CIE_YBAR[i];
const K_NORM = 1 / illuminantNormalisation;

/** CIE XYZ of light with spectral transmittance T(λ) under D65, normalised to Y_white = 1. */
export function transmittanceToXYZ(transmittance: readonly number[]): [number, number, number] {
  if (transmittance.length !== GRID_LENGTH) {
    throw new Error(`transmittanceToXYZ: expected ${GRID_LENGTH} samples, got ${transmittance.length}`);
  }
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < GRID_LENGTH; i++) {
    const power = ILLUMINANT_D65[i] * transmittance[i];
    x += power * CIE_XBAR[i];
    y += power * CIE_YBAR[i];
    z += power * CIE_ZBAR[i];
  }
  return [x * K_NORM, y * K_NORM, z * K_NORM];
}

/** IEC 61966-2-1 XYZ(D65) → linear sRGB. */
export function xyzToLinearSRGB([x, y, z]: readonly [number, number, number]): [number, number, number] {
  return [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.969266 * x + 1.8760108 * y + 0.041556 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
}

/** Inverse of the above (used in tests and by the renderer for consistency checks). */
export function linearSRGBToXYZ([r, g, b]: readonly [number, number, number]): [number, number, number] {
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.072175 * b,
    0.0193339 * r + 0.119192 * g + 0.9503041 * b,
  ];
}

/** sRGB piecewise transfer function (linear → encoded), input clipped to [0, 1]. */
export function linearToSRGBChannel(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

export function srgbToLinearChannel(c: number): number {
  const v = Math.min(1, Math.max(0, c));
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function toHex(srgb: readonly [number, number, number]): string {
  return (
    '#' +
    srgb
      .map((v) => {
        const n = Math.round(Math.min(1, Math.max(0, v)) * 255);
        return n.toString(16).padStart(2, '0');
      })
      .join('')
  );
}

/** Full pipeline from a transmittance spectrum on the common grid to a display colour. */
export function transmittanceToColour(transmittance: readonly number[]): RGBColour {
  const xyz = transmittanceToXYZ(transmittance);
  const linearRaw = xyzToLinearSRGB(xyz);
  const clipped = linearRaw.some((c) => c < -1e-6 || c > 1 + 1e-6);
  const linear: [number, number, number] = [
    Math.min(1, Math.max(0, linearRaw[0])),
    Math.min(1, Math.max(0, linearRaw[1])),
    Math.min(1, Math.max(0, linearRaw[2])),
  ];
  const srgb: [number, number, number] = [
    linearToSRGBChannel(linear[0]),
    linearToSRGBChannel(linear[1]),
    linearToSRGBChannel(linear[2]),
  ];
  return { xyz, linear, srgb, hex: toHex(srgb), clipped };
}

/** Colour of a perfectly transparent liquid (T ≡ 1) — the reference white of the pipeline. */
export function referenceWhite(): RGBColour {
  return transmittanceToColour(new Array<number>(GRID_LENGTH).fill(1));
}

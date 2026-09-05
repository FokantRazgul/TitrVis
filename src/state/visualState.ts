/**
 * Derivation of the chemistry → simulation contract (ChemicalVisualState) from a solved
 * titration state. Lives in the state layer because it combines the chemistry engine's
 * results with the experiment configuration; it contains no rendering code.
 */

import { referenceWhite, transmittanceToColour } from '../chemistry/colour';
import { computeTitrationState, type TitrationSetup, type TitrationState } from '../chemistry/titration';
import type { ChemicalVisualState, RGBColour } from '../chemistry/types';

/**
 * Extra titrant volumes (as fractions of the current flask volume) represented by the entries of
 * the local colour LUT. A parcel of liquid whose fraction of *fresh* titrant is m has, relative
 * to the bulk, the composition of the flask with an extra m·V_total of titrant, so the LUT is
 * indexed by m itself: entry 0 is the bulk, the others are spaced logarithmically from 0.1 %
 * (the faint excess that flips an indicator right at equivalence) to 100 % (undiluted titrant,
 * the core of a fresh drop). Documented in ASSUMPTIONS.md (visual approximation).
 */
export const LOCAL_LUT_SIZE = 8;
export const LOCAL_EXCESS_MIN = 1e-3;
export const LOCAL_EXCESS_FRACTIONS: readonly number[] = Array.from({ length: LOCAL_LUT_SIZE }, (_, k) =>
  k === 0 ? 0 : Math.pow(10, Math.log10(LOCAL_EXCESS_MIN) * (1 - (k - 1) / (LOCAL_LUT_SIZE - 2))),
);

/**
 * LUT position t ∈ [0, 1] for a fresh-titrant fraction m (mirrored in liquid.frag.glsl): linear
 * from the bulk to the first entry below LOCAL_EXCESS_MIN, logarithmic above it.
 */
export function mixingLutPosition(m: number): number {
  const n = LOCAL_LUT_SIZE - 1;
  if (m <= 0) return 0;
  if (m < LOCAL_EXCESS_MIN) return m / LOCAL_EXCESS_MIN / n;
  const decades = -Math.log10(LOCAL_EXCESS_MIN);
  const t = (1 + ((n - 1) * (Math.log10(m) + decades)) / decades) / n;
  return Math.min(1, t);
}

/** −log10 of a clipped linear channel, bounded to keep shader math finite. */
function channelAbsorbance(linear: number): number {
  return -Math.log10(Math.min(1, Math.max(1e-4, linear)));
}

export function absorbanceRGB(colour: RGBColour): [number, number, number] {
  return [channelAbsorbance(colour.linear[0]), channelAbsorbance(colour.linear[1]), channelAbsorbance(colour.linear[2])];
}

const WHITE = referenceWhite();

/**
 * Build the visual state. The LUT entries are each a genuine equilibrium solve of the flask
 * contents with an extra titrant volume of LOCAL_EXCESS_FRACTIONS[k] · V_total.
 */
export function deriveVisualState(setup: TitrationSetup, state: TitrationState): ChemicalVisualState {
  const liquidColour = state.indicator ? state.indicator.colour : WHITE;
  const lut: RGBColour[] = [liquidColour];
  if (state.indicator) {
    for (let k = 1; k < LOCAL_LUT_SIZE; k++) {
      const extra = LOCAL_EXCESS_FRACTIONS[k] * state.totalVolumeML;
      const local = computeTitrationState(setup, state.addedVolumeML + extra, 'none');
      lut.push(local.indicator ? local.indicator.colour : WHITE);
    }
  } else {
    for (let k = 1; k < LOCAL_LUT_SIZE; k++) lut.push(WHITE);
  }
  return {
    bulkPH: state.pH,
    indicatorFraction: state.indicator ? state.indicator.fractionBase : 0,
    liquidColour,
    liquidAbsorbanceRGB: absorbanceRGB(liquidColour),
    addedTitrantVolume: state.addedVolumeML,
    totalVolumeML: state.totalVolumeML,
    localColourLUT: lut,
    analyticalState: state.solver,
  };
}

/** Colour of a transmittance spectrum — re-exported so the state layer is the only colour entry point for UI code. */
export const colourFromTransmittance = transmittanceToColour;

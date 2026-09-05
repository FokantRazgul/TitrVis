/**
 * Derivation of the chemistry → simulation contract (ChemicalVisualState) from a solved
 * titration state. Lives in the state layer because it combines the chemistry engine's
 * results with the experiment configuration; it contains no rendering code.
 */

import { referenceWhite, transmittanceToColour } from '../chemistry/colour';
import { computeTitrationState, type TitrationSetup, type TitrationState } from '../chemistry/titration';
import type { ChemicalVisualState, RGBColour } from '../chemistry/types';

/**
 * Local titrant excess (fraction of the current flask volume) represented by the top of the
 * mixing-field colour LUT. A freshly landed drop is locally titrant-rich; 4 % of the flask
 * volume of extra titrant is enough to show the indicator's excess-titrant colour around the
 * impact before mixing homogenises it. Documented in ASSUMPTIONS.md (visual approximation).
 */
export const LOCAL_EXCESS_FRACTION = 0.04;
export const LOCAL_LUT_SIZE = 8;

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
 * contents with an extra titrant volume of (k / (N−1)) · LOCAL_EXCESS_FRACTION · V_total.
 */
export function deriveVisualState(setup: TitrationSetup, state: TitrationState): ChemicalVisualState {
  const liquidColour = state.indicator ? state.indicator.colour : WHITE;
  const lut: RGBColour[] = [liquidColour];
  if (state.indicator) {
    for (let k = 1; k < LOCAL_LUT_SIZE; k++) {
      const extra = (k / (LOCAL_LUT_SIZE - 1)) * LOCAL_EXCESS_FRACTION * state.totalVolumeML;
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

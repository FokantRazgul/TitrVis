import { describe, expect, it } from 'vitest';
import { analyseEquivalence, indicatorTransitionVolume } from './equivalence';
import { getIndicator } from './indicators';
import { getSubstance } from './substances';
import { computeReferenceCurve, computeTitrationState, type TitrationSetup } from './titration';
import { deriveVisualState } from '../state/visualState';

/**
 * Chemistry cost benchmark (informs the Web Worker decision, see ARCHITECTURE.md §Worker).
 * The thresholds are generous upper bounds; the measured values are printed for the record.
 */
const setup: TitrationSetup = {
  analyte: getSubstance('phosphoric_acid'),
  analyteConcentrationM: 0.1,
  analyteVolumeML: 50,
  titrant: getSubstance('sodium_hydroxide'),
  titrantConcentrationM: 0.1,
  indicator: { indicator: getIndicator('phenolphthalein'), stockConcentrationM: 3.14e-3, volumeML: 0.1 },
  activityModel: 'ideal',
  temperatureC: 25,
  opticalPathCm: 5,
};

function time(label: string, fn: () => void, repeats: number): number {
  fn();
  const t0 = performance.now();
  for (let i = 0; i < repeats; i++) fn();
  const perCall = (performance.now() - t0) / repeats;
  // eslint-disable-next-line no-console
  console.log(`[benchmark] ${label}: ${perCall.toFixed(3)} ms per call`);
  return perCall;
}

describe('chemistry cost', () => {
  it('a full per-drop update (state + visual LUT) is far below a frame budget', () => {
    let v = 0;
    const perDrop = time(
      'per-drop state + visual state (triprotic + indicator, ideal)',
      () => {
        v = (v + 0.05) % 100;
        const state = computeTitrationState(setup, v);
        deriveVisualState(setup, state);
      },
      200,
    );
    expect(perDrop).toBeLessThan(4);
    const perDropDavies = time(
      'per-drop state + visual state (Davies)',
      () => {
        v = (v + 0.05) % 100;
        const s = { ...setup, activityModel: 'davies' as const };
        deriveVisualState(s, computeTitrationState(s, v));
      },
      100,
    );
    expect(perDropDavies).toBeLessThan(12);
  });
  it('analysis (equivalence, transition, 600-point curve) completes within a debounce interval', () => {
    const analysis = time(
      'equivalence + transition + reference curve',
      () => {
        analyseEquivalence(setup);
        indicatorTransitionVolume(setup, 100);
        computeReferenceCurve(setup, 100, 120, 600);
      },
      5,
    );
    expect(analysis).toBeLessThan(400);
  });
});

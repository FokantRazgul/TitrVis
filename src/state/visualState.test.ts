import { describe, expect, it } from 'vitest';
import { LOCAL_EXCESS_FRACTIONS, LOCAL_EXCESS_MIN, LOCAL_LUT_SIZE, mixingLutPosition } from './visualState';

describe('local colour LUT spacing', () => {
  it('spans bulk → 0.1 % → 100 % extra titrant, strictly increasing and log-spaced', () => {
    expect(LOCAL_EXCESS_FRACTIONS).toHaveLength(LOCAL_LUT_SIZE);
    expect(LOCAL_EXCESS_FRACTIONS[0]).toBe(0);
    expect(LOCAL_EXCESS_FRACTIONS[1]).toBeCloseTo(LOCAL_EXCESS_MIN, 12);
    expect(LOCAL_EXCESS_FRACTIONS[LOCAL_LUT_SIZE - 1]).toBeCloseTo(1, 12);
    for (let k = 2; k < LOCAL_LUT_SIZE; k++) {
      expect(LOCAL_EXCESS_FRACTIONS[k]).toBeGreaterThan(LOCAL_EXCESS_FRACTIONS[k - 1]);
      const ratio = LOCAL_EXCESS_FRACTIONS[k] / LOCAL_EXCESS_FRACTIONS[k - 1];
      expect(ratio).toBeCloseTo(LOCAL_EXCESS_FRACTIONS[2] / LOCAL_EXCESS_FRACTIONS[1], 10);
    }
  });

  it('maps every LUT fraction exactly onto its entry and is monotone', () => {
    for (let k = 0; k < LOCAL_LUT_SIZE; k++) {
      expect(mixingLutPosition(LOCAL_EXCESS_FRACTIONS[k])).toBeCloseTo(k / (LOCAL_LUT_SIZE - 1), 10);
    }
    expect(mixingLutPosition(0.5 * LOCAL_EXCESS_MIN)).toBeCloseTo(0.5 / (LOCAL_LUT_SIZE - 1), 12);
    expect(mixingLutPosition(-1)).toBe(0);
    expect(mixingLutPosition(5)).toBe(1);
    let last = -1;
    for (let m = 0; m <= 1; m += 1e-3) {
      const t = mixingLutPosition(m);
      expect(t).toBeGreaterThanOrEqual(last);
      last = t;
    }
  });
});

import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, buildSetup, indicatorDoseVolumeML, titrantLimitML, useExperimentStore } from './experimentStore';

const store = useExperimentStore;

beforeEach(() => {
  store.setState({ ...DEFAULT_CONFIG, toasts: [], theme: 'light', panelsVisible: true, lightingMode: 1 });
  store.getState().reset();
});

describe('experiment store', () => {
  it('computes the initial chemistry from the default configuration', () => {
    const s = store.getState();
    expect(s.currentState).not.toBeNull();
    expect(s.currentState!.pH).toBeCloseTo(2.88, 1);
    expect(s.visualState!.bulkPH).toBe(s.currentState!.pH);
    expect(s.analysis!.equivalence.points[0].volumeML).toBeCloseTo(50, 9);
  });

  it('adds the indicator and records the dose as a snapshot', () => {
    expect(store.getState().addIndicator()).toBe(true);
    const s = store.getState();
    expect(s.addedIndicator).toEqual({ indicatorId: 'phenolphthalein', stockConcentrationM: DEFAULT_CONFIG.indicatorStockConcentrationM, volumeML: 0.1 });
    expect(s.currentState!.indicator).not.toBeNull();
    expect(s.currentState!.totalVolumeML).toBeCloseTo(50.1, 9);
    expect(s.analysis!.transition).not.toBeNull();
    expect(s.analysis!.error).not.toBeNull();
    expect(indicatorDoseVolumeML({ indicatorAmountMode: 'volume', indicatorDrops: 2, indicatorVolumeML: 0.35 })).toBe(0.35);
  });

  it('adds titrant drop by drop, recording points and updating pH', () => {
    const s0 = store.getState();
    for (let i = 0; i < 10; i++) expect(s0.addTitrant(0.05)).toBe(true);
    const s = store.getState();
    expect(s.addedTitrantVolumeML).toBeCloseTo(0.5, 9);
    expect(s.titrationPoints).toHaveLength(10);
    expect(s.titrationPoints[9].pH).toBeGreaterThan(s.titrationPoints[0].pH);
    expect(s.currentState!.pH).toBe(s.titrationPoints[9].pH);
    expect(s.chemistryVersion).toBeGreaterThanOrEqual(10);
  });

  it('enforces the 200 % titrant limit and stops titration with a notification', () => {
    store.getState().setConfig({ analyteVolumeML: 1 });
    expect(titrantLimitML(store.getState())).toBe(2);
    store.getState().setTitrating(true);
    let accepted = 0;
    for (let i = 0; i < 100; i++) if (store.getState().addTitrant(0.5)) accepted++;
    const s = store.getState();
    expect(accepted).toBe(4);
    expect(s.addedTitrantVolumeML).toBeCloseTo(2, 9);
    expect(s.limitReached).toBe(true);
    expect(s.isTitrating).toBe(false);
    expect(s.toasts.some((t) => /limit/i.test(t.message))).toBe(true);
    store.getState().setTitrating(true);
    expect(store.getState().isTitrating).toBe(false);
  });

  it('validates and clamps configuration inputs', () => {
    store.getState().setConfig({ analyteConcentrationM: 50, analyteVolumeML: 0.1, dropVolumeML: Number.NaN, indicatorDrops: 3.7 });
    const s = store.getState();
    expect(s.analyteConcentrationM).toBe(10);
    expect(s.analyteVolumeML).toBe(1);
    expect(s.dropVolumeML).toBe(0.005);
    expect(s.indicatorDrops).toBe(4);
    store.getState().setConfig({ analyteId: 'does_not_exist' });
    expect(store.getState().analyteId).toBe('acetic_acid');
  });

  it('restarts the run when chemistry inputs change and picks a suitable flask', () => {
    store.getState().addTitrant(0.05);
    expect(store.getState().titrationPoints).toHaveLength(1);
    store.getState().setConfig({ analyteId: 'phosphoric_acid' });
    const s = store.getState();
    expect(s.titrationPoints).toHaveLength(0);
    expect(s.addedTitrantVolumeML).toBe(0);
    expect(s.currentState!.pH).toBeLessThan(2);
    expect(s.flask.spec.nominalML).toBe(250);
    store.getState().setConfig({ analyteVolumeML: 1000 });
    expect(store.getState().flask.spec.nominalML).toBeGreaterThanOrEqual(3000);
  });

  it('resets everything', () => {
    store.getState().addIndicator();
    store.getState().addTitrant(0.05);
    store.getState().setStirring(true);
    const before = store.getState().resetVersion;
    store.getState().reset();
    const s = store.getState();
    expect(s.addedIndicator).toBeNull();
    expect(s.addedTitrantVolumeML).toBe(0);
    expect(s.titrationPoints).toEqual([]);
    expect(s.isStirring).toBe(false);
    expect(s.resetVersion).toBe(before + 1);
    expect(s.currentState!.indicator).toBeNull();
  });

  it('builds a setup with the flask optical path', () => {
    const setup = buildSetup(store.getState());
    expect(setup).not.toBeNull();
    expect(setup!.opticalPathCm).toBeGreaterThan(3);
    expect(setup!.opticalPathCm).toBeLessThan(8);
  });

  it('switching the indicator selection updates the default stock concentration', () => {
    store.getState().setConfig({ indicatorId: 'bromothymol_blue' });
    const s = store.getState();
    expect(s.indicatorId).toBe('bromothymol_blue');
    expect(s.indicatorStockConcentrationM).toBeCloseTo(0.4 / 624.4, 9);
  });

  it('UI preferences toggle', () => {
    const s = store.getState();
    s.toggleTheme();
    expect(store.getState().theme).toBe('dark');
    s.togglePanels();
    expect(store.getState().panelsVisible).toBe(false);
    s.setLightingMode(2);
    expect(store.getState().lightingMode).toBe(2);
    s.setPanelWidth('left', 10);
    expect(store.getState().leftPanelWidth).toBe(280);
    const id = s.pushToast('hello');
    expect(store.getState().toasts.some((t) => t.id === id)).toBe(true);
    s.dismissToast(id);
    expect(store.getState().toasts.some((t) => t.id === id)).toBe(false);
  });

  it('Davies mode changes the computed pH deterministically', () => {
    const ideal = store.getState().currentState!.pH;
    store.getState().setConfig({ activityModel: 'davies' });
    const davies = store.getState().currentState!.pH;
    expect(davies).not.toBe(ideal);
    expect(Math.abs(davies - ideal)).toBeLessThan(0.2);
  });
});

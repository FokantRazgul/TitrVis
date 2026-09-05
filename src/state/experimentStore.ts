/**
 * Authoritative application state (Zustand).
 *
 * Inputs (configuration, held controls, UI preferences) are stored; chemical results are
 * recomputed from the inputs by the chemistry engine whenever an input changes, so there is
 * exactly one source of truth. The recorded titration points are kept because re-deriving
 * the history would require re-solving every historical drop.
 */

import { create } from 'zustand';
import { LIMITS } from '../chemistry/constants';
import { ChemistryError } from '../chemistry/equilibrium';
import {
  analyseEquivalence,
  detectInflections,
  indicatorError,
  indicatorTransitionVolume,
  type EquivalenceAnalysis,
  type IndicatorError,
  type IndicatorTransition,
} from '../chemistry/equivalence';
import { INDICATORS, findIndicator, typicalStockConcentrationM } from '../chemistry/indicators';
import { SUBSTANCES, findSubstance } from '../chemistry/substances';
import { computeReferenceCurve, computeTitrationState, type TitrationPoint, type TitrationSetup, type TitrationState } from '../chemistry/titration';
import type { ActivityModel, ChemicalVisualState } from '../chemistry/types';
import { checkNumber } from '../chemistry/validation';
import { flaskProfile, opticalPathCm, selectFlask, type FlaskProfile } from '../simulation/flaskGeometry';
import { reportChemistryFailure } from '../utils/diagnostics';
import { deriveVisualState } from './visualState';

export type LightingMode = 1 | 2 | 3;
export type Theme = 'light' | 'dark';
export type ToastKind = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  createdAt: number;
}

export interface IndicatorDoseSnapshot {
  indicatorId: string;
  stockConcentrationM: number;
  volumeML: number;
}

export interface AnalysisResult {
  equivalence: EquivalenceAnalysis;
  transition: IndicatorTransition | null;
  error: IndicatorError | null;
  /** Volumes of numerically detected inflections of the model curve (diagnostic). */
  inflectionVolumesML: number[];
  /** Maximum added titrant volume considered (the safety limit). */
  vMaxML: number;
}

export interface ExperimentConfig {
  analyteId: string;
  analyteConcentrationM: number;
  analyteVolumeML: number;
  titrantId: string;
  titrantConcentrationM: number;
  dropRateHz: number;
  dropVolumeML: number;
  indicatorId: string;
  indicatorStockConcentrationM: number;
  indicatorAmountMode: 'drops' | 'volume';
  indicatorDrops: number;
  indicatorVolumeML: number;
  activityModel: ActivityModel;
  /** Maximum added titrant as a multiple of the initial analyte volume (default 2 = 200 %). */
  titrantLimitFactor: number;
}

export interface ExperimentState extends ExperimentConfig {
  // ---- runtime (experiment progress)
  addedIndicator: IndicatorDoseSnapshot | null;
  addedTitrantVolumeML: number;
  titrationPoints: TitrationPoint[];
  currentState: TitrationState | null;
  visualState: ChemicalVisualState | null;
  analysis: AnalysisResult | null;
  chemistryError: string | null;
  limitReached: boolean;
  isTitrating: boolean;
  isStirring: boolean;
  /** Incremented on every chemistry update (used by throttled consumers). */
  chemistryVersion: number;
  /** Incremented on reset so that simulation/rendering can clear transient state. */
  resetVersion: number;
  flask: FlaskProfile;

  // ---- UI / preferences
  lightingMode: LightingMode;
  cameraLightingAvailable: boolean;
  panelsVisible: boolean;
  theme: Theme;
  muted: boolean;
  indicatorPanelOpen: boolean;
  leftPanelWidth: number;
  rightPanelWidth: number;
  toasts: Toast[];
  webgl2Available: boolean;

  // ---- actions
  setConfig: (patch: Partial<ExperimentConfig>) => void;
  addIndicator: () => boolean;
  addTitrant: (volumeML: number) => boolean;
  setTitrating: (active: boolean) => void;
  setStirring: (active: boolean) => void;
  reset: () => void;
  refreshAnalysis: () => void;
  setLightingMode: (mode: LightingMode) => void;
  setCameraLightingAvailable: (available: boolean) => void;
  togglePanels: () => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  toggleMute: () => void;
  setIndicatorPanelOpen: (open: boolean) => void;
  setPanelWidth: (side: 'left' | 'right', width: number) => void;
  pushToast: (message: string, kind?: ToastKind) => number;
  dismissToast: (id: number) => void;
  setWebgl2Available: (available: boolean) => void;
}

export const DEFAULT_CONFIG: ExperimentConfig = {
  analyteId: 'acetic_acid',
  analyteConcentrationM: 0.1,
  analyteVolumeML: 50,
  titrantId: 'sodium_hydroxide',
  titrantConcentrationM: 0.1,
  dropRateHz: 3,
  dropVolumeML: 0.05,
  indicatorId: 'phenolphthalein',
  indicatorStockConcentrationM: typicalStockConcentrationM(INDICATORS.find((i) => i.id === 'phenolphthalein') ?? INDICATORS[0]),
  indicatorAmountMode: 'drops',
  indicatorDrops: 2,
  indicatorVolumeML: 0.1,
  activityModel: 'ideal',
  titrantLimitFactor: 2,
};

export const PANEL_WIDTH = { min: 280, max: 640, defaultLeft: 380, defaultRight: 420 } as const;

const USER_FRIENDLY_CHEMISTRY_ERROR = 'Unable to calculate the current equilibrium. The previous valid state has been retained.';

let toastCounter = 0;
let analysisTimer: ReturnType<typeof setTimeout> | null = null;

/** Indicator dose (mL) implied by the configuration. */
export function indicatorDoseVolumeML(config: Pick<ExperimentConfig, 'indicatorAmountMode' | 'indicatorDrops' | 'indicatorVolumeML'>): number {
  return config.indicatorAmountMode === 'drops' ? config.indicatorDrops * LIMITS.indicatorDropVolumeML : config.indicatorVolumeML;
}

export function titrantLimitML(config: Pick<ExperimentConfig, 'analyteVolumeML' | 'titrantLimitFactor'>): number {
  return config.analyteVolumeML * config.titrantLimitFactor;
}

/** Build the chemistry setup from the state, or null when the configuration is incomplete. */
export function buildSetup(state: ExperimentConfig & { addedIndicator: IndicatorDoseSnapshot | null; flask: FlaskProfile; addedTitrantVolumeML: number }): TitrationSetup | null {
  const analyte = findSubstance(state.analyteId);
  const titrant = findSubstance(state.titrantId);
  if (!analyte || !titrant) return null;
  let indicator: TitrationSetup['indicator'] = null;
  if (state.addedIndicator) {
    const ind = findIndicator(state.addedIndicator.indicatorId);
    if (ind) {
      indicator = { indicator: ind, stockConcentrationM: state.addedIndicator.stockConcentrationM, volumeML: state.addedIndicator.volumeML };
    }
  }
  const totalML = state.analyteVolumeML + state.addedTitrantVolumeML + (indicator ? indicator.volumeML : 0);
  return {
    analyte,
    analyteConcentrationM: state.analyteConcentrationM,
    analyteVolumeML: state.analyteVolumeML,
    titrant,
    titrantConcentrationM: state.titrantConcentrationM,
    indicator,
    activityModel: state.activityModel,
    temperatureC: 25,
    opticalPathCm: opticalPathCm(state.flask, totalML),
  };
}

function sanitiseConfig(patch: Partial<ExperimentConfig>, current: ExperimentConfig): Partial<ExperimentConfig> {
  const out: Partial<ExperimentConfig> = {};
  const num = (key: keyof ExperimentConfig, range: { min: number; max: number }) => {
    const v = patch[key];
    if (typeof v === 'number') {
      const check = checkNumber(v, range, '');
      (out as Record<string, unknown>)[key] = check.value;
    }
  };
  if (patch.analyteId && findSubstance(patch.analyteId)) out.analyteId = patch.analyteId;
  if (patch.titrantId && findSubstance(patch.titrantId)) out.titrantId = patch.titrantId;
  if (patch.indicatorId && findIndicator(patch.indicatorId)) out.indicatorId = patch.indicatorId;
  num('analyteConcentrationM', LIMITS.analyteConcentrationM);
  num('analyteVolumeML', LIMITS.analyteVolumeML);
  num('titrantConcentrationM', LIMITS.titrantConcentrationM);
  num('dropRateHz', LIMITS.dropRateHz);
  num('dropVolumeML', LIMITS.dropVolumeML);
  num('indicatorStockConcentrationM', LIMITS.indicatorStockConcentrationM);
  num('indicatorVolumeML', LIMITS.indicatorVolumeML);
  num('titrantLimitFactor', LIMITS.titrantLimitFactor);
  if (typeof patch.indicatorDrops === 'number') {
    out.indicatorDrops = Math.round(checkNumber(patch.indicatorDrops, LIMITS.indicatorDrops, '').value);
  }
  if (patch.indicatorAmountMode === 'drops' || patch.indicatorAmountMode === 'volume') out.indicatorAmountMode = patch.indicatorAmountMode;
  if (patch.activityModel === 'ideal' || patch.activityModel === 'davies') out.activityModel = patch.activityModel;
  // Drop the keys that did not change to avoid needless recomputation.
  for (const key of Object.keys(out) as (keyof ExperimentConfig)[]) {
    if (out[key] === current[key]) delete out[key];
  }
  return out;
}

function flaskFor(config: Pick<ExperimentConfig, 'analyteVolumeML' | 'titrantLimitFactor' | 'indicatorAmountMode' | 'indicatorDrops' | 'indicatorVolumeML'>): FlaskProfile {
  return selectFlask(config.analyteVolumeML * (1 + config.titrantLimitFactor) + indicatorDoseVolumeML(config));
}

export const useExperimentStore = create<ExperimentState>()((set, get) => {
  /** Recompute the current chemical state from inputs; keeps the previous valid state on failure. */
  const refreshChemistry = (): boolean => {
    const s = get();
    const setup = buildSetup(s);
    if (!setup) {
      set({ chemistryError: 'Select an analyte and a titrant.' });
      return false;
    }
    try {
      const state = computeTitrationState(setup, s.addedTitrantVolumeML);
      const visual = deriveVisualState(setup, state);
      set({ currentState: state, visualState: visual, chemistryError: null, chemistryVersion: s.chemistryVersion + 1 });
      return true;
    } catch (error) {
      reportChemistryFailure(error, {
        addedTitrantVolumeML: s.addedTitrantVolumeML,
        previousPH: s.currentState?.pH,
        previousIterations: s.currentState?.solver.iterations,
        config: {
          analyteId: s.analyteId,
          analyteConcentrationM: s.analyteConcentrationM,
          analyteVolumeML: s.analyteVolumeML,
          titrantId: s.titrantId,
          titrantConcentrationM: s.titrantConcentrationM,
          activityModel: s.activityModel,
        },
      });
      const message = error instanceof ChemistryError ? USER_FRIENDLY_CHEMISTRY_ERROR : USER_FRIENDLY_CHEMISTRY_ERROR;
      if (s.chemistryError !== message) get().pushToast(message, 'error');
      set({ chemistryError: message });
      return false;
    }
  };

  const refreshAnalysis = () => {
    const s = get();
    const setup = buildSetup(s);
    if (!setup) {
      set({ analysis: null });
      return;
    }
    const vMax = titrantLimitML(s);
    try {
      const equivalence = analyseEquivalence(setup);
      const transition = indicatorTransitionVolume(setup, vMax);
      const error = indicatorError(transition, equivalence);
      const curve = computeReferenceCurve(setup, vMax, 120, 600);
      const inflectionVolumesML = detectInflections(curve);
      set({ analysis: { equivalence, transition, error, inflectionVolumesML, vMaxML: vMax } });
    } catch (error) {
      reportChemistryFailure(error, { scope: 'analysis' });
      set({ analysis: null });
    }
  };

  const scheduleAnalysis = () => {
    if (analysisTimer) clearTimeout(analysisTimer);
    analysisTimer = setTimeout(() => {
      analysisTimer = null;
      refreshAnalysis();
    }, 150);
  };

  const initialFlask = flaskFor(DEFAULT_CONFIG);

  return {
    ...DEFAULT_CONFIG,
    addedIndicator: null,
    addedTitrantVolumeML: 0,
    titrationPoints: [],
    currentState: null,
    visualState: null,
    analysis: null,
    chemistryError: null,
    limitReached: false,
    isTitrating: false,
    isStirring: false,
    chemistryVersion: 0,
    resetVersion: 0,
    flask: initialFlask,
    lightingMode: 1,
    cameraLightingAvailable: false,
    panelsVisible: true,
    theme: 'light',
    muted: false,
    indicatorPanelOpen: false,
    leftPanelWidth: PANEL_WIDTH.defaultLeft,
    rightPanelWidth: PANEL_WIDTH.defaultRight,
    toasts: [],
    webgl2Available: true,

    setConfig: (patch) => {
      const s = get();
      const clean = sanitiseConfig(patch, s);
      if (Object.keys(clean).length === 0) return;
      // Changing the chemistry inputs invalidates the recorded run: restart the experiment.
      const chemistryKeys: (keyof ExperimentConfig)[] = [
        'analyteId',
        'analyteConcentrationM',
        'analyteVolumeML',
        'titrantId',
        'titrantConcentrationM',
        'activityModel',
        'titrantLimitFactor',
      ];
      const affectsChemistry = chemistryKeys.some((k) => k in clean);
      const next = { ...s, ...clean };
      if (affectsChemistry) {
        set({
          ...clean,
          addedTitrantVolumeML: 0,
          titrationPoints: [],
          limitReached: false,
          isTitrating: false,
          flask: flaskFor(next),
          resetVersion: s.resetVersion + 1,
        });
        refreshChemistry();
        scheduleAnalysis();
      } else {
        set({ ...clean, flask: flaskFor(next) });
        if (clean.indicatorId && s.indicatorId !== clean.indicatorId) {
          const ind = findIndicator(clean.indicatorId);
          if (ind) set({ indicatorStockConcentrationM: typicalStockConcentrationM(ind) });
        }
      }
    },

    addIndicator: () => {
      const s = get();
      const indicator = findIndicator(s.indicatorId);
      if (!indicator) return false;
      const dose: IndicatorDoseSnapshot = {
        indicatorId: indicator.id,
        stockConcentrationM: s.indicatorStockConcentrationM,
        volumeML: indicatorDoseVolumeML(s),
      };
      set({ addedIndicator: dose, flask: flaskFor(s) });
      const ok = refreshChemistry();
      if (!ok) {
        set({ addedIndicator: null });
        return false;
      }
      // Re-record the current point set with the indicator present (dilution changed the pH).
      const st = get().currentState;
      if (st) {
        set({ titrationPoints: get().titrationPoints.length === 0 ? [] : get().titrationPoints });
      }
      refreshAnalysis();
      get().pushToast(`${indicator.name} added (${dose.volumeML.toFixed(2)} mL).`, 'success');
      return true;
    },

    addTitrant: (volumeML) => {
      const s = get();
      if (!Number.isFinite(volumeML) || volumeML <= 0) return false;
      if (s.limitReached) return false;
      const limit = titrantLimitML(s);
      if (s.addedTitrantVolumeML + volumeML > limit + 1e-9) {
        set({ limitReached: true, isTitrating: false });
        get().pushToast(`Titrant limit reached (${limit.toFixed(1)} mL = ${Math.round(s.titrantLimitFactor * 100)} % of the analyte volume). Titration stopped.`, 'warning');
        return false;
      }
      set({ addedTitrantVolumeML: s.addedTitrantVolumeML + volumeML });
      const ok = refreshChemistry();
      if (!ok) {
        // Roll back the addition so that the recorded history stays consistent with valid chemistry.
        set({ addedTitrantVolumeML: s.addedTitrantVolumeML });
        return false;
      }
      const current = get().currentState;
      if (current) {
        set({ titrationPoints: [...get().titrationPoints, { addedVolumeML: current.addedVolumeML, pH: current.pH }] });
      }
      if (get().addedTitrantVolumeML >= limit - 1e-9) {
        set({ limitReached: true, isTitrating: false });
        get().pushToast(`Titrant limit reached (${limit.toFixed(1)} mL). Titration stopped.`, 'warning');
      }
      return true;
    },

    setTitrating: (active) => {
      const s = get();
      if (active && s.limitReached) return;
      if (s.isTitrating !== active) set({ isTitrating: active });
    },

    setStirring: (active) => {
      if (get().isStirring !== active) set({ isStirring: active });
    },

    reset: () => {
      const s = get();
      set({
        addedIndicator: null,
        addedTitrantVolumeML: 0,
        titrationPoints: [],
        limitReached: false,
        isTitrating: false,
        isStirring: false,
        indicatorPanelOpen: false,
        resetVersion: s.resetVersion + 1,
        flask: flaskFor(s),
      });
      refreshChemistry();
      refreshAnalysis();
    },

    refreshAnalysis,

    setLightingMode: (mode) => set({ lightingMode: mode }),
    setCameraLightingAvailable: (available) => set({ cameraLightingAvailable: available }),
    togglePanels: () => set({ panelsVisible: !get().panelsVisible }),
    setTheme: (theme) => set({ theme }),
    toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
    toggleMute: () => set({ muted: !get().muted }),
    setIndicatorPanelOpen: (open) => set({ indicatorPanelOpen: open }),
    setPanelWidth: (side, width) => {
      const w = Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, Math.round(width)));
      if (side === 'left') set({ leftPanelWidth: w });
      else set({ rightPanelWidth: w });
    },
    pushToast: (message, kind = 'info') => {
      const id = ++toastCounter;
      set({ toasts: [...get().toasts.slice(-4), { id, message, kind, createdAt: Date.now() }] });
      return id;
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    setWebgl2Available: (available) => set({ webgl2Available: available }),
  };
});

/** Compute the initial chemistry once the module is loaded (idempotent). */
export function initialiseExperiment(): void {
  const s = useExperimentStore.getState();
  if (!s.currentState) {
    s.reset();
  }
}

export { SUBSTANCES, INDICATORS, flaskProfile };

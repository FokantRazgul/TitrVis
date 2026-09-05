/**
 * Read-only diagnostic hook for browser tests and QA: `window.__TITRVIS__` exposes the store
 * state, a frame counter and simulation statistics. It never mutates chemistry and is kept in
 * production because it is harmless and useful for support.
 */
import { useExperimentStore } from '../state/experimentStore';
import type { SimulationManager } from '../simulation/SimulationManager';
import { getSceneHandles, type SceneHandles } from '../rendering/sceneRegistry';
import { FluidSimulation } from '../simulation/FluidSimulation';
import { MixingSimulation } from '../simulation/MixingSimulation';

export interface TitrVisDiagnostics {
  getState: () => ReturnType<typeof useExperimentStore.getState>;
  subscribe: typeof useExperimentStore.subscribe;
  frames: number;
  /** Average frame time (ms) over the last second. */
  frameTimeMs: number;
  simulation: SimulationManager | null;
  scene: () => SceneHandles | null;
  /** Simulation classes for GPU acceptance tests (create → run → dispose against the live renderer). */
  gpu: { FluidSimulation: typeof FluidSimulation; MixingSimulation: typeof MixingSimulation };
}

declare global {
  interface Window {
    __TITRVIS__?: TitrVisDiagnostics;
  }
}

export function installDevHook(): TitrVisDiagnostics {
  if (typeof window === 'undefined') {
    return { getState: useExperimentStore.getState, subscribe: useExperimentStore.subscribe, frames: 0, frameTimeMs: 0, simulation: null, scene: () => null, gpu: { FluidSimulation, MixingSimulation } };
  }
  if (!window.__TITRVIS__) {
    window.__TITRVIS__ = {
      getState: useExperimentStore.getState,
      subscribe: useExperimentStore.subscribe,
      frames: 0,
      frameTimeMs: 0,
      simulation: null,
      scene: getSceneHandles,
      gpu: { FluidSimulation, MixingSimulation },
    };
  }
  return window.__TITRVIS__;
}

let lastStamp = 0;
let accum = 0;
let accumFrames = 0;

/** Called once per rendered frame by the scene. */
export function recordFrame(manager: SimulationManager): void {
  const hook = installDevHook();
  hook.frames++;
  hook.simulation = manager;
  const now = performance.now();
  if (lastStamp > 0) {
    accum += now - lastStamp;
    accumFrames++;
    if (accum >= 1000) {
      hook.frameTimeMs = accum / accumFrames;
      accum = 0;
      accumFrames = 0;
    }
  }
  lastStamp = now;
}

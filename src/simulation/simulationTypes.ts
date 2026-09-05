/**
 * Shared simulation types. The simulation layer consumes ChemicalVisualState and
 * produces spatial/visual state for the renderer; it never modifies chemical truth.
 */

import type { ChemicalVisualState } from '../chemistry/types';

export type DropState = 'pendant' | 'falling' | 'impacting' | 'removed';

export interface Drop {
  id: number;
  /** World position (m). */
  x: number;
  y: number;
  z: number;
  /** Velocity (m/s). */
  vx: number;
  vy: number;
  vz: number;
  /** Current visual radius (m) — grows during the pendant phase. */
  radius: number;
  /** Final radius (m) for the configured drop volume. */
  fullRadius: number;
  /** Titrant volume carried (mL). */
  volumeML: number;
  state: DropState;
  /** Time spent in the current state (s). */
  age: number;
}

export interface ImpactEvent {
  drop: Drop;
  /** Impact position on the surface (m, world). */
  x: number;
  z: number;
  /** Vertical speed at impact (m/s, positive downward). */
  speed: number;
}

export interface StirState {
  /** 0..1 activation of the external stirring drive (rises while Shift is held, decays after release). */
  drive: number;
  /** Phase of the circular flask motion (rad). */
  phase: number;
  /** Current flask tilt (rad) and its horizontal offset direction. */
  tiltRad: number;
  offsetX: number;
  offsetZ: number;
  /** Bulk swirl (angular speed proxy, rad/s) following the same forcing/damping law as the fluid. */
  swirl: number;
}

export interface SimulationSnapshot {
  drops: readonly Drop[];
  stir: StirState;
  /** Height of the liquid surface (m) above the inner flask floor. */
  liquidHeight: number;
  /** Radius of the liquid surface disc (m). */
  surfaceRadius: number;
  chemistry: ChemicalVisualState | null;
}

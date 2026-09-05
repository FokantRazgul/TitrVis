/**
 * Titrant drop system.
 *
 * Drops form at the burette tip while titration is active: a pendant phase in which the
 * visual radius grows to the configured drop volume, followed by free fall under gravity
 * (ballistic integration each frame) until the drop reaches the liquid surface, where an
 * impact event is emitted exactly once. Only the impact adds titrant to the chemistry —
 * a falling drop changes nothing.
 */

import { sphereRadiusFromVolumeML } from '../utils/math';
import type { Drop, ImpactEvent } from './simulationTypes';

export const GRAVITY = 9.81;

export interface DropSystemOptions {
  /** Burette tip position (m). */
  tipX: number;
  tipY: number;
  tipZ: number;
  /** Fraction of the drop interval spent growing at the tip (0..0.9). */
  pendantFraction?: number;
}

export interface DropSurfaceQuery {
  /** Liquid surface height (m) at world (x, z). */
  heightAt: (x: number, z: number) => number;
}

export class DropSystem {
  private drops: Drop[] = [];
  private nextId = 1;
  private timeSinceLastDrop = 0;
  private readonly pendantFraction: number;
  tipX: number;
  tipY: number;
  tipZ: number;

  constructor(options: DropSystemOptions) {
    this.tipX = options.tipX;
    this.tipY = options.tipY;
    this.tipZ = options.tipZ;
    this.pendantFraction = Math.min(0.9, Math.max(0.05, options.pendantFraction ?? 0.55));
  }

  get activeDrops(): readonly Drop[] {
    return this.drops;
  }

  /** Total volume (mL) of drops currently in flight — not yet added to the chemistry. */
  get inFlightVolumeML(): number {
    return this.drops.reduce((sum, d) => (d.state === 'falling' || d.state === 'pendant' ? sum + d.volumeML : sum), 0);
  }

  reset(): void {
    this.drops = [];
    this.timeSinceLastDrop = 0;
  }

  /**
   * Advance the system. `titrating` controls whether new drops form; `allowNewDrops` lets the
   * caller veto formation (e.g. the safety limit). Returns the impacts that occurred this step.
   */
  update(dt: number, titrating: boolean, allowNewDrops: boolean, dropRateHz: number, dropVolumeML: number, surface: DropSurfaceQuery): ImpactEvent[] {
    const impacts: ImpactEvent[] = [];
    const interval = 1 / Math.max(0.01, dropRateHz);
    const hasPendant = this.drops.some((d) => d.state === 'pendant');

    if (titrating && allowNewDrops) {
      this.timeSinceLastDrop += dt;
      if (!hasPendant && this.timeSinceLastDrop >= interval * (1 - this.pendantFraction)) {
        this.drops.push({
          id: this.nextId++,
          x: this.tipX,
          y: this.tipY,
          z: this.tipZ,
          vx: 0,
          vy: 0,
          vz: 0,
          radius: 0,
          fullRadius: sphereRadiusFromVolumeML(dropVolumeML),
          volumeML: dropVolumeML,
          state: 'pendant',
          age: 0,
        });
      }
    } else {
      this.timeSinceLastDrop = Math.min(this.timeSinceLastDrop, interval);
    }

    const pendantDuration = interval * this.pendantFraction;
    for (const drop of this.drops) {
      drop.age += dt;
      if (drop.state === 'pendant') {
        // Grow the hanging drop; volume grows linearly, so radius ∝ t^(1/3).
        const t = Math.min(1, drop.age / pendantDuration);
        drop.radius = drop.fullRadius * Math.cbrt(Math.max(t, 1e-3));
        // The pendant drop hangs below the tip by its radius.
        drop.y = this.tipY - drop.radius;
        if (t >= 1) {
          if (titrating && allowNewDrops) {
            drop.state = 'falling';
            drop.age = 0;
            // The interval clock restarts at detachment so that the period is exactly 1 / dropRate.
            this.timeSinceLastDrop = 0;
          } else {
            // Stopped titrating while the drop was forming: the drop stays hanging at full size and
            // will fall on the next active update. This mirrors a burette tap closed with a drop hanging.
            drop.radius = drop.fullRadius;
          }
        }
      } else if (drop.state === 'falling') {
        drop.vy -= GRAVITY * dt;
        drop.x += drop.vx * dt;
        drop.y += drop.vy * dt;
        drop.z += drop.vz * dt;
        const surfaceY = surface.heightAt(drop.x, drop.z);
        if (drop.y - drop.radius * 0.5 <= surfaceY) {
          drop.state = 'impacting';
          drop.age = 0;
          drop.y = surfaceY;
          impacts.push({ drop, x: drop.x, z: drop.z, speed: Math.abs(drop.vy) });
        }
      } else if (drop.state === 'impacting') {
        // Brief visual merge phase (the drop shrinks into the liquid) then removal.
        drop.radius = drop.fullRadius * Math.max(0, 1 - drop.age / 0.08);
        if (drop.age >= 0.08) drop.state = 'removed';
      }
    }
    this.drops = this.drops.filter((d) => d.state !== 'removed');
    return impacts;
  }
}

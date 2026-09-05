/**
 * Orchestrates the simulation layer for one frame:
 *
 *   drops → impact → (1) chemistry receives the drop volume (authoritative store)
 *                    (2) fluid receives a velocity impulse
 *                    (3) mixing receives the drop as a sinking vortex ring (3-D scalar field)
 *                    (4) surface receives a crater
 *   stirring drive → flask motion, fluid forcing, surface equilibrium, mixing rate
 *
 * The manager never computes chemistry itself; it calls the store's `addTitrant`, which runs the
 * equilibrium solver synchronously so that the visual state consumed later in the same frame is
 * already up to date (no race between GPU injection and chemical truth).
 */

import * as THREE from 'three';
import { flaskProfile, liquidHeightForVolume, type FlaskProfile } from './flaskGeometry';
import { DropSystem } from './DropSystem';
import { FluidSimulation } from './FluidSimulation';
import { installShaderErrorHandler, type ShaderCompileError } from './gpu/GpuPass';
import { MixingSimulation, type MixingGeometry } from './MixingSimulation';
import { SurfaceSimulation } from './SurfaceSimulation';
import type { ImpactEvent, StirState } from './simulationTypes';
import { approach, clamp, rateFromHalfLife } from '../utils/math';

export interface SimulationInput {
  dt: number;
  titrating: boolean;
  stirring: boolean;
  /** False when the safety limit forbids new drops. */
  allowDrops: boolean;
  dropRateHz: number;
  dropVolumeML: number;
  /** Current liquid volume in the flask (mL) from the authoritative state. */
  liquidVolumeML: number;
  flask: FlaskProfile;
}

export interface SimulationCallbacks {
  /** Deliver one drop's volume to the chemistry; return false if it was refused (limit). */
  onDropImpact: (volumeML: number, impact: ImpactEvent) => boolean;
  onShaderError?: (error: ShaderCompileError) => void;
}

/** Stirring parameters (see ASSUMPTIONS.md). */
export const STIR = {
  tiltRad: (12 * Math.PI) / 180,
  frequencyHz: 2.5,
  orbitRadius: 0.006,
  /** Target liquid angular speed while stirring (rad/s). */
  omega: 2 * Math.PI * 0.9,
  riseTau: 0.12,
  /** Flask returns upright over ≈0.5 s (3 time constants). */
  releaseTau: 0.5 / 3,
  halfLifeSeconds: 1.5,
} as const;

/** Adaptive simulation grid sizes; 128 is a fallback for very slow (software) renderers. */
export const RESOLUTIONS = [128, 256, 384, 512] as const;

export class SimulationManager {
  readonly drops: DropSystem;
  readonly surface: SurfaceSimulation;
  readonly fluid: FluidSimulation;
  readonly mixing: MixingSimulation;
  readonly stir: StirState = { drive: 0, phase: 0, tiltRad: 0, offsetX: 0, offsetZ: 0, swirl: 0 };
  liquidHeight = 0;
  surfaceRadius = 0.02;
  private flask: FlaskProfile;
  private readonly uninstallShaderHandler: () => void;
  private resolutionIndex = 0;
  private frameTimeEma = 16;
  private goodFrames = 0;
  private lastFrameStart = 0;
  shaderError: ShaderCompileError | null = null;
  disposed = false;

  constructor(
    renderer: THREE.WebGLRenderer,
    flask: FlaskProfile,
    private readonly callbacks: SimulationCallbacks,
    initialResolution: number = 256,
  ) {
    this.flask = flask;
    this.uninstallShaderHandler = installShaderErrorHandler(renderer, (error) => {
      this.shaderError = error;
      callbacks.onShaderError?.(error);
    });
    this.resolutionIndex = Math.max(0, RESOLUTIONS.indexOf(initialResolution as (typeof RESOLUTIONS)[number]));
    const resolution = RESOLUTIONS[this.resolutionIndex];
    this.fluid = new FluidSimulation(renderer, { resolution, halfLifeSeconds: STIR.halfLifeSeconds });
    this.mixing = new MixingSimulation(renderer, { resolution });
    this.surface = new SurfaceSimulation(this.surfaceRadius, { resolution: 64 });
    this.drops = new DropSystem({ tipX: 0.12 * flask.innerRadius(flask.shoulderHeight * 0.5), tipY: flask.spec.height + 0.035, tipZ: 0 });
  }

  /** World position of the burette tip (m, flask floor at the origin). */
  get tipPosition(): THREE.Vector3 {
    return new THREE.Vector3(this.drops.tipX, this.drops.tipY, this.drops.tipZ);
  }

  setFlask(flask: FlaskProfile): void {
    if (flask !== this.flask) {
      this.flask = flask;
      this.drops.tipY = flask.spec.height + 0.035;
      this.drops.tipX = 0.12 * flask.innerRadius(flask.shoulderHeight * 0.5);
    }
  }

  reset(): void {
    this.drops.reset();
    this.surface.reset();
    this.fluid.reset();
    this.mixing.reset();
    this.stir.drive = 0;
    this.stir.phase = 0;
    this.stir.tiltRad = 0;
    this.stir.offsetX = 0;
    this.stir.offsetZ = 0;
    this.stir.swirl = 0;
  }

  /** Surface height (m, world y) at a world (x, z), accounting for flask offset and waves. */
  surfaceHeightAt(x: number, z: number): number {
    const xr = x - this.stir.offsetX;
    const zr = z - this.stir.offsetZ;
    const r = Math.hypot(xr, zr);
    if (r > this.surfaceRadius) return this.liquidHeight;
    return this.liquidHeight + this.surface.heightAt(xr, zr);
  }

  private updateStir(dt: number, stirring: boolean): void {
    const s = this.stir;
    s.drive = approach(s.drive, stirring ? 1 : 0, stirring ? STIR.riseTau : STIR.releaseTau, dt);
    if (s.drive < 1e-4) s.drive = 0;
    s.phase = (s.phase + 2 * Math.PI * STIR.frequencyHz * s.drive * dt) % (2 * Math.PI);
    s.tiltRad = STIR.tiltRad * s.drive;
    s.offsetX = STIR.orbitRadius * s.drive * Math.cos(s.phase);
    s.offsetZ = STIR.orbitRadius * s.drive * Math.sin(s.phase);
    // Bulk swirl follows the same forcing/damping law as the GPU velocity: relaxation towards the
    // target angular speed while driven, exponential decay with the 1.5 s half-life otherwise.
    const damping = rateFromHalfLife(STIR.halfLifeSeconds);
    const gain = 3.0 * s.drive;
    s.swirl += (STIR.omega - s.swirl) * (1 - Math.exp(-gain * dt));
    s.swirl *= Math.exp(-damping * dt * (1 - s.drive));
    if (Math.abs(s.swirl) < 1e-5) s.swirl = 0;

    // Orbital acceleration of the flask (m/s²) → slosh forcing, expressed in UV/s² for the fluid.
    const omegaOrbit = 2 * Math.PI * STIR.frequencyHz;
    const accel = STIR.orbitRadius * omegaOrbit * omegaOrbit; // m/s²
    const ax = -accel * Math.cos(s.phase);
    const az = -accel * Math.sin(s.phase);
    const uvPerMetre = 1 / (2 * this.surfaceRadius);
    // The fluid domain's v axis maps to world −z (texture rows increase towards +z in our mapping),
    // handled consistently in worldToUV below.
    this.fluid.setStirring(s.drive, STIR.omega, ax * uvPerMetre * 0.15, -az * uvPerMetre * 0.15);
    this.mixing.setStirDrive(s.drive);
    // Surface equilibrium: liquid climbs the wall opposite to the acceleration (slope = a/g),
    // scaled by drive, plus the paraboloid of the bulk swirl.
    const slopeScale = (s.drive * accel) / 9.81;
    this.surface.setEquilibriumSlope(s.swirl, -slopeScale * Math.cos(s.phase), -slopeScale * Math.sin(s.phase));
  }

  /**
   * Geometry of the liquid volume for the volumetric mixing field: the reference radius is the
   * largest cross-section between floor and surface (the Erlenmeyer narrows upwards), the
   * floor/top radii are normalised by it.
   */
  mixingGeometry(): MixingGeometry {
    const h = Math.max(this.liquidHeight, 1e-3);
    let refRadius = this.surfaceRadius;
    for (let i = 0; i <= 8; i++) refRadius = Math.max(refRadius, this.flask.innerRadius(Math.max(1e-4, (h * i) / 8)));
    const bottom = this.flask.innerRadius(Math.min(h, 5e-4));
    return { height: h, refRadius, radiusTop: this.surfaceRadius / refRadius, radiusBottom: Math.max(0.05, bottom / refRadius) };
  }

  /** Map a flask-relative (x, z) position on the surface to fluid UV. */
  worldToUV(xRel: number, zRel: number): [number, number] {
    return [clamp(0.5 + xRel / (2 * this.surfaceRadius), 0, 1), clamp(0.5 - zRel / (2 * this.surfaceRadius), 0, 1)];
  }

  /** Largest simulated time advanced per rendered frame (s); longer gaps slow the simulation down. */
  static readonly MAX_FRAME_DT = 0.25;
  /** Sub-step size (s) so that slow renderers still advance simulated time at wall-clock rate. */
  static readonly SUB_STEP = 1 / 30;

  /** Advance everything by one frame (sub-stepped). Returns the impacts that happened. */
  update(input: SimulationInput): ImpactEvent[] {
    if (this.disposed) return [];
    const total = clamp(input.dt, 0, SimulationManager.MAX_FRAME_DT);
    this.setFlask(input.flask);
    this.liquidHeight = liquidHeightForVolume(this.flask, input.liquidVolumeML);
    this.surfaceRadius = Math.max(0.005, this.flask.innerRadius(Math.max(this.liquidHeight, 1e-4)));
    this.surface.setRadius(this.surfaceRadius);
    const impacts: ImpactEvent[] = [];
    if (total <= 0) {
      this.updateStir(0, input.stirring);
      this.adaptResolution();
      return impacts;
    }
    const steps = Math.max(1, Math.min(8, Math.ceil(total / SimulationManager.SUB_STEP)));
    const dt = total / steps;
    for (let i = 0; i < steps; i++) {
      this.updateStir(dt, input.stirring);
      const stepImpacts = this.drops.update(dt, input.titrating, input.allowDrops, input.dropRateHz, input.dropVolumeML, {
        heightAt: (x, z) => this.surfaceHeightAt(x, z),
      });
      for (const impact of stepImpacts) {
        const accepted = this.callbacks.onDropImpact(impact.drop.volumeML, impact);
        impacts.push(impact);
        if (!accepted) continue;
        // The chemistry has already absorbed the drop; refresh the liquid level for the next step.
        this.liquidHeight = liquidHeightForVolume(this.flask, input.liquidVolumeML + impact.drop.volumeML);
        const xr = impact.x - this.stir.offsetX;
        const zr = impact.z - this.stir.offsetZ;
        const [u, v] = this.worldToUV(xr, zr);
        const radiusUV = clamp(impact.drop.fullRadius / (2 * this.surfaceRadius), 0.01, 0.2) * 2.2;
        this.fluid.addSplat({ u, v, radius: radiusUV, strength: 0.35 + 0.1 * Math.min(impact.speed, 3) });
        // The drop fluid enters as a vortex ring that sinks, entrains and spreads in 3-D.
        this.mixing.injectDrop({ x: xr, z: zr, surfaceY: this.liquidHeight, dropRadius: impact.drop.fullRadius, speed: impact.speed });
        this.surface.addImpact(xr, zr, impact.drop.fullRadius, impact.speed);
      }
      this.fluid.step(dt);
      this.mixing.setGeometry(this.mixingGeometry());
      this.mixing.step(dt, this.fluid.velocityTexture);
      this.surface.step(dt);
    }
    this.adaptResolution();
    return impacts;
  }

  /** Adaptive simulation resolution based on a smoothed frame time. */
  private adaptResolution(): void {
    const now = performance.now();
    if (this.lastFrameStart > 0) {
      const frame = now - this.lastFrameStart;
      this.frameTimeEma = this.frameTimeEma * 0.9 + frame * 0.1;
      if (this.frameTimeEma < 12 && this.resolutionIndex < RESOLUTIONS.length - 1) {
        this.goodFrames++;
        if (this.goodFrames > 240) {
          this.goodFrames = 0;
          this.setResolutionIndex(this.resolutionIndex + 1);
        }
      } else if (this.frameTimeEma > 22 && this.resolutionIndex > 0) {
        this.goodFrames = 0;
        this.setResolutionIndex(this.resolutionIndex - 1);
        this.frameTimeEma = 16;
      } else {
        this.goodFrames = 0;
      }
    }
    this.lastFrameStart = now;
  }

  setResolutionIndex(index: number): void {
    const clampedIndex = clamp(index, 0, RESOLUTIONS.length - 1);
    if (clampedIndex === this.resolutionIndex) return;
    this.resolutionIndex = clampedIndex;
    const res = RESOLUTIONS[clampedIndex];
    this.fluid.resize(res);
    this.mixing.resize(res);
  }

  get resolution(): number {
    return RESOLUTIONS[this.resolutionIndex];
  }

  /** Notify that the page was hidden/resumed: the frame-time estimator must ignore the gap. */
  notifyResumed(): void {
    this.lastFrameStart = 0;
    this.frameTimeEma = 16;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.uninstallShaderHandler();
    this.fluid.dispose();
    this.mixing.dispose();
  }
}

export { flaskProfile };

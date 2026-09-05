/**
 * GPU Stable-Fluids velocity solver (WebGL2, GLSL ES 3.00) on Three.js render targets.
 *
 * Per step (Stam 1999 "Stable Fluids"):
 *   1. advection      — semi-Lagrangian back-trace with exponential damping exp(−k dt)
 *   2. diffusion      — implicit Jacobi iterations with viscosity ν
 *   3. external force — stirring drive, sloshing acceleration, drop impulses
 *   4. divergence
 *   5. pressure solve — Jacobi iterations on ∇²p = div
 *   6. projection     — v ← v − ∇p
 *
 * The domain is the unit square; the liquid occupies the disc of radius 0.49 (walls elsewhere).
 * Velocities are in UV units per second. The physical meaning of a UV unit is 2 × the surface
 * radius (set by the SimulationManager).
 */

import * as THREE from 'three';
import advectFrag from '../shaders/fluid/advect.frag.glsl?raw';
import copyFrag from '../shaders/fluid/copy.frag.glsl?raw';
import diffuseFrag from '../shaders/fluid/diffuse.frag.glsl?raw';
import divergenceFrag from '../shaders/fluid/divergence.frag.glsl?raw';
import forcesFrag from '../shaders/fluid/forces.frag.glsl?raw';
import gradientFrag from '../shaders/fluid/gradient.frag.glsl?raw';
import pressureFrag from '../shaders/fluid/pressure.frag.glsl?raw';
import { rateFromHalfLife } from '../utils/math';
import { GpuPass, PingPong, createFloatTarget, pickFloatType, withSimulationState } from './gpu/GpuPass';

export const MAX_SPLATS = 8;

export interface FluidOptions {
  resolution?: number;
  /** Velocity half-life after forcing stops (s). */
  halfLifeSeconds?: number;
  /** Kinematic viscosity in UV²/s. */
  viscosity?: number;
  pressureIterations?: number;
  diffusionIterations?: number;
}

export interface VelocitySplat {
  /** UV position of the impulse centre. */
  u: number;
  v: number;
  /** Gaussian radius (UV). */
  radius: number;
  /** Peak radial speed added (UV/s). */
  strength: number;
}

export interface FluidStats {
  maxSpeed: number;
  meanSpeed: number;
  /** Mean kinetic energy density Σ|v|²/N. */
  kineticEnergy: number;
  maxAbsPressure: number;
  finite: boolean;
  resolution: number;
}

export class FluidSimulation {
  resolution: number;
  readonly dampingRate: number;
  readonly viscosity: number;
  readonly pressureIterations: number;
  readonly diffusionIterations: number;
  private readonly type: THREE.TextureDataType;
  velocity: PingPong;
  pressure: PingPong;
  private scratch: PingPong;
  divergence: THREE.WebGLRenderTarget;
  private readonly advect: GpuPass;
  private readonly diffuse: GpuPass;
  private readonly forces: GpuPass;
  private readonly divergencePass: GpuPass;
  private readonly pressurePass: GpuPass;
  private readonly gradient: GpuPass;
  private readonly copy: GpuPass;
  private pendingSplats: VelocitySplat[] = [];
  private stirDrive = 0;
  private stirOmega = 0;
  private slosh = new THREE.Vector2();
  private disposed = false;
  /** Number of completed steps (diagnostics). */
  steps = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: FluidOptions = {},
  ) {
    this.resolution = options.resolution ?? 256;
    this.dampingRate = rateFromHalfLife(options.halfLifeSeconds ?? 1.5);
    this.viscosity = options.viscosity ?? 2e-5;
    this.pressureIterations = options.pressureIterations ?? 30;
    this.diffusionIterations = options.diffusionIterations ?? 4;
    this.type = pickFloatType(renderer);
    this.velocity = new PingPong(this.resolution, this.type);
    this.pressure = new PingPong(this.resolution, this.type);
    this.scratch = new PingPong(this.resolution, this.type);
    this.divergence = createFloatTarget(this.resolution, this.type);

    const texel = new THREE.Vector2(1 / this.resolution, 1 / this.resolution);
    this.advect = new GpuPass(renderer, 'fluid-advect', advectFrag, {
      uVelocity: { value: null },
      uSource: { value: null },
      uDt: { value: 0 },
      uDecayRate: { value: this.dampingRate },
      uTexel: { value: texel },
    });
    this.diffuse = new GpuPass(renderer, 'fluid-diffuse', diffuseFrag, {
      uField: { value: null },
      uSource: { value: null },
      uAlpha: { value: 0 },
      uTexel: { value: texel },
    });
    this.forces = new GpuPass(renderer, 'fluid-forces', forcesFrag, {
      uVelocity: { value: null },
      uDt: { value: 0 },
      uStirDrive: { value: 0 },
      uStirOmega: { value: 0 },
      uStirGain: { value: 3.0 },
      uSloshAccel: { value: new THREE.Vector2() },
      uSplatCount: { value: 0 },
      uSplatPos: { value: Array.from({ length: MAX_SPLATS }, () => new THREE.Vector2()) },
      uSplatRadius: { value: new Array<number>(MAX_SPLATS).fill(0.01) },
      uSplatStrength: { value: new Array<number>(MAX_SPLATS).fill(0) },
    });
    this.divergencePass = new GpuPass(renderer, 'fluid-divergence', divergenceFrag, {
      uVelocity: { value: null },
      uTexel: { value: texel },
    });
    this.pressurePass = new GpuPass(renderer, 'fluid-pressure', pressureFrag, {
      uPressure: { value: null },
      uDivergence: { value: null },
      uTexel: { value: texel },
    });
    this.gradient = new GpuPass(renderer, 'fluid-gradient', gradientFrag, {
      uPressure: { value: null },
      uVelocity: { value: null },
      uTexel: { value: texel },
    });
    this.copy = new GpuPass(renderer, 'fluid-copy', copyFrag, { uSource: { value: null } });
    this.clearAll();
  }

  get velocityTexture(): THREE.Texture {
    return this.velocity.read.texture;
  }

  /** Queue a radial impulse (applied on the next step). */
  addSplat(splat: VelocitySplat): void {
    if (this.pendingSplats.length < MAX_SPLATS) this.pendingSplats.push(splat);
    else this.pendingSplats[MAX_SPLATS - 1] = splat;
  }

  /** Set the stirring drive (0..1), target angular speed (rad/s) and slosh acceleration (UV/s²). */
  setStirring(drive: number, omega: number, sloshX: number, sloshY: number): void {
    this.stirDrive = Math.min(1, Math.max(0, drive));
    this.stirOmega = omega;
    this.slosh.set(sloshX, sloshY);
  }

  private clearTarget(target: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
  }

  private clearAll(): void {
    withSimulationState(this.renderer, () => {
      this.clearTarget(this.velocity.read);
      this.clearTarget(this.velocity.write);
      this.clearTarget(this.pressure.read);
      this.clearTarget(this.pressure.write);
      this.clearTarget(this.scratch.read);
      this.clearTarget(this.scratch.write);
      this.clearTarget(this.divergence);
    });
  }

  reset(): void {
    this.pendingSplats = [];
    this.stirDrive = 0;
    this.stirOmega = 0;
    this.slosh.set(0, 0);
    this.steps = 0;
    this.clearAll();
  }

  /** Advance the velocity field by dt seconds (dt is clamped to keep the semi-Lagrangian step stable). */
  step(dtRaw: number): void {
    if (this.disposed) return;
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 20);
    if (dt <= 0) return;
    withSimulationState(this.renderer, () => {
      // 1. Advect velocity by itself with exponential damping.
      this.advect.uniforms.uVelocity.value = this.velocity.read.texture;
      this.advect.uniforms.uSource.value = this.velocity.read.texture;
      this.advect.uniforms.uDt.value = dt;
      this.advect.uniforms.uDecayRate.value = this.dampingRate;
      this.advect.render(this.velocity.write);
      this.velocity.swap();

      // 2. Viscous diffusion (implicit Jacobi) using a dedicated scratch buffer.
      if (this.viscosity > 0 && this.diffusionIterations > 0) {
        const dx = 1 / this.resolution;
        this.diffuse.uniforms.uAlpha.value = (this.viscosity * dt) / (dx * dx);
        this.diffuse.uniforms.uSource.value = this.velocity.read.texture;
        let iterate = this.velocity.read.texture;
        for (let i = 0; i < this.diffusionIterations; i++) {
          this.diffuse.uniforms.uField.value = iterate;
          this.diffuse.render(this.scratch.write);
          this.scratch.swap();
          iterate = this.scratch.read.texture;
        }
        this.copy.uniforms.uSource.value = iterate;
        this.copy.render(this.velocity.write);
        this.velocity.swap();
      }

      // 3. External forces.
      const f = this.forces.uniforms;
      f.uVelocity.value = this.velocity.read.texture;
      f.uDt.value = dt;
      f.uStirDrive.value = this.stirDrive;
      f.uStirOmega.value = this.stirOmega;
      (f.uSloshAccel.value as THREE.Vector2).copy(this.slosh);
      f.uSplatCount.value = this.pendingSplats.length;
      const pos = f.uSplatPos.value as THREE.Vector2[];
      const rad = f.uSplatRadius.value as number[];
      const str = f.uSplatStrength.value as number[];
      for (let i = 0; i < MAX_SPLATS; i++) {
        const s = this.pendingSplats[i];
        if (s) {
          pos[i].set(s.u, s.v);
          rad[i] = s.radius;
          str[i] = s.strength;
        } else {
          rad[i] = 0.01;
          str[i] = 0;
        }
      }
      this.pendingSplats = [];
      this.forces.render(this.velocity.write);
      this.velocity.swap();

      // 4. Divergence.
      this.divergencePass.uniforms.uVelocity.value = this.velocity.read.texture;
      this.divergencePass.render(this.divergence);

      // 5. Pressure Jacobi iterations (warm-started from the previous pressure).
      this.pressurePass.uniforms.uDivergence.value = this.divergence.texture;
      for (let i = 0; i < this.pressureIterations; i++) {
        this.pressurePass.uniforms.uPressure.value = this.pressure.read.texture;
        this.pressurePass.render(this.pressure.write);
        this.pressure.swap();
      }

      // 6. Projection.
      this.gradient.uniforms.uPressure.value = this.pressure.read.texture;
      this.gradient.uniforms.uVelocity.value = this.velocity.read.texture;
      this.gradient.render(this.velocity.write);
      this.velocity.swap();
    });
    this.steps++;
  }

  /** Change the grid resolution, resampling the current fields. */
  resize(resolution: number): void {
    if (resolution === this.resolution || this.disposed) return;
    const newVelocity = new PingPong(resolution, this.type);
    const newPressure = new PingPong(resolution, this.type);
    const newScratch = new PingPong(resolution, this.type);
    const newDivergence = createFloatTarget(resolution, this.type);
    withSimulationState(this.renderer, () => {
      this.copy.uniforms.uSource.value = this.velocity.read.texture;
      this.copy.render(newVelocity.read);
      this.copy.uniforms.uSource.value = this.pressure.read.texture;
      this.copy.render(newPressure.read);
      this.clearTarget(newVelocity.write);
      this.clearTarget(newPressure.write);
      this.clearTarget(newScratch.read);
      this.clearTarget(newScratch.write);
      this.clearTarget(newDivergence);
    });
    this.velocity.dispose();
    this.pressure.dispose();
    this.scratch.dispose();
    this.divergence.dispose();
    this.velocity = newVelocity;
    this.pressure = newPressure;
    this.scratch = newScratch;
    this.divergence = newDivergence;
    this.resolution = resolution;
    const texel = new THREE.Vector2(1 / resolution, 1 / resolution);
    for (const pass of [this.advect, this.diffuse, this.divergencePass, this.pressurePass, this.gradient]) {
      (pass.uniforms.uTexel.value as THREE.Vector2).copy(texel);
    }
  }

  /** Read back the velocity field (RGBA floats; x, y = velocity). Expensive — for tests/diagnostics. */
  readVelocity(): Float32Array {
    return this.readTarget(this.velocity.read);
  }

  readPressure(): Float32Array {
    return this.readTarget(this.pressure.read);
  }

  readTarget(target: THREE.WebGLRenderTarget): Float32Array {
    const n = target.width * target.height * 4;
    if (this.type === THREE.FloatType) {
      const out = new Float32Array(n);
      this.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, out);
      return out;
    }
    const half = new Uint16Array(n);
    this.renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, half);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = THREE.DataUtils.fromHalfFloat(half[i]);
    return out;
  }

  stats(): FluidStats {
    const v = this.readVelocity();
    const p = this.readPressure();
    let maxSpeed = 0;
    let sum = 0;
    let energy = 0;
    let finite = true;
    let maxP = 0;
    const count = v.length / 4;
    for (let i = 0; i < count; i++) {
      const vx = v[i * 4];
      const vy = v[i * 4 + 1];
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) finite = false;
      const s = Math.hypot(vx, vy);
      maxSpeed = Math.max(maxSpeed, s);
      sum += s;
      energy += vx * vx + vy * vy;
      const pp = p[i * 4];
      if (!Number.isFinite(pp)) finite = false;
      maxP = Math.max(maxP, Math.abs(pp));
    }
    return { maxSpeed, meanSpeed: sum / count, kineticEnergy: energy / count, maxAbsPressure: maxP, finite, resolution: this.resolution };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.velocity.dispose();
    this.pressure.dispose();
    this.scratch.dispose();
    this.divergence.dispose();
    for (const pass of [this.advect, this.diffuse, this.forces, this.divergencePass, this.pressurePass, this.gradient, this.copy]) {
      pass.dispose();
    }
  }
}

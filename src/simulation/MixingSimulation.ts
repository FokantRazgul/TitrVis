/**
 * GPU mixing scalar field: the local fraction of freshly added titrant (0 = fully mixed bulk,
 * 1 = pure fresh titrant). It is advected by the fluid velocity, diffuses (implicit Jacobi),
 * receives Gaussian injections at drop impacts, and relaxes towards 0 with a mixing rate
 * that increases while stirring — representing homogenisation into the bulk, whose exact
 * composition is tracked by the chemistry engine. This field is a visual proxy only.
 */

import * as THREE from 'three';
import advectFrag from '../shaders/fluid/advect.frag.glsl?raw';
import copyFrag from '../shaders/fluid/copy.frag.glsl?raw';
import diffuseFrag from '../shaders/fluid/diffuse.frag.glsl?raw';
import splatFrag from '../shaders/mixing/splat.frag.glsl?raw';
import { GpuPass, PingPong, pickFloatType, withSimulationState } from './gpu/GpuPass';
import { MAX_SPLATS } from './FluidSimulation';

export interface MixingOptions {
  resolution?: number;
  /** Scalar diffusivity in UV²/s. */
  diffusivity?: number;
  diffusionIterations?: number;
  /** Relaxation rate towards the bulk when at rest (1/s). */
  restMixingRate?: number;
  /** Relaxation rate towards the bulk while stirring at full drive (1/s). */
  stirMixingRate?: number;
}

export interface ScalarSplat {
  u: number;
  v: number;
  radius: number;
  amount: number;
}

export interface MixingStats {
  mean: number;
  max: number;
  finite: boolean;
}

export class MixingSimulation {
  resolution: number;
  readonly diffusivity: number;
  readonly diffusionIterations: number;
  readonly restMixingRate: number;
  readonly stirMixingRate: number;
  private readonly type: THREE.TextureDataType;
  field: PingPong;
  private scratch: PingPong;
  private readonly advect: GpuPass;
  private readonly diffuse: GpuPass;
  private readonly splat: GpuPass;
  private readonly copy: GpuPass;
  private pending: ScalarSplat[] = [];
  private stirDrive = 0;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: MixingOptions = {},
  ) {
    this.resolution = options.resolution ?? 256;
    this.diffusivity = options.diffusivity ?? 4e-5;
    this.diffusionIterations = options.diffusionIterations ?? 3;
    this.restMixingRate = options.restMixingRate ?? 1 / 6;
    this.stirMixingRate = options.stirMixingRate ?? 1 / 1.2;
    this.type = pickFloatType(renderer);
    this.field = new PingPong(this.resolution, this.type);
    this.scratch = new PingPong(this.resolution, this.type);
    const texel = new THREE.Vector2(1 / this.resolution, 1 / this.resolution);
    this.advect = new GpuPass(renderer, 'mixing-advect', advectFrag, {
      uVelocity: { value: null },
      uSource: { value: null },
      uDt: { value: 0 },
      uDecayRate: { value: this.restMixingRate },
      uTexel: { value: texel },
    });
    this.diffuse = new GpuPass(renderer, 'mixing-diffuse', diffuseFrag, {
      uField: { value: null },
      uSource: { value: null },
      uAlpha: { value: 0 },
      uTexel: { value: texel },
    });
    this.splat = new GpuPass(renderer, 'mixing-splat', splatFrag, {
      uTarget: { value: null },
      uSplatCount: { value: 0 },
      uSplatPos: { value: Array.from({ length: MAX_SPLATS }, () => new THREE.Vector2()) },
      uSplatRadius: { value: new Array<number>(MAX_SPLATS).fill(0.01) },
      uSplatAmount: { value: new Array<number>(MAX_SPLATS).fill(0) },
    });
    this.copy = new GpuPass(renderer, 'mixing-copy', copyFrag, { uSource: { value: null } });
    this.clearAll();
  }

  get texture(): THREE.Texture {
    return this.field.read.texture;
  }

  inject(splat: ScalarSplat): void {
    if (this.pending.length < MAX_SPLATS) this.pending.push(splat);
    else this.pending[MAX_SPLATS - 1] = splat;
  }

  setStirDrive(drive: number): void {
    this.stirDrive = Math.min(1, Math.max(0, drive));
  }

  private clearTarget(target: THREE.WebGLRenderTarget): void {
    this.renderer.setRenderTarget(target);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.clear(true, false, false);
  }

  private clearAll(): void {
    withSimulationState(this.renderer, () => {
      this.clearTarget(this.field.read);
      this.clearTarget(this.field.write);
      this.clearTarget(this.scratch.read);
      this.clearTarget(this.scratch.write);
    });
  }

  reset(): void {
    this.pending = [];
    this.stirDrive = 0;
    this.clearAll();
  }

  step(dtRaw: number, velocity: THREE.Texture): void {
    if (this.disposed) return;
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 20);
    if (dt <= 0) return;
    withSimulationState(this.renderer, () => {
      // Injection first so that a fresh drop is visible in the same frame as its impact.
      if (this.pending.length > 0) {
        const u = this.splat.uniforms;
        u.uTarget.value = this.field.read.texture;
        u.uSplatCount.value = this.pending.length;
        const pos = u.uSplatPos.value as THREE.Vector2[];
        const rad = u.uSplatRadius.value as number[];
        const amt = u.uSplatAmount.value as number[];
        for (let i = 0; i < MAX_SPLATS; i++) {
          const s = this.pending[i];
          if (s) {
            pos[i].set(s.u, s.v);
            rad[i] = s.radius;
            amt[i] = s.amount;
          } else {
            rad[i] = 0.01;
            amt[i] = 0;
          }
        }
        this.pending = [];
        this.splat.render(this.field.write);
        this.field.swap();
      }

      // Advection with mixing relaxation.
      const rate = this.restMixingRate + (this.stirMixingRate - this.restMixingRate) * this.stirDrive;
      this.advect.uniforms.uVelocity.value = velocity;
      this.advect.uniforms.uSource.value = this.field.read.texture;
      this.advect.uniforms.uDt.value = dt;
      this.advect.uniforms.uDecayRate.value = rate;
      this.advect.render(this.field.write);
      this.field.swap();

      // Diffusion (implicit Jacobi).
      if (this.diffusivity > 0 && this.diffusionIterations > 0) {
        const dx = 1 / this.resolution;
        this.diffuse.uniforms.uAlpha.value = (this.diffusivity * dt) / (dx * dx);
        this.diffuse.uniforms.uSource.value = this.field.read.texture;
        let iterate = this.field.read.texture;
        for (let i = 0; i < this.diffusionIterations; i++) {
          this.diffuse.uniforms.uField.value = iterate;
          this.diffuse.render(this.scratch.write);
          this.scratch.swap();
          iterate = this.scratch.read.texture;
        }
        this.copy.uniforms.uSource.value = iterate;
        this.copy.render(this.field.write);
        this.field.swap();
      }
    });
  }

  resize(resolution: number): void {
    if (resolution === this.resolution || this.disposed) return;
    const newField = new PingPong(resolution, this.type);
    const newScratch = new PingPong(resolution, this.type);
    withSimulationState(this.renderer, () => {
      this.copy.uniforms.uSource.value = this.field.read.texture;
      this.copy.render(newField.read);
      this.clearTarget(newField.write);
      this.clearTarget(newScratch.read);
      this.clearTarget(newScratch.write);
    });
    this.field.dispose();
    this.scratch.dispose();
    this.field = newField;
    this.scratch = newScratch;
    this.resolution = resolution;
    const texel = new THREE.Vector2(1 / resolution, 1 / resolution);
    (this.advect.uniforms.uTexel.value as THREE.Vector2).copy(texel);
    (this.diffuse.uniforms.uTexel.value as THREE.Vector2).copy(texel);
  }

  read(): Float32Array {
    const target = this.field.read;
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

  stats(): MixingStats {
    const data = this.read();
    let sum = 0;
    let max = 0;
    let finite = true;
    const count = data.length / 4;
    for (let i = 0; i < count; i++) {
      const s = data[i * 4];
      if (!Number.isFinite(s)) finite = false;
      sum += s;
      if (s > max) max = s;
    }
    return { mean: sum / count, max, finite };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.field.dispose();
    this.scratch.dispose();
    for (const pass of [this.advect, this.diffuse, this.splat, this.copy]) pass.dispose();
  }
}

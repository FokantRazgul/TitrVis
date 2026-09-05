/**
 * GPU volumetric mixing scalar: the local fraction of freshly added titrant (0 = fully mixed
 * bulk, 1 = pure fresh titrant) on a 3-D grid of the liquid. The volume is stored as
 * VOLUME_SLICES horizontal slices tiled into one 2-D float atlas so that every pass is a single
 * full-screen draw and the liquid shader can ray-march it directly.
 *
 * Per step: sphere injections at drop impacts → 3-D semi-Lagrangian advection (horizontal flow
 * from the 2-D Stable-Fluids solver, vertical/radial flow from analytic drop vortex rings with
 * floor images, settling of the denser titrant) with relaxation towards the bulk and
 * entrainment dilution → implicit 6-neighbour diffusion. The field is a visual proxy only; the
 * bulk composition is tracked by the chemistry engine.
 */

import * as THREE from 'three';
import copyFrag from '../shaders/fluid/copy.frag.glsl?raw';
import advectFrag from '../shaders/mixing/advect3d.frag.glsl?raw';
import diffuseFrag from '../shaders/mixing/diffuse3d.frag.glsl?raw';
import splatFrag from '../shaders/mixing/splat3d.frag.glsl?raw';
import volumeGlsl from '../shaders/mixing/volume.glsl?raw';
import { GpuPass, PingPong, pickFloatType, withSimulationState } from './gpu/GpuPass';
import { MAX_SPLATS } from './FluidSimulation';
import { advanceRing, ringDilutionRate, ringFromImpact, type VortexRing } from './vortexRing';

/** Must match VOL_SLICES / VOL_TILES_X / VOL_TILES_Y in shaders/mixing/volume.glsl. */
export const VOLUME_SLICES = 12;
export const VOLUME_TILES_X = 4;
export const VOLUME_TILES_Y = 3;
export const MAX_RINGS = 8;

export interface MixingOptions {
  /** Fluid-solver resolution; the volume uses half of it per tile (min 32). */
  resolution?: number;
  /** Eddy diffusivity of the scalar (m²/s). */
  diffusivity?: number;
  diffusionIterations?: number;
  /** Relaxation rate towards the bulk when at rest (1/s). */
  restMixingRate?: number;
  /** Relaxation rate towards the bulk while stirring at full drive (1/s). */
  stirMixingRate?: number;
  /** Downward drift of titrant-rich fluid at scalar = 1 (m/s). */
  settlingSpeed?: number;
}

/** Legacy/diagnostic injection in volume UV: a sphere just under the surface. */
export interface ScalarSplat {
  u: number;
  v: number;
  /** Radius in volume UV (fraction of 2 × reference radius). */
  radius: number;
  amount: number;
}

export interface DropInjection {
  /** Impact position relative to the flask axis (m). */
  x: number;
  z: number;
  /** Free-surface height (m above the floor). */
  surfaceY: number;
  dropRadius: number;
  /** Impact speed (m/s). */
  speed: number;
}

interface SphereSplat {
  x: number;
  y: number;
  z: number;
  radius: number;
  amount: number;
}

export interface MixingGeometry {
  /** Liquid height (m). */
  height: number;
  /** Reference (largest) liquid radius (m); volume u/v span twice this. */
  refRadius: number;
  /** Free-surface radius / refRadius. */
  radiusTop: number;
  /** Floor radius / refRadius. */
  radiusBottom: number;
}

export interface MixingStats {
  mean: number;
  max: number;
  finite: boolean;
  /** Mean scalar per slice, floor first. */
  sliceMeans: number[];
}

/** Largest back-trace per advection sub-step (m); fast rings are sub-stepped. */
const MAX_RING_STEP_M = 0.003;
const MAX_SUB_STEPS = 3;

export class MixingSimulation {
  /** Tile (per-slice) resolution. */
  tileResolution: number;
  readonly diffusivity: number;
  readonly diffusionIterations: number;
  readonly restMixingRate: number;
  readonly stirMixingRate: number;
  readonly settlingSpeed: number;
  readonly geometry: MixingGeometry = { height: 0.012, refRadius: 0.04, radiusTop: 0.95, radiusBottom: 0.88 };
  rings: VortexRing[] = [];
  private readonly type: THREE.TextureDataType;
  field: PingPong;
  private scratch: PingPong;
  private readonly advect: GpuPass;
  private readonly diffuse: GpuPass;
  private readonly splat: GpuPass;
  private readonly copy: GpuPass;
  private pending: SphereSplat[] = [];
  private stirDrive = 0;
  private disposed = false;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: MixingOptions = {},
  ) {
    this.tileResolution = MixingSimulation.tileFor(options.resolution ?? 256);
    this.diffusivity = options.diffusivity ?? 3e-7;
    this.diffusionIterations = options.diffusionIterations ?? 2;
    this.restMixingRate = options.restMixingRate ?? 1 / 10;
    this.stirMixingRate = options.stirMixingRate ?? 1 / 1.2;
    this.settlingSpeed = options.settlingSpeed ?? 0.002;
    this.type = pickFloatType(renderer);
    this.field = this.createAtlas(this.tileResolution);
    this.scratch = this.createAtlas(this.tileResolution);
    const geometryUniforms = () => ({
      uHeight: { value: this.geometry.height },
      uRefRadius: { value: this.geometry.refRadius },
      uRadiusTop: { value: this.geometry.radiusTop },
      uRadiusBottom: { value: this.geometry.radiusBottom },
    });
    this.advect = new GpuPass(renderer, 'mixing-advect3d', `${volumeGlsl}\n${advectFrag}`, {
      uVelocity: { value: null },
      uSource: { value: null },
      uDt: { value: 0 },
      uDecayRate: { value: this.restMixingRate },
      uTileTexel: { value: 1 / this.tileResolution },
      uSettling: { value: this.settlingSpeed },
      uRingCount: { value: 0 },
      uRingCentre: { value: Array.from({ length: MAX_RINGS }, () => new THREE.Vector3()) },
      uRingRadius: { value: new Array<number>(MAX_RINGS).fill(0.001) },
      uRingSpeed: { value: new Array<number>(MAX_RINGS).fill(0) },
      uRingDilution: { value: new Array<number>(MAX_RINGS).fill(0) },
      ...geometryUniforms(),
    });
    this.diffuse = new GpuPass(renderer, 'mixing-diffuse3d', `${volumeGlsl}\n${diffuseFrag}`, {
      uField: { value: null },
      uSource: { value: null },
      uAlphaH: { value: 0 },
      uAlphaV: { value: 0 },
      uTileTexel: { value: 1 / this.tileResolution },
      uRadiusTop: { value: this.geometry.radiusTop },
      uRadiusBottom: { value: this.geometry.radiusBottom },
    });
    this.splat = new GpuPass(renderer, 'mixing-splat3d', `${volumeGlsl}\n${splatFrag}`, {
      uTarget: { value: null },
      uSplatCount: { value: 0 },
      uSplatPos: { value: Array.from({ length: MAX_SPLATS }, () => new THREE.Vector3()) },
      uSplatRadius: { value: new Array<number>(MAX_SPLATS).fill(0.001) },
      uSplatAmount: { value: new Array<number>(MAX_SPLATS).fill(0) },
      ...geometryUniforms(),
    });
    this.copy = new GpuPass(renderer, 'mixing-copy', copyFrag, { uSource: { value: null } });
    this.clearAll();
  }

  static tileFor(fluidResolution: number): number {
    return Math.max(32, Math.round(fluidResolution / 2));
  }

  private createAtlas(tile: number): PingPong {
    return new PingPong(tile * VOLUME_TILES_X, this.type, tile * VOLUME_TILES_Y);
  }

  get texture(): THREE.Texture {
    return this.field.read.texture;
  }

  get slices(): number {
    return VOLUME_SLICES;
  }

  /** Fluid-solver resolution equivalent (for callers that think in fluid grid sizes). */
  get resolution(): number {
    return this.tileResolution * 2;
  }

  setGeometry(geometry: MixingGeometry): void {
    this.geometry.height = Math.max(1e-3, geometry.height);
    this.geometry.refRadius = Math.max(1e-3, geometry.refRadius);
    this.geometry.radiusTop = Math.min(1, Math.max(0.05, geometry.radiusTop));
    this.geometry.radiusBottom = Math.min(1, Math.max(0.05, geometry.radiusBottom));
  }

  /** Diagnostic injection in volume UV (sphere of the given UV radius just under the surface). */
  inject(splat: ScalarSplat): void {
    const g = this.geometry;
    const radius = splat.radius * 2 * g.refRadius;
    this.pushSplat({
      x: (splat.u - 0.5) * 2 * g.refRadius,
      y: Math.max(g.height - radius, 0.5 * radius),
      z: -(splat.v - 0.5) * 2 * g.refRadius,
      radius,
      amount: splat.amount,
    });
  }

  /** A drop has hit the surface: start its vortex ring and fill the ring sphere with titrant. */
  injectDrop(drop: DropInjection): void {
    const ring = ringFromImpact(drop.x, drop.z, drop.surfaceY, drop.dropRadius, drop.speed);
    if (this.rings.length >= MAX_RINGS) this.rings.shift();
    this.rings.push(ring);
    this.pushSplat({ x: ring.x, y: ring.y, z: ring.z, radius: ring.a, amount: 1 });
  }

  private pushSplat(splat: SphereSplat): void {
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
    this.rings = [];
    this.stirDrive = 0;
    this.clearAll();
  }

  private applyGeometry(pass: GpuPass, withHeight: boolean): void {
    const u = pass.uniforms;
    u.uRadiusTop.value = this.geometry.radiusTop;
    u.uRadiusBottom.value = this.geometry.radiusBottom;
    if (withHeight) {
      u.uHeight.value = this.geometry.height;
      u.uRefRadius.value = this.geometry.refRadius;
    }
  }

  private uploadRings(): void {
    const u = this.advect.uniforms;
    u.uRingCount.value = this.rings.length;
    const centre = u.uRingCentre.value as THREE.Vector3[];
    const radius = u.uRingRadius.value as number[];
    const speed = u.uRingSpeed.value as number[];
    const dilution = u.uRingDilution.value as number[];
    for (let i = 0; i < MAX_RINGS; i++) {
      const ring = this.rings[i];
      if (ring) {
        centre[i].set(ring.x, ring.y, ring.z);
        radius[i] = ring.a;
        speed[i] = ring.U;
        dilution[i] = ringDilutionRate(ring);
      } else {
        radius[i] = 0.001;
        speed[i] = 0;
        dilution[i] = 0;
      }
    }
  }

  step(dtRaw: number, velocity: THREE.Texture): void {
    if (this.disposed) return;
    const dt = Math.min(Math.max(dtRaw, 0), 1 / 20);
    if (dt <= 0) return;
    withSimulationState(this.renderer, () => {
      // Injection first so that a fresh drop is visible in the same frame as its impact.
      if (this.pending.length > 0) {
        const u = this.splat.uniforms;
        this.applyGeometry(this.splat, true);
        u.uTarget.value = this.field.read.texture;
        u.uSplatCount.value = this.pending.length;
        const pos = u.uSplatPos.value as THREE.Vector3[];
        const rad = u.uSplatRadius.value as number[];
        const amt = u.uSplatAmount.value as number[];
        for (let i = 0; i < MAX_SPLATS; i++) {
          const s = this.pending[i];
          if (s) {
            pos[i].set(s.x, s.y, s.z);
            rad[i] = s.radius;
            amt[i] = s.amount;
          } else {
            rad[i] = 0.001;
            amt[i] = 0;
          }
        }
        this.pending = [];
        this.splat.render(this.field.write);
        this.field.swap();
      }

      // Advection (sub-stepped while fast rings are active) with relaxation towards the bulk.
      const rate = this.restMixingRate + (this.stirMixingRate - this.restMixingRate) * this.stirDrive;
      const maxSpeed = this.rings.reduce((m, r) => Math.max(m, 2.5 * r.U), 0);
      const subSteps = Math.min(MAX_SUB_STEPS, Math.max(1, Math.ceil((maxSpeed * dt) / MAX_RING_STEP_M)));
      const subDt = dt / subSteps;
      this.applyGeometry(this.advect, true);
      this.advect.uniforms.uVelocity.value = velocity;
      this.advect.uniforms.uDecayRate.value = rate;
      this.advect.uniforms.uDt.value = subDt;
      for (let s = 0; s < subSteps; s++) {
        this.rings = this.rings.filter((ring) => advanceRing(ring, subDt));
        this.uploadRings();
        this.advect.uniforms.uSource.value = this.field.read.texture;
        this.advect.render(this.field.write);
        this.field.swap();
      }

      // Diffusion (implicit Jacobi, 6 neighbours).
      if (this.diffusivity > 0 && this.diffusionIterations > 0) {
        const dx = (2 * this.geometry.refRadius) / this.tileResolution;
        const dz = this.geometry.height / VOLUME_SLICES;
        this.applyGeometry(this.diffuse, false);
        this.diffuse.uniforms.uAlphaH.value = (this.diffusivity * dt) / (dx * dx);
        this.diffuse.uniforms.uAlphaV.value = (this.diffusivity * dt) / (dz * dz);
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

  /** Change the fluid-solver resolution; the volume tile follows and the field is resampled. */
  resize(fluidResolution: number): void {
    const tile = MixingSimulation.tileFor(fluidResolution);
    if (tile === this.tileResolution || this.disposed) return;
    const newField = this.createAtlas(tile);
    const newScratch = this.createAtlas(tile);
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
    this.tileResolution = tile;
    this.advect.uniforms.uTileTexel.value = 1 / tile;
    this.diffuse.uniforms.uTileTexel.value = 1 / tile;
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
    const width = this.field.read.width;
    const tile = this.tileResolution;
    const sliceSums = new Array<number>(VOLUME_SLICES).fill(0);
    let sum = 0;
    let max = 0;
    let finite = true;
    const count = data.length / 4;
    for (let i = 0; i < count; i++) {
      const s = data[i * 4];
      if (!Number.isFinite(s)) finite = false;
      sum += s;
      if (s > max) max = s;
      const px = i % width;
      const py = Math.floor(i / width);
      const k = Math.floor(py / tile) * VOLUME_TILES_X + Math.floor(px / tile);
      if (k < VOLUME_SLICES) sliceSums[k] += s;
    }
    const perSlice = tile * tile;
    return { mean: sum / count, max, finite, sliceMeans: sliceSums.map((v) => v / perSlice) };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.field.dispose();
    this.scratch.dispose();
    for (const pass of [this.advect, this.diffuse, this.splat, this.copy]) pass.dispose();
  }
}

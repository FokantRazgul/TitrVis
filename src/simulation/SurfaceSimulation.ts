/**
 * Deformable liquid surface: linear shallow-water sloshing on an N×N height grid covering the
 * circular surface of the liquid.
 *
 * The total surface height is h = h_eq + η, where h_eq is the quasi-static shape imposed by the
 * flask's motion (the surface stays level in the world while the flask tilts, climbs the outer
 * wall under the orbital acceleration a/g, and takes the paraboloid ω²r²/2g of the bulk swirl)
 * and η is the dynamic deviation obeying the forced damped wave equation
 *
 *     ∂²η/∂t² = c² ∇²η − k ∂η/∂t − ∂²h_eq/∂t²,      c = √(g·depth),  ∂η/∂n = 0 at the wall,
 *
 * which is the linear shallow-water problem in the container frame written for the deviation
 * from the instantaneous equilibrium (a uniformly accelerating container forces the free
 * surface only through the wall condition, equivalently through −ḧ_eq on η). Swirling at
 * 2.5 Hz drives a ≈1 cm layer close to its first sloshing mode (≈2.2 Hz for R = 4 cm), which is
 * why a hand-swirled flask develops a large rotating wave; the linear model is capped at
 * 80 % of the depth to stand in for the nonlinear saturation of a real wave. Explicit
 * integration with CFL-safe sub-stepping (c·dt/dx ≤ 0.5). Drop impacts add a Gaussian
 * depression to η. Normals are computed from the height gradient.
 */

import { clamp } from '../utils/math';

export interface SurfaceOptions {
  resolution?: number;
  /** Wave speed (m/s). */
  waveSpeed?: number;
  /** Velocity damping rate (1/s). */
  damping?: number;
}

export class SurfaceSimulation {
  readonly n: number;
  radius: number;
  /** Total height above the flat rest level (m) = equilibrium + deviation, row-major, size n*n. */
  readonly height: Float32Array;
  /** Dynamic deviation η from the equilibrium shape (m). */
  readonly deviation: Float32Array;
  /** ∂η/∂t (m/s). */
  readonly velocity: Float32Array;
  /** Equilibrium height h_eq (level surface in the world + slosh slope + paraboloid), size n*n. */
  private readonly rest: Float32Array;
  private readonly prevRest: Float32Array;
  private readonly restVelocity: Float32Array;
  private readonly restAccel: Float32Array;
  /** Liquid depth (m): sets the shallow-water wave speed and the saturation amplitude. */
  private depth: number;
  /** Surface normals (xyz interleaved), size n*n*3. */
  readonly normals: Float32Array;
  /** 1 inside the liquid disc, 0 outside. */
  readonly mask: Uint8Array;
  private waveSpeed: number;
  private readonly fixedWaveSpeed: boolean;
  private readonly damping: number;
  private time = 0;

  constructor(radius: number, options: SurfaceOptions = {}) {
    this.n = options.resolution ?? 64;
    this.radius = radius;
    this.fixedWaveSpeed = options.waveSpeed !== undefined;
    this.waveSpeed = options.waveSpeed ?? 0.35;
    this.depth = (this.waveSpeed * this.waveSpeed) / SurfaceSimulation.G;
    this.damping = options.damping ?? 2.5;
    const size = this.n * this.n;
    this.height = new Float32Array(size);
    this.deviation = new Float32Array(size);
    this.velocity = new Float32Array(size);
    this.rest = new Float32Array(size);
    this.prevRest = new Float32Array(size);
    this.restVelocity = new Float32Array(size);
    this.restAccel = new Float32Array(size);
    this.normals = new Float32Array(size * 3);
    this.mask = new Uint8Array(size);
    this.rebuildMask();
    this.computeNormals();
  }

  static readonly G = 9.81;
  /** Deviation cap as a fraction of the depth (nonlinear saturation stand-in). */
  static readonly SATURATION = 0.8;

  /** Set the liquid depth (m): wave speed √(g·depth) unless fixed by options, and the cap on η. */
  setDepth(depth: number): void {
    this.depth = Math.max(1e-3, depth);
    if (!this.fixedWaveSpeed) this.waveSpeed = clamp(Math.sqrt(SurfaceSimulation.G * this.depth), 0.12, 0.7);
  }

  /** Current wave speed (m/s). */
  get speed(): number {
    return this.waveSpeed;
  }

  /** Grid spacing (m). */
  get dx(): number {
    return (2 * this.radius) / (this.n - 1);
  }

  private rebuildMask(): void {
    const n = this.n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -1 + (2 * i) / (n - 1);
        const z = -1 + (2 * j) / (n - 1);
        this.mask[j * n + i] = x * x + z * z <= 1.0001 ? 1 : 0;
      }
    }
  }

  setRadius(radius: number): void {
    if (radius !== this.radius) {
      this.radius = radius;
      this.rebuildMask();
    }
  }

  reset(): void {
    this.height.fill(0);
    this.deviation.fill(0);
    this.velocity.fill(0);
    this.rest.fill(0);
    this.prevRest.fill(0);
    this.restVelocity.fill(0);
    this.restAccel.fill(0);
    this.time = 0;
    this.computeNormals();
  }

  /** Grid coordinates of a world-relative surface point (metres from the centre). */
  private toGrid(xRel: number, zRel: number): [number, number] {
    const n = this.n;
    return [((xRel / this.radius + 1) * 0.5) * (n - 1), ((zRel / this.radius + 1) * 0.5) * (n - 1)];
  }

  /** Height (m) at a point relative to the surface centre (bilinear). */
  heightAt(xRel: number, zRel: number): number {
    const [gx, gz] = this.toGrid(xRel, zRel);
    const n = this.n;
    const i = clamp(Math.floor(gx), 0, n - 2);
    const j = clamp(Math.floor(gz), 0, n - 2);
    const tx = clamp(gx - i, 0, 1);
    const tz = clamp(gz - j, 0, 1);
    const h00 = this.height[j * n + i];
    const h10 = this.height[j * n + i + 1];
    const h01 = this.height[(j + 1) * n + i];
    const h11 = this.height[(j + 1) * n + i + 1];
    return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
  }

  /**
   * Add a drop impact: Gaussian depression whose volume matches the drop volume (m³) scaled
   * by the impact speed, plus a downward velocity kick. `sigma` is the crater radius.
   */
  addImpact(xRel: number, zRel: number, dropRadius: number, speed: number): void {
    const n = this.n;
    const [gx, gz] = this.toGrid(xRel, zRel);
    const sigma = Math.max(2.2, (dropRadius * 3.5) / this.dx);
    const depth = Math.min(0.006, dropRadius * (1.2 + 0.4 * Math.min(speed, 3)));
    const reach = Math.ceil(sigma * 3);
    for (let j = Math.max(0, Math.floor(gz - reach)); j <= Math.min(n - 1, Math.ceil(gz + reach)); j++) {
      for (let i = Math.max(0, Math.floor(gx - reach)); i <= Math.min(n - 1, Math.ceil(gx + reach)); i++) {
        const idx = j * n + i;
        if (!this.mask[idx]) continue;
        const d2 = (i - gx) * (i - gx) + (j - gz) * (j - gz);
        const w = Math.exp(-d2 / (2 * sigma * sigma));
        this.deviation[idx] -= depth * w;
        this.velocity[idx] -= depth * 6 * w;
      }
    }
    // The liquid is incompressible: the displaced volume must appear elsewhere on the surface.
    this.removeMean(this.deviation);
    this.removeMean(this.velocity);
    this.composeHeight();
  }

  /** h = h_eq + η inside the liquid disc. */
  private composeHeight(): void {
    for (let idx = 0; idx < this.height.length; idx++) this.height[idx] = this.mask[idx] ? this.rest[idx] + this.deviation[idx] : 0;
  }

  /** Subtract the mean over the liquid disc (volume/flux conservation of an incompressible liquid). */
  private removeMean(field: Float32Array): void {
    let sum = 0;
    let cells = 0;
    for (let idx = 0; idx < field.length; idx++) {
      if (!this.mask[idx]) continue;
      sum += field[idx];
      cells++;
    }
    if (cells === 0) return;
    const mean = sum / cells;
    for (let idx = 0; idx < field.length; idx++) if (this.mask[idx]) field[idx] -= mean;
  }

  /**
   * Set the equilibrium surface shape from the bulk swirl (rad/s) and a surface slope vector in
   * flask-local coordinates (dimensionless; level-in-the-world compensation of the flask tilt
   * plus the orbital acceleration a/g, see `equilibriumSlope`):
   *   h_eq(x, z) = ω² r² / (2g) − mean + slopeX·x + slopeZ·z
   * The mean of the paraboloid over the disc (ω²R²/4g) is subtracted so the volume is conserved.
   * Call once per simulation step; `step` differentiates the history to obtain ḧ_eq.
   */
  setEquilibriumSlope(swirl: number, slopeX: number, slopeZ: number): void {
    const n = this.n;
    const g = SurfaceSimulation.G;
    const w2 = swirl * swirl;
    const mean = (w2 * this.radius * this.radius) / (4 * g);
    const sx = clamp(slopeX, -0.5, 0.5);
    const sz = clamp(slopeZ, -0.5, 0.5);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        if (!this.mask[idx]) {
          this.rest[idx] = 0;
          continue;
        }
        const x = (-1 + (2 * i) / (n - 1)) * this.radius;
        const z = (-1 + (2 * j) / (n - 1)) * this.radius;
        this.rest[idx] = (w2 * (x * x + z * z)) / (2 * g) - mean + sx * x + sz * z;
      }
    }
  }

  /** Advance the forced wave equation for η by dt seconds with CFL-safe sub-steps. */
  step(dtInput: number): void {
    let dt = dtInput;
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    // Long gaps (tab hidden) are clamped: the surface simply settles.
    dt = Math.min(dt, 0.1);
    const n = this.n;
    const size = n * n;
    // Inertial forcing −ḧ_eq from the equilibrium history (second difference over the step).
    for (let idx = 0; idx < size; idx++) {
      const v = (this.rest[idx] - this.prevRest[idx]) / dt;
      this.restAccel[idx] = (v - this.restVelocity[idx]) / dt;
      this.restVelocity[idx] = v;
      this.prevRest[idx] = this.rest[idx];
    }
    const dx = this.dx;
    const c = this.waveSpeed;
    const maxDt = (0.5 * dx) / c;
    const steps = Math.max(1, Math.ceil(dt / maxDt));
    const h = dt / steps;
    const c2 = (c * c) / (dx * dx);
    const damp = Math.exp(-this.damping * h);
    const cap = Math.max(0.002, Math.min(SurfaceSimulation.SATURATION * this.depth, 0.03));
    for (let s = 0; s < steps; s++) {
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) {
          const idx = j * n + i;
          if (!this.mask[idx]) continue;
          const center = this.deviation[idx];
          // Neumann boundary: outside-mask neighbours mirror the centre value.
          const l = this.mask[idx - 1] ? this.deviation[idx - 1] : center;
          const r = this.mask[idx + 1] ? this.deviation[idx + 1] : center;
          const u = this.mask[idx - n] ? this.deviation[idx - n] : center;
          const d = this.mask[idx + n] ? this.deviation[idx + n] : center;
          const lap = l + r + u + d - 4 * center;
          this.velocity[idx] = (this.velocity[idx] + (c2 * lap - this.restAccel[idx]) * h) * damp;
        }
      }
      for (let idx = 0; idx < size; idx++) {
        if (!this.mask[idx]) continue;
        let eta = this.deviation[idx] + this.velocity[idx] * h;
        // Saturation: a linear wave cannot exceed the layer it lives in.
        if (eta > cap) {
          eta = cap;
          if (this.velocity[idx] > 0) this.velocity[idx] *= 0.5;
        } else if (eta < -cap) {
          eta = -cap;
          if (this.velocity[idx] < 0) this.velocity[idx] *= 0.5;
        }
        this.deviation[idx] = eta;
      }
    }
    // Volume conservation of the deviation (the equilibrium shape itself has zero mean).
    this.removeMean(this.deviation);
    this.composeHeight();
    this.time += dt;
    this.computeNormals();
  }

  /** Recompute normals from the height gradient (central differences). */
  computeNormals(): void {
    const n = this.n;
    const dx = this.dx;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const il = Math.max(0, i - 1);
        const ir = Math.min(n - 1, i + 1);
        const ju = Math.max(0, j - 1);
        const jd = Math.min(n - 1, j + 1);
        const dhdx = (this.height[j * n + ir] - this.height[j * n + il]) / ((ir - il) * dx);
        const dhdz = (this.height[jd * n + i] - this.height[ju * n + i]) / ((jd - ju) * dx);
        // Surface y = h(x, z): normal ∝ (−∂h/∂x, 1, −∂h/∂z)
        let nx = -dhdx;
        let ny = 1;
        let nz = -dhdz;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        this.normals[idx * 3] = nx;
        this.normals[idx * 3 + 1] = ny;
        this.normals[idx * 3 + 2] = nz;
      }
    }
  }

  /** Diagnostics for tests: max |h|, max |v|, finiteness. */
  stats(): { maxHeight: number; maxVelocity: number; finite: boolean; energy: number } {
    let maxH = 0;
    let maxV = 0;
    let finite = true;
    let energy = 0;
    for (let i = 0; i < this.height.length; i++) {
      const h = this.height[i];
      const v = this.velocity[i];
      if (!Number.isFinite(h) || !Number.isFinite(v)) finite = false;
      maxH = Math.max(maxH, Math.abs(h));
      maxV = Math.max(maxV, Math.abs(v));
      energy += v * v + h * h;
    }
    return { maxHeight: maxH, maxVelocity: maxV, finite, energy };
  }
}

/**
 * Equilibrium surface slope (∂h/∂x, ∂h/∂z) in flask-local coordinates for a flask tilted by
 * `tiltRad` about the horizontal axis (−sin φ, 0, cos φ) (as the renderer does) while its base
 * orbits with phase φ and centripetal acceleration `accel` (m/s²):
 *   – the free surface stays level in the world, so relative to the tilted flask it slopes by
 *     −(up_local.x, up_local.z) / up_local.y where up_local is the world up axis expressed in the
 *     flask frame, up_local = (cos φ sin t, cos t, sin φ sin t);
 *   – the liquid climbs the wall opposite to the acceleration (outer wall): slope = −a/g with
 *     a = −accel (cos φ, sin φ), i.e. +accel/g (cos φ, sin φ).
 */
export function equilibriumSlope(phase: number, tiltRad: number, accel: number): [number, number] {
  const cosP = Math.cos(phase);
  const sinP = Math.sin(phase);
  const tanT = Math.tan(tiltRad);
  const slosh = accel / SurfaceSimulation.G;
  return [-tanT * cosP + slosh * cosP, -tanT * sinP + slosh * sinP];
}

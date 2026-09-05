/**
 * Deformable liquid surface: a damped 2-D wave equation on an N×N height grid covering the
 * circular surface of the liquid.
 *
 *     ∂²h/∂t² = c² ∇²h − k ∂h/∂t + forcing
 *
 * integrated explicitly with CFL-safe sub-stepping (c·dt/dx ≤ 0.5). Drop impacts add a
 * Gaussian depression; stirring couples through the bulk swirl of the fluid: a rotating
 * fluid has a free surface h(r) = ω² r² / (2g) + const (paraboloid), which is used as the
 * equilibrium shape towards which the surface relaxes, together with a tilt-induced slope
 * while the flask is inclined. Normals are computed from the height gradient.
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
  /** Height above the rest level (m), row-major, size n*n. */
  readonly height: Float32Array;
  readonly velocity: Float32Array;
  /** Equilibrium height (paraboloid + tilt), size n*n. */
  private readonly rest: Float32Array;
  /** Surface normals (xyz interleaved), size n*n*3. */
  readonly normals: Float32Array;
  /** 1 inside the liquid disc, 0 outside. */
  readonly mask: Uint8Array;
  private readonly waveSpeed: number;
  private readonly damping: number;
  private time = 0;

  constructor(radius: number, options: SurfaceOptions = {}) {
    this.n = options.resolution ?? 64;
    this.radius = radius;
    this.waveSpeed = options.waveSpeed ?? 0.35;
    this.damping = options.damping ?? 2.5;
    const size = this.n * this.n;
    this.height = new Float32Array(size);
    this.velocity = new Float32Array(size);
    this.rest = new Float32Array(size);
    this.normals = new Float32Array(size * 3);
    this.mask = new Uint8Array(size);
    this.rebuildMask();
    this.computeNormals();
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
    this.velocity.fill(0);
    this.rest.fill(0);
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
        this.height[idx] -= depth * w;
        this.velocity[idx] -= depth * 6 * w;
      }
    }
    // The liquid is incompressible: the displaced volume must appear elsewhere on the surface.
    this.removeMean(this.height);
    this.removeMean(this.velocity);
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
   * Set the equilibrium surface shape from the bulk swirl (rad/s) and a surface slope vector
   * (dimensionless, from the flask's orbital acceleration a/g):
   *   h_rest(x, z) = ω² r² / (2g) − mean + slopeX·x + slopeZ·z
   * The mean of the paraboloid over the disc (ω²R²/4g) is subtracted so the volume is conserved.
   */
  setEquilibriumSlope(swirl: number, slopeX: number, slopeZ: number): void {
    const n = this.n;
    const g = 9.81;
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

  /** Advance the wave equation by dt seconds with CFL-safe sub-steps. */
  step(dtInput: number): void {
    let dt = dtInput;
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    // Long gaps (tab hidden) are clamped: the surface simply settles.
    dt = Math.min(dt, 0.1);
    const dx = this.dx;
    const c = this.waveSpeed;
    const maxDt = (0.5 * dx) / c;
    const steps = Math.max(1, Math.ceil(dt / maxDt));
    const h = dt / steps;
    const n = this.n;
    const c2 = (c * c) / (dx * dx);
    const damp = Math.exp(-this.damping * h);
    // Relaxation of the mean shape towards the equilibrium (time constant 0.25 s).
    const relax = 1 - Math.exp(-h / 0.25);
    for (let s = 0; s < steps; s++) {
      for (let j = 1; j < n - 1; j++) {
        for (let i = 1; i < n - 1; i++) {
          const idx = j * n + i;
          if (!this.mask[idx]) continue;
          const center = this.height[idx];
          // Neumann boundary: outside-mask neighbours mirror the centre value.
          const l = this.mask[idx - 1] ? this.height[idx - 1] : center;
          const r = this.mask[idx + 1] ? this.height[idx + 1] : center;
          const u = this.mask[idx - n] ? this.height[idx - n] : center;
          const d = this.mask[idx + n] ? this.height[idx + n] : center;
          const lap = l + r + u + d - 4 * center;
          const restoring = (this.rest[idx] - center) * relax * 4;
          this.velocity[idx] = (this.velocity[idx] + (c2 * lap + restoring) * h) * damp;
        }
      }
      for (let idx = 0; idx < n * n; idx++) {
        if (!this.mask[idx]) continue;
        this.height[idx] += this.velocity[idx] * h;
      }
    }
    // Enforce volume conservation of the deviation from the equilibrium shape (which itself has zero mean).
    this.removeMean(this.height);
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

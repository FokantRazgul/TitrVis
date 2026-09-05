/** Small numeric helpers shared by simulation and UI code. */

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential decay factor exp(−rate·dt). */
export function decayFactor(rate: number, dt: number): number {
  return Math.exp(-rate * dt);
}

/** Decay rate (1/s) that halves a quantity every `halfLifeSeconds`. */
export function rateFromHalfLife(halfLifeSeconds: number): number {
  return Math.LN2 / halfLifeSeconds;
}

/** Exponential approach of `current` towards `target` with time constant `tau` over `dt`. */
export function approach(current: number, target: number, tau: number, dt: number): number {
  const k = 1 - Math.exp(-dt / tau);
  return current + (target - current) * k;
}

export function roundTo(x: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(x * f) / f;
}

/** Radius (m) of a sphere with the given volume in mL. */
export function sphereRadiusFromVolumeML(volumeML: number): number {
  const m3 = volumeML * 1e-6;
  return Math.cbrt((3 * m3) / (4 * Math.PI));
}

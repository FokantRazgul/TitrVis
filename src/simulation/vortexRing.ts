/**
 * Drop-impact vortex ring model (pure math, mirrored in GLSL by shaders/mixing/volume.glsl).
 *
 * A drop that hits a liquid surface at moderate Weber number rolls up into a vortex ring that
 * carries the drop fluid downward, decelerating as it entrains ambient liquid (Chapman &
 * Critchlow 1967; Peck & Sigurdson 1994). The ring is modelled as a Hill spherical vortex of
 * radius a translating along −y at speed U:
 *
 *   inside  (ρ² + ζ² < a²):  u_ζ = (3U/2a²)(a² − 2ρ² − ζ²) + U,   u_ρ = (3U/2a²) ρ ζ
 *   outside:                 potential flow of a moving sphere, u = ∇(−U a³ ζ / 2R³)
 *
 * (ζ = axial coordinate along the direction of travel, ρ = distance from the axis, lab frame).
 * The field is divergence-free and continuous across the sphere. Entrainment grows the radius
 * linearly with distance travelled (da/ds = spreadRate) while the hydrodynamic impulse
 * I ∝ a³ U is conserved, so U = U₀ (a₀/a)³. An image ring below the floor cancels the normal
 * velocity at the floor and doubles the radial spreading there, the classical ring–wall
 * interaction. Parameters are documented in ASSUMPTIONS.md.
 */

export const RING = {
  /** Initial ring radius as a multiple of the drop radius. */
  radiusFactor: 1.15,
  /** Initial ring speed as a fraction of the impact speed. */
  speedFactor: 0.25,
  /** Radius growth per unit distance travelled (entrainment). */
  spreadRate: 0.18,
  /** Speed decay time constant once the ring has reached the floor (s). */
  floorDecayTau: 0.3,
  /** Rings slower than this are removed (m/s). */
  minSpeed: 0.004,
  /** Rings older than this are removed (s). */
  maxAge: 4,
  /** Flask floor height in flask-local coordinates (m). */
  floorY: 0,
} as const;

export interface VortexRing {
  /** Centre of the Hill sphere (m, flask-local). */
  x: number;
  y: number;
  z: number;
  /** Current sphere radius (m). */
  a: number;
  /** Current translation speed, positive downward (m/s). */
  U: number;
  a0: number;
  U0: number;
  age: number;
  onFloor: boolean;
}

export function ringFromImpact(x: number, z: number, surfaceY: number, dropRadius: number, impactSpeed: number): VortexRing {
  const a0 = RING.radiusFactor * dropRadius;
  const U0 = RING.speedFactor * impactSpeed;
  // The sphere starts just under the surface, but never below the floor for very shallow liquids.
  const y = Math.max(surfaceY - 0.9 * a0, RING.floorY + 0.5 * a0);
  return { x, y, z, a: a0, U: U0, a0, U0, age: 0, onFloor: false };
}

/** Advance the ring kinematics by dt. Returns false when the ring should be removed. */
export function advanceRing(ring: VortexRing, dt: number): boolean {
  ring.age += dt;
  if (!ring.onFloor) {
    const ds = ring.U * dt;
    ring.y -= ds;
    ring.a += RING.spreadRate * ds;
    ring.U = ring.U0 * Math.pow(ring.a0 / ring.a, 3);
    if (ring.y - 0.6 * ring.a <= RING.floorY) {
      ring.onFloor = true;
      ring.y = RING.floorY + 0.6 * ring.a;
    }
  } else {
    // The ring flattens against the floor: it keeps spreading while its speed decays.
    ring.a += RING.spreadRate * ring.U * dt;
    ring.U *= Math.exp(-dt / RING.floorDecayTau);
  }
  return ring.age < RING.maxAge && ring.U > RING.minSpeed;
}

/** Concentration decay rate (1/s) of the fluid inside the growing sphere: 3 (da/dt) / a. */
export function ringDilutionRate(ring: VortexRing): number {
  return (3 * RING.spreadRate * ring.U) / ring.a;
}

/**
 * Lab-frame velocity (m/s) of a Hill spherical vortex at point p. `dir` is the propagation
 * direction along y (−1 downward, +1 upward for the image ring).
 */
export function hillVelocity(
  px: number,
  py: number,
  pz: number,
  cx: number,
  cy: number,
  cz: number,
  a: number,
  U: number,
  dir: number,
): [number, number, number] {
  const dx = px - cx;
  const dy = py - cy;
  const dz = pz - cz;
  const zeta = dir * dy;
  const rho2 = dx * dx + dz * dz;
  const R2 = rho2 + zeta * zeta;
  const a2 = a * a;
  if (R2 > 16 * a2) return [0, 0, 0];
  let uZeta: number;
  let uRhoOverRho: number;
  if (R2 < a2) {
    const k = (1.5 * U) / a2;
    uZeta = k * (a2 - 2 * rho2 - zeta * zeta) + U;
    uRhoOverRho = k * zeta;
  } else {
    const R = Math.sqrt(R2);
    const R3 = R2 * R;
    const R5 = R3 * R2;
    const ka = 0.5 * U * a2 * a;
    uZeta = -ka * (1 / R3 - (3 * zeta * zeta) / R5);
    uRhoOverRho = (3 * ka * zeta) / R5;
  }
  return [uRhoOverRho * dx, dir * uZeta, uRhoOverRho * dz];
}

/** Velocity of a ring plus its image in the floor plane (no flow through the floor). */
export function ringVelocity(px: number, py: number, pz: number, ring: VortexRing): [number, number, number] {
  const v = hillVelocity(px, py, pz, ring.x, ring.y, ring.z, ring.a, ring.U, -1);
  const m = hillVelocity(px, py, pz, ring.x, 2 * RING.floorY - ring.y, ring.z, ring.a, ring.U, 1);
  return [v[0] + m[0], v[1] + m[1], v[2] + m[2]];
}

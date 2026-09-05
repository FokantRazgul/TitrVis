import { describe, expect, it } from 'vitest';
import { RING, advanceRing, hillVelocity, ringDilutionRate, ringFromImpact, ringVelocity, type VortexRing } from './vortexRing';

function divergence(f: (x: number, y: number, z: number) => [number, number, number], x: number, y: number, z: number, h: number): number {
  const dvx = (f(x + h, y, z)[0] - f(x - h, y, z)[0]) / (2 * h);
  const dvy = (f(x, y + h, z)[1] - f(x, y - h, z)[1]) / (2 * h);
  const dvz = (f(x, y, z + h)[2] - f(x, y, z - h)[2]) / (2 * h);
  return dvx + dvy + dvz;
}

describe('Hill spherical vortex field', () => {
  const a = 0.003;
  const U = 0.5;
  const c = { x: 0.004, y: 0.02, z: -0.002 };
  const field = (x: number, y: number, z: number) => hillVelocity(x, y, z, c.x, c.y, c.z, a, U, -1);

  it('is divergence-free inside and outside the sphere', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    let tested = 0;
    for (let i = 0; i < 400; i++) {
      const x = c.x + 3.5 * a * rnd();
      const y = c.y + 3.5 * a * rnd();
      const z = c.z + 3.5 * a * rnd();
      const R = Math.hypot(x - c.x, y - c.y, z - c.z);
      // Stay clear of the sphere boundary (the velocity gradient is discontinuous there).
      if (Math.abs(R - a) < 0.05 * a || R > 3.8 * a) continue;
      const div = divergence(field, x, y, z, 1e-6 * a);
      expect(Math.abs(div)).toBeLessThan(1e-3 * (U / a));
      tested++;
    }
    expect(tested).toBeGreaterThan(200);
  });

  it('moves with the ring at the front stagnation point and recirculates inside (lab frame)', () => {
    const front = field(c.x, c.y - a, c.z);
    expect(front[1]).toBeCloseTo(-U, 6);
    expect(Math.hypot(front[0], front[2])).toBeLessThan(1e-9);
    const centre = field(c.x, c.y, c.z);
    expect(centre[1]).toBeCloseTo(-2.5 * U, 6);
    // At the equator the flow runs backwards at U/2 both inside and outside: continuity.
    const inside = field(c.x + a * (1 - 1e-7), c.y, c.z);
    const outside = field(c.x + a * (1 + 1e-7), c.y, c.z);
    expect(inside[1]).toBeCloseTo(U / 2, 5);
    expect(outside[1]).toBeCloseTo(U / 2, 5);
  });

  it('decays like a dipole far away and vanishes beyond the cut-off', () => {
    const near = field(c.x, c.y - 2 * a, c.z)[1];
    const far = field(c.x, c.y - 3.9 * a, c.z)[1];
    expect(Math.abs(far)).toBeLessThan(Math.abs(near) / 5);
    expect(field(c.x, c.y - 5 * a, c.z)).toEqual([0, 0, 0]);
  });
});

describe('ring + image at the floor', () => {
  it('has no velocity through the floor and doubled radial spreading there', () => {
    const ring: VortexRing = { x: 0, y: 0.004, z: 0, a: 0.005, U: 0.3, a0: 0.003, U0: 0.5, age: 0.1, onFloor: false };
    for (const [x, z] of [
      [0.001, 0],
      [0.003, 0.002],
      [-0.006, 0.001],
      [0.009, -0.004],
    ]) {
      const v = ringVelocity(x, RING.floorY, z, ring);
      expect(Math.abs(v[1])).toBeLessThan(1e-12);
      const single = hillVelocity(x, RING.floorY, z, ring.x, ring.y, ring.z, ring.a, ring.U, -1);
      expect(v[0]).toBeCloseTo(2 * single[0], 12);
      expect(v[2]).toBeCloseTo(2 * single[2], 12);
    }
  });
});

describe('ring kinematics', () => {
  it('starts from the drop and impact speed and sits just under the surface', () => {
    const ring = ringFromImpact(0.01, -0.005, 0.03, 0.0023, 2.0);
    expect(ring.a).toBeCloseTo(RING.radiusFactor * 0.0023, 12);
    expect(ring.U).toBeCloseTo(RING.speedFactor * 2.0, 12);
    expect(ring.y).toBeLessThan(0.03);
    expect(ring.y).toBeGreaterThan(0.03 - ring.a);
  });

  it('descends, grows and decelerates with conserved impulse a³U in deep liquid', () => {
    const ring = ringFromImpact(0, 0, 0.2, 0.0023, 2.0);
    const impulse0 = ring.a ** 3 * ring.U;
    let y = ring.y;
    let U = ring.U;
    let a = ring.a;
    for (let i = 0; i < 30; i++) {
      advanceRing(ring, 1 / 60);
      expect(ring.y).toBeLessThan(y);
      expect(ring.U).toBeLessThan(U);
      expect(ring.a).toBeGreaterThan(a);
      expect(ring.a ** 3 * ring.U).toBeCloseTo(impulse0, 12);
      y = ring.y;
      U = ring.U;
      a = ring.a;
    }
    // Penetration after 0.5 s: several drop diameters, not metres.
    expect(0.2 - ring.y).toBeGreaterThan(0.01);
    expect(0.2 - ring.y).toBeLessThan(0.1);
    expect(ring.onFloor).toBe(false);
  });

  it('reaches the floor of a shallow liquid quickly, then spreads and dies out', () => {
    const ring = ringFromImpact(0, 0, 0.012, 0.0023, 2.0);
    let t = 0;
    let alive = true;
    while (alive && !ring.onFloor) {
      alive = advanceRing(ring, 1 / 120);
      t += 1 / 120;
    }
    expect(ring.onFloor).toBe(true);
    expect(t).toBeLessThan(0.3);
    const aAtFloor = ring.a;
    while (alive) {
      alive = advanceRing(ring, 1 / 60);
      t += 1 / 60;
    }
    expect(ring.a).toBeGreaterThan(aAtFloor);
    expect(ring.U).toBeLessThanOrEqual(RING.minSpeed + 1e-12);
    expect(t).toBeLessThan(RING.maxAge + 1 / 60);
  });

  it('dilutes the carried fluid at 3 (da/dt)/a and the rate falls as the ring slows', () => {
    const ring = ringFromImpact(0, 0, 0.05, 0.0023, 2.0);
    const r0 = ringDilutionRate(ring);
    expect(r0).toBeCloseTo((3 * RING.spreadRate * ring.U) / ring.a, 12);
    for (let i = 0; i < 20; i++) advanceRing(ring, 1 / 60);
    expect(ringDilutionRate(ring)).toBeLessThan(r0);
    expect(ringDilutionRate(ring)).toBeGreaterThan(0);
  });
});

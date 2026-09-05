import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SurfaceSimulation, equilibriumSlope } from './SurfaceSimulation';

/** Angle of the rim crest (highest point on a circle of radius r). */
function crestAngle(s: SurfaceSimulation, r: number): number {
  let best = -Infinity;
  let angle = 0;
  for (let k = 0; k < 72; k++) {
    const a = (k / 72) * Math.PI * 2;
    const h = s.heightAt(r * Math.cos(a), r * Math.sin(a));
    if (h > best) {
      best = h;
      angle = a;
    }
  }
  return angle;
}

describe('surface sloshing', () => {
  it('follows a static tilt of the flask within a fraction of a second', () => {
    const s = new SurfaceSimulation(0.04);
    s.setDepth(0.01);
    const [sx, sz] = equilibriumSlope(0, (12 * Math.PI) / 180, 0);
    expect(sx).toBeCloseTo(-Math.tan((12 * Math.PI) / 180), 12);
    expect(sz).toBeCloseTo(0, 12);
    for (let i = 0; i < 90; i++) {
      s.setEquilibriumSlope(0, sx, sz);
      s.step(1 / 30);
    }
    // Relative to the tilted flask the level surface is higher on the −x side by tan(12°)·2R.
    const rise = s.heightAt(-0.035, 0) - s.heightAt(0.035, 0);
    expect(rise).toBeCloseTo(-sx * 0.07, 3);
    expect(s.stats().finite).toBe(true);
  });

  it('a 2.5 Hz orbital drive produces a rotating wave that is large but capped', () => {
    const s = new SurfaceSimulation(0.04);
    const depth = 0.0104;
    s.setDepth(depth);
    const dt = 1 / 30;
    const omega = 2 * Math.PI * 2.5;
    const accel = 0.006 * omega * omega; // 6 mm orbit
    const tilt = (12 * Math.PI) / 180;
    const angles: number[] = [];
    let maxDev = 0;
    for (let i = 0; i < 150; i++) {
      const phase = omega * i * dt;
      const [sx, sz] = equilibriumSlope(phase, tilt, accel);
      s.setEquilibriumSlope(0, sx, sz);
      s.step(dt);
      if (i >= 60) {
        angles.push(crestAngle(s, 0.035));
        for (let k = 0; k < s.deviation.length; k++) maxDev = Math.max(maxDev, Math.abs(s.deviation[k]));
      }
    }
    expect(s.stats().finite).toBe(true);
    // A real slosh: the dynamic deviation is at least a millimetre and never above the cap.
    expect(maxDev).toBeGreaterThan(0.001);
    expect(maxDev).toBeLessThanOrEqual(SurfaceSimulation.SATURATION * depth + 1e-9);
    // The crest goes round the flask: the angle advances by about 2π per period (12 steps).
    let advanced = 0;
    for (let i = 1; i < angles.length; i++) {
      let d = angles[i] - angles[i - 1];
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      advanced += d;
    }
    const periods = (angles.length - 1) / 12;
    expect(Math.abs(advanced) / (2 * Math.PI)).toBeGreaterThan(periods * 0.7);
    expect(Math.abs(advanced) / (2 * Math.PI)).toBeLessThan(periods * 1.3);
  });

  it('level-surface slope matches the renderer\'s tilt quaternion', () => {
    for (const [phase, tilt] of [
      [0.3, 0.2],
      [2.1, 0.1],
      [4.4, 0.21],
      [5.9, 0.05],
    ]) {
      const axis = new THREE.Vector3(-Math.sin(phase), 0, Math.cos(phase)).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axis, tilt);
      const upLocal = new THREE.Vector3(0, 1, 0).applyQuaternion(q.clone().invert());
      const expected = [-upLocal.x / upLocal.y, -upLocal.z / upLocal.y];
      const [sx, sz] = equilibriumSlope(phase, tilt, 0);
      expect(sx).toBeCloseTo(expected[0], 10);
      expect(sz).toBeCloseTo(expected[1], 10);
    }
    // Orbital acceleration: the liquid climbs the outer wall (+cos φ, +sin φ direction).
    const [ax, az] = equilibriumSlope(0.5, 0, 1.48);
    expect(ax).toBeCloseTo((1.48 / 9.81) * Math.cos(0.5), 12);
    expect(az).toBeCloseTo((1.48 / 9.81) * Math.sin(0.5), 12);
  });

  it('wave speed follows √(g·depth) unless fixed', () => {
    const s = new SurfaceSimulation(0.04);
    s.setDepth(0.01);
    expect(s.speed).toBeCloseTo(Math.sqrt(9.81 * 0.01), 6);
    s.setDepth(0.04);
    expect(s.speed).toBeCloseTo(Math.sqrt(9.81 * 0.04), 6);
    const fixed = new SurfaceSimulation(0.04, { waveSpeed: 0.3 });
    fixed.setDepth(0.05);
    expect(fixed.speed).toBe(0.3);
  });
});

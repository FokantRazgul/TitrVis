import { describe, expect, it } from 'vitest';
import { DropSystem, GRAVITY } from './DropSystem';
import { SurfaceSimulation } from './SurfaceSimulation';
import { FLASK_SPECS, flaskProfile, liquidHeightForVolume, opticalPathCm, selectFlask, volumeForHeight } from './flaskGeometry';
import { sphereRadiusFromVolumeML } from '../utils/math';

describe('flask geometry', () => {
  it('volume–height table is monotonic and inverts correctly', () => {
    const p = flaskProfile(FLASK_SPECS[2]); // 250 mL
    expect(p.capacityML).toBeGreaterThan(250);
    expect(p.bodyCapacityML).toBeGreaterThan(200);
    for (let i = 1; i < p.volumeTable.length; i++) expect(p.volumeTable[i].volumeML).toBeGreaterThan(p.volumeTable[i - 1].volumeML);
    for (const v of [1, 10, 50, 100, 200]) {
      const h = liquidHeightForVolume(p, v);
      expect(volumeForHeight(p, h)).toBeCloseTo(v, 3);
    }
    expect(liquidHeightForVolume(p, 0)).toBe(0);
    expect(liquidHeightForVolume(p, 1e9)).toBe(p.innerHeight);
  });
  it('selects the smallest flask with headroom', () => {
    expect(selectFlask(150).spec.nominalML).toBe(250);
    expect(selectFlask(50 * 3).spec.nominalML).toBe(250);
    expect(selectFlask(1000 * 3).spec.nominalML).toBe(5000);
    expect(selectFlask(3).spec.nominalML).toBe(50);
  });
  it('optical path grows with the flask and is a few centimetres', () => {
    const small = opticalPathCm(selectFlask(3), 1);
    const big = opticalPathCm(selectFlask(3000), 1000);
    expect(small).toBeGreaterThan(1);
    expect(big).toBeGreaterThan(small);
    expect(big).toBeLessThan(20);
  });
});

describe('drop system', () => {
  const surface = { heightAt: () => 0.05 };
  it('forms drops at the configured rate and only reports impacts on reaching the surface', () => {
    const drops = new DropSystem({ tipX: 0, tipY: 0.2, tipZ: 0 });
    const impacts: number[] = [];
    let t = 0;
    const dt = 1 / 120;
    while (t < 3) {
      const ev = drops.update(dt, true, true, 2, 0.05, surface);
      for (let k = 0; k < ev.length; k++) impacts.push(t);
      t += dt;
    }
    // 2 Hz for 3 s → about 5–6 drops have landed (fall time ≈ sqrt(2·0.15/9.81) ≈ 0.17 s)
    expect(impacts.length).toBeGreaterThanOrEqual(4);
    expect(impacts.length).toBeLessThanOrEqual(6);
    const intervals = impacts.slice(1).map((v, i) => v - impacts[i]);
    for (const iv of intervals) expect(iv).toBeCloseTo(0.5, 1);
  });
  it('drops are ballistic and carry the configured volume', () => {
    const drops = new DropSystem({ tipX: 0, tipY: 0.2, tipZ: 0, pendantFraction: 0.05 });
    const dt = 1 / 240;
    let impact = null as null | { speed: number; volume: number };
    for (let i = 0; i < 2000 && !impact; i++) {
      const ev = drops.update(dt, true, true, 1, 0.08, surface);
      if (ev.length) impact = { speed: ev[0].speed, volume: ev[0].drop.volumeML };
    }
    expect(impact).not.toBeNull();
    expect(impact!.volume).toBe(0.08);
    const r = sphereRadiusFromVolumeML(0.08);
    // v = sqrt(2 g h), h ≈ 0.15 m (minus radius offsets)
    const expected = Math.sqrt(2 * GRAVITY * (0.2 - 0.05 - r));
    expect(impact!.speed).toBeCloseTo(expected, 0);
    expect(r).toBeCloseTo(0.00267, 4);
  });
  it('does not create drops when titration is inactive or vetoed, and resets', () => {
    const drops = new DropSystem({ tipX: 0, tipY: 0.2, tipZ: 0 });
    for (let i = 0; i < 200; i++) expect(drops.update(1 / 60, false, true, 5, 0.05, surface)).toEqual([]);
    expect(drops.activeDrops).toHaveLength(0);
    for (let i = 0; i < 200; i++) expect(drops.update(1 / 60, true, false, 5, 0.05, surface)).toEqual([]);
    expect(drops.activeDrops).toHaveLength(0);
    for (let i = 0; i < 30; i++) drops.update(1 / 60, true, true, 5, 0.05, surface);
    expect(drops.activeDrops.length).toBeGreaterThan(0);
    expect(drops.inFlightVolumeML).toBeGreaterThan(0);
    drops.reset();
    expect(drops.activeDrops).toHaveLength(0);
  });
});

describe('surface simulation', () => {
  it('stays finite and bounded over 1000 steps with impacts and stirring', () => {
    const s = new SurfaceSimulation(0.03, { resolution: 64 });
    for (let i = 0; i < 1000; i++) {
      if (i % 50 === 0) s.addImpact(0.005, -0.004, 0.0023, 1.7);
      if (i > 500) s.setEquilibriumSlope(5, 0.05 * Math.cos(i / 10), 0.05 * Math.sin(i / 10));
      s.step(1 / 60);
    }
    const st = s.stats();
    expect(st.finite).toBe(true);
    // Deformation stays a small fraction of the 3 cm surface radius.
    expect(st.maxHeight).toBeLessThan(0.008);
    expect(st.maxVelocity).toBeLessThan(1);
  });
  it('impacts create a depression that propagates and decays', () => {
    const s = new SurfaceSimulation(0.03, { resolution: 64 });
    s.addImpact(0, 0, 0.0023, 1.7);
    const centre = s.heightAt(0, 0);
    expect(centre).toBeLessThan(0);
    // Volume is conserved: the mean surface height stays at the rest level.
    let mean = 0;
    let cells = 0;
    for (let i = 0; i < s.n * s.n; i++) if (s.mask[i]) { mean += s.height[i]; cells++; }
    expect(mean / cells).toBeCloseTo(0, 9);
    const before = s.stats();
    for (let i = 0; i < 12; i++) s.step(1 / 60);
    // Waves have spread away from the centre: the rim now carries deformation.
    let rim = 0;
    for (let a = 0; a < 16; a++) rim = Math.max(rim, Math.abs(s.heightAt(0.02 * Math.cos(a), 0.02 * Math.sin(a))));
    expect(rim).toBeGreaterThan(1e-5);
    expect(Math.abs(s.heightAt(0, 0))).toBeLessThan(Math.abs(centre));
    for (let i = 0; i < 600; i++) s.step(1 / 60);
    const after = s.stats();
    expect(after.maxHeight).toBeLessThan(before.maxHeight * 0.05);
    expect(after.maxVelocity).toBeLessThan(before.maxVelocity * 0.05);
  });
  it('normals are unit length and point up on a flat surface', () => {
    const s = new SurfaceSimulation(0.03);
    for (let i = 0; i < s.n * s.n; i++) {
      const nx = s.normals[i * 3];
      const ny = s.normals[i * 3 + 1];
      const nz = s.normals[i * 3 + 2];
      expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 6);
      expect(ny).toBeCloseTo(1, 6);
    }
    s.addImpact(0, 0, 0.003, 2);
    s.computeNormals();
    let tilted = 0;
    for (let i = 0; i < s.n * s.n; i++) if (s.normals[i * 3 + 1] < 0.999) tilted++;
    expect(tilted).toBeGreaterThan(0);
  });
  it('large dt is sub-stepped and stays stable; reset clears', () => {
    const s = new SurfaceSimulation(0.03);
    s.addImpact(0, 0, 0.003, 2);
    s.step(0.25);
    expect(s.stats().finite).toBe(true);
    expect(s.stats().maxHeight).toBeLessThan(0.01);
    s.reset();
    expect(s.stats().energy).toBe(0);
  });
});

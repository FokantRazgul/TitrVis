import { expect, test } from '@playwright/test';
import { gotoApp } from './helpers';

/**
 * GPU fluid/mixing simulation tests run against the real WebGL2 renderer of the app page.
 * Steps are issued directly on freshly created simulation instances.
 */
test.describe('GPU fluid simulation', () => {
  test('1000 steps stay finite and bounded; injection, stirring, damping, reset, disposal', async ({ page }) => {
    await gotoApp(page);
    const result = await page.evaluate(async () => {
      const hook = window.__TITRVIS__!;
      const renderer = hook.scene()!.gl;
      const { FluidSimulation, MixingSimulation } = hook.gpu;
      const fluid = new FluidSimulation(renderer, { resolution: 128 });
      const mixing = new MixingSimulation(renderer, { resolution: 128 });
      const out: Record<string, unknown> = {};
      // Quiescent run: nothing should appear from nothing.
      for (let i = 0; i < 50; i++) {
        fluid.step(1 / 60);
        mixing.step(1 / 60, fluid.velocityTexture);
      }
      out.quiet = { fluid: fluid.stats(), mixing: mixing.stats() };
      // Injection increases the mixing scalar.
      mixing.inject({ u: 0.5, v: 0.5, radius: 0.05, amount: 1 });
      mixing.step(1 / 60, fluid.velocityTexture);
      out.afterInject = mixing.stats();
      // A drop impact starts a vortex ring: the titrant appears under the surface first and is
      // transported down to the floor (vertical structure, not a depth-uniform column).
      mixing.reset();
      mixing.setGeometry({ height: 0.012, refRadius: 0.04, radiusTop: 0.95, radiusBottom: 0.88 });
      mixing.injectDrop({ x: 0, z: 0, surfaceY: 0.012, dropRadius: 0.0023, speed: 2 });
      mixing.step(1 / 60, fluid.velocityTexture);
      out.plumeStart = mixing.stats().sliceMeans;
      out.ringsActive = mixing.rings.length;
      for (let i = 0; i < 30; i++) mixing.step(1 / 60, fluid.velocityTexture);
      out.plumeLater = mixing.stats().sliceMeans;
      // Stirring changes the velocity field.
      fluid.setStirring(1, 5, 0, 0);
      for (let i = 0; i < 120; i++) {
        fluid.step(1 / 60);
        mixing.step(1 / 60, fluid.velocityTexture);
      }
      out.stirred = fluid.stats();
      // Release: exponential damping (half-life 1.5 s) reduces the kinetic energy.
      fluid.setStirring(0, 0, 0, 0);
      const e0 = fluid.stats().kineticEnergy;
      const samples: number[] = [];
      for (let k = 0; k < 4; k++) {
        for (let i = 0; i < 45; i++) fluid.step(1 / 60); // 0.75 s per sample
        samples.push(fluid.stats().kineticEnergy / e0);
      }
      out.decay = samples;
      // Large-but-valid dt and 1000 further steps with impulses.
      for (let i = 0; i < 1000; i++) {
        if (i % 100 === 0) fluid.addSplat({ u: 0.4 + 0.2 * Math.random(), v: 0.5, radius: 0.04, strength: 0.5 });
        fluid.step(i % 2 === 0 ? 1 / 30 : 1 / 20);
        mixing.step(1 / 30, fluid.velocityTexture);
      }
      out.long = { fluid: fluid.stats(), mixing: mixing.stats(), steps: fluid.steps };
      // Reset returns to the initial state.
      fluid.reset();
      mixing.reset();
      out.reset = { fluid: fluid.stats(), mixing: mixing.stats() };
      // Repeated creation/disposal must not grow GPU memory.
      const baseline = renderer.info.memory.textures;
      for (let i = 0; i < 10; i++) {
        const f = new FluidSimulation(renderer, { resolution: 64 });
        const m = new MixingSimulation(renderer, { resolution: 64 });
        for (let s = 0; s < 20; s++) {
          f.step(1 / 60);
          m.step(1 / 60, f.velocityTexture);
        }
        f.reset();
        m.reset();
        f.dispose();
        m.dispose();
      }
      out.memory = { baseline, after: renderer.info.memory.textures };
      fluid.dispose();
      mixing.dispose();
      out.memoryFinal = renderer.info.memory.textures;
      return out as {
        quiet: { fluid: { maxSpeed: number; finite: boolean }; mixing: { mean: number; finite: boolean } };
        afterInject: { mean: number; max: number };
        plumeStart: number[];
        plumeLater: number[];
        ringsActive: number;
        stirred: { meanSpeed: number; maxSpeed: number; finite: boolean; maxAbsPressure: number };
        decay: number[];
        long: { fluid: { finite: boolean; maxSpeed: number; maxAbsPressure: number }; mixing: { finite: boolean; max: number }; steps: number };
        reset: { fluid: { maxSpeed: number }; mixing: { mean: number } };
        memory: { baseline: number; after: number };
        memoryFinal: number;
      };
    });
    expect(result.quiet.fluid.maxSpeed).toBe(0);
    expect(result.quiet.mixing.mean).toBe(0);
    expect(result.afterInject.max).toBeGreaterThan(0.5);
    expect(result.afterInject.mean).toBeGreaterThan(0);
    // Right after impact the titrant sits in the upper slices only …
    const top = result.plumeStart[result.plumeStart.length - 1];
    expect(result.ringsActive).toBe(1);
    expect(top).toBeGreaterThan(0);
    expect(result.plumeStart[0]).toBeLessThan(top * 0.05);
    // … and half a second later the sinking ring has carried it down to the floor slice.
    expect(result.plumeLater[0]).toBeGreaterThan(result.plumeStart[0]);
    expect(result.plumeLater[0]).toBeGreaterThan(0.2 * Math.max(...result.plumeLater));
    for (const v of [...result.plumeStart, ...result.plumeLater]) expect(Number.isFinite(v)).toBe(true);
    expect(result.stirred.finite).toBe(true);
    expect(result.stirred.meanSpeed).toBeGreaterThan(0.1);
    expect(result.stirred.maxSpeed).toBeLessThan(10);
    // Exponential decay with numerical dissipation: after 0.75 s the energy should be well below
    // the initial value and keep decreasing monotonically.
    expect(result.decay[0]).toBeLessThan(1);
    for (let i = 1; i < result.decay.length; i++) expect(result.decay[i]).toBeLessThan(result.decay[i - 1]);
    expect(result.decay[3]).toBeLessThan(0.35);
    expect(result.long.fluid.finite).toBe(true);
    expect(result.long.mixing.finite).toBe(true);
    expect(result.long.fluid.maxSpeed).toBeLessThan(10);
    expect(result.long.fluid.maxAbsPressure).toBeLessThan(100);
    expect(result.long.steps).toBeGreaterThanOrEqual(1000);
    expect(result.reset.fluid.maxSpeed).toBe(0);
    expect(result.reset.mixing.mean).toBe(0);
    expect(result.memory.after).toBeLessThanOrEqual(result.memory.baseline);
    expect(result.memoryFinal).toBeLessThan(result.memory.baseline);
  });
});

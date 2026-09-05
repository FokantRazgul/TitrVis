import { expect, test } from '@playwright/test';
import { getState, gotoApp, holdSpaceUntil, ignorableError } from './helpers';

test.describe('TitrVis acceptance', () => {
  test('launches without runtime errors and shows the initial chemistry', async ({ page }) => {
    const errors = await gotoApp(page);
    await expect(page.getByTestId('ph-value')).toHaveText('2.88');
    await expect(page.getByTestId('volume-value')).toHaveText('0.000 mL');
    await expect(page.getByTestId('equivalence-list')).toContainText('50.000 mL');
    expect(errors.filter((e) => !ignorableError(e))).toEqual([]);
  });

  test('analyte and titrant can be searched and selected', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('analyte-search').fill('phosph');
    await expect(page.getByTestId('analyte-card-phosphoric_acid')).toBeVisible();
    await expect(page.getByTestId('analyte-card-acetic_acid')).toHaveCount(0);
    await page.getByTestId('analyte-card-phosphoric_acid').click();
    await expect(page.getByTestId('analyte-selected')).toContainText('Phosphoric acid');
    await page.getByTestId('titrant-search').fill('KOH');
    await page.getByTestId('titrant-card-potassium_hydroxide').click();
    await expect(page.getByTestId('titrant-selected')).toContainText('Potassium hydroxide');
    const s = await getState(page);
    expect(s.analyteId).toBe('phosphoric_acid');
    expect(s.titrantId).toBe('potassium_hydroxide');
    expect(s.pH).toBeLessThan(2);
    // Three stoichiometric equivalence points at 50, 100, 150 mL
    await expect(page.getByTestId('equivalence-list')).toContainText('150.000 mL');
  });

  test('numeric inputs validate ranges', async ({ page }) => {
    await gotoApp(page);
    const volume = page.getByTestId('analyte-volume');
    await volume.fill('5000');
    await expect(page.getByRole('alert')).toContainText('Maximum is 1000 mL');
    await volume.fill('');
    await expect(page.getByRole('alert')).toContainText('Enter a number');
    await volume.fill('100');
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await getState(page)).analyteId).toBe('acetic_acid');
    await expect(page.getByTestId('equivalence-list')).toContainText('100.000 mL');
  });

  test('indicator can be added and the indicator panel shows spectra, structure and colour', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('indicator-select').selectOption('bromothymol_blue');
    await page.getByTestId('add-indicator').click();
    await expect(page.getByTestId('indicator-added')).toContainText('Bromothymol blue');
    await page.getByTestId('indicator-panel-button').click();
    await expect(page.getByTestId('indicator-panel')).toBeVisible();
    await expect(page.getByTestId('structure-svg')).toBeVisible();
    await expect(page.getByTestId('spectrum-graph').locator('.js-plotly-plot')).toBeVisible();
    await expect(page.getByTestId('colour-hex')).toHaveText(/^#[0-9a-f]{6}$/);
    await expect(page.getByTestId('indicator-ratio')).toContainText('[HIn]/[In⁻]');
    const swatch = await page.getByTestId('colour-swatch').evaluate((el) => getComputedStyle(el).backgroundColor);
    const s = await getState(page);
    // Swatch colour is exactly the pipeline colour used by the liquid.
    const hex = s.hex!;
    const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    expect(swatch.replace(/\s/g, '')).toBe(`rgb(${rgb.join(',')})`);
    // Bromothymol blue at pH 2.88 is yellow: red and green dominate blue.
    expect(rgb[0]).toBeGreaterThan(rgb[2]);
    expect(rgb[1]).toBeGreaterThan(rgb[2]);
    await page.getByTestId('close-indicator-panel').click();
    await expect(page.getByTestId('indicator-panel')).toHaveCount(0);
  });

  test('holding Space titrates: drops land, pH changes, graph receives points, then reset clears', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('add-indicator').click();
    await page.getByTestId('drop-volume').fill('0.5');
    await page.getByTestId('drop-rate').fill('8');
    const before = await getState(page);
    await holdSpaceUntil(page, (s) => s.points >= 3);
    const after = await getState(page);
    expect(after.isTitrating).toBe(false);
    expect(after.addedTitrantVolumeML).toBeGreaterThanOrEqual(1.5 - 1e-9);
    expect(after.pH).toBeGreaterThan(before.pH!);
    expect(after.points).toBeGreaterThanOrEqual(3);
    await expect(page.getByTestId('titration-graph')).toHaveAttribute('data-points', String(after.points));
    await expect(page.getByTestId('point-count')).toContainText(`${after.points} points`);
    const mixing = await page.evaluate(() => window.__TITRVIS__!.simulation!.mixing.stats());
    expect(mixing.finite).toBe(true);
    expect(mixing.max).toBeGreaterThan(0);
    await page.keyboard.press('r');
    const reset = await getState(page);
    expect(reset.addedTitrantVolumeML).toBe(0);
    expect(reset.points).toBe(0);
    expect(reset.indicatorAdded).toBe(false);
    await expect(page.getByTestId('volume-value')).toHaveText('0.000 mL');
    expect(await page.evaluate(() => window.__TITRVIS__!.simulation!.drops.activeDrops.length)).toBe(0);
  });

  test('indicator transition differs from equivalence and the error is reported', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('add-indicator').click();
    await expect(page.getByTestId('indicator-error')).toContainText('Indicator error');
    const s = await getState(page);
    expect(s.analysis!.transition).not.toBeNull();
    expect(s.analysis!.transition!).toBeGreaterThan(50);
    expect(s.analysis!.error!.deltaML).toBeGreaterThan(0);
    expect(Math.abs(s.analysis!.error!.percent)).toBeLessThan(1);
  });

  test('keyboard shortcuts: panels, lighting, theme toggle, mute', async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId('experiment-panel')).toBeVisible();
    await page.keyboard.press('h');
    await expect(page.getByTestId('experiment-panel')).toHaveCount(0);
    await page.keyboard.press('h');
    await expect(page.getByTestId('experiment-panel')).toBeVisible();
    await page.keyboard.press('2');
    expect((await getState(page)).lightingMode).toBe(2);
    await expect(page.getByTestId('lighting-2')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('1');
    expect((await getState(page)).lightingMode).toBe(1);
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-toggle').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.getByTestId('mute-toggle').click();
    await expect(page.getByTestId('mute-toggle')).toHaveText('Unmute');
  });

  test('camera lighting falls back gracefully without a camera', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.press('3');
    await expect(page.getByTestId('toast')).toContainText(/Camera lighting unavailable/);
    expect((await getState(page)).lightingMode).toBe(1);
  });

  test('Shift stirs: flask tilts, fluid circulates, motion decays after release', async ({ page }) => {
    await gotoApp(page);
    await page.keyboard.down('Shift');
    await page.waitForFunction(() => (window.__TITRVIS__!.simulation!.stir.drive ?? 0) > 0.8, undefined, { timeout: 60_000 });
    const during = await page.evaluate(() => ({ stir: { ...window.__TITRVIS__!.simulation!.stir }, fluid: window.__TITRVIS__!.simulation!.fluid.stats() }));
    expect(during.stir.tiltRad).toBeGreaterThan(0.15);
    expect(during.fluid.meanSpeed).toBeGreaterThan(0.05);
    expect(during.fluid.finite).toBe(true);
    await page.keyboard.up('Shift');
    await page.waitForFunction(() => (window.__TITRVIS__!.simulation!.stir.drive ?? 1) < 0.02, undefined, { timeout: 60_000 });
    const upright = await page.evaluate(() => ({ ...window.__TITRVIS__!.simulation!.stir }));
    expect(upright.tiltRad).toBeLessThan(0.01);
    // Inertia: the swirl persists after release and then decays.
    expect(upright.swirl).toBeGreaterThan(0.5);
    const e0 = await page.evaluate(() => window.__TITRVIS__!.simulation!.fluid.stats().kineticEnergy);
    await page.waitForFunction((e) => window.__TITRVIS__!.simulation!.fluid.stats().kineticEnergy < e * 0.6, e0, { timeout: 90_000 });
  });

  test('CSV export downloads valid data', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('drop-volume').fill('0.5');
    await page.getByTestId('drop-rate').fill('8');
    await holdSpaceUntil(page, (s) => s.points >= 2);
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-csv').click()]);
    expect(download.suggestedFilename()).toMatch(/^titration-.*\.csv$/);
    const path = await download.path();
    const fs = await import('node:fs/promises');
    const text = await fs.readFile(path!, 'utf8');
    const lines = text.trim().split(/\r?\n/);
    expect(lines[0]).toBe('added_volume_ml,pH');
    expect(lines.length).toBeGreaterThanOrEqual(3);
    for (const line of lines.slice(1)) {
      const [v, ph] = line.split(',').map(Number);
      expect(Number.isFinite(v)).toBe(true);
      expect(Number.isFinite(ph)).toBe(true);
    }
  });

  test('screenshot (S) downloads a PNG of the scene', async ({ page }) => {
    await gotoApp(page);
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.keyboard.press('s')]);
    expect(download.suggestedFilename()).toMatch(/^titrvis-.*\.png$/);
    const path = await download.path();
    const fs = await import('node:fs/promises');
    const buffer = await fs.readFile(path!);
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buffer.length).toBeGreaterThan(20_000);
  });

  test('spectrum PNG export downloads an image', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('add-indicator').click();
    await page.getByTestId('indicator-panel-button').click();
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 60_000 }), page.getByTestId('export-spectrum').click()]);
    expect(download.suggestedFilename()).toMatch(/^spectrum-phenolphthalein-.*\.png$/);
    const fs = await import('node:fs/promises');
    const buffer = await fs.readFile((await download.path())!);
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect(buffer.length).toBeGreaterThan(10_000);
  });

  test('desktop panels resize by dragging the edge', async ({ page }) => {
    await gotoApp(page);
    const panel = page.getByTestId('experiment-panel');
    const before = (await panel.boundingBox())!.width;
    const handle = page.getByTestId('experiment-panel-handle');
    const box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + 200, { steps: 6 });
    await page.mouse.up();
    const after = (await panel.boundingBox())!.width;
    expect(after - before).toBeGreaterThan(80);
  });

  test('titrant safety limit stops titration with a notification', async ({ page }) => {
    await gotoApp(page);
    await page.getByTestId('analyte-volume').fill('1');
    await page.getByTestId('drop-volume').fill('0.5');
    await page.getByTestId('drop-rate').fill('10');
    await holdSpaceUntil(page, (s) => s.limitReached);
    const s = await getState(page);
    expect(s.limitReached).toBe(true);
    expect(s.isTitrating).toBe(false);
    expect(s.addedTitrantVolumeML).toBeCloseTo(2, 6);
    await expect(page.getByTestId('toast').filter({ hasText: /limit reached/i }).first()).toBeVisible();
    // No further drops are formed while the limit is active.
    await page.keyboard.down('Space');
    await page.waitForTimeout(3000);
    await page.keyboard.up('Space');
    expect((await getState(page)).addedTitrantVolumeML).toBeCloseTo(2, 6);
  });

  test('keeps working after the tab is hidden and resumed', async ({ page }) => {
    const errors = await gotoApp(page);
    const f0 = (await getState(page)).frames;
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForFunction((f) => window.__TITRVIS__!.frames > f + 2, f0, { timeout: 60_000 });
    await page.getByTestId('drop-volume').fill('0.5');
    await holdSpaceUntil(page, (s) => s.points >= 1);
    expect(errors.filter((e) => !ignorableError(e))).toEqual([]);
  });
});

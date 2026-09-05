import { expect, type Page } from '@playwright/test';

/** Wait until the 3D scene has rendered a few frames (software rendering can be slow). */
export async function waitForScene(page: Page): Promise<void> {
  await page.waitForSelector('canvas', { timeout: 120_000 });
  await page.waitForFunction(() => (window.__TITRVIS__?.frames ?? 0) > 2, undefined, { timeout: 120_000 });
}

export async function gotoApp(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console.error: ${m.text()}`);
  });
  await page.goto('/', { waitUntil: 'load', timeout: 120_000 });
  await waitForScene(page);
  return errors;
}

export function getState(page: Page) {
  return page.evaluate(() => {
    const s = window.__TITRVIS__!.getState();
    return {
      analyteId: s.analyteId,
      titrantId: s.titrantId,
      addedTitrantVolumeML: s.addedTitrantVolumeML,
      points: s.titrationPoints.length,
      pH: s.currentState?.pH ?? null,
      isTitrating: s.isTitrating,
      isStirring: s.isStirring,
      limitReached: s.limitReached,
      lightingMode: s.lightingMode,
      panelsVisible: s.panelsVisible,
      theme: s.theme,
      indicatorAdded: s.addedIndicator !== null,
      hex: s.visualState?.liquidColour.hex ?? null,
      indicatorFraction: s.visualState?.indicatorFraction ?? null,
      frames: window.__TITRVIS__!.frames,
      analysis: s.analysis
        ? {
            equivalence: s.analysis.equivalence.points.map((p) => ({ v: p.volumeML, pH: p.pH })),
            transition: s.analysis.transition?.volumeML ?? null,
            error: s.analysis.error ? { deltaML: s.analysis.error.deltaML, percent: s.analysis.error.percent } : null,
          }
        : null,
    };
  });
}

/** Space inside a text field must keep typing a space, so tests leave the field first. */
export async function blurInputs(page: Page): Promise<void> {
  await page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (el && el !== document.body) el.blur();
  });
}

export async function holdSpaceUntil(page: Page, predicate: (s: Awaited<ReturnType<typeof getState>>) => boolean, timeoutMs = 120_000): Promise<void> {
  await blurInputs(page);
  await page.keyboard.down('Space');
  const start = Date.now();
  try {
    while (Date.now() - start < timeoutMs) {
      const s = await getState(page);
      if (predicate(s)) return;
      await page.waitForTimeout(500);
    }
    expect(predicate(await getState(page)), 'condition reached while holding Space').toBe(true);
  } finally {
    await page.keyboard.up('Space');
  }
}

export function ignorableError(text: string): boolean {
  return /UniformsUtils|favicon/.test(text);
}

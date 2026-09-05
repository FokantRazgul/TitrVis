import { devices, expect, test } from '@playwright/test';
import { getState, gotoApp } from './helpers';

test.use({ ...devices['Pixel 5'], hasTouch: true, isMobile: true, viewport: { width: 393, height: 851 } });

test.describe('mobile controls', () => {
  test('hold buttons drive titration and stirring; panels stack', async ({ page }) => {
    await gotoApp(page);
    await expect(page.getByTestId('mobile-controls')).toBeVisible();
    await expect(page.getByTestId('experiment-panel')).toHaveCount(0);
    await page.getByTestId('mobile-tab-experiment').tap();
    await expect(page.getByTestId('add-indicator')).toBeVisible();
    await page.getByTestId('mobile-tab-experiment').tap();

    const titrate = page.getByTestId('mobile-titrate');
    const box = (await titrate.boundingBox())!;
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }] });
    await page.waitForFunction(() => window.__TITRVIS__!.getState().isTitrating, undefined, { timeout: 10_000 });
    expect((await getState(page)).isTitrating).toBe(true);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(() => !window.__TITRVIS__!.getState().isTitrating, undefined, { timeout: 10_000 });

    const stir = page.getByTestId('mobile-stir');
    const sb = (await stir.boundingBox())!;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: sb.x + sb.width / 2, y: sb.y + sb.height / 2 }] });
    await page.waitForFunction(() => window.__TITRVIS__!.getState().isStirring, undefined, { timeout: 10_000 });
    // Cancelling the touch releases the control.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await page.waitForFunction(() => !window.__TITRVIS__!.getState().isStirring, undefined, { timeout: 10_000 });
  });
});

/**
 * Checks that knobs can actually be adjusted.
 *
 * This exists because a completely dead knob passed every other check in this
 * repo. They all click buttons and rows; none of them touched the control the
 * whole app is built around, so it was possible to ship a version where no
 * parameter could be changed on a phone at all.
 *
 * Four routes are tested, because a control has to survive all of them:
 *  - the plain slider, which is what a touch screen gets by default and which
 *    has no gesture code of its own at all
 *  - a real touch drag on a dial, as a thumb does it
 *  - a mouse drag on a dial, as a laptop does it
 *  - a tap on a dial, opening the sheet
 *
 * The dial had to be rewritten twice. It was a div carrying pointer handlers,
 * and on a real phone it did not respond to anything, while ordinary buttons
 * in the same app worked perfectly. So it is a real button element now, and
 * the plain slider exists so there is always a control that depends on no
 * gesture handling whatsoever.
 *
 * The touch input goes through the browser's own input pipeline rather than
 * synthetic events. Dispatching a pointer event by hand does not create a real
 * pointer, so anything depending on one silently does nothing and the test
 * passes for the wrong reason.
 *
 *   npm run build && npm run preview &
 *   npm run check:knobs
 */

import { chromium, devices } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:4173/';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const errors = [];
const results = {};

async function open(contextOptions) {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => {
    const text = m.text();
    if (m.type() === 'error' && !text.includes('ERR_')) errors.push(text);
  });
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /tap to start/i }).click();
  await page.waitForTimeout(1000);
  return { context, page };
}

const TEMPO = '.transport .knob-dial';
const READOUT = '.transport .knob-value';

/** Put the app into dial mode, which is not the default on a touch screen. */
async function useDials(page) {
  const dials = page.locator('.depth-option', { hasText: 'Knobs' });
  if (await dials.count()) await dials.click();
  await page.waitForTimeout(300);
}

// --- 0. the plain slider, on a touch screen, with no dials involved --------
{
  const { context, page } = await open({ ...devices['iPhone 13'] });
  const slider = page.locator('.transport .slider-inline');
  const shown = page.locator('.transport .slider-value');
  const before = await shown.textContent();

  const track = await slider.boundingBox();
  const client = await context.newCDPSession(page);
  const x = Math.round(track.x + track.width * 0.8);
  const y = Math.round(track.y + track.height / 2);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(40);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);

  results.plainSlider = {
    isDefaultOnTouch: await page.locator('.depth-option.is-on', { hasText: 'Sliders' }).count() > 0,
    before,
    after: await shown.textContent(),
  };
  await context.close();
}

// --- 1. a real touch drag --------------------------------------------------
{
  const { context, page } = await open({ ...devices['iPhone 13'] });
  await useDials(page);
  const before = await page.locator(READOUT).textContent();
  const box = await page.locator(TEMPO).boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  for (let dy = 8; dy <= 72; dy += 8) {
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cx, y: cy - dy }] });
    await page.waitForTimeout(16);
  }
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(250);

  results.touchDrag = { before, after: await page.locator(READOUT).textContent() };
  await context.close();
}

// --- 2. a mouse drag -------------------------------------------------------
{
  const { context, page } = await open({ viewport: { width: 900, height: 820 } });
  await useDials(page);
  const before = await page.locator(READOUT).textContent();
  const box = await page.locator(TEMPO).boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let dy = 8; dy <= 72; dy += 8) await page.mouse.move(cx, cy - dy);
  await page.mouse.up();
  await page.waitForTimeout(250);

  results.mouseDrag = { before, after: await page.locator(READOUT).textContent() };
  await context.close();
}

// --- 3. a tap opening the slider, then moving it ---------------------------
{
  const { context, page } = await open({ ...devices['iPhone 13'] });
  await useDials(page);
  const before = await page.locator(READOUT).textContent();
  const box = await page.locator(TEMPO).boundingBox();
  const cx = Math.round(box.x + box.width / 2);
  const cy = Math.round(box.y + box.height / 2);

  // A press with no movement at all, which is what a tap is.
  const client = await context.newCDPSession(page);
  await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: cx, y: cy }] });
  await page.waitForTimeout(60);
  await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(350);

  const sheetOpened = await page.locator('.value-sheet').count();
  let viaPlus = null;
  let viaSlider = null;

  if (sheetOpened) {
    await page.locator('.value-step', { hasText: '+' }).click();
    await page.waitForTimeout(150);
    viaPlus = await page.locator('.value-readout').textContent();

    // Tap the slider track with real touch input, near the right hand end.
    // Assigning to the input's value from script and firing an event would
    // not do: React tracks the value itself and ignores a change made that
    // way, so the test would fail for a reason a real finger never hits.
    const track = await page.locator('.value-range').boundingBox();
    const tapX = Math.round(track.x + track.width * 0.85);
    const tapY = Math.round(track.y + track.height / 2);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: tapX, y: tapY }] });
    await page.waitForTimeout(40);
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(250);
    viaSlider = await page.locator('.value-readout').textContent();

    await page.locator('.sheet-close').click();
    await page.waitForTimeout(150);
  }

  results.tapSheet = {
    before,
    sheetOpened: Boolean(sheetOpened),
    viaPlus,
    viaSlider,
    after: await page.locator(READOUT).textContent(),
  };
  await context.close();
}

await browser.close();
console.log(JSON.stringify({ results, errors: [...new Set(errors)] }, null, 2));

const problems = [];
if (!results.plainSlider.isDefaultOnTouch) {
  problems.push('a touch screen did not get plain sliders by default');
}
if (results.plainSlider.before === results.plainSlider.after) {
  problems.push(`tapping the plain slider changed nothing (still ${results.plainSlider.after})`);
}
if (results.touchDrag.before === results.touchDrag.after) {
  problems.push(`a touch drag changed nothing (still ${results.touchDrag.after})`);
}
if (results.mouseDrag.before === results.mouseDrag.after) {
  problems.push(`a mouse drag changed nothing (still ${results.mouseDrag.after})`);
}
if (!results.tapSheet.sheetOpened) problems.push('a tap did not open the slider sheet');
else {
  if (results.tapSheet.viaPlus === null || results.tapSheet.viaPlus === results.tapSheet.before) {
    problems.push('the plus button in the sheet changed nothing');
  }
  if (results.tapSheet.viaSlider === null || results.tapSheet.viaSlider === results.tapSheet.viaPlus) {
    problems.push('the slider in the sheet changed nothing');
  }
  if (results.tapSheet.after === results.tapSheet.before) {
    problems.push('the change made in the sheet did not stick after closing it');
  }
}
if (errors.length) problems.push(`page errors: ${[...new Set(errors)].join('; ')}`);

if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(
  '\nPlain sliders work on touch and are the default there, and dials respond to a touch drag, a mouse drag, and a tap.',
);

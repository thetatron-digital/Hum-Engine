/**
 * Headless smoke test.
 *
 * Checks the two things that are easy to break and impossible to notice from
 * a passing build: that the audio graph is actually producing sound rather
 * than silently doing nothing, and that a Shift transitions and returns.
 *
 *   npm run build && npm run preview &
 *   npm run smoke
 */

import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:4173/';
const browser = await chromium.launch({
  // Set CHROME_PATH when the bundled browser is not where Playwright expects.
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
// iPhone-ish viewport so the mobile layout is what gets checked.
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1500);

// Tap a knob-free check first: is the main UI up?
const hasTransport = await page.locator('.transport').count();

// Measure the actual output. An analyser on the destination tells us whether
// the graph is producing sound rather than silently doing nothing.
const level = await page.evaluate(async () => {
  const Tone = window.__tone;
  if (!Tone) return { error: 'Tone not exposed' };
  const ctx = Tone.getContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  Tone.getDestination().connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let peak = 0, sum = 0, frames = 0;
  const started = performance.now();
  while (performance.now() - started < 3000) {
    analyser.getFloatTimeDomainData(data);
    for (let i = 0; i < data.length; i++) {
      const v = Math.abs(data[i]);
      if (v > peak) peak = v;
      sum += v * v;
    }
    frames++;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { peak, rms: Math.sqrt(sum / (frames * data.length)) };
});

// Shift, end to end: press it, and confirm the blend actually moves and then
// settles, and that sound is still coming out on the other side.
await page.getByRole('button', { name: 'Shift', exact: true }).click();
await page.waitForTimeout(700);
const midWidth = await page.locator('.shift-meter-fill').evaluate((el) => el.style.width);
const midState = await page.locator('.shift-state').textContent();
await page.waitForTimeout(9000);
const endWidth = await page.locator('.shift-meter-fill').evaluate((el) => el.style.width);
const endState = await page.locator('.shift-state').textContent();

const shiftedLevel = await page.evaluate(async () => {
  const Tone = window.__tone;
  const ctx = Tone.getContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  Tone.getDestination().connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let peak = 0;
  const started = performance.now();
  while (performance.now() - started < 2000) {
    analyser.getFloatTimeDomainData(data);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    await new Promise((r) => setTimeout(r, 50));
  }
  return peak;
});

await page.getByRole('button', { name: 'Return' }).click();
await page.waitForTimeout(9500);
const returnedState = await page.locator('.shift-state').textContent();

await page.screenshot({ path: process.env.SHOT || '/tmp/shot.png', fullPage: true });
console.log(JSON.stringify({
  hasTransport, level,
  shift: { midWidth, midState, endWidth, endState, shiftedLevel, returnedState },
  errors: errors.filter((e) => !e.includes('ERR_TUNNEL')).slice(0, 12),
}, null, 2));
await browser.close();

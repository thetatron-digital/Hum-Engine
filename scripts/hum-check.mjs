/**
 * End to end check of hum to melody.
 *
 * This covers the flow rather than the detection: permission, loading the
 * pitch worklet, the count-in, the recording window, and arriving at the note
 * view without an error.
 *
 * It deliberately does not assert that notes were found. Chromium's synthetic
 * microphone is a rumble at about 22 Hz, well below anything anyone could sing,
 * and the detector is right to refuse it. Accuracy is covered separately by
 * check:pitch, which feeds the detector known tones.
 *
 *   npm run build && npm run preview &
 *   npm run check:hum
 */

import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:4173/';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
  ],
});
const context = await browser.newContext({ permissions: ['microphone'], viewport: { width: 420, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_')) errors.push(m.text()); });

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1000);

await page.getByRole('tab', { name: 'Bass' }).click();
await page.getByRole('button', { name: /hum a melody into this track/i }).click();
await page.getByRole('button', { name: /start recording/i }).click();

// Count-in is one bar, then two bars of recording, and it begins on the next
// bar line, so roughly twelve seconds. Allow generous slack.
// Note: match only the note view or a startup failure. The standing headphones
// warning also contains the word "microphone", so matching on that would
// resolve instantly and report a pass before anything had happened.
await page.waitForSelector('.note-roll, .warn-box:has-text("could not")', { timeout: 60000 });
await page.waitForTimeout(500);

const result = await page.evaluate(() => ({
  reachedReview: Boolean(document.querySelector('.note-roll')),
  noteCount: document.querySelectorAll('.roll-note').length,
  empty: document.querySelector('.note-roll.is-empty') !== null,
  hints: [...document.querySelectorAll('.hint, .warn-box')].map((el) => el.textContent?.trim()).filter(Boolean),
}));

await page.screenshot({ path: process.env.SHOT || '/tmp/hum.png', fullPage: true });
console.log(JSON.stringify({ ...result, errors }, null, 2));
await browser.close();

const problems = [];
if (!result.reachedReview) problems.push('never reached the note view');
if (errors.length) problems.push(`page errors: ${errors.join('; ')}`);
// Reaching the note view at all means the microphone opened, the worklet
// loaded, the count-in ran and the segmentation returned without throwing.
if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nHum capture flow works end to end.');

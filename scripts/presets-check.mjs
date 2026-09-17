/**
 * Plays every starting song and every lead voice, listening for trouble.
 *
 * Fifteen new voices went in modelled on specific machines, and none of them
 * can be checked by reading the code: a voice with a wrongly wired envelope
 * builds fine, passes the type checker and makes no sound at all. So this
 * loads each preset in turn, measures what actually comes out, and fails on
 * silence or on any error the page throws.
 *
 * It also cycles the Lead track through every voice available to it, which is
 * where the awkward ones live: the hard sync worklet, the distortion chains
 * and the sample-backed instruments that fall back to synths.
 *
 *   npm run build && npm run preview &
 *   npm run check:presets
 */

import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:4173/';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' && !text.includes('ERR_')) errors.push(text);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1200);

// One analyser for the whole run, so measuring is cheap.
await page.evaluate(() => {
  const Tone = window.__tone;
  const analyser = Tone.getContext().createAnalyser();
  analyser.fftSize = 2048;
  Tone.getDestination().connect(analyser);
  window.__probe = { analyser, data: new Float32Array(analyser.fftSize) };
});

const measure = (ms) =>
  page.evaluate(async (duration) => {
    const { analyser, data } = window.__probe;
    let peak = 0;
    let energy = 0;
    let frames = 0;
    const started = performance.now();
    while (performance.now() - started < duration) {
      analyser.getFloatTimeDomainData(data);
      for (let i = 0; i < data.length; i++) {
        const value = Math.abs(data[i]);
        if (value > peak) peak = value;
        energy += data[i] * data[i];
      }
      frames++;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { peak: +peak.toFixed(4), rms: +Math.sqrt(energy / (frames * data.length)).toFixed(5) };
  }, ms);

// --- every starting song ---------------------------------------------------
const names = await page.$$eval('.strip-item', (items) => items.map((el) => el.textContent.trim()));
const presetResults = [];
for (const name of names) {
  await page.locator('.strip-item', { hasText: name }).first().click();
  await page.waitForTimeout(500);
  presetResults.push({ name, ...(await measure(1400)) });
}

// --- every lead voice ------------------------------------------------------
await page.getByRole('tab', { name: 'Lead', exact: true }).click();
// Make sure the track is audible whatever the preset left behind.
const leadOn = await page.locator('.track-switches .toggle').first().textContent();
if (leadOn?.trim() === 'Off') await page.locator('.track-switches .toggle').first().click();

await page.locator('.picker', { hasText: 'Voice' }).locator('.picker-trigger').click();
const voiceNames = await page.$$eval('.sheet-row strong', (items) => items.map((el) => el.textContent.trim()));
await page.locator('.sheet-close').click();

const voiceResults = [];
for (const voice of voiceNames) {
  await page.locator('.picker', { hasText: 'Voice' }).locator('.picker-trigger').click();
  await page.locator('.sheet-row', { hasText: voice }).first().click();
  await page.waitForTimeout(450);
  voiceResults.push({ voice, ...(await measure(1100)) });
}

await browser.close();
console.log(JSON.stringify({ presets: presetResults, leadVoices: voiceResults, errors }, null, 2));

const problems = [];
for (const row of presetResults) {
  if (row.peak < 0.01) problems.push(`preset "${row.name}" is silent (peak ${row.peak})`);
}
// A lead on its own is quiet next to a full mix, so the bar is lower here.
// Zero, though, means the voice is broken.
for (const row of voiceResults) {
  if (row.peak < 0.004) problems.push(`lead voice "${row.voice}" is silent (peak ${row.peak})`);
}
if (errors.length) problems.push(`page errors: ${[...new Set(errors)].join('; ')}`);

if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`\nAll ${presetResults.length} starting songs and ${voiceResults.length} lead voices make sound.`);

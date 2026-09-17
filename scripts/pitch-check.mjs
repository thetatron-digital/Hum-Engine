/**
 * Accuracy check for the pitch detector.
 *
 * Chromium's synthetic microphone is a low frequency rumble around 22 Hz,
 * which the detector correctly refuses because it is nowhere near a singing
 * range. So instead of pretending that is a voice, this drives the worklet
 * with oscillators at known pitches and checks what comes back.
 *
 * This is the test that matters for humming: if these are right, a sung note
 * lands on the right key.
 *
 *   npm run build && npm run preview &
 *   npm run check:pitch
 */

import { chromium } from 'playwright';
import { readdirSync } from 'node:fs';

const URL = (process.env.APP_URL || 'http://localhost:4173/').replace(/\/$/, '');

const asset = readdirSync('dist/assets').find((file) => file.startsWith('pitch-processor-'));
if (!asset) {
  console.error('Build first: no pitch processor found in dist/assets.');
  process.exit(1);
}

// A spread across the range people actually hum in, roughly A2 up to A4.
const TEST_TONES = [110, 146.83, 220, 329.63, 440];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(`${URL}/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(800);

const results = await page.evaluate(
  async ({ workletUrl, tones }) => {
    const Tone = window.__tone;
    const context = Tone.getContext();
    await context.rawContext.audioWorklet.addModule(workletUrl);

    const measure = (frequency, waveform) =>
      new Promise((resolve) => {
        const node = context.createAudioWorkletNode('pitch-detect', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        const osc = context.createOscillator();
        osc.type = waveform;
        osc.frequency.value = frequency;
        const level = context.createGain();
        level.gain.value = 0.25;
        osc.connect(level);
        level.connect(node);

        // Silent path to the destination, otherwise the browser never runs it.
        const mute = context.createGain();
        mute.gain.value = 0;
        node.connect(mute);
        mute.connect(context.rawContext.destination);

        const readings = [];
        node.port.onmessage = (event) => {
          if (event.data.frequency > 0) readings.push(event.data);
        };

        osc.start();
        setTimeout(() => {
          osc.stop();
          node.port.postMessage('stop');
          node.disconnect();
          mute.disconnect();

          if (readings.length === 0) {
            resolve({ frequency, waveform, detected: 0, confidence: 0, readings: 0 });
            return;
          }
          // Median, so one bad frame during the fade in cannot skew it.
          const sorted = readings.map((r) => r.frequency).sort((a, b) => a - b);
          const median = sorted[sorted.length >> 1];
          const confidence =
            readings.reduce((sum, r) => sum + r.confidence, 0) / readings.length;
          resolve({
            frequency,
            waveform,
            detected: +median.toFixed(2),
            confidence: +confidence.toFixed(3),
            readings: readings.length,
          });
        }, 900);
      });

    const out = [];
    for (const tone of tones) {
      // A sawtooth has the harmonic stack a voice has, which is exactly the
      // case where a naive detector reports the wrong octave.
      out.push(await measure(tone, 'sawtooth'));
      out.push(await measure(tone, 'sine'));
    }
    return out;
  },
  { workletUrl: `${URL}/assets/${asset}`, tones: TEST_TONES },
);

await browser.close();

const report = results.map((result) => {
  const cents = result.detected > 0 ? 1200 * Math.log2(result.detected / result.frequency) : null;
  return { ...result, cents: cents === null ? null : Math.round(cents) };
});
console.log(JSON.stringify({ report, errors }, null, 2));

const problems = [];
for (const row of report) {
  const label = `${row.frequency} Hz ${row.waveform}`;
  if (row.readings === 0) { problems.push(`${label}: nothing detected`); continue; }
  if (row.cents === null || Math.abs(row.cents) > 50) {
    problems.push(`${label}: detected ${row.detected} Hz, off by ${row.cents} cents`);
  }
  if (row.confidence < 0.5) problems.push(`${label}: confidence only ${row.confidence}`);
}
if (errors.length) problems.push(`page errors: ${errors.join('; ')}`);

if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
const worst = Math.max(...report.map((r) => Math.abs(r.cents)));
console.log(`\nPitch detection is accurate. Worst case ${worst} cents across ${report.length} tones.`);

/**
 * Checks that a silent mix explains itself.
 *
 * Every control here can be turned down to nothing and the song saves as you
 * go, so it is entirely possible to close the app and reopen it silent. The
 * app is supposed to notice and say which setting did it. This deliberately
 * creates the three worst cases and checks it does.
 *
 * The solo case is the nastiest and the one worth testing hardest: soloing the
 * Sample Chop track with no clip loaded mutes everything else in favour of a
 * track that has nothing to play, and it survives a reload.
 *
 *   npm run build && npm run preview &
 *   npm run check:silence
 */

import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:4173/';
const KEY = 'hum-engine:song:v1';

const CASES = [
  {
    name: 'solo on a track with nothing to play',
    breaks: (song) => { song.tracks.chop.solo = true; },
    expect: /solo/i,
  },
  {
    name: 'master volume at zero',
    breaks: (song) => { song.master.volume = 0; },
    expect: /volume/i,
  },
  {
    name: 'every track off',
    breaks: (song) => { for (const track of Object.values(song.tracks)) track.enabled = false; },
    expect: /every track/i,
  },
  {
    // Not silent, and must not be reported as such. Sweeping the master filter
    // shut is a deliberate performance move, and even at its lowest it still
    // passes the kick, so warning here would interrupt a build.
    name: 'master sweep closed, which is loud enough and deliberate',
    breaks: (song) => { song.master.lowpass = 0; },
    expectQuiet: true,
  },
];

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1000);
await page.locator('.strip-item').first().click();
await page.waitForTimeout(1000);
const baseline = await page.evaluate((key) => localStorage.getItem(key), KEY);

const measure = (ms) =>
  page.evaluate(async (duration) => {
    const Tone = window.__tone;
    const analyser = Tone.getContext().createAnalyser();
    analyser.fftSize = 2048;
    Tone.getDestination().connect(analyser);
    const data = new Float32Array(analyser.fftSize);
    let peak = 0;
    const started = performance.now();
    while (performance.now() - started < duration) {
      analyser.getFloatTimeDomainData(data);
      for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      await new Promise((r) => setTimeout(r, 25));
    }
    return +peak.toFixed(4);
  }, ms);

const results = [];
for (const testCase of CASES) {
  const broken = JSON.parse(baseline);
  testCase.breaks(broken);
  await page.evaluate(({ key, value }) => localStorage.setItem(key, value), {
    key: KEY,
    value: JSON.stringify(broken),
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /tap to start/i }).click();
  await page.waitForTimeout(1200);

  const silentPeak = await measure(1500);
  // The notice waits a couple of seconds of real silence before appearing, so
  // that a gap between hits is never mistaken for everything being broken.
  await page.waitForTimeout(3500);
  const banner = await page.evaluate(() => document.querySelector('.alert p')?.textContent ?? null);

  // Now take the offered fix and confirm the sound comes back.
  let fixedPeak = null;
  const fixButton = page.locator('.alert-fix').first();
  if (await fixButton.count()) {
    await fixButton.click();
    await page.waitForTimeout(900);
    fixedPeak = await measure(1600);
  }
  results.push({ name: testCase.name, silentPeak, banner, fixedPeak });
}

await browser.close();
console.log(JSON.stringify({ results, errors }, null, 2));

const problems = [];
for (let i = 0; i < CASES.length; i++) {
  const testCase = CASES[i];
  const row = results[i];

  if (testCase.expectQuiet) {
    if (row.silentPeak < 0.01) problems.push(`${testCase.name}: expected this to still be audible`);
    if (row.banner) problems.push(`${testCase.name}: warned about silence while still audible, "${row.banner}"`);
    continue;
  }

  if (row.silentPeak >= 0.01) {
    problems.push(`${testCase.name}: expected silence but measured ${row.silentPeak}`);
  }
  if (!row.banner) {
    problems.push(`${testCase.name}: nothing was reported, so the app is silent with no explanation`);
    continue;
  }
  if (!testCase.expect.test(row.banner)) {
    problems.push(`${testCase.name}: reported the wrong reason, "${row.banner}"`);
  }
  if (row.fixedPeak === null) problems.push(`${testCase.name}: no fix was offered`);
  else if (row.fixedPeak < 0.01) {
    problems.push(`${testCase.name}: the fix did not bring the sound back (peak ${row.fixedPeak})`);
  }
}
if (errors.length) problems.push(`page errors: ${[...new Set(errors)].join('; ')}`);

if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(
  `\nSilence explains itself and offers a working fix, and a deliberate filter sweep is left alone.`,
);

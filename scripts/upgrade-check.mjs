/**
 * Boots the app the way an existing user's browser boots it.
 *
 * Every other check starts from an empty browser, which is the one situation a
 * real user is never in. Their browser has a song saved by a previous version,
 * missing whatever fields have been added since, and that save is loaded
 * before a single note plays. If migrating it goes wrong the app can come up
 * looking perfectly normal and completely silent.
 *
 * So this takes the current save, strips out everything added recently to make
 * it look like an older one, puts it back, and checks the app still plays.
 *
 *   npm run build && npm run preview &
 *   npm run check:upgrade
 */

import { chromium } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:4173/';
const KEY = 'hum-engine:song:v1';

/** Fields that did not exist in earlier versions of the song file. */
function ageDown(song) {
  const old = JSON.parse(JSON.stringify(song));
  delete old.palette;
  delete old.master.crush;
  delete old.vocal?.source;
  delete old.vocal?.mode;
  delete old.vocal?.recordingName;
  for (const track of Object.values(old.tracks ?? {})) {
    delete track.riff;
    delete track.phase;
  }
  return old;
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const measure = (page, ms) =>
  page.evaluate(async (duration) => {
    const Tone = window.__tone;
    if (!Tone) return { error: 'audio never started' };
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
    return { peak: +peak.toFixed(4) };
  }, ms);

// --- pass one: a fresh browser, to capture what a current save looks like ---
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' && !text.includes('ERR_')) errors.push(text);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1200);
// Touch a control so the debounced save definitely runs.
await page.locator('.strip-item').first().click();
await page.waitForTimeout(1200);

const current = await page.evaluate((key) => localStorage.getItem(key), KEY);
if (!current) {
  console.error('FAILED: the app saved nothing, so there is no save to age down.');
  process.exit(1);
}

// --- pass two: reload with an older-looking save in place --------------------
const aged = JSON.stringify(ageDown(JSON.parse(current)));
await page.evaluate(
  ({ key, value }) => localStorage.setItem(key, value),
  { key: KEY, value: aged },
);
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1400);

const afterUpgrade = await measure(page, 2500);
// Read the live state rather than the stored file. The save is debounced and
// only written when something changes, so straight after a reload the file on
// disk is still the old one even though the song in memory has been upgraded.
// Touching a control forces the save, and then the file can be trusted.
await page.locator('.mood.is-on, .mood').first().click();
await page.waitForTimeout(900);
const state = await page.evaluate(() => {
  const song = JSON.parse(localStorage.getItem('hum-engine:song:v1') || '{}');
  return {
    palette: song.palette ?? null,
    crush: song.master?.crush ?? null,
    bassRiff: song.tracks?.bass?.riff ?? null,
    leadPhase: song.tracks?.lead?.phase ?? null,
    status: document.querySelector('.status')?.textContent ?? null,
    silenceBanner: document.querySelector('.alert p')?.textContent ?? null,
  };
});

await browser.close();
console.log(JSON.stringify({ afterUpgrade, state, errors: [...new Set(errors)] }, null, 2));

const problems = [];
if (afterUpgrade.error) problems.push(afterUpgrade.error);
else if (afterUpgrade.peak < 0.01) {
  problems.push(`silent after loading an older save (peak ${afterUpgrade.peak})`);
}
if (state.palette === null) problems.push('the note palette was not filled in');
if (state.crush === null) problems.push('the crush setting was not filled in');
if (state.bassRiff === null) problems.push('the bass melody shape was not filled in');
if (state.leadPhase === null) problems.push('the lead swirl was not filled in');
if (state.silenceBanner) problems.push(`an upgraded save reports silence: ${state.silenceBanner}`);
if (errors.length) problems.push(`page errors: ${[...new Set(errors)].join('; ')}`);

if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`\nAn older save upgrades cleanly and still plays. Peak ${afterUpgrade.peak}.`);

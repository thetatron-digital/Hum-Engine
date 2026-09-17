/**
 * Checks that Simple is actually simpler, and that nothing is lost.
 *
 * The app grew until there was no obvious place to start, so it now opens in a
 * short version with the rest folded away. Two things have to hold for that to
 * be worth having: the short version really must be much shorter, and every
 * control must still be reachable rather than quietly deleted.
 *
 *   npm run build && npm run preview &
 *   npm run check:simple
 */

import { chromium, devices } from 'playwright';

const URL = process.env.APP_URL || 'http://localhost:4173/';

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const context = await browser.newContext({ ...devices['iPhone 13'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  const text = m.text();
  if (m.type() === 'error' && !text.includes('ERR_')) errors.push(text);
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1000);

const survey = () =>
  page.evaluate(() => ({
    knobs: document.querySelectorAll('.knob').length,
    pickers: document.querySelectorAll('.picker').length,
    folds: document.querySelectorAll('.reveal-toggle').length,
    pageHeight: document.documentElement.scrollHeight,
  }));

// A new browser should open in the short version.
const startedSimple = await page.evaluate(
  () => document.querySelectorAll('.depth-option')[0]?.classList.contains('is-on') ?? false,
);
const simple = await survey();

// Opening every fold has to bring the rest back.
await page.evaluate(() => {
  for (const toggle of document.querySelectorAll('.reveal-toggle')) toggle.click();
});
await page.waitForTimeout(400);
const unfolded = await survey();

// And so does the switch.
await page.locator('.depth-option', { hasText: 'Everything' }).click();
await page.waitForTimeout(400);
const everything = await survey();

// The choice must survive a reload, or it is not a preference.
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(900);
const afterReload = await page.evaluate(
  () => document.querySelectorAll('.depth-option')[1]?.classList.contains('is-on') ?? false,
);

await browser.close();
console.log(JSON.stringify({ startedSimple, simple, unfolded, everything, rememberedEverything: afterReload, errors }, null, 2));

const problems = [];
if (!startedSimple) problems.push('a new browser did not open in the short version');
if (simple.folds < 4) problems.push(`only ${simple.folds} folds, so the controls are not really tucked away`);
if (simple.knobs > 14) problems.push(`the short version still shows ${simple.knobs} knobs, which is not short`);
if (everything.knobs < simple.knobs * 1.8) {
  problems.push(`Everything shows ${everything.knobs} knobs against ${simple.knobs}, which is not enough of a difference to be worth a switch`);
}
if (unfolded.knobs < everything.knobs * 0.85) {
  problems.push(`opening every fold reached ${unfolded.knobs} knobs but Everything has ${everything.knobs}, so some controls are unreachable in the short version`);
}
if (everything.pageHeight <= simple.pageHeight) {
  problems.push('the short version is not actually a shorter page');
}
if (!afterReload) problems.push('the choice of Everything was forgotten after a reload');
if (errors.length) problems.push(`page errors: ${[...new Set(errors)].join('; ')}`);

if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(
  `\nSimple shows ${simple.knobs} knobs against ${everything.knobs}, everything stays reachable, and the choice sticks.`,
);

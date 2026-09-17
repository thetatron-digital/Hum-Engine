/**
 * End to end check of the export.
 *
 * This is the part most likely to fail quietly. An offline render can produce
 * a perfectly valid file full of silence and report no error, and a
 * multichannel render can fold itself back down to stereo so that every stem
 * is secretly a copy of the mix. Both of those pass a build and both are
 * useless. So this drives the real interface, catches the real downloads, and
 * looks inside the actual WAV files.
 *
 * It also checks the app is still playing afterwards. Rendering has to stop
 * playback while it runs, which means it has to start it again, and an export
 * that leaves the app permanently silent is a worse bug than one that fails.
 *
 *   npm run build && npm run preview &
 *   npm run check:export
 */

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.APP_URL || 'http://localhost:4173/';

/** Read a 16 bit stereo WAV back into peaks and a length. */
function inspectWav(path) {
  const buffer = readFileSync(path);
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    return { error: 'not a WAV file' };
  }
  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bits = buffer.readUInt16LE(34);

  let offset = 12;
  let dataStart = -1;
  let dataLength = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'data') { dataStart = offset + 8; dataLength = size; break; }
    offset += 8 + size;
  }
  if (dataStart < 0) return { error: 'no data chunk' };

  let peak = 0;
  let energy = 0;
  const samples = Math.min(dataLength / 2, (buffer.length - dataStart) / 2);
  for (let i = 0; i < samples; i++) {
    const value = buffer.readInt16LE(dataStart + i * 2) / 32768;
    peak = Math.max(peak, Math.abs(value));
    energy += value * value;
  }
  return {
    channels, sampleRate, bits,
    frames: Math.floor(samples / channels),
    seconds: +(samples / channels / sampleRate).toFixed(2),
    peak: +peak.toFixed(4),
    rms: +Math.sqrt(energy / samples).toFixed(4),
  };
}

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, acceptDownloads: true });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_')) errors.push(m.text()); });

const files = [];
page.on('download', async (download) => {
  const path = join(tmpdir(), `hum-${Date.now()}-${download.suggestedFilename()}`);
  await download.saveAs(path);
  files.push({ name: download.suggestedFilename(), path });
});

await page.goto(URL, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /tap to start/i }).click();
await page.waitForTimeout(1200);

// Keep the render short so the check is quick.
await page.getByRole('button', { name: '4', exact: true }).first().click();
await page.getByRole('button', { name: /export the mix and every track/i }).click();

// Wait for the status line to report a result.
await page.waitForFunction(
  () => [...document.querySelectorAll('.hint')].some((el) => /Done\.|failed|silent/i.test(el.textContent || '')),
  { timeout: 120000 },
);
const status = await page.evaluate(
  () => [...document.querySelectorAll('.hint')].map((el) => el.textContent).find((t) => /Done\.|failed|silent/i.test(t || '')),
);
await page.waitForTimeout(2500);

// Playback is stopped for the duration of a render and has to come back.
const afterExport = await page.evaluate(async () => {
  const Tone = window.__tone;
  const analyser = Tone.getContext().createAnalyser();
  analyser.fftSize = 2048;
  Tone.getDestination().connect(analyser);
  const data = new Float32Array(analyser.fftSize);
  let peak = 0;
  const started = performance.now();
  while (performance.now() - started < 3000) {
    analyser.getFloatTimeDomainData(data);
    for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
    await new Promise((r) => setTimeout(r, 25));
  }
  return {
    peak: +peak.toFixed(4),
    transport: Tone.getTransport().state,
    status: document.querySelector('.status')?.textContent ?? null,
  };
});

await browser.close();

const inspected = files.map((file) => ({ name: file.name, ...inspectWav(file.path) }));
console.log(JSON.stringify({ status, afterExport, errors, files: inspected }, null, 2));

// --- assertions ---
const problems = [];
const mix = inspected.find((f) => f.name.endsWith('-mix.wav'));
const stems = inspected.filter((f) => f !== mix);

if (!mix) problems.push('no mix file was produced');
else {
  if (mix.peak < 0.01) problems.push(`the mix is silent (peak ${mix.peak})`);
  if (mix.sampleRate !== 48000) problems.push(`the mix is ${mix.sampleRate} Hz, expected 48000`);
  if (mix.bits !== 16 || mix.channels !== 2) problems.push('the mix is not 16 bit stereo');
}
if (stems.length < 3) problems.push(`only ${stems.length} stems, expected several`);
for (const stem of stems) {
  if (stem.peak < 0.001) problems.push(`stem ${stem.name} is silent`);
  if (mix && stem.frames !== mix.frames) problems.push(`stem ${stem.name} is a different length from the mix`);
}
// Stems that are byte-identical to the mix mean the channels were folded down.
const suspicious = stems.filter((s) => mix && Math.abs(s.rms - mix.rms) < 1e-6);
if (suspicious.length) problems.push(`these stems look like copies of the mix: ${suspicious.map((s) => s.name).join(', ')}`);
if (afterExport.transport !== 'started') {
  problems.push(`playback did not resume after the export (transport is "${afterExport.transport}")`);
}
if (afterExport.peak < 0.01) {
  problems.push(`the app is silent after exporting (peak ${afterExport.peak})`);
}
if (errors.length) problems.push(`page errors: ${errors.join('; ')}`);

if (problems.length) {
  console.error('\nFAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`\nExport looks correct, and the app is still playing afterwards (peak ${afterExport.peak}).`);

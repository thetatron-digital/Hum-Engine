/**
 * Numeric check of the vocal chain.
 *
 * The DSP is written on plain arrays precisely so it can be checked here,
 * without a browser. Three things are worth asserting: that it produces a
 * signal at all, that the loudness moves over time the way speech does rather
 * than sitting flat, and that the energy lands in the formant range rather
 * than on the carrier's own fundamental, which is the difference between a
 * vocoder and a chord with a volume envelope on it.
 *
 *   npm run check:vocal
 */
import { vocode } from '../src/vocal/vocoder.ts';

const sampleRate = 48000;

/**
 * A stand-in for a recorded voice.
 *
 * Alternating voiced and unvoiced segments at speech-like rates: a buzzing
 * tone with harmonics for the vowels, filtered noise for the consonants, and
 * short silences between words. What matters for this test is that the
 * loudness and the spectrum both move the way a voice does, because that is
 * what the vocoder reads.
 */
function fakeVoice(seconds) {
  const total = Math.round(seconds * sampleRate);
  const out = new Float32Array(total);
  const segment = Math.round(sampleRate * 0.12);
  let phase = 0;
  for (let i = 0; i < total; i++) {
    const which = Math.floor(i / segment);
    const inside = (i % segment) / segment;
    // Every fifth segment is a gap, so there is something for a silence
    // detector to find.
    if (which % 5 === 4) continue;
    const voiced = which % 2 === 0;
    const pitch = 105 + (which % 3) * 18;
    phase += pitch / sampleRate;
    if (phase >= 1) phase -= 1;
    const buzz = 2 * phase - 1;
    const noise = Math.random() * 2 - 1;
    const envelope = Math.min(1, inside * 8, (1 - inside) * 8);
    out[i] = (voiced ? buzz * 0.8 : noise * 0.5) * envelope;
  }
  return out;
}

const modulator = fakeVoice(1.6);

let modPeak = 0, modEnergy = 0;
for (const s of modulator) { modPeak = Math.max(modPeak, Math.abs(s)); modEnergy += s * s; }

const out = vocode(modulator, {
  sampleRate, mode: 'vocoder', bands: 10, carrierNotes: [50, 57, 62, 65], brightness: 0.8, formantShift: 1, sibilance: 0.25,
});

let peak = 0, energy = 0, zeroCrossings = 0;
for (let i = 0; i < out.length; i++) {
  peak = Math.max(peak, Math.abs(out[i]));
  energy += out[i] * out[i];
  if (i > 0 && Math.sign(out[i]) !== Math.sign(out[i - 1])) zeroCrossings++;
}

// Envelope over time: a spoken phrase must vary, not sit at one level.
const chunks = 16, size = Math.floor(out.length / chunks), levels = [];
for (let c = 0; c < chunks; c++) {
  let sum = 0;
  for (let i = c * size; i < (c + 1) * size; i++) sum += out[i] * out[i];
  levels.push(Math.sqrt(sum / size));
}
const maxLevel = Math.max(...levels), minLevel = Math.min(...levels);

console.log(JSON.stringify({
  modulator: { samples: modulator.length, peak: +modPeak.toFixed(3), rms: +Math.sqrt(modEnergy / modulator.length).toFixed(4) },
  vocoded: { samples: out.length, peak: +peak.toFixed(3), rms: +Math.sqrt(energy / out.length).toFixed(4) },
  approxDominantHz: Math.round((zeroCrossings / 2) / (out.length / sampleRate)),
  envelope: levels.map((v) => +v.toFixed(3)),
  dynamicRange: +(maxLevel / Math.max(1e-6, minLevel)).toFixed(1),
}, null, 2));

const problems = [];
if (peak < 0.5) problems.push('vocoded output is too quiet');
if (Math.sqrt(energy / out.length) < 0.02) problems.push('vocoded output is close to silent');
if (maxLevel / Math.max(1e-6, minLevel) < 1.5) problems.push('loudness does not move, so it will not sound like speech');
if (Math.round((zeroCrossings / 2) / (out.length / sampleRate)) < 300) problems.push('energy sits too low, the bands are not shaping the carrier');

if (problems.length) {
  console.error('FAILED:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log('\nVocal chain looks correct.');

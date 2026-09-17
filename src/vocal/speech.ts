/**
 * Robotic speech from typed text.
 *
 * A note on what this is and is not. Real singing synthesis, the kind that
 * produces a convincing human voice, is not something a browser can do without
 * a large model and a server. What a browser can do well is formant synthesis:
 * build a voice from scratch out of a buzz and three resonances, which is how
 * talking machines sounded before recordings were involved.
 *
 * That turns out to be exactly right here, because the target sound is a robot
 * voice. This produces the modulator, which then gets multiplied by a chord in
 * vocoder.ts. The chord supplies the pitch and the harmony; this supplies the
 * words.
 *
 * It reads spelling rather than proper pronunciation, so it has an accent. It
 * is meant to.
 */

import { bandpass, highpass, step, type Biquad } from './dsp';

interface Phoneme {
  /** Resonances that define the vowel, in hertz. */
  formants: [number, number, number];
  /** Voiced sounds use the buzz, unvoiced use noise. */
  voiced: boolean;
  /** Relative length. */
  length: number;
  /** A stop closes the mouth first, giving a hard edge. */
  stop?: boolean;
}

/**
 * Formant values for English vowels, roughly as measured for an adult voice.
 * Consonants are approximations chosen to be distinguishable rather than
 * accurate.
 */
const PHONEMES: Record<string, Phoneme> = {
  a: { formants: [730, 1090, 2440], voiced: true, length: 1.2 },
  e: { formants: [530, 1840, 2480], voiced: true, length: 1.1 },
  i: { formants: [390, 1990, 2550], voiced: true, length: 1 },
  o: { formants: [570, 840, 2410], voiced: true, length: 1.2 },
  u: { formants: [440, 1020, 2240], voiced: true, length: 1.1 },
  y: { formants: [300, 2200, 3000], voiced: true, length: 0.9 },

  m: { formants: [250, 1100, 2200], voiced: true, length: 0.7 },
  n: { formants: [280, 1700, 2600], voiced: true, length: 0.7 },
  l: { formants: [360, 1300, 2700], voiced: true, length: 0.7 },
  r: { formants: [420, 1300, 1600], voiced: true, length: 0.7 },
  w: { formants: [300, 610, 2200], voiced: true, length: 0.6 },
  v: { formants: [280, 1100, 2400], voiced: true, length: 0.6 },
  z: { formants: [300, 1600, 2600], voiced: true, length: 0.7 },
  j: { formants: [300, 2000, 2800], voiced: true, length: 0.6 },
  b: { formants: [300, 800, 2300], voiced: true, length: 0.5, stop: true },
  d: { formants: [300, 1700, 2600], voiced: true, length: 0.5, stop: true },
  g: { formants: [300, 1400, 2200], voiced: true, length: 0.5, stop: true },

  s: { formants: [1000, 4500, 6500], voiced: false, length: 0.8 },
  f: { formants: [1000, 2500, 5500], voiced: false, length: 0.7 },
  h: { formants: [700, 1500, 2500], voiced: false, length: 0.5 },
  t: { formants: [1200, 3000, 5000], voiced: false, length: 0.45, stop: true },
  k: { formants: [900, 2000, 3500], voiced: false, length: 0.45, stop: true },
  p: { formants: [700, 1200, 2400], voiced: false, length: 0.45, stop: true },
  c: { formants: [900, 2000, 3500], voiced: false, length: 0.45, stop: true },
  x: { formants: [1000, 3000, 5000], voiced: false, length: 0.6 },
  q: { formants: [900, 2000, 3500], voiced: false, length: 0.5, stop: true },
};

const SILENCE: Phoneme = { formants: [0, 0, 0], voiced: false, length: 0.6 };

/** A handful of two-letter spellings that would otherwise read badly. */
const DIGRAPHS: Record<string, string> = {
  th: 'z',
  sh: 's',
  ch: 't',
  ph: 'f',
  ck: 'k',
  qu: 'k',
  oo: 'u',
  ee: 'i',
  ea: 'i',
  ou: 'o',
  ai: 'e',
  ay: 'e',
};

export function textToPhonemes(text: string): Phoneme[] {
  const cleaned = text.toLowerCase().replace(/[^a-z\s]/g, '');
  const out: Phoneme[] = [];
  let i = 0;

  while (i < cleaned.length) {
    const character = cleaned[i];
    if (character === ' ') {
      out.push(SILENCE);
      i++;
      continue;
    }
    const pair = cleaned.slice(i, i + 2);
    const mapped = DIGRAPHS[pair];
    if (mapped) {
      out.push(PHONEMES[mapped] ?? SILENCE);
      i += 2;
      continue;
    }
    out.push(PHONEMES[character] ?? SILENCE);
    i++;
  }
  return out;
}

export interface SpeechOptions {
  sampleRate: number;
  /** Seconds the whole phrase should take. Everything is stretched to fit. */
  duration: number;
  /** Pitch of the buzz. The vocoder replaces it, but it sets the texture. */
  pitch: number;
  /** Multiplies every formant. Above 1 sounds smaller and more synthetic. */
  formantShift: number;
}

/**
 * Render the modulator.
 *
 * A buzzing sawtooth stands in for vocal cords, noise stands in for breath,
 * and three sharp resonances stand in for the shape of a mouth. Sweeping those
 * resonances from one target to the next is what makes it sound like it is
 * moving between sounds rather than cutting between them.
 */
export function renderSpeech(text: string, options: SpeechOptions): Float32Array {
  const { sampleRate, duration, pitch, formantShift } = options;
  const total = Math.max(1, Math.round(duration * sampleRate));
  const out = new Float32Array(total);

  const phonemes = textToPhonemes(text);
  if (phonemes.length === 0) return out;

  const weight = phonemes.reduce((sum, phoneme) => sum + phoneme.length, 0);
  const perUnit = total / weight;

  const filters: Biquad[] = [
    bandpass(500, 9, sampleRate),
    bandpass(1500, 11, sampleRate),
    bandpass(2500, 13, sampleRate),
  ];
  const breath = highpass(1200, 0.7, sampleRate);

  let phase = 0;
  let cursor = 0;
  // Current resonance positions, which chase their targets rather than jumping.
  let current: [number, number, number] = [500, 1500, 2500];

  for (let index = 0; index < phonemes.length; index++) {
    const phoneme = phonemes[index];
    const length = Math.max(1, Math.round(phoneme.length * perUnit));
    const target: [number, number, number] = [
      phoneme.formants[0] * formantShift,
      phoneme.formants[1] * formantShift,
      phoneme.formants[2] * formantShift,
    ];
    const silent = phoneme.formants[0] === 0;

    for (let i = 0; i < length && cursor < total; i++, cursor++) {
      const through = i / length;

      // Glide toward the new mouth shape over the first third of the sound.
      if (!silent) {
        const chase = Math.min(1, through * 3) * 0.06;
        current = [
          current[0] + (target[0] - current[0]) * chase,
          current[1] + (target[1] - current[1]) * chase,
          current[2] + (target[2] - current[2]) * chase,
        ];
        filters[0] = retune(filters[0], current[0], 9, sampleRate);
        filters[1] = retune(filters[1], current[1], 11, sampleRate);
        filters[2] = retune(filters[2], current[2], 13, sampleRate);
      }

      if (silent) continue;

      // A stop consonant stays shut for its first third, which is what gives
      // a hard sound its hardness.
      const closed = phoneme.stop === true && through < 0.35;
      if (closed) continue;

      phase += pitch / sampleRate;
      if (phase >= 1) phase -= 1;

      const buzz = 2 * phase - 1;
      const noise = Math.random() * 2 - 1;
      const source = phoneme.voiced ? buzz * 0.85 + noise * 0.06 : step(breath, noise) * 0.8;

      const shaped =
        step(filters[0], source) * 1 +
        step(filters[1], source) * 0.65 +
        step(filters[2], source) * 0.32;

      // Taper the edges of every sound so the phrase does not click along.
      const edge = Math.min(1, through * 12, (1 - through) * 12);
      out[cursor] = shaped * edge * (phoneme.voiced ? 1 : 0.75);
    }
  }

  return out;
}

/** Move a bandpass to a new centre without losing what it has already heard. */
function retune(filter: Biquad, frequency: number, q: number, sampleRate: number): Biquad {
  const next = bandpass(frequency, q, sampleRate);
  next.x1 = filter.x1;
  next.x2 = filter.x2;
  next.y1 = filter.y1;
  next.y2 = filter.y2;
  return next;
}

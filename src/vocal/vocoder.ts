/**
 * The vocoder. This is the Daft Punk robot voice.
 *
 * A vocoder splits a voice into frequency bands, measures how loud each band
 * is moment to moment, and then uses those measurements to shape the same
 * bands of a completely different sound. The voice supplies the words; the
 * other sound supplies the pitch. Feed it a chord and the chord appears to be
 * singing.
 *
 * It renders to a finished buffer rather than running live. That is a
 * deliberate trade: a phrase only has to be built when the words or the chord
 * change, the result plays back as an ordinary sample, and because it is a
 * sample it exports correctly with everything else.
 */

import { bandpass, lowpass, highpass, step, reset, normalisePeak, fadeEdges } from './dsp';
import { midiToFrequency } from '../music/moods';

/**
 * Two ways of making a voice out of a synth, and they do not sound alike.
 *
 * A vocoder splits the voice into a fixed row of frequency bands. That is the
 * Roland SVC-350 sound heard all over Discovery, and it is the choral,
 * harmonised robot.
 *
 * A talkbox is a physical thing: the synth is piped into the player's mouth
 * and the mouth shapes it. There are no fixed bands, just two or three strong
 * resonances moving around, and the synth's own low end comes through
 * unshaped. That is a nasal, vowel-heavy, much more human sound, and it is
 * what Around the World is.
 */
export type VocalMode = 'vocoder' | 'talkbox';

export interface VocoderOptions {
  sampleRate: number;
  mode: VocalMode;
  /** More bands means clearer words, fewer means a thicker, cruder robot. */
  bands: number;
  /** Notes the carrier plays, as MIDI numbers. Usually the current chord. */
  carrierNotes: number[];
  /** 0 is a dark hum, 1 is a bright buzzing stack of sawtooths. */
  brightness: number;
  /**
   * Moves the carrier's bands relative to the voice's. Above 1 makes the
   * speaker sound smaller, below 1 makes it sound enormous.
   */
  formantShift: number;
  /** How much unshaped breath to let through, which restores the sibilance. */
  sibilance: number;
}

/**
 * Band centres, spaced evenly by ear rather than by hertz.
 *
 * The talkbox layout is narrower on purpose: it crowds the bands into the
 * range where vowels live and leaves the extremes alone, which is roughly what
 * a mouth does to a sound.
 */
function bandCentres(count: number, mode: VocalMode): number[] {
  const low = mode === 'talkbox' ? 260 : 160;
  const high = mode === 'talkbox' ? 3400 : 6200;
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(low * Math.pow(high / low, i / Math.max(1, count - 1)));
  }
  return out;
}

/**
 * Build the sound that will do the singing: detuned sawtooths, one stack per
 * note of the chord.
 */
function renderCarrier(
  length: number,
  sampleRate: number,
  notes: number[],
  brightness: number,
): Float32Array {
  const out = new Float32Array(length);
  if (notes.length === 0) return out;

  const detunes = [-0.09, -0.03, 0.03, 0.09];
  const gain = 1 / (notes.length * detunes.length);

  for (const note of notes) {
    const base = midiToFrequency(note);
    for (const detune of detunes) {
      const frequency = base * Math.pow(2, detune / 12);
      const increment = frequency / sampleRate;
      let phase = Math.random();
      for (let i = 0; i < length; i++) {
        phase += increment;
        if (phase >= 1) phase -= 1;
        const saw = 2 * phase - 1;
        // Blending toward a square at low brightness thins the harmonics the
        // bands have to work with, which reads as a darker robot.
        const square = phase < 0.5 ? 1 : -1;
        out[i] += (saw * brightness + square * (1 - brightness) * 0.6) * gain;
      }
    }
  }
  return out;
}

/**
 * Do the vocoding.
 *
 * For each band: measure the voice, shape the carrier. The measurement is a
 * rectifier followed by a slow filter, which is just "how loud has this band
 * been recently". Fast enough to follow speech, slow enough not to reproduce
 * the voice's own pitch.
 */
export function vocode(modulator: Float32Array, options: VocoderOptions): Float32Array {
  const { sampleRate, mode, bands, carrierNotes, brightness, formantShift, sibilance } = options;
  const length = modulator.length;
  const out = new Float32Array(length);
  const carrier = renderCarrier(length, sampleRate, carrierNotes, brightness);
  const centres = bandCentres(bands, mode);

  // Wider bands when there are fewer of them, so the whole range stays
  // covered. A talkbox's resonances are much sharper than a vocoder's bands.
  const q = mode === 'talkbox' ? Math.max(5, bands / 1.6) : Math.max(2, bands / 3.2);

  for (let b = 0; b < centres.length; b++) {
    const centre = centres[b];
    const voiceBand = bandpass(centre, q, sampleRate);
    const carrierBand = bandpass(Math.min(centre * formantShift, sampleRate * 0.45), q, sampleRate);
    // Following slower at the bottom and faster at the top matches how speech
    // actually moves, and stops low bands from buzzing at the voice's pitch.
    const follower = lowpass(centre < 800 ? 22 : 45, 0.7071, sampleRate);
    reset(follower);

    for (let i = 0; i < length; i++) {
      const measured = step(follower, Math.abs(step(voiceBand, modulator[i])));
      out[i] += step(carrierBand, carrier[i]) * measured * (mode === 'talkbox' ? 3.4 : 2.6);
    }
  }

  // A talkbox passes the synth's own low end through unshaped, because a mouth
  // does very little to those frequencies. It is most of why a talkbox sounds
  // like an instrument talking and a vocoder sounds like a choir.
  if (mode === 'talkbox') {
    const body = lowpass(240, 0.7071, sampleRate);
    for (let i = 0; i < length; i++) out[i] += step(body, carrier[i]) * 0.5;
  }

  /*
   * The consonant channel.
   *
   * Consonants like s, t and k live above where the bands can usefully follow
   * anything, so they have to come from the voice itself. The Roland SVC-350
   * that made most of these records had ten bands plus exactly this: one extra
   * channel carrying a high passed copy of the voice, gated so it only opens
   * when there is actually a consonant there.
   *
   * The gate is the part that matters. Passing the high end through
   * continuously, which is the obvious way to do it, adds a constant hiss and
   * leaks the original voice's pitch back in underneath the chord. Gating it
   * means you get the crack of the consonant and silence in between.
   */
  if (sibilance > 0) {
    const air = highpass(3800, 0.7071, sampleRate);
    const detector = lowpass(90, 0.7071, sampleRate);
    let gate = 0;
    for (let i = 0; i < length; i++) {
      const bright = step(air, modulator[i]);
      const level = step(detector, Math.abs(bright));
      // Opens quickly on a consonant and closes slowly, so the tail of an s
      // is not chopped off.
      const wanted = level > 0.006 ? 1 : 0;
      gate += (wanted - gate) * (wanted > gate ? 0.02 : 0.0015);
      out[i] += bright * gate * sibilance * 1.4;
    }
  }

  normalisePeak(out, 0.92);
  fadeEdges(out, Math.round(sampleRate * 0.006));
  return out;
}

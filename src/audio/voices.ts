/**
 * Voices: the thing that actually makes a sound when a step fires.
 *
 * A voice owns its oscillators and its own amplitude shape. It does not own
 * the filter, the reverb send or the volume, because those belong to the
 * track and need to stay put when you change voice.
 *
 * Voices built from recordings start life as a synth and quietly upgrade
 * themselves once the files arrive. That way the first tap makes a sound
 * immediately, even on a slow phone, and nothing breaks if the download fails.
 */

import * as Tone from 'tone';
import type { SynthKind, VoiceDef } from './voiceCatalog';
import { midiToFrequency } from '../music/moods';
import { cachedBuffer, dirtUrl, instrumentSampler, loadBuffer } from './samples';

export interface TriggerOptions {
  /** A single note, for monophonic voices. */
  midi?: number;
  /** A chord. Polyphonic voices play all of them. */
  notes?: number[];
  velocity: number;
  /** How long the note should sound, in seconds. */
  duration: number;
  /** 0 to 1, only used by the Tear voice. */
  sync?: number;
  /** Which slice of a loaded clip to play, for the chopper. */
  slice?: number;
  /** Total number of slices the clip is divided into. */
  sliceCount?: number;
  reverse?: boolean;
  /** Overrides the sampled clip, used by the Sample Chop track. */
  bufferKey?: string;
}

export interface Voice {
  output: Tone.ToneAudioNode;
  trigger(time: number, options: TriggerOptions): void;
  dispose(): void;
}

function freq(options: TriggerOptions, fallback = 220): number {
  if (options.midi !== undefined) return midiToFrequency(options.midi);
  if (options.notes && options.notes.length) return midiToFrequency(options.notes[0]);
  return fallback;
}

function chordFrequencies(options: TriggerOptions): number[] {
  if (options.notes && options.notes.length) return options.notes.map(midiToFrequency);
  if (options.midi !== undefined) return [midiToFrequency(options.midi)];
  return [220];
}

// ---------------------------------------------------------------------------
// Hard sync worklet plumbing
// ---------------------------------------------------------------------------

const workletUrl = new URL('./hardsync-processor.js', import.meta.url);
const registeredContexts = new WeakSet<BaseAudioContext>();

/**
 * Register the hard sync processor with a context. Has to happen again for the
 * offline context used by the export, which is why this takes a context rather
 * than assuming the live one.
 */
export async function registerWorklets(context: BaseAudioContext): Promise<boolean> {
  if (registeredContexts.has(context)) return true;
  const target = context as BaseAudioContext & { audioWorklet?: AudioWorklet };
  if (!target.audioWorklet) return false;
  try {
    await target.audioWorklet.addModule(workletUrl.href);
    registeredContexts.add(context);
    return true;
  } catch {
    return false;
  }
}

export function hasWorklet(context: BaseAudioContext): boolean {
  return registeredContexts.has(context);
}

// ---------------------------------------------------------------------------
// Individual voices
// ---------------------------------------------------------------------------

function makeKick(def: VoiceDef): Voice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.035,
    octaves: 6,
    oscillator: { type: 'sine' },
    envelope: { attack: 0.001, decay: def.release ?? 0.28, sustain: 0, release: 0.02 },
  });
  const drive = new Tone.Distortion({ distortion: def.brightness && def.brightness > 3000 ? 0.55 : 0.12, wet: 1 });
  synth.connect(drive);
  return {
    output: drive,
    trigger: (time, options) =>
      synth.triggerAttackRelease(def.brightness === 300 ? 'C1' : 'C2', 0.12, time, options.velocity),
    dispose: () => {
      synth.dispose();
      drive.dispose();
    },
  };
}

function makeSnare(): Voice {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.16, sustain: 0 },
  });
  const body = new Tone.MembraneSynth({
    pitchDecay: 0.02,
    octaves: 3,
    envelope: { attack: 0.001, decay: 0.09, sustain: 0 },
  });
  const tone = new Tone.Filter(1400, 'bandpass');
  const out = new Tone.Gain(1);
  noise.connect(tone);
  tone.connect(out);
  body.connect(out);
  return {
    output: out,
    trigger: (time, options) => {
      noise.triggerAttackRelease(0.1, time, options.velocity);
      body.triggerAttackRelease('G2', 0.05, time, options.velocity * 0.5);
    },
    dispose: () => {
      noise.dispose();
      body.dispose();
      tone.dispose();
      out.dispose();
    },
  };
}

/** A clap is several very short noise bursts a few milliseconds apart. */
function makeClap(): Voice {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.13, sustain: 0 },
  });
  const tone = new Tone.Filter(1100, 'bandpass');
  tone.Q.value = 1.2;
  noise.connect(tone);
  return {
    output: tone,
    trigger: (time, options) => {
      const spread = [0, 0.009, 0.018];
      spread.forEach((offset, index) => {
        noise.triggerAttackRelease(index === 2 ? 0.12 : 0.02, time + offset, options.velocity * (index === 2 ? 1 : 0.6));
      });
    },
    dispose: () => {
      noise.dispose();
      tone.dispose();
    },
  };
}

function makeHat(def: VoiceDef): Voice {
  const noise = new Tone.NoiseSynth({
    noise: { type: def.brightness === 6000 ? 'pink' : 'white' },
    envelope: { attack: 0.001, decay: def.release ?? 0.05, sustain: 0 },
  });
  const highpass = new Tone.Filter(def.brightness ?? 7500, 'highpass');
  noise.connect(highpass);
  return {
    output: highpass,
    trigger: (time, options) => noise.triggerAttackRelease(def.release ?? 0.04, time, options.velocity),
    dispose: () => {
      noise.dispose();
      highpass.dispose();
    },
  };
}

function makeTom(def: VoiceDef): Voice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.008,
    octaves: 2,
    envelope: { attack: 0.001, decay: 0.08, sustain: 0 },
  });
  const band = new Tone.Filter(def.brightness ?? 900, 'bandpass');
  band.Q.value = 2;
  synth.connect(band);
  return {
    output: band,
    trigger: (time, options) => synth.triggerAttackRelease('C4', 0.05, time, options.velocity * 0.8),
    dispose: () => {
      synth.dispose();
      band.dispose();
    },
  };
}

/**
 * Tone's option types are stricter than its runtime, so synth settings are
 * described loosely here and handed straight through.
 */
type SynthOptions = Record<string, unknown>;

function makePoly(options: SynthOptions, gain = 0.35): { synth: Tone.PolySynth; out: Tone.Gain } {
  const synth = new Tone.PolySynth(Tone.Synth, options as never);
  const out = new Tone.Gain(gain);
  synth.connect(out);
  return { synth, out };
}

function polyVoice(options: SynthOptions, gain: number): Voice {
  const { synth, out } = makePoly(options, gain);
  return {
    output: out,
    trigger: (time, opts) =>
      synth.triggerAttackRelease(chordFrequencies(opts), opts.duration, time, opts.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

/** The detuned sawtooth stack at the heart of the whole genre. */
function makeSupersaw(def: VoiceDef): Voice {
  return polyVoice(
    {
      oscillator: { type: 'fatsawtooth', count: 5, spread: 34 },
      envelope: {
        attack: 0.006,
        decay: 0.2,
        sustain: def.release && def.release < 0.3 ? 0 : 0.7,
        release: def.release ?? 0.45,
      },
    },
    0.22,
  );
}

/** Two oscillators and a filter that sings, in the spirit of a MicroKorg. */
function makeMicroKorg(): Voice {
  const out = new Tone.Gain(0.24);
  const oscA = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 22 },
    envelope: { attack: 0.004, decay: 0.25, sustain: 0.6, release: 0.35 },
  } as never);
  const oscB = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'square' },
    detune: -1200,
    envelope: { attack: 0.004, decay: 0.3, sustain: 0.5, release: 0.35 },
  } as never);
  const blend = new Tone.Gain(0.55);
  oscA.connect(out);
  oscB.connect(blend);
  blend.connect(out);
  return {
    output: out,
    trigger: (time, options) => {
      const notes = chordFrequencies(options);
      oscA.triggerAttackRelease(notes, options.duration, time, options.velocity);
      oscB.triggerAttackRelease(notes, options.duration, time, options.velocity * 0.7);
    },
    dispose: () => {
      oscA.dispose();
      oscB.dispose();
      blend.dispose();
      out.dispose();
    },
  };
}

function makeMonoBass(): Voice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.005, decay: 0.2, sustain: 0.75, release: 0.12 },
    filterEnvelope: { attack: 0.005, decay: 0.12, sustain: 0.4, release: 0.2, baseFrequency: 120, octaves: 2.5 },
    filter: { Q: 1.5, type: 'lowpass', rolloff: -24 },
  });
  const out = new Tone.Gain(0.5);
  synth.connect(out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(freq(options, 55), options.duration, time, options.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

function makeSubBass(): Voice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.02, decay: 0.3, sustain: 0.9, release: 0.35 },
    filterEnvelope: { attack: 0.01, decay: 0.2, sustain: 1, release: 0.3, baseFrequency: 200, octaves: 1 },
  });
  const out = new Tone.Gain(0.62);
  synth.connect(out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(freq(options, 45), options.duration, time, options.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

/** The 303 sound: one oscillator, a steep resonant filter, and a fast sweep. */
function makeAcid(): Voice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.002, decay: 0.18, sustain: 0.25, release: 0.08 },
    filterEnvelope: { attack: 0.002, decay: 0.22, sustain: 0.08, release: 0.15, baseFrequency: 160, octaves: 4.5, exponent: 2 },
    filter: { Q: 8, type: 'lowpass', rolloff: -24 },
    portamento: 0.02,
  });
  const out = new Tone.Gain(0.42);
  synth.connect(out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(freq(options, 82), options.duration, time, options.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

/**
 * Tear: the hard sync lead. Falls back to a detuned square through a screaming
 * filter if the browser will not give us an AudioWorklet, which is close in
 * spirit but noticeably tamer.
 */
function makeTear(context: BaseAudioContext): Voice {
  if (!hasWorklet(context)) {
    const synth = new Tone.MonoSynth({
      oscillator: { type: 'fatsquare', count: 3, spread: 40 },
      envelope: { attack: 0.004, decay: 0.2, sustain: 0.7, release: 0.25 },
      filterEnvelope: { attack: 0.004, decay: 0.25, sustain: 0.5, release: 0.3, baseFrequency: 300, octaves: 4 },
      filter: { Q: 9, type: 'lowpass', rolloff: -24 },
    });
    const out = new Tone.Gain(0.3);
    synth.connect(out);
    return {
      output: out,
      trigger: (time, options) => {
        synth.filter.Q.setValueAtTime(4 + (options.sync ?? 0) * 14, time);
        synth.triggerAttackRelease(freq(options, 330), options.duration, time, options.velocity);
      },
      dispose: () => {
        synth.dispose();
        out.dispose();
      },
    };
  }

  const node = new AudioWorkletNode(context, 'hard-sync', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [1],
  });
  const envelope = new Tone.AmplitudeEnvelope({ attack: 0.005, decay: 0.15, sustain: 0.75, release: 0.25 });
  const out = new Tone.Gain(0.3);
  Tone.connect(node, envelope);
  envelope.connect(out);

  const frequency = node.parameters.get('frequency')!;
  const sync = node.parameters.get('sync')!;
  const shape = node.parameters.get('shape')!;

  return {
    output: out,
    trigger: (time, options) => {
      frequency.setValueAtTime(freq(options, 330), time);
      // Sync Amount 0 is a plain saw; 1 runs the slave five times ahead, which
      // is where it starts to sound like it is being torn apart.
      sync.setValueAtTime(1 + (options.sync ?? 0) * 4.2, time);
      shape.setValueAtTime(Math.min(0.8, (options.sync ?? 0) * 0.5), time);
      envelope.triggerAttackRelease(options.duration, time, options.velocity);
    },
    dispose: () => {
      node.disconnect();
      envelope.dispose();
      out.dispose();
    },
  };
}

function makeFm(def: VoiceDef): Voice {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: def.brightness === 2200 ? 2 : 3.2,
    modulationIndex: def.brightness === 2200 ? 6 : 12,
    envelope: { attack: 0.004, decay: 0.4, sustain: 0.25, release: 0.7 },
    modulationEnvelope: { attack: 0.002, decay: 0.3, sustain: 0.1, release: 0.3 },
  } as never);
  const out = new Tone.Gain(0.26);
  synth.connect(out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(chordFrequencies(options), options.duration, time, options.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

function makeOrgan(): Voice {
  return polyVoice(
    {
      oscillator: { type: 'custom', partials: [1, 0.55, 0.35, 0.2, 0.12] },
      envelope: { attack: 0.01, decay: 0.05, sustain: 0.9, release: 0.25 },
    },
    0.2,
  );
}

function makePluck(): Voice {
  return polyVoice(
    {
      oscillator: { type: 'fatsquare', count: 3, spread: 18 },
      envelope: { attack: 0.002, decay: 0.16, sustain: 0, release: 0.2 },
    },
    0.24,
  );
}

function makeWarmPad(): Voice {
  return polyVoice(
    {
      oscillator: { type: 'fattriangle', count: 4, spread: 28 },
      envelope: { attack: 0.9, decay: 1.2, sustain: 0.75, release: 2.4 },
    },
    0.2,
  );
}

function makeGlassPad(): Voice {
  const synth = new Tone.PolySynth(Tone.AMSynth, {
    harmonicity: 3,
    envelope: { attack: 0.7, decay: 1, sustain: 0.6, release: 2.6 },
    modulation: { type: 'sine' },
  } as never);
  const out = new Tone.Gain(0.2);
  synth.connect(out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(chordFrequencies(options), options.duration, time, options.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

/** Voice-like held tones. Not a real choir, but it reads as one under reverb. */
function makeChoir(): Voice {
  const { synth, out } = makePoly(
    {
      oscillator: { type: 'fatsine', count: 3, spread: 16 },
      envelope: { attack: 0.55, decay: 0.8, sustain: 0.8, release: 1.8 },
    },
    0.22,
  );
  // A gentle formant bump is most of what makes a sine stack sound vocal.
  const formant = new Tone.Filter(820, 'bandpass');
  formant.Q.value = 0.9;
  const direct = new Tone.Gain(0.55);
  const shaped = new Tone.Gain(0.8);
  const vibrato = new Tone.Vibrato(4.6, 0.06);
  const result = new Tone.Gain(1);
  out.disconnect();
  out.connect(direct);
  out.connect(formant);
  formant.connect(shaped);
  direct.connect(vibrato);
  shaped.connect(vibrato);
  vibrato.connect(result);
  return {
    output: result,
    trigger: (time, options) =>
      synth.triggerAttackRelease(chordFrequencies(options), options.duration, time, options.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
      formant.dispose();
      direct.dispose();
      shaped.dispose();
      vibrato.dispose();
      result.dispose();
    },
  };
}

function makeNoise(): Voice {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'pink' },
    envelope: { attack: 0.25, decay: 0.4, sustain: 0.3, release: 1.2 },
  });
  const band = new Tone.Filter(1800, 'bandpass');
  band.Q.value = 1.4;
  const out = new Tone.Gain(0.3);
  noise.connect(band);
  band.connect(out);
  return {
    output: out,
    trigger: (time, options) => noise.triggerAttackRelease(options.duration, time, options.velocity * 0.7),
    dispose: () => {
      noise.dispose();
      band.dispose();
      out.dispose();
    },
  };
}

/** A sweep that climbs for the whole note and lands at the top. */
function makeRiser(): Voice {
  const noise = new Tone.Noise('white');
  const band = new Tone.Filter(400, 'bandpass');
  band.Q.value = 3.5;
  const envelope = new Tone.AmplitudeEnvelope({ attack: 0.5, decay: 0.1, sustain: 1, release: 0.25 });
  const out = new Tone.Gain(0.34);
  noise.connect(band);
  band.connect(envelope);
  envelope.connect(out);
  noise.start();
  return {
    output: out,
    trigger: (time, options) => {
      const length = Math.max(0.4, options.duration);
      band.frequency.cancelScheduledValues(time);
      band.frequency.setValueAtTime(320, time);
      band.frequency.exponentialRampToValueAtTime(9000, time + length);
      envelope.triggerAttackRelease(length, time, options.velocity);
    },
    dispose: () => {
      noise.stop();
      noise.dispose();
      band.dispose();
      envelope.dispose();
      out.dispose();
    },
  };
}

function makeBoom(): Voice {
  const synth = new Tone.MembraneSynth({
    pitchDecay: 0.4,
    octaves: 8,
    envelope: { attack: 0.002, decay: 1.6, sustain: 0, release: 0.6 },
  });
  const out = new Tone.Gain(0.7);
  synth.connect(out);
  return {
    output: out,
    trigger: (time, options) => synth.triggerAttackRelease('C1', 1.2, time, options.velocity),
    dispose: () => {
      synth.dispose();
      out.dispose();
    },
  };
}

const reversedCache = new Map<string, Tone.ToneAudioBuffer>();

/** A mirrored copy of a clip, made once and kept. */
function reversedBuffer(key: string, buffer: Tone.ToneAudioBuffer): Tone.ToneAudioBuffer {
  const existing = reversedCache.get(key);
  if (existing) return existing;
  const copy = new Tone.ToneAudioBuffer(buffer.get()!);
  copy.reverse = true;
  reversedCache.set(key, copy);
  return copy;
}

/**
 * Plays recorded audio: drum machine hits from the sample library, or a clip
 * you loaded, sliced up by the chopper.
 */
function makeSampler(def: VoiceDef, fallback: Voice): Voice {
  const out = new Tone.Gain(1);
  fallback.output.connect(out);
  let resolvedUrl: string | null = null;
  let ready = false;

  if (def.sampleBank) {
    const url = dirtUrl(def.sampleBank, def.sampleIndex ?? 0);
    if (url) {
      resolvedUrl = url;
      void loadBuffer(url).then((buffer) => {
        ready = buffer !== null;
      });
    }
  }

  const active = new Set<Tone.ToneBufferSource>();

  return {
    output: out,
    trigger: (time, options) => {
      const key = options.bufferKey ?? resolvedUrl;
      const buffer = key ? cachedBuffer(key) : null;
      if (!buffer || (!ready && !options.bufferKey)) {
        fallback.trigger(time, options);
        return;
      }

      // Reversing flips the samples in place, so play from a cached mirror
      // copy rather than the original, which other tracks may be using.
      const playable = options.reverse ? reversedBuffer(key!, buffer) : buffer;

      const source = new Tone.ToneBufferSource({
        url: playable,
        onended: () => {
          active.delete(source);
          source.dispose();
        },
      });
      source.connect(out);

      // Pitch a sampled instrument by playback speed. Middle C is treated as
      // the note the file was recorded at, which is close enough for chopping.
      if (options.midi !== undefined && def.sampleBank) {
        source.playbackRate.value = Math.pow(2, (options.midi - 60) / 12);
      }

      const sliceCount = options.sliceCount ?? 1;
      const sliceLength = playable.duration / Math.max(1, sliceCount);
      const offset = sliceCount > 1 ? ((options.slice ?? 0) % sliceCount) * sliceLength : 0;
      const playFor = sliceCount > 1 ? Math.min(sliceLength, options.duration + 0.05) : undefined;

      source.start(time, offset, playFor, options.velocity);
      active.add(source);
    },
    dispose: () => {
      for (const source of active) source.dispose();
      active.clear();
      fallback.dispose();
      out.dispose();
    },
  };
}

/**
 * A voice that plays a synth now and swaps to real recordings when they land.
 *
 * Both halves stay connected, and a gain crossfade means the upgrade happens
 * silently between notes rather than cutting mid-phrase.
 */
function makeHybridInstrument(
  instruments: string[],
  fallback: Voice,
  options: { attack: number; release: number; gain: number },
): Voice {
  const out = new Tone.Gain(1);
  const synthLevel = new Tone.Gain(1);
  const sampleLevel = new Tone.Gain(0);
  fallback.output.connect(synthLevel);
  synthLevel.connect(out);
  sampleLevel.connect(out);

  const loaded: Tone.Sampler[] = [];
  let upgraded = false;

  void Promise.all(instruments.map(instrumentSampler)).then((results) => {
    const usable = results.filter((s): s is Tone.Sampler => s !== null);
    if (usable.length === 0) return;
    for (const sampler of usable) {
      sampler.attack = options.attack;
      sampler.release = options.release;
      sampler.volume.value = Tone.gainToDb(options.gain / usable.length);
      sampler.connect(sampleLevel);
      loaded.push(sampler);
    }
    upgraded = true;
    const now = Tone.now();
    synthLevel.gain.cancelScheduledValues(now);
    sampleLevel.gain.cancelScheduledValues(now);
    synthLevel.gain.linearRampToValueAtTime(0, now + 0.4);
    sampleLevel.gain.linearRampToValueAtTime(1, now + 0.4);
  });

  return {
    output: out,
    trigger: (time, opts) => {
      if (!upgraded) {
        fallback.trigger(time, opts);
        return;
      }
      const notes = chordFrequencies(opts);
      for (const sampler of loaded) {
        sampler.triggerAttackRelease(notes, opts.duration, time, opts.velocity);
      }
    },
    dispose: () => {
      fallback.dispose();
      synthLevel.dispose();
      sampleLevel.dispose();
      out.dispose();
    },
  };
}

function makeStrings(): Voice {
  const synth = polyVoice(
    {
      oscillator: { type: 'fatsawtooth', count: 4, spread: 18 },
      envelope: { attack: 0.35, decay: 0.6, sustain: 0.85, release: 1.1 },
    },
    0.14,
  );
  return makeHybridInstrument(['violin', 'cello'], synth, { attack: 0.25, release: 1.2, gain: 0.5 });
}

function makeBrass(): Voice {
  const synth = polyVoice(
    {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 10 },
      envelope: { attack: 0.08, decay: 0.3, sustain: 0.8, release: 0.5 },
    },
    0.17,
  );
  return makeHybridInstrument(['trumpet', 'frenchHorn'], synth, { attack: 0.05, release: 0.6, gain: 0.45 });
}

function makePiano(): Voice {
  const synth = new Tone.PolySynth(Tone.FMSynth, {
    harmonicity: 2.5,
    modulationIndex: 5,
    envelope: { attack: 0.002, decay: 1.4, sustain: 0.05, release: 1 },
  } as never);
  const gain = new Tone.Gain(0.24);
  synth.connect(gain);
  const fallback: Voice = {
    output: gain,
    trigger: (time, options) =>
      synth.triggerAttackRelease(chordFrequencies(options), options.duration, time, options.velocity),
    dispose: () => {
      synth.dispose();
      gain.dispose();
    },
  };
  return makeHybridInstrument(['piano'], fallback, { attack: 0.002, release: 1.2, gain: 0.7 });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function buildKind(kind: SynthKind, def: VoiceDef, context: BaseAudioContext): Voice {
  switch (kind) {
    case 'kick': return makeKick(def);
    case 'snare': return makeSnare();
    case 'clap': return makeClap();
    case 'hat': return makeHat(def);
    case 'tom': return makeTom(def);
    case 'supersaw': return makeSupersaw(def);
    case 'monobass': return makeMonoBass();
    case 'subbass': return makeSubBass();
    case 'acid': return makeAcid();
    case 'tear': return makeTear(context);
    case 'microkorg': return makeMicroKorg();
    case 'pluck': return makePluck();
    case 'fm': return makeFm(def);
    case 'organ': return makeOrgan();
    case 'warmpad': return makeWarmPad();
    case 'glasspad': return makeGlassPad();
    case 'choir': return makeChoir();
    case 'strings': return makeStrings();
    case 'brass': return makeBrass();
    case 'piano': return makePiano();
    case 'noise': return makeNoise();
    case 'riser': return makeRiser();
    case 'boom': return makeBoom();
    // The robot voice needs the vocoder, which is built on top of a chord
    // carrier. Until that arrives it sings through the choir.
    case 'vocoder': return makeChoir();
    case 'sampler': {
      const fallback = buildKind(def.fallback ?? 'pluck', { ...def, kind: def.fallback ?? 'pluck' }, context);
      return makeSampler(def, fallback);
    }
    default: return makeSupersaw(def);
  }
}

export function createVoice(def: VoiceDef, context: BaseAudioContext): Voice {
  return buildKind(def.kind, def, context);
}

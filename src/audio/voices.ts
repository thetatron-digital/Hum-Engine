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
import { addWorkletModule, workletLoaded } from './worklets';

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

/**
 * Register the hard sync processor with a context.
 *
 * Always go through Tone's own context rather than reaching for the underlying
 * browser one. Tone wraps the real audio context, and the wrapper is not
 * something the browser's own constructors will accept, so building worklet
 * nodes by hand fails. Tone's factory methods know how to unwrap it.
 *
 * This has to run again for the offline context used by the export, because a
 * worklet belongs to exactly one context.
 */
export async function registerWorklets(context: Tone.BaseContext): Promise<boolean> {
  return addWorkletModule(context, workletUrl.href);
}

export function hasWorklet(context: Tone.BaseContext): boolean {
  return workletLoaded(context, workletUrl.href);
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
function makeTear(context: Tone.BaseContext): Voice {
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

  const node = context.createAudioWorkletNode('hard-sync', {
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
function makeSampler(def: VoiceDef, fallback: Voice, context: Tone.BaseContext): Voice {
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
        context,
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
  context: Tone.BaseContext,
): Voice {
  const out = new Tone.Gain(1);
  const synthLevel = new Tone.Gain(1);
  const sampleLevel = new Tone.Gain(0);
  fallback.output.connect(synthLevel);
  synthLevel.connect(out);
  sampleLevel.connect(out);

  const loaded: Tone.Sampler[] = [];
  let upgraded = false;

  void Promise.all(instruments.map((name) => instrumentSampler(name, context))).then((results) => {
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

function makeStrings(context: Tone.BaseContext): Voice {
  const synth = polyVoice(
    {
      oscillator: { type: 'fatsawtooth', count: 4, spread: 18 },
      envelope: { attack: 0.35, decay: 0.6, sustain: 0.85, release: 1.1 },
    },
    0.14,
  );
  return makeHybridInstrument(['violin', 'cello'], synth, { attack: 0.25, release: 1.2, gain: 0.5 }, context);
}

function makeBrass(context: Tone.BaseContext): Voice {
  const synth = polyVoice(
    {
      oscillator: { type: 'fatsawtooth', count: 3, spread: 10 },
      envelope: { attack: 0.08, decay: 0.3, sustain: 0.8, release: 0.5 },
    },
    0.17,
  );
  return makeHybridInstrument(['trumpet', 'frenchHorn'], synth, { attack: 0.05, release: 0.6, gain: 0.45 }, context);
}

function makePiano(context: Tone.BaseContext): Voice {
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
  return makeHybridInstrument(['piano'], fallback, { attack: 0.002, release: 1.2, gain: 0.7 }, context);
}

/*
 * ===========================================================================
 * Modelled on the real machines
 * ===========================================================================
 *
 * The sound being chased was made on identifiable equipment, so these are
 * built from what that equipment actually did rather than from a general idea
 * of "electronic". Each one says what it is copying and which record it is
 * from. None of them load a sample, so they work with no network at all.
 */

/**
 * Roland TR-909 kick.
 *
 * A single sine whose pitch collapses from about 180 Hz to the low forties in
 * a few hundredths of a second, plus a separate click on the very front. The
 * pitch collapse is what your ear reads as the beater hitting the skin, and
 * the click is what lets it cut through on small speakers where the low end is
 * not really there at all.
 */
function makeKick909(def: VoiceDef): Voice {
  const body = new Tone.Oscillator({ type: 'sine', frequency: 180 }).start();
  const amp = new Tone.AmplitudeEnvelope({
    attack: 0.001,
    decay: def.release ?? 0.34,
    sustain: 0,
    release: 0.02,
  });
  const pitch = new Tone.FrequencyEnvelope({
    attack: 0.001,
    decay: 0.055,
    sustain: 0,
    baseFrequency: 44,
    octaves: 2.05,
    exponent: 2.6,
  });
  pitch.connect(body.frequency);

  const click = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.0005, decay: 0.008, sustain: 0 },
  });
  const clickTone = new Tone.Filter(2600, 'highpass');
  const clickLevel = new Tone.Gain(0.24);

  const drive = new Tone.Distortion({ distortion: 0.18, oversample: '2x', wet: 0.7 });
  const out = new Tone.Gain(0.92);
  body.connect(amp);
  amp.connect(drive);
  click.chain(clickTone, clickLevel, drive);
  drive.connect(out);

  return {
    output: out,
    trigger: (time, options) => {
      pitch.triggerAttack(time);
      amp.triggerAttackRelease(0.1, time, options.velocity);
      click.triggerAttackRelease(0.01, time, options.velocity);
    },
    dispose: () => {
      body.stop();
      for (const node of [body, amp, pitch, click, clickTone, clickLevel, drive, out]) node.dispose();
    },
  };
}

/**
 * Roland TR-909 snare.
 *
 * Two tuned tones a fifth or so apart for the drum itself, and a band of noise
 * for the wires underneath, which rings on much longer than the tones do. That
 * split decay is the whole character: shorten the noise and it stops being a
 * snare and becomes a woodblock.
 */
function makeSnare909(): Voice {
  const low = new Tone.Oscillator({ type: 'triangle', frequency: 185 }).start();
  const high = new Tone.Oscillator({ type: 'triangle', frequency: 330 }).start();
  const toneEnv = new Tone.AmplitudeEnvelope({ attack: 0.001, decay: 0.07, sustain: 0 });
  const toneLevel = new Tone.Gain(0.5);

  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.001, decay: 0.19, sustain: 0.02, release: 0.08 },
  });
  const rattle = new Tone.Filter({ type: 'highpass', frequency: 1500, rolloff: -12 });
  const body = new Tone.Filter({ type: 'lowpass', frequency: 7200 });
  const noiseLevel = new Tone.Gain(0.62);

  const out = new Tone.Gain(0.8);
  low.connect(toneEnv);
  high.connect(toneEnv);
  toneEnv.connect(toneLevel);
  toneLevel.connect(out);
  noise.chain(rattle, body, noiseLevel, out);

  return {
    output: out,
    trigger: (time, options) => {
      toneEnv.triggerAttackRelease(0.05, time, options.velocity);
      noise.triggerAttackRelease(0.16, time, options.velocity);
    },
    dispose: () => {
      low.stop();
      high.stop();
      for (const node of [low, high, toneEnv, toneLevel, noise, rattle, body, noiseLevel, out]) node.dispose();
    },
  };
}

/**
 * Roland TR-909 hat.
 *
 * Metal, not noise. A real cymbal is a stack of frequencies with no musical
 * relationship to each other, which is why filtered white noise always sounds
 * like a hiss rather than a hat. Tone's metal voice builds that inharmonic
 * stack, and a steep high pass throws away everything below it.
 */
function makeHat909(def: VoiceDef): Voice {
  const metal = new Tone.MetalSynth({
    harmonicity: 5.1,
    modulationIndex: 32,
    resonance: 4000,
    octaves: 1.5,
    envelope: { attack: 0.001, decay: def.release ?? 0.05, release: 0.01 },
  });
  const shape = new Tone.Filter({ type: 'highpass', frequency: def.brightness ?? 7000, rolloff: -24 });
  const out = new Tone.Gain(0.13);
  metal.chain(shape, out);
  return {
    output: out,
    trigger: (time, options) => metal.triggerAttackRelease(def.release ?? 0.04, time, options.velocity),
    dispose: () => {
      metal.dispose();
      shape.dispose();
      out.dispose();
    },
  };
}

/**
 * Roland TR-909 clap.
 *
 * Three noise bursts a few milliseconds apart followed by a longer tail. The
 * bursts are what make it read as many hands rather than one, and the spacing
 * is the part that has to be right: any wider and it sounds like a flam.
 */
function makeClap909(): Voice {
  const noise = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.0006, decay: 0.014, sustain: 0 },
  });
  const tail = new Tone.NoiseSynth({
    noise: { type: 'white' },
    envelope: { attack: 0.002, decay: 0.22, sustain: 0 },
  });
  const shape = new Tone.Filter({ type: 'bandpass', frequency: 1150 });
  shape.Q.value = 1.6;
  const top = new Tone.Filter({ type: 'highpass', frequency: 700 });
  const out = new Tone.Gain(0.8);
  noise.connect(shape);
  tail.connect(shape);
  shape.chain(top, out);
  return {
    output: out,
    trigger: (time, options) => {
      for (const offset of [0, 0.007, 0.014]) {
        noise.triggerAttackRelease(0.012, time + offset, options.velocity * 0.85);
      }
      tail.triggerAttackRelease(0.2, time + 0.019, options.velocity);
    },
    dispose: () => {
      for (const node of [noise, tail, shape, top, out]) node.dispose();
    },
  };
}

/**
 * The Da Funk lead.
 *
 * Reportedly a Roland Juno-106 or MKS-80 sawtooth put through a distortion
 * pedal. The thing that makes it sound like an overdriven guitar rather than a
 * synth is that it is band passed, not low passed: the low end is removed as
 * well as the top, leaving a narrow honking midrange, and only then is it
 * distorted. Distorting first and filtering afterwards does not sound the
 * same, because the distortion needs the thin signal to chew on.
 *
 * Pair it with the Perfect fourths melody shape, which is how that riff is
 * actually played.
 */
function makeDaFunk(): Voice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'fatsawtooth', count: 2, spread: 9 },
    envelope: { attack: 0.006, decay: 0.12, sustain: 0.85, release: 0.14 },
    filterEnvelope: { attack: 0.005, decay: 0.1, sustain: 0.7, release: 0.2, baseFrequency: 420, octaves: 1.8 },
    filter: { Q: 3, type: 'lowpass', rolloff: -12 },
    portamento: 0.012,
  });
  const honk = new Tone.Filter({ type: 'bandpass', frequency: 900 });
  honk.Q.value = 5.5;
  const drive = new Tone.Distortion({ distortion: 0.62, oversample: '4x', wet: 1 });
  const tame = new Tone.Filter({ type: 'lowpass', frequency: 5200, rolloff: -12 });
  const out = new Tone.Gain(0.3);
  synth.chain(honk, drive, tame, out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(freq(options, 220), options.duration, time, options.velocity),
    dispose: () => {
      for (const node of [synth, honk, drive, tame, out]) node.dispose();
    },
  };
}

/**
 * Roland Juno-106.
 *
 * The synth the duo reached for more than any other. One sawtooth, one pulse
 * whose width wobbles, and then the chorus, which is the reason anybody
 * remembers this machine. It is a pair of short modulated delays either side
 * of the stereo field, and it turns a thin single oscillator into something
 * wide and slightly seasick. Almost every filtered house chord stab owes it.
 */
function makeJuno(): Voice {
  const saw = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.006, decay: 0.3, sustain: 0.65, release: 0.5 },
  } as never);
  const pulse = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'pwm', modulationFrequency: 0.4 },
    detune: 6,
    envelope: { attack: 0.01, decay: 0.3, sustain: 0.55, release: 0.5 },
  } as never);
  const pulseLevel = new Tone.Gain(0.6);
  const chorus = new Tone.Chorus({ frequency: 0.7, delayTime: 3.6, depth: 0.75, spread: 180, wet: 0.75 });
  chorus.start();
  const out = new Tone.Gain(0.2);
  saw.connect(chorus);
  pulse.connect(pulseLevel);
  pulseLevel.connect(chorus);
  chorus.connect(out);
  return {
    output: out,
    trigger: (time, options) => {
      const notes = chordFrequencies(options);
      saw.triggerAttackRelease(notes, options.duration, time, options.velocity);
      pulse.triggerAttackRelease(notes, options.duration, time, options.velocity * 0.8);
    },
    dispose: () => {
      for (const node of [saw, pulse, pulseLevel, chorus, out]) node.dispose();
    },
  };
}

/**
 * Moog-style bass, for the Around the World line.
 *
 * One sawtooth, a pure sine an octave below it, and a filter that rolls off
 * steeply. The sine is doing the work you feel and the sawtooth is doing the
 * work you hear, which is why this sounds enormous on a club system and still
 * audible on a phone. A touch of glide between notes, because that is what an
 * old monophonic synth does whether you ask it to or not.
 */
function makeMoog(): Voice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'sawtooth' },
    envelope: { attack: 0.008, decay: 0.2, sustain: 0.85, release: 0.16 },
    filterEnvelope: { attack: 0.006, decay: 0.16, sustain: 0.5, release: 0.2, baseFrequency: 110, octaves: 2.2 },
    filter: { Q: 2.2, type: 'lowpass', rolloff: -24 },
    portamento: 0.028,
  });
  const sub = new Tone.MonoSynth({
    oscillator: { type: 'sine' },
    envelope: { attack: 0.01, decay: 0.2, sustain: 0.95, release: 0.2 },
    filterEnvelope: { attack: 0.01, decay: 0.1, sustain: 1, release: 0.1, baseFrequency: 220, octaves: 0 },
  });
  const subLevel = new Tone.Gain(0.55);
  const warmth = new Tone.Distortion({ distortion: 0.12, oversample: '2x', wet: 0.4 });
  const out = new Tone.Gain(0.5);
  synth.connect(warmth);
  sub.connect(subLevel);
  subLevel.connect(out);
  warmth.connect(out);
  return {
    output: out,
    trigger: (time, options) => {
      const hz = freq(options, 55);
      synth.triggerAttackRelease(hz, options.duration, time, options.velocity);
      sub.triggerAttackRelease(hz / 2, options.duration, time, options.velocity);
    },
    dispose: () => {
      for (const node of [synth, sub, subLevel, warmth, out]) node.dispose();
    },
  };
}

/**
 * The Derezzed lead.
 *
 * Hard edged and deliberately ugly. Detuned squares rather than sawtooths,
 * because squares have a hollow gap in their harmonics that distortion fills
 * in nastily, and then a resonant peak to give it somewhere to scream from.
 */
function makeDerezzed(): Voice {
  const synth = new Tone.MonoSynth({
    oscillator: { type: 'fatsquare', count: 3, spread: 26 },
    envelope: { attack: 0.004, decay: 0.14, sustain: 0.8, release: 0.12 },
    filterEnvelope: { attack: 0.004, decay: 0.18, sustain: 0.55, release: 0.2, baseFrequency: 320, octaves: 3 },
    filter: { Q: 5, type: 'lowpass', rolloff: -24 },
  });
  const drive = new Tone.Distortion({ distortion: 0.7, oversample: '4x', wet: 1 });
  const focus = new Tone.Filter({ type: 'bandpass', frequency: 1500 });
  focus.Q.value = 1.1;
  const out = new Tone.Gain(0.26);
  synth.chain(drive, focus, out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(freq(options, 330), options.duration, time, options.velocity),
    dispose: () => {
      for (const node of [synth, drive, focus, out]) node.dispose();
    },
  };
}

/**
 * The low brass ostinato from the Tron score.
 *
 * On the record this is a real orchestra doubled by synthesisers. Here it is a
 * wide sawtooth stack with the slow speech of brass, doubled an octave down
 * and driven gently so it has edges. Slow attack matters more than anything
 * else: brass takes time to arrive, and a fast attack makes it a synth again.
 */
function makeTronBrass(): Voice {
  const upper = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 4, spread: 16 },
    envelope: { attack: 0.14, decay: 0.4, sustain: 0.9, release: 0.9 },
  } as never);
  const lower = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 2, spread: 8 },
    detune: -1200,
    envelope: { attack: 0.18, decay: 0.4, sustain: 0.9, release: 1.1 },
  } as never);
  const lowerLevel = new Tone.Gain(0.7);
  const body = new Tone.Filter({ type: 'lowpass', frequency: 2400, rolloff: -12 });
  const edge = new Tone.Distortion({ distortion: 0.2, oversample: '2x', wet: 0.5 });
  const out = new Tone.Gain(0.2);
  upper.connect(body);
  lower.connect(lowerLevel);
  lowerLevel.connect(body);
  body.chain(edge, out);
  return {
    output: out,
    trigger: (time, options) => {
      const notes = chordFrequencies(options);
      upper.triggerAttackRelease(notes, options.duration, time, options.velocity);
      lower.triggerAttackRelease(notes, options.duration, time, options.velocity * 0.8);
    },
    dispose: () => {
      for (const node of [upper, lower, lowerLevel, body, edge, out]) node.dispose();
    },
  };
}

/**
 * A modular pad that never settles.
 *
 * The Tron score was made with a Modcan modular system, and the thing a
 * modular does that a preset synth does not is drift: patch a slow wave into
 * a filter and walk away, and it is still moving half an hour later. The
 * sweep here takes over a minute to come round, which is slow enough that you
 * notice it has changed without ever catching it changing. It is what makes a
 * loop bearable for the length of a scene.
 */
function makeModular(): Voice {
  const synth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: 'fatsawtooth', count: 3, spread: 30 },
    envelope: { attack: 1.4, decay: 1.5, sustain: 0.8, release: 3.2 },
  } as never);
  const drift = new Tone.Filter({ type: 'lowpass', frequency: 700, rolloff: -24 });
  drift.Q.value = 2.4;
  const slow = new Tone.LFO({ frequency: 0.014, min: 280, max: 2600, type: 'triangle' });
  slow.connect(drift.frequency);
  slow.start();
  // A second, faster wobble on the resonance, so the drift is not a single
  // predictable sweep back and forth.
  const wobble = new Tone.LFO({ frequency: 0.047, min: 1.2, max: 6, type: 'sine' });
  wobble.connect(drift.Q);
  wobble.start();
  const out = new Tone.Gain(0.17);
  synth.chain(drift, out);
  return {
    output: out,
    trigger: (time, options) =>
      synth.triggerAttackRelease(chordFrequencies(options), options.duration, time, options.velocity),
    dispose: () => {
      slow.stop();
      wobble.stop();
      for (const node of [synth, drift, slow, wobble, out]) node.dispose();
    },
  };
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function buildKind(kind: SynthKind, def: VoiceDef, context: Tone.BaseContext): Voice {
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
    case 'strings': return makeStrings(context);
    case 'brass': return makeBrass(context);
    case 'piano': return makePiano(context);
    case 'noise': return makeNoise();
    case 'riser': return makeRiser();
    case 'boom': return makeBoom();
    case 'kick909': return makeKick909(def);
    case 'snare909': return makeSnare909();
    case 'hat909': return makeHat909(def);
    case 'clap909': return makeClap909();
    case 'dafunk': return makeDaFunk();
    case 'juno': return makeJuno();
    case 'moog': return makeMoog();
    case 'derezzed': return makeDerezzed();
    case 'tronbrass': return makeTronBrass();
    case 'modular': return makeModular();
    // The robot voice plays phrases that were vocoded ahead of time and handed
    // over as buffers. Until the first one is ready the chord sings wordlessly
    // through the choir, which is less startling than silence.
    case 'vocoder': return makeSampler({ ...def, sampleBank: undefined }, makeChoir(), context);
    case 'sampler': {
      const fallback = buildKind(def.fallback ?? 'pluck', { ...def, kind: def.fallback ?? 'pluck' }, context);
      return makeSampler(def, fallback, context);
    }
    default: return makeSupersaw(def);
  }
}

export function createVoice(def: VoiceDef, context: Tone.BaseContext): Voice {
  return buildKind(def.kind, def, context);
}

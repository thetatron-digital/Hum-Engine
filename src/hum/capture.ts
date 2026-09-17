/**
 * Hum to melody.
 *
 * You sing over the beat and the app writes down what you sang. The pitch
 * detection itself runs in an AudioWorklet (see audio/pitch-processor.js);
 * this file turns the stream of pitch readings into notes.
 *
 * The order of operations matters. Detected pitch is snapped to the current
 * mood's scale as the very last step, after segmentation and cleanup. That is
 * deliberate: it means you can hum badly, or flat, or slide between notes, and
 * still get something usable, because being in key is enforced rather than
 * detected.
 */

import * as Tone from 'tone';
import type { HumNote } from '../state/song';
import type { Mood } from '../music/moods';
import { snapMidiToMood } from '../music/moods';
import { addWorkletModule } from '../audio/worklets';

export interface PitchFrame {
  /** Audio context time the reading refers to. */
  at: number;
  frequency: number;
  confidence: number;
  rms: number;
  peak: number;
}

export type QuantiseGrid = 4 | 8 | 16 | 'off';

export interface CaptureSettings {
  grid: QuantiseGrid;
  /** Shift the finished melody by whole octaves. */
  octaveShift: number;
  /** Manual timing trim in milliseconds. Negative pulls notes earlier. */
  timingTrim: number;
  /** Notes shorter than this many sixteenths are treated as slips. */
  minNoteSteps: number;
  mood: Mood;
  tempo: number;
  /** Length of the loop the melody has to fit into, in sixteenths. */
  loopSteps: number;
}

const workletUrl = new URL('../audio/pitch-processor.js', import.meta.url);

/** Loud enough and stable enough to count as singing rather than breath. */
const VOICED_CONFIDENCE = 0.6;
const VOICED_RMS = 0.012;
/** A jump this big means a new note rather than a wobble on the current one. */
const NEW_NOTE_SEMITONES = 0.9;
/** How long the voice may drop out before the note is considered over. */
const GAP_SECONDS = 0.07;

export function frequencyToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export class MicrophoneDenied extends Error {}

/**
 * Ask for the microphone with every helpful feature turned off.
 *
 * Echo cancellation, noise suppression and automatic gain are all designed to
 * make speech clearer on a phone call, and all three destroy pitch tracking:
 * they gate quiet notes, pump the level and distort the waveform shape that
 * the period detection depends on. They must be off.
 */
export async function requestMicrophone(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new MicrophoneDenied('This browser will not give access to a microphone.');
  }

  const ideal: MediaStreamConstraints = {
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
    video: false,
  };

  try {
    return await navigator.mediaDevices.getUserMedia(ideal);
  } catch (error) {
    const name = error instanceof DOMException ? error.name : '';

    if (name === 'NotAllowedError' || name === 'SecurityError') {
      throw new MicrophoneDenied(
        'Microphone access was refused. On an iPhone, check Settings, then Safari, then Microphone, and make sure this page is allowed.',
      );
    }
    if (name === 'NotFoundError') {
      throw new MicrophoneDenied('No microphone was found on this device.');
    }

    // Some devices refuse to have the processing turned off. Pitch tracking is
    // worse with it on, but a usable melody with noise suppression fighting it
    // is better than refusing to record at all.
    console.warn('Microphone rejected the preferred settings, falling back.', name, error);
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (fallbackError) {
      const fallbackName = fallbackError instanceof DOMException ? fallbackError.name : '';
      if (fallbackName === 'NotAllowedError' || fallbackName === 'SecurityError') {
        throw new MicrophoneDenied('Microphone access was refused.');
      }
      throw new MicrophoneDenied(
        `The microphone could not be opened${fallbackName ? ` (${fallbackName})` : ''}.`,
      );
    }
  }
}

/**
 * A live listening session.
 *
 * The microphone is deliberately never connected to the output. Monitoring
 * your own voice through a phone speaker while the beat is playing is how you
 * get a feedback howl, and it also feeds the beat back into the pitch
 * detection.
 */
export class HumSession {
  private stream: MediaStream;
  private source: MediaStreamAudioSourceNode;
  private node: AudioWorkletNode;
  private silence: Tone.Gain;
  private context: Tone.BaseContext;

  frames: PitchFrame[] = [];
  /** Loudest peak seen, so the interface can warn about a level that is too low. */
  loudestPeak = 0;
  onFrame?: (frame: PitchFrame) => void;

  private constructor(
    stream: MediaStream,
    source: MediaStreamAudioSourceNode,
    node: AudioWorkletNode,
    silence: Tone.Gain,
    context: Tone.BaseContext,
  ) {
    this.stream = stream;
    this.source = source;
    this.node = node;
    this.silence = silence;
    this.context = context;

    node.port.onmessage = (event) => {
      const frame = event.data as PitchFrame;
      if (frame.peak > this.loudestPeak) this.loudestPeak = frame.peak;
      this.frames.push(frame);
      this.onFrame?.(frame);
    };
  }

  static async open(): Promise<HumSession> {
    // Each step is labelled because the browser's own errors here are bare
    // names with no message, and knowing which call produced one is the whole
    // difference between a fixable report and a shrug.
    let stage = 'opening the microphone';
    try {
      return await HumSession.build((label) => { stage = label; });
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}${error.message ? `: ${error.message}` : ''}` : String(error);
      if (error instanceof MicrophoneDenied) throw error;
      throw new Error(`Failed while ${stage}. ${detail}`);
    }
  }

  private static async build(mark: (label: string) => void): Promise<HumSession> {
    mark('opening the microphone');
    const stream = await requestMicrophone();
    // Built through Tone's context rather than the browser's, because Tone
    // wraps the real one and its own factory methods are the only things that
    // will accept the wrapper.
    const context = Tone.getContext();
    mark('loading the pitch detector');
    const loaded = await addWorkletModule(context, workletUrl.href);
    if (!loaded) {
      throw new MicrophoneDenied(
        'The pitch detector could not be loaded. This needs a secure connection, so open the app over https rather than http.',
      );
    }
    mark('connecting the microphone');
    const source = context.createMediaStreamSource(stream);
    mark('starting the pitch detector');
    // The node is given an output it never writes to, for two reasons. A
    // worklet with no outputs at all is rejected outright, and a node whose
    // output goes nowhere is not part of the graph, so the browser never runs
    // it and no pitch ever arrives.
    const node = context.createAudioWorkletNode('pitch-detect', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    source.connect(node);

    mark('muting the monitor');
    // Silent on the way out, which is what keeps the microphone from being
    // monitored through the speaker and howling.
    const silence = new Tone.Gain(0).toDestination();
    Tone.connect(node, silence);

    return new HumSession(stream, source, node, silence, context);
  }

  /** Throw away everything heard so far and start again from this moment. */
  reset(): void {
    this.frames = [];
    this.loudestPeak = 0;
  }

  close(): void {
    this.node.port.postMessage('stop');
    this.source.disconnect();
    this.node.disconnect();
    this.silence.dispose();
    for (const track of this.stream.getTracks()) track.stop();
  }

  /**
   * How far behind reality the readings are.
   *
   * Sound has to get out of the speaker and back in through the microphone, and
   * both directions add delay. Without correcting for it every note lands late
   * by a noticeable fraction of a beat. The browser reports what it knows; the
   * rest is left to a manual trim, because on a phone the real figure varies
   * with the route the audio takes and no API reports it honestly.
   */
  estimatedLatency(): number {
    const raw = this.context.rawContext as AudioContext;
    return (raw.outputLatency ?? 0) + (raw.baseLatency ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Turning readings into notes
// ---------------------------------------------------------------------------

interface RawNote {
  startTime: number;
  endTime: number;
  midi: number;
  peak: number;
}

/**
 * Cut the stream of readings into notes.
 *
 * A note ends when the voice stops, or when the pitch jumps far enough that it
 * must be a new note rather than a wobble. Each note's pitch is the median of
 * its readings rather than the average, because a hummed note usually slides
 * into place and the median ignores that approach.
 */
export function segmentFrames(frames: PitchFrame[]): RawNote[] {
  const notes: RawNote[] = [];
  let current: { start: number; end: number; midis: number[]; peak: number } | null = null;

  const close = () => {
    if (!current || current.midis.length < 2) {
      current = null;
      return;
    }
    notes.push({
      startTime: current.start,
      endTime: current.end,
      midi: median(current.midis),
      peak: current.peak,
    });
    current = null;
  };

  for (const frame of frames) {
    const voiced =
      frame.frequency > 0 && frame.confidence >= VOICED_CONFIDENCE && frame.rms >= VOICED_RMS;

    if (!voiced) {
      if (current && frame.at - current.end > GAP_SECONDS) close();
      continue;
    }

    const midi = frequencyToMidi(frame.frequency);

    if (current) {
      const reference = median(current.midis);
      const gapTooLong = frame.at - current.end > GAP_SECONDS;
      const pitchJumped = Math.abs(midi - reference) > NEW_NOTE_SEMITONES;
      if (gapTooLong || pitchJumped) close();
    }

    if (!current) {
      current = { start: frame.at, end: frame.at, midis: [midi], peak: frame.peak };
    } else {
      current.midis.push(midi);
      current.end = frame.at;
      if (frame.peak > current.peak) current.peak = frame.peak;
    }
  }
  close();
  return notes;
}

function quantiseStep(step: number, grid: QuantiseGrid): number {
  // The machine plays on a sixteenth note grid, so "off" means the nearest
  // sixteenth. There is nothing finer for a note to land on.
  const divisor = grid === 'off' ? 1 : 16 / grid;
  return Math.round(step / divisor) * divisor;
}

/**
 * The full conversion: readings in, notes on the grid out.
 *
 * `startContextTime` is the audio clock reading at the moment the recording
 * window opened, and `startStep` is where the transport was at that instant.
 * Everything else is measured from there.
 */
export function framesToNotes(
  frames: PitchFrame[],
  settings: CaptureSettings,
  startContextTime: number,
  startStep: number,
  latency: number,
): HumNote[] {
  const sixteenth = 15 / settings.tempo;
  const offset = latency + settings.timingTrim / 1000;
  const raw = segmentFrames(frames);
  const notes: HumNote[] = [];

  for (const note of raw) {
    const beganAt = note.startTime - startContextTime - offset;
    const rawStep = startStep + beganAt / sixteenth;
    const rawLength = (note.endTime - note.startTime) / sixteenth;

    const step = quantiseStep(rawStep, settings.grid);
    const length = Math.max(1, quantiseStep(Math.max(rawLength, 0.5), settings.grid) || 1);

    if (rawLength < settings.minNoteSteps) continue;

    notes.push({
      step: ((step % settings.loopSteps) + settings.loopSteps) % settings.loopSteps,
      length: Math.min(length, settings.loopSteps),
      midi: Math.round(note.midi),
      velocity: Math.max(0.35, Math.min(1, note.peak * 2.2)),
    });
  }

  return finaliseNotes(notes, settings);
}

/**
 * The clean-up pass.
 *
 * Three things go wrong when you hum. You catch your breath and it registers
 * as a very short note. Two notes land on the same step because you slid
 * between them. And the odd note comes out a long way from its neighbours
 * because the detection caught a harmonic instead of the fundamental. This
 * fixes all three, then puts everything in key.
 */
export function finaliseNotes(notes: HumNote[], settings: CaptureSettings): HumNote[] {
  let working = notes
    .filter((note) => note.length >= settings.minNoteSteps)
    .sort((a, b) => a.step - b.step);

  // One note per step. If two landed together, keep the longer one.
  const byStep = new Map<number, HumNote>();
  for (const note of working) {
    const existing = byStep.get(note.step);
    if (!existing || note.length > existing.length) byStep.set(note.step, note);
  }
  working = [...byStep.values()].sort((a, b) => a.step - b.step);

  // Pull lone outliers back toward their neighbours. A note more than an
  // octave clear of both sides is almost always a detection slip.
  for (let i = 1; i < working.length - 1; i++) {
    const previous = working[i - 1].midi;
    const next = working[i + 1].midi;
    const here = working[i].midi;
    if (Math.abs(here - previous) > 12 && Math.abs(here - next) > 12) {
      const nearer = Math.abs(here - previous) <= Math.abs(here - next) ? previous : next;
      // Move it by whole octaves so the shape of the line survives.
      const octaves = Math.round((nearer - here) / 12);
      working[i] = { ...working[i], midi: here + octaves * 12 };
    }
  }

  // Trim each note so it stops before the next one starts.
  for (let i = 0; i < working.length - 1; i++) {
    const room = working[i + 1].step - working[i].step;
    if (working[i].length > room) working[i] = { ...working[i], length: Math.max(1, room) };
  }

  // In key, and in the octave you asked for. Last step, on purpose.
  return working.map((note) => ({
    ...note,
    midi: snapMidiToMood(settings.mood, note.midi) + settings.octaveShift * 12,
  }));
}

/** Re-snap an existing melody, for when the mood or octave changes afterwards. */
export function resnapNotes(notes: HumNote[], mood: Mood): HumNote[] {
  return notes.map((note) => ({ ...note, midi: snapMidiToMood(mood, note.midi) }));
}

/** Move one note by a scale step, used by the tap-to-nudge editor. */
export function nudgeNote(note: HumNote, mood: Mood, direction: 1 | -1): HumNote {
  let candidate = note.midi + direction;
  for (let i = 0; i < 3; i++) {
    const snapped = snapMidiToMood(mood, candidate);
    if (snapped !== note.midi) return { ...note, midi: snapped };
    candidate += direction;
  }
  return { ...note, midi: note.midi + direction * 12 };
}

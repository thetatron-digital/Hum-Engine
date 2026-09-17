/**
 * Recording your own voice, to use as the vocoder's modulator.
 *
 * This is the route to a properly convincing robot voice. The typed phrase is
 * built out of a buzz and three resonances, which is unmistakably a machine
 * but only roughly intelligible. A real voice carries all the detail that
 * makes words land, and the vocoder then replaces its pitch with the chord.
 * That is exactly how the records were made.
 */

import * as Tone from 'tone';
import { requestMicrophone, MicrophoneDenied } from '../hum/capture';
import { addWorkletModule } from '../audio/worklets';
import { normalisePeak } from './dsp';

const workletUrl = new URL('../audio/recorder-processor.js', import.meta.url);

/** Longer than this and the render starts to take noticeable time on a phone. */
export const MAX_RECORD_SECONDS = 8;

export class VoiceRecorder {
  private stream: MediaStream;
  private source: MediaStreamAudioSourceNode;
  private node: AudioWorkletNode;
  private silence: Tone.Gain;
  private chunks: Float32Array[] = [];
  private frames = 0;

  readonly sampleRate: number;
  onLevel?: (peak: number) => void;
  /** Fires once the maximum length is reached, so the interface can stop. */
  onFull?: () => void;

  private constructor(
    stream: MediaStream,
    source: MediaStreamAudioSourceNode,
    node: AudioWorkletNode,
    silence: Tone.Gain,
    sampleRate: number,
  ) {
    this.stream = stream;
    this.source = source;
    this.node = node;
    this.silence = silence;
    this.sampleRate = sampleRate;

    node.port.onmessage = (event) => {
      const message = event.data as { peak: number; samples?: Float32Array };
      this.onLevel?.(message.peak);
      if (!message.samples) return;
      if (this.frames >= this.sampleRate * MAX_RECORD_SECONDS) {
        this.onFull?.();
        return;
      }
      this.chunks.push(message.samples);
      this.frames += message.samples.length;
    };
  }

  static async open(): Promise<VoiceRecorder> {
    const stream = await requestMicrophone();
    const context = Tone.getContext();
    const loaded = await addWorkletModule(context, workletUrl.href);
    if (!loaded) {
      throw new MicrophoneDenied(
        'The recorder could not be loaded. This needs a secure connection, so open the app over https rather than http.',
      );
    }
    const source = context.createMediaStreamSource(stream);
    const node = context.createAudioWorkletNode('voice-record', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    source.connect(node);

    // Silent on the way out. It has to reach the destination or the browser
    // never runs it, but you must not hear yourself through the speaker.
    const silence = new Tone.Gain(0).toDestination();
    Tone.connect(node, silence);

    return new VoiceRecorder(stream, source, node, silence, context.sampleRate);
  }

  start(): void {
    this.chunks = [];
    this.frames = 0;
    this.node.port.postMessage('start');
  }

  stop(): void {
    this.node.port.postMessage('stop');
  }

  get seconds(): number {
    return this.frames / this.sampleRate;
  }

  /**
   * Everything recorded, as one run of samples.
   *
   * Trimmed to where the voice actually starts and stops, so a pause before
   * you spoke does not become a pause in the music, and brought up to a
   * consistent level because people record at wildly different distances.
   */
  take(): Float32Array | null {
    if (this.frames === 0) return null;
    const joined = new Float32Array(this.frames);
    let offset = 0;
    for (const chunk of this.chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }

    const threshold = 0.02;
    let first = 0;
    let last = joined.length - 1;
    while (first < joined.length && Math.abs(joined[first]) < threshold) first++;
    while (last > first && Math.abs(joined[last]) < threshold) last--;
    if (last - first < this.sampleRate * 0.05) return null;

    // A little air either side of the trim, so consonants are not clipped off.
    const pad = Math.round(this.sampleRate * 0.03);
    const from = Math.max(0, first - pad);
    const to = Math.min(joined.length, last + pad);
    const trimmed = joined.slice(from, to);
    normalisePeak(trimmed, 0.85);
    return trimmed;
  }

  close(): void {
    this.node.port.postMessage('close');
    this.source.disconnect();
    this.node.disconnect();
    this.silence.dispose();
    for (const track of this.stream.getTracks()) track.stop();
  }
}

/**
 * The recorded voice, kept in memory for the vocoder to use.
 *
 * Not part of the song file. A few seconds of audio is far larger than
 * everything else in it put together, and a song file you can read and email
 * is worth more than one that carries its own recordings.
 */
let storedVoice: { samples: Float32Array; sampleRate: number; name: string } | null = null;

export function storeVoice(samples: Float32Array, sampleRate: number, name: string): void {
  storedVoice = { samples, sampleRate, name };
}

export function storedVoiceTake(): { samples: Float32Array; sampleRate: number; name: string } | null {
  return storedVoice;
}

export function clearStoredVoice(): void {
  storedVoice = null;
}

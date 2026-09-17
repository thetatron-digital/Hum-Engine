/**
 * Rendering to audio files.
 *
 * The song is played through a second, offline copy of the entire audio
 * engine, faster than real time. Because the engine is driven purely by
 * reading the song on each step, and because every random choice is seeded,
 * the offline run produces the same music as the live one rather than
 * something merely similar.
 *
 * The mix and every stem come out of a single render. Each track's output is
 * split into its own pair of channels in one wide multichannel render, which
 * is both faster than rendering ten times and guarantees the stems line up
 * with each other and with the mix to the sample.
 */

import * as Tone from 'tone';
import type { Song, TrackId } from '../state/song';
import { TRACK_ORDER, TRACK_LABELS } from '../state/song';
import { Engine } from '../audio/engine';
import { registerWorklets } from '../audio/voices';

/** Channel pairs in the wide render, in order. */
const MIX_PAIR = 0;
const FX_PAIR = 1;
const FIRST_TRACK_PAIR = 2;
const PAIR_COUNT = FIRST_TRACK_PAIR + TRACK_ORDER.length;

export interface RenderRequest {
  /** What to play at each step. A fixed song, or a recorded performance. */
  songAt: (step: number) => Song;
  bars: number;
  /** Used to work out how long the render needs to be. */
  tempo: number;
  clipKey: string | null;
  withStems: boolean;
  onProgress?: (fraction: number) => void;
}

export interface StereoTake {
  left: Float32Array;
  right: Float32Array;
}

export interface RenderResult {
  sampleRate: number;
  mix: StereoTake;
  stems: { id: TrackId | 'space'; label: string; take: StereoTake }[];
}

export class SilentRenderError extends Error {}

function pairFrom(buffer: Tone.ToneAudioBuffer, pair: number): StereoTake {
  const channels = buffer.numberOfChannels;
  const left = buffer.getChannelData(Math.min(pair * 2, channels - 1));
  const right = buffer.getChannelData(Math.min(pair * 2 + 1, channels - 1));
  return { left, right };
}

function peak(take: StereoTake): number {
  let highest = 0;
  for (let i = 0; i < take.left.length; i++) {
    const value = Math.max(Math.abs(take.left[i]), Math.abs(take.right[i]));
    if (value > highest) highest = value;
  }
  return highest;
}

export async function renderToBuffers(request: RenderRequest): Promise<RenderResult> {
  const { songAt, bars, tempo, clipKey, withStems } = request;
  const sampleRate = Tone.getContext().sampleRate;

  // Two extra seconds so the last reverb tail and delay repeats are not cut off.
  const musicSeconds = bars * 4 * (60 / tempo);
  const duration = musicSeconds + 2;
  const channels = withStems ? PAIR_COUNT * 2 : 2;

  // The offline render is the most fragile path in the app, so each step is
  // labelled: a bare "InvalidStateError" from deep inside Web Audio is close
  // to useless without knowing which call produced it.
  let stage = 'starting';

  const rendered = await Tone.Offline(
    async () => {
      stage = 'opening the offline context';
      const context = Tone.getContext();
      const raw = context.rawContext as unknown as OfflineAudioContext;
      // The hard sync oscillator has to be registered again: an AudioWorklet
      // belongs to one context, and this is a brand new one.
      stage = 'registering the hard sync oscillator';
      await registerWorklets(context);

      stage = 'building the engine';
      const transport = Tone.getTransport();
      const collector = new Tone.Gain(1);
      const engine = new Engine(songAt, collector, context, transport);
      engine.clipKey = clipKey;
      engine.ensureAllChains(songAt(0));

      stage = 'routing the outputs: creating the merger';
      if (withStems) {
        const merger = context.createChannelMerger(channels);

        const routePair = (source: Tone.ToneAudioNode | null, pair: number, label: string) => {
          if (!source) return;
          stage = `routing the outputs: splitting ${label}`;
          const splitter = context.createChannelSplitter(2);
          stage = `routing the outputs: connecting ${label} to the splitter`;
          Tone.connect(source, splitter);
          stage = `routing the outputs: merging ${label}`;
          splitter.connect(merger, 0, pair * 2);
          splitter.connect(merger, 1, pair * 2 + 1);
        };

        routePair(engine.masterTap(), MIX_PAIR, 'the mix');
        routePair(engine.fxTap(), FX_PAIR, 'the reverb return');
        TRACK_ORDER.forEach((id, index) => routePair(engine.stemTap(id), FIRST_TRACK_PAIR + index, id));

        stage = 'routing the outputs: connecting to the destination';
        merger.connect(raw.destination);
        // The destination already has exactly the channel count the context
        // was created with, so the merger's output maps to it one for one and
        // nothing gets folded down. Do not try to assign to channelCount here:
        // Chrome throws on any write to an offline destination's channel
        // layout, including writing back the value it already holds.
        stage = 'routing the outputs: checking the channel layout';
        if (raw.destination.channelCount < channels) {
          throw new Error(
            `This browser will only give ${raw.destination.channelCount} channels, so the tracks cannot be separated.`,
          );
        }
      } else {
        Tone.connect(engine.masterTap(), raw.destination);
      }

      stage = 'building the reverb';
      await engine.ready();

      stage = 'playing';
      engine.start();
      transport.start(0);
    },
    duration,
    channels,
    sampleRate,
  ).catch((error: unknown) => {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new Error(`Render failed while ${stage}. ${detail}`);
  });

  const mix = pairFrom(rendered, MIX_PAIR);

  // The pitfall worth guarding against: an offline render that produces a
  // perfectly valid, perfectly silent file and reports no error at all. Never
  // hand over a file without checking there is something in it.
  if (peak(mix) < 0.0005) {
    throw new SilentRenderError(
      'The render came out silent. Check that at least one track is on and not muted, and that the master volume is up.',
    );
  }

  const stems: RenderResult['stems'] = [];
  if (withStems && rendered.numberOfChannels >= PAIR_COUNT * 2) {
    TRACK_ORDER.forEach((id, index) => {
      const take = pairFrom(rendered, FIRST_TRACK_PAIR + index);
      // Skip tracks that were silent for the whole render; an editor does not
      // want ten empty files.
      if (peak(take) >= 0.0005) stems.push({ id, label: TRACK_LABELS[id], take });
    });
    const space = pairFrom(rendered, FX_PAIR);
    if (peak(space) >= 0.0005) {
      stems.push({ id: 'space', label: 'Reverb and echo', take: space });
    }
  }

  return { sampleRate, mix, stems };
}

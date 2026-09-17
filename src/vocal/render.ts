/**
 * Turning the typed phrase into something the Vocal track can play.
 *
 * The phrase is rendered once per chord in the progression, so when the
 * harmony moves the robot moves with it. Renders are cached by everything that
 * affects the result, which means typing changes the voice but simply playing
 * the loop costs nothing.
 */

import * as Tone from 'tone';
import type { Song } from '../state/song';
import { MOODS } from '../music/moods';
import { getProgression, chordAtBar, progressionBars } from '../music/progressions';
import { registerBuffer, cachedBuffer } from '../audio/samples';
import { renderSpeech } from './speech';
import { vocode } from './vocoder';
import { storedVoiceTake } from './record';
import { hashString } from '../music/rng';

/** Everything that changes the sound, condensed into one cache key. */
function signature(song: Song): string {
  const { source, mode, text, bands, brightness, formantShift, sibilance } = song.vocal;
  const voice = storedVoiceTake();
  // A recording is identified by its length, which is enough to notice that a
  // different take was made without hashing every sample.
  const takeId = source === 'voice' && voice ? `${voice.name}:${voice.samples.length}` : 'none';
  return String(
    hashString(
      [source, mode, takeId, text, bands, brightness.toFixed(2), formantShift.toFixed(2), sibilance.toFixed(2), song.mood, song.progression, song.tempo.toFixed(0)].join('|'),
    ),
  );
}

export function vocalKey(song: Song, chordIndex: number): string {
  return `vocal:${signature(song)}:${chordIndex}`;
}

const rendering = new Set<string>();

/**
 * Build every version of the phrase this song needs.
 *
 * Runs off the main thread's critical path in the sense that it is started
 * ahead of time and the track simply stays silent until a version is ready,
 * rather than blocking playback waiting for it.
 */
export async function renderVocals(song: Song): Promise<void> {
  const progression = getProgression(song.progression);
  const mood = MOODS[song.mood];
  const chordCount = progression.degrees.length;
  const sampleRate = Tone.getContext().sampleRate;

  // One bar of the phrase at the current tempo, which keeps it in time.
  const duration = Math.min(6, (60 / song.tempo) * 4);

  const take = song.vocal.source === 'voice' ? storedVoiceTake() : null;
  if (song.vocal.source === 'voice' && !take) return;

  for (let index = 0; index < chordCount; index++) {
    const key = vocalKey(song, index);
    if (cachedBuffer(key) || rendering.has(key)) continue;
    rendering.add(key);

    try {
      const bar = index * progression.barsPerChord;
      const chord = chordAtBar(mood, progression, Math.floor(bar) % progressionBars(progression), 3);

      // A recording keeps its own length and pace, because that is the phrasing
      // you performed. A built voice is stretched to fit a bar.
      const modulator = take
        ? take.samples
        : renderSpeech(song.vocal.text, {
            sampleRate,
            duration,
            // The buzz pitch barely matters once the carrier takes over, but a
            // low one keeps the formants readable.
            pitch: 110,
            formantShift: song.vocal.formantShift,
          });

      const samples = vocode(modulator, {
        sampleRate: take ? take.sampleRate : sampleRate,
        mode: song.vocal.mode,
        bands: Math.round(song.vocal.bands),
        carrierNotes: chord.notes,
        brightness: song.vocal.brightness,
        formantShift: song.vocal.formantShift,
        sibilance: song.vocal.sibilance,
      });

      const buffer = Tone.getContext().createBuffer(1, samples.length, take ? take.sampleRate : sampleRate);
      buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
      registerBuffer(key, new Tone.ToneAudioBuffer(buffer));
    } finally {
      rendering.delete(key);
    }
    // Give the interface a chance to breathe between chords.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

export function vocalReady(song: Song): boolean {
  return cachedBuffer(vocalKey(song, 0)) !== null;
}

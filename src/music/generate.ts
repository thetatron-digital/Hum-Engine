/**
 * Random song.
 *
 * Picks a complete arrangement inside a chosen feeling and genre. It is not
 * random in the sense of throwing dice at every control: tempo, pattern choice
 * and voice choice are all drawn from ranges that belong to that genre, so what
 * comes out is always a usable starting point rather than a mess.
 */

import type { Song, TrackId } from '../state/song';
import { createDefaultSong } from '../state/song';
import type { GenreId } from './patterns';
import { PATTERNS } from './patterns';
import { PROGRESSIONS } from './progressions';
import type { MoodId } from './moods';
import { MOODS } from './moods';
import { makeRng, hashString, pick } from './rng';
import { voicesForRole } from '../audio/voiceCatalog';

const TEMPO_RANGE: Record<GenreId, [number, number]> = {
  french: [116, 126],
  acid: [126, 134],
  trance: [134, 142],
  dnb: [165, 176],
  cinematic: [78, 100],
};

/** Which voices suit which genre, by voice id. Anything else is still allowed. */
const GENRE_VOICES: Record<GenreId, Partial<Record<TrackId, string[]>>> = {
  french: {
    kick: ['kick-punch', 'kick-deep', 'kick-909'],
    snare: ['clap-house', 'snare-909'],
    bass: ['bass-mono', 'bass-microkorg'],
    chords: ['chords-supersaw', 'chords-stab', 'chords-rhodes'],
    lead: ['lead-supersaw', 'lead-microkorg', 'lead-pluck'],
    pad: ['pad-warm', 'chords-supersaw'],
  },
  acid: {
    kick: ['kick-distort', 'kick-punch'],
    snare: ['snare-909', 'snare-noise'],
    bass: ['bass-acid'],
    chords: ['chords-organ', 'chords-stab'],
    lead: ['lead-tear', 'lead-microkorg'],
    pad: ['pad-glass'],
  },
  trance: {
    kick: ['kick-punch', 'kick-909'],
    snare: ['clap-house'],
    bass: ['bass-mono', 'bass-fm'],
    chords: ['chords-supersaw'],
    lead: ['lead-supersaw', 'lead-pluck'],
    pad: ['chords-supersaw', 'pad-glass'],
  },
  dnb: {
    kick: ['kick-punch', 'kick-909'],
    snare: ['snare-909', 'snare-break'],
    bass: ['bass-sub', 'bass-fm'],
    chords: ['chords-rhodes', 'chords-organ'],
    lead: ['lead-pluck'],
    pad: ['pad-glass', 'pad-warm'],
  },
  cinematic: {
    kick: ['kick-soft'],
    snare: ['snare-rim'],
    hats: ['hat-shaker'],
    bass: ['bass-sub'],
    chords: ['chords-piano', 'chords-strings'],
    lead: ['chords-strings', 'lead-brass'],
    pad: ['pad-strings', 'pad-choir'],
  },
};

function patternFor(role: string, genre: GenreId, random: number): string {
  const matching = PATTERNS.filter((p) => p.role === role && p.genre === genre);
  const any = PATTERNS.filter((p) => p.role === role);
  return pick(matching.length ? matching : any, random).id;
}

function voiceFor(id: TrackId, genre: GenreId, random: number): string {
  const preferred = GENRE_VOICES[genre][id];
  if (preferred && preferred.length) return pick(preferred, random);
  const available = voicesForRole(
    id === 'chop' ? 'chop' : id === 'fx' ? 'fx' : id === 'vocal' ? 'vocal' : (id as never),
  );
  return available.length ? pick(available, random).id : '';
}

export function randomSong(mood: MoodId, genre: GenreId, seed = String(Date.now())): Song {
  const random = makeRng(hashString(seed));
  const song = createDefaultSong();
  song.seed = seed;
  song.mood = mood;
  song.name = `${MOODS[mood].label} ${genre === 'dnb' ? 'Breaks' : genre.charAt(0).toUpperCase() + genre.slice(1)}`;

  const [low, high] = TEMPO_RANGE[genre];
  song.tempo = Math.round(low + random() * (high - low));
  song.progression = pick(PROGRESSIONS, random()).id;
  song.swing = genre === 'french' || genre === 'dnb' ? random() * 0.25 : 0;

  const cinematic = genre === 'cinematic';
  song.master = {
    ...song.master,
    pump: cinematic ? 0.1 + random() * 0.18 : 0.4 + random() * 0.4,
    pumpRelease: 0.4 + random() * 0.45,
    lowpass: 0.6 + random() * 0.4,
    highpass: 0,
    drive: cinematic ? random() * 0.12 : 0.12 + random() * 0.35,
    reverbSize: cinematic ? 0.55 + random() * 0.35 : 0.2 + random() * 0.4,
    delayTime: pick([0.375, 0.5, 0.75, 1], random()),
    delayFeedback: 0.2 + random() * 0.35,
  };

  const bright = MOODS[mood].brightness;
  for (const id of Object.keys(song.tracks) as TrackId[]) {
    const track = song.tracks[id];
    const role = id === 'chop' ? 'chop' : id;
    track.voice = voiceFor(id, genre, random()) || track.voice;
    track.pattern = { source: 'library', libraryId: patternFor(role, genre, random()), steps: [], notes: [] };
    // Keep the spread narrow. Extreme values are for you to dial in, not for
    // the generator to hand you.
    track.density = 0.36 + random() * 0.32;
    track.chaos = random() < 0.3 ? random() * 0.25 : 0;
    track.cutoff = Math.max(0.2, Math.min(0.95, 0.5 + bright * 0.3 + (random() - 0.5) * 0.3));
  }

  // The vocal and chop tracks need material you supply, so they start off.
  song.tracks.vocal.enabled = false;
  song.tracks.chop.enabled = false;
  song.tracks.fx.enabled = false;
  song.tracks.lead.enabled = random() > 0.35;
  song.tracks.pad.enabled = true;

  if (cinematic) {
    song.tracks.snare.enabled = random() > 0.5;
    song.tracks.hats.volume = 0.25;
  }
  return song;
}

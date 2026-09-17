/**
 * Starting songs.
 *
 * Open the app, tap one, and something good is already playing. Each one is a
 * complete arrangement, not a demo, so the first thing you do is turn a knob
 * rather than build from silence.
 *
 * Each preset is written as a set of changes on top of the default song, which
 * keeps them short and means a new control gets a sensible value in all of
 * them automatically.
 */

import type { Song, TrackId, Track } from './song';
import { createDefaultSong } from './song';

interface PresetSpec {
  id: string;
  name: string;
  blurb: string;
  song: (base: Song) => Song;
}

function tweak(song: Song, id: TrackId, changes: Partial<Track>): void {
  song.tracks[id] = { ...song.tracks[id], ...changes };
}

function pattern(song: Song, id: TrackId, libraryId: string): void {
  song.tracks[id].pattern = { source: 'library', libraryId, steps: [], notes: [] };
}

/*
 * Four of these are aimed at specific records, and each one says which
 * technique it is copying rather than just which song. The point is that the
 * technique is the reusable part: once you know Da Funk is a band passed
 * sawtooth in parallel fourths, you can put your own tune through it.
 */
export const PRESETS: PresetSpec[] = [
  {
    id: 'funk-machine',
    name: 'Funk Machine',
    blurb: 'Da Funk. A honking distorted lead in parallel fourths over a dragging beat.',
    song: (song) => {
      song.tempo = 111;
      song.mood = 'dark';
      song.palette = 'pentatonic';
      song.progression = 'breathe';
      song.master = { ...song.master, pump: 0.45, drive: 0.42, crush: 0.12, reverbSize: 0.28, delayTime: 0.5 };
      song.swing = 0.22;
      tweak(song, 'kick', { voice: 'kick-909s', volume: 0.95 });
      pattern(song, 'kick', 'kick-shuffle');
      tweak(song, 'snare', { voice: 'clap-909s', volume: 0.72 });
      pattern(song, 'snare', 'snare-shuffle');
      tweak(song, 'hats', { voice: 'hat-909s', density: 0.58, volume: 0.42 });
      pattern(song, 'hats', 'hats-shuffle');
      tweak(song, 'bass', { voice: 'bass-moog', riff: 'root-five', cutoff: 0.4, envAmount: 0.4, octave: -1 });
      pattern(song, 'bass', 'bass-stab');
      // The lead is the whole record: band passed, distorted, and played as
      // two notes a fourth apart moving together.
      tweak(song, 'lead', {
        enabled: true, voice: 'lead-dafunk', riff: 'fourths',
        cutoff: 0.62, resonance: 0.2, envAmount: 0.15,
        volume: 0.5, phase: 0.18, delaySend: 0.14, pumpAmount: 0.5,
      });
      pattern(song, 'lead', 'lead-riff');
      tweak(song, 'chords', { enabled: false });
      tweak(song, 'pad', { voice: 'pad-warm', volume: 0.3, cutoff: 0.34 });
      return song;
    },
  },
  {
    id: 'robot-riff',
    name: 'Robot Riff',
    blurb: 'Robot Rock. A hard sync riff, crushed and driven until it hurts.',
    song: (song) => {
      song.tempo = 110;
      song.mood = 'tense';
      song.palette = 'blues';
      song.progression = 'hold';
      song.master = { ...song.master, pump: 0.3, drive: 0.55, crush: 0.34, reverbSize: 0.2, lowpass: 0.9 };
      tweak(song, 'kick', { voice: 'kick-909s', volume: 1 });
      pattern(song, 'kick', 'kick-electro');
      tweak(song, 'snare', { voice: 'snare-909s', volume: 0.8 });
      pattern(song, 'snare', 'snare-backbeat');
      tweak(song, 'hats', { voice: 'hat-909s', density: 0.45, volume: 0.35 });
      pattern(song, 'hats', 'hats-offbeat');
      tweak(song, 'bass', { voice: 'bass-moog', riff: 'root', cutoff: 0.3, envAmount: 0.3, octave: -1 });
      pattern(song, 'bass', 'bass-driving');
      // The original riff has an oscillator sync timbre, which is what the
      // Tear voice does. Sync Amount is the knob that makes it tear.
      tweak(song, 'lead', {
        enabled: true, voice: 'lead-tear', riff: 'sync-riff', syncAmount: 0.52,
        cutoff: 0.66, resonance: 0.3, envAmount: 0.3,
        volume: 0.44, pumpAmount: 0.4, reverbSend: 0.12,
      });
      pattern(song, 'lead', 'lead-stabs');
      tweak(song, 'chords', { enabled: false });
      tweak(song, 'pad', { enabled: false });
      return song;
    },
  },
  {
    id: 'circle-the-globe',
    name: 'Circle The Globe',
    blurb: 'Around the World. The bass line is the hook, and the voice is a talkbox.',
    song: (song) => {
      song.tempo = 121;
      song.mood = 'melancholy';
      song.palette = 'pentatonic';
      song.progression = 'breathe';
      song.master = { ...song.master, pump: 0.6, drive: 0.22, reverbSize: 0.32, delayTime: 0.75 };
      song.vocal = { ...song.vocal, mode: 'talkbox', text: 'around the world', bands: 12, brightness: 0.7, sibilance: 0.3 };
      tweak(song, 'kick', { voice: 'kick-909s' });
      pattern(song, 'kick', 'kick-four');
      tweak(song, 'snare', { voice: 'clap-909s', volume: 0.65 });
      tweak(song, 'hats', { voice: 'hat-909-open', density: 0.5, volume: 0.4 });
      pattern(song, 'hats', 'hats-offbeat');
      // The line walks up and leaps an octave, which is why it sticks.
      tweak(song, 'bass', {
        voice: 'bass-moog', riff: 'octaves', cutoff: 0.46, envAmount: 0.3,
        octave: -1, volume: 0.9, pumpAmount: 0.9,
      });
      pattern(song, 'bass', 'bass-driving');
      tweak(song, 'chords', { voice: 'chords-juno', cutoff: 0.5, volume: 0.45, reverbSend: 0.3, phase: 0.15 });
      pattern(song, 'chords', 'chords-stab-off');
      tweak(song, 'vocal', { enabled: true, volume: 0.55, reverbSend: 0.25, delaySend: 0.2, pumpAmount: 0.5 });
      pattern(song, 'vocal', 'vocal-call');
      tweak(song, 'pad', { voice: 'chords-juno', volume: 0.3, cutoff: 0.4 });
      return song;
    },
  },
  {
    id: 'the-grid',
    name: 'The Grid',
    blurb: 'Tron. Low brass ostinato, a modular pad that never settles, no dancefloor.',
    song: (song) => {
      song.tempo = 88;
      song.mood = 'heroic';
      song.palette = 'full';
      song.progression = 'stairs';
      song.master = { ...song.master, pump: 0.14, drive: 0.12, reverbSize: 0.75, lowpass: 0.9, delayFeedback: 0.35 };
      tweak(song, 'kick', { voice: 'kick-soft', volume: 0.62, pumpAmount: 0 });
      pattern(song, 'kick', 'kick-heart');
      tweak(song, 'snare', { enabled: false });
      tweak(song, 'hats', { voice: 'hat-shaker', volume: 0.2, density: 0.28 });
      pattern(song, 'hats', 'hats-air');
      tweak(song, 'bass', { voice: 'bass-sub', riff: 'pedal', cutoff: 0.36, envAmount: 0.06, octave: -1, pumpAmount: 0.2 });
      pattern(song, 'bass', 'bass-drone');
      // A repeating figure low in the brass, which is the sound of that score.
      tweak(song, 'chords', {
        voice: 'chords-tron-brass', cutoff: 0.72, resonance: 0.08, envAmount: 0.08,
        volume: 0.5, reverbSend: 0.5, pumpAmount: 0.1,
      });
      pattern(song, 'chords', 'chords-hold');
      tweak(song, 'lead', { enabled: true, voice: 'chords-strings', riff: 'pedal', cutoff: 0.68, volume: 0.35, reverbSend: 0.55, pumpAmount: 0.1 });
      pattern(song, 'lead', 'lead-sparse');
      tweak(song, 'pad', { voice: 'pad-modular', volume: 0.45, reverbSend: 0.7, pumpAmount: 0.1 });
      return song;
    },
  },
  {
    id: 'derezzed-club',
    name: 'Derezzed Club',
    blurb: 'The neon club scene. Detuned squares through distortion over a hard electro beat.',
    song: (song) => {
      song.tempo = 130;
      song.mood = 'tense';
      song.palette = 'pentatonic';
      song.progression = 'pulse';
      song.master = { ...song.master, pump: 0.5, drive: 0.45, crush: 0.2, reverbSize: 0.3 };
      tweak(song, 'kick', { voice: 'kick-909-long', volume: 1 });
      pattern(song, 'kick', 'kick-four-push');
      tweak(song, 'snare', { voice: 'snare-909s', volume: 0.75 });
      pattern(song, 'snare', 'snare-backbeat-ghost');
      tweak(song, 'hats', { voice: 'hat-909s', density: 0.68, volume: 0.42 });
      pattern(song, 'hats', 'hats-sixteenth');
      tweak(song, 'bass', { voice: 'bass-moog', riff: 'root-five', cutoff: 0.42, envAmount: 0.45, octave: -1 });
      pattern(song, 'bass', 'bass-sixteenths');
      tweak(song, 'lead', {
        enabled: true, voice: 'lead-derezzed', riff: 'zigzag',
        cutoff: 0.7, resonance: 0.3, envAmount: 0.35, volume: 0.42, phase: 0.22, pumpAmount: 0.5,
      });
      pattern(song, 'lead', 'lead-stabs');
      tweak(song, 'chords', { voice: 'chords-juno', cutoff: 0.55, volume: 0.4, phase: 0.2 });
      pattern(song, 'chords', 'chords-gate');
      tweak(song, 'pad', { voice: 'pad-modular', volume: 0.3 });
      return song;
    },
  },
  {
    id: 'robot-discotheque',
    name: 'Robot Discotheque',
    blurb: 'Bright French house. Filtered stabs, hard pump, made to be swept.',
    song: (song) => {
      song.tempo = 123;
      song.mood = 'euphoric';
      song.progression = 'circle';
      song.master = { ...song.master, pump: 0.7, drive: 0.28, reverbSize: 0.3 };
      tweak(song, 'chords', { cutoff: 0.5, resonance: 0.35, envAmount: 0.45, delaySend: 0.2 });
      tweak(song, 'lead', { enabled: true, voice: 'lead-supersaw', motion: 0.25, cutoff: 0.72 });
      pattern(song, 'lead', 'lead-hook');
      tweak(song, 'hats', { density: 0.62 });
      return song;
    },
  },
  {
    id: 'midnight-filter',
    name: 'Midnight Filter',
    blurb: 'The same machine after dark. Closed down, heavier, slower to open.',
    song: (song) => {
      song.tempo = 118;
      song.mood = 'dark';
      song.progression = 'sinking';
      song.master = { ...song.master, pump: 0.75, lowpass: 0.62, drive: 0.32, reverbSize: 0.5 };
      tweak(song, 'kick', { voice: 'kick-deep' });
      tweak(song, 'bass', { voice: 'bass-microkorg', cutoff: 0.34, resonance: 0.4, envAmount: 0.55 });
      tweak(song, 'chords', { cutoff: 0.36, resonance: 0.42, reverbSend: 0.35 });
      pattern(song, 'chords', 'chords-stab-syncopated');
      tweak(song, 'pad', { volume: 0.5, cutoff: 0.32 });
      return song;
    },
  },
  {
    id: 'acid-basement',
    name: 'Acid Basement',
    blurb: 'One squelching bass line and a stiff machine beat. Turn Bite up.',
    song: (song) => {
      song.tempo = 130;
      song.mood = 'tense';
      song.progression = 'hold';
      song.master = { ...song.master, pump: 0.5, drive: 0.45, reverbSize: 0.22 };
      tweak(song, 'kick', { voice: 'kick-distort' });
      pattern(song, 'kick', 'kick-machine');
      tweak(song, 'snare', { voice: 'snare-909' });
      pattern(song, 'hats', 'hats-shuffle');
      tweak(song, 'bass', { voice: 'bass-acid', cutoff: 0.38, resonance: 0.72, envAmount: 0.8, motion: 0.3, density: 0.6 });
      pattern(song, 'bass', 'bass-acid-run');
      tweak(song, 'chords', { enabled: false });
      tweak(song, 'pad', { volume: 0.25, cutoff: 0.3 });
      return song;
    },
  },
  {
    id: 'cathedral-trance',
    name: 'Cathedral Trance',
    blurb: 'Wide supersaw pads, gated chords, everything reaching upward.',
    song: (song) => {
      song.tempo = 138;
      song.mood = 'heroic';
      song.progression = 'lift';
      song.master = { ...song.master, pump: 0.62, reverbSize: 0.65, delayTime: 0.75, delayFeedback: 0.4 };
      pattern(song, 'kick', 'kick-rolling');
      pattern(song, 'hats', 'hats-eighth');
      tweak(song, 'bass', { cutoff: 0.5, density: 0.62 });
      pattern(song, 'bass', 'bass-rolling');
      tweak(song, 'chords', { voice: 'chords-supersaw', cutoff: 0.68, reverbSend: 0.4 });
      pattern(song, 'chords', 'chords-gate');
      tweak(song, 'lead', { enabled: true, voice: 'lead-supersaw', cutoff: 0.8, delaySend: 0.35, motion: 0.2 });
      pattern(song, 'lead', 'lead-arp-fast');
      tweak(song, 'pad', { voice: 'chords-supersaw', volume: 0.45, reverbSend: 0.6 });
      return song;
    },
  },
  {
    id: 'breakbeat-chase',
    name: 'Breakbeat Chase',
    blurb: 'Fast chopped drums under a slow deep sub. Built for a pursuit.',
    song: (song) => {
      song.tempo = 172;
      song.mood = 'tense';
      song.progression = 'pulse';
      song.master = { ...song.master, pump: 0.3, drive: 0.35, reverbSize: 0.3 };
      pattern(song, 'kick', 'kick-break');
      tweak(song, 'snare', { voice: 'snare-909', volume: 0.8 });
      pattern(song, 'snare', 'snare-amen');
      tweak(song, 'hats', { density: 0.7, volume: 0.42 });
      pattern(song, 'hats', 'hats-rapid');
      tweak(song, 'bass', { voice: 'bass-sub', octave: -1, cutoff: 0.32, envAmount: 0.1, pumpAmount: 0.3 });
      pattern(song, 'bass', 'bass-sub-long');
      tweak(song, 'chords', { volume: 0.4, cutoff: 0.45, reverbSend: 0.35 });
      pattern(song, 'chords', 'chords-push');
      tweak(song, 'pad', { enabled: false });
      return song;
    },
  },
  {
    id: 'sub-rider',
    name: 'Sub Rider',
    blurb: 'Half the drums, twice the weight. Dark rooms and long corridors.',
    song: (song) => {
      song.tempo = 168;
      song.mood = 'dark';
      song.progression = 'breathe';
      song.master = { ...song.master, pump: 0.25, lowpass: 0.78, reverbSize: 0.55 };
      pattern(song, 'kick', 'kick-break');
      pattern(song, 'snare', 'snare-backbeat-ghost');
      tweak(song, 'hats', { density: 0.35, volume: 0.35 });
      tweak(song, 'bass', { voice: 'bass-sub', octave: -1, cutoff: 0.28, envAmount: 0.08 });
      pattern(song, 'bass', 'bass-drone');
      tweak(song, 'chords', { voice: 'chords-rhodes', volume: 0.35, cutoff: 0.5, reverbSend: 0.5, delaySend: 0.3 });
      pattern(song, 'chords', 'chords-swell');
      tweak(song, 'pad', { voice: 'pad-glass', volume: 0.4, reverbSend: 0.7 });
      return song;
    },
  },
  {
    id: 'slow-dread',
    name: 'Slow Dread',
    blurb: 'Dark cinematic ambient. Almost no drums, a lot of room.',
    song: (song) => {
      song.tempo = 84;
      song.mood = 'dark';
      song.progression = 'hold';
      song.master = { ...song.master, pump: 0.1, lowpass: 0.68, drive: 0.1, reverbSize: 0.85, delayFeedback: 0.45 };
      tweak(song, 'kick', { voice: 'kick-soft', volume: 0.7 });
      pattern(song, 'kick', 'kick-heart');
      tweak(song, 'snare', { voice: 'snare-rim', volume: 0.35 });
      pattern(song, 'snare', 'snare-rim');
      tweak(song, 'hats', { voice: 'hat-shaker', volume: 0.25, density: 0.3 });
      pattern(song, 'hats', 'hats-air');
      tweak(song, 'bass', { voice: 'bass-sub', octave: -1, cutoff: 0.26, envAmount: 0, pumpAmount: 0.2 });
      pattern(song, 'bass', 'bass-drone');
      tweak(song, 'chords', { voice: 'chords-strings', cutoff: 0.55, volume: 0.45, reverbSend: 0.65, pumpAmount: 0.1 });
      pattern(song, 'chords', 'chords-swell');
      tweak(song, 'pad', { voice: 'pad-choir', volume: 0.5, reverbSend: 0.8, pumpAmount: 0.1 });
      return song;
    },
  },
  {
    id: 'first-light',
    name: 'First Light',
    blurb: 'Cinematic and rising. Strings and piano, no dancefloor in sight.',
    song: (song) => {
      song.tempo = 96;
      song.mood = 'heroic';
      song.progression = 'stairs';
      song.master = { ...song.master, pump: 0.12, drive: 0.06, reverbSize: 0.7 };
      tweak(song, 'kick', { voice: 'kick-soft', volume: 0.6, pumpAmount: 0 });
      pattern(song, 'kick', 'kick-heart');
      tweak(song, 'snare', { enabled: false });
      tweak(song, 'hats', { voice: 'hat-shaker', volume: 0.22, density: 0.35 });
      tweak(song, 'bass', { voice: 'bass-sub', cutoff: 0.4, envAmount: 0.05, pumpAmount: 0.15 });
      pattern(song, 'bass', 'bass-drone');
      tweak(song, 'chords', { voice: 'chords-piano', cutoff: 0.85, resonance: 0.05, envAmount: 0.05, reverbSend: 0.5, pumpAmount: 0.1 });
      pattern(song, 'chords', 'chords-hold');
      tweak(song, 'lead', { enabled: true, voice: 'chords-strings', cutoff: 0.7, reverbSend: 0.55, pumpAmount: 0.1, motion: 0.15 });
      pattern(song, 'lead', 'lead-sparse');
      tweak(song, 'pad', { voice: 'pad-strings', volume: 0.5, reverbSend: 0.7, pumpAmount: 0.1 });
      return song;
    },
  },
  {
    id: 'melancholy-machine',
    name: 'Melancholy Machine',
    blurb: 'House that is not quite happy. Warm chords, restrained beat.',
    song: (song) => {
      song.tempo = 112;
      song.mood = 'melancholy';
      song.progression = 'ache';
      song.master = { ...song.master, pump: 0.6, lowpass: 0.8, reverbSize: 0.45, delayTime: 0.5 };
      tweak(song, 'kick', { voice: 'kick-deep' });
      tweak(song, 'snare', { volume: 0.55 });
      tweak(song, 'hats', { density: 0.4, volume: 0.38 });
      tweak(song, 'bass', { voice: 'bass-mono', cutoff: 0.42, envAmount: 0.35 });
      tweak(song, 'chords', { voice: 'chords-rhodes', cutoff: 0.6, volume: 0.55, reverbSend: 0.4, delaySend: 0.25 });
      pattern(song, 'chords', 'chords-stab-syncopated');
      tweak(song, 'pad', { voice: 'pad-warm', volume: 0.45, reverbSend: 0.55 });
      return song;
    },
  },
  {
    id: 'neon-arcade',
    name: 'Neon Arcade',
    blurb: 'Bright, fast, plastic. Arpeggios everywhere and the Tear lead on top.',
    song: (song) => {
      song.tempo = 128;
      song.mood = 'euphoric';
      song.progression = 'stab';
      song.master = { ...song.master, pump: 0.66, drive: 0.3, reverbSize: 0.35, delayTime: 0.375 };
      pattern(song, 'kick', 'kick-four-push');
      pattern(song, 'hats', 'hats-sixteenth');
      tweak(song, 'hats', { density: 0.6 });
      tweak(song, 'bass', { voice: 'bass-fm', cutoff: 0.5, envAmount: 0.4, density: 0.6 });
      pattern(song, 'bass', 'bass-driving');
      tweak(song, 'chords', { voice: 'lead-pluck', cutoff: 0.75, volume: 0.5, delaySend: 0.3 });
      pattern(song, 'chords', 'chords-gate');
      tweak(song, 'lead', { enabled: true, voice: 'lead-tear', syncAmount: 0.45, cutoff: 0.8, volume: 0.42, motion: 0.3, delaySend: 0.3 });
      pattern(song, 'lead', 'lead-arp-up');
      return song;
    },
  },
  {
    id: 'paper-boats',
    name: 'Paper Boats',
    blurb: 'Quiet, neutral, unobtrusive. The one that sits under dialogue.',
    song: (song) => {
      song.tempo = 90;
      song.mood = 'neutral';
      song.progression = 'breathe';
      song.master = { ...song.master, pump: 0.18, lowpass: 0.75, drive: 0.05, reverbSize: 0.6 };
      tweak(song, 'kick', { voice: 'kick-soft', volume: 0.5 });
      pattern(song, 'kick', 'kick-sparse');
      tweak(song, 'snare', { voice: 'snare-rim', volume: 0.3 });
      pattern(song, 'snare', 'snare-rim');
      tweak(song, 'hats', { voice: 'hat-shaker', volume: 0.2, density: 0.3 });
      pattern(song, 'hats', 'hats-air');
      tweak(song, 'bass', { voice: 'bass-sub', cutoff: 0.35, envAmount: 0.05, pumpAmount: 0.2 });
      pattern(song, 'bass', 'bass-drone');
      tweak(song, 'chords', { voice: 'chords-piano', cutoff: 0.8, envAmount: 0.05, volume: 0.45, reverbSend: 0.45, pumpAmount: 0.1 });
      pattern(song, 'chords', 'chords-hold');
      tweak(song, 'pad', { voice: 'pad-warm', volume: 0.38, reverbSend: 0.6 });
      return song;
    },
  },
];

export function loadPreset(id: string): Song {
  const preset = PRESETS.find((option) => option.id === id) ?? PRESETS[0];
  const song = preset.song(createDefaultSong());
  song.name = preset.name;
  song.seed = preset.id;
  return song;
}

export const PRESET_LIST = PRESETS.map(({ id, name, blurb }) => ({ id, name, blurb }));

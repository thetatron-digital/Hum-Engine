/**
 * The song is one plain JSON object.
 *
 * Every knob in the interface writes into this shape, and the audio engine
 * reads it on every sixteenth note. Nothing about the sound lives anywhere
 * else. That is what makes save, load, undo, sharing and the Shift button all
 * fall out of the same mechanism.
 */

import type { MoodId, PaletteId } from '../music/moods';
import type { TrackRole } from '../music/patterns';

export const SONG_FORMAT_VERSION = 1;

export type TrackId =
  | 'kick'
  | 'snare'
  | 'hats'
  | 'bass'
  | 'chords'
  | 'lead'
  | 'pad'
  | 'vocal'
  | 'chop'
  | 'fx';

export const TRACK_ORDER: TrackId[] = [
  'kick', 'snare', 'hats', 'bass', 'chords', 'lead', 'pad', 'vocal', 'chop', 'fx',
];

export const TRACK_LABELS: Record<TrackId, string> = {
  kick: 'Kick',
  snare: 'Snare',
  hats: 'Hats',
  bass: 'Bass',
  chords: 'Chords',
  lead: 'Lead',
  pad: 'Pad',
  vocal: 'Vocal',
  chop: 'Sample Chop',
  fx: 'FX',
};

/** Tracks that play notes, and therefore lock to the mood and can be hummed into. */
export const MELODIC_TRACKS: TrackId[] = ['bass', 'chords', 'lead', 'pad'];

export function isMelodic(id: TrackId): boolean {
  return MELODIC_TRACKS.includes(id);
}

/** A track's role decides which patterns and voices it may use. */
export const TRACK_ROLE: Record<TrackId, TrackRole> = {
  kick: 'kick',
  snare: 'snare',
  hats: 'hats',
  bass: 'bass',
  chords: 'chords',
  lead: 'lead',
  pad: 'pad',
  vocal: 'vocal',
  chop: 'chop',
  fx: 'fx',
};

/** A melody captured by humming, or drawn by hand. */
export interface HumNote {
  /** Sixteenth note position from the start of the loop. */
  step: number;
  /** Length in sixteenth notes. */
  length: number;
  /** MIDI note number, already snapped to the mood. */
  midi: number;
  velocity: number;
}

export interface TrackPattern {
  /**
   * 'library' plays one of the built-in rhythms, 'grid' plays steps you tapped
   * in yourself, and 'hum' plays a melody you sang in.
   */
  source: 'library' | 'grid' | 'hum';
  libraryId: string;
  /** Velocity per sixteenth note. 16 or 32 long. */
  steps: number[];
  /** Only used when source is 'hum'. */
  notes: HumNote[];
}

export interface Track {
  id: TrackId;
  enabled: boolean;
  muted: boolean;
  solo: boolean;
  voice: string;
  pattern: TrackPattern;
  /**
   * Which melody shape the line follows. Bass and Lead only: chords and pads
   * vary by inversion instead.
   */
  riff: string;
  /** 0 strips hits out, 0.5 leaves the pattern alone, 1 fills every gap. */
  density: number;
  /** 0 is a perfect loop, 1 rewrites the groove every bar within musical rules. */
  chaos: number;
  /** 0 to 1, mapped to roughly 80 Hz up to 18 kHz on a musical curve. */
  cutoff: number;
  /** 0 to 1. Above about 0.8 the filter starts to whistle on its own. */
  resonance: number;
  /** How far each note pushes the filter open as it sounds. */
  envAmount: number;
  reverbSend: number;
  delaySend: number;
  volume: number;
  pan: number;
  /** Shift the whole track up or down in octaves. */
  octave: number;
  /** How hard this track ducks under the kick, scaled by the master Pump knob. */
  pumpAmount: number;
  /** Only meaningful on the Tear voice: how violently the two oscillators fight. */
  syncAmount: number;
  /** Chance per bar that a note jumps an octave. Melodic tracks only. */
  motion: number;
  /**
   * Sweeping notch filters that make the sound seem to swirl past you.
   * Only on the tracks that carry notes, where it belongs.
   */
  phase: number;
}

export interface MasterSettings {
  /** How hard everything dips on each kick. The single most important knob.  */
  pump: number;
  /** How long the dip takes to recover, in beats. */
  pumpRelease: number;
  /** Master low pass sweep. 1 is fully open. */
  lowpass: number;
  /** Master high pass sweep. 0 is fully open. */
  highpass: number;
  drive: number;
  /** Throws away detail until it sounds like a broken machine. */
  crush: number;
  reverbSize: number;
  /** Delay time as a fraction of a beat, so it always stays in time. */
  delayTime: number;
  delayFeedback: number;
  volume: number;
}

export type ShiftModeId =
  | 'halftime'
  | 'orchestral'
  | 'ambient'
  | 'doubletime'
  | 'custom';

export interface ShiftSettings {
  /** How long the change takes, in bars. */
  transitionBars: 1 | 2 | 4 | 8;
  /** The mode the big button will fire. */
  selectedMode: ShiftModeId;
  /** Your own saved Shift, built from the same controls as the built-in ones. */
  custom: CustomShift;
}

/**
 * A custom Shift is described as multipliers and overrides rather than a whole
 * second song, so it keeps working after you change the underlying material.
 */
export interface CustomShift {
  label: string;
  /** 1 keeps the pulse, 0.5 halves it, 2 doubles it. */
  timeFeel: 0.5 | 1 | 2;
  /** Per track, what happens to its density. 0 silences the track. */
  densityScale: Partial<Record<TrackId, number>>;
  /** Per track, swap in a different voice for the duration. */
  voiceSwap: Partial<Record<TrackId, string>>;
  /** Added to the master low pass, so a positive number opens it up. */
  lowpassDelta: number;
  reverbBoost: number;
  delayBoost: number;
  pumpScale: number;
  /** Tracks switched off entirely. */
  mute: TrackId[];
}

/**
 * Settings for the robot voice on the Vocal track.
 *
 * The words always come from a recording of your own voice. There used to be
 * an option to type them instead, with the voice built from scratch out of a
 * buzz and three resonances. It was honest formant synthesis and it sounded
 * like it: crude, and not good enough to keep. The vocoder needs a real voice
 * to work on, which is exactly how these records were actually made.
 */
export interface VocalSettings {
  /** A vocoder is the choral robot. A talkbox is the nasal, vowel-heavy one. */
  mode: 'vocoder' | 'talkbox';
  /** What you called the recording, kept so a loaded song can tell you. */
  recordingName: string;
  /** More bands means clearer words, fewer means a cruder, thicker robot. */
  bands: number;
  /** How bright the chord underneath the voice is. */
  brightness: number;
  /** Shifts the voice's character. Up sounds smaller, down sounds enormous. */
  formantShift: number;
  /** Lets some of the raw breath through, which brings back the s and t sounds. */
  sibilance: number;
}

/** A clip you loaded, and how the Sample Chop track cuts it up. */
export interface ClipSettings {
  /** The file name, kept so a reloaded song can tell you what to find again. */
  name: string;
  /** How many equal pieces the clip is divided into. */
  slices: number;
  /** Put each slice in key with the current mood. */
  pitchLock: boolean;
  /** How often a slice plays backwards. */
  reverseChance: number;
}

export interface Song {
  version: number;
  name: string;
  /** Seeds every deterministic random choice, so a song always sounds the same. */
  seed: string;
  tempo: number;
  /** Swing, 0 is dead straight and 1 is a heavy shuffle. */
  swing: number;
  /**
   * How fast the patterns advance against the clock. 1 is normal, 0.5 is a
   * half time feel at the same tempo, 2 is double time. Only the Shift button
   * changes this.
   */
  timeFeel: number;
  mood: MoodId;
  /** How many notes melodies are allowed to use. Five is the safe default. */
  palette: PaletteId;
  progression: string;
  master: MasterSettings;
  tracks: Record<TrackId, Track>;
  shift: ShiftSettings;
  vocal: VocalSettings;
  clip: ClipSettings;
}

export const DEFAULT_CUSTOM_SHIFT: CustomShift = {
  label: 'My Shift',
  timeFeel: 1,
  densityScale: {},
  voiceSwap: {},
  lowpassDelta: 0,
  reverbBoost: 0,
  delayBoost: 0,
  pumpScale: 1,
  mute: [],
};

function makeTrack(id: TrackId, overrides: Partial<Track> = {}): Track {
  return {
    id,
    enabled: true,
    muted: false,
    solo: false,
    voice: '',
    pattern: { source: 'library', libraryId: '', steps: new Array(16).fill(0), notes: [] },
    riff: 'root',
    density: 0.5,
    chaos: 0,
    cutoff: 0.8,
    resonance: 0.15,
    envAmount: 0.2,
    reverbSend: 0.1,
    delaySend: 0,
    volume: 0.8,
    pan: 0,
    octave: 0,
    pumpAmount: 0,
    syncAmount: 0.3,
    motion: 0,
    phase: 0,
    ...overrides,
  };
}

/**
 * The song you hear the first time you press play: a plain French house loop
 * that is already musical, so there is something to turn knobs against.
 */
export function createDefaultSong(): Song {
  return {
    version: SONG_FORMAT_VERSION,
    name: 'Untitled',
    seed: 'hum-engine',
    tempo: 120,
    swing: 0,
    timeFeel: 1,
    mood: 'euphoric',
    palette: 'pentatonic',
    progression: 'circle',
    vocal: {
      mode: 'vocoder',
      recordingName: '',
      // Ten is what the Roland SVC-350 had, which is the vocoder on most of
      // the records this is chasing.
      bands: 10,
      brightness: 0.8,
      formantShift: 1,
      sibilance: 0.25,
    },
    clip: {
      name: '',
      slices: 16,
      pitchLock: true,
      reverseChance: 0,
    },
    master: {
      pump: 0.55,
      pumpRelease: 0.65,
      lowpass: 1,
      highpass: 0,
      drive: 0.2,
      crush: 0,
      reverbSize: 0.35,
      delayTime: 0.75,
      delayFeedback: 0.3,
      volume: 0.85,
    },
    shift: {
      transitionBars: 4,
      selectedMode: 'halftime',
      custom: { ...DEFAULT_CUSTOM_SHIFT },
    },
    tracks: {
      kick: makeTrack('kick', {
        voice: 'kick-punch',
        pattern: { source: 'library', libraryId: 'kick-four', steps: [], notes: [] },
        cutoff: 1, reverbSend: 0, volume: 0.95,
      }),
      snare: makeTrack('snare', {
        voice: 'clap-house',
        pattern: { source: 'library', libraryId: 'snare-backbeat', steps: [], notes: [] },
        reverbSend: 0.18, volume: 0.7, pumpAmount: 0.2,
      }),
      hats: makeTrack('hats', {
        voice: 'hat-closed',
        pattern: { source: 'library', libraryId: 'hats-offbeat', steps: [], notes: [] },
        cutoff: 0.9, reverbSend: 0.12, volume: 0.5, pumpAmount: 0.35,
      }),
      bass: makeTrack('bass', {
        voice: 'bass-mono',
        pattern: { source: 'library', libraryId: 'bass-offbeat', steps: [], notes: [] },
        riff: 'root-five',
        cutoff: 0.45, resonance: 0.25, envAmount: 0.45,
        octave: -1, volume: 0.85, pumpAmount: 1, reverbSend: 0,
      }),
      chords: makeTrack('chords', {
        voice: 'chords-supersaw',
        pattern: { source: 'library', libraryId: 'chords-stab-off', steps: [], notes: [] },
        cutoff: 0.55, resonance: 0.3, envAmount: 0.35,
        volume: 0.6, pumpAmount: 0.9, reverbSend: 0.25, delaySend: 0.15,
      }),
      lead: makeTrack('lead', {
        voice: 'lead-supersaw',
        pattern: { source: 'library', libraryId: 'lead-hook', steps: [], notes: [] },
        riff: 'hook',
        enabled: false,
        cutoff: 0.7, resonance: 0.25, envAmount: 0.4,
        volume: 0.55, pumpAmount: 0.6, reverbSend: 0.3, delaySend: 0.3, motion: 0.2,
      }),
      pad: makeTrack('pad', {
        voice: 'pad-warm',
        pattern: { source: 'library', libraryId: 'pad-whole', steps: [], notes: [] },
        cutoff: 0.4, envAmount: 0.1,
        volume: 0.4, pumpAmount: 0.8, reverbSend: 0.5, octave: 0,
      }),
      vocal: makeTrack('vocal', {
        voice: 'vocal-robot',
        pattern: { source: 'library', libraryId: 'vocal-phrase', steps: [], notes: [] },
        enabled: false,
        volume: 0.6, pumpAmount: 0.5, reverbSend: 0.25, delaySend: 0.2,
      }),
      chop: makeTrack('chop', {
        voice: 'chop-sampler',
        pattern: { source: 'library', libraryId: 'chop-even', steps: [], notes: [] },
        enabled: false,
        volume: 0.6, pumpAmount: 0.6, reverbSend: 0.2,
      }),
      fx: makeTrack('fx', {
        voice: 'fx-noise',
        pattern: { source: 'library', libraryId: 'fx-none', steps: [], notes: [] },
        enabled: false,
        volume: 0.45, reverbSend: 0.5,
      }),
    },
  };
}

/**
 * Fill in anything missing from a loaded file so an old save still opens after
 * the app gains new controls.
 */
export function migrateSong(input: unknown): Song {
  const base = createDefaultSong();
  if (!input || typeof input !== 'object') return base;
  const raw = input as Partial<Song>;
  const merged: Song = {
    ...base,
    ...raw,
    master: { ...base.master, ...(raw.master ?? {}) },
    vocal: { ...base.vocal, ...(raw.vocal ?? {}) },
    clip: { ...base.clip, ...(raw.clip ?? {}) },
    shift: {
      ...base.shift,
      ...(raw.shift ?? {}),
      custom: { ...DEFAULT_CUSTOM_SHIFT, ...(raw.shift?.custom ?? {}) },
    },
    tracks: { ...base.tracks },
  };
  for (const id of TRACK_ORDER) {
    const incoming = raw.tracks?.[id];
    if (!incoming) continue;
    merged.tracks[id] = {
      ...base.tracks[id],
      ...incoming,
      pattern: { ...base.tracks[id].pattern, ...(incoming.pattern ?? {}) },
    };
  }
  merged.version = SONG_FORMAT_VERSION;
  return merged;
}

export function cloneSong(song: Song): Song {
  return JSON.parse(JSON.stringify(song)) as Song;
}

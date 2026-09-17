/**
 * One store for the whole app.
 *
 * `song` is the thing you are editing. Everything else here is either playback
 * state that should not be saved, or the Shift ramp.
 *
 * Every edit goes through setParam so that a live performance can be recorded
 * as a list of parameter changes against the transport clock, which is what
 * the export needs in order to replay your knob moves and Shift presses.
 */

import { create } from 'zustand';
import type { Song, ShiftModeId, TrackId, HumNote } from './song';
import { createDefaultSong, migrateSong, cloneSong } from './song';
import { applyShift, blendSongs } from '../shift/modes';

const STORAGE_KEY = 'hum-engine:song:v1';
const SIMPLE_KEY = 'hum-engine:simple';

/** A single recorded move, timed in sixteenth notes from the start of recording. */
export interface PerformanceEvent {
  step: number;
  kind: 'param' | 'shift' | 'return';
  path?: string;
  value?: number | string | boolean;
  mode?: ShiftModeId;
}

/**
 * Anything a control can write into the song. Arrays cover pattern grids and
 * hummed melodies; only the scalar values are worth recording as performance
 * moves, since redrawing a pattern is editing rather than performing.
 */
export type ParamValue = number | string | boolean | number[] | HumNote[];

export interface ShiftRamp {
  mode: ShiftModeId;
  /** Blend value at the start of the ramp. */
  from: number;
  /** Blend value it is heading toward. 1 is fully shifted, 0 is back home. */
  to: number;
  /** Transport position, in sixteenth notes, where the ramp begins. */
  startStep: number;
  /** How many sixteenth notes the ramp takes. */
  steps: number;
}

interface AppState {
  song: Song;
  /** null means no Shift has been engaged. */
  shift: ShiftRamp | null;

  playing: boolean;
  audioReady: boolean;
  /** Absolute sixteenth note count since the transport started. */
  position: number;
  samplesOnline: boolean;

  selectedTrack: TrackId;
  showNoteNames: boolean;
  /**
   * Whether to show the short version of the interface.
   *
   * Not part of the song, because it is a preference about how you like to
   * work rather than anything about the music, and it should not travel with a
   * song file to somebody else's screen.
   */
  simple: boolean;

  recording: boolean;
  recordStartStep: number;
  performance: PerformanceEvent[];
  /**
   * The song exactly as it stood when recording began. Replaying the events on
   * top of this is what reconstructs the performance later.
   */
  recordBaseSong: Song | null;

  setSong: (song: Song) => void;
  setParam: (path: string, value: ParamValue) => void;
  getParam: (path: string) => unknown;
  startShift: (mode: ShiftModeId) => void;
  returnFromShift: () => void;
  setShiftRamp: (ramp: ShiftRamp | null) => void;
  setPlaying: (playing: boolean) => void;
  setAudioReady: (ready: boolean) => void;
  setPosition: (position: number) => void;
  setSamplesOnline: (online: boolean) => void;
  selectTrack: (id: TrackId) => void;
  toggleNoteNames: () => void;
  setSimple: (simple: boolean) => void;
  startRecording: () => void;
  stopRecording: () => void;
  clearPerformance: () => void;
}

/** Immutable deep set for a dotted path like "tracks.bass.cutoff". */
function setPath<T>(target: T, path: string, value: unknown): T {
  const keys = path.split('.');
  const out = Array.isArray(target) ? ([...target] as unknown as T) : { ...target };
  let cursor: Record<string, unknown> = out as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cursor[key];
    cursor[key] = Array.isArray(next) ? [...next] : { ...(next as object) };
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
  return out;
}

function getPath(target: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (cursor, key) => (cursor == null ? undefined : (cursor as Record<string, unknown>)[key]),
    target,
  );
}

function loadSaved(): Song {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrateSong(JSON.parse(raw));
  } catch {
    // A corrupt save should never stop the app from opening.
  }
  return createDefaultSong();
}

/** New here means new to the app, so start short. */
function loadSimple(): boolean {
  try {
    const raw = localStorage.getItem(SIMPLE_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
function saveLater(song: Song): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(song));
    } catch {
      // Private browsing, or a full disk. Not worth interrupting playback.
    }
  }, 400);
}

export const useAppStore = create<AppState>((set, get) => ({
  song: loadSaved(),
  shift: null,
  playing: false,
  audioReady: false,
  position: 0,
  samplesOnline: false,
  selectedTrack: 'kick',
  showNoteNames: false,
  simple: loadSimple(),
  recording: false,
  recordStartStep: 0,
  performance: [],
  recordBaseSong: null,

  setSong: (song) => {
    saveLater(song);
    set({ song, shift: null });
  },

  setParam: (path, value) => {
    const state = get();
    const song = setPath(state.song, path, value);
    saveLater(song);
    const scalar = typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
    if (state.recording && scalar) {
      set({
        song,
        performance: [
          ...state.performance,
          { step: state.position - state.recordStartStep, kind: 'param', path, value },
        ],
      });
    } else {
      set({ song });
    }
  },

  getParam: (path) => getPath(get().song, path),

  startShift: (mode) => {
    const state = get();
    const bars = state.song.shift.transitionBars;
    const current = currentShiftBlend(state.shift, state.position);
    // A transition needs musical time to happen in. Stopped, there is none:
    // the position never advances, so a ramp would sit at its starting value
    // forever and the button would appear to do nothing. So when stopped it
    // simply lands, and you hear the result when you press play.
    const landed = !state.playing;
    set({
      shift: {
        mode,
        from: landed ? 1 : current,
        to: 1,
        startStep: state.position,
        steps: Math.max(1, bars * 16),
      },
      performance: state.recording
        ? [...state.performance, { step: state.position - state.recordStartStep, kind: 'shift', mode }]
        : state.performance,
    });
  },

  returnFromShift: () => {
    const state = get();
    if (!state.shift) return;
    const bars = state.song.shift.transitionBars;
    set({
      shift: {
        mode: state.shift.mode,
        from: state.playing ? currentShiftBlend(state.shift, state.position) : 0,
        to: 0,
        startStep: state.position,
        steps: Math.max(1, bars * 16),
      },
      performance: state.recording
        ? [...state.performance, { step: state.position - state.recordStartStep, kind: 'return' }]
        : state.performance,
    });
  },

  setShiftRamp: (ramp) => set({ shift: ramp }),
  setPlaying: (playing) => set({ playing }),
  setAudioReady: (audioReady) => set({ audioReady }),
  setPosition: (position) => set({ position }),
  setSamplesOnline: (samplesOnline) => set({ samplesOnline }),
  selectTrack: (selectedTrack) => set({ selectedTrack }),
  toggleNoteNames: () => set({ showNoteNames: !get().showNoteNames }),

  setSimple: (simple) => {
    try {
      localStorage.setItem(SIMPLE_KEY, simple ? '1' : '0');
    } catch {
      // Not worth interrupting anything over.
    }
    set({ simple });
  },

  startRecording: () =>
    set({
      recording: true,
      recordStartStep: get().position,
      performance: [],
      recordBaseSong: cloneSong(get().song),
    }),
  stopRecording: () => set({ recording: false }),
  clearPerformance: () => set({ performance: [], recordBaseSong: null }),
}));

/** How far through a Shift we are right now, 0 is home and 1 is fully shifted. */
export function currentShiftBlend(ramp: ShiftRamp | null, position: number): number {
  if (!ramp) return 0;
  const progress = Math.max(0, Math.min(1, (position - ramp.startStep) / ramp.steps));
  // Ease in and out so the transition does not start or stop abruptly.
  const eased = progress * progress * (3 - 2 * progress);
  return ramp.from + (ramp.to - ramp.from) * eased;
}

let cachedBase: Song | null = null;
let cachedMode: ShiftModeId | null = null;
let cachedTarget: Song | null = null;

/**
 * The song the engine plays: the base song, the shifted song, or a blend.
 *
 * The shifted version is recomputed from the live base song rather than being
 * a snapshot taken when you pressed the button. That is deliberate: it means a
 * knob you turn while shifted still does something, which matters when you are
 * performing.
 */
export function renderSong(song: Song, ramp: ShiftRamp | null, position: number): Song {
  const blend = currentShiftBlend(ramp, position);
  if (!ramp || blend <= 0) return song;
  if (cachedBase !== song || cachedMode !== ramp.mode || !cachedTarget) {
    cachedBase = song;
    cachedMode = ramp.mode;
    cachedTarget = applyShift(song, ramp.mode);
  }
  if (blend >= 1) return cachedTarget;
  return blendSongs(song, cachedTarget, blend);
}

export function exportSongJson(song: Song): string {
  return JSON.stringify(song, null, 2);
}

export function duplicateSong(song: Song): Song {
  return cloneSong(song);
}

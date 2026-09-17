/**
 * Shift: turn what you have built into an emotionally opposite version of the
 * same material.
 *
 * A Shift mode is a pure function from one song to another song. Nothing is
 * generated fresh, so the new version is recognisably the same piece: same
 * tempo, same chords, same melody, different feeling.
 *
 * The transition is handled by blending between the two songs over a chosen
 * number of bars rather than cutting, which is what makes it usable live.
 */

import type { Song, ShiftModeId, TrackId, CustomShift } from '../state/song';
import { cloneSong, TRACK_ORDER } from '../state/song';

export interface ShiftModeDef {
  id: ShiftModeId;
  label: string;
  tooltip: string;
  apply: (song: Song) => Song;
}

/** Push a 0..1 control toward a target without ever leaving the range. */
function toward(value: number, target: number, amount: number): number {
  return Math.max(0, Math.min(1, value + (target - value) * amount));
}

function setTrack(song: Song, id: TrackId, changes: Partial<Song['tracks'][TrackId]>): void {
  song.tracks[id] = { ...song.tracks[id], ...changes };
}

const halftime: ShiftModeDef = {
  id: 'halftime',
  label: 'Half-time breakdown',
  tooltip: 'Same tempo, but the beat sinks to half speed and the drums thin out.',
  apply: (input) => {
    const song = cloneSong(input);
    song.timeFeel = 0.5;
    setTrack(song, 'kick', { density: 0.28 });
    setTrack(song, 'snare', { density: 0.3, reverbSend: Math.min(1, song.tracks.snare.reverbSend + 0.25) });
    setTrack(song, 'hats', { density: 0.2, volume: song.tracks.hats.volume * 0.6 });
    setTrack(song, 'bass', { density: 0.35, cutoff: toward(song.tracks.bass.cutoff, 0.3, 0.6) });
    setTrack(song, 'chords', { cutoff: toward(song.tracks.chords.cutoff, 0.35, 0.5) });
    setTrack(song, 'pad', { enabled: true, volume: Math.min(1, song.tracks.pad.volume + 0.15) });
    song.master.lowpass = toward(song.master.lowpass, 0.55, 0.7);
    song.master.reverbSize = toward(song.master.reverbSize, 0.7, 0.6);
    song.master.pump = toward(song.master.pump, 0.35, 0.5);
    return song;
  },
};

const orchestral: ShiftModeDef = {
  id: 'orchestral',
  label: 'Orchestral',
  tooltip: 'The same chords and melody played by strings, brass and piano. Drums step back.',
  apply: (input) => {
    const song = cloneSong(input);
    song.timeFeel = 1;
    setTrack(song, 'kick', { density: 0.15, voice: 'kick-soft' });
    setTrack(song, 'snare', { density: 0.12, voice: 'snare-rim' });
    setTrack(song, 'hats', { density: 0.1, voice: 'hat-shaker', volume: song.tracks.hats.volume * 0.5 });
    setTrack(song, 'bass', { voice: 'bass-sub', cutoff: 0.5, resonance: 0.05, envAmount: 0.05, density: 0.35 });
    setTrack(song, 'chords', {
      voice: 'chords-strings', cutoff: 0.8, resonance: 0.05, envAmount: 0.05,
      reverbSend: 0.6, pumpAmount: 0.1,
    });
    setTrack(song, 'lead', { enabled: true, voice: 'lead-brass', reverbSend: 0.5, pumpAmount: 0.1, cutoff: 0.75 });
    setTrack(song, 'pad', { enabled: true, voice: 'pad-strings', reverbSend: 0.65, volume: Math.min(1, song.tracks.pad.volume + 0.2), pumpAmount: 0.1 });
    setTrack(song, 'chop', { enabled: false });
    song.master.pump = 0.08;
    song.master.drive = toward(song.master.drive, 0.05, 0.8);
    song.master.reverbSize = toward(song.master.reverbSize, 0.8, 0.8);
    // Starts fairly closed so the blend reads as a filter opening over the
    // transition rather than a sudden instrument swap.
    song.master.lowpass = 0.92;
    return song;
  },
};

const ambient: ShiftModeDef = {
  id: 'ambient',
  label: 'Ambient wash',
  tooltip: 'Drums out, everything into long reverb, the pad holds the chord.',
  apply: (input) => {
    const song = cloneSong(input);
    song.timeFeel = 0.5;
    setTrack(song, 'kick', { enabled: false });
    setTrack(song, 'snare', { enabled: false });
    setTrack(song, 'hats', { density: 0.08, volume: song.tracks.hats.volume * 0.3 });
    setTrack(song, 'bass', { voice: 'bass-sub', density: 0.15, cutoff: 0.3, envAmount: 0, reverbSend: 0.4 });
    setTrack(song, 'chords', { density: 0.2, cutoff: 0.5, reverbSend: 0.7, delaySend: 0.4, pumpAmount: 0 });
    setTrack(song, 'lead', { reverbSend: 0.7, delaySend: 0.6, density: 0.25, pumpAmount: 0 });
    setTrack(song, 'pad', {
      enabled: true, volume: Math.min(1, song.tracks.pad.volume + 0.3),
      reverbSend: 0.85, cutoff: 0.55, pumpAmount: 0,
      pattern: { ...song.tracks.pad.pattern, source: 'library', libraryId: 'pad-whole' },
    });
    setTrack(song, 'chop', { enabled: false });
    song.master.pump = 0;
    song.master.reverbSize = 0.95;
    song.master.delayFeedback = Math.max(song.master.delayFeedback, 0.55);
    song.master.lowpass = 0.7;
    song.master.drive = toward(song.master.drive, 0, 0.9);
    return song;
  },
};

const doubletime: ShiftModeDef = {
  id: 'doubletime',
  label: 'Double-time lift',
  tooltip: 'Hats and percussion double up, the filter opens, a riser builds. Energy goes up.',
  apply: (input) => {
    const song = cloneSong(input);
    song.timeFeel = 2;
    setTrack(song, 'kick', { density: 0.5 });
    setTrack(song, 'snare', { density: 0.62 });
    setTrack(song, 'hats', { density: 0.85, volume: Math.min(1, song.tracks.hats.volume + 0.15) });
    setTrack(song, 'bass', { density: 0.7, cutoff: toward(song.tracks.bass.cutoff, 0.7, 0.6) });
    setTrack(song, 'chords', { density: 0.65, cutoff: toward(song.tracks.chords.cutoff, 0.9, 0.8) });
    setTrack(song, 'lead', { enabled: true, density: 0.7, cutoff: toward(song.tracks.lead.cutoff, 0.95, 0.8) });
    setTrack(song, 'fx', {
      enabled: true, voice: 'fx-riser', volume: 0.5, reverbSend: 0.4,
      pattern: { ...song.tracks.fx.pattern, source: 'library', libraryId: 'fx-riser' },
    });
    song.master.lowpass = 1;
    song.master.highpass = toward(song.master.highpass, 0.08, 1);
    song.master.pump = Math.min(1, song.master.pump + 0.2);
    song.master.drive = Math.min(1, song.master.drive + 0.15);
    return song;
  },
};

/** Build a Shift from the controls you set yourself. */
export function applyCustomShift(input: Song, custom: CustomShift): Song {
  const song = cloneSong(input);
  song.timeFeel = custom.timeFeel;
  for (const id of TRACK_ORDER) {
    const track = song.tracks[id];
    const scale = custom.densityScale[id];
    if (scale !== undefined) {
      track.density = Math.max(0, Math.min(1, track.density * scale));
      if (scale === 0) track.enabled = false;
    }
    const swap = custom.voiceSwap[id];
    if (swap) track.voice = swap;
    if (custom.mute.includes(id)) track.enabled = false;
    track.reverbSend = Math.max(0, Math.min(1, track.reverbSend + custom.reverbBoost));
    track.delaySend = Math.max(0, Math.min(1, track.delaySend + custom.delayBoost));
  }
  song.master.lowpass = Math.max(0, Math.min(1, song.master.lowpass + custom.lowpassDelta));
  song.master.pump = Math.max(0, Math.min(1, song.master.pump * custom.pumpScale));
  song.master.reverbSize = Math.max(0, Math.min(1, song.master.reverbSize + custom.reverbBoost));
  return song;
}

export const SHIFT_MODES: ShiftModeDef[] = [
  halftime,
  orchestral,
  ambient,
  doubletime,
  {
    id: 'custom',
    label: 'Custom',
    tooltip: 'Your own Shift, built from the same controls and saved with the song.',
    apply: (song) => applyCustomShift(song, song.shift.custom),
  },
];

export const SHIFT_MODE_BY_ID = new Map(SHIFT_MODES.map((m) => [m.id, m]));

export function applyShift(song: Song, mode: ShiftModeId): Song {
  return (SHIFT_MODE_BY_ID.get(mode) ?? halftime).apply(song);
}

// ---------------------------------------------------------------------------
// Blending
// ---------------------------------------------------------------------------

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Mix two songs into the one the engine actually plays.
 *
 * Continuous controls slide, which is what gives the long filter opening and
 * the reverb growing across the transition. Choices that cannot be halfway
 * done, like which voice is playing, swap at the midpoint. Because the engine
 * only ever reads the blended result, a Shift in progress is just a song like
 * any other.
 */
export function blendSongs(from: Song, to: Song, t: number): Song {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const past = t >= 0.5;
  const discrete = past ? to : from;
  const out = cloneSong(discrete);

  out.timeFeel = past ? to.timeFeel : from.timeFeel;
  out.swing = lerp(from.swing, to.swing, t);

  out.master = {
    pump: lerp(from.master.pump, to.master.pump, t),
    pumpRelease: lerp(from.master.pumpRelease, to.master.pumpRelease, t),
    lowpass: lerp(from.master.lowpass, to.master.lowpass, t),
    highpass: lerp(from.master.highpass, to.master.highpass, t),
    drive: lerp(from.master.drive, to.master.drive, t),
    reverbSize: lerp(from.master.reverbSize, to.master.reverbSize, t),
    delayTime: discrete.master.delayTime,
    delayFeedback: lerp(from.master.delayFeedback, to.master.delayFeedback, t),
    volume: lerp(from.master.volume, to.master.volume, t),
  };

  for (const id of TRACK_ORDER) {
    const a = from.tracks[id];
    const b = to.tracks[id];
    const target = out.tracks[id];
    target.density = lerp(a.density, b.density, t);
    target.chaos = lerp(a.chaos, b.chaos, t);
    target.cutoff = lerp(a.cutoff, b.cutoff, t);
    target.resonance = lerp(a.resonance, b.resonance, t);
    target.envAmount = lerp(a.envAmount, b.envAmount, t);
    target.reverbSend = lerp(a.reverbSend, b.reverbSend, t);
    target.delaySend = lerp(a.delaySend, b.delaySend, t);
    target.pan = lerp(a.pan, b.pan, t);
    target.pumpAmount = lerp(a.pumpAmount, b.pumpAmount, t);
    target.syncAmount = lerp(a.syncAmount, b.syncAmount, t);
    target.motion = lerp(a.motion, b.motion, t);

    // A track that is on at one end and off at the other fades rather than
    // disappearing, so nothing pops out of the mix mid-transition.
    const fromLevel = a.enabled && !a.muted ? a.volume : 0;
    const toLevel = b.enabled && !b.muted ? b.volume : 0;
    target.volume = lerp(fromLevel, toLevel, t);
    target.enabled = fromLevel > 0 || toLevel > 0;
    target.muted = false;
  }
  return out;
}

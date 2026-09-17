/**
 * Working out why there is no sound.
 *
 * Almost every control in this app can be turned down to nothing, and the song
 * is saved as you go, so a setting left at zero comes back after a reload and
 * the app opens silent with no clue as to why. Solo is the worst of them: solo
 * the Sample Chop track without a clip loaded and every other track is muted
 * in favour of one that has nothing to play.
 *
 * Guessing which one it was is not something a person should have to do, so
 * this works it out and says so in plain words, with a fix attached.
 */

import type { Song, TrackId } from './song';
import { TRACK_LABELS, TRACK_ORDER } from './song';

export interface SilenceReason {
  /** What is wrong, in plain words. */
  message: string;
  /** What the button will do about it. */
  fixLabel: string;
  /** The change to make. */
  fix: (song: Song) => Song;
}

/** Tracks that stay silent until you give them something to play. */
function needsMaterial(id: TrackId, context: DiagnoseContext): boolean {
  if (id === 'chop') return !context.clipLoaded;
  if (id === 'vocal') return !context.vocalReady;
  return false;
}

export interface DiagnoseContext {
  clipLoaded: boolean;
  vocalReady: boolean;
}

function edit(song: Song, change: (draft: Song) => void): Song {
  const draft = JSON.parse(JSON.stringify(song)) as Song;
  change(draft);
  return draft;
}

/**
 * Every reason the mix could be silent, most likely first.
 *
 * Only ever called once the output has actually been measured as silent for a
 * couple of seconds. Reading the settings alone is not good enough: sweeping
 * the master filter shut is a deliberate performance move that still passes
 * the kick, and being told "no sound?" in the middle of doing it would be
 * both wrong and infuriating.
 *
 * Returns an empty list when it cannot tell, in which case the caller still
 * says something, just less specific.
 */
export function diagnoseSilence(song: Song, context: DiagnoseContext): SilenceReason[] {
  const reasons: SilenceReason[] = [];

  if (song.master.volume < 0.02) {
    reasons.push({
      message: 'The master Volume is turned all the way down.',
      fixLabel: 'Turn it back up',
      fix: (current) => edit(current, (draft) => { draft.master.volume = 0.85; }),
    });
  }

  // A low pass even at its lowest still passes the kick's fundamental, so
  // this only counts as a reason when the mix has actually gone quiet, which
  // the caller has already established.
  if (song.master.lowpass < 0.08) {
    reasons.push({
      message: 'The master Sweep down knob is closed, which filters out almost everything.',
      fixLabel: 'Open it back up',
      fix: (current) => edit(current, (draft) => { draft.master.lowpass = 1; }),
    });
  }

  if (song.master.highpass > 0.9) {
    reasons.push({
      message: 'The master Sweep up knob is at the top, which removes nearly all of the sound.',
      fixLabel: 'Bring it back down',
      fix: (current) => edit(current, (draft) => { draft.master.highpass = 0; }),
    });
  }

  const soloed = TRACK_ORDER.filter((id) => song.tracks[id].solo);
  if (soloed.length > 0) {
    const useful = soloed.filter((id) => {
      const track = song.tracks[id];
      return track.enabled && !track.muted && track.volume > 0.01 && !needsMaterial(id, context);
    });
    if (useful.length === 0) {
      const names = soloed.map((id) => TRACK_LABELS[id]).join(' and ');
      reasons.push({
        message: `Solo is on for ${names}, which silences everything else, and ${soloed.length > 1 ? 'none of those tracks have' : 'that track has'} nothing to play.`,
        fixLabel: 'Turn solo off',
        fix: (current) =>
          edit(current, (draft) => {
            for (const id of TRACK_ORDER) draft.tracks[id].solo = false;
          }),
      });
    }
  }

  const audible = TRACK_ORDER.filter((id) => {
    const track = song.tracks[id];
    return track.enabled && !track.muted && track.volume > 0.01 && !needsMaterial(id, context);
  });
  if (audible.length === 0) {
    reasons.push({
      message: 'Every track is either off, muted or turned down.',
      fixLabel: 'Bring the drums and bass back',
      fix: (current) =>
        edit(current, (draft) => {
          for (const id of ['kick', 'snare', 'hats', 'bass', 'chords'] as TrackId[]) {
            draft.tracks[id].enabled = true;
            draft.tracks[id].muted = false;
            if (draft.tracks[id].volume < 0.05) draft.tracks[id].volume = 0.7;
          }
        }),
    });
  }

  return reasons;
}

/**
 * Put the master section and the mute switches back to sensible values.
 *
 * Deliberately leaves the actual music alone: same voices, same patterns, same
 * melody shapes, same mood. It undoes the things that can silence a mix, not
 * the work.
 */
export function restoreSound(song: Song): Song {
  return edit(song, (draft) => {
    draft.master.volume = 0.85;
    draft.master.lowpass = 1;
    draft.master.highpass = 0;
    if (draft.master.crush > 0.85) draft.master.crush = 0.2;
    for (const id of TRACK_ORDER) {
      draft.tracks[id].solo = false;
      draft.tracks[id].muted = false;
    }
    for (const id of ['kick', 'bass'] as TrackId[]) {
      draft.tracks[id].enabled = true;
      if (draft.tracks[id].volume < 0.05) draft.tracks[id].volume = 0.8;
    }
  });
}

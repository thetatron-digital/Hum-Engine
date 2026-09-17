/**
 * Melody shapes.
 *
 * This is the answer to "every song sounds the same". Before this, a melodic
 * track simply cycled through the notes of the current chord in order, so
 * changing the preset changed the sounds and the rhythm but barely changed the
 * tune. A riff is a written shape instead: a list of moves up and down the
 * palette, consumed one per note played.
 *
 * The numbers are positions in the note palette, not semitones, and they are
 * relative to whatever chord is sounding. So the same shape follows the
 * harmony, and on the five note palette it cannot land on a wrong note however
 * far it wanders.
 *
 * A shape is consumed per *hit* rather than per sixteenth, which is what lets
 * any shape sit on any rhythm. The same "Perfect fourths" riff reads as a
 * stabbing hook on an offbeat pattern and as a rolling line on sixteenths.
 */

import type { TrackRole } from './patterns';

export interface Riff {
  id: string;
  label: string;
  tooltip: string;
  roles: TrackRole[];
  /** Positions in the palette, relative to the chord root. */
  steps: number[];
  /**
   * Adds a second note this many semitones above every note.
   *
   * Real parallel intervals, not snapped to the scale. Daft Punk's Da Funk
   * riff is played in perfect fourths, which is this at 5 semitones, and it is
   * a large part of why that lead sounds like it does.
   */
  parallel?: number;
}

// Riffs are for the single note lines. Chords and pads keep playing chords;
// their variation comes from inversions instead, so the harmony stays intact.
const MELODIC: TrackRole[] = ['lead'];
const ALL: TrackRole[] = ['bass', 'lead'];

export const RIFFS: Riff[] = [
  { id: 'root', label: 'Hold the note', tooltip: 'Stays on one note. Let the filter and the rhythm do the work.', roles: ALL, steps: [0] },
  { id: 'rise', label: 'Rise', tooltip: 'Climbs step by step. Simple and hopeful.', roles: ALL, steps: [0, 1, 2, 3] },
  { id: 'fall', label: 'Fall', tooltip: 'Comes down step by step. Reads as resignation.', roles: ALL, steps: [4, 3, 2, 1] },
  { id: 'arch', label: 'Arch', tooltip: 'Up and back down again. The most natural shape for a hook.', roles: ALL, steps: [0, 1, 2, 3, 2, 1] },
  { id: 'zigzag', label: 'Zigzag', tooltip: 'Jumps back and forth. Restless and mechanical.', roles: ALL, steps: [0, 2, 1, 3] },
  { id: 'octaves', label: 'Octaves', tooltip: 'The same note, high and low. Relentless, very much a machine.', roles: ALL, steps: [0, 5, 0, 5] },
  { id: 'fourths', label: 'Perfect fourths', tooltip: 'Two notes at once, a fourth apart, moving together. This is the Da Funk lead.', roles: MELODIC, steps: [0, 0, 2, 0, 3, 2], parallel: 5 },
  { id: 'fifths', label: 'Wide fifths', tooltip: 'Two notes a fifth apart. Hollow and enormous, good for anything heroic.', roles: MELODIC, steps: [0, 2, 3, 2], parallel: 7 },
  { id: 'sync-riff', label: 'Sync riff', tooltip: 'A short stabbing figure that keeps returning home. Built for the Tear voice and the Robot Rock sound.', roles: MELODIC, steps: [0, 0, 1, 0, 3, 0, 1, 0] },
  { id: 'call', label: 'Call and answer', tooltip: 'Asks a question, then answers it lower down.', roles: ALL, steps: [0, 2, 4, 0, -1, -3] },
  { id: 'hook', label: 'Hook', tooltip: 'A crooked little phrase that sticks in the head.', roles: MELODIC, steps: [0, 2, 0, -2, 0, 1, 0] },
  { id: 'climb', label: 'Long climb', tooltip: 'Walks all the way up through two octaves. Good for a build.', roles: ALL, steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] },
  { id: 'tumble', label: 'Tumble', tooltip: 'Falls a long way and lands. Use it going into a drop.', roles: ALL, steps: [9, 7, 5, 4, 2, 0] },
  { id: 'wander', label: 'Wander', tooltip: 'Never repeats the same way twice in a bar. Keeps a long loop alive.', roles: MELODIC, steps: [0, 1, -1, 2, 0, 3, -2, 1, 4, -1] },
  { id: 'pedal', label: 'Pedal and lift', tooltip: 'Sits on one note and reaches up occasionally. Very Tron.', roles: ALL, steps: [0, 0, 0, 2, 0, 0, 3, 0] },
  { id: 'stab', label: 'Two note stab', tooltip: 'Alternates between two notes far apart. Stark and repetitive.', roles: ALL, steps: [0, 4] },
  { id: 'walk', label: 'Walking bass', tooltip: 'Steps up into the next chord. The line that pulls a progression along.', roles: ['bass'], steps: [0, 1, 2, 1] },
  { id: 'root-five', label: 'Root and fifth', tooltip: 'The two notes that never argue with anything. The safest bass line there is.', roles: ['bass'], steps: [0, 0, 3, 0] },
  { id: 'sub-drop', label: 'Sub drop', tooltip: 'Holds low, then drops an octave. Felt more than heard.', roles: ['bass'], steps: [0, 0, 0, -5] },
  { id: 'growl', label: 'Growl', tooltip: 'Leans on the flattened note. Needs the six note palette to bite.', roles: ALL, steps: [0, 3, 2, 3, 0, -2] },
];

export const RIFF_BY_ID = new Map(RIFFS.map((riff) => [riff.id, riff]));

export function riffsForRole(role: TrackRole): Riff[] {
  return RIFFS.filter((riff) => riff.roles.includes(role));
}

export function getRiff(id: string, role: TrackRole): Riff {
  const found = RIFF_BY_ID.get(id);
  if (found && found.roles.includes(role)) return found;
  return riffsForRole(role)[0] ?? RIFFS[0];
}

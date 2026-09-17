/**
 * Chord progressions, named by feel rather than by numerals.
 *
 * A progression is a list of scale degrees. Because the chords are built by
 * stacking notes from the current mood's scale, the same progression works in
 * every mood and always stays in key. You choose by listening, not by name.
 */

import type { Mood } from './moods';
import { degreeToMidi } from './moods';

export interface Progression {
  id: string;
  label: string;
  tooltip: string;
  /** One entry per chord. 0 is the home chord. */
  degrees: number[];
  /** How many bars each chord is held for. */
  barsPerChord: number;
  /** Add the seventh note for a richer, jazzier stack. */
  sevenths: boolean;
}

export const PROGRESSIONS: Progression[] = [
  {
    id: 'hold',
    label: 'Hold',
    tooltip: 'Stays on one chord. Hypnotic. Let the filter do the work.',
    degrees: [0],
    barsPerChord: 2,
    sevenths: false,
  },
  {
    id: 'breathe',
    label: 'Breathe',
    tooltip: 'Two chords rocking back and forth. The loop you can leave running.',
    degrees: [0, 5],
    barsPerChord: 2,
    sevenths: true,
  },
  {
    id: 'sinking',
    label: 'Sinking',
    tooltip: 'Walks downward. Feels like the floor is dropping away.',
    degrees: [0, 6, 5, 4],
    barsPerChord: 1,
    sevenths: false,
  },
  {
    id: 'lift',
    label: 'Lift',
    tooltip: 'Climbs and resolves upward. The obvious crowd pleaser.',
    degrees: [5, 3, 0, 4],
    barsPerChord: 1,
    sevenths: false,
  },
  {
    id: 'circle',
    label: 'Circle',
    tooltip: 'Goes around and lands home. Never resolves early, so it loops forever.',
    degrees: [0, 3, 5, 4],
    barsPerChord: 1,
    sevenths: true,
  },
  {
    id: 'stairs',
    label: 'Stairs',
    tooltip: 'Steps up one note at a time. Builds pressure without a drop.',
    degrees: [0, 1, 2, 3],
    barsPerChord: 1,
    sevenths: false,
  },
  {
    id: 'ache',
    label: 'Ache',
    tooltip: 'Hangs on an unresolved chord before falling home. Very French house.',
    degrees: [3, 4, 5, 0],
    barsPerChord: 1,
    sevenths: true,
  },
  {
    id: 'pulse',
    label: 'Pulse',
    tooltip: 'Long home chord, short answer. Good under dialogue.',
    degrees: [0, 0, 4, 0],
    barsPerChord: 1,
    sevenths: false,
  },
  {
    id: 'unravel',
    label: 'Unravel',
    tooltip: 'Eight chords that drift further from home before returning.',
    degrees: [0, 5, 3, 6, 2, 4, 1, 0],
    barsPerChord: 1,
    sevenths: true,
  },
  {
    id: 'stab',
    label: 'Stab',
    tooltip: 'Fast changes, one per half bar. Built for chopped chord hits.',
    degrees: [0, 5, 3, 4],
    barsPerChord: 0.5,
    sevenths: true,
  },
];

export const PROGRESSION_BY_ID = new Map(PROGRESSIONS.map((p) => [p.id, p]));

export function getProgression(id: string): Progression {
  return PROGRESSION_BY_ID.get(id) ?? PROGRESSIONS[0];
}

/** Total length of one trip through the progression, in bars. */
export function progressionBars(progression: Progression): number {
  return Math.max(1, progression.degrees.length * progression.barsPerChord);
}

/** Which chord of the progression is sounding at a given bar. */
export function chordIndexAtBar(progression: Progression, bar: number): number {
  const total = progressionBars(progression);
  const positionInCycle = bar % total;
  return Math.floor(positionInCycle / progression.barsPerChord) % progression.degrees.length;
}

export interface Chord {
  /** Root degree of this chord within the mood's scale. */
  degree: number;
  /** MIDI notes, low to high. */
  notes: number[];
}

/**
 * Build the chord for a bar by stacking every other scale note upward from the
 * chord's root degree. Stacking within the scale is what guarantees the chord
 * is diatonic, so major and minor quality falls out of the mood automatically.
 */
export function chordAtBar(
  mood: Mood,
  progression: Progression,
  bar: number,
  octave: number,
): Chord {
  const degree = progression.degrees[chordIndexAtBar(progression, bar)];
  const offsets = progression.sevenths ? [0, 2, 4, 6] : [0, 2, 4];
  return {
    degree,
    notes: offsets.map((offset) => degreeToMidi(mood, degree + offset, octave)),
  };
}

/**
 * Spread a chord across a wider range for pads and strings, and drop the top
 * note an octave now and then so the voicing does not sit in a block.
 */
export function voiceChordWide(chord: Chord, spread: number): number[] {
  if (spread <= 0) return chord.notes;
  return chord.notes.map((note, index) => {
    if (index === 0) return note - 12;
    if (index === chord.notes.length - 1 && spread > 0.6) return note + 12;
    return note;
  });
}

/**
 * Moods replace keys and scales in the interface.
 *
 * You pick a feeling. Behind the scenes each feeling is a root note plus a
 * scale, and every melodic track is forced through that scale, which is why
 * nothing you do can land on a wrong note.
 */

export type MoodId =
  | 'dark'
  | 'euphoric'
  | 'tense'
  | 'melancholy'
  | 'neutral'
  | 'heroic';

export interface Mood {
  id: MoodId;
  label: string;
  tooltip: string;
  /** Pitch class of the home note, 0 = C, 1 = C#, ... 11 = B. */
  root: number;
  /** Semitone steps up from the root. Seven notes, always. */
  intervals: number[];
  /**
   * A nudge to the default brightness of new sounds, -1 darker to +1 brighter.
   * Picking Dark should audibly close things down before you touch a knob.
   */
  brightness: number;
}

export const MOODS: Record<MoodId, Mood> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    tooltip: 'Heavy and closed in. Minor, low root, dimmer filters by default.',
    root: 9, // A
    intervals: [0, 2, 3, 5, 7, 8, 10], // natural minor
    brightness: -0.35,
  },
  euphoric: {
    id: 'euphoric',
    label: 'Euphoric',
    tooltip: 'Hands in the air. Major and bright, the classic house feeling.',
    root: 2, // D
    intervals: [0, 2, 4, 5, 7, 9, 11], // major
    brightness: 0.35,
  },
  tense: {
    id: 'tense',
    label: 'Tense',
    tooltip: 'Uneasy and coiled. A flattened second note makes it feel unresolved.',
    root: 4, // E
    intervals: [0, 1, 3, 5, 7, 8, 10], // phrygian
    brightness: -0.1,
  },
  melancholy: {
    id: 'melancholy',
    label: 'Melancholy',
    tooltip: 'Sad but still moving. Minor with one hopeful note in it.',
    root: 0, // C
    intervals: [0, 2, 3, 5, 7, 9, 10], // dorian
    brightness: 0,
  },
  neutral: {
    id: 'neutral',
    label: 'Neutral',
    tooltip: 'Neither happy nor sad. Sits under dialogue without pulling focus.',
    root: 7, // G
    intervals: [0, 2, 4, 5, 7, 9, 10], // mixolydian
    brightness: 0.1,
  },
  heroic: {
    id: 'heroic',
    label: 'Heroic',
    tooltip: 'Wide and rising. Major with a lifted fourth, the trailer sound.',
    root: 5, // F
    intervals: [0, 2, 4, 6, 7, 9, 11], // lydian
    brightness: 0.45,
  },
};

export const MOOD_LIST = Object.values(MOODS);

/**
 * Turn a scale degree into a MIDI note number.
 *
 * Degrees run 0..6 inside one octave but you may pass any integer: degree 7 is
 * the root an octave up, degree -1 is the seventh below. That lets melodic code
 * walk up and down freely and stay in key without any octave bookkeeping.
 */
export function degreeToMidi(mood: Mood, degree: number, octave: number): number {
  const size = mood.intervals.length;
  const octaveShift = Math.floor(degree / size);
  const index = ((degree % size) + size) % size;
  return 12 * (octave + 1 + octaveShift) + mood.root + mood.intervals[index];
}

/** Snap any MIDI note to the nearest note in the mood. Used by hum capture. */
export function snapMidiToMood(mood: Mood, midi: number): number {
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
  const allowed = mood.intervals.map((i) => (mood.root + i) % 12);
  let best = pitchClass;
  let bestDistance = 99;
  for (const candidate of allowed) {
    // Compare across the octave seam so B can snap up to C.
    for (const offset of [-12, 0, 12]) {
      const distance = Math.abs(candidate + offset - pitchClass);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = candidate + offset;
      }
    }
  }
  return Math.round(midi) + (best - pitchClass);
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Only ever shown when the "show note names" toggle is on. */
export function midiToName(midi: number): string {
  const rounded = Math.round(midi);
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${Math.floor(rounded / 12) - 1}`;
}

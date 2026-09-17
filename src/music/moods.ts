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
  /**
   * Five notes rather than seven, as semitones from the root.
   *
   * The two notes left out of each scale are the ones that sit a semitone from
   * a neighbour. Those are the notes that sound like a mistake if you land on
   * them at the wrong moment, so removing them is why a melody written on five
   * notes is so much harder to get wrong than one written on seven. Chords are
   * still built from all seven, so the harmony keeps its colour.
   */
  pentatonic: number[];
  /** The five notes plus the flattened fifth, which is the note that growls. */
  blues: number[];
}

export const MOODS: Record<MoodId, Mood> = {
  dark: {
    id: 'dark',
    label: 'Dark',
    tooltip: 'Heavy and closed in. Minor, low root, dimmer filters by default.',
    root: 9, // A
    intervals: [0, 2, 3, 5, 7, 8, 10], // natural minor
    brightness: -0.35,
    pentatonic: [0, 3, 5, 7, 10], // minor pentatonic
    blues: [0, 3, 5, 6, 7, 10],
  },
  euphoric: {
    id: 'euphoric',
    label: 'Euphoric',
    tooltip: 'Hands in the air. Major and bright, the classic house feeling.',
    root: 2, // D
    intervals: [0, 2, 4, 5, 7, 9, 11], // major
    brightness: 0.35,
    pentatonic: [0, 2, 4, 7, 9], // major pentatonic
    blues: [0, 2, 3, 4, 7, 9],
  },
  tense: {
    id: 'tense',
    label: 'Tense',
    tooltip: 'Uneasy and coiled. A flattened second note makes it feel unresolved.',
    root: 4, // E
    intervals: [0, 1, 3, 5, 7, 8, 10], // phrygian
    brightness: -0.1,
    // Keeps the flattened second, which is the note that makes this mood uneasy.
    pentatonic: [0, 1, 5, 7, 10],
    blues: [0, 1, 5, 6, 7, 10],
  },
  melancholy: {
    id: 'melancholy',
    label: 'Melancholy',
    tooltip: 'Sad but still moving. Minor with one hopeful note in it.',
    root: 0, // C
    intervals: [0, 2, 3, 5, 7, 9, 10], // dorian
    brightness: 0,
    pentatonic: [0, 3, 5, 7, 10],
    blues: [0, 3, 5, 6, 7, 10],
  },
  neutral: {
    id: 'neutral',
    label: 'Neutral',
    tooltip: 'Neither happy nor sad. Sits under dialogue without pulling focus.',
    root: 7, // G
    intervals: [0, 2, 4, 5, 7, 9, 10], // mixolydian
    brightness: 0.1,
    pentatonic: [0, 2, 4, 7, 9],
    blues: [0, 3, 4, 5, 7, 10],
  },
  heroic: {
    id: 'heroic',
    label: 'Heroic',
    tooltip: 'Wide and rising. Major with a lifted fourth, the trailer sound.',
    root: 5, // F
    intervals: [0, 2, 4, 6, 7, 9, 11], // lydian
    brightness: 0.45,
    // Keeps the raised fourth, which is what makes this one sound like a trailer.
    pentatonic: [0, 2, 4, 6, 9],
    blues: [0, 2, 4, 6, 7, 9],
  },
};

export const MOOD_LIST = Object.values(MOODS);

/** Which set of notes melodies are allowed to use. */
export type PaletteId = 'full' | 'pentatonic' | 'blues';

export const PALETTES: { id: PaletteId; label: string; tooltip: string }[] = [
  { id: 'pentatonic', label: 'Five notes', tooltip: 'The five safest notes of the mood. Nothing can sound wrong, and melodies come out singable. Start here.' },
  { id: 'full', label: 'Seven notes', tooltip: 'The whole scale. More colour and more places to go, and a little easier to sound aimless.' },
  { id: 'blues', label: 'Six notes', tooltip: 'The five notes plus the one that growls. Dirtier and more vocal.' },
];

/** The semitone offsets a melody may use, given the mood and the palette. */
export function paletteOffsets(mood: Mood, palette: PaletteId): number[] {
  if (palette === 'pentatonic') return mood.pentatonic;
  if (palette === 'blues') return mood.blues;
  return mood.intervals;
}

/**
 * Turn a position in the palette into a MIDI note.
 *
 * Like degreeToMidi, any integer works: past the end of the palette it carries
 * on into the next octave, and below zero into the one beneath. That is what
 * lets a melody shape be written as "up two, down one" and simply work,
 * whether it is running on five notes or seven.
 */
export function paletteToMidi(
  mood: Mood,
  palette: PaletteId,
  position: number,
  octave: number,
): number {
  const offsets = paletteOffsets(mood, palette);
  const size = offsets.length;
  const octaveShift = Math.floor(position / size);
  const index = ((position % size) + size) % size;
  return 12 * (octave + 1 + octaveShift) + mood.root + offsets[index];
}

/**
 * Where a MIDI note sits in the palette, as a position.
 *
 * Used to start a melody shape from the chord currently sounding, so the same
 * shape follows the harmony instead of ignoring it.
 */
export function nearestPalettePosition(mood: Mood, palette: PaletteId, midi: number): number {
  const offsets = paletteOffsets(mood, palette);
  const size = offsets.length;
  const fromRoot = midi - (mood.root + 12);
  const octave = Math.floor(fromRoot / 12);
  const within = ((fromRoot % 12) + 12) % 12;
  let best = 0;
  let distance = 99;
  for (let i = 0; i < size; i++) {
    const gap = Math.abs(offsets[i] - within);
    if (gap < distance) {
      distance = gap;
      best = i;
    }
  }
  return octave * size + best;
}

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

/**
 * Snap any MIDI note to the nearest allowed note. Used by hum capture.
 *
 * On the five note palette this is what turns a rough hum into something that
 * sounds deliberate, because there is simply nowhere wrong for it to land.
 */
export function snapMidiToMood(mood: Mood, midi: number, palette: PaletteId = 'full'): number {
  const pitchClass = ((Math.round(midi) % 12) + 12) % 12;
  const allowed = paletteOffsets(mood, palette).map((i) => (mood.root + i) % 12);
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

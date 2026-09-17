/**
 * The rhythm library.
 *
 * A pattern is just a list of steps, one per sixteenth note, where 0 means
 * silence and anything above 0 is how hard the hit lands. Sixteen steps is one
 * bar, thirty two steps is two bars. Melodic tracks use these for rhythm only;
 * the actual notes come from the mood and progression.
 */

import { rngAt } from './rng';

export type TrackRole =
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

export type GenreId = 'french' | 'acid' | 'trance' | 'dnb' | 'cinematic';

export const GENRES: { id: GenreId; label: string; tooltip: string }[] = [
  { id: 'french', label: 'French House', tooltip: 'Four on the floor, filtered chords, heavy pump.' },
  { id: 'acid', label: 'Acid', tooltip: 'Squelching resonant bass lines over a stiff machine beat.' },
  { id: 'trance', label: 'Trance', tooltip: 'Rolling offbeat bass, wide pads, gated stabs.' },
  { id: 'dnb', label: 'Drum and Bass', tooltip: 'Fast chopped breaks with a slow deep sub underneath.' },
  { id: 'cinematic', label: 'Cinematic', tooltip: 'Sparse, slow, room for picture. Often no drums at all.' },
];

export interface PatternDef {
  id: string;
  label: string;
  role: TrackRole;
  genre: GenreId;
  tooltip: string;
  steps: number[];
}

const X = 1;
const m = 0.6; // medium
const g = 0.3; // ghost note

/** 16 steps, written out so the shape is readable at a glance. */
function bar(...steps: number[]): number[] {
  const out = steps.slice(0, 16);
  while (out.length < 16) out.push(0);
  return out;
}

export const PATTERNS: PatternDef[] = [
  // ---- Kick -------------------------------------------------------------
  { id: 'kick-four', label: 'Four on the floor', role: 'kick', genre: 'french', tooltip: 'A kick on every beat. The spine of house music.',
    steps: bar(X,0,0,0, X,0,0,0, X,0,0,0, X,0,0,0) },
  { id: 'kick-four-push', label: 'Four with a push', role: 'kick', genre: 'french', tooltip: 'Four on the floor plus an extra kick just before the bar ends.',
    steps: bar(X,0,0,0, X,0,0,0, X,0,0,0, X,0,0,m) },
  { id: 'kick-machine', label: 'Machine', role: 'kick', genre: 'acid', tooltip: 'Stiff and mechanical, with a stutter on the third beat.',
    steps: bar(X,0,0,0, X,0,0,m, X,0,X,0, X,0,0,0) },
  { id: 'kick-rolling', label: 'Rolling', role: 'kick', genre: 'trance', tooltip: 'Four on the floor with a soft pickup into each beat.',
    steps: bar(X,0,0,g, X,0,0,g, X,0,0,g, X,0,0,g) },
  { id: 'kick-break', label: 'Broken', role: 'kick', genre: 'dnb', tooltip: 'Two kicks, wide apart. Leaves space for the snare to hit.',
    steps: bar(X,0,0,0, 0,0,m,0, 0,0,X,0, 0,0,0,0) },
  { id: 'kick-heart', label: 'Heartbeat', role: 'kick', genre: 'cinematic', tooltip: 'Two slow thuds per bar. Tension without a dance beat.',
    steps: bar(X,0,0,0, 0,0,0,0, m,0,0,0, 0,0,0,0) },
  { id: 'kick-sparse', label: 'One hit', role: 'kick', genre: 'cinematic', tooltip: 'A single kick at the top of the bar. Maximum space.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },
  { id: 'kick-shuffle', label: 'Shuffling', role: 'kick', genre: 'french', tooltip: 'Loose and dragging rather than square. The Da Funk feel.',
    steps: bar(X,0,0,0, 0,0,m,0, X,0,0,m, 0,0,0,0) },
  { id: 'kick-electro', label: 'Electro', role: 'kick', genre: 'acid', tooltip: 'Syncopated and stiff. More robot than disco.',
    steps: bar(X,0,0,0, 0,0,X,0, 0,0,0,X, 0,0,m,0) },

  // ---- Snare / clap -----------------------------------------------------
  { id: 'snare-backbeat', label: 'Backbeat', role: 'snare', genre: 'french', tooltip: 'Claps on beats two and four. The standard.',
    steps: bar(0,0,0,0, X,0,0,0, 0,0,0,0, X,0,0,0) },
  { id: 'snare-backbeat-ghost', label: 'Backbeat with ghosts', role: 'snare', genre: 'french', tooltip: 'Two and four plus quiet taps between them.',
    steps: bar(0,0,g,0, X,0,0,g, 0,0,g,0, X,0,g,0) },
  { id: 'snare-clap-offbeat', label: 'Off clap', role: 'snare', genre: 'trance', tooltip: 'Claps land late, dragging the beat backwards.',
    steps: bar(0,0,0,0, X,0,0,0, 0,0,0,m, X,0,0,0) },
  { id: 'snare-amen', label: 'Amen break', role: 'snare', genre: 'dnb', tooltip: 'The classic chopped breakbeat snare placement.',
    steps: bar(0,0,0,0, X,0,g,0, 0,0,X,0, 0,X,0,g) },
  { id: 'snare-rim', label: 'Rim ticks', role: 'snare', genre: 'cinematic', tooltip: 'Dry ticks rather than a full snare. Sits under dialogue.',
    steps: bar(0,0,0,0, 0,0,m,0, 0,0,0,0, 0,0,m,0) },
  { id: 'snare-shuffle', label: 'Shuffling', role: 'snare', genre: 'french', tooltip: 'Backbeat with a dragging pickup, like a live drummer behind the beat.',
    steps: bar(0,0,0,g, X,0,0,0, 0,g,0,0, X,0,m,0) },
  { id: 'snare-half', label: 'Half time', role: 'snare', genre: 'dnb', tooltip: 'One clap in the middle of the bar. Makes everything feel twice as slow.',
    steps: bar(0,0,0,0, 0,0,0,0, X,0,0,0, 0,0,0,0) },
  { id: 'snare-none', label: 'Silent', role: 'snare', genre: 'cinematic', tooltip: 'No snare at all. Use density to bring hits back in.',
    steps: bar(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },

  // ---- Hats -------------------------------------------------------------
  { id: 'hats-offbeat', label: 'Offbeat', role: 'hats', genre: 'french', tooltip: 'A hat between every kick. Makes the groove swing forward.',
    steps: bar(0,0,X,0, 0,0,X,0, 0,0,X,0, 0,0,X,0) },
  { id: 'hats-sixteenth', label: 'Sixteenths', role: 'hats', genre: 'french', tooltip: 'A constant shimmer of hats. Busy and driving.',
    steps: bar(m,g,X,g, m,g,X,g, m,g,X,g, m,g,X,g) },
  { id: 'hats-eighth', label: 'Eighths', role: 'hats', genre: 'trance', tooltip: 'Steady, even hats. Simple and clean.',
    steps: bar(m,0,X,0, m,0,X,0, m,0,X,0, m,0,X,0) },
  { id: 'hats-shuffle', label: 'Shuffle', role: 'hats', genre: 'acid', tooltip: 'Uneven spacing that makes the loop feel human.',
    steps: bar(X,0,g,m, 0,g,X,0, g,m,0,g, X,0,m,g) },
  { id: 'hats-rapid', label: 'Rapid', role: 'hats', genre: 'dnb', tooltip: 'Dense and fast, with gaps that snap the rhythm around.',
    steps: bar(X,g,m,g, X,g,m,X, g,m,g,X, m,g,X,g) },
  { id: 'hats-air', label: 'Air', role: 'hats', genre: 'cinematic', tooltip: 'Two breaths per bar. Texture, not rhythm.',
    steps: bar(g,0,0,0, 0,0,0,0, m,0,0,0, 0,0,0,0) },

  // ---- Bass -------------------------------------------------------------
  { id: 'bass-offbeat', label: 'Offbeat bass', role: 'bass', genre: 'french', tooltip: 'Bass notes fall between the kicks so nothing collides.',
    steps: bar(0,0,X,0, 0,0,X,0, 0,0,X,0, 0,0,X,0) },
  { id: 'bass-driving', label: 'Driving', role: 'bass', genre: 'french', tooltip: 'Eighth notes pushing straight ahead.',
    steps: bar(X,0,m,0, X,0,m,0, X,0,m,0, X,0,m,0) },
  { id: 'bass-acid-run', label: 'Acid run', role: 'bass', genre: 'acid', tooltip: 'Sixteenth note runs with accents. Built for the squelch.',
    steps: bar(X,m,g,m, X,g,m,g, X,m,g,X, m,g,m,g) },
  { id: 'bass-rolling', label: 'Rolling', role: 'bass', genre: 'trance', tooltip: 'Offbeat sixteenths that roll under the kick.',
    steps: bar(0,0,X,m, 0,0,X,m, 0,0,X,m, 0,0,X,m) },
  { id: 'bass-sub-long', label: 'Long sub', role: 'bass', genre: 'dnb', tooltip: 'One or two very long low notes per bar.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,X,0, 0,0,0,0) },
  { id: 'bass-stab', label: 'Stabs', role: 'bass', genre: 'french', tooltip: 'Short jabs with gaps. Leaves room for the kick to land.',
    steps: bar(X,0,0,0, 0,0,X,0, 0,X,0,0, 0,0,X,0) },
  { id: 'bass-sixteenths', label: 'Sixteenths', role: 'bass', genre: 'trance', tooltip: 'Relentless and even. Pure forward motion.',
    steps: bar(X,m,m,m, X,m,m,m, X,m,m,m, X,m,m,m) },
  { id: 'bass-drone', label: 'Drone', role: 'bass', genre: 'cinematic', tooltip: 'A single held low note. Pure weight, no rhythm.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },

  // ---- Chords -----------------------------------------------------------
  { id: 'chords-stab-off', label: 'Offbeat stabs', role: 'chords', genre: 'french', tooltip: 'Short chord hits on the offbeat. The French house signature.',
    steps: bar(0,0,X,0, 0,0,X,0, 0,0,X,0, 0,0,X,0) },
  { id: 'chords-stab-syncopated', label: 'Syncopated stabs', role: 'chords', genre: 'french', tooltip: 'Stabs that land late and early, never on the beat.',
    steps: bar(0,0,X,0, 0,m,0,0, 0,0,X,0, m,0,0,X) },
  { id: 'chords-hold', label: 'Held', role: 'chords', genre: 'trance', tooltip: 'One long chord per bar that the filter can sweep across.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },
  { id: 'chords-gate', label: 'Gated', role: 'chords', genre: 'trance', tooltip: 'Chopped into even pulses. The trancegate effect.',
    steps: bar(X,0,m,0, X,0,m,0, X,0,m,0, X,0,m,0) },
  { id: 'chords-push', label: 'Push', role: 'chords', genre: 'acid', tooltip: 'Two hits that shove the bar forward, then silence.',
    steps: bar(X,0,0,m, 0,0,0,0, X,0,0,m, 0,0,0,0) },
  { id: 'chords-swell', label: 'Swell', role: 'chords', genre: 'cinematic', tooltip: 'A slow chord that arrives late in the bar.',
    steps: bar(0,0,0,0, 0,0,0,0, X,0,0,0, 0,0,0,0) },

  // ---- Lead -------------------------------------------------------------
  { id: 'lead-arp-up', label: 'Arpeggio up', role: 'lead', genre: 'french', tooltip: 'Climbs through the chord one note at a time.',
    steps: bar(X,0,m,0, X,0,m,0, X,0,m,0, X,0,m,0) },
  { id: 'lead-arp-fast', label: 'Fast arpeggio', role: 'lead', genre: 'trance', tooltip: 'Sixteenth note arpeggio. Bright and relentless.',
    steps: bar(X,m,X,m, X,m,X,m, X,m,X,m, X,m,X,m) },
  { id: 'lead-hook', label: 'Hook', role: 'lead', genre: 'french', tooltip: 'A short repeating phrase with gaps around it.',
    steps: bar(X,0,0,m, 0,X,0,0, m,0,X,0, 0,0,m,0) },
  { id: 'lead-scream', label: 'Scream', role: 'lead', genre: 'acid', tooltip: 'Long sustained notes built for the Tear voice to howl on.',
    steps: bar(X,0,0,0, 0,0,0,0, X,0,0,0, 0,0,0,0) },
  { id: 'lead-riff', label: 'Riff', role: 'lead', genre: 'french', tooltip: 'A rolling eighth note figure with a gap to breathe. Built for a hook.',
    steps: bar(X,0,m,0, X,0,m,0, X,0,m,0, 0,0,0,0) },
  { id: 'lead-stabs', label: 'Stabs', role: 'lead', genre: 'acid', tooltip: 'Hard jabs on and off the beat. Very Robot Rock.',
    steps: bar(X,0,0,X, 0,0,X,0, X,0,0,X, 0,X,0,0) },
  { id: 'lead-sparse', label: 'Sparse', role: 'lead', genre: 'cinematic', tooltip: 'One line every two bars. Melody as punctuation.',
    steps: bar(0,0,0,0, X,0,0,0, 0,0,0,0, 0,0,0,0) },

  // ---- Pad --------------------------------------------------------------
  { id: 'pad-whole', label: 'Whole bar', role: 'pad', genre: 'french', tooltip: 'One pad note held for the entire bar.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },
  { id: 'pad-half', label: 'Half bar', role: 'pad', genre: 'trance', tooltip: 'Retriggers halfway through so the pad breathes twice a bar.',
    steps: bar(X,0,0,0, 0,0,0,0, m,0,0,0, 0,0,0,0) },
  { id: 'pad-drift', label: 'Drift', role: 'pad', genre: 'cinematic', tooltip: 'Enters late and hangs over the bar line.',
    steps: bar(0,0,0,0, 0,0,X,0, 0,0,0,0, 0,0,0,0) },

  // ---- Vocal ------------------------------------------------------------
  { id: 'vocal-phrase', label: 'One phrase', role: 'vocal', genre: 'french', tooltip: 'The whole typed phrase once per bar.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },
  { id: 'vocal-call', label: 'Call and answer', role: 'vocal', genre: 'french', tooltip: 'Phrase at the top, echo in the second half.',
    steps: bar(X,0,0,0, 0,0,0,0, m,0,0,0, 0,0,0,0) },
  { id: 'vocal-chop', label: 'Chopped', role: 'vocal', genre: 'dnb', tooltip: 'Cut into stuttering fragments across the bar.',
    steps: bar(X,0,m,0, 0,m,0,X, 0,0,m,0, X,0,0,m) },

  // ---- Sample chop ------------------------------------------------------
  { id: 'chop-even', label: 'Even slices', role: 'chop', genre: 'french', tooltip: 'Plays the loaded clip in order, one slice per eighth note.',
    steps: bar(X,0,m,0, X,0,m,0, X,0,m,0, X,0,m,0) },
  { id: 'chop-stutter', label: 'Stutter', role: 'chop', genre: 'dnb', tooltip: 'Repeats the same slice rapidly, then jumps.',
    steps: bar(X,X,X,0, m,0,X,X, 0,X,0,m, X,X,0,0) },
  { id: 'chop-scatter', label: 'Scatter', role: 'chop', genre: 'dnb', tooltip: 'Slices in an unpredictable order across the bar.',
    steps: bar(X,0,0,m, 0,X,0,0, m,0,0,X, 0,0,m,0) },
  { id: 'chop-sparse', label: 'Sparse', role: 'chop', genre: 'cinematic', tooltip: 'One slice per bar, usually reversed.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },

  // ---- FX ---------------------------------------------------------------
  { id: 'fx-riser', label: 'Riser', role: 'fx', genre: 'french', tooltip: 'A sweep that builds to the top of the next bar.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },
  { id: 'fx-impact', label: 'Impact', role: 'fx', genre: 'cinematic', tooltip: 'A single hit on the downbeat. Use for cuts in picture.',
    steps: bar(X,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },
  { id: 'fx-noise-sweep', label: 'Noise sweep', role: 'fx', genre: 'trance', tooltip: 'White noise washing in and out twice a bar.',
    steps: bar(X,0,0,0, 0,0,0,0, X,0,0,0, 0,0,0,0) },
  { id: 'fx-none', label: 'Silent', role: 'fx', genre: 'cinematic', tooltip: 'No effects hits.',
    steps: bar(0,0,0,0, 0,0,0,0, 0,0,0,0, 0,0,0,0) },
];

export const PATTERN_BY_ID = new Map(PATTERNS.map((p) => [p.id, p]));

export function patternsForRole(role: TrackRole): PatternDef[] {
  return PATTERNS.filter((p) => p.role === role);
}

export function getPattern(id: string, role: TrackRole): PatternDef {
  return PATTERN_BY_ID.get(id) ?? patternsForRole(role)[0] ?? PATTERNS[0];
}

/**
 * Where extra hits are allowed to appear when you turn Density up, in the order
 * they get added. Front of the list is added first, so a small nudge lands on
 * musically safe positions and only an extreme setting fills every gap.
 */
const DENSITY_CANDIDATES: Record<TrackRole, number[]> = {
  kick: [8, 4, 12, 14, 2, 6, 10, 15, 1, 3, 5, 7, 9, 11, 13],
  snare: [12, 4, 14, 6, 10, 2, 8, 15, 7, 11, 3, 1, 5, 9, 13],
  hats: [2, 6, 10, 14, 0, 4, 8, 12, 1, 3, 5, 7, 9, 11, 13, 15],
  bass: [2, 6, 10, 14, 0, 4, 8, 12, 3, 7, 11, 15, 1, 5, 9, 13],
  chords: [2, 10, 6, 14, 0, 8, 4, 12, 3, 7, 11, 15],
  lead: [4, 12, 2, 6, 10, 14, 0, 8, 1, 5, 9, 13],
  pad: [8, 4, 12, 0],
  vocal: [8, 4, 12, 2, 10],
  chop: [2, 6, 10, 14, 4, 12, 0, 8, 1, 5, 9, 13, 3, 7, 11, 15],
  fx: [8, 12, 4, 0],
};

/**
 * Apply the Density knob.
 *
 * Below the halfway point hits are removed quietest first, so the groove thins
 * out rather than losing its backbone. Above halfway, new hits are added in the
 * order listed above. At exactly 0.5 the pattern is untouched.
 */
export function applyDensity(steps: number[], density: number, role: TrackRole): number[] {
  const out = steps.slice();
  if (Math.abs(density - 0.5) < 0.02) return out;

  if (density < 0.5) {
    const keepRatio = density / 0.5; // 0 = silence, 1 = untouched
    const active = out
      .map((velocity, index) => ({ velocity, index }))
      .filter((s) => s.velocity > 0)
      .sort((a, b) => a.velocity - b.velocity || b.index - a.index);
    const removeCount = Math.round(active.length * (1 - keepRatio));
    for (let i = 0; i < removeCount; i++) out[active[i].index] = 0;
    return out;
  }

  const addRatio = (density - 0.5) / 0.5;
  const candidates = DENSITY_CANDIDATES[role].filter((index) => out[index] === 0);
  const addCount = Math.round(candidates.length * addRatio);
  for (let i = 0; i < addCount; i++) {
    // Added hits come in quieter than the written ones so the original
    // pattern still reads as the main shape.
    out[candidates[i]] = i < addCount / 2 ? 0.55 : 0.35;
  }
  return out;
}

/**
 * Apply the Chaos knob for one specific bar.
 *
 * Chaos never invents hits on the strong beats and never deletes the downbeat,
 * so the loop stays recognisable however far you push it. It nudges hits to
 * neighbouring steps, drops the odd one, and varies how hard things land.
 */
export function applyChaos(
  steps: number[],
  chaos: number,
  seed: string,
  bar: number,
): number[] {
  if (chaos <= 0.01) return steps;
  const out = steps.slice();

  for (let step = 0; step < out.length; step++) {
    const roll = rngAt(seed, bar, step, 'chaos');
    const isStrongBeat = step % 4 === 0;

    if (out[step] > 0) {
      if (!isStrongBeat && roll < chaos * 0.25) {
        // Shift the hit one step sideways.
        const target = roll < chaos * 0.125 ? step - 1 : step + 1;
        if (target >= 0 && target < out.length && out[target] === 0) {
          out[target] = out[step];
          out[step] = 0;
        }
      } else if (!isStrongBeat && roll > 1 - chaos * 0.2) {
        out[step] = 0; // drop it
      } else {
        // Velocity wobble, always audible but never silent.
        const wobble = (rngAt(seed, bar, step, 'vel') - 0.5) * chaos * 0.5;
        out[step] = Math.max(0.15, Math.min(1, out[step] + wobble));
      }
    } else if (!isStrongBeat && roll > 1 - chaos * 0.12) {
      out[step] = 0.3; // a ghost note appears
    }
  }
  return out;
}

/** The full pipeline from stored pattern to the steps the engine plays. */
export function resolveSteps(
  baseSteps: number[],
  density: number,
  chaos: number,
  role: TrackRole,
  seed: string,
  bar: number,
): number[] {
  return applyChaos(applyDensity(baseSteps, density, role), chaos, seed, bar);
}

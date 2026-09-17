/**
 * Replaying a performance.
 *
 * While you are recording, every knob move and every Shift press is written
 * down as an event timed in sixteenth notes. This turns that list back into
 * "what did the song look like at step N", which is exactly the question the
 * offline render asks on every step.
 *
 * Because the engine reads the whole song on every step and holds no state of
 * its own, replaying a performance needs nothing more than answering that
 * question correctly.
 */

import type { Song, ShiftModeId } from '../state/song';
import { cloneSong } from '../state/song';
import type { PerformanceEvent, ShiftRamp } from '../state/store';
import { currentShiftBlend } from '../state/store';
import { applyShift, blendSongs } from '../shift/modes';

function setPath(target: Song, path: string, value: unknown): void {
  const keys = path.split('.');
  let cursor = target as unknown as Record<string, unknown>;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cursor[keys[i]];
    if (next == null || typeof next !== 'object') return;
    cursor = next as Record<string, unknown>;
  }
  cursor[keys[keys.length - 1]] = value;
}

/**
 * Build the function the engine will call during an offline render.
 *
 * Events are replayed from the beginning for each step rather than being
 * stepped through, so the answer does not depend on being asked in order.
 * Renders are short and the event list is small, so the cost is irrelevant and
 * the correctness is worth having.
 */
export function makePerformancePlayer(
  base: Song,
  events: PerformanceEvent[],
): (step: number) => Song {
  const ordered = [...events].sort((a, b) => a.step - b.step);

  return (step: number) => {
    const song = cloneSong(base);
    let ramp: ShiftRamp | null = null;

    for (const event of ordered) {
      if (event.step > step) break;
      if (event.kind === 'param' && event.path !== undefined) {
        setPath(song, event.path, event.value);
      } else if (event.kind === 'shift') {
        ramp = {
          mode: (event.mode ?? song.shift.selectedMode) as ShiftModeId,
          from: currentShiftBlend(ramp, event.step),
          to: 1,
          startStep: event.step,
          steps: Math.max(1, song.shift.transitionBars * 16),
        };
      } else if (event.kind === 'return' && ramp) {
        ramp = {
          mode: ramp.mode,
          from: currentShiftBlend(ramp, event.step),
          to: 0,
          startStep: event.step,
          steps: Math.max(1, song.shift.transitionBars * 16),
        };
      }
    }

    const blend = currentShiftBlend(ramp, step);
    if (!ramp || blend <= 0) return song;
    const shifted = applyShift(song, ramp.mode);
    return blend >= 1 ? shifted : blendSongs(song, shifted, blend);
  };
}

/** How many bars a recorded performance covers. */
export function performanceBars(events: PerformanceEvent[]): number {
  if (!events.length) return 0;
  const last = Math.max(...events.map((event) => event.step));
  return Math.ceil((last + 16) / 16);
}

/**
 * Deterministic randomness.
 *
 * Every "random" musical decision in this app (the Chaos knob, Random Song,
 * humanised velocities) runs through here. That matters for one specific
 * reason: the offline WAV export re-runs the whole sequencer from bar zero.
 * If chaos used Math.random the exported file would not match what you just
 * heard through the speakers. Seeded by bar and step, it matches exactly.
 */

/** Turn any string into a 32-bit seed. */
export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32: small, fast, good enough spread for musical choices. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The workhorse: a stable 0..1 value for one exact musical moment.
 * Same song seed, same bar, same step, same track always gives the same number.
 */
export function rngAt(...parts: (string | number)[]): number {
  return makeRng(hashString(parts.join(':')))();
}

export function pick<T>(items: readonly T[], random: number): T {
  return items[Math.min(items.length - 1, Math.floor(random * items.length))];
}

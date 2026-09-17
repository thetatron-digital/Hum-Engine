/**
 * Small pure DSP helpers.
 *
 * Everything here works on plain Float32Arrays rather than Web Audio nodes, so
 * it can be run and checked outside a browser. The vocoder and the speech
 * synthesiser are both built from these.
 */

export interface Biquad {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
  x1: number; x2: number; y1: number; y2: number;
}

function normalise(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): Biquad {
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0, x1: 0, x2: 0, y1: 0, y2: 0 };
}

export function bandpass(frequency: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  return normalise(alpha, 0, -alpha, 1 + alpha, -2 * cosw0, 1 - alpha);
}

export function lowpass(frequency: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  return normalise((1 - cosw0) / 2, 1 - cosw0, (1 - cosw0) / 2, 1 + alpha, -2 * cosw0, 1 - alpha);
}

export function highpass(frequency: number, q: number, sampleRate: number): Biquad {
  const w0 = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  return normalise((1 + cosw0) / 2, -(1 + cosw0), (1 + cosw0) / 2, 1 + alpha, -2 * cosw0, 1 - alpha);
}

export function step(filter: Biquad, x: number): number {
  const y =
    filter.b0 * x + filter.b1 * filter.x1 + filter.b2 * filter.x2
    - filter.a1 * filter.y1 - filter.a2 * filter.y2;
  filter.x2 = filter.x1;
  filter.x1 = x;
  filter.y2 = filter.y1;
  filter.y1 = y;
  return y;
}

export function reset(filter: Biquad): void {
  filter.x1 = 0;
  filter.x2 = 0;
  filter.y1 = 0;
  filter.y2 = 0;
}

/** Scale a signal so its loudest point sits at `target`. */
export function normalisePeak(samples: Float32Array, target = 0.9): void {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  if (peak < 1e-6) return;
  const scale = target / peak;
  for (let i = 0; i < samples.length; i++) samples[i] *= scale;
}

/** Fade the very start and end so a rendered clip cannot click. */
export function fadeEdges(samples: Float32Array, fadeSamples: number): void {
  const fade = Math.min(fadeSamples, samples.length >> 1);
  for (let i = 0; i < fade; i++) {
    const gain = i / fade;
    samples[i] *= gain;
    samples[samples.length - 1 - i] *= gain;
  }
}

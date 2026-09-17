/**
 * Writing WAV files.
 *
 * 48 kHz, 16 bit, stereo, which is what a video editor expects. If the
 * browser's audio is running at a different rate the audio is resampled on the
 * way out rather than being written at the wrong speed.
 */

export const TARGET_SAMPLE_RATE = 48000;

/** Catmull-Rom resampling. Cheap, and clean enough for 44.1 to 48. */
function resample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i++) {
    const position = i * ratio;
    const index = Math.floor(position);
    const t = position - index;
    const p0 = input[Math.max(0, index - 1)];
    const p1 = input[index] ?? 0;
    const p2 = input[Math.min(input.length - 1, index + 1)];
    const p3 = input[Math.min(input.length - 1, index + 2)];
    out[i] =
      0.5 *
      (2 * p1 +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  }
  return out;
}

/**
 * Encode two channels of audio as a WAV file.
 *
 * Samples above full scale are clipped rather than wrapped, because wrapping
 * turns a moment of loudness into a burst of noise.
 */
export function encodeWav(
  left: Float32Array,
  right: Float32Array,
  sourceRate: number,
  targetRate = TARGET_SAMPLE_RATE,
): Blob {
  const l = resample(left, sourceRate, targetRate);
  const r = resample(right, sourceRate, targetRate);
  const frames = Math.min(l.length, r.length);

  const dataBytes = frames * 2 * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 2, true);            // stereo
  view.setUint32(24, targetRate, true);
  view.setUint32(28, targetRate * 4, true); // bytes per second
  view.setUint16(32, 4, true);            // bytes per frame
  view.setUint16(34, 16, true);           // bits per sample
  writeText(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (const channel of [l, r]) {
      const clipped = Math.max(-1, Math.min(1, channel[i]));
      view.setInt16(offset, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([buffer], { type: 'audio/wav' });
}

/** Loudest point in a pair of channels. Used to catch a silent render. */
export function peakOf(left: Float32Array, right: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const value = Math.max(Math.abs(left[i]), Math.abs(right[i]));
    if (value > peak) peak = value;
  }
  return peak;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // Give the browser a moment to start the download before dropping the data.
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'song';
}

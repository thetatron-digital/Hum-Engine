/**
 * Pitch detection from the microphone, using YIN.
 *
 * Why YIN and not an FFT: an FFT tells you which frequencies are present, but
 * a hummed note is a fundamental plus a stack of harmonics, and the loudest
 * bin is very often a harmonic rather than the note you sang. That produces
 * the classic octave error. YIN instead looks for the period at which the
 * waveform best repeats itself, which is what the ear does, and it is far more
 * reliable on a voice.
 *
 * Why not a CREPE-style neural model: it is more accurate on hard material,
 * but it is a multi-megabyte download and too slow to run per frame on a
 * phone. Accuracy is also not the limiting factor here, because every detected
 * note is snapped to the chosen scale afterwards.
 *
 * The signal is filtered and decimated to a quarter of the sample rate before
 * analysis. Humming lives below about 1 kHz, so nothing useful is lost, and it
 * cuts the work by a factor of sixteen, which is what makes this affordable
 * inside an audio callback.
 */

const DECIMATE = 4;
/** Analysis window in decimated samples. About 42 ms at 48 kHz input. */
const WINDOW = 512;
/** How often to analyse, in decimated samples. About 11 ms. */
const HOP = 128;
/** Below this the waveform does not repeat cleanly enough to trust. */
const CONFIDENCE_FLOOR = 0.55;
/** Quieter than this and it is room noise, not singing. */
const SILENCE_RMS = 0.006;

const MIN_HZ = 60;
const MAX_HZ = 1100;

function makeLowpass(cutoffRatio, q) {
  const w0 = 2 * Math.PI * cutoffRatio;
  const alpha = Math.sin(w0) / (2 * q);
  const cosw0 = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: ((1 - cosw0) / 2) / a0,
    b1: (1 - cosw0) / a0,
    b2: ((1 - cosw0) / 2) / a0,
    a1: (-2 * cosw0) / a0,
    a2: (1 - alpha) / a0,
    x1: 0, x2: 0, y1: 0, y2: 0,
  };
}

function runLowpass(f, x) {
  const y = f.b0 * x + f.b1 * f.x1 + f.b2 * f.x2 - f.a1 * f.y1 - f.a2 * f.y2;
  f.x2 = f.x1;
  f.x1 = x;
  f.y2 = f.y1;
  f.y1 = y;
  return y;
}

class PitchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rate = sampleRate / DECIMATE;
    this.minTau = Math.max(2, Math.floor(this.rate / MAX_HZ));
    this.maxTau = Math.min(WINDOW - 1, Math.ceil(this.rate / MIN_HZ));
    // A ring buffer, so appending a sample is one write rather than shifting
    // the whole window along. It is unwrapped into `window` only when an
    // analysis actually runs.
    this.ring = new Float32Array(WINDOW);
    this.writeIndex = 0;
    this.window = new Float32Array(WINDOW);
    this.filled = 0;
    this.sinceLast = 0;
    this.phase = 0;
    // Anti-aliasing before decimation, at three quarters of the new Nyquist.
    this.stageA = makeLowpass(0.75 / (2 * DECIMATE), 0.7071);
    this.stageB = makeLowpass(0.75 / (2 * DECIMATE), 0.7071);
    this.difference = new Float32Array(this.maxTau + 1);
    this.normalised = new Float32Array(this.maxTau + 1);
    this.running = true;
    this.port.onmessage = (event) => {
      if (event.data === 'stop') this.running = false;
    };
  }

  /**
   * YIN proper.
   *
   * Step one builds the squared difference between the window and itself
   * shifted by tau. Step two divides each value by the running average of all
   * shorter shifts, which is the trick that stops the algorithm from
   * preferring very short periods. Step three takes the first shift that dips
   * below the threshold rather than the global best, which is what avoids
   * reporting an octave too high.
   */
  detect(window) {
    const { difference, normalised, minTau, maxTau } = this;

    for (let tau = 0; tau <= maxTau; tau++) {
      let sum = 0;
      const limit = WINDOW - maxTau;
      for (let i = 0; i < limit; i++) {
        const delta = window[i] - window[i + tau];
        sum += delta * delta;
      }
      difference[tau] = sum;
    }

    normalised[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= maxTau; tau++) {
      running += difference[tau];
      normalised[tau] = running === 0 ? 1 : (difference[tau] * tau) / running;
    }

    let best = -1;
    for (let tau = minTau; tau <= maxTau; tau++) {
      if (normalised[tau] < 1 - CONFIDENCE_FLOOR) {
        // Walk to the bottom of this dip rather than stopping at its edge.
        while (tau + 1 <= maxTau && normalised[tau + 1] < normalised[tau]) tau++;
        best = tau;
        break;
      }
    }
    if (best < 0) return null;

    // Fit a parabola through the dip to land between samples, which is worth
    // several cents of accuracy at higher pitches.
    let period = best;
    if (best > 0 && best < maxTau) {
      const before = normalised[best - 1];
      const at = normalised[best];
      const after = normalised[best + 1];
      const divisor = 2 * (2 * at - before - after);
      if (divisor !== 0) period = best + (after - before) / divisor;
    }

    return { frequency: this.rate / period, confidence: 1 - normalised[best] };
  }

  process(inputs) {
    if (!this.running) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    let loudest = 0;
    let energy = 0;

    for (let i = 0; i < channel.length; i++) {
      const sample = channel[i];
      energy += sample * sample;
      if (Math.abs(sample) > loudest) loudest = Math.abs(sample);

      const filtered = runLowpass(this.stageB, runLowpass(this.stageA, sample));
      if (this.phase === 0) {
        this.ring[this.writeIndex] = filtered;
        this.writeIndex = (this.writeIndex + 1) % WINDOW;
        if (this.filled < WINDOW) this.filled++;
        this.sinceLast++;
      }
      this.phase = (this.phase + 1) % DECIMATE;
    }

    const rms = Math.sqrt(energy / channel.length);

    if (this.filled >= WINDOW && this.sinceLast >= HOP) {
      this.sinceLast = 0;
      let result = null;
      if (rms >= SILENCE_RMS) {
        // Unwrap the ring so the oldest sample sits at index zero.
        const split = WINDOW - this.writeIndex;
        this.window.set(this.ring.subarray(this.writeIndex), 0);
        this.window.set(this.ring.subarray(0, this.writeIndex), split);
        result = this.detect(this.window);
      }
      this.port.postMessage({
        at: currentTime,
        rms,
        peak: loudest,
        frequency: result ? result.frequency : 0,
        confidence: result ? result.confidence : 0,
      });
    }
    return true;
  }
}

registerProcessor('pitch-detect', PitchProcessor);

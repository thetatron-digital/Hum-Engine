/**
 * Hard sync oscillator, the engine behind the "Tear" lead voice.
 *
 * Two oscillators run at once. The master runs at the note you played. The
 * slave runs faster, and every single time the master finishes a cycle it
 * yanks the slave's waveform back to the start mid-flight. That forced restart
 * is a hard edge in the signal, and hard edges are what the ear hears as
 * screaming and tearing. Turning Sync Amount up runs the slave further ahead
 * of the master, so the cut happens at a more violent point in its cycle.
 *
 * Web Audio has no native way to do this, because you cannot reset an
 * OscillatorNode's phase. So the waveform is generated sample by sample here.
 *
 * Those hard edges also produce a lot of frequency content above what the
 * sample rate can represent, which would fold back down as a metallic
 * whistle that tracks the wrong pitch. Rather than the usual band-limiting
 * maths, this runs the oscillator eight times faster than the output and
 * filters before throwing away the extra samples. It costs a little more CPU
 * and is far easier to verify by ear.
 */

const OVERSAMPLE = 8;

/** A plain biquad low pass, used to clean up before downsampling. */
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

class HardSyncProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'frequency', defaultValue: 220, minValue: 8, maxValue: 8000, automationRate: 'a-rate' },
      // How much faster the slave runs than the master. 1 means no tearing at
      // all, which is just a plain sawtooth.
      { name: 'sync', defaultValue: 1.5, minValue: 1, maxValue: 8, automationRate: 'k-rate' },
      // Morphs the slave between a sawtooth and a square, which changes the
      // character of the tearing from bright and thin to hollow and wide.
      { name: 'shape', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();
    this.masterPhase = 0;
    this.slavePhase = 0;
    // Two stages so the filtering is steep enough to matter at eight times over.
    this.stageA = makeLowpass(0.42 / OVERSAMPLE, 0.5412);
    this.stageB = makeLowpass(0.42 / OVERSAMPLE, 1.3066);
    this.dead = false;
  }

  process(_inputs, outputs, parameters) {
    if (this.dead) return false;
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const channel = output[0];
    const frequency = parameters.frequency;
    const sync = parameters.sync[0];
    const shape = parameters.shape[0];
    const stepScale = 1 / (sampleRate * OVERSAMPLE);

    for (let i = 0; i < channel.length; i++) {
      const f = frequency.length > 1 ? frequency[i] : frequency[0];
      const masterStep = f * stepScale;
      const slaveStep = f * sync * stepScale;
      let sample = 0;

      for (let n = 0; n < OVERSAMPLE; n++) {
        this.masterPhase += masterStep;
        this.slavePhase += slaveStep;

        if (this.masterPhase >= 1) {
          this.masterPhase -= 1;
          // The moment that makes the sound: the slave is cut off wherever it
          // happens to be and restarted from the top.
          this.slavePhase = this.masterPhase * sync;
        }
        if (this.slavePhase >= 1) this.slavePhase -= 1;

        const saw = 2 * this.slavePhase - 1;
        const square = this.slavePhase < 0.5 ? 1 : -1;
        const raw = saw * (1 - shape) + square * shape;
        sample = runLowpass(this.stageB, runLowpass(this.stageA, raw));
      }

      channel[i] = sample;
    }

    // Mirror to the right channel if the graph asked for stereo.
    for (let c = 1; c < output.length; c++) output[c].set(channel);
    return true;
  }
}

registerProcessor('hard-sync', HardSyncProcessor);

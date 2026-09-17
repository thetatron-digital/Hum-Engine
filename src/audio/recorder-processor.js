/**
 * Captures raw audio from the microphone and hands it to the main thread.
 *
 * Deliberately not MediaRecorder. That would give back a compressed file in
 * whatever format the browser felt like, which then has to be decoded again,
 * and iOS Safari picks a different container from everything else. What the
 * vocoder needs is plain samples, so this simply forwards them.
 *
 * Only the first channel is kept. A vocoder cares about the shape of the
 * sound, not where it sits in the stereo field.
 */

class RecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.recording = false;
    this.port.onmessage = (event) => {
      if (event.data === 'start') this.recording = true;
      else if (event.data === 'stop') this.recording = false;
      else if (event.data === 'close') this.closed = true;
    };
  }

  process(inputs) {
    if (this.closed) return false;
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    // The level is always reported, so the meter works before recording
    // starts and you can see whether the microphone is hearing you at all.
    let peak = 0;
    for (let i = 0; i < channel.length; i++) {
      const value = Math.abs(channel[i]);
      if (value > peak) peak = value;
    }

    if (this.recording) {
      // A copy, because the buffer handed in is reused on the next call.
      this.port.postMessage({ peak, samples: new Float32Array(channel) });
    } else {
      this.port.postMessage({ peak });
    }
    return true;
  }
}

registerProcessor('voice-record', RecorderProcessor);

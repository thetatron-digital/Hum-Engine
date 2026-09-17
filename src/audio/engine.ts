/**
 * The audio engine.
 *
 * It does one thing on a loop: every sixteenth note it reads the song, works
 * out what should happen at that instant, and tells the voices to play. It
 * never stores musical state of its own, which is why turning a knob takes
 * effect on the very next step with no rebuilding and no clicks.
 *
 * Signal path for one track:
 *   voice -> filter -> pump -> pan -> level -> master, plus reverb and delay sends
 *
 * The level node is also the tap point for exporting that track on its own.
 */

import * as Tone from 'tone';
import type { Song, TrackId, Track } from '../state/song';
import { TRACK_ORDER, TRACK_ROLE, isMelodic } from '../state/song';
import { MOODS, degreeToMidi, paletteToMidi, nearestPalettePosition } from '../music/moods';
import { getRiff } from '../music/riffs';
import { getProgression, chordAtBar, chordIndexAtBar, voiceChordWide } from '../music/progressions';
import { vocalKey } from '../vocal/render';
import { getPattern, resolveSteps } from '../music/patterns';
import { rngAt } from '../music/rng';
import { getVoice } from './voiceCatalog';
import { createVoice, registerWorklets, type Voice, type TriggerOptions } from './voices';
import { loadDirtIndex, warmOrchestralSamples } from './samples';

/** Filter cutoff knob to hertz, on a curve that feels even to the hand. */
export function cutoffToHz(value: number): number {
  return 60 * Math.pow(300, Math.max(0, Math.min(1, value)));
}

/** Resonance knob to filter Q. Past about 0.8 it starts to whistle. */
export function resonanceToQ(value: number): number {
  return 0.4 + value * value * 22;
}

/** Tracks that carry notes, and therefore get a phaser. */
const PHASED_TRACKS: TrackId[] = ['bass', 'chords', 'lead', 'pad', 'vocal'];

interface TrackChain {
  voice: Voice;
  voiceId: string;
  filter: Tone.Filter;
  /** Only present on the tracks listed above, to save the work elsewhere. */
  phaser: Tone.Phaser | null;
  pump: Tone.Gain;
  panner: Tone.Panner;
  level: Tone.Gain;
  reverbSend: Tone.Gain;
  delaySend: Tone.Gain;
}

export interface EngineHooks {
  onStep?: (step: number) => void;
}

export class Engine {
  private context: Tone.BaseContext;
  private transport: ReturnType<typeof Tone.getTransport>;
  private chains = new Map<TrackId, TrackChain>();
  private repeatId: number | null = null;
  private started = false;

  private bus!: Tone.Gain;
  private fxReturn!: Tone.Gain;
  private crush!: Tone.WaveShaper;
  private drive!: Tone.Distortion;
  private highpass!: Tone.Filter;
  private lowpass!: Tone.Filter;
  private compressor!: Tone.Compressor;
  private limiter!: Tone.Limiter;
  private masterGain!: Tone.Gain;
  private reverb!: Tone.Reverb;
  private delay!: Tone.FeedbackDelay;

  /** Recomputed patterns are cached per bar so chaos is not re-rolled 16 times. */
  private stepCache = new Map<string, number[]>();

  /**
   * How many notes a track has already played, per position.
   *
   * Melody shapes advance one step per note played, not per sixteenth. That is
   * what lets any shape sit on any rhythm: the same six note figure reads as a
   * stabbing hook over offbeats and as a rolling line over sixteenths. Working
   * that out means counting the hits before each position, so the answers are
   * cached four bars at a time.
   */
  private ordinalCache = new Map<string, number[]>();

  /**
   * The last value written to each parameter.
   *
   * The loop runs sixteen times a bar and almost nothing changes between one
   * step and the next, so writing every parameter every step is wasted work.
   * For some of them it is worse than wasted: setting the reverb size rebuilds
   * its impulse response, and setting the drive rebuilds its curve. Worst of
   * all, during an offline render the clock does not advance between steps, so
   * repeatedly writing the same automation point throws.
   */
  private lastWritten = new Map<string, number>();

  /** Write a parameter only when the value has actually moved. */
  private rampIfChanged(
    param: { rampTo: (value: number, time: number, startTime?: number) => void },
    key: string,
    value: number,
    time: number,
    over = 0.04,
  ): void {
    if (this.lastWritten.get(key) === value) return;
    this.lastWritten.set(key, value);
    param.rampTo(value, over, time);
  }

  private setIfChanged(key: string, value: number, apply: (value: number) => void): void {
    if (this.lastWritten.get(key) === value) return;
    this.lastWritten.set(key, value);
    apply(value);
  }

  /** Supplies the song to play. Swapped out by the offline export. */
  songAt: (step: number) => Song;
  hooks: EngineHooks = {};

  /** Where the clip you loaded lives in the buffer cache, if you loaded one. */
  clipKey: string | null = null;

  constructor(
    songAt: (step: number) => Song,
    destination: Tone.ToneAudioNode,
    context: Tone.BaseContext,
    transport: ReturnType<typeof Tone.getTransport>,
  ) {
    this.songAt = songAt;
    this.context = context;
    this.transport = transport;
    this.buildMaster(destination);
  }

  private buildMaster(destination: Tone.ToneAudioNode): void {
    this.bus = new Tone.Gain(1);
    this.fxReturn = new Tone.Gain(1);
    // Bit crush, done as a shaping curve rather than a worklet so it is
    // deterministic and renders offline without any extra setup. At zero the
    // curve is a straight line, which is a true bypass.
    this.crush = new Tone.WaveShaper((x: number) => x, 2048);
    this.drive = new Tone.Distortion({ distortion: 0.2, oversample: '2x', wet: 1 });
    this.highpass = new Tone.Filter({ type: 'highpass', frequency: 20, rolloff: -24 });
    this.lowpass = new Tone.Filter({ type: 'lowpass', frequency: 18000, rolloff: -24 });
    // Heavy bus compression is part of the sound, not a safety net.
    this.compressor = new Tone.Compressor({ threshold: -16, ratio: 4, attack: 0.006, release: 0.16 });
    this.limiter = new Tone.Limiter(-1);
    this.masterGain = new Tone.Gain(0.85);

    this.reverb = new Tone.Reverb({ decay: 2.4, preDelay: 0.02, wet: 1 });
    this.delay = new Tone.FeedbackDelay({ delayTime: 0.25, feedback: 0.3, wet: 1 });

    this.bus.chain(this.crush, this.drive, this.highpass, this.lowpass, this.compressor, this.limiter, this.masterGain);
    this.masterGain.connect(destination);
    this.reverb.connect(this.fxReturn);
    this.delay.connect(this.fxReturn);
    this.fxReturn.connect(this.drive);
  }

  /** Build or rebuild one track's chain. Called lazily and on voice change. */
  private chainFor(id: TrackId, track: Track): TrackChain {
    const existing = this.chains.get(id);
    if (existing && existing.voiceId === track.voice) return existing;

    if (existing) {
      existing.voice.dispose();
      const voiceDef = getVoice(track.voice, TRACK_ROLE[id]);
      const voice = createVoice(voiceDef, this.context);
      voice.output.connect(existing.filter);
      existing.voice = voice;
      existing.voiceId = track.voice;
      return existing;
    }

    const filter = new Tone.Filter({ type: 'lowpass', frequency: 18000, rolloff: -24 });
    const phaser = PHASED_TRACKS.includes(id)
      ? new Tone.Phaser({ frequency: 0.42, octaves: 3, baseFrequency: 420, wet: 0 })
      : null;
    const pump = new Tone.Gain(1);
    const panner = new Tone.Panner(0);
    const level = new Tone.Gain(0.8);
    const reverbSend = new Tone.Gain(0);
    const delaySend = new Tone.Gain(0);

    const voiceDef = getVoice(track.voice, TRACK_ROLE[id]);
    const voice = createVoice(voiceDef, this.context);
    voice.output.connect(filter);
    if (phaser) filter.chain(phaser, pump, panner, level);
    else filter.chain(pump, panner, level);
    level.connect(this.bus);
    level.connect(reverbSend);
    level.connect(delaySend);
    reverbSend.connect(this.reverb);
    delaySend.connect(this.delay);

    const chain: TrackChain = { voice, voiceId: track.voice, filter, phaser, pump, panner, level, reverbSend, delaySend };
    this.chains.set(id, chain);
    return chain;
  }

  /** The node to record when exporting this track on its own. */
  stemTap(id: TrackId): Tone.Gain | null {
    return this.chains.get(id)?.level ?? null;
  }

  masterTap(): Tone.Gain {
    return this.masterGain;
  }

  /** The shared reverb and delay returns, exported as their own stem. */
  fxTap(): Tone.Gain {
    return this.fxReturn;
  }

  ensureAllChains(song: Song): void {
    for (const id of TRACK_ORDER) this.chainFor(id, song.tracks[id]);
    // Set the starting tempo here rather than on the first step. The
    // transport's tempo keeps a timeline that insists every entry is later
    // than the last, and it already holds an entry at time zero, so writing
    // another one at time zero from inside the first step throws. Setting it
    // before the transport runs replaces that entry cleanly instead.
    this.transport.bpm.value = song.tempo;
    this.lastWritten.set('tempo', song.tempo);
  }

  /**
   * Wait for anything that has to be built before the first sound.
   *
   * The reverb builds its impulse response asynchronously. Live that is
   * invisible, because the first bar arrives well after it finishes. An
   * offline render is faster than real time and would start without it, so the
   * exported file would have no reverb on it at all.
   */
  async ready(): Promise<void> {
    await this.reverb.ready;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.repeatId = this.transport.scheduleRepeat((time) => this.tick(time), '16n', 0);
  }

  stop(): void {
    if (this.repeatId !== null) this.transport.clear(this.repeatId);
    this.repeatId = null;
    this.started = false;
  }

  dispose(): void {
    this.stop();
    for (const chain of this.chains.values()) {
      chain.voice.dispose();
      chain.filter.dispose();
      chain.phaser?.dispose();
      chain.pump.dispose();
      chain.panner.dispose();
      chain.level.dispose();
      chain.reverbSend.dispose();
      chain.delaySend.dispose();
    }
    this.chains.clear();
    for (const node of [this.bus, this.fxReturn, this.crush, this.drive, this.highpass, this.lowpass, this.compressor, this.limiter, this.masterGain, this.reverb, this.delay]) {
      node.dispose();
    }
  }

  // -------------------------------------------------------------------------
  // The loop
  // -------------------------------------------------------------------------

  private tick(time: number): void {
    const ticksPerStep = this.transport.PPQ / 4;
    const step = Math.round(this.transport.getTicksAtTime(time) / ticksPerStep);
    const song = this.songAt(step);

    this.applyMaster(song, time);

    const sixteenth = 15 / song.tempo; // one sixteenth note in seconds
    const feel = song.timeFeel || 1;
    const anySolo = TRACK_ORDER.some((id) => song.tracks[id].solo);

    // Swing pushes the second half of each beat late, which is what makes a
    // straight machine pattern feel human.
    const swingOffset = step % 2 === 1 ? song.swing * sixteenth * 0.34 : 0;
    const stepTime = time + swingOffset;

    // Work out the kick first so everything else can duck underneath it.
    const kickHits = this.hitsInStep(song, 'kick', step, feel);
    const kickOn = song.tracks.kick.enabled && !song.tracks.kick.muted && (!anySolo || song.tracks.kick.solo);
    if (kickOn && song.master.pump > 0.01) {
      for (const hit of kickHits) {
        this.duck(song, stepTime + hit.offset * sixteenth);
      }
    }

    for (const id of TRACK_ORDER) {
      const track = song.tracks[id];
      const audible = track.enabled && !track.muted && (!anySolo || track.solo) && track.volume > 0.001;
      const chain = this.chainFor(id, track);
      this.applyTrack(chain, track, song, time);
      if (!audible) continue;

      const hits = id === 'kick' ? kickHits : this.hitsInStep(song, id, step, feel);
      for (const hit of hits) {
        const at = stepTime + (hit.offset * sixteenth) / 1;
        this.fire(chain, id, track, song, hit, at, sixteenth / feel);
      }
    }

    this.hooks.onStep?.(step);
  }

  /**
   * Which pattern positions land inside this transport step.
   *
   * At normal speed that is exactly one. At half speed it is one every other
   * step, and at double speed it is two, the second landing halfway through.
   * Expressing it as a range rather than a special case is what lets the
   * half-time and double-time Shifts share all the same code.
   */
  private hitsInStep(
    song: Song,
    id: TrackId,
    step: number,
    feel: number,
  ): { index: number; velocity: number; offset: number }[] {
    const track = song.tracks[id];
    const from = step * feel;
    const to = (step + 1) * feel;
    const out: { index: number; velocity: number; offset: number }[] = [];

    for (let index = Math.ceil(from - 1e-9); index < to - 1e-9; index++) {
      if (index < 0) continue;
      const velocity = this.velocityAt(song, id, track, index);
      if (velocity <= 0) continue;
      out.push({ index, velocity, offset: (index - from) / feel });
    }
    return out;
  }

  private patternSteps(song: Song, id: TrackId, track: Track, bar: number): number[] {
    const key = `${id}:${bar}:${track.pattern.source}:${track.pattern.libraryId}:${track.density.toFixed(3)}:${track.chaos.toFixed(3)}:${song.seed}`;
    const cached = this.stepCache.get(key);
    if (cached) return cached;

    const base = track.pattern.source === 'grid' && track.pattern.steps.length
      ? track.pattern.steps
      : getPattern(track.pattern.libraryId, TRACK_ROLE[id]).steps;

    const resolved = resolveSteps(base, track.density, track.chaos, TRACK_ROLE[id], `${song.seed}:${id}`, bar);
    if (this.stepCache.size > 400) this.stepCache.clear();
    this.stepCache.set(key, resolved);
    return resolved;
  }

  private hitOrdinal(song: Song, id: TrackId, track: Track, index: number): number {
    const window = 64;
    const start = Math.floor(index / window) * window;
    const key = `${id}:${start}:${track.pattern.source}:${track.pattern.libraryId}:${track.density.toFixed(3)}:${track.chaos.toFixed(3)}:${song.seed}`;
    let counts = this.ordinalCache.get(key);
    if (!counts) {
      counts = new Array<number>(window);
      let running = 0;
      for (let i = 0; i < window; i++) {
        counts[i] = running;
        if (this.velocityAt(song, id, track, start + i) > 0) running++;
      }
      if (this.ordinalCache.size > 200) this.ordinalCache.clear();
      this.ordinalCache.set(key, counts);
    }
    return counts[index - start] ?? 0;
  }

  private velocityAt(song: Song, id: TrackId, track: Track, index: number): number {
    if (track.pattern.source === 'hum') {
      const loop = this.humLoopLength(track);
      const position = ((index % loop) + loop) % loop;
      const note = track.pattern.notes.find((n) => n.step === position);
      return note ? note.velocity : 0;
    }
    const steps = this.patternSteps(song, id, track, Math.floor(index / 16));
    return steps[index % steps.length] ?? 0;
  }

  private humLoopLength(track: Track): number {
    if (!track.pattern.notes.length) return 16;
    const end = Math.max(...track.pattern.notes.map((n) => n.step + n.length));
    return Math.max(16, Math.ceil(end / 16) * 16);
  }

  /** How long a note should ring: until the next hit in the same pattern. */
  private lengthInSteps(song: Song, id: TrackId, track: Track, index: number): number {
    if (track.pattern.source === 'hum') {
      const loop = this.humLoopLength(track);
      const note = track.pattern.notes.find((n) => n.step === ((index % loop) + loop) % loop);
      return note ? note.length : 1;
    }
    const steps = this.patternSteps(song, id, track, Math.floor(index / 16));
    for (let ahead = 1; ahead <= steps.length; ahead++) {
      if ((steps[(index + ahead) % steps.length] ?? 0) > 0) return ahead;
    }
    return steps.length;
  }

  private fire(
    chain: TrackChain,
    id: TrackId,
    track: Track,
    song: Song,
    hit: { index: number; velocity: number },
    time: number,
    sixteenthSeconds: number,
  ): void {
    const held = this.lengthInSteps(song, id, track, hit.index);
    const duration = Math.max(0.03, held * sixteenthSeconds * 0.92);
    const velocity = Math.max(0.05, Math.min(1, hit.velocity));

    const options: TriggerOptions = { velocity, duration };

    if (isMelodic(id)) {
      const notes = this.notesFor(id, track, song, hit.index);
      if (!notes.length) return;
      if (id === 'chords' || id === 'pad') options.notes = notes;
      else options.midi = notes[0];
      options.sync = track.syncAmount;
    } else if (id === 'chop') {
      if (!this.clipKey) return;
      const slices = Math.max(1, Math.round(song.clip.slices));
      options.bufferKey = this.clipKey;
      options.sliceCount = slices;
      // Which slice plays is a stable choice per position, so the chop is a
      // repeatable part rather than noise that changes every loop.
      const roll = rngAt(song.seed, id, hit.index, 'slice');
      options.slice = track.chaos > 0.02 ? Math.floor(roll * slices) : hit.index % slices;
      options.reverse =
        rngAt(song.seed, id, hit.index, 'rev') < song.clip.reverseChance + track.chaos * 0.2;
      if (song.clip.pitchLock) options.midi = this.clipPitch(song, hit.index);
    } else if (id === 'vocal') {
      // Which rendering of the phrase to use: the one built for the chord in
      // this bar, so the robot follows the harmony.
      const progression = getProgression(song.progression);
      const bar = Math.floor(hit.index / 16);
      options.bufferKey = vocalKey(song, chordIndexAtBar(progression, bar));
    } else if (id === 'fx') {
      options.duration = Math.max(duration, sixteenthSeconds * 8);
    }

    this.applyFilterEnvelope(chain, track, time, duration);
    chain.voice.trigger(time, options);
  }

  /**
   * A pitch for a chopped slice that agrees with the current chord.
   *
   * Middle C means "play the clip at its recorded speed", so the offset is
   * measured from the mood's home note rather than being an absolute pitch.
   * That keeps a chopped vocal close to how it was recorded while still
   * locking it to the key.
   */
  private clipPitch(song: Song, index: number): number {
    const mood = MOODS[song.mood];
    const progression = getProgression(song.progression);
    const chord = chordAtBar(mood, progression, Math.floor(index / 16), 5);
    const home = degreeToMidi(mood, 0, 5);
    const note = chord.notes[index % chord.notes.length];
    return 60 + (note - home);
  }

  /**
   * Work out the actual notes for a melodic track.
   *
   * Everything comes from the chord sounding in this bar, so bass, chords, pad
   * and lead agree with each other by construction. There is no way to pick a
   * note that clashes, because no note outside the mood is ever offered.
   */
  private notesFor(id: TrackId, track: Track, song: Song, index: number): number[] {
    if (track.pattern.source === 'hum' && track.pattern.notes.length) {
      const loop = this.humLoopLength(track);
      const note = track.pattern.notes.find((n) => n.step === ((index % loop) + loop) % loop);
      return note ? [note.midi + track.octave * 12] : [];
    }

    const mood = MOODS[song.mood];
    const progression = getProgression(song.progression);
    const bar = Math.floor(index / 16);
    const shift = track.octave * 12;

    switch (id) {
      case 'bass':
      case 'lead': {
        const chord = chordAtBar(mood, progression, bar, id === 'bass' ? 2 : 5);
        const riff = getRiff(track.riff, TRACK_ROLE[id]);
        const ordinal = this.hitOrdinal(song, id, track, index);

        // Start the shape from wherever the chord's root sits in the palette,
        // so the same written shape follows the harmony instead of ignoring it.
        const home = nearestPalettePosition(mood, song.palette, chord.notes[0]);
        let position = home + riff.steps[ordinal % riff.steps.length];

        // Motion nudges the line off the written shape now and then, so a loop
        // running for minutes does not repeat exactly.
        if (track.motion > 0.01) {
          const roll = rngAt(song.seed, id, index, 'motion');
          if (roll < track.motion * 0.22) position += 1;
          else if (roll > 1 - track.motion * 0.22) position -= 1;
          else if (roll > 0.5 - track.motion * 0.06 && roll < 0.5 + track.motion * 0.06) {
            position += id === 'bass' ? -5 : 5;
          }
        }

        const note = paletteToMidi(mood, song.palette, position, 0) + shift;
        // A parallel interval, unsnapped, because that is what makes a lead in
        // fourths or fifths sound like one.
        return riff.parallel ? [note, note + riff.parallel] : [note];
      }
      case 'chords':
      case 'pad': {
        const chord = chordAtBar(mood, progression, bar, 4);
        const notes = id === 'pad' ? voiceChordWide(chord, 0.8) : chord.notes;
        // Chords keep their harmony and vary by inversion: the bottom note
        // moves up an octave each time round, which changes the shape of the
        // voicing without changing what the chord is.
        const turns = this.hitOrdinal(song, id, track, index) % notes.length;
        const voiced = notes.slice();
        for (let i = 0; i < turns; i++) voiced.push(voiced.shift()! + 12);
        return voiced.map((n) => n + shift);
      }
      default:
        return [];
    }
  }

  // -------------------------------------------------------------------------
  // Parameters
  // -------------------------------------------------------------------------

  private applyMaster(song: Song, time: number): void {
    const master = song.master;
    this.setIfChanged('tempo', song.tempo, (value) => this.transport.bpm.setValueAtTime(value, time));
    // Short ramps rather than jumps, so dragging a knob sweeps instead of
    // stepping audibly.
    this.rampIfChanged(this.lowpass.frequency, 'lp', cutoffToHz(master.lowpass), time, 0.03);
    this.rampIfChanged(this.highpass.frequency, 'hp', 20 + master.highpass * master.highpass * 1400, time, 0.03);
    this.rampIfChanged(this.drive.wet, 'driveWet', Math.min(1, master.drive * 1.4), time, 0.05);
    this.rampIfChanged(this.masterGain.gain, 'vol', master.volume, time, 0.05);
    this.rampIfChanged(this.delay.delayTime, 'delayTime', (60 / song.tempo) * master.delayTime, time, 0.1);
    this.rampIfChanged(this.delay.feedback, 'delayFb', Math.min(0.92, master.delayFeedback), time, 0.05);
    // These two rebuild a buffer or a curve when written, so they are only
    // touched when the knob has genuinely moved.
    this.setIfChanged('distortion', 0.05 + master.drive * 0.75, (value) => { this.drive.distortion = value; });
    this.setIfChanged('crush', Math.round(master.crush * 100) / 100, (amount) => {
      // Sixteen bits is transparent, three is a wreck. Blending the crushed
      // value against the original rather than switching means the knob sweeps
      // instead of stepping.
      const bits = 16 - amount * 13;
      const levels = Math.pow(2, bits - 1);
      this.crush.setMap((x: number) =>
        x * (1 - amount) + (Math.round(x * levels) / levels) * amount,
      );
    });
    this.setIfChanged('decay', 0.4 + master.reverbSize * 7, (value) => { this.reverb.decay = value; });
  }

  private applyTrack(chain: TrackChain, track: Track, song: Song, time: number): void {
    const anySolo = TRACK_ORDER.some((id) => song.tracks[id].solo);
    const audible = track.enabled && !track.muted && (!anySolo || track.solo);
    const id = track.id;
    this.rampIfChanged(chain.filter.Q, `${id}.q`, resonanceToQ(track.resonance), time, 0.05);
    this.rampIfChanged(chain.panner.pan, `${id}.pan`, track.pan, time, 0.05);
    this.rampIfChanged(chain.level.gain, `${id}.vol`, audible ? track.volume : 0, time, 0.04);
    this.rampIfChanged(chain.reverbSend.gain, `${id}.rev`, track.reverbSend, time, 0.05);
    this.rampIfChanged(chain.delaySend.gain, `${id}.dly`, track.delaySend, time, 0.05);
    if (chain.phaser) {
      this.rampIfChanged(chain.phaser.wet, `${id}.phase`, track.phase, time, 0.08);
    }
    if (track.envAmount <= 0.01) {
      this.rampIfChanged(chain.filter.frequency, `${id}.cut`, cutoffToHz(track.cutoff), time, 0.04);
    } else {
      // The envelope is driving this filter, so forget the resting value:
      // otherwise turning the envelope back down would not restore it.
      this.lastWritten.delete(`${id}.cut`);
    }
  }

  /**
   * Push the filter open on the attack of a note and let it fall back.
   *
   * This is what makes a bass line squelch and a chord stab bite. The track's
   * cutoff knob sets where it lands, and the envelope amount sets how far above
   * that it starts.
   */
  private applyFilterEnvelope(chain: TrackChain, track: Track, time: number, duration: number): void {
    if (track.envAmount <= 0.01) return;
    const base = cutoffToHz(track.cutoff);
    const peak = Math.min(19000, base * (1 + track.envAmount * 12));
    const fall = Math.max(0.04, Math.min(0.9, duration * 0.7));
    const frequency = chain.filter.frequency;
    frequency.cancelScheduledValues(time);
    frequency.setValueAtTime(peak, time);
    frequency.exponentialRampToValueAtTime(Math.max(40, base), time + fall);
  }

  /**
   * The Pump.
   *
   * On every kick, each track's gain is yanked down and then allowed to climb
   * back. That breathing is the single most recognisable thing about this style
   * of record, and doing it as a scheduled gain move rather than a compressor
   * means it is exact, repeatable and survives the offline export.
   */
  private duck(song: Song, time: number): void {
    const release = (60 / song.tempo) * (0.08 + song.master.pumpRelease * 0.85);
    for (const id of TRACK_ORDER) {
      const track = song.tracks[id];
      const depth = song.master.pump * track.pumpAmount;
      if (depth <= 0.005) continue;
      const chain = this.chains.get(id);
      if (!chain) continue;
      const gain = chain.pump.gain;
      gain.cancelScheduledValues(time);
      gain.setValueAtTime(Math.max(0.02, 1 - depth), time);
      gain.linearRampToValueAtTime(1, time + release);
    }
  }
}

// ---------------------------------------------------------------------------
// The live engine
// ---------------------------------------------------------------------------

let liveEngine: Engine | null = null;
let booting: Promise<Engine> | null = null;

/**
 * Start audio.
 *
 * iOS Safari refuses to make any sound until the user physically taps, so this
 * must be called from inside a tap handler and nowhere else.
 */
export function bootEngine(songAt: (step: number) => Song): Promise<Engine> {
  if (liveEngine) return Promise.resolve(liveEngine);
  if (booting) return booting;

  booting = (async () => {
    await Tone.start();
    // Handy when debugging on a phone over a remote inspector, and used by the
    // headless smoke test to confirm the graph is actually producing sound.
    (window as unknown as { __tone?: typeof Tone }).__tone = Tone;
    const context = Tone.getContext();
    await registerWorklets(context);
    // These run in the background. Neither is allowed to delay the first sound.
    void loadDirtIndex();
    warmOrchestralSamples();

    const engine = new Engine(songAt, Tone.getDestination(), context, Tone.getTransport());
    liveEngine = engine;
    return engine;
  })();

  return booting;
}

export function getEngine(): Engine | null {
  return liveEngine;
}

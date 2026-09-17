/**
 * Every sound you can choose, described without any audio code.
 *
 * Keeping this list separate from the synth building means the song JSON only
 * ever stores a voice id, and the interface can list voices without booting
 * the audio engine.
 *
 * `sampleBank` refers to a folder in the Dirt-Samples library, which is
 * fetched from a CDN at runtime. If that fetch fails the voice falls back to
 * `fallback`, so the app always makes a sound even with no network.
 */

import type { TrackRole } from '../music/patterns';

export type SynthKind =
  | 'kick'
  | 'snare'
  | 'clap'
  | 'hat'
  | 'tom'
  | 'supersaw'
  | 'monobass'
  | 'subbass'
  | 'acid'
  | 'tear'
  | 'microkorg'
  | 'pluck'
  | 'fm'
  | 'organ'
  | 'warmpad'
  | 'glasspad'
  | 'choir'
  | 'strings'
  | 'brass'
  | 'piano'
  | 'noise'
  | 'riser'
  | 'boom'
  | 'sampler'
  | 'vocoder'
  // Modelled on identifiable machines, because the sound being chased was made
  // on identifiable machines. See voices.ts for what each one is copying.
  | 'kick909'
  | 'snare909'
  | 'hat909'
  | 'clap909'
  | 'dafunk'
  | 'juno'
  | 'moog'
  | 'derezzed'
  | 'tronbrass'
  | 'modular';

export interface VoiceDef {
  id: string;
  label: string;
  tooltip: string;
  /** Which tracks may select this voice. */
  roles: TrackRole[];
  kind: SynthKind;
  /** Dirt-Samples folder name, when this voice plays a recording. */
  sampleBank?: string;
  /** Which file inside that folder, wrapped if the folder is smaller. */
  sampleIndex?: number;
  /** Used when the sample library cannot be reached. */
  fallback?: SynthKind;
  /** Starting filter cutoff in Hz, before the track's own filter knob. */
  brightness?: number;
  /** Longer than about 1 second counts as a sustained voice. */
  release?: number;
}

export const VOICES: VoiceDef[] = [
  // ---- Kick -------------------------------------------------------------
  { id: 'kick-punch', label: 'Punch', tooltip: 'Tight modern kick with a short thump. The safe default.', roles: ['kick'], kind: 'kick' },
  { id: 'kick-deep', label: 'Deep', tooltip: 'Longer low tail. Fills the bottom end on its own.', roles: ['kick'], kind: 'kick', release: 0.5 },
  { id: 'kick-909', label: 'Classic 909', tooltip: 'The drum machine kick heard on most house records.', roles: ['kick'], kind: 'sampler', sampleBank: 'bd', sampleIndex: 3, fallback: 'kick' },
  { id: 'kick-distort', label: 'Distorted', tooltip: 'Driven hard until it clips. Dirty and loud.', roles: ['kick'], kind: 'kick', brightness: 4000 },
  { id: 'kick-soft', label: 'Soft thud', tooltip: 'Muffled and distant. For scenes rather than dancefloors.', roles: ['kick'], kind: 'kick', brightness: 300, release: 0.4 },
  { id: 'kick-909s', label: '909 machine kick', tooltip: 'The drum machine behind almost every house record. Pitch collapses on the hit, with a click on the front so it cuts through on a phone.', roles: ['kick'], kind: 'kick909' },
  { id: 'kick-909-long', label: '909 with a tail', tooltip: 'The same machine kick, ringing on longer. Fills the bottom end by itself.', roles: ['kick'], kind: 'kick909', release: 0.6 },

  // ---- Snare ------------------------------------------------------------
  { id: 'clap-house', label: 'Clap', tooltip: 'A handclap instead of a snare. Standard in house.', roles: ['snare'], kind: 'clap' },
  { id: 'snare-909', label: 'Classic 909 snare', tooltip: 'Bright machine snare with a noisy crack.', roles: ['snare'], kind: 'sampler', sampleBank: 'sd', sampleIndex: 2, fallback: 'snare' },
  { id: 'snare-noise', label: 'Noise snare', tooltip: 'Built from white noise. Sits back in the mix.', roles: ['snare'], kind: 'snare' },
  { id: 'snare-rim', label: 'Rim', tooltip: 'A dry click. Rhythm without weight.', roles: ['snare'], kind: 'tom', brightness: 3000 },
  { id: 'snare-909s', label: '909 machine snare', tooltip: 'Two tuned tones for the drum and a longer band of noise for the wires under it. The split decay is what makes it a snare.', roles: ['snare'], kind: 'snare909' },
  { id: 'clap-909s', label: '909 machine clap', tooltip: 'Three noise bursts a few milliseconds apart, so it reads as many hands rather than one.', roles: ['snare'], kind: 'clap909' },
  { id: 'snare-break', label: 'Break snare', tooltip: 'Sampled from a live drum break. Loose and human.', roles: ['snare'], kind: 'sampler', sampleBank: 'breaks165', sampleIndex: 0, fallback: 'snare' },

  // ---- Hats -------------------------------------------------------------
  { id: 'hat-closed', label: 'Closed hat', tooltip: 'Short metallic tick.', roles: ['hats'], kind: 'hat' },
  { id: 'hat-open', label: 'Open hat', tooltip: 'Rings out between hits. Adds swing.', roles: ['hats'], kind: 'hat', release: 0.3 },
  { id: 'hat-909', label: 'Classic 909 hat', tooltip: 'The sampled machine hat. Crisp and familiar.', roles: ['hats'], kind: 'sampler', sampleBank: 'hh', sampleIndex: 0, fallback: 'hat' },
  { id: 'hat-909s', label: '909 machine hat', tooltip: 'Built from metal rather than noise, which is why it sounds like a cymbal instead of a hiss.', roles: ['hats'], kind: 'hat909' },
  { id: 'hat-909-open', label: '909 open hat', tooltip: 'The same metal, left to ring. Adds swing between the kicks.', roles: ['hats'], kind: 'hat909', release: 0.3 },
  { id: 'hat-shaker', label: 'Shaker', tooltip: 'Softer and grainier than a hat. Good under strings.', roles: ['hats'], kind: 'hat', brightness: 6000, release: 0.12 },

  // ---- Bass -------------------------------------------------------------
  { id: 'bass-mono', label: 'Mono punch', tooltip: 'One fat note at a time, filtered. The French house bass.', roles: ['bass'], kind: 'monobass' },
  { id: 'bass-sub', label: 'Sub', tooltip: 'Pure low end you feel more than hear. Needs good speakers.', roles: ['bass'], kind: 'subbass' },
  { id: 'bass-acid', label: 'Acid', tooltip: 'Squelching resonant bass that bends on every note.', roles: ['bass'], kind: 'acid' },
  { id: 'bass-microkorg', label: 'MicroKorg-ish', tooltip: 'Two detuned oscillators through a resonant filter. Thick and slightly unstable.', roles: ['bass', 'lead'], kind: 'microkorg' },
  { id: 'bass-moog', label: 'Moog bass', tooltip: 'A sawtooth with a pure sine an octave below. The sine is what you feel, the sawtooth is what you hear. This is the Around the World line.', roles: ['bass'], kind: 'moog' },
  { id: 'bass-juno', label: 'Juno bass', tooltip: 'Chorused and wide for a bass, which should not work and does.', roles: ['bass'], kind: 'juno' },
  { id: 'bass-fm', label: 'Metal bass', tooltip: 'Hard and bell-like. Cuts through a busy mix.', roles: ['bass'], kind: 'fm' },

  // ---- Chords -----------------------------------------------------------
  { id: 'chords-supersaw', label: 'Supersaw stack', tooltip: 'Many detuned sawtooth waves at once. Huge and slightly out of tune on purpose.', roles: ['chords', 'pad', 'lead'], kind: 'supersaw' },
  { id: 'chords-stab', label: 'Filtered stab', tooltip: 'Short chord hit that opens and closes with the filter.', roles: ['chords'], kind: 'supersaw', release: 0.25 },
  { id: 'chords-rhodes', label: 'Electric piano', tooltip: 'Soft bell-like keys. Warm and a bit nostalgic.', roles: ['chords', 'pad'], kind: 'fm', brightness: 2200 },
  { id: 'chords-organ', label: 'Organ', tooltip: 'Stacked pure tones, no attack. Holds chords well.', roles: ['chords', 'pad'], kind: 'organ' },
  { id: 'chords-piano', label: 'Piano', tooltip: 'A real piano recording. Central to the orchestral Shift.', roles: ['chords', 'lead', 'pad'], kind: 'sampler', sampleBank: 'casio', sampleIndex: 0, fallback: 'fm' },
  { id: 'chords-juno', label: 'Juno-106', tooltip: 'The synth the duo used more than any other. One sawtooth, one wobbling pulse, and the chorus that made the machine famous. Almost every filtered house chord owes this.', roles: ['chords', 'pad', 'bass'], kind: 'juno' },
  { id: 'chords-tron-brass', label: 'Tron brass', tooltip: 'Wide brass doubled an octave down, slow to speak. The low ostinato from the Tron score.', roles: ['chords', 'pad', 'lead'], kind: 'tronbrass' },
  { id: 'chords-strings', label: 'Strings', tooltip: 'Bowed string section. Slow to speak, so it swells in.', roles: ['chords', 'pad', 'lead'], kind: 'strings' },

  // ---- Lead -------------------------------------------------------------
  { id: 'lead-tear', label: 'Tear', tooltip: 'Screaming hard sync lead. The Sync Amount knob tears it apart.', roles: ['lead'], kind: 'tear' },
  { id: 'lead-supersaw', label: 'Wide saw', tooltip: 'Big detuned lead. Trance in one sound.', roles: ['lead'], kind: 'supersaw' },
  { id: 'lead-microkorg', label: 'MicroKorg-ish lead', tooltip: 'Two-oscillator lead with unison detune and a filter that sings.', roles: ['lead'], kind: 'microkorg' },
  { id: 'lead-dafunk', label: 'Da Funk', tooltip: 'A sawtooth squeezed into a narrow honking midrange and then distorted, which is why it sounds like an overdriven guitar. Use the Perfect fourths melody shape with it.', roles: ['lead'], kind: 'dafunk' },
  { id: 'lead-derezzed', label: 'Derezzed', tooltip: 'Detuned squares through heavy distortion. Hard edged and deliberately ugly.', roles: ['lead'], kind: 'derezzed' },
  { id: 'lead-pluck', label: 'Pluck', tooltip: 'Short and bright, decays fast. Good for fast arpeggios.', roles: ['lead', 'chords'], kind: 'pluck' },
  { id: 'lead-brass', label: 'Brass', tooltip: 'Horn section. Blunt and heroic.', roles: ['lead', 'chords'], kind: 'brass' },

  // ---- Pad --------------------------------------------------------------
  { id: 'pad-warm', label: 'Warm pad', tooltip: 'Slow, soft and wide. Fills the space behind everything.', roles: ['pad'], kind: 'warmpad' },
  { id: 'pad-glass', label: 'Glass pad', tooltip: 'Thin and shimmering. Sits above the mix rather than under it.', roles: ['pad'], kind: 'glasspad' },
  { id: 'pad-modular', label: 'Modular drift', tooltip: 'Never settles. The filter takes over a minute to come round, so a loop keeps changing under a long scene without you doing anything.', roles: ['pad'], kind: 'modular' },
  { id: 'pad-choir', label: 'Choir', tooltip: 'Voice-like held tones. Instantly cinematic.', roles: ['pad', 'chords'], kind: 'choir' },
  { id: 'pad-strings', label: 'String pad', tooltip: 'Sustained strings. The orchestral Shift uses this.', roles: ['pad'], kind: 'strings' },

  // ---- Vocal ------------------------------------------------------------
  { id: 'vocal-robot', label: 'Robot voice', tooltip: 'Types your phrase through a vocoder so the chords sing it.', roles: ['vocal'], kind: 'vocoder' },
  { id: 'vocal-clip', label: 'Vocal clip', tooltip: 'Plays a vocal file you loaded, pitched to the mood.', roles: ['vocal'], kind: 'sampler', sampleBank: 'alphabet', sampleIndex: 0, fallback: 'choir' },

  // ---- Sample chop ------------------------------------------------------
  { id: 'chop-sampler', label: 'Chopper', tooltip: 'Slices whatever audio you load and replays the pieces in time.', roles: ['chop'], kind: 'sampler', fallback: 'pluck' },

  // ---- FX ---------------------------------------------------------------
  { id: 'fx-riser', label: 'Riser', tooltip: 'Noise sweeping upward to build tension into the next bar.', roles: ['fx'], kind: 'riser' },
  { id: 'fx-boom', label: 'Boom', tooltip: 'Deep impact hit. Use it on picture cuts.', roles: ['fx'], kind: 'boom' },
  { id: 'fx-noise', label: 'Noise wash', tooltip: 'A breath of filtered noise. Texture between sections.', roles: ['fx'], kind: 'noise' },
];

export const VOICE_BY_ID = new Map(VOICES.map((v) => [v.id, v]));

export function voicesForRole(role: TrackRole): VoiceDef[] {
  return VOICES.filter((v) => v.roles.includes(role));
}

export function getVoice(id: string, role: TrackRole): VoiceDef {
  return VOICE_BY_ID.get(id) ?? voicesForRole(role)[0] ?? VOICES[0];
}

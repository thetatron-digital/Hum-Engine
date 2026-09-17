# Hum Engine

A browser music machine for scoring short films. Knobs and buttons, no code, no
music theory. Built to be played live on a phone and exported as audio.

Sound reference: Daft Punk and French house, with acid, trance, drum and bass
and dark cinematic ambient available as presets.

---

## Running it

```bash
npm install
npm run dev          # development, http://localhost:5173
npm run build        # production build into dist/
npm run preview      # serve the production build on :4173
npm run check        # run every check below
```

### The checks

Audio is the kind of thing that passes a build and produces silence, so these
test the sound itself rather than the code around it. All but the first need
the preview server running. Set `CHROME_PATH` if Playwright cannot find a
browser.

| Command | What it proves |
| --- | --- |
| `npm run check:vocal` | The robot voice produces a signal, its loudness moves the way speech does, and its energy lands in the formant range rather than on the carrier's fundamental. Pure maths, so it runs without a browser. |
| `npm run smoke` | Audio actually comes out of the speakers, and a Shift transitions, holds and returns. |
| `npm run check:pitch` | Pitch detection is accurate. Feeds the detector known tones from 110 Hz to 440 Hz as both sine and sawtooth, and fails if any is off by more than half a semitone. Currently within 2 cents. |
| `npm run check:hum` | The whole hum flow runs: permission, worklet, count-in, recording, note view. |
| `npm run check:presets` | Loads every starting song and cycles the Lead through every voice, measuring what actually comes out. A voice with a mis-wired envelope builds fine, type checks fine and makes no sound, so this is the only thing that catches it. |
| `npm run check:export` | Renders real WAV files, reads them back, and checks the mix is not silent, that the stems are the same length as it, and that no stem is secretly a copy of the mix. |

`check:pitch` exists because Chromium's synthetic microphone is a rumble at
about 22 Hz, which the detector rightly refuses, so `check:hum` can only
exercise the flow and not the detection.

---

## The one idea to understand first

**The entire song is a single JSON object, and the audio engine reads it on
every sixteenth note.**

Nothing about the sound is stored anywhere else. There is no separate
"compiled" state to keep in sync. Turning a knob writes one number into that
object, and the very next step of the sequencer reads the new value. That is
why every control is instant, why save and load are trivial, and why the Shift
button can be implemented as a pure function.

The shape lives in `src/state/song.ts` and the store is `src/state/store.ts`.
Every edit goes through `setParam(path, value)` so that live performances can
be recorded as a timestamped list of moves.

---

## Decisions, and why

**Tone.js, not Strudel.** The brief suggested building on Strudel's engine.
Strudel's API is a pattern-string language, so driving it from knobs would mean
regenerating and re-evaluating source strings on every interaction, which is
exactly the thing this app is supposed to hide. It also makes per-track stem
export and the Shift crossfade awkward, because there are no stable per-track
audio nodes to tap. Tone.js gives real `AudioNode`s that can be routed, tapped
and rendered offline. The sample library Strudel uses is free and separate, so
it is still used here. Choosing Tone.js also sidesteps Strudel's AGPL licence
entirely, so there is no obligation to flag if this is ever made public.

**Samples load from a CDN, and nothing depends on them.** Committing hundreds
of megabytes of audio would make deploys slow. Instead, drum and one-shot
samples come from Dirt-Samples and acoustic instruments from public Tone.js
sample hosts, both fetched at runtime. Every sampled voice names a synth
fallback. If the network is unavailable the app still plays, using synths, and
says so in the footer. This is tested: the development container blocks the
sample CDN, and the smoke test passes anyway.

**Random choices are seeded, never `Math.random`.** The Chaos knob and the
random song generator run through `src/music/rng.ts`, seeded by the song seed
plus bar and step. This matters because the offline export re-runs the
sequencer from bar zero. With real randomness the exported file would not match
what you just heard.

**Hard sync is a real AudioWorklet.** Web Audio cannot reset an oscillator's
phase, so there is no way to fake hard sync with built-in nodes. The Tear voice
generates its waveform sample by sample in `src/audio/hardsync-processor.js`.
It runs eight times faster than the output and filters before downsampling,
which is a blunter approach to anti-aliasing than band-limited steps but is far
easier to verify by ear. It falls back to a resonant filtered square if the
browser has no AudioWorklet.

**YIN for pitch detection, written here rather than pulled in.** An FFT tells
you which frequencies are present, but a hummed note is a fundamental plus a
stack of harmonics and the loudest bin is often a harmonic, which is where
octave errors come from. YIN looks for the period at which the waveform repeats
itself instead, which is much more reliable on a voice. Pitchy wraps the same
algorithm, but writing it out means confidence and loudness arrive on the same
message as the pitch and the thresholds can be tuned for humming rather than
for tuning a guitar. CREPE would be more accurate on hard material and is a
multi-megabyte download that is too slow per frame on a phone.

**The robot voice is formant synthesis, not meSpeak.** The brief suggested
meSpeak.js or the Web Speech API. The Web Speech API cannot be rendered to a
buffer at all, only spoken aloud, which rules it out for a vocoder. meSpeak
would work but needs three more CDN fetches and a voice data file, and the
development container's network policy blocks CDNs, so it could not be verified
here at all. Instead `src/vocal/speech.ts` builds the voice from scratch: a
buzz, some noise, and three sliding resonances, which is how talking machines
worked before recordings were involved. It reads spelling rather than
pronunciation, so it has an accent. Given the target is a robot, that is a
feature. If the words are ever not clear enough, the honest next step is to let
you record your own voice through the microphone and use that as the modulator,
which would be a real vocoder and would sound much more like the records. The
microphone plumbing for it already exists.

**The vocoder renders to a buffer instead of running live.** Following band
envelopes in real time needs another worklet and careful tuning. Rendering
instead means a phrase is only built when the words or the chord change, it
plays back as an ordinary sample, and it therefore exports correctly with
everything else for free. One version is rendered per chord in the progression,
so the robot follows the harmony.

---

## Layout

```
src/
  music/            Musical knowledge, no audio and no React
    rng.ts            Seeded randomness
    moods.ts          Moods to roots and scales, note snapping
    progressions.ts   Chord progressions as scale degrees
    patterns.ts       The rhythm library, plus Density and Chaos
    generate.ts       Random song
  state/
    song.ts           The Song type, defaults and migration
    store.ts          Zustand store, Shift ramp, performance recording
    presets.ts        Eleven complete starting songs
    userPresets.ts    Presets you save yourself
  shift/
    modes.ts          Shift modes as Song -> Song, and the blend
  audio/
    voiceCatalog.ts   Every voice, described without audio code
    voices.ts         The synths and samplers themselves
    samples.ts        CDN loading, caching, graceful failure
    worklets.ts       Module loading, around a Tone.js trap
    hardsync-processor.js   The Tear oscillator
    pitch-processor.js      YIN pitch detection for humming
    engine.ts         Master chain, track chains, the sixteenth note loop
  hum/
    capture.ts        Microphone, note segmentation, cleanup, scale snapping
  vocal/
    dsp.ts            Pure filter maths, runnable outside a browser
    speech.ts         Text to a robotic voice by formant synthesis
    vocoder.ts        The voice shapes the chord. The Daft Punk sound
    render.ts         Renders one phrase per chord into the buffer cache
  export/
    performance.ts    Replaying recorded knob moves and Shift presses
    render.ts         The offline multichannel render
    wav.ts            48 kHz 16 bit encoding and resampling
  ui/                 React, all of it presentational
scripts/              The checks described above
```

`music/` never imports from `audio/` or `ui/`. `audio/` never imports from
`ui/`. The DSP in `vocal/` works on plain arrays and imports nothing from Web
Audio, which is precisely why it can be checked outside a browser. That keeps
the musical rules testable on their own and means the whole sound engine could
be driven by something other than this interface.

---

## How the pieces work

### Harmony without theory

You pick a **Feeling**, not a key. Each feeling maps to a root note and a scale
in `moods.ts`. Chords are built by stacking every other note **of that scale**,
which is what guarantees they are always in key: major and minor quality falls
out of the mood rather than being chosen. Progressions are lists of scale
degrees, so the same progression works in every mood.

No melodic track can produce a note that is not in the scale, because notes are
only ever derived from the current chord. That is the point: you cannot play a
wrong note.

### Density and Chaos

**Density** at the halfway point leaves the pattern alone. Below it, hits are
removed quietest first so the backbone survives. Above it, hits are added at
positions listed per instrument in musically safe order.

**Chaos** varies the pattern per bar. It never deletes a downbeat and never
invents a hit on a strong beat, so however far you push it the loop stays
recognisable. It is seeded by bar, so bar 5 always sounds the same.

### Pump

On every kick, each track's gain is pulled down and ramped back up. Doing it as
scheduled gain moves rather than a compressor means it is exact, repeatable,
and survives the offline render. `Engine.duck()`.

### Time feel

`song.timeFeel` is 1 normally, 0.5 for half time and 2 for double time. The
sequencer asks which pattern positions fall inside each transport step, as a
range rather than a special case (`Engine.hitsInStep`). At 0.5 that is one
every other step; at 2 it is two, the second landing halfway through. This is
why the half-time and double-time Shifts need no separate code path.

### Shift

A Shift mode is a **pure function from Song to Song** (`shift/modes.ts`).
Nothing is generated fresh, so the result is recognisably the same piece.

The transition is a blend between the two songs. Continuous controls slide,
which produces the long filter opening. Choices that cannot be halfway done,
like which voice is playing, swap at the midpoint. A track that is on at one
end and off at the other fades rather than popping.

The shifted version is recomputed from the *live* base song rather than a
snapshot taken when the button was pressed, so knobs still work while shifted.
That matters for performing.

---

### Hum to melody

`src/audio/pitch-processor.js` runs YIN in an AudioWorklet. The signal is
filtered and decimated to a quarter of the sample rate first, which cuts the
work by a factor of sixteen and loses nothing, because humming lives below
about 1 kHz. `src/hum/capture.ts` turns the stream of readings into notes.

The order of operations is the important part. Pitch is snapped to the scale
**last**, after segmentation and cleanup. That means you can hum flat, or
badly, or slide between notes, and still get something usable, because being in
key is enforced rather than detected.

Notes are cut where the voice stops or where the pitch jumps far enough to be a
new note rather than a wobble, and each note's pitch is the **median** of its
readings, not the average, because a hummed note usually slides into place and
the median ignores the approach.

Latency is corrected from what the browser reports, plus a manual trim in
milliseconds, because the real figure on a phone varies with the route the
audio takes and no API reports it honestly.

### Export

Everything comes out of a single render. Each track's output is split into its
own pair of channels in one wide multichannel render, which is faster than
rendering ten times and guarantees the stems line up with the mix to the
sample. The stems are taken before the master drive, sweeps and compression, so
they add back up to the mix.

Three traps, all of which cost real time to find:

1. **A silent render reports no error.** `renderToBuffers` checks the peak and
   refuses to hand over a file that is effectively silent.
2. **Chrome throws on any write to an offline destination's channel layout**,
   including writing back the value it already holds. It does not need setting:
   the context is created with the channel count already correct.
3. **Tone's `addAudioWorkletModule` silently ignores every module after the
   first.** The second worklet appears to load and then fails only when you
   build a node from it. `src/audio/worklets.ts` adds modules to the underlying
   context and keeps its own record instead.

A fourth, subtler one: during an offline render the clock does not advance
between steps, so writing the same automation point repeatedly throws. The
engine now only writes a parameter when its value has actually moved, which
also stops it rebuilding the reverb's impulse response sixteen times a bar.

And a fifth, which only showed up on a real device: **`Tone.PolySynth`
allocates its voices lazily.** Rendering swaps the global context for an
offline one, so when the still-running live sequencer played a chord that
needed one more voice than it had, that voice got built on the offline context
and then refused to connect to the live mixer. The report was
`InvalidAccessError: source and destination nodes belong to different audio
contexts`, from a line of code nowhere near the cause. Playback now stops for
the duration of a render, which removes the whole class of problem and is what
a studio does anyway: you do not monitor a bounce. Anything built from an async
continuation also names its context explicitly now.

---

## Build order

- [x] 1. Engine boots, plays, tempo and tap tempo
- [x] 2. Ten tracks: voice, pattern, step grid, Density, Chaos, filter, sends, Pump
- [x] 3. Moods and progressions, melodic tracks locked to key
- [x] 4. Shift with all five modes, blended transitions, Return
- [x] 5. Hum to melody: YIN pitch detection, scale snapping, editable note view
- [x] 6. Sample loading and chopping, with slices put in key
- [x] 7. Vocals tier one (typed phrase through the vocoder) and tier two (vocal chops)
- [x] 8. Export: full mix, stems, song file, and recorded performances
- [x] 9. Eleven presets, random song, save as preset, mobile layout
- [x] 10. Deployed at hum-engine.vercel.app. Turn on Vercel Authentication
      under the project's Deployment Protection if it should stay private.

## Since the first round of feedback

- Melody shapes and the five note palette, so two songs sound like two songs.
- Voices modelled on the actual Daft Punk gear, and five presets aimed at
  specific records. See the table above.
- The mic modulator vocoder: record your own voice and the chords sing it.
- Swirl (phaser) per track, master Crush.
- Choosers are bottom sheets rather than native dropdowns, so each option can
  carry its explanation and be hit with a thumb.
- Shift used to do nothing while stopped, because the blend is driven by
  musical position and position was frozen. It now lands immediately when
  stopped and glides only when there is musical time to glide through.
- Importing a song file. The file inputs carry **no accept filter**, because
  iOS Safari greys out `.json` files when one is set, which made a song file
  impossible to pick on a phone.
- Microphone constraints fall back when a device refuses to turn its own
  processing off.

## Tier three, when it is wanted

A server-side singing synthesis API was always meant to be optional. It slots
in as another entry in `SynthKind` and another case in `buildKind`, fed by a
renderer alongside `src/vocal/render.ts` that returns buffers into the same
cache. Nothing else has to change, because the Vocal track already plays
whatever buffer it is handed.

---

## Conventions

- No em dashes in any user-facing text.
- Every control has a plain-English label and a one-line tooltip. Assume the
  user has never heard the word "resonance"; the knob is called Bite.
- Tooltips are tap-to-open, never hover, because half the use is on a phone.
- Touch targets are at least 44px. The knob dial enforces this even when drawn
  smaller.
- Musical values are stored 0 to 1 and mapped to hertz or decibels at the edge,
  so every knob behaves the same way and presets stay readable.

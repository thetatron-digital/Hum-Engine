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
npm run smoke        # headless check that audio plays and Shift works
```

The smoke test needs the preview server running. It launches Chromium, taps
start, measures the actual output level, presses Shift, and confirms the
transition completes and returns. Set `CHROME_PATH` if Playwright cannot find
a browser.

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
  shift/
    modes.ts          Shift modes as Song -> Song, and the blend
  audio/
    voiceCatalog.ts   Every voice, described without audio code
    voices.ts         The synths and samplers themselves
    samples.ts        CDN loading, caching, graceful failure
    hardsync-processor.js   The Tear oscillator
    engine.ts         Master chain, track chains, the sixteenth note loop
  ui/                 React, all of it presentational
```

`music/` never imports from `audio/` or `ui/`. `audio/` never imports from
`ui/`. That keeps the musical rules testable on their own and means the whole
sound engine could be driven by something other than this interface.

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

## Built so far

- [x] 1. Engine boots, plays, tempo and tap tempo
- [x] 2. Ten tracks: voice, pattern, step grid, Density, Chaos, filter, sends, Pump
- [x] 3. Moods and progressions, melodic tracks locked to key
- [x] 4. Shift with all five modes, blended transitions, Return
- [x] Bonus: eleven presets, random song, song file download and upload

## Not built yet

- [ ] 5. Hum to melody. Plan: YIN pitch detection in an AudioWorklet, own
      implementation rather than Pitchy so confidence and RMS arrive on the
      same message and the thresholds can be tuned for humming. Segment on
      pitch stability and amplitude onsets, quantise timing to a chosen grid,
      snap pitch to the mood. `Song` already has a `hum` pattern source and a
      `HumNote` type, and the engine already plays them.
- [ ] 6. Sample loading and chopping. `Engine.chopBufferKey` and the sampler
      voice already handle slicing, reversing and pitching; what is missing is
      the file picker and the slice editor.
- [ ] 7. Vocals. Tier one is a typed phrase through a vocoder carried by the
      current chord. The `vocoder` voice kind exists and currently falls back
      to the choir. Tier three, a server-side singing API, should slot in as
      another voice kind without touching anything else.
- [ ] 8. Export: full mix, stems, JSON. Stems are already tappable via
      `Engine.stemTap(id)`, and the performance event log is already recorded.
      Known pitfall to check: verify the rendered buffer is not silent before
      offering the download.
- [ ] 9. Onboarding polish
- [ ] 10. Deploy to Vercel, access restricted

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

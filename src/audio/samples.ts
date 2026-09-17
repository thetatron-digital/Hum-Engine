/**
 * Sample loading.
 *
 * Two sources, both free and both fetched from a CDN at runtime rather than
 * committed to the repo:
 *
 *  - Dirt-Samples, the drum and one-shot library used by Strudel and Tidal.
 *    Its file names change, so rather than hard coding paths we read the
 *    library's own manifest and pick by folder and index.
 *  - Multisampled acoustic instruments for the orchestral Shift.
 *
 * Nothing here is allowed to be load-bearing. Every sampled voice names a
 * synth fallback, and if a fetch fails the app keeps playing with the synth.
 * That is why you can lose network and still make music.
 */

import * as Tone from 'tone';

const DIRT_MANIFESTS = [
  'https://cdn.jsdelivr.net/gh/tidalcycles/Dirt-Samples@master/strudel.json',
  'https://cdn.jsdelivr.net/gh/tidalcycles/dirt-samples@master/strudel.json',
];

const DIRT_BASES = [
  'https://cdn.jsdelivr.net/gh/tidalcycles/Dirt-Samples@master/',
  'https://cdn.jsdelivr.net/gh/tidalcycles/dirt-samples@master/',
];

type DirtManifest = Record<string, string[] | string>;

let dirtIndex: Record<string, string[]> | null = null;
let dirtBase = DIRT_BASES[0];
let dirtLoad: Promise<boolean> | null = null;

/** Fetch the Dirt-Samples index once. Resolves false if the library is unreachable. */
export function loadDirtIndex(): Promise<boolean> {
  if (dirtLoad) return dirtLoad;
  dirtLoad = (async () => {
    for (let i = 0; i < DIRT_MANIFESTS.length; i++) {
      try {
        const response = await fetch(DIRT_MANIFESTS[i]);
        if (!response.ok) continue;
        const manifest = (await response.json()) as DirtManifest;
        const index: Record<string, string[]> = {};
        for (const [key, value] of Object.entries(manifest)) {
          if (key.startsWith('_') || !Array.isArray(value)) continue;
          index[key] = value;
        }
        if (Object.keys(index).length === 0) continue;
        const declaredBase = typeof manifest._base === 'string' ? manifest._base : null;
        dirtBase = declaredBase || DIRT_BASES[i];
        dirtIndex = index;
        return true;
      } catch {
        // Try the next spelling of the repository name, then give up quietly.
      }
    }
    return false;
  })();
  return dirtLoad;
}

/** Resolve a Dirt-Samples folder and index to a full URL, or null if unavailable. */
export function dirtUrl(bank: string, index: number): string | null {
  if (!dirtIndex) return null;
  const files = dirtIndex[bank];
  if (!files || files.length === 0) return null;
  const file = files[index % files.length];
  return file.startsWith('http') ? file : dirtBase + file;
}

// ---------------------------------------------------------------------------
// Buffer cache
// ---------------------------------------------------------------------------

const buffers = new Map<string, Tone.ToneAudioBuffer>();
const pending = new Map<string, Promise<Tone.ToneAudioBuffer | null>>();

export function cachedBuffer(url: string): Tone.ToneAudioBuffer | null {
  return buffers.get(url) ?? null;
}

export function loadBuffer(url: string): Promise<Tone.ToneAudioBuffer | null> {
  const existing = buffers.get(url);
  if (existing) return Promise.resolve(existing);
  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const task = new Promise<Tone.ToneAudioBuffer | null>((resolve) => {
    const buffer = new Tone.ToneAudioBuffer(
      url,
      () => {
        buffers.set(url, buffer);
        resolve(buffer);
      },
      () => resolve(null),
    );
  }).finally(() => pending.delete(url));

  pending.set(url, task);
  return task;
}

/** Put a buffer the user dropped in under a name of our choosing. */
export function registerBuffer(key: string, buffer: Tone.ToneAudioBuffer): void {
  buffers.set(key, buffer);
}

// ---------------------------------------------------------------------------
// Multisampled acoustic instruments
// ---------------------------------------------------------------------------

/**
 * These power the orchestral Shift. Each entry lists a handful of recorded
 * notes; Tone stretches the nearest one to cover the notes in between.
 *
 * Both hosts below serve these files publicly and free. If either is down or
 * blocked, `instrumentSampler` resolves to null and the voice stays on its
 * synth fallback, which is audible but obviously synthetic.
 */
export interface InstrumentDef {
  baseUrl: string;
  /** Note name to file name. */
  files: Record<string, string>;
}

const TONEJS_INSTRUMENTS = 'https://nbrosowsky.github.io/tonejs-instruments/samples/';

export const INSTRUMENTS: Record<string, InstrumentDef> = {
  piano: {
    baseUrl: 'https://tonejs.github.io/audio/salamander/',
    files: { A1: 'A1.mp3', A2: 'A2.mp3', A3: 'A3.mp3', A4: 'A4.mp3', A5: 'A5.mp3', C3: 'C3.mp3', C4: 'C4.mp3', C5: 'C5.mp3' },
  },
  violin: {
    baseUrl: `${TONEJS_INSTRUMENTS}violin/`,
    files: { A3: 'A3.mp3', A4: 'A4.mp3', A5: 'A5.mp3', C4: 'C4.mp3', C5: 'C5.mp3', E4: 'E4.mp3', G4: 'G4.mp3' },
  },
  cello: {
    baseUrl: `${TONEJS_INSTRUMENTS}cello/`,
    files: { A2: 'A2.mp3', A3: 'A3.mp3', C2: 'C2.mp3', C3: 'C3.mp3', E2: 'E2.mp3', E3: 'E3.mp3', G2: 'G2.mp3' },
  },
  trumpet: {
    baseUrl: `${TONEJS_INSTRUMENTS}trumpet/`,
    files: { A3: 'A3.mp3', A5: 'A5.mp3', C4: 'C4.mp3', D5: 'D5.mp3', F3: 'F3.mp3', F4: 'F4.mp3' },
  },
  frenchHorn: {
    baseUrl: `${TONEJS_INSTRUMENTS}french-horn/`,
    files: { A1: 'A1.mp3', A3: 'A3.mp3', C2: 'C2.mp3', C4: 'C4.mp3', D3: 'D3.mp3', F3: 'F3.mp3' },
  },
};

const samplers = new Map<string, Tone.Sampler | null>();
const samplerLoads = new Map<string, Promise<Tone.Sampler | null>>();

/**
 * Build a sampler for one instrument. Resolves null if the files cannot be
 * fetched, which the calling voice treats as "stay on the synth".
 */
export function instrumentSampler(name: string): Promise<Tone.Sampler | null> {
  if (samplers.has(name)) return Promise.resolve(samplers.get(name) ?? null);
  const existing = samplerLoads.get(name);
  if (existing) return existing;

  const def = INSTRUMENTS[name];
  if (!def) return Promise.resolve(null);

  const task = new Promise<Tone.Sampler | null>((resolve) => {
    let settled = false;
    const finish = (value: Tone.Sampler | null) => {
      if (settled) return;
      settled = true;
      samplers.set(name, value);
      resolve(value);
    };
    // A slow phone on a bad connection should not hold the orchestral Shift
    // hostage forever, so give up after a while and use the synth.
    const timeout = setTimeout(() => finish(null), 15000);
    try {
      const sampler = new Tone.Sampler({
        urls: def.files,
        baseUrl: def.baseUrl,
        onload: () => {
          clearTimeout(timeout);
          finish(sampler);
        },
        onerror: () => {
          clearTimeout(timeout);
          finish(null);
        },
      });
    } catch {
      clearTimeout(timeout);
      finish(null);
    }
  }).finally(() => samplerLoads.delete(name));

  samplerLoads.set(name, task);
  return task;
}

/** Start fetching the orchestral instruments so the Shift is ready when tapped. */
export function warmOrchestralSamples(): void {
  for (const name of Object.keys(INSTRUMENTS)) void instrumentSampler(name);
}

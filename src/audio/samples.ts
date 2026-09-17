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

/**
 * Note that what is cached is the decoded audio, not the Sampler.
 *
 * A Tone node belongs to the audio context it was built on, and the offline
 * export runs on a different context. Decoded audio has no such attachment, so
 * caching the buffers and building a fresh Sampler each time is what lets the
 * orchestral instruments appear in an exported file at all.
 */
const instrumentBuffers = new Map<string, Record<string, Tone.ToneAudioBuffer> | null>();
const instrumentLoads = new Map<string, Promise<Record<string, Tone.ToneAudioBuffer> | null>>();

function loadInstrumentBuffers(name: string): Promise<Record<string, Tone.ToneAudioBuffer> | null> {
  if (instrumentBuffers.has(name)) return Promise.resolve(instrumentBuffers.get(name) ?? null);
  const existing = instrumentLoads.get(name);
  if (existing) return existing;

  const def = INSTRUMENTS[name];
  if (!def) return Promise.resolve(null);

  const task = (async () => {
    const entries = await Promise.all(
      Object.entries(def.files).map(async ([note, file]) => {
        const buffer = await loadBuffer(def.baseUrl + file);
        return [note, buffer] as const;
      }),
    );
    const usable: Record<string, Tone.ToneAudioBuffer> = {};
    for (const [note, buffer] of entries) if (buffer) usable[note] = buffer;
    // A couple of missing notes is survivable, a mostly empty set is not.
    const result = Object.keys(usable).length >= 3 ? usable : null;
    instrumentBuffers.set(name, result);
    return result;
  })().finally(() => instrumentLoads.delete(name));

  instrumentLoads.set(name, task);
  return task;
}

/**
 * Build a sampler for one instrument on the current context. Resolves null if
 * the files cannot be fetched, which the calling voice treats as "stay on the
 * synth".
 */
export async function instrumentSampler(
  name: string,
  context?: Tone.BaseContext,
): Promise<Tone.Sampler | null> {
  const buffers = await loadInstrumentBuffers(name);
  if (!buffers) return null;
  try {
    // The context is passed in because this resolves later, by which time the
    // app may be part way through an offline render and the current context
    // may not be the one this sampler has to live on.
    return new Tone.Sampler(context ? { urls: buffers, context } : { urls: buffers });
  } catch {
    return null;
  }
}

/** Whether an instrument's audio is already in memory, with no waiting. */
export function instrumentLoaded(name: string): boolean {
  return Boolean(instrumentBuffers.get(name));
}

/** Start fetching the orchestral instruments so the Shift is ready when tapped. */
export function warmOrchestralSamples(): void {
  for (const name of Object.keys(INSTRUMENTS)) void loadInstrumentBuffers(name);
}

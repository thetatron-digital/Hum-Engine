/**
 * Loading AudioWorklet modules.
 *
 * This exists because of a trap in Tone.js. Its own `addAudioWorkletModule`
 * remembers the first module it was given and then silently resolves for every
 * later one without loading it. The second worklet in an app therefore appears
 * to load fine and then fails only when you try to build a node from it, with
 * an error that names nothing useful. This app has two, so it adds modules to
 * the underlying context itself and keeps its own record of what is loaded,
 * per context and per module.
 *
 * Node construction still goes through Tone, whose factory knows how to unwrap
 * the context it hands back.
 */

import type * as Tone from 'tone';

const loaded = new WeakMap<Tone.BaseContext, Set<string>>();

export async function addWorkletModule(context: Tone.BaseContext, url: string): Promise<boolean> {
  const already = loaded.get(context);
  if (already?.has(url)) return true;

  const worklet = (context.rawContext as unknown as { audioWorklet?: AudioWorklet }).audioWorklet;
  // Requires a secure context. Vercel serves over HTTPS, and localhost counts.
  if (!worklet) return false;

  try {
    await worklet.addModule(url);
    const set = already ?? new Set<string>();
    set.add(url);
    loaded.set(context, set);
    return true;
  } catch {
    return false;
  }
}

export function workletLoaded(context: Tone.BaseContext, url: string): boolean {
  return loaded.get(context)?.has(url) ?? false;
}

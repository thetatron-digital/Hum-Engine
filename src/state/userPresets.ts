/**
 * Presets you save yourself.
 *
 * Kept in this browser's local storage alongside the current song. They are
 * whole song objects, so a saved preset is exactly the file you would have
 * downloaded, which means nothing can drift between the two.
 */

import type { Song } from './song';
import { migrateSong, cloneSong } from './song';

const KEY = 'hum-engine:presets:v1';

export interface SavedPreset {
  id: string;
  name: string;
  savedAt: number;
  song: Song;
}

export function listUserPresets(): SavedPreset[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedPreset[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({ ...entry, song: migrateSong(entry.song) }))
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function write(presets: SavedPreset[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(presets));
  } catch {
    // Storage full or blocked. Saving a preset is not worth an interruption.
  }
}

export function saveUserPreset(song: Song, name: string): SavedPreset[] {
  const trimmed = name.trim() || 'Untitled';
  const stored = cloneSong(song);
  stored.name = trimmed;
  const preset: SavedPreset = {
    id: `user-${Date.now()}`,
    name: trimmed,
    savedAt: Date.now(),
    song: stored,
  };
  // Replacing a preset of the same name is almost always what is meant, rather
  // than ending up with three things called the same thing.
  const next = [preset, ...listUserPresets().filter((entry) => entry.name !== trimmed)];
  write(next);
  return next;
}

export function deleteUserPreset(id: string): SavedPreset[] {
  const next = listUserPresets().filter((entry) => entry.id !== id);
  write(next);
  return next;
}

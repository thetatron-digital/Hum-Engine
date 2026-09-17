/**
 * Starting points and the song file.
 *
 * The whole song is one JSON object, so saving is just writing that object to
 * a file and loading is reading it back. Nothing else is needed.
 */

import { useRef, useState } from 'react';
import { useAppStore, exportSongJson } from '../state/store';
import { migrateSong } from '../state/song';
import { PRESET_LIST, loadPreset } from '../state/presets';
import { listUserPresets, saveUserPreset, deleteUserPreset, type SavedPreset } from '../state/userPresets';
import { randomSong } from '../music/generate';
import { MOOD_LIST } from '../music/moods';
import { GENRES, type GenreId } from '../music/patterns';
import type { MoodId } from '../music/moods';
import { Picker } from './Controls';
import { InfoLabel } from './Tooltip';

export function SongPanel() {
  const song = useAppStore((state) => state.song);
  const setSong = useAppStore((state) => state.setSong);
  const setParam = useAppStore((state) => state.setParam);
  const [mood, setMood] = useState<MoodId>('euphoric');
  const [genre, setGenre] = useState<GenreId>('french');
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<SavedPreset[]>(() => listUserPresets());
  const fileInput = useRef<HTMLInputElement>(null);

  const download = () => {
    const blob = new Blob([exportSongJson(song)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${song.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'song'}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const upload = async (file: File) => {
    try {
      setSong(migrateSong(JSON.parse(await file.text())));
      setMessage('Song loaded.');
    } catch {
      setMessage('That file could not be read as a song.');
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <InfoLabel text="Songs" tip="Starting points to build on, and saving or loading your own." className="panel-title" />
      </header>

      <label className="name-field">
        <span>Name</span>
        <input value={song.name} onChange={(event) => setParam('name', event.target.value)} />
      </label>

      <div className="preset-list">
        {PRESET_LIST.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className="preset"
            onClick={() => {
              setSong(loadPreset(preset.id));
              setMessage(`Loaded ${preset.name}.`);
            }}
          >
            <strong>{preset.name}</strong>
            <span>{preset.blurb}</span>
          </button>
        ))}
      </div>

      {saved.length > 0 && (
        <>
          <InfoLabel text="Your own" tip="Songs you saved. Kept in this browser, and identical to the song files you can download." />
          <div className="preset-list">
            {saved.map((preset) => (
              <div key={preset.id} className="preset-row">
                <button
                  type="button"
                  className="preset"
                  onClick={() => {
                    setSong(preset.song);
                    setMessage(`Loaded ${preset.name}.`);
                  }}
                >
                  <strong>{preset.name}</strong>
                  <span>Saved {new Date(preset.savedAt).toLocaleDateString()}</span>
                </button>
                <button
                  type="button"
                  className="preset-delete"
                  aria-label={`Delete ${preset.name}`}
                  onClick={() => setSaved(deleteUserPreset(preset.id))}
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      <div className="row">
        <Picker
          label="Feeling"
          tip="Which mood the random song should be built in."
          value={mood}
          onChange={(value) => setMood(value as MoodId)}
          options={MOOD_LIST.map((option) => ({ value: option.id, label: option.label }))}
        />
        <Picker
          label="Style"
          tip="Which genre the random song should be built in."
          value={genre}
          onChange={(value) => setGenre(value as GenreId)}
          options={GENRES.map((option) => ({ value: option.id, label: option.label, tip: option.tooltip }))}
        />
      </div>

      <div className="button-row">
        <button
          type="button"
          className="wide-button"
          onClick={() => {
            setSong(randomSong(mood, genre));
            setMessage('New random song.');
          }}
        >
          Random song
        </button>
        <button
          type="button"
          className="wide-button"
          onClick={() => {
            setSaved(saveUserPreset(song, song.name));
            setMessage(`Saved ${song.name || 'Untitled'} as a preset.`);
          }}
        >
          Save as preset
        </button>
        <button type="button" className="wide-button" onClick={download}>
          Download song file
        </button>
        <button type="button" className="wide-button" onClick={() => fileInput.current?.click()}>
          Load song file
        </button>
        {/*
          No accept filter: iOS Safari greys out .json files when one is set,
          which makes a song file impossible to pick on a phone.
        */}
        <input
          ref={fileInput}
          type="file"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = '';
          }}
        />
      </div>
      {message && <p className="hint">{message}</p>}
    </section>
  );
}

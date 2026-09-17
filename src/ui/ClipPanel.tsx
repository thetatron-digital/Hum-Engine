/**
 * The two tracks that need material from you: the robot voice and the chopper.
 */

import { useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { useAppStore } from '../state/store';
import { registerBuffer } from '../audio/samples';
import { getEngine } from '../audio/engine';
import { renderVocals, vocalReady } from '../vocal/render';
import { Knob } from './Knob';
import { ToggleButton } from './Controls';
import { InfoLabel } from './Tooltip';

const CLIP_KEY = 'clip:loaded';

export function VocalControls() {
  const song = useAppStore((state) => state.song);
  const setParam = useAppStore((state) => state.setParam);
  const [building, setBuilding] = useState(false);
  const [ready, setReady] = useState(() => vocalReady(song));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const vocal = song.vocal;

  // Rebuild after a pause rather than on every keystroke, since each rebuild
  // renders the whole phrase once per chord.
  useEffect(() => {
    setReady(vocalReady(song));
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBuilding(true);
      void renderVocals(song).then(() => {
        setBuilding(false);
        setReady(true);
      });
    }, 350);
    return () => clearTimeout(timer.current);
    // Only the things that change the sound should trigger a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocal.text, vocal.bands, vocal.brightness, vocal.formantShift, vocal.sibilance, song.mood, song.progression, song.tempo]);

  return (
    <div className="sub-panel">
      <InfoLabel
        text="Robot voice"
        tip="Type a phrase and the chords sing it. The words come from a voice built out of nothing, and the pitch comes from whatever chord is playing."
        className="panel-title"
      />

      <label className="name-field">
        <span>Phrase</span>
        <input
          value={vocal.text}
          onChange={(event) => setParam('vocal.text', event.target.value)}
          placeholder="type something for it to say"
        />
      </label>

      <p className="hint">
        {building ? 'Building the voice.' : ready ? 'Ready. Turn the Vocal track on to hear it.' : 'Waiting for a phrase.'}
      </p>

      <div className="knob-row">
        <Knob label="Clarity" tip="How many frequency bands the voice is split into. More makes the words clearer, fewer makes it a cruder and thicker robot." value={vocal.bands} min={6} max={32} defaultValue={20} onChange={(value) => setParam('vocal.bands', Math.round(value))} format={(value) => `${Math.round(value)} bands`} />
        <Knob label="Carrier" tip="How bright the chord underneath the voice is. Right is a buzzing stack of sawtooths, left is a darker hum." value={vocal.brightness} defaultValue={0.8} onChange={(value) => setParam('vocal.brightness', value)} />
        <Knob label="Size" tip="Shifts the voice's character. Right sounds like a small robot, left sounds like an enormous one." value={vocal.formantShift} min={0.6} max={1.7} defaultValue={1} onChange={(value) => setParam('vocal.formantShift', value)} format={(value) => (value > 1.05 ? 'Smaller' : value < 0.95 ? 'Bigger' : 'Normal')} />
        <Knob label="Breath" tip="Lets some of the raw breath through, which brings back the s and t sounds. Too much and it hisses." value={vocal.sibilance} defaultValue={0.25} onChange={(value) => setParam('vocal.sibilance', value)} />
      </div>
    </div>
  );
}

export function ClipControls() {
  const clip = useAppStore((state) => state.song.clip);
  const setParam = useAppStore((state) => state.setParam);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const load = async (file: File) => {
    setMessage('Reading the file.');
    try {
      const data = await file.arrayBuffer();
      const decoded = await Tone.getContext().decodeAudioData(data);
      registerBuffer(CLIP_KEY, new Tone.ToneAudioBuffer(decoded));
      const engine = getEngine();
      if (engine) engine.clipKey = CLIP_KEY;
      setParam('clip.name', file.name);
      setLoaded(true);
      setMessage(`Loaded ${file.name}, ${decoded.duration.toFixed(1)} seconds.`);
    } catch {
      setMessage('That file could not be read as audio. Try a WAV or an MP3.');
    }
  };

  return (
    <div className="sub-panel">
      <InfoLabel
        text="The clip"
        tip="Load any audio and this track cuts it into equal pieces and plays them in time. Works on vocals, drum loops, dialogue, anything."
        className="panel-title"
      />

      <button type="button" className="wide-button" onClick={() => fileInput.current?.click()}>
        {loaded ? 'Load a different clip' : 'Load an audio clip'}
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="audio/*"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void load(file);
          event.target.value = '';
        }}
      />

      {message && <p className="hint">{message}</p>}
      {!loaded && clip.name && (
        <p className="warn-box">
          This song was saved with a clip called {clip.name}. Audio files are not stored inside the
          song file, so load it again to hear this track.
        </p>
      )}

      <div className="bars-row">
        <InfoLabel text="Pieces" tip="How many equal slices the clip is cut into. More pieces means shorter, choppier fragments." />
        <div className="bars-buttons">
          {[4, 8, 16, 32].map((count) => (
            <ToggleButton key={count} on={clip.slices === count} onClick={() => setParam('clip.slices', count)}>
              {count}
            </ToggleButton>
          ))}
        </div>
      </div>

      <div className="button-row">
        <ToggleButton on={clip.pitchLock} onClick={() => setParam('clip.pitchLock', !clip.pitchLock)}>
          Put slices in key
        </ToggleButton>
      </div>

      <div className="knob-row">
        <Knob label="Backwards" tip="How often a slice plays in reverse. A little is a nice surprise, a lot is chaos." value={clip.reverseChance} defaultValue={0} onChange={(value) => setParam('clip.reverseChance', value)} />
      </div>
    </div>
  );
}

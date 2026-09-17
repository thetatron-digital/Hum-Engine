/**
 * The two tracks that need material from you: the robot voice and the chopper.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { useAppStore } from '../state/store';
import { registerBuffer } from '../audio/samples';
import { getEngine } from '../audio/engine';
import { renderVocals, vocalReady } from '../vocal/render';
import { MicrophoneDenied } from '../hum/capture';
import {
  VoiceRecorder,
  MAX_RECORD_SECONDS,
  storeVoice,
  storedVoiceTake,
  clearStoredVoice,
} from '../vocal/record';
import { Knob } from './Knob';
import { ToggleButton } from './Controls';
import { InfoLabel } from './Tooltip';
import { Reveal } from './Reveal';

const CLIP_KEY = 'clip:loaded';

export function VocalControls() {
  const song = useAppStore((state) => state.song);
  const setParam = useAppStore((state) => state.setParam);
  const [building, setBuilding] = useState(false);
  const [ready, setReady] = useState(() => vocalReady(song));
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const vocal = song.vocal;

  // Rebuild after a pause rather than on every knob movement, since each
  // rebuild vocodes the whole phrase once per chord in the progression.
  const rebuild = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setBuilding(true);
      void renderVocals(song).then(() => {
        setBuilding(false);
        setReady(vocalReady(song));
      });
    }, 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song]);

  useEffect(() => {
    setReady(vocalReady(song));
    rebuild();
    return () => clearTimeout(timer.current);
    // Only the things that change the sound should trigger a rebuild.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vocal.mode, vocal.bands, vocal.brightness, vocal.formantShift, vocal.sibilance, song.mood, song.progression]);

  return (
    <div className="sub-panel">
      <InfoLabel
        text="Robot voice"
        tip="Record a phrase and the chords sing it. Your voice supplies the words, the chord supplies the pitch, and a vocoder puts them together. That is how these records were actually made."
        className="panel-title"
      />

      <div className="bars-row">
        <InfoLabel text="Which robot" tip="A vocoder splits your voice into a row of frequency bands and is the choral, harmonised robot. A talkbox pipes the synth through a mouth instead, giving two or three moving resonances and a much more nasal, human sound." />
        <div className="bars-buttons">
          <ToggleButton on={vocal.mode === 'vocoder'} onClick={() => setParam('vocal.mode', 'vocoder')}>
            Vocoder
          </ToggleButton>
          <ToggleButton on={vocal.mode === 'talkbox'} onClick={() => setParam('vocal.mode', 'talkbox')}>
            Talkbox
          </ToggleButton>
        </div>
      </div>

      <VoiceTake onRecorded={rebuild} />

      <p className="hint">
        {building
          ? 'Building the voice.'
          : ready
            ? 'Ready. Turn the Vocal track on to hear it.'
            : 'Record a phrase for the chords to sing.'}
      </p>

      <Reveal label="More voice controls">
      <div className="knob-row">
        <Knob label="Clarity" tip="How many frequency bands the voice is split into. More makes the words clearer, fewer makes it a cruder and thicker robot." value={vocal.bands} min={6} max={32} defaultValue={20} onChange={(value) => setParam('vocal.bands', Math.round(value))} format={(value) => `${Math.round(value)} bands`} />
        <Knob label="Carrier" tip="How bright the chord underneath the voice is. Right is a buzzing stack of sawtooths, left is a darker hum." value={vocal.brightness} defaultValue={0.8} onChange={(value) => setParam('vocal.brightness', value)} />
        <Knob label="Size" tip="Shifts the voice's character. Right sounds like a small robot, left sounds like an enormous one." value={vocal.formantShift} min={0.6} max={1.7} defaultValue={1} onChange={(value) => setParam('vocal.formantShift', value)} format={(value) => (value > 1.05 ? 'Smaller' : value < 0.95 ? 'Bigger' : 'Normal')} />
        <Knob label="Breath" tip="Lets some of the raw breath through, which brings back the s and t sounds. Too much and it hisses." value={vocal.sibilance} defaultValue={0.25} onChange={(value) => setParam('vocal.sibilance', value)} />
      </div>
      </Reveal>
    </div>
  );
}

/**
 * Recording a phrase to put through the vocoder.
 *
 * Plain press to start and press to stop, with no count-in. Unlike humming a
 * melody, the timing of what you say does not have to line up with the beat:
 * the phrase gets retriggered in time by the track's pattern, so all that
 * matters is that the words are clear.
 */
function VoiceTake({ onRecorded }: { onRecorded: () => void }) {
  const setParam = useAppStore((state) => state.setParam);
  const savedName = useAppStore((state) => state.song.vocal.recordingName);
  const [state, setState] = useState<'idle' | 'opening' | 'recording' | 'done' | 'error'>(
    () => (storedVoiceTake() ? 'done' : 'idle'),
  );
  const [message, setMessage] = useState('');
  const [level, setLevel] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const recorder = useRef<VoiceRecorder | null>(null);
  const ticker = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  const shutDown = () => {
    clearInterval(ticker.current);
    recorder.current?.close();
    recorder.current = null;
    setLevel(0);
  };

  useEffect(() => shutDown, []);

  const begin = async () => {
    setState('opening');
    setMessage('');
    try {
      const active = await VoiceRecorder.open();
      recorder.current = active;
      active.onLevel = setLevel;
      active.onFull = () => finish();
      active.start();
      setState('recording');
      ticker.current = setInterval(() => setSeconds(active.seconds), 100);
    } catch (error) {
      setState('error');
      setMessage(
        error instanceof MicrophoneDenied
          ? error.message
          : `The microphone could not be opened. ${error instanceof Error ? error.name : ''}`,
      );
    }
  };

  const finish = () => {
    const active = recorder.current;
    if (!active) return;
    active.stop();
    const take = active.take();
    clearInterval(ticker.current);
    if (!take) {
      shutDown();
      setState('error');
      setMessage('Nothing was picked up. Speak closer to the microphone and try again.');
      return;
    }
    const name = `Take of ${take.length / active.sampleRate < 1 ? 'under a second' : `${(take.length / active.sampleRate).toFixed(1)} seconds`}`;
    storeVoice(take, active.sampleRate, name);
    shutDown();
    setParam('vocal.recordingName', name);
    setState('done');
    onRecorded();
  };

  return (
    <div className="take">
      <p className="warn-box">
        Use headphones. You will not hear yourself while recording, but a speaker playing the beat
        into the microphone ends up inside the words.
      </p>

      {state === 'recording' ? (
        <>
          <div className="recording">
            <div className="record-dot" />
            <p>Say your phrase. {Math.max(0, MAX_RECORD_SECONDS - seconds).toFixed(0)} seconds left.</p>
            <div className="level-meter">
              <div className="level-fill" style={{ width: `${Math.min(100, level * 220)}%` }} />
            </div>
          </div>
          <button type="button" className="record-button" onClick={finish}>
            Done
          </button>
        </>
      ) : (
        <button type="button" className="record-button" onClick={() => void begin()} disabled={state === 'opening'}>
          {state === 'opening' ? 'Asking for the microphone' : state === 'done' ? 'Record it again' : 'Record my voice'}
        </button>
      )}

      {state === 'done' && (
        <div className="button-row">
          <button
            type="button"
            className="wide-button"
            onClick={() => {
              clearStoredVoice();
              setParam('vocal.recordingName', '');
              setState('idle');
            }}
          >
            Throw it away
          </button>
        </div>
      )}

      {message && <p className="warn-box">{message}</p>}
      {state !== 'done' && savedName && !storedVoiceTake() && (
        <p className="warn-box">
          This song was saved with a recording. Recordings are not kept inside the song file, so
          record your phrase again to hear this track.
        </p>
      )}
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

/**
 * The app shell.
 *
 * The only thing worth knowing here is how audio starts. iOS Safari refuses to
 * produce any sound until a real finger has touched the screen, so nothing
 * audio related happens until the start button is tapped. Everything after
 * that point can assume a working audio context.
 */

import { useCallback, useEffect, useState } from 'react';
import * as Tone from 'tone';
import { useAppStore, renderSong } from './state/store';
import { bootEngine, getEngine } from './audio/engine';
import { loadDirtIndex } from './audio/samples';
import { TrackChips, TrackDetail } from './ui/TrackPanel';
import { HarmonyPanel, MasterPanel, ShiftPanel, TransportBar } from './ui/Panels';
import { SongPanel } from './ui/SongPanel';
import './styles.css';

/** Hands the engine whatever should be playing at a given step. */
function songAtStep(step: number) {
  const state = useAppStore.getState();
  return renderSong(state.song, state.shift, step);
}

function StartOverlay({ onStart, starting }: { onStart: () => void; starting: boolean }) {
  return (
    <div className="start-overlay">
      <div className="start-card">
        <h1>Hum Engine</h1>
        <p className="start-sub">A machine for scoring pictures. Turn knobs, hear results.</p>
        <button type="button" className="start-button" onClick={onStart} disabled={starting}>
          {starting ? 'Starting' : 'Tap to start'}
        </button>
        <p className="start-note">
          Your phone will not make a sound until you tap. Headphones are worth it, and they become
          necessary later when you hum melodies in.
        </p>
      </div>
    </div>
  );
}

export default function App() {
  const audioReady = useAppStore((state) => state.audioReady);
  const playing = useAppStore((state) => state.playing);
  const samplesOnline = useAppStore((state) => state.samplesOnline);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState('');

  const start = useCallback(async () => {
    setStarting(true);
    try {
      const engine = await bootEngine(songAtStep);
      engine.hooks.onStep = (step) => useAppStore.setState({ position: step });
      engine.ensureAllChains(useAppStore.getState().song);
      engine.start();
      Tone.getTransport().start();
      useAppStore.setState({ audioReady: true, playing: true });
      void loadDirtIndex().then((online) => useAppStore.setState({ samplesOnline: online }));
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'Audio could not start.');
    } finally {
      setStarting(false);
    }
  }, []);

  const play = useCallback(() => {
    const engine = getEngine();
    if (!engine) {
      void start();
      return;
    }
    engine.ensureAllChains(useAppStore.getState().song);
    Tone.getTransport().start();
    useAppStore.setState({ playing: true });
  }, [start]);

  const stop = useCallback(() => {
    Tone.getTransport().stop();
    useAppStore.setState({ playing: false, position: 0 });
  }, []);

  // The browser may suspend audio when the tab goes to the background. Bring it
  // back when the user returns rather than leaving them with a silent app.
  useEffect(() => {
    const resume = () => {
      if (document.visibilityState === 'visible' && useAppStore.getState().audioReady) {
        void Tone.getContext().resume();
      }
    };
    document.addEventListener('visibilitychange', resume);
    return () => document.removeEventListener('visibilitychange', resume);
  }, []);

  if (!audioReady) {
    return (
      <>
        <StartOverlay onStart={start} starting={starting} />
        {failure && <p className="failure">{failure}</p>}
      </>
    );
  }

  return (
    <div className="app">
      <header className="app-head">
        <h1>Hum Engine</h1>
        <span className={`status ${playing ? 'is-playing' : ''}`}>{playing ? 'Playing' : 'Stopped'}</span>
      </header>

      <TransportBar onPlay={play} onStop={stop} />
      <ShiftPanel />
      <TrackChips />
      <TrackDetail />
      <HarmonyPanel />
      <MasterPanel />
      <SongPanel />

      <footer className="app-foot">
        {!samplesOnline && (
          <p className="hint">
            The recorded sample library could not be reached, so the drum machine sounds and
            orchestral instruments are using their built-in synth versions. Everything still works.
          </p>
        )}
        <p className="hint">Everything you change is saved on this device automatically.</p>
      </footer>
    </div>
  );
}

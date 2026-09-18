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
import { diagnoseSilence, restoreSound } from './state/diagnose';
import { bootEngine, getEngine } from './audio/engine';
import { loadDirtIndex } from './audio/samples';
import { vocalReady } from './vocal/render';
import { TrackChips, TrackDetail } from './ui/TrackPanel';
import { HarmonyPanel, MasterPanel, ShiftPanel, TransportBar } from './ui/Panels';
import { SongPanel } from './ui/SongPanel';
import { PresetStrip } from './ui/PresetStrip';
import { ControlSwitch, DepthSwitch } from './ui/Reveal';
import { ExportPanel } from './ui/ExportPanel';
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
        <p className="start-note">
          If you hear nothing, check the silent switch on the side of the phone. It mutes this app
          even with the volume turned up, which is a browser thing and not something the app can
          detect or override.
        </p>
      </div>
    </div>
  );
}

/**
 * Explains a silent mix, when it can work out the reason.
 *
 * Stays out of the way entirely when nothing is obviously wrong.
 */
function SilenceNotice() {
  const song = useAppStore((state) => state.song);
  const setSong = useAppStore((state) => state.setSong);
  const playing = useAppStore((state) => state.playing);
  const audioReady = useAppStore((state) => state.audioReady);
  const [silent, setSilent] = useState(false);

  /*
   * Only speak up once the output really has gone quiet.
   *
   * Reading the settings and guessing is not good enough. Sweeping the master
   * filter shut is a deliberate move and still passes the kick, so a warning
   * based on the knob position would fire in the middle of a build. Watching
   * the actual level also catches causes nobody thought to enumerate.
   */
  useEffect(() => {
    // Nothing to watch while stopped. The stale value is handled by the render
    // gate below rather than by clearing it here, which would set state while
    // this effect is still running and start another render for nothing.
    if (!audioReady || !playing) return;
    let quietSince = 0;
    const timer = setInterval(() => {
      const engine = getEngine();
      if (!engine) return;
      if (engine.outputLevel() < 0.004) {
        if (quietSince === 0) quietSince = Date.now();
        // A couple of seconds, so a gap between hits is never mistaken for
        // the whole thing being broken.
        else if (Date.now() - quietSince > 2500) setSilent(true);
      } else {
        quietSince = 0;
        setSilent(false);
      }
    }, 400);
    return () => clearInterval(timer);
  }, [audioReady, playing]);

  if (!silent || !playing || !audioReady) return null;

  const reasons = diagnoseSilence(song, {
    clipLoaded: Boolean(getEngine()?.clipKey),
    vocalReady: vocalReady(song),
  });
  const first = reasons[0];

  return (
    <div className="alert">
      <p>
        <strong>No sound.</strong>{' '}
        {first
          ? first.message
          : 'Nothing is reaching the output, and the cause is not one of the usual ones.'}
      </p>
      <div className="alert-buttons">
        {first && (
          <button type="button" className="alert-fix" onClick={() => setSong(first.fix(song))}>
            {first.fixLabel}
          </button>
        )}
        <button
          type="button"
          className={first ? 'alert-plain' : 'alert-fix'}
          onClick={() => setSong(restoreSound(song))}
        >
          Restore sound settings
        </button>
      </div>
      {reasons.length > 1 && (
        <p className="alert-more">
          {reasons.length - 1} other thing{reasons.length > 2 ? 's are' : ' is'} also silencing it.
          Restoring sound settings fixes the lot without touching your music.
        </p>
      )}
    </div>
  );
}

export default function App() {
  const audioReady = useAppStore((state) => state.audioReady);
  const playing = useAppStore((state) => state.playing);
  const samplesOnline = useAppStore((state) => state.samplesOnline);
  const [starting, setStarting] = useState(false);
  const [failure, setFailure] = useState('');
  const [audioStalled, setAudioStalled] = useState(false);

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

  /*
   * Watch for the audio being taken away.
   *
   * On an iPhone, a phone call, an alarm, another app claiming the audio, or
   * simply locking the screen can leave the audio context in a state it will
   * not come out of on its own, and a resume is only allowed in response to a
   * tap. Until then the app looks completely normal and makes no sound at all,
   * which is indistinguishable from being broken. So it is worth saying so.
   */
  useEffect(() => {
    if (!audioReady) return;
    const check = () => setAudioStalled(Tone.getContext().state !== 'running');
    const raw = Tone.getContext().rawContext as unknown as AudioContext;
    raw.addEventListener?.('statechange', check);
    // Polled as well as listened for, because the state change event is not
    // reliably delivered when iOS takes the audio away. The first poll lands
    // within a second, which is soon enough to be useful and avoids setting
    // state while this effect is still running.
    const timer = setInterval(check, 900);
    return () => {
      raw.removeEventListener?.('statechange', check);
      clearInterval(timer);
    };
  }, [audioReady]);

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
        <div className="app-head-right">
          <span className={`status ${playing ? 'is-playing' : ''}`}>{playing ? 'Playing' : 'Stopped'}</span>
          <DepthSwitch />
        </div>
      </header>
      <div className="app-switches">
        <ControlSwitch />
      </div>

      {audioStalled && (
        <div className="alert">
          <p>
            The phone has taken the audio away, which happens after a call, an alarm, or the screen
            locking. It can only be handed back when you tap.
          </p>
          <button
            type="button"
            className="alert-fix"
            onClick={() => {
              void Tone.start().then(() => {
                setAudioStalled(Tone.getContext().state !== 'running');
                if (useAppStore.getState().playing) Tone.getTransport().start();
              });
            }}
          >
            Bring the sound back
          </button>
        </div>
      )}

      <SilenceNotice />

      {/*
        The order answers "what do I want on screen without scrolling": tap a
        name, press play, hear something. Everything that shapes what you just
        heard comes after it.
      */}
      <TransportBar onPlay={play} onStop={stop} />
      <PresetStrip />
      <ShiftPanel />
      <TrackChips />
      <TrackDetail />
      <HarmonyPanel />
      <MasterPanel />
      <SongPanel />
      <ExportPanel />

      <footer className="app-foot">
        {!samplesOnline && (
          <p className="hint">
            The recorded sample library could not be reached, so the drum machine sounds and
            orchestral instruments are using their built-in synth versions. Everything still works.
          </p>
        )}
        <p className="hint">Everything you change is saved on this device automatically.</p>
        <p className="hint build-id">
          Build {__BUILD_ID__} · {__BUILD_DATE__}
        </p>
      </footer>
    </div>
  );
}

/**
 * Hum a melody in.
 *
 * Tap record, a count-in plays over the beat, you sing, and what you sang
 * becomes this track's part. You never see a note name unless you ask for one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import * as Tone from 'tone';
import { useAppStore } from '../state/store';
import { TRACK_LABELS, type HumNote, type TrackId } from '../state/song';
import { MOODS, midiToName } from '../music/moods';
import {
  HumSession,
  MicrophoneDenied,
  framesToNotes,
  finaliseNotes,
  nudgeNote,
  type QuantiseGrid,
} from '../hum/capture';
import { ToggleButton } from './Controls';
import { InfoLabel } from './Tooltip';
import { Knob } from './Knob';

type Stage = 'idle' | 'arming' | 'countIn' | 'recording' | 'review' | 'error';

const GRID_OPTIONS: { value: QuantiseGrid; label: string }[] = [
  { value: 4, label: 'Quarter' },
  { value: 8, label: 'Eighth' },
  { value: 16, label: 'Sixteenth' },
  { value: 'off', label: 'Off' },
];

export function HumPanel({ trackId, onClose }: { trackId: TrackId; onClose: () => void }) {
  const song = useAppStore((state) => state.song);
  const setParam = useAppStore((state) => state.setParam);
  const showNoteNames = useAppStore((state) => state.showNoteNames);
  const toggleNoteNames = useAppStore((state) => state.toggleNoteNames);

  const [stage, setStage] = useState<Stage>('idle');
  const [message, setMessage] = useState('');
  const [countIn, setCountIn] = useState(0);
  const [bars, setBars] = useState(2);
  const [grid, setGrid] = useState<QuantiseGrid>(8);
  const [octaveShift, setOctaveShift] = useState(0);
  const [timingTrim, setTimingTrim] = useState(0);
  const [minNoteSteps, setMinNoteSteps] = useState(0.6);
  const [notes, setNotes] = useState<HumNote[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [quiet, setQuiet] = useState(false);
  const [level, setLevel] = useState(0);

  const session = useRef<HumSession | null>(null);
  const clicker = useRef<Tone.MembraneSynth | null>(null);
  const scheduled = useRef<number[]>([]);
  const captureStart = useRef({ contextTime: 0, step: 0 });

  const loopSteps = bars * 16;
  const mood = MOODS[song.mood];

  const cleanUp = useCallback(() => {
    for (const id of scheduled.current) Tone.getTransport().clear(id);
    scheduled.current = [];
    session.current?.close();
    session.current = null;
    clicker.current?.dispose();
    clicker.current = null;
  }, []);

  useEffect(() => cleanUp, [cleanUp]);

  const start = useCallback(async () => {
    setStage('arming');
    setMessage('');
    setNotes([]);
    setSelected(null);
    setQuiet(false);

    try {
      session.current = await HumSession.open();
    } catch (error) {
      console.error('Hum capture could not start', error);
      setStage('error');
      setMessage(
        error instanceof MicrophoneDenied
          ? error.message
          : `Listening could not start. ${error instanceof Error ? `${error.name}: ${error.message}` : ''}`,
      );
      return;
    }

    const transport = Tone.getTransport();
    if (transport.state !== 'started') transport.start();

    clicker.current = new Tone.MembraneSynth({
      pitchDecay: 0.01,
      octaves: 3,
      envelope: { attack: 0.001, decay: 0.09, sustain: 0 },
    }).toDestination();
    clicker.current.volume.value = -6;

    const ticksPerStep = transport.PPQ / 4;
    const now = Math.ceil(transport.ticks / ticksPerStep);
    // Begin on the next bar line so the count-in is in time with the music.
    const startStep = Math.ceil(now / 16) * 16 + 16;

    session.current.onFrame = (frame) => setLevel(frame.peak);
    setStage('countIn');

    for (let beat = 0; beat < 4; beat++) {
      // Scheduled in transport ticks rather than seconds, so a tempo change
      // mid count-in cannot pull the beats out of line.
      const at = Tone.Ticks((startStep + beat * 4) * ticksPerStep);
      scheduled.current.push(
        transport.scheduleOnce((time) => {
          clicker.current?.triggerAttackRelease(beat === 0 ? 'C4' : 'G3', 0.05, time);
          Tone.getDraw().schedule(() => setCountIn(4 - beat), time);
        }, at),
      );
    }

    const recordStep = startStep + 16;
    scheduled.current.push(
      transport.scheduleOnce((time) => {
        // This callback's time is the exact audio clock reading for the first
        // beat of the recording, which is what everything is measured from.
        captureStart.current = { contextTime: time, step: recordStep };
        session.current?.reset();
        Tone.getDraw().schedule(() => {
          setCountIn(0);
          setStage('recording');
        }, time);
      }, Tone.Ticks(recordStep * ticksPerStep)),
    );

    scheduled.current.push(
      transport.scheduleOnce((time) => {
        Tone.getDraw().schedule(() => finish(), time);
      }, Tone.Ticks((recordStep + loopSteps) * ticksPerStep)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopSteps]);

  const finish = useCallback(() => {
    const active = session.current;
    if (!active) return;
    const captured = framesToNotes(
      active.frames,
      { grid, octaveShift, timingTrim, minNoteSteps, mood, palette: song.palette, tempo: song.tempo, loopSteps },
      captureStart.current.contextTime,
      captureStart.current.step,
      active.estimatedLatency(),
    );
    setQuiet(active.loudestPeak < 0.04);
    setNotes(captured);
    setStage('review');
    cleanUp();
    if (captured.length === 0) {
      setMessage('Nothing was picked up. Sing louder and closer, and make sure the right microphone is selected.');
    } else {
      setMessage('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grid, octaveShift, timingTrim, minNoteSteps, mood, song.tempo, loopSteps, cleanUp]);

  /** Re-run the clean-up with the current settings, without singing again. */
  const reclean = (changes: Partial<{ grid: QuantiseGrid; octaveShift: number; minNoteSteps: number }>) => {
    const next = { grid, octaveShift, minNoteSteps, ...changes };
    setNotes((current) =>
      finaliseNotes(
        current.map((note) => ({ ...note, midi: note.midi - octaveShift * 12 })),
        { ...next, timingTrim, mood, palette: song.palette, tempo: song.tempo, loopSteps },
      ),
    );
  };

  const accept = () => {
    setParam(`tracks.${trackId}.pattern.notes`, notes);
    setParam(`tracks.${trackId}.pattern.source`, 'hum');
    setParam(`tracks.${trackId}.enabled`, true);
    onClose();
  };

  const cancel = () => {
    cleanUp();
    onClose();
  };

  return (
    <section className="panel hum-panel">
      <header className="panel-head hum-head">
        <InfoLabel
          text={`Hum into ${TRACK_LABELS[trackId]}`}
          tip="Sing or hum a line and the app writes it down for you. Whatever you sing is put in key automatically, so it cannot come out wrong."
          className="panel-title"
        />
        <button type="button" className="text-button" onClick={cancel}>Close</button>
      </header>

      <p className="warn-box">
        Use headphones. Your voice is not played back while recording, but a phone speaker
        playing the beat into its own microphone will confuse the pitch tracking.
      </p>

      {stage === 'idle' && (
        <>
          <div className="row">
            <div>
              <InfoLabel text="How long" tip="How many bars you get to sing before it stops on its own." />
              <div className="bars-buttons">
                {[1, 2, 4].map((option) => (
                  <ToggleButton key={option} on={bars === option} onClick={() => setBars(option)}>
                    {option} {option === 1 ? 'bar' : 'bars'}
                  </ToggleButton>
                ))}
              </div>
            </div>
            <div>
              <InfoLabel text="Tidy timing to" tip="Pulls each note onto the nearest beat of this size. Quarter is the most forgiving. Off still lands on the finest step the machine plays, which is a sixteenth." />
              <div className="bars-buttons">
                {GRID_OPTIONS.map((option) => (
                  <ToggleButton key={String(option.value)} on={grid === option.value} onClick={() => setGrid(option.value)}>
                    {option.label}
                  </ToggleButton>
                ))}
              </div>
            </div>
          </div>
          <button type="button" className="record-button" onClick={() => void start()}>
            Start recording
          </button>
          <p className="hint">A count-in of four plays first. Sing after it.</p>
        </>
      )}

      {stage === 'arming' && <p className="hint">Asking for the microphone.</p>}

      {stage === 'countIn' && (
        <div className="count-in">
          <span>{countIn || 4}</span>
          <p className="hint">Get ready.</p>
        </div>
      )}

      {stage === 'recording' && (
        <div className="recording">
          <div className="record-dot" />
          <p>Singing now.</p>
          <div className="level-meter"><div className="level-fill" style={{ width: `${Math.min(100, level * 260)}%` }} /></div>
          <button type="button" className="wide-button" onClick={finish}>Stop early</button>
        </div>
      )}

      {stage === 'error' && (
        <>
          <p className="warn-box">{message}</p>
          <button type="button" className="wide-button" onClick={() => setStage('idle')}>Try again</button>
        </>
      )}

      {stage === 'review' && (
        <>
          {quiet && <p className="warn-box">That was very quiet. It may be worth singing again closer to the microphone.</p>}
          {message && <p className="hint">{message}</p>}

          <NoteRoll
            notes={notes}
            loopSteps={loopSteps}
            selected={selected}
            onSelect={setSelected}
            showNames={showNoteNames}
          />

          <div className="button-row">
            <button type="button" className="wide-button" disabled={selected === null} onClick={() => {
              if (selected === null) return;
              setNotes((current) => current.map((note, index) => (index === selected ? nudgeNote(note, mood, song.palette, 1) : note)));
            }}>Note up</button>
            <button type="button" className="wide-button" disabled={selected === null} onClick={() => {
              if (selected === null) return;
              setNotes((current) => current.map((note, index) => (index === selected ? nudgeNote(note, mood, song.palette, -1) : note)));
            }}>Note down</button>
            <button type="button" className="wide-button" disabled={selected === null} onClick={() => {
              if (selected === null) return;
              setNotes((current) => current.filter((_, index) => index !== selected));
              setSelected(null);
            }}>Delete note</button>
            <ToggleButton on={showNoteNames} onClick={toggleNoteNames}>Show note names</ToggleButton>
          </div>

          <div className="knob-row">
            <Knob label="Octave" tip="Moves the whole melody up or down. Down for a bass line, up for a lead." value={octaveShift} min={-2} max={2} defaultValue={0} onChange={(value) => { const next = Math.round(value); setOctaveShift(next); reclean({ octaveShift: next }); }} format={(value) => (Math.round(value) === 0 ? 'As sung' : `${Math.round(value) > 0 ? '+' : ''}${Math.round(value)}`)} />
            <Knob label="Ignore slips" tip="Throws away notes shorter than this. Turn it up if breaths and stumbles got written down as notes." value={minNoteSteps} min={0} max={3} defaultValue={0.6} onChange={(value) => { setMinNoteSteps(value); reclean({ minNoteSteps: value }); }} format={(value) => `${value.toFixed(1)} steps`} />
            <Knob label="Timing trim" tip="Nudges every note earlier or later. Use it if the whole line feels late against the beat." value={timingTrim} min={-200} max={200} defaultValue={0} onChange={setTimingTrim} format={(value) => `${Math.round(value)} ms`} />
          </div>

          <div className="button-row">
            <button type="button" className="record-button" onClick={accept} disabled={notes.length === 0}>
              Use this melody
            </button>
            <button type="button" className="wide-button" onClick={() => setStage('idle')}>Sing it again</button>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * The note view.
 *
 * Deliberately not a piano roll with a keyboard down the side. Bars at
 * different heights say everything you need: higher is higher. Note names only
 * appear if you ask for them.
 */
function NoteRoll({
  notes,
  loopSteps,
  selected,
  onSelect,
  showNames,
}: {
  notes: HumNote[];
  loopSteps: number;
  selected: number | null;
  onSelect: (index: number | null) => void;
  showNames: boolean;
}) {
  if (notes.length === 0) {
    return <div className="note-roll is-empty">Nothing heard yet.</div>;
  }
  const lowest = Math.min(...notes.map((note) => note.midi));
  const highest = Math.max(...notes.map((note) => note.midi));
  const span = Math.max(7, highest - lowest);
  const rows = span + 2;

  return (
    <div className="note-roll" onClick={() => onSelect(null)}>
      {Array.from({ length: loopSteps / 4 }, (_, index) => (
        <div key={`beat-${index}`} className="roll-beat" style={{ left: `${((index * 4) / loopSteps) * 100}%` }} />
      ))}
      {notes.map((note, index) => {
        const row = rows - 1 - (note.midi - lowest + 1);
        return (
          <button
            type="button"
            key={`${note.step}-${index}`}
            className={`roll-note ${selected === index ? 'is-selected' : ''}`}
            style={{
              left: `${(note.step / loopSteps) * 100}%`,
              width: `${Math.max(1.6, (note.length / loopSteps) * 100)}%`,
              top: `${(row / rows) * 100}%`,
              height: `${(1 / rows) * 100}%`,
            }}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(selected === index ? null : index);
            }}
          >
            {showNames && <span>{midiToName(note.midi)}</span>}
          </button>
        );
      })}
    </div>
  );
}

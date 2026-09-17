/**
 * Harmony, Master, Shift and the transport bar.
 */

import { useRef, useState } from 'react';
import { useAppStore, currentShiftBlend } from '../state/store';
import { MOOD_LIST } from '../music/moods';
import { PROGRESSIONS } from '../music/progressions';
import { SHIFT_MODES } from '../shift/modes';
import type { ShiftModeId } from '../state/song';
import { Knob } from './Knob';
import { BigButton, Picker, ToggleButton } from './Controls';
import { InfoLabel } from './Tooltip';

// ---------------------------------------------------------------------------
// Harmony
// ---------------------------------------------------------------------------

export function HarmonyPanel() {
  const mood = useAppStore((state) => state.song.mood);
  const progression = useAppStore((state) => state.song.progression);
  const setParam = useAppStore((state) => state.setParam);

  return (
    <section className="panel">
      <header className="panel-head">
        <InfoLabel text="Feeling" tip="Sets the emotional colour of every melodic track at once. Everything that plays notes is forced to fit, so nothing can land on a wrong note." className="panel-title" />
      </header>
      <div className="mood-row">
        {MOOD_LIST.map((option) => (
          <button
            type="button"
            key={option.id}
            className={`mood ${mood === option.id ? 'is-on' : ''}`}
            onClick={() => setParam('mood', option.id)}
            title={option.tooltip}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="hint">{MOOD_LIST.find((option) => option.id === mood)?.tooltip}</p>
      <Picker
        label="Chord movement"
        tip="How the chords travel over a few bars. Pick by listening rather than by name."
        value={progression}
        onChange={(value) => setParam('progression', value)}
        options={PROGRESSIONS.map((option) => ({ value: option.id, label: option.label, tip: option.tooltip }))}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Master
// ---------------------------------------------------------------------------

export function MasterPanel() {
  const master = useAppStore((state) => state.song.master);
  const swing = useAppStore((state) => state.song.swing);
  const setParam = useAppStore((state) => state.setParam);
  const set = (key: string, value: number) => setParam(`master.${key}`, value);

  return (
    <section className="panel">
      <header className="panel-head">
        <InfoLabel text="Master" tip="Controls that affect the whole track at once. These are the knobs to perform with." className="panel-title" />
      </header>
      <div className="knob-row">
        <Knob label="Pump" tip="How hard everything ducks under the kick. This breathing is the single most recognisable thing about this style of music." value={master.pump} defaultValue={0.55} onChange={(value) => set('pump', value)} size={78} accent="var(--pump)" />
        <Knob label="Pump speed" tip="How quickly the sound recovers after each kick. Left is a fast tight snap, right is a long slow swell." value={master.pumpRelease} defaultValue={0.65} onChange={(value) => set('pumpRelease', value)} accent="var(--pump)" />
        <Knob label="Sweep down" tip="Closes the whole mix down. Turn it left through a build and open it again on the drop." value={master.lowpass} defaultValue={1} onChange={(value) => set('lowpass', value)} size={78} />
        <Knob label="Sweep up" tip="Removes the low end. Turning it right thins everything out and makes the return of the bass hit harder." value={master.highpass} defaultValue={0} onChange={(value) => set('highpass', value)} />
      </div>
      <div className="knob-row">
        <Knob label="Drive" tip="Pushes the mix into distortion. A little glues it together, a lot makes it dirty." value={master.drive} defaultValue={0.2} onChange={(value) => set('drive', value)} />
        <Knob label="Room size" tip="How big the space around the music sounds. Right is a cathedral." value={master.reverbSize} defaultValue={0.35} onChange={(value) => set('reverbSize', value)} />
        <Knob label="Echo time" tip="How far apart the repeats are, always locked to the tempo so they stay in time." value={master.delayTime} min={0.125} max={2} defaultValue={0.75} onChange={(value) => set('delayTime', value)} format={(value) => `${value.toFixed(2)} beats`} />
        <Knob label="Echo feed" tip="How many times each repeat comes back before it dies away." value={master.delayFeedback} defaultValue={0.3} onChange={(value) => set('delayFeedback', value)} />
        <Knob label="Swing" tip="Pushes every other sixteenth note late, which makes a stiff machine pattern feel human." value={swing} defaultValue={0} onChange={(value) => setParam('swing', value)} />
        <Knob label="Volume" tip="Overall output level." value={master.volume} defaultValue={0.85} onChange={(value) => set('volume', value)} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Shift
// ---------------------------------------------------------------------------

export function ShiftPanel() {
  const selectedMode = useAppStore((state) => state.song.shift.selectedMode);
  const transitionBars = useAppStore((state) => state.song.shift.transitionBars);
  const shift = useAppStore((state) => state.shift);
  const position = useAppStore((state) => state.position);
  const setParam = useAppStore((state) => state.setParam);
  const startShift = useAppStore((state) => state.startShift);
  const returnFromShift = useAppStore((state) => state.returnFromShift);

  const blend = currentShiftBlend(shift, position);
  const away = blend > 0.001;
  const moving = shift ? Math.abs(blend - shift.to) > 0.001 : false;
  const mode = SHIFT_MODES.find((option) => option.id === selectedMode);

  return (
    <section className="panel shift-panel">
      <header className="panel-head">
        <InfoLabel text="Shift" tip="Turns everything you have built into an emotionally opposite version of the same material, so you can score two different feelings on one beat." className="panel-title" />
      </header>

      <div className="shift-modes">
        {SHIFT_MODES.map((option) => (
          <button
            type="button"
            key={option.id}
            className={`shift-mode ${selectedMode === option.id ? 'is-on' : ''}`}
            onClick={() => setParam('shift.selectedMode', option.id as ShiftModeId)}
            title={option.tooltip}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="hint">{mode?.tooltip}</p>

      <div className="shift-actions">
        <BigButton tone="shift" onClick={() => startShift(selectedMode)}>
          Shift
        </BigButton>
        <BigButton tone="return" onClick={returnFromShift} disabled={!shift}>
          Return
        </BigButton>
      </div>

      <div className="shift-meter" aria-hidden="true">
        <div className="shift-meter-fill" style={{ width: `${blend * 100}%` }} />
      </div>
      <p className="shift-state">
        {moving ? 'Moving' : away ? `Holding in ${mode?.label}` : 'At the original'}
      </p>

      <div className="bars-row">
        <InfoLabel text="Transition length" tip="How many bars the change takes. Longer feels like a scene turning, shorter feels like a cut." />
        <div className="bars-buttons">
          {[1, 2, 4, 8].map((bars) => (
            <ToggleButton key={bars} on={transitionBars === bars} onClick={() => setParam('shift.transitionBars', bars)}>
              {bars} {bars === 1 ? 'bar' : 'bars'}
            </ToggleButton>
          ))}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

export function TransportBar({ onPlay, onStop }: { onPlay: () => void; onStop: () => void }) {
  const playing = useAppStore((state) => state.playing);
  const tempo = useAppStore((state) => state.song.tempo);
  const setParam = useAppStore((state) => state.setParam);
  const taps = useRef<number[]>([]);
  const [tapHint, setTapHint] = useState('Tap tempo');

  const tap = () => {
    const now = performance.now();
    // Forget the previous run if you stopped tapping for a couple of seconds.
    if (taps.current.length && now - taps.current[taps.current.length - 1] > 2000) taps.current = [];
    taps.current.push(now);
    if (taps.current.length > 5) taps.current.shift();
    if (taps.current.length < 2) {
      setTapHint('Keep tapping');
      return;
    }
    const gaps = taps.current.slice(1).map((value, index) => value - taps.current[index]);
    const average = gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
    const bpm = Math.max(50, Math.min(200, Math.round(60000 / average)));
    setParam('tempo', bpm);
    setTapHint(`${bpm} BPM`);
  };

  return (
    <div className="transport">
      <BigButton tone="play" onClick={playing ? onStop : onPlay}>
        {playing ? 'Stop' : 'Play'}
      </BigButton>
      <Knob
        label="Tempo"
        tip="How fast the song runs, in beats per minute."
        value={tempo}
        min={60}
        max={190}
        defaultValue={120}
        onChange={(value) => setParam('tempo', Math.round(value))}
        format={(value) => `${Math.round(value)} BPM`}
        size={70}
      />
      <button type="button" className="tap-button" onClick={tap}>
        {tapHint}
      </button>
    </div>
  );
}

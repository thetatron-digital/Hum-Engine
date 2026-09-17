/**
 * One track at a time.
 *
 * A phone has no room for ten channel strips side by side, so you pick a track
 * from the row of chips and get its full set of controls underneath. The chips
 * show at a glance which tracks are on.
 */

import { useAppStore } from '../state/store';
import { TRACK_LABELS, TRACK_ORDER, TRACK_ROLE, isMelodic, type TrackId } from '../state/song';
import { getPattern, patternsForRole } from '../music/patterns';
import { riffsForRole } from '../music/riffs';
import { voicesForRole, getVoice } from '../audio/voiceCatalog';
import { useState } from 'react';
import { Knob, percent } from './Knob';
import { HumPanel } from './HumPanel';
import { ClipControls, VocalControls } from './ClipPanel';
import { Picker, StepGrid, ToggleButton } from './Controls';
import { InfoLabel } from './Tooltip';

export const TRACK_ACCENTS: Record<TrackId, string> = {
  kick: '#ff5c4d',
  snare: '#ff9f43',
  hats: '#ffd93d',
  bass: '#4dd0a7',
  chords: '#4db5ff',
  lead: '#a97bff',
  pad: '#6f7dff',
  vocal: '#ff6fae',
  chop: '#3fd6d6',
  fx: '#9aa4b2',
};

export function TrackChips() {
  const tracks = useAppStore((state) => state.song.tracks);
  const selected = useAppStore((state) => state.selectedTrack);
  const selectTrack = useAppStore((state) => state.selectTrack);
  const setParam = useAppStore((state) => state.setParam);

  return (
    <div className="chips" role="tablist" aria-label="Tracks">
      {TRACK_ORDER.map((id) => {
        const track = tracks[id];
        const live = track.enabled && !track.muted;
        return (
          <button
            type="button"
            key={id}
            role="tab"
            aria-selected={selected === id}
            className={`chip ${selected === id ? 'is-selected' : ''} ${live ? 'is-live' : ''}`}
            style={{ ['--chip' as string]: TRACK_ACCENTS[id] }}
            onClick={() => {
              // Tapping the track you are already on toggles it on or off, so
              // muting something in a performance is one tap, not two.
              if (selected === id) setParam(`tracks.${id}.enabled`, !track.enabled);
              else selectTrack(id);
            }}
          >
            <span className="chip-dot" />
            {TRACK_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}

export function TrackDetail() {
  const [humming, setHumming] = useState(false);
  const id = useAppStore((state) => state.selectedTrack);
  const track = useAppStore((state) => state.song.tracks[id]);
  const setParam = useAppStore((state) => state.setParam);
  const accent = TRACK_ACCENTS[id];
  const role = TRACK_ROLE[id];
  const melodic = isMelodic(id);
  const voice = getVoice(track.voice, role);
  const usingGrid = track.pattern.source === 'grid' && track.pattern.steps.length > 0;
  const gridSteps = usingGrid
    ? track.pattern.steps
    : getPattern(track.pattern.libraryId, role).steps;

  const set = (key: string, value: number | string | boolean) => setParam(`tracks.${id}.${key}`, value);

  const toggleStep = (index: number) => {
    const next = gridSteps.slice();
    next[index] = next[index] > 0 ? 0 : 1;
    setParam(`tracks.${id}.pattern.steps`, next);
    setParam(`tracks.${id}.pattern.source`, 'grid');
  };

  if (humming && melodic) {
    return <HumPanel trackId={id} onClose={() => setHumming(false)} />;
  }

  return (
    <section className="panel track-detail" style={{ borderTopColor: accent }}>
      <header className="track-head">
        <h2 style={{ color: accent }}>{TRACK_LABELS[id]}</h2>
        <div className="track-switches">
          <ToggleButton on={track.enabled} onClick={() => set('enabled', !track.enabled)} title="Turn this track on or off">
            {track.enabled ? 'On' : 'Off'}
          </ToggleButton>
          <ToggleButton on={track.muted} tone="warn" onClick={() => set('muted', !track.muted)} title="Silence this track without turning it off">
            Mute
          </ToggleButton>
          <ToggleButton on={track.solo} tone="good" onClick={() => set('solo', !track.solo)} title="Hear only the tracks that are soloed">
            Solo
          </ToggleButton>
        </div>
      </header>

      <div className="row">
        <Picker
          label="Voice"
          tip="The instrument or drum sound this track plays."
          value={track.voice}
          onChange={(value) => set('voice', value)}
          options={voicesForRole(role).map((option) => ({ value: option.id, label: option.label, tip: option.tooltip }))}
        />
        <Picker
          label="Pattern"
          tip="A ready-made rhythm. Tapping squares below writes your own instead."
          value={usingGrid ? '__custom' : track.pattern.libraryId}
          onChange={(value) => {
            setParam(`tracks.${id}.pattern.libraryId`, value);
            setParam(`tracks.${id}.pattern.source`, 'library');
          }}
          options={[
            ...patternsForRole(role).map((option) => ({ value: option.id, label: option.label, tip: option.tooltip })),
            ...(usingGrid ? [{ value: '__custom', label: 'My own pattern', tip: 'The squares you tapped in below.' }] : []),
          ]}
        />
      </div>

      {id === 'vocal' && <VocalControls />}
      {id === 'chop' && <ClipControls />}

      {melodic && (
        <button type="button" className="hum-button" onClick={() => setHumming(true)}>
          Hum a melody into this track
        </button>
      )}

      {(id === 'bass' || id === 'lead') && (
        <div className="row">
          <Picker
            label="Melody shape"
            tip="The shape the line moves in: up, down, jumping about, or sitting still. This is what makes two songs with the same rhythm sound like different pieces of music."
            value={track.riff}
            onChange={(value) => set('riff', value)}
            options={riffsForRole(role).map((option) => ({ value: option.id, label: option.label, tip: option.tooltip }))}
          />
        </div>
      )}

      <div className="grid-block">
        <div className="grid-head">
          <InfoLabel text="Steps" tip="Each square is a sixteenth of a bar. Tap to add or remove a hit. The taller marks are the four main beats." />
          {usingGrid && (
            <button type="button" className="text-button" onClick={() => setParam(`tracks.${id}.pattern.source`, 'library')}>
              Back to the ready-made pattern
            </button>
          )}
        </div>
        <StepGrid steps={gridSteps} onToggle={toggleStep} accent={accent} />
        {track.pattern.source === 'hum' && (
          <p className="hint">This track is playing a melody you hummed in. Tapping a square switches back to a rhythm.</p>
        )}
      </div>

      <div className="knob-row">
        <Knob label="Density" tip="Adds or removes hits for you. Left thins the pattern out, right fills the gaps." value={track.density} defaultValue={0.5} onChange={(value) => set('density', value)} accent={accent} />
        <Knob label="Chaos" tip="Lets the pattern vary itself each bar, but only in ways that still fit the groove." value={track.chaos} defaultValue={0} onChange={(value) => set('chaos', value)} accent={accent} />
        <Knob label="Tone" tip="Closes the sound down when turned left and opens it up when turned right. The main way this music builds and releases." value={track.cutoff} defaultValue={0.8} onChange={(value) => set('cutoff', value)} accent={accent} />
        <Knob label="Bite" tip="Emphasises the exact frequency the Tone knob is set to. A little adds edge, a lot makes it whistle and squelch." value={track.resonance} defaultValue={0.15} onChange={(value) => set('resonance', value)} accent={accent} />
        <Knob label="Snap" tip="How far the Tone opens on each hit before falling back. This is what makes a bass line squelch." value={track.envAmount} defaultValue={0.2} onChange={(value) => set('envAmount', value)} accent={accent} />
        <Knob label="Pump" tip="How hard this track ducks under every kick. The master Pump knob scales all of these at once." value={track.pumpAmount} defaultValue={0} onChange={(value) => set('pumpAmount', value)} accent={accent} />
      </div>

      <div className="knob-row">
        <Knob label="Reverb" tip="How much of this track is sent into the room. More makes it sound further away." value={track.reverbSend} defaultValue={0.1} onChange={(value) => set('reverbSend', value)} accent={accent} />
        <Knob label="Echo" tip="How much of this track repeats. The repeats stay in time with the tempo." value={track.delaySend} defaultValue={0} onChange={(value) => set('delaySend', value)} accent={accent} />
        <Knob label="Level" tip="How loud this track is." value={track.volume} defaultValue={0.8} onChange={(value) => set('volume', value)} accent={accent} />
        <Knob label="Position" tip="Moves the track left or right between the speakers." value={track.pan} min={-1} max={1} defaultValue={0} onChange={(value) => set('pan', value)} format={(value) => (Math.abs(value) < 0.05 ? 'Centre' : `${value < 0 ? 'Left' : 'Right'} ${Math.round(Math.abs(value) * 100)}`)} accent={accent} />
        {melodic && (
          <Knob label="Octave" tip="Moves the whole track up or down in big steps. Down for weight, up for brightness." value={track.octave} min={-2} max={2} defaultValue={0} onChange={(value) => set('octave', Math.round(value))} format={(value) => (Math.round(value) === 0 ? 'Normal' : `${Math.round(value) > 0 ? '+' : ''}${Math.round(value)}`)} accent={accent} />
        )}
        {melodic && (
          <Knob label="Motion" tip="How much the line wanders around the chord instead of repeating. Keeps a long loop alive." value={track.motion} defaultValue={0} onChange={(value) => set('motion', value)} accent={accent} />
        )}
        {['bass', 'chords', 'lead', 'pad', 'vocal'].includes(id) && (
          <Knob label="Swirl" tip="Sweeping notch filters that make the sound seem to move past you. The classic phased lead." value={track.phase} defaultValue={0} onChange={(value) => set('phase', value)} accent={accent} />
        )}
        {voice.kind === 'tear' && (
          <Knob label="Sync Amount" tip="How violently the two oscillators fight each other. Right is the screaming, tearing sound." value={track.syncAmount} defaultValue={0.3} onChange={(value) => set('syncAmount', value)} accent={accent} />
        )}
      </div>

      <p className="voice-note">{voice.tooltip}</p>
      <p className="value-note">Density {percent(track.density)} · Chaos {percent(track.chaos)} · Tone {percent(track.cutoff)}</p>
    </section>
  );
}

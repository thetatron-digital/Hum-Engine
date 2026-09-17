/**
 * Getting audio out.
 *
 * Three things come out of here: a full mix, the same thing split into one
 * file per track, and the song file itself. The mix can be either the song as
 * the knobs sit right now, or a performance you recorded, complete with your
 * Shift presses and knob moves played back exactly as you did them.
 */

import { useState } from 'react';
import { useAppStore, renderSong, exportSongJson } from '../state/store';
import { getEngine } from '../audio/engine';
import { renderToBuffers, SilentRenderError } from '../export/render';
import { makePerformancePlayer, performanceBars } from '../export/performance';
import { encodeWav, downloadBlob, safeFilename, TARGET_SAMPLE_RATE } from '../export/wav';
import { ToggleButton } from './Controls';
import { InfoLabel } from './Tooltip';

const BAR_CHOICES = [4, 8, 16, 32, 64];

export function ExportPanel() {
  const song = useAppStore((state) => state.song);
  const recording = useAppStore((state) => state.recording);
  const performance = useAppStore((state) => state.performance);
  const recordBaseSong = useAppStore((state) => state.recordBaseSong);
  const startRecording = useAppStore((state) => state.startRecording);
  const stopRecording = useAppStore((state) => state.stopRecording);
  const clearPerformance = useAppStore((state) => state.clearPerformance);

  const [bars, setBars] = useState(16);
  const [usePerformance, setUsePerformance] = useState(false);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');

  const capturedBars = performanceBars(performance);
  const hasPerformance = Boolean(recordBaseSong) && performance.length > 0;

  const run = async (withStems: boolean) => {
    setBusy(withStems ? 'Rendering the mix and every track' : 'Rendering the mix');
    setStatus('');
    try {
      const playingPerformance = usePerformance && hasPerformance && recordBaseSong;
      const songAt = playingPerformance
        ? makePerformancePlayer(recordBaseSong, performance)
        : (step: number) => renderSong(song, null, step);
      const length = playingPerformance ? Math.max(4, capturedBars) : bars;

      const result = await renderToBuffers({
        songAt,
        bars: length,
        tempo: playingPerformance ? recordBaseSong.tempo : song.tempo,
        clipKey: getEngine()?.clipKey ?? null,
        withStems,
      });

      const stem = safeFilename(song.name);
      downloadBlob(
        encodeWav(result.mix.left, result.mix.right, result.sampleRate),
        `${stem}-mix.wav`,
      );

      for (const track of result.stems) {
        downloadBlob(
          encodeWav(track.take.left, track.take.right, result.sampleRate),
          `${stem}-${safeFilename(track.label)}.wav`,
        );
      }

      const rate = result.sampleRate === TARGET_SAMPLE_RATE ? '' : ' Resampled to 48 kHz on the way out.';
      setStatus(
        withStems
          ? `Done. One mix and ${result.stems.length} separate tracks, all the same length.${rate}`
          : `Done. ${length} bars.${rate}`,
      );
    } catch (error) {
      // Surfaced to the console as well, because the message shown to you is
      // deliberately plain and the underlying one is what a developer needs.
      console.error('Render failed', error);
      setStatus(
        error instanceof SilentRenderError
          ? error.message
          : `The render failed. ${error instanceof Error ? error.message : ''} If this keeps happening, reload the page and try again.`,
      );
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="panel">
      <header className="panel-head">
        <InfoLabel text="Export" tip="Turns what you are hearing into files you can drop into a video editor." className="panel-title" />
      </header>

      <div className="bars-row">
        <InfoLabel text="How many bars" tip="How much music to render. Longer takes longer, but it is still much faster than playing it." />
        <div className="bars-buttons">
          {BAR_CHOICES.map((count) => (
            <ToggleButton key={count} on={bars === count && !usePerformance} onClick={() => { setBars(count); setUsePerformance(false); }}>
              {count}
            </ToggleButton>
          ))}
        </div>
      </div>

      <div className="sub-panel">
        <InfoLabel
          text="Record a performance"
          tip="Captures your Shift presses and knob moves against the clock, so the exported file has the arc you played rather than one fixed setting."
          className="panel-title"
        />
        <div className="button-row">
          <ToggleButton on={recording} tone="warn" onClick={recording ? stopRecording : startRecording}>
            {recording ? 'Stop capturing' : 'Start capturing'}
          </ToggleButton>
          {hasPerformance && !recording && (
            <>
              <ToggleButton on={usePerformance} onClick={() => setUsePerformance(!usePerformance)}>
                Export the performance
              </ToggleButton>
              <button type="button" className="wide-button" onClick={() => { clearPerformance(); setUsePerformance(false); }}>
                Discard it
              </button>
            </>
          )}
        </div>
        <p className="hint">
          {recording
            ? `Capturing. ${performance.length} moves so far. Play the track and perform it.`
            : hasPerformance
              ? `${performance.length} moves captured, ${capturedBars} bars long.`
              : 'Nothing captured yet.'}
        </p>
      </div>

      <div className="button-row">
        <button type="button" className="wide-button" disabled={Boolean(busy)} onClick={() => void run(false)}>
          Export the mix
        </button>
        <button type="button" className="wide-button" disabled={Boolean(busy)} onClick={() => void run(true)}>
          Export the mix and every track
        </button>
        <button
          type="button"
          className="wide-button"
          onClick={() => downloadBlob(new Blob([exportSongJson(song)], { type: 'application/json' }), `${safeFilename(song.name)}.json`)}
        >
          Export the song file
        </button>
      </div>

      {busy && <p className="hint">{busy}. This can take a few seconds.</p>}
      {status && <p className="hint">{status}</p>}

      <p className="hint">
        Files are 48 kHz, 16 bit stereo. The separate tracks are taken before the master drive,
        sweeps and compression, so they add back up to the mix but each one on its own will sound
        a little rawer than the full mix does.
      </p>
    </section>
  );
}

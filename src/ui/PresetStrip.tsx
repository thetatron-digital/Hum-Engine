/**
 * The starting songs, within reach.
 *
 * The idea is that you open the app, tap a name, and something good is already
 * playing before you have touched a single control. That only works if the
 * names are near the top of a phone screen rather than at the bottom of a long
 * page, so they get their own scrolling row here as well as the fuller panel
 * further down.
 */

import { useAppStore } from '../state/store';
import { PRESET_LIST, loadPreset } from '../state/presets';
import { listUserPresets } from '../state/userPresets';

export function PresetStrip() {
  const setSong = useAppStore((state) => state.setSong);
  const current = useAppStore((state) => state.song.name);
  const mine = listUserPresets();

  return (
    <div className="strip">
      <span className="strip-label">Start from</span>
      <div className="strip-scroll">
        {mine.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className={`strip-item is-mine ${current === preset.name ? 'is-on' : ''}`}
            onClick={() => setSong(preset.song)}
          >
            {preset.name}
          </button>
        ))}
        {PRESET_LIST.map((preset) => (
          <button
            type="button"
            key={preset.id}
            className={`strip-item ${current === preset.name ? 'is-on' : ''}`}
            onClick={() => setSong(loadPreset(preset.id))}
            title={preset.blurb}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  );
}

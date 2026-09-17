/**
 * The small shared controls: dropdowns, on/off buttons and the step grid.
 *
 * Dropdowns are plain native selects on purpose. On a phone that gives you the
 * system picker, which has bigger targets and works better than anything
 * custom.
 */

import { InfoLabel } from './Tooltip';

export interface Option {
  value: string;
  label: string;
  tip?: string;
}

export function Picker({
  label,
  tip,
  value,
  options,
  onChange,
}: {
  label: string;
  tip: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
}) {
  const current = options.find((option) => option.value === value);
  return (
    <div className="picker">
      <InfoLabel text={label} tip={tip} className="picker-label" />
      <select className="picker-select" value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {current?.tip && <p className="picker-tip">{current.tip}</p>}
    </div>
  );
}

export function ToggleButton({
  on,
  onClick,
  children,
  tone = 'default',
  title,
}: {
  on: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: 'default' | 'warn' | 'good';
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`toggle toggle-${tone} ${on ? 'is-on' : ''}`}
      onClick={onClick}
      aria-pressed={on}
      title={title}
    >
      {children}
    </button>
  );
}

/**
 * The tap-in grid.
 *
 * Sixteen or thirty two squares, one per sixteenth note. Every fourth square
 * is marked so you can see where the beats are without counting.
 */
export function StepGrid({
  steps,
  onToggle,
  playhead,
  accent,
}: {
  steps: number[];
  onToggle: (index: number) => void;
  playhead?: number;
  accent?: string;
}) {
  return (
    <div className="step-grid" style={{ ['--steps' as string]: steps.length }}>
      {steps.map((velocity, index) => (
        <button
          type="button"
          key={index}
          className={[
            'step',
            velocity > 0 ? 'is-on' : '',
            velocity > 0 && velocity < 0.5 ? 'is-ghost' : '',
            index % 4 === 0 ? 'is-beat' : '',
            playhead === index ? 'is-playing' : '',
          ].join(' ')}
          style={velocity > 0 && accent ? { background: accent, opacity: 0.35 + velocity * 0.65 } : undefined}
          onClick={() => onToggle(index)}
          aria-label={`Step ${index + 1}${velocity > 0 ? ', on' : ', off'}`}
        />
      ))}
    </div>
  );
}

export function BigButton({
  children,
  onClick,
  tone = 'default',
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'shift' | 'return' | 'play';
  disabled?: boolean;
}) {
  return (
    <button type="button" className={`big-button big-${tone}`} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

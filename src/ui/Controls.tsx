/**
 * The small shared controls: choosers, on/off buttons and the step grid.
 *
 * Choosers used to be native dropdowns. On a phone that turns into a spinning
 * wheel of bare names with nowhere to put a description, so picking a sound
 * meant guessing from its label and then listening. This opens a sheet from
 * the bottom of the screen instead: big rows, the explanation of each option
 * next to it, and a target you can hit with a thumb.
 */

import { useEffect, useState } from 'react';
import { InfoLabel } from './Tooltip';

export interface Option {
  value: string;
  label: string;
  tip?: string;
  /** Groups rows under a heading, for long lists like the voices. */
  group?: string;
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
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);

  // While the sheet is up the page behind it must not scroll, or a flick
  // meant for the list drags the whole app around underneath.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Group headings are worked out up front rather than tracked while the rows
  // render, so nothing is being mutated part way through a render pass.
  const rows = options.map((option, index) => ({
    option,
    heading: option.group && option.group !== options[index - 1]?.group ? option.group : null,
  }));

  return (
    <div className="picker">
      <InfoLabel text={label} tip={tip} className="picker-label" />
      <button type="button" className="picker-trigger" onClick={() => setOpen(true)}>
        <span className="picker-current">{current?.label ?? 'Choose'}</span>
        <span className="picker-chevron" aria-hidden="true" />
      </button>
      {current?.tip && <p className="picker-tip">{current.tip}</p>}

      {open && (
        <div className="sheet-backdrop" onClick={() => setOpen(false)}>
          <div
            className="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={label}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="sheet-head">
              <h3>{label}</h3>
              <button type="button" className="sheet-close" onClick={() => setOpen(false)}>
                Close
              </button>
            </header>
            <div className="sheet-list">
              {rows.map(({ option, heading }) => (
                <div key={option.value}>
                  {heading && <p className="sheet-group">{heading}</p>}
                  <button
                    type="button"
                    className={`sheet-row ${option.value === value ? 'is-on' : ''}`}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    <span className="sheet-row-main">
                      <strong>{option.label}</strong>
                      {option.tip && <span>{option.tip}</span>}
                    </span>
                    {option.value === value && <span className="sheet-tick" aria-hidden="true">✓</span>}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
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

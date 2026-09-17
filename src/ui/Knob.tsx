/**
 * A knob with two ways in, because one way is not enough.
 *
 * Dragging the dial works where dragging works. But a dial is a terrible
 * primary control on a phone: the target is small, the gesture competes with
 * the page scrolling, and the pointer event handling that makes it work is
 * exactly the part browsers disagree about. Reports of knobs simply not
 * responding to touch are hard to reproduce and impossible to design around.
 *
 * So a plain tap opens a sheet with a real slider in it. That is a native
 * range input, which every phone has spent years getting right, and it cannot
 * be broken by a disagreement about pointer capture. Drag remains for anyone
 * who prefers it, and the two are told apart by whether the finger moved.
 *
 * Two deliberate choices in the drag handling, both learned the hard way:
 *
 *  - No `setPointerCapture`. It is the usual way to keep receiving events
 *    after the finger leaves the element, and it is also a long-standing
 *    source of trouble in WebKit. Listening on the window achieves the same
 *    thing with nothing to go wrong.
 *  - Listeners are attached the instant the press happens rather than after a
 *    render, and the drag state lives in a ref. Waiting for React to re-render
 *    before listening loses the beginning of a fast flick.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { InfoLabel } from './Tooltip';

interface KnobProps {
  label: string;
  tip: string;
  value: number;
  onChange: (value: number) => void;
  /** Where the reset button in the sheet sends it. */
  defaultValue?: number;
  min?: number;
  max?: number;
  /** Turns the raw number into something readable, like "62%" or "124 BPM". */
  format?: (value: number) => string;
  size?: number;
  accent?: string;
  disabled?: boolean;
}

const ARC_START = -135;
const ARC_SWEEP = 270;
/** Movement beyond this counts as a drag rather than a tap. */
const DRAG_THRESHOLD = 6;

function polar(cx: number, cy: number, radius: number, degrees: number) {
  const radians = ((degrees - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

function arcPath(cx: number, cy: number, radius: number, fromDeg: number, toDeg: number): string {
  const start = polar(cx, cy, radius, fromDeg);
  const end = polar(cx, cy, radius, toDeg);
  const large = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${large} 1 ${end.x} ${end.y}`;
}

export function Knob({
  label,
  tip,
  value,
  onChange,
  defaultValue,
  min = 0,
  max = 1,
  format,
  size = 62,
  accent = 'var(--accent)',
  disabled = false,
}: KnobProps) {
  const [dragging, setDragging] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const drag = useRef<{ x: number; y: number; from: number; moved: boolean } | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const span = max - min;
  const normalised = Math.max(0, Math.min(1, (value - min) / span));
  const show = format ?? ((current: number) => `${Math.round(((current - min) / span) * 100)}%`);

  const move = useCallback(
    (x: number, y: number) => {
      const active = drag.current;
      if (!active) return;
      const dx = x - active.x;
      const dy = active.y - y;
      if (!active.moved && Math.abs(dx) + Math.abs(dy) < DRAG_THRESHOLD) return;
      active.moved = true;
      // Up or right increases. The further sideways you stray, the finer the
      // movement, so you can set something roughly and then refine it without
      // lifting your finger.
      const precision = 1 / (1 + Math.abs(dx) / 90);
      const next = active.from + ((dy + dx) / 180) * span * precision;
      onChange(Math.max(min, Math.min(max, next)));
    },
    [max, min, onChange, span],
  );

  const end = useCallback(() => {
    const active = drag.current;
    drag.current = null;
    detach.current?.();
    detach.current = null;
    setDragging(false);
    // A press that never moved is a tap, and a tap asks for the slider.
    if (active && !active.moved) setSheetOpen(true);
  }, []);

  const begin = useCallback(
    (x: number, y: number) => {
      if (disabled || drag.current) return;
      drag.current = { x, y, from: value, moved: false };
      setDragging(true);

      const onPointerMove = (event: PointerEvent) => move(event.clientX, event.clientY);
      const onTouchMove = (event: TouchEvent) => {
        const touch = event.touches[0];
        if (!touch) return;
        move(touch.clientX, touch.clientY);
        // Stops the page scrolling underneath the finger mid-adjustment.
        if (event.cancelable) event.preventDefault();
      };

      window.addEventListener('pointermove', onPointerMove);
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);
      window.addEventListener('touchmove', onTouchMove, { passive: false });
      window.addEventListener('touchend', end);
      window.addEventListener('touchcancel', end);

      detach.current = () => {
        window.removeEventListener('pointermove', onPointerMove);
        window.removeEventListener('pointerup', end);
        window.removeEventListener('pointercancel', end);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', end);
        window.removeEventListener('touchcancel', end);
      };
    },
    [disabled, end, move, value],
  );

  useEffect(() => () => detach.current?.(), []);

  const centre = size / 2;
  const radius = centre - 7;
  const angle = ARC_START + normalised * ARC_SWEEP;
  const pointer = polar(centre, centre, radius - 4, angle);
  const inner = polar(centre, centre, radius * 0.42, angle);

  return (
    <div className={`knob ${disabled ? 'is-disabled' : ''} ${dragging ? 'is-dragging' : ''}`}>
      <div
        className="knob-dial"
        style={{ width: size, height: size }}
        onPointerDown={(event) => begin(event.clientX, event.clientY)}
        // A fallback for browsers whose pointer events misbehave on touch.
        // Beginning twice is harmless: the second call sees a drag already in
        // progress and does nothing.
        onTouchStart={(event) => {
          const touch = event.touches[0];
          if (touch) begin(touch.clientX, touch.clientY);
        }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={show(value)}
        onKeyDown={(event) => {
          if (disabled) return;
          const stepSize = span / 40;
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            onChange(Math.min(max, value + stepSize));
            event.preventDefault();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            onChange(Math.max(min, value - stepSize));
            event.preventDefault();
          } else if (event.key === 'Enter' || event.key === ' ') {
            setSheetOpen(true);
            event.preventDefault();
          }
        }}
      >
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <path d={arcPath(centre, centre, radius, ARC_START, ARC_START + ARC_SWEEP)} className="knob-track" />
          {normalised > 0.001 && (
            <path
              d={arcPath(centre, centre, radius, ARC_START, angle)}
              className="knob-fill"
              style={{ stroke: accent }}
            />
          )}
          <circle cx={centre} cy={centre} r={radius * 0.62} className="knob-cap" />
          <line x1={inner.x} y1={inner.y} x2={pointer.x} y2={pointer.y} className="knob-pointer" style={{ stroke: accent }} />
        </svg>
      </div>
      <div className="knob-value">{show(value)}</div>
      <InfoLabel text={label} tip={tip} className="knob-label" />

      {sheetOpen && (
        <ValueSheet
          label={label}
          tip={tip}
          value={value}
          onChange={onChange}
          onClose={() => setSheetOpen(false)}
          min={min}
          max={max}
          format={show}
          defaultValue={defaultValue}
          accent={accent}
        />
      )}
    </div>
  );
}

/**
 * The slider a tap opens.
 *
 * The slider itself is a native range input on purpose. It is the one control
 * every phone already handles properly, including dragging from anywhere along
 * the track, and it needs no gesture code that could go wrong. The minus and
 * plus buttons are there for the last small amount, which is fiddly on any
 * slider at any size.
 */
function ValueSheet({
  label,
  tip,
  value,
  onChange,
  onClose,
  min,
  max,
  format,
  defaultValue,
  accent,
}: {
  label: string;
  tip: string;
  value: number;
  onChange: (value: number) => void;
  onClose: () => void;
  min: number;
  max: number;
  format: (value: number) => string;
  defaultValue?: number;
  accent: string;
}) {
  const span = max - min;
  // Whole numbers over a wide range, finer steps over a narrow one. Controls
  // that only accept integers round the value themselves.
  const step = span > 40 ? 1 : span / 100;
  const nudge = span > 40 ? 1 : span / 50;

  /*
   * When this sheet appeared, so the tap that opened it cannot also close it.
   *
   * A browser sends a click after a touch ends, at the same place the finger
   * was. By then this sheet exists and its backdrop is under that point, so
   * the click lands on the backdrop and shuts it again instantly. The sheet
   * appears not to open at all. Ignoring clicks for a moment after opening is
   * the fix, and it is invisible: nobody dismisses a sheet in under a third of
   * a second of it appearing.
   */
  const openedAt = useRef(Date.now());
  const dismiss = () => {
    if (Date.now() - openedAt.current < 350) return;
    onClose();
  };

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const clamp = (next: number) => Math.max(min, Math.min(max, next));

  /*
   * Rendered straight into the body rather than where it appears in the tree.
   *
   * The transport bar has a backdrop blur on it, and any element with one of
   * those becomes the reference for fixed positioning inside it. So a sheet
   * belonging to a knob in that bar was being positioned against the bar
   * instead of the screen, which put half of it off the top of the display.
   */
  return createPortal(
    <div className="sheet-backdrop" onClick={dismiss}>
      <div
        className="sheet value-sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sheet-head">
          <h3>{label}</h3>
          <button type="button" className="sheet-close" onClick={onClose}>Done</button>
        </header>

        <div className="value-body">
          <p className="value-tip">{tip}</p>
          <p className="value-readout" style={{ color: accent }}>{format(value)}</p>

          <div className="value-controls">
            <button
              type="button"
              className="value-step"
              aria-label={`Less ${label}`}
              onClick={() => onChange(clamp(value - nudge))}
            >
              −
            </button>
            <input
              className="value-range"
              type="range"
              min={min}
              max={max}
              step={step}
              value={value}
              aria-label={label}
              onChange={(event) => onChange(clamp(Number(event.target.value)))}
            />
            <button
              type="button"
              className="value-step"
              aria-label={`More ${label}`}
              onClick={() => onChange(clamp(value + nudge))}
            >
              +
            </button>
          </div>

          {defaultValue !== undefined && (
            <button type="button" className="wide-button" onClick={() => onChange(defaultValue)}>
              Back to the usual setting
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;

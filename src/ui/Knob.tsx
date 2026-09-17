/**
 * A knob you can actually turn with a thumb.
 *
 * Drag up or right to increase, down or left to decrease. Dragging further
 * from where you started gives finer control, so you can set something roughly
 * with a flick and then refine it without lifting your finger. Double tap
 * returns it to its default.
 */

import { useCallback, useRef, useState } from 'react';
import { InfoLabel } from './Tooltip';

interface KnobProps {
  label: string;
  tip: string;
  value: number;
  onChange: (value: number) => void;
  /** Where a double tap sends it. */
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
  const origin = useRef({ x: 0, y: 0, value: 0 });
  const lastTap = useRef(0);

  const normalised = Math.max(0, Math.min(1, (value - min) / (max - min)));

  const handleDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled) return;
      const now = Date.now();
      if (now - lastTap.current < 280 && defaultValue !== undefined) {
        onChange(defaultValue);
        lastTap.current = 0;
        return;
      }
      lastTap.current = now;
      event.currentTarget.setPointerCapture(event.pointerId);
      origin.current = { x: event.clientX, y: event.clientY, value };
      setDragging(true);
    },
    [disabled, defaultValue, onChange, value],
  );

  const handleMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging || disabled) return;
      const dx = event.clientX - origin.current.x;
      const dy = origin.current.y - event.clientY;
      const travel = dy + dx;
      // The further sideways you are from the knob, the slower it moves.
      const precision = 1 / (1 + Math.abs(dx) / 90);
      const delta = (travel / 180) * (max - min) * precision;
      const next = Math.max(min, Math.min(max, origin.current.value + delta));
      onChange(next);
    },
    [dragging, disabled, max, min, onChange],
  );

  const handleUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragging(false);
  }, []);

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
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={handleUp}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={Number(value.toFixed(3))}
        aria-valuetext={format ? format(value) : `${Math.round(normalised * 100)}%`}
        onKeyDown={(event) => {
          if (disabled) return;
          const stepSize = (max - min) / 40;
          if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
            onChange(Math.min(max, value + stepSize));
            event.preventDefault();
          } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
            onChange(Math.max(min, value - stepSize));
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
      <div className="knob-value">{format ? format(value) : `${Math.round(normalised * 100)}%`}</div>
      <InfoLabel text={label} tip={tip} className="knob-label" />
    </div>
  );
}

export const percent = (value: number) => `${Math.round(value * 100)}%`;

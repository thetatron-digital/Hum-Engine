/**
 * Hides the deep controls until they are wanted.
 *
 * The app grew a lot of knobs, and having all of them on screen at once turned
 * out to be worse than not having them: there was no obvious place to start.
 * So the interface has two states. Simple shows the handful of controls you
 * would reach for to get something playing. Everything shows the lot.
 *
 * Nothing is deleted in Simple, only folded away, and each panel keeps its own
 * fold so opening the extra drum controls does not also unfold the master
 * section. In Everything mode this component steps out of the way completely
 * and just renders its children.
 */

import { useState, type ReactNode } from 'react';
import { useAppStore } from '../state/store';

export function Reveal({
  label = 'More controls',
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const simple = useAppStore((state) => state.simple);
  const [open, setOpen] = useState(false);

  if (!simple) return <>{children}</>;

  return (
    <div className="reveal">
      <button
        type="button"
        className={`reveal-toggle ${open ? 'is-open' : ''}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        {open ? 'Fewer controls' : label}
        <span className="reveal-chevron" aria-hidden="true" />
      </button>
      {open && <div className="reveal-body">{children}</div>}
    </div>
  );
}

/** Renders its children only in the full interface. */
export function OnlyFull({ children }: { children: ReactNode }) {
  const simple = useAppStore((state) => state.simple);
  return simple ? null : <>{children}</>;
}

/** The switch between the two, shown once at the top. */
export function DepthSwitch() {
  const simple = useAppStore((state) => state.simple);
  const setSimple = useAppStore((state) => state.setSimple);

  return (
    <div className="depth" role="group" aria-label="How much of the interface to show">
      <button
        type="button"
        className={`depth-option ${simple ? 'is-on' : ''}`}
        onClick={() => setSimple(true)}
      >
        Simple
      </button>
      <button
        type="button"
        className={`depth-option ${simple ? '' : 'is-on'}`}
        onClick={() => setSimple(false)}
      >
        Everything
      </button>
    </div>
  );
}

/** Dials or sliders. Sliders unless you ask otherwise on a touch screen. */
export function ControlSwitch() {
  const style = useAppStore((state) => state.controlStyle);
  const setControlStyle = useAppStore((state) => state.setControlStyle);

  return (
    <div className="depth" role="group" aria-label="What the controls look like">
      <button
        type="button"
        className={`depth-option ${style === 'slider' ? 'is-on' : ''}`}
        onClick={() => setControlStyle('slider')}
      >
        Sliders
      </button>
      <button
        type="button"
        className={`depth-option ${style === 'knob' ? 'is-on' : ''}`}
        onClick={() => setControlStyle('knob')}
      >
        Knobs
      </button>
    </div>
  );
}

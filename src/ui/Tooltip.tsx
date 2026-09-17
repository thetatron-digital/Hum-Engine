/**
 * Tooltips you tap, not hover.
 *
 * On a phone there is no hover, so every explanation is behind the control's
 * own label. Tapping the label opens it, tapping anywhere closes it.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react';

export function InfoLabel({ text, tip, className }: { text: string; tip: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    // A frame's delay, otherwise the opening tap closes it again.
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', close);
      document.addEventListener('scroll', close, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('scroll', close, true);
    };
  }, [open]);

  return (
    <span className={`info ${className ?? ''}`} ref={ref}>
      <button
        type="button"
        className="info-trigger"
        onClick={() => setOpen((value) => !value)}
        aria-label={`${text}. What does this do?`}
      >
        {text}
        <span className="info-mark" aria-hidden="true">?</span>
      </button>
      {open && <span className="info-bubble" role="tooltip">{tip}</span>}
    </span>
  );
}

export function Panel({ title, tip, children, accent }: {
  title: string;
  tip: string;
  children: ReactNode;
  accent?: string;
}) {
  return (
    <section className="panel" style={accent ? { borderTopColor: accent } : undefined}>
      <header className="panel-head">
        <InfoLabel text={title} tip={tip} className="panel-title" />
      </header>
      {children}
    </section>
  );
}

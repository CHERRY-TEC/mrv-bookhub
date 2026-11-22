import { useEffect, useState } from 'react';
import { bookScroll, subscribeBook, TOTAL_TURNS } from './three/bookScrollStore';
import { isSoundEnabled, setSoundEnabled } from './three/pageSound';

/**
 * Overlay shown while a book is held: a one-time "scroll to turn" hint,
 * a live page counter, keyboard hints, and a sound toggle.
 */
export default function ReadingOverlay({ active }) {
  const [state, setState] = useState({ ...bookScroll });
  const [sound, setSound] = useState(isSoundEnabled());

  useEffect(() => subscribeBook(setState), []);
  useEffect(() => { if (!active) setState({ ...bookScroll }); }, [active]);

  if (!active) return null;

  const page = Math.min(6, state.shownStep + 1);
  const hintVisible = state.shownStep < 1;

  return (
    <div className="reading-overlay" aria-live="polite">
      {hintVisible && (
        <div className="turn-hint">
          <span className="turn-hint-icon">↕</span>
          Scroll or press <kbd>→</kbd> to turn the pages
        </div>
      )}
      <div className="reading-controls">
        <span className="page-counter" title="Page position">
          <b>{page}</b> / 6
        </span>
        <div className="page-dots" aria-hidden="true">
          {Array.from({ length: TOTAL_TURNS + 1 }, (_, i) => (
            <i key={i} className={i <= state.shownStep ? 'on' : ''} />
          ))}
        </div>
        <button
          className="sound-toggle"
          onClick={() => { const v = !sound; setSound(v); setSoundEnabled(v); }}
          title={sound ? 'Mute page sound' : 'Enable page sound'}
          aria-label={sound ? 'Mute page sound' : 'Enable page sound'}
        >
          {sound ? '🔊' : '🔇'}
        </button>
      </div>
      <span className="sr-only">
        Page {page} of 6. Use arrow keys to turn pages, Escape to close.
      </span>
    </div>
  );
}

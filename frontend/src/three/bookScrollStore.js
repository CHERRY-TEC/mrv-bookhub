/**
 * Scroll/wheel input dedicated to the held book.
 * While a book is in your hands, wheel/touch deltas accumulate here instead
 * of moving the page camera. Book.jsx reads `target` each frame and eases
 * `current` toward it, so scroll turns the cover and pages one at a time.
 */
export const bookScroll = {
  target: 0,       // integer page-turn step (0..TOTAL_TURNS)
  current: 0,      // eased value, read by Book.jsx
  active: false,   // true while a book is held
  shownStep: 0,    // 0..6 — committed turn step (for UI progress)
  turns: 0,        // total turns made this session (for hint dismissal)
};

// Lightweight listeners so React UI can react to turn state without polling.
const listeners = new Set();
export function subscribeBook(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitBook() {
  listeners.forEach((fn) => fn({ ...bookScroll }));
}

export const TOTAL_TURNS = 6; // cover + 5 leaves -> 6 printed pages

/** Feed a wheel delta (pixels) / touch swipe into the page-turn accumulator. */
let accum = 0;
export function pushScroll(delta) {
  if (!bookScroll.active) return;
  accum += delta;
  const stride = 110; // px per turn (responsive but deliberate)
  while (accum >= stride) {
    bookScroll.target = Math.min(TOTAL_TURNS, bookScroll.target + 1);
    accum -= stride;
  }
  while (accum <= -stride) {
    bookScroll.target = Math.max(0, bookScroll.target - 1);
    accum += stride;
  }
  emitBook();
}

/** Turn exactly one step (used by keyboard arrows). */
export function turnBy(delta) {
  if (!bookScroll.active) return;
  bookScroll.target = Math.max(0, Math.min(TOTAL_TURNS, bookScroll.target + delta));
  accum = 0;
  emitBook();
}

export function setShownStep(step) {
  if (bookScroll.shownStep !== step) {
    bookScroll.shownStep = step;
    emitBook();
  }
}

export function resetScroll() {
  bookScroll.target = 0;
  bookScroll.current = 0;
  bookScroll.shownStep = 0;
  bookScroll.turns = 0;
  accum = 0;
  emitBook();
}

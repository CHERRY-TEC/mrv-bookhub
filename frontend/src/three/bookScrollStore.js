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
};

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
}

export function resetScroll() {
  bookScroll.target = 0;
  bookScroll.current = 0;
  accum = 0;
}

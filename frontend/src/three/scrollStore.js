/**
 * Shared scroll progress store.
 * The DOM scroll listener writes here; the 3D camera reads it every frame.
 * Kept outside React state so scrolling never triggers re-renders.
 */
export const scrollStore = {
  progress: 0,        // 0..1 across the whole page (3 floors)
  floor: 0,           // floor derived from scroll progress (0..2)
  segment: 0,         // 0..1 progress inside the current floor's scroll band
  climbing: 0,        // 0..1 while walking the stairs to the next floor
  locked: false,      // true while a book is held in hands
};

export function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

export function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

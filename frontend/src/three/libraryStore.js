/**
 * Shared state for the multi-floor library: which floor the camera is on,
 * which category aisle is highlighted, and the trade-in biller panel.
 * Kept outside React state so the 3D camera can read it every frame.
 */

export const FLOORS = [
  { id: 0, name: 'Ground Floor', short: 'G', category: 'Engineering & Technology',
    color: '#c98a3a', y: 0 },
  { id: 1, name: 'First Floor', short: '1', category: 'Science & Medicine',
    color: '#4f9d8c', y: 4.6 },
  { id: 2, name: 'Second Floor', short: '2', category: 'Arts, Commerce & Literature',
    color: '#9b6fb5', y: 9.2 },
];

export const FLOOR_HEIGHT = 4.6;

export const libraryStore = {
  floor: 0,
  previousFloor: 0,
  transition: 1,        // 0..1, 1 = settled on `floor`
  category: 0,          // aisle index within the current floor
  billerOpen: false,
};

const listeners = new Set();
export function subscribeLibrary(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() { listeners.forEach((fn) => fn({ ...libraryStore })); }

/** Update the floor from the scroll handler without moving the page itself. */
export function syncFloor(index) {
  const next = Math.max(0, Math.min(FLOORS.length - 1, index));
  if (next === libraryStore.floor) return;
  libraryStore.previousFloor = libraryStore.floor;
  libraryStore.floor = next;
  libraryStore.transition = 0;
  libraryStore.category = 0;
  emit();
}

export function goToFloor(index) {
  const next = Math.max(0, Math.min(FLOORS.length - 1, index));
  if (next === libraryStore.floor) return;
  // Move the page scroll to this floor's band so the camera's walk/climb and
  // the button agree (the scroll handler is the source of truth now).
  if (typeof window !== 'undefined') {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: ((next + 0.08) / FLOORS.length) * max, behavior: 'smooth' });
  }
  libraryStore.previousFloor = libraryStore.floor;
  libraryStore.floor = next;
  libraryStore.transition = 0;
  libraryStore.category = 0;
  emit();
}

export function setCategory(index) {
  if (libraryStore.category !== index) {
    libraryStore.category = index;
    emit();
  }
}

export function setBillerOpen(open) {
  if (libraryStore.billerOpen !== open) {
    libraryStore.billerOpen = open;
    emit();
  }
}

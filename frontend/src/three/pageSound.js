/**
 * Tiny synthesized paper-rustle for page turns — no audio files needed.
 * Uses the Web Audio API: a short burst of filtered noise with a soft envelope.
 */
let ctx = null;
let enabled = true;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) ctx = new AC();
  }
  if (ctx?.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

export function setSoundEnabled(value) { enabled = value; }
export function isSoundEnabled() { return enabled; }

/** Play a short paper flip. `dir` 1 = forward, -1 = backward. */
export function playPageFlip(dir = 1) {
  if (!enabled) return;
  const ac = getCtx();
  if (!ac) return;
  const dur = 0.26;
  const rate = ac.sampleRate;
  const buffer = ac.createBuffer(1, Math.floor(rate * dur), rate);
  const data = buffer.getChannelData(0);
  // Brown-ish noise with a decaying envelope = soft paper texture
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    const t = i / data.length;
    const env = Math.sin(Math.PI * Math.pow(t, 0.6)) * (1 - t * 0.3);
    data[i] = last * 3.2 * env;
  }
  const src = ac.createBufferSource();
  src.buffer = buffer;
  // band-pass gives the "shhhk" paper character; pitch shifts with direction
  const filter = ac.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = dir > 0 ? 2400 : 1900;
  filter.Q.value = 0.7;
  const gain = ac.createGain();
  gain.gain.value = 0.16;
  const now = ac.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.16, now + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filter).connect(gain).connect(ac.destination);
  src.start(now);
  src.stop(now + dur + 0.02);
}

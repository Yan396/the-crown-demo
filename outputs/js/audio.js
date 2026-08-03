/*
 * Synthesised battle audio. ZERO files, zero network, zero dependencies.
 *
 * Every sound is generated at runtime from oscillators and noise through short
 * envelopes -- there is nothing to download and nothing to cache. The palette
 * is dry and sparse on purpose: 兵戈舆图 is a quiet sheet of paper, and silence
 * is part of it. There is no music track and nothing loops.
 *
 * Policy: the AudioContext is created only on a real user gesture (iOS and
 * Chrome both refuse otherwise), muting prevents any node from being created
 * at all, and if Web Audio is missing every call degrades to a no-op.
 *
 * The mute preference lives in its own localStorage key. It is a UI setting,
 * NOT part of the save contract -- the save format is untouched.
 */
const MUTE_KEY = "the-crown.audio.muted";

let context = null;
let master = null;
let unlocked = false;
let muted = readMuted();

function readMuted() {
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return false; }
}

export function isMuted() { return muted; }
export function isUnlocked() { return unlocked; }

export function setMuted(next) {
  muted = Boolean(next);
  try { localStorage.setItem(MUTE_KEY, muted ? "1" : "0"); } catch { /* private mode */ }
  if (muted && master) master.gain.value = 0;
  else if (master) master.gain.value = 0.28;
  return muted;
}

/** Must be called from a user gesture handler. Safe to call repeatedly. */
export function unlock() {
  if (unlocked || typeof window === "undefined") return unlocked;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return false;              // silent degradation, never a throw
  try {
    context = new Ctor();
    master = context.createGain();
    master.gain.value = muted ? 0 : 0.28;
    master.connect(context.destination);
    unlocked = true;
  } catch { context = null; master = null; unlocked = false; }
  return unlocked;
}

function envelope(node, at, attack, decay, peak) {
  node.gain.setValueAtTime(0.0001, at);
  node.gain.exponentialRampToValueAtTime(peak, at + attack);
  node.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
}

function tone({ type = "sine", freq = 440, dur = 0.12, peak = 0.6, sweepTo = null }) {
  if (!ready()) return;
  const at = context.currentTime;
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, at + dur);
  envelope(gain, at, 0.005, dur, peak);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

// A local noise source. Deliberately NOT Math.random: the project forbids
// unseeded randomness outright, and presentation has no business reaching for
// it even for a noise buffer. This stream is local to audio and touches
// nothing else.
let noiseSeed = 0x9e3779b9;
function nextNoise() {
  noiseSeed = (Math.imul(noiseSeed ^ (noiseSeed >>> 15), noiseSeed | 1) + 0x6d2b79f5) >>> 0;
  return ((noiseSeed ^ (noiseSeed >>> 14)) >>> 0) / 4294967296;
}

function noise({ dur = 0.09, peak = 0.5, band = 1200 }) {
  if (!ready()) return;
  const at = context.currentTime;
  const frames = Math.max(1, Math.floor(context.sampleRate * dur));
  const buffer = context.createBuffer(1, frames, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = nextNoise() * 2 - 1;
  const src = context.createBufferSource();
  src.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = band;
  const gain = context.createGain();
  envelope(gain, at, 0.004, dur, peak);
  src.connect(filter).connect(gain).connect(master);
  src.start(at);
  src.stop(at + dur + 0.05);
}

// Muted means NO node is created at all, not a silent one.
function ready() { return Boolean(unlocked && context && master && !muted); }

/*
 * The cue map. Names are the vocabulary the rest of the game speaks; how each
 * one sounds is entirely local to this file.
 */
export const CUES = Object.freeze({
  tap:      () => tone({ type: "square", freq: 880, dur: 0.035, peak: 0.18 }),   // 梆子
  card:     () => tone({ type: "triangle", freq: 520, dur: 0.09, peak: 0.2 }),
  recruit:  () => tone({ type: "triangle", freq: 660, dur: 0.13, peak: 0.24, sweepTo: 880 }),
  arrow:    () => noise({ dur: 0.07, peak: 0.16, band: 2600 }),
  cavalry:  () => { noise({ dur: 0.16, peak: 0.5, band: 220 });
                    tone({ type: "sine", freq: 90, dur: 0.2, peak: 0.5, sweepTo: 46 }); },
  hit:      () => noise({ dur: 0.06, peak: 0.32, band: 1100 }),
  charge:   () => tone({ type: "sine", freq: 74, dur: 0.42, peak: 0.5 }),        // 鼓
  sealWin:  () => tone({ type: "sine", freq: 528, dur: 0.75, peak: 0.5, sweepTo: 396 }),
  sealLoss: () => tone({ type: "sine", freq: 232, dur: 0.85, peak: 0.45, sweepTo: 150 })
});

/*
 * Every cue in the game goes through emitCue, so there is exactly one place
 * that decides whether a sound happens. `observers` exists so tests can assert
 * the real call PATH -- that recruiting actually emits "recruit" -- rather
 * than merely that a cue of that name is defined somewhere.
 */
const observers = new Set();
let lastAt = new Map();

export function onCue(fn) {
  observers.add(fn);
  return () => observers.delete(fn);
}

export function play(name) {
  return emitCue(name);
}

/**
 * @param {string} name
 * @param {{ throttleMs?: number }} [options] battle cues fire in bursts; a
 *   throttle keeps a 15-strike round from turning into noise.
 */
export function emitCue(name, options = {}) {
  const cue = CUES[name];
  if (!cue) return false;
  const throttle = Number(options.throttleMs) || 0;
  if (throttle > 0) {
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - (lastAt.get(name) || -Infinity) < throttle) return false;
    lastAt.set(name, now);
  }
  observers.forEach((fn) => { try { fn(name); } catch { /* an observer must never break audio */ } });
  if (!ready()) return false;
  try { cue(); return true; } catch { return false; }
}

/**
 * Arm the context on the first real user gesture anywhere in the document.
 * Without this a player who walks straight into a battle would never hear
 * anything, because nothing else they touched had opened the context.
 */
export function armOnFirstGesture(target = typeof document !== "undefined" ? document : null) {
  if (!target || unlocked) return;
  const open = () => {
    unlock();
    ["pointerdown", "keydown", "touchend"].forEach((type) =>
      target.removeEventListener(type, open, true));
  };
  ["pointerdown", "keydown", "touchend"].forEach((type) =>
    target.addEventListener(type, open, true));
}

export function dispose() {
  if (!context) return;
  try { context.close(); } catch { /* already closed */ }
  context = null; master = null; unlocked = false;
  lastAt = new Map();
}

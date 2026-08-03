/*
 * Runtime-only sound for 兵戈舆图. There are deliberately no audio assets:
 * every cue is a short oscillator/noise envelope created after the first
 * user gesture. The presentation RNG and gameplay RNG are never touched.
 */

function audioConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function safeParam(param, method, ...values) {
  if (param && typeof param[method] === "function") param[method](...values);
}

export class CrownAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.enabled = true;
    this.battleVoices = new Set();
    this.gestureTarget = null;
    this.gestureHandler = null;
    this.noiseSeed = 0x43524f57;
  }

  setEnabled(enabled) {
    this.enabled = enabled !== false;
    if (!this.enabled) {
      this.disposeBattle();
      this.context?.suspend?.().catch?.(() => {});
    } else if (this.context?.state === "suspended") {
      this.context.resume?.().catch?.(() => {});
    }
    return this.enabled;
  }

  isEnabled() {
    return this.enabled;
  }

  unlock() {
    if (!this.enabled) return null;
    const Context = audioConstructor();
    if (!Context) return null;
    if (!this.context) {
      this.context = new Context({ latencyHint: "interactive" });
      this.master = this.context.createGain();
      this.master.gain.value = 0.72;
      this.master.connect(this.context.destination);
    }
    if (this.context.state === "suspended") this.context.resume?.().catch?.(() => {});
    return this.context;
  }

  bindFirstGesture(target = globalThis.document) {
    if (!target?.addEventListener || this.gestureTarget === target) return;
    this.unbindGestures();
    this.gestureTarget = target;
    this.gestureHandler = (event) => {
      if (!this.enabled) return;
      this.unlock();
      if (event.target?.closest?.("button")) this.tap();
    };
    target.addEventListener("pointerdown", this.gestureHandler, { capture: true, passive: true });
  }

  unbindGestures() {
    if (this.gestureTarget && this.gestureHandler) {
      this.gestureTarget.removeEventListener("pointerdown", this.gestureHandler, { capture: true });
    }
    this.gestureTarget = null;
    this.gestureHandler = null;
  }

  voice(source, nodes, stopAt, battle = false) {
    const record = { source, nodes };
    if (battle) this.battleVoices.add(record);
    source.onended = () => {
      this.battleVoices.delete(record);
      for (const node of [source, ...nodes]) {
        try { node.disconnect?.(); } catch { /* already disconnected */ }
      }
    };
    source.start();
    source.stop(stopAt);
    return record;
  }

  oscillator({ frequency, endFrequency = frequency, duration, gain, type = "sine", delay = 0, battle = false }) {
    const context = this.unlock();
    if (!context || !this.master) return null;
    const start = context.currentTime + delay;
    const stop = start + duration;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    safeParam(oscillator.frequency, "setValueAtTime", frequency, start);
    safeParam(oscillator.frequency, "exponentialRampToValueAtTime", Math.max(1, endFrequency), stop);
    safeParam(envelope.gain, "setValueAtTime", 0.0001, start);
    safeParam(envelope.gain, "exponentialRampToValueAtTime", Math.max(0.0002, gain), start + 0.006);
    safeParam(envelope.gain, "exponentialRampToValueAtTime", 0.0001, stop);
    oscillator.connect(envelope);
    envelope.connect(this.master);
    return this.voice(oscillator, [envelope], stop + 0.01, battle);
  }

  noise({ duration, gain, frequency = 900, type = "bandpass", battle = false }) {
    const context = this.unlock();
    if (!context || !this.master) return null;
    const frames = Math.max(1, Math.ceil(context.sampleRate * duration));
    const buffer = context.createBuffer(1, frames, context.sampleRate);
    const channel = buffer.getChannelData(0);
    let value = (this.noiseSeed += 0x9e3779b9) >>> 0;
    for (let index = 0; index < frames; index += 1) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      channel[index] = (value / 0xffffffff) * 2 - 1;
    }
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = buffer;
    filter.type = type;
    filter.frequency.value = frequency;
    const start = context.currentTime;
    const stop = start + duration;
    safeParam(envelope.gain, "setValueAtTime", 0.0001, start);
    safeParam(envelope.gain, "linearRampToValueAtTime", gain, start + Math.min(0.012, duration * 0.2));
    safeParam(envelope.gain, "exponentialRampToValueAtTime", 0.0001, stop);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.master);
    return this.voice(source, [filter, envelope], stop + 0.01, battle);
  }

  now() {
    return this.context ? this.context.currentTime : Date.now() / 1000;
  }

  tap() {
    if (!this.enabled) return;
    this.oscillator({ frequency: 720, endFrequency: 410, duration: 0.045, gain: 0.055, type: "triangle" });
    this.noise({ duration: 0.026, gain: 0.018, frequency: 1300 });
  }

  charge() {
    if (!this.enabled) return;
    this.oscillator({ frequency: 104, endFrequency: 43, duration: 0.44, gain: 0.16, battle: true });
  }

  hit({ kill = false, dmgShown = 0 } = {}) {
    if (!this.enabled) return;
    const weight = Math.min(1, Math.max(0, Number(dmgShown) || 0) / 20);
    this.noise({
      duration: kill ? 0.085 : 0.055,
      gain: (kill ? 0.09 : 0.055) + weight * 0.025,
      frequency: kill ? 520 : 840,
      battle: true
    });
  }

  /*
   * A drawn shaft. Throttled inside the class so a volley reads as a shower
   * rather than a rattle, and so callers cannot forget to throttle.
   */
  arrow() {
    if (!this.enabled) return;
    const now = this.now();
    if (now - (this.lastArrowAt || -Infinity) < 0.07) return;
    this.lastArrowAt = now;
    this.noise({ duration: 0.05, gain: 0.03, frequency: 2600, battle: true });
  }

  // Horse and man landing together: this must not sound like a spear.
  cavalry() {
    if (!this.enabled) return;
    const now = this.now();
    if (now - (this.lastCavalryAt || -Infinity) < 0.12) return;
    this.lastCavalryAt = now;
    this.noise({ duration: 0.16, gain: 0.09, frequency: 220, type: "lowpass", battle: true });
    this.oscillator({ frequency: 96, endFrequency: 46, duration: 0.2, gain: 0.11, battle: true });
  }

  // Fires only on a successful recruit; a refused one stays silent.
  recruit() {
    if (!this.enabled) return;
    this.oscillator({ frequency: 620, endFrequency: 880, duration: 0.14, gain: 0.05, type: "triangle" });
  }

  seal() {
    if (!this.enabled) return;
    this.oscillator({ frequency: 880, endFrequency: 842, duration: 0.72, gain: 0.075, type: "sine" });
    this.oscillator({ frequency: 1320, endFrequency: 1260, duration: 0.46, gain: 0.028, type: "sine", delay: 0.008 });
  }

  rout() {
    if (!this.enabled) return;
    this.noise({ duration: 0.72, gain: 0.065, frequency: 150, type: "lowpass", battle: true });
    for (let beat = 0; beat < 4; beat += 1) {
      this.oscillator({
        frequency: 82 - beat * 6,
        endFrequency: 48,
        duration: 0.16,
        gain: 0.055,
        delay: beat * 0.13,
        battle: true
      });
    }
  }

  disposeBattle() {
    for (const record of [...this.battleVoices]) {
      try { record.source.stop?.(); } catch { /* source already ended */ }
      for (const node of [record.source, ...record.nodes]) {
        try { node.disconnect?.(); } catch { /* already disconnected */ }
      }
      this.battleVoices.delete(record);
    }
  }
}

export const crownAudio = new CrownAudio();

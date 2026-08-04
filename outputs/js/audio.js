/*
 * Runtime-only sound for 兵戈舆图. There are deliberately no audio assets:
 * every cue is a short oscillator/noise envelope created after the first
 * user gesture. The presentation RNG and gameplay RNG are never touched.
 *
 * This file owns BOTH layers of the mix and there is deliberately only one
 * pipeline:
 *
 *   music voices -> scene gain -> musicBus -> musicDuck -\
 *                                                          master -> limiter -> out
 *   sfx voices ------------------------------> sfxBus ---/
 *
 * The SFX are the foreground and always win: the music bus sits far below
 * them and ducks itself whenever a heavy cue lands. Music never reaches the
 * simulation -- no gameplay RNG, no CONFIG, no save field, no battleScript.
 */

/* ---------------------------------------------------------------------------
 * Presentation constants. These live HERE, not in data.js/CONFIG, for exactly
 * the reason presentation.js exists: they are timbre and timing. Changing any
 * of them must never change a battle outcome, a saved field or an RNG draw.
 * ------------------------------------------------------------------------ */

// Pentatonic 五声音阶 as the skeleton, chosen to dodge the obvious. 宫调式 with
// its parallel fourths is the sound every "oriental" preset ships; these three
// modes are darker and more open, and the only chromatic colour in the whole
// score is the battle scene's flat sixth.
const SCALES = Object.freeze({
  shang: [0, 2, 5, 7, 10],  // 商: D E G A C -- grave, the road and the crown
  zhi: [0, 2, 4, 7, 9],     // 徵: warmer major colour, a town at rest
  yu: [0, 3, 5, 7, 10]      // 羽: the war mode
});

// The crown motif, as scale-degree indices (index 5 is the octave). Four notes,
// and the same four everywhere: declaimed on the title, walked as a dotted
// variant on the road, and recovered whole -- with its resolution -- at the
// ending. If a player cannot hum it back, it is not doing its job.
const MOTIF = Object.freeze([0, 2, 1, 4]);
const MOTIF_RESOLUTION = 5;

// The three sections, separable for the styleguide: plucked strings (古琴 and
// 琵琶), winds and the drone bed (箫), and percussion (战鼓 and 梆子).
const SECTIONS = Object.freeze(["guqin", "xiao", "drum"]);

/*
 * The per-scene bed. Every phrase of every scene lays one of these down first
 * and unconditionally: there is no player-facing mute any more, so silence can
 * only ever read as a bug. Density above the bed breathes; the bed does not.
 */
const BEDS = Object.freeze({
  title: Object.freeze({ drone: 0.062, harmonic: 0.03, wind: 0.026, cutoff: 340 }),
  "map-road": Object.freeze({ drone: 0.05, harmonic: 0.026, wind: 0.018, cutoff: 320 }),
  town: Object.freeze({ drone: 0.044, harmonic: 0.024, wind: 0.03, cutoff: 460 }),
  battle: Object.freeze({ drone: 0.058, harmonic: 0.018, wind: 0, cutoff: 240 }),
  ending: Object.freeze({ drone: 0.06, harmonic: 0.032, wind: 0.032, cutoff: 420 })
});

export const CONFIG_MUSIC = Object.freeze({
  MASTER_GAIN: 0.72,
  SFX_BUS_GAIN: 1,
  // Music is background, not score: roughly 15% of the SFX bus, so a strike
  // or a seal is never competing with a pluck.
  MUSIC_BUS_GAIN: 0.15,

  // A gentle catch-all on the master so a phone speaker never clips when a
  // rout, a charge and a volley land on the same frame.
  LIMITER: Object.freeze({ threshold: -8, knee: 4, ratio: 12, attack: 0.003, release: 0.2 }),

  // Heavy cues pull the music down and let it back up. Attack is fast enough
  // to be inaudible as a swell, release slow enough to breathe back in.
  DUCK: Object.freeze({
    attack: 0.03,
    light: Object.freeze({ amount: 0.14, release: 0.22 }),   // ordinary contact
    heavy: Object.freeze({ amount: 0.32, release: 0.36 }),   // kills, cavalry
    charge: Object.freeze({ amount: 0.38, release: 0.55 }),
    seal: Object.freeze({ amount: 0.45, release: 0.9 }),
    rout: Object.freeze({ amount: 0.4, release: 0.8 })
  }),

  // Look-ahead scheduler: the timer only decides WHEN to write into the audio
  // clock, so a late frame can never shift a note.
  SCHEDULER_TICK_MS: 180,
  LOOKAHEAD_S: 1.4,
  MAX_PHRASES_PER_PUMP: 6,
  // One live scene plus at most two still crossfading out.
  MAX_ACTIVE_INSTANCES: 3,

  // Equal-power crossfade, approximated with linear segments so it behaves
  // identically on engines without setValueCurveAtTime.
  FADE_STEPS: 16,
  MUTE_FADE_S: 0.18,
  HIDDEN_FADE_S: 0.25,

  // Deterministic music stream. Isolated from state.rng in the same way the
  // map's art stream is: same file, own seed, own step.
  SEED: 0x5b09a1c3,

  SCENES: Object.freeze({
    // root is in semitones from A4. beats is the phrase length -- the unit of
    // breathing. A phrase may thin out to its bed; it may never go quiet.
    title: Object.freeze({ root: -19, scale: "shang", bpm: 40, beats: 12, fadeIn: 2.6, fadeOut: 2.2 }),
    "map-road": Object.freeze({ root: -19, scale: "shang", bpm: 46, beats: 8, fadeIn: 2.4, fadeOut: 2 }),
    town: Object.freeze({ root: -14, scale: "zhi", bpm: 58, beats: 8, fadeIn: 1.8, fadeOut: 1.8 }),
    battle: Object.freeze({ root: -24, scale: "yu", bpm: 84, beats: 8, fadeIn: 1.6, fadeOut: 1.6 }),
    ending: Object.freeze({ root: -19, scale: "shang", bpm: 38, beats: 12, fadeIn: 3, fadeOut: 2.4 })
  })
});

export const MUSIC_SCENES = Object.freeze(Object.keys(CONFIG_MUSIC.SCENES));

function audioConstructor() {
  return globalThis.AudioContext || globalThis.webkitAudioContext || null;
}

function safeParam(param, method, ...values) {
  if (param && typeof param[method] === "function") param[method](...values);
}

// A finished scene releases its section gains as well as its own -- leaving
// them attached is how a long session accumulates dead nodes.
function releaseInstanceNodes(instance) {
  for (const node of [...Object.values(instance.sections || {}), instance.input]) {
    try { node?.disconnect?.(); } catch { /* already disconnected */ }
  }
}

/*
 * The music's own deterministic stream. Same shape as map.js's artRandom: a
 * file-local generator so nothing here can consume -- or perturb -- state.rng.
 */
function musicRandom(seed) {
  let value = (seed ^ CONFIG_MUSIC.SEED) >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function sceneSeed(sceneId) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sceneId.length; index += 1) {
    hash = Math.imul(hash ^ sceneId.charCodeAt(index), 0x01000193) >>> 0;
  }
  return hash;
}

// A scale degree, extended past the top of the mode by wrapping into octaves.
function scaleFrequency(scene, degree, octaveShift = 0) {
  const scale = SCALES[scene.scale];
  const step = ((degree % scale.length) + scale.length) % scale.length;
  const octave = Math.floor(degree / scale.length) + octaveShift;
  return 440 * (2 ** ((scene.root + scale[step] + octave * 12) / 12));
}

// A chromatic colour tone, used once: the battle scene's flat sixth.
function chromaticFrequency(scene, semitone, octaveShift = 0) {
  return 440 * (2 ** ((scene.root + semitone + octaveShift * 12) / 12));
}

export class CrownAudio {
  constructor() {
    this.context = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.musicDuck = null;
    this.limiter = null;
    this.enabled = true;
    this.battleVoices = new Set();
    this.musicVoices = new Set();
    this.gestureTarget = null;
    this.gestureHandler = null;
    this.noiseSeed = 0x43524f57;
    this.musicNoiseBuffer = null;

    this.musicSceneId = null;
    this.musicActive = [];
    this.musicTimer = null;
    this.musicStopTimer = null;
    this.muteTimer = null;
    this.musicHidden = false;
    this.musicDuckFloor = 1;
    // Dev-only section mix. The game never writes it; the styleguide solos
    // 古琴 / 箫 / 鼓 through it.
    this.sectionGains = Object.fromEntries(SECTIONS.map((name) => [name, 1]));
    // A short rolling trace of what was actually scheduled. The styleguide
    // reads it; the tests use it to prove the stream is deterministic.
    this.musicTrace = [];
  }

  setEnabled(enabled) {
    const next = enabled !== false;
    if (next === this.enabled) return this.enabled;
    this.enabled = next;
    if (!this.enabled) {
      this.disposeBattle();
      // Mute is immediate but not abrupt: the music bus fades out over a fifth
      // of a second, scheduling stops at once, and only then is the context
      // suspended -- suspending mid-note is what clicks.
      this.stopMusic(CONFIG_MUSIC.MUTE_FADE_S);
      if (this.muteTimer !== null) clearTimeout(this.muteTimer);
      this.muteTimer = null;
      if (this.context) {
        this.muteTimer = setTimeout(() => {
          this.muteTimer = null;
          this.context?.suspend?.().catch?.(() => {});
        }, CONFIG_MUSIC.MUTE_FADE_S * 1000 + 60);
        this.muteTimer?.unref?.();
      }
    } else {
      if (this.muteTimer !== null) {
        clearTimeout(this.muteTimer);
        this.muteTimer = null;
      }
      if (this.context?.state === "suspended") this.context.resume?.().catch?.(() => {});
      // Coming back in enters on a phrase boundary rather than resuming the
      // bar it was cut off in. Nothing is caught up.
      this.applyMusicScene();
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
      const context = new Context({ latencyHint: "interactive" });
      this.context = context;
      this.master = context.createGain();
      this.master.gain.value = CONFIG_MUSIC.MASTER_GAIN;
      // The limiter is optional plumbing: an engine without a compressor still
      // gets the whole mix, just without the phone-speaker safety net.
      const compressor = context.createDynamicsCompressor?.();
      if (compressor) {
        const { threshold, knee, ratio, attack, release } = CONFIG_MUSIC.LIMITER;
        if (compressor.threshold) compressor.threshold.value = threshold;
        if (compressor.knee) compressor.knee.value = knee;
        if (compressor.ratio) compressor.ratio.value = ratio;
        if (compressor.attack) compressor.attack.value = attack;
        if (compressor.release) compressor.release.value = release;
        this.limiter = compressor;
        this.master.connect(compressor);
        compressor.connect(context.destination);
      } else {
        this.limiter = null;
        this.master.connect(context.destination);
      }
      this.sfxBus = context.createGain();
      this.sfxBus.gain.value = CONFIG_MUSIC.SFX_BUS_GAIN;
      this.sfxBus.connect(this.master);
      this.musicDuck = context.createGain();
      this.musicDuck.gain.value = 1;
      this.musicDuck.connect(this.master);
      this.musicBus = context.createGain();
      this.musicBus.gain.value = CONFIG_MUSIC.MUSIC_BUS_GAIN;
      this.musicBus.connect(this.musicDuck);
      this.musicDuckFloor = 1;
      // The scene may have been requested before the first gesture existed.
      this.applyMusicScene();
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
    if (!context || !this.sfxBus) return null;
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
    envelope.connect(this.sfxBus);
    return this.voice(oscillator, [envelope], stop + 0.01, battle);
  }

  noise({ duration, gain, frequency = 900, type = "bandpass", battle = false }) {
    const context = this.unlock();
    if (!context || !this.sfxBus) return null;
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
    envelope.connect(this.sfxBus);
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
    this.duckMusic(CONFIG_MUSIC.DUCK.charge);
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
    this.duckMusic(kill ? CONFIG_MUSIC.DUCK.heavy : CONFIG_MUSIC.DUCK.light);
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
    this.duckMusic(CONFIG_MUSIC.DUCK.heavy);
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
    this.duckMusic(CONFIG_MUSIC.DUCK.seal);
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
    this.duckMusic(CONFIG_MUSIC.DUCK.rout);
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

  /* =========================================================================
   * Music
   * ====================================================================== */

  /*
   * The one entry point the game uses. Called from main.js's sync(), so the
   * scene follows the lifecycle that already exists rather than a second one.
   * Returns the scene actually in force, or null when there is no music.
   */
  setMusicScene(sceneId) {
    const next = CONFIG_MUSIC.SCENES[sceneId] ? sceneId : null;
    if (next === this.musicSceneId) return this.musicSceneId;
    this.musicSceneId = next;
    this.applyMusicScene();
    return this.musicSceneId;
  }

  getMusicScene() {
    return this.musicSceneId;
  }

  /*
   * Page visibility. Hidden pauses the score outright; coming back enters on a
   * fresh phrase instead of catching up on everything that was missed.
   */
  setPageHidden(hidden) {
    const next = Boolean(hidden);
    if (next === this.musicHidden) return this.musicHidden;
    this.musicHidden = next;
    if (next) this.stopMusic(CONFIG_MUSIC.HIDDEN_FADE_S);
    else this.applyMusicScene();
    return this.musicHidden;
  }

  applyMusicScene() {
    if (!this.context || !this.musicBus) return;
    if (!this.enabled || this.musicHidden || !this.musicSceneId) {
      this.stopMusic(this.enabled ? CONFIG_MUSIC.HIDDEN_FADE_S : CONFIG_MUSIC.MUTE_FADE_S);
      return;
    }
    const live = this.musicActive.find((instance) => !instance.stopping);
    if (live?.sceneId === this.musicSceneId) return;
    if (this.musicStopTimer !== null) {
      clearTimeout(this.musicStopTimer);
      this.musicStopTimer = null;
    }
    const scene = CONFIG_MUSIC.SCENES[this.musicSceneId];
    // Land the change on the outgoing scene's next beat so a crossfade never
    // reads as a dropped bar, and start the incoming scene at phrase zero.
    const at = live ? this.nextBeatAfter(live) : this.context.currentTime + 0.06;
    if (live) this.stopInstance(live, CONFIG_MUSIC.SCENES[live.sceneId].fadeOut);
    // Stepping in and straight back out of a town must not stack two copies of
    // the road on top of each other: if the scene we are returning to is still
    // fading, bring THAT one back up instead of starting a second.
    const fading = this.musicActive.find((instance) => instance.sceneId === this.musicSceneId);
    if (fading) this.reviveInstance(fading, scene.fadeIn);
    else this.startInstance(this.musicSceneId, at, scene.fadeIn);
    this.capActiveInstances();
  }

  reviveInstance(instance, fadeIn) {
    const now = this.context.currentTime;
    const held = typeof instance.input.gain?.value === "number" ? instance.input.gain.value : 0;
    // Fade back in over what is left of the trip down, so returning after a
    // heartbeat is instant and returning after a full fade is a real entrance.
    this.rampEqualPower(instance.input.gain, { from: held, to: 1, at: now, duration: fadeIn * (1 - held) });
    instance.stopping = false;
    instance.endsAt = Infinity;
    if (instance.nextPhraseAt < now) instance.nextPhraseAt = now + 0.06;
    this.pumpMusic();
    this.startMusicTimer();
  }

  /*
   * A hard ceiling on overlap. Scene changes are crossfades, not a pile: one
   * live scene plus at most two still fading. Anything older is silenced now.
   */
  capActiveInstances() {
    while (this.musicActive.length > CONFIG_MUSIC.MAX_ACTIVE_INSTANCES) {
      const oldest = this.musicActive.find((instance) => instance.stopping);
      if (!oldest) return;
      releaseInstanceNodes(oldest);
      this.musicActive = this.musicActive.filter((instance) => instance !== oldest);
    }
  }

  startInstance(sceneId, at, fadeIn) {
    const context = this.context;
    if (!context || !this.musicBus) return null;
    const scene = CONFIG_MUSIC.SCENES[sceneId];
    const input = context.createGain();
    input.gain.value = 0;
    input.connect(this.musicBus);
    // Each instrument family gets its own gain before the scene gain, so the
    // styleguide can solo one without the score's own balance moving.
    const sections = {};
    for (const name of SECTIONS) {
      const node = context.createGain();
      node.gain.value = this.sectionGains[name];
      node.connect(input);
      sections[name] = node;
    }
    const instance = {
      sceneId,
      scene,
      input,
      sections,
      random: musicRandom(sceneSeed(sceneId)),
      phraseIndex: 0,
      startedAt: at,
      nextPhraseAt: at,
      endsAt: Infinity,
      stopping: false
    };
    this.rampEqualPower(input.gain, { from: 0, to: 1, at, duration: fadeIn });
    this.musicActive.push(instance);
    this.pumpMusic();
    this.startMusicTimer();
    return instance;
  }

  stopInstance(instance, fadeOut) {
    if (!this.context || instance.stopping) return;
    const now = this.context.currentTime;
    const held = typeof instance.input.gain?.value === "number" ? instance.input.gain.value : 1;
    this.rampEqualPower(instance.input.gain, { from: held, to: 0, at: now, duration: fadeOut });
    instance.stopping = true;
    // It keeps playing -- and keeps scheduling -- right through its own fade.
    // Cutting the phrase at the switch is what makes a transition stumble.
    instance.endsAt = now + fadeOut;
  }

  stopMusic(fade = CONFIG_MUSIC.MUTE_FADE_S) {
    for (const instance of this.musicActive) this.stopInstance(instance, fade);
    if (this.musicStopTimer !== null) clearTimeout(this.musicStopTimer);
    this.musicStopTimer = null;
    if (!this.musicActive.length) return;
    this.musicStopTimer = setTimeout(() => {
      this.musicStopTimer = null;
      this.disposeMusic({ keepScene: true });
    }, fade * 1000 + 120);
    this.musicStopTimer?.unref?.();
  }

  startMusicTimer() {
    if (this.musicTimer !== null || !this.context) return;
    const tick = () => {
      this.musicTimer = null;
      this.pumpMusic();
      if (this.musicActive.length) {
        this.musicTimer = setTimeout(tick, CONFIG_MUSIC.SCHEDULER_TICK_MS);
        this.musicTimer?.unref?.();
      }
    };
    this.musicTimer = setTimeout(tick, CONFIG_MUSIC.SCHEDULER_TICK_MS);
    this.musicTimer?.unref?.();
  }

  /*
   * The look-ahead pump. Writing notes into the audio clock ahead of time is
   * what keeps a phrase steady while the map is repainting; the timer only
   * decides how far ahead to write, never when a note sounds.
   */
  pumpMusic() {
    if (!this.context) return;
    const now = this.context.currentTime;
    if (this.enabled && !this.musicHidden) {
      const horizon = now + CONFIG_MUSIC.LOOKAHEAD_S;
      for (const instance of this.musicActive) {
        let scheduled = 0;
        while (
          instance.nextPhraseAt < Math.min(horizon, instance.endsAt) &&
          scheduled < CONFIG_MUSIC.MAX_PHRASES_PER_PUMP
        ) {
          this.schedulePhrase(instance);
          scheduled += 1;
        }
      }
    }
    this.reapMusic(now);
  }

  reapMusic(now) {
    if (!this.musicActive.some((instance) => instance.endsAt <= now)) return;
    this.musicActive = this.musicActive.filter((instance) => {
      if (instance.endsAt > now) return true;
      releaseInstanceNodes(instance);
      return false;
    });
  }

  nextBeatAfter(instance) {
    const beat = 60 / instance.scene.bpm;
    const now = this.context.currentTime + 0.04;
    if (now <= instance.startedAt) return instance.startedAt;
    const beats = Math.ceil((now - instance.startedAt) / beat);
    return instance.startedAt + beats * beat;
  }

  /*
   * Equal-power crossfade. Approximated with FADE_STEPS linear segments along
   * the sin/cos law so the sum of the two scenes' power stays flat -- a linear
   * crossfade dips in the middle, which is exactly the "hole" a transition
   * must not have. Linear segments (rather than setValueCurveAtTime) keep the
   * behaviour identical on every engine.
   */
  rampEqualPower(param, { from = 0, to = 1, at, duration }) {
    if (!param) return;
    const rising = to > from;
    safeParam(param, "cancelScheduledValues", at);
    safeParam(param, "setValueAtTime", from, at);
    for (let step = 1; step <= CONFIG_MUSIC.FADE_STEPS; step += 1) {
      const progress = step / CONFIG_MUSIC.FADE_STEPS;
      const shape = rising
        ? Math.sin(progress * Math.PI / 2)
        : Math.cos(progress * Math.PI / 2);
      // The last segment lands on the target exactly: cos(pi/2) is 6e-17, not
      // zero, and a bus left at 6e-17 is a scene that never truly stopped.
      const value = step === CONFIG_MUSIC.FADE_STEPS
        ? to
        : rising ? from + (to - from) * shape : to + (from - to) * shape;
      safeParam(param, "linearRampToValueAtTime", value, at + duration * progress);
    }
  }

  /*
   * Pull the music down under a heavy cue and let it back up. Only ever called
   * from inside this class, so there is still exactly one audio pipeline and
   * no performer can forget to duck.
   */
  duckMusic({ amount, release } = CONFIG_MUSIC.DUCK.light) {
    if (!this.context || !this.musicDuck) return;
    const now = this.context.currentTime;
    const floor = Math.max(0.05, 1 - amount);
    const attack = CONFIG_MUSIC.DUCK.attack;
    const held = typeof this.musicDuck.gain?.value === "number" ? this.musicDuck.gain.value : 1;
    safeParam(this.musicDuck.gain, "cancelScheduledValues", now);
    safeParam(this.musicDuck.gain, "setValueAtTime", held, now);
    safeParam(this.musicDuck.gain, "linearRampToValueAtTime", floor, now + attack);
    safeParam(this.musicDuck.gain, "linearRampToValueAtTime", 1, now + attack + release);
    this.musicDuckFloor = floor;
  }

  disposeMusic({ keepScene = false } = {}) {
    if (this.musicTimer !== null) clearTimeout(this.musicTimer);
    if (this.musicStopTimer !== null) clearTimeout(this.musicStopTimer);
    this.musicTimer = null;
    this.musicStopTimer = null;
    for (const record of [...this.musicVoices]) {
      try { record.source.stop?.(); } catch { /* already ended */ }
      for (const node of [record.source, ...record.nodes]) {
        try { node.disconnect?.(); } catch { /* already disconnected */ }
      }
      this.musicVoices.delete(record);
    }
    for (const instance of this.musicActive) releaseInstanceNodes(instance);
    this.musicActive = [];
    if (!keepScene) this.musicSceneId = null;
  }

  // Full teardown: no oscillator, no timer, no listener survives this.
  dispose() {
    this.disposeBattle();
    this.disposeMusic();
    if (this.muteTimer !== null) clearTimeout(this.muteTimer);
    this.muteTimer = null;
    this.unbindGestures();
  }
  /* ---- instruments ------------------------------------------------------
   *
   * Everything below is synthesised from oscillators and one shared noise
   * buffer. The goal is not a sample library -- it is that a listener can name
   * the instrument: a 古琴 by its nail transient, its slide into the note and
   * its 吟猱; a 箫 by its breath; a drum by its body. A generic swelling pad is
   * exactly what this is written to avoid, so no voice here is a bare
   * slow-attack sine on its own.
   */

  musicVoice(source, nodes, startAt, stopAt) {
    const record = { source, nodes };
    this.musicVoices.add(record);
    source.onended = () => {
      this.musicVoices.delete(record);
      for (const node of [source, ...nodes]) {
        try { node.disconnect?.(); } catch { /* already disconnected */ }
      }
    };
    source.start(startAt);
    source.stop(stopAt);
    return record;
  }

  trace(instance, kind, at, frequency) {
    this.musicTrace.push({ scene: instance.sceneId, phrase: instance.phraseIndex, kind, at, frequency });
    if (this.musicTrace.length > 64) this.musicTrace.shift();
  }

  /*
   * Dev-only section mixing, used by the styleguide to solo 古琴 / 箫 / 鼓.
   * The game never touches it, and it is applied to live and future instances
   * alike so a solo survives a scene change.
   */
  setSectionGain(section, value) {
    if (!SECTIONS.includes(section)) return this.sectionGains;
    this.sectionGains[section] = Math.max(0, Math.min(1, Number(value) || 0));
    for (const instance of this.musicActive) {
      const node = instance.sections?.[section];
      if (node) node.gain.value = this.sectionGains[section];
    }
    return this.sectionGains;
  }

  soloSection(section) {
    for (const name of SECTIONS) this.setSectionGain(name, !section || name === section ? 1 : 0);
    return this.sectionGains;
  }

  sectionInput(instance, section) {
    return instance.sections?.[section] || instance.input;
  }

  // One oscillator with an envelope, optionally filtered. The building block
  // every instrument below is assembled from.
  musicTone(instance, {
    section = "xiao", at, duration, frequency, endFrequency = frequency, gain,
    type = "sine", attack = 0.02, release = 0, cutoff = 0, cutoffEnd = cutoff,
    slide = 0, traceAs = null
  }) {
    const context = this.context;
    if (!context || !instance?.input || duration <= 0) return null;
    const oscillator = context.createOscillator();
    const envelope = context.createGain();
    oscillator.type = type;
    if (slide > 0) {
      // 绰: the finger arrives from below and settles. A guqin almost never
      // starts a note dead on the pitch, and this is most of why it reads as
      // one rather than as a synth.
      safeParam(oscillator.frequency, "setValueAtTime", frequency * (1 - slide), at);
      safeParam(oscillator.frequency, "exponentialRampToValueAtTime", frequency, at + 0.09);
    } else {
      safeParam(oscillator.frequency, "setValueAtTime", frequency, at);
    }
    if (endFrequency !== frequency) {
      safeParam(oscillator.frequency, "exponentialRampToValueAtTime", Math.max(1, endFrequency), at + duration);
    }
    const peak = Math.max(0.0002, gain);
    const rise = Math.min(attack, duration * 0.5);
    const fall = Math.max(rise + 0.01, duration - Math.min(release, duration * 0.9));
    safeParam(envelope.gain, "setValueAtTime", 0.0001, at);
    safeParam(envelope.gain, "linearRampToValueAtTime", peak, at + rise);
    if (fall > rise + 0.01) safeParam(envelope.gain, "setValueAtTime", peak, at + fall);
    safeParam(envelope.gain, "exponentialRampToValueAtTime", 0.0001, at + duration);
    const nodes = [envelope];
    if (cutoff > 0) {
      const filter = context.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = cutoff;
      if (cutoffEnd !== cutoff) {
        safeParam(filter.frequency, "setValueAtTime", cutoff, at);
        safeParam(filter.frequency, "exponentialRampToValueAtTime", Math.max(60, cutoffEnd), at + duration);
      }
      oscillator.connect(filter);
      filter.connect(envelope);
      nodes.unshift(filter);
    } else {
      oscillator.connect(envelope);
    }
    envelope.connect(this.sectionInput(instance, section));
    if (traceAs) this.trace(instance, traceAs, at, frequency);
    this.musicVoice(oscillator, nodes, at, at + duration + 0.02);
    return oscillator;
  }

  /*
   * 吟猱: the slow finger tremble on a held guqin note, and the breath vibrato
   * of a 箫. Delayed onset -- vibrato from the very first instant sounds
   * mechanical; a player leans into it after the note has spoken.
   */
  addVibrato(target, { at, duration, rate, depth, onset = 0.5 }) {
    const context = this.context;
    if (!context || !target) return;
    const lfo = context.createOscillator();
    const amount = context.createGain();
    lfo.type = "sine";
    safeParam(lfo.frequency, "setValueAtTime", rate, at);
    safeParam(amount.gain, "setValueAtTime", 0, at);
    safeParam(amount.gain, "linearRampToValueAtTime", depth, at + onset);
    safeParam(amount.gain, "linearRampToValueAtTime", 0, at + duration);
    lfo.connect(amount);
    amount.connect(target);
    this.musicVoice(lfo, [amount], at, at + duration + 0.02);
  }

  // The one noise buffer the whole score shares: nail transients, breath and
  // drum skin all read from it. Its own step, so the SFX noise stream and the
  // music noise stream can never shift each other by firing out of order.
  noiseBuffer() {
    const context = this.context;
    if (!context) return null;
    if (!this.musicNoiseBuffer) {
      const frames = Math.max(1, Math.ceil(context.sampleRate * 0.5));
      const buffer = context.createBuffer(1, frames, context.sampleRate);
      const channel = buffer.getChannelData(0);
      let value = 0x2f6b1d17;
      for (let index = 0; index < frames; index += 1) {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        channel[index] = (value / 0xffffffff) * 2 - 1;
      }
      this.musicNoiseBuffer = buffer;
    }
    return this.musicNoiseBuffer;
  }

  musicNoise(instance, { section, at, duration, gain, frequency, type = "bandpass", q = 0 }) {
    const context = this.context;
    const buffer = this.noiseBuffer();
    if (!context || !buffer) return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const envelope = context.createGain();
    source.buffer = buffer;
    filter.type = type;
    filter.frequency.value = frequency;
    if (q > 0) safeParam(filter.Q, "setValueAtTime", q, at);
    safeParam(envelope.gain, "setValueAtTime", 0.0001, at);
    safeParam(envelope.gain, "linearRampToValueAtTime", Math.max(0.0002, gain), at + Math.min(0.006, duration * 0.25));
    safeParam(envelope.gain, "exponentialRampToValueAtTime", 0.0001, at + duration);
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.sectionInput(instance, section));
    this.musicVoice(source, [filter, envelope], at, at + duration + 0.02);
  }

  /*
   * 古琴. Nail transient, an inharmonic third partial (a real string is stiff),
   * a slide into the pitch and a tremble on the tail. Long decay -- the note
   * is allowed to outlive the beat, which is most of the instrument's charm.
   */
  guqinPluck(instance, { at, frequency, gain, decay = 3.2, slide = 0.055, vibrato = true, echo = 0 }) {
    const body = this.musicTone(instance, {
      section: "guqin", at, duration: decay, frequency, gain,
      type: "triangle", attack: 0.004, release: decay,
      cutoff: 2400, cutoffEnd: 460, slide, traceAs: "guqin"
    });
    if (vibrato && body) {
      this.addVibrato(body.frequency, {
        at, duration: decay, rate: 5.2, depth: frequency * 0.006, onset: Math.min(0.9, decay * 0.3)
      });
    }
    this.musicTone(instance, {
      section: "guqin", at, duration: decay * 0.36, frequency: frequency * 2, gain: gain * 0.3,
      type: "sine", attack: 0.003, release: decay * 0.36
    });
    // 3.01x, not 3x: string stiffness pushes the upper partials sharp, and
    // that tiny beat against the octave is what stops it sounding synthetic.
    this.musicTone(instance, {
      section: "guqin", at, duration: decay * 0.2, frequency: frequency * 3.01, gain: gain * 0.11,
      type: "sine", attack: 0.002, release: decay * 0.2
    });
    this.musicNoise(instance, {
      section: "guqin", at, duration: 0.018, gain: gain * 0.35, frequency: 2200, q: 1.4
    });
    if (echo > 0) {
      this.musicTone(instance, {
        section: "guqin", at: at + echo, duration: decay * 0.6, frequency, gain: gain * 0.24,
        type: "triangle", attack: 0.005, release: decay * 0.6, cutoff: 1300, cutoffEnd: 380
      });
    }
  }

  /*
   * 泛音: a guqin harmonic, touched not stopped. No nail, no fundamental --
   * just the partial, very soft and very long. This is the thread that keeps
   * the music bus alive under every scene, so it is scheduled unconditionally.
   */
  guqinHarmonic(instance, { at, duration, frequency, gain }) {
    const tone = this.musicTone(instance, {
      section: "guqin", at, duration, frequency: frequency * 2, gain,
      type: "sine", attack: Math.min(1.2, duration * 0.3), release: Math.min(2.4, duration * 0.45),
      traceAs: "harmonic"
    });
    if (tone) {
      this.addVibrato(tone.frequency, {
        at, duration, rate: 3.4, depth: frequency * 0.003, onset: Math.min(2, duration * 0.4)
      });
    }
    this.musicTone(instance, {
      section: "guqin", at, duration: duration * 0.7, frequency: frequency * 3, gain: gain * 0.34,
      type: "sine", attack: Math.min(1.4, duration * 0.35), release: Math.min(2, duration * 0.4)
    });
  }

  /*
   * 琵琶. The same family as the guqin but the opposite temperament: brighter,
   * shorter, more attack, and able to roll (轮指). Used for accents, never as
   * the bed.
   */
  pipaPluck(instance, { at, frequency, gain, decay = 1.15, roll = 0 }) {
    if (roll > 0) {
      for (let strike = 0; strike < roll; strike += 1) {
        this.pipaPluck(instance, {
          at: at + strike * 0.058,
          frequency,
          gain: gain * (1 - strike * 0.13),
          decay: strike === roll - 1 ? decay : 0.34
        });
      }
      return;
    }
    this.musicTone(instance, {
      section: "guqin", at, duration: decay, frequency, gain,
      type: "sawtooth", attack: 0.002, release: decay,
      cutoff: 3200, cutoffEnd: 780, traceAs: "pipa"
    });
    this.musicNoise(instance, {
      section: "guqin", at, duration: 0.012, gain: gain * 0.5, frequency: 3100, q: 1.1
    });
  }

  /*
   * 箫/笛. A wind instrument is its breath: the noise layer riding the same
   * envelope is what separates this from the "generic oriental pad" it would
   * otherwise be. Dizi adds an edge partial for the 膜; xiao stays hollow.
   */
  xiaoTone(instance, { at, duration, frequency, gain, bright = false, vibrato = true }) {
    const tone = this.musicTone(instance, {
      section: "xiao", at, duration, frequency, gain,
      type: "sine", attack: bright ? 0.24 : 0.42, release: Math.min(1.1, duration * 0.4),
      cutoff: bright ? 2600 : 1500, traceAs: "xiao"
    });
    if (vibrato && tone) {
      this.addVibrato(tone.frequency, {
        at, duration, rate: 4.6, depth: frequency * 0.0045, onset: Math.min(1.1, duration * 0.35)
      });
    }
    this.musicTone(instance, {
      section: "xiao", at, duration, frequency: frequency * 2, gain: gain * (bright ? 0.22 : 0.12),
      type: "triangle", attack: bright ? 0.3 : 0.5, release: Math.min(1, duration * 0.4)
    });
    this.musicNoise(instance, {
      section: "xiao", at, duration, gain: gain * 0.16,
      frequency: bright ? 2600 : 1700, q: 0.7
    });
  }

  // The low bed the wind sits on. Slow, filtered, and always overlapping the
  // next phrase so the seam between phrases is never audible.
  droneTone(instance, { at, duration, frequency, gain, cutoff = 320 }) {
    this.musicTone(instance, {
      section: "xiao", at, duration, frequency, gain,
      type: "sine", attack: Math.min(2.2, duration * 0.3), release: Math.min(2.6, duration * 0.4),
      cutoff, traceAs: "drone"
    });
  }

  // 战鼓: body bends down, skin is filtered noise. Kept low and infrequent so
  // the stage's own charge and rout drums are never competing with it.
  drumHit(instance, { at, gain, pitch = 72 }) {
    this.musicTone(instance, {
      section: "drum", at, duration: 0.36, frequency: pitch, endFrequency: pitch * 0.58, gain,
      type: "sine", attack: 0.005, release: 0.32, traceAs: "drum"
    });
    this.musicNoise(instance, {
      section: "drum", at, duration: 0.15, gain: gain * 0.45, frequency: 340, type: "lowpass"
    });
  }

  // 梆子: a wooden clapper keeping time. Two ticks, no pitch to speak of.
  woodBlock(instance, { at, gain }) {
    this.musicNoise(instance, {
      section: "drum", at, duration: 0.028, gain, frequency: 1500, q: 2.4
    });
    this.musicTone(instance, {
      section: "drum", at, duration: 0.03, frequency: 940, endFrequency: 700, gain: gain * 0.5,
      type: "square", attack: 0.001, release: 0.028, traceAs: "wood"
    });
  }

  /* ---- phrases -----------------------------------------------------------
   *
   * Every phrase lays a bed FIRST and unconditionally -- a guqin harmonic and
   * a low drone that outlast the phrase. Density above that bed breathes, but
   * no scene is ever silent while it is in the foreground.
   */

  schedulePhrase(instance) {
    const scene = instance.scene;
    const beat = 60 / scene.bpm;
    const at = instance.nextPhraseAt;
    const index = instance.phraseIndex;
    this.phraseBed(instance, at, beat, index);
    if (instance.sceneId === "title") this.phraseTitle(instance, at, beat, index);
    else if (instance.sceneId === "map-road") this.phraseRoad(instance, at, beat, index);
    else if (instance.sceneId === "town") this.phraseTown(instance, at, beat, index);
    else if (instance.sceneId === "battle") this.phraseBattle(instance, at, beat, index);
    else if (instance.sceneId === "ending") this.phraseEnding(instance, at, beat, index);
    instance.phraseIndex += 1;
    instance.nextPhraseAt = at + scene.beats * beat;
  }

  /*
   * The bed. This is the promise that the music never drops out: a low drone
   * and a guqin harmonic on every phrase of every scene, overlapping into the
   * next one. Quiet enough to sit under conversation, present enough that the
   * world is never dead air.
   */
  phraseBed(instance, at, beat, index) {
    const scene = instance.scene;
    const span = scene.beats * beat;
    const bed = BEDS[instance.sceneId];
    this.droneTone(instance, {
      at,
      duration: span + beat * 1.6,
      frequency: scaleFrequency(scene, 0, -1),
      gain: bed.drone,
      cutoff: bed.cutoff
    });
    // The fifth alternates with the octave so the bed moves without changing.
    this.guqinHarmonic(instance, {
      at: at + beat * 0.5,
      duration: span + beat * 0.8,
      frequency: scaleFrequency(scene, index % 2 === 0 ? 3 : 0, -1),
      gain: bed.harmonic
    });
    if (bed.wind > 0) {
      this.xiaoTone(instance, {
        at: at + beat * (index % 2 === 0 ? 1 : 3),
        duration: span * 0.55,
        frequency: scaleFrequency(scene, index % 3 === 0 ? 2 : 4, -1),
        gain: bed.wind
      });
    }
  }

  /*
   * Title. The four-note theme, stated plainly on the guqin with a slide into
   * every note, and a 箫 doubling the last two. Whatever else the score does
   * later, this is the version a player should be able to hum back.
   */
  phraseTitle(instance, at, beat, index) {
    const scene = instance.scene;
    if (index % 2 === 1) {
      // The answering phrase: the theme's last note alone, and the wind.
      this.guqinPluck(instance, {
        at: at + beat * 2,
        frequency: scaleFrequency(scene, MOTIF[3]),
        gain: 0.08,
        decay: 3.6,
        echo: beat * 0.6
      });
      this.xiaoTone(instance, {
        at: at + beat * 5, duration: beat * 5, frequency: scaleFrequency(scene, MOTIF[0]), gain: 0.05
      });
      return;
    }
    MOTIF.forEach((degree, step) => {
      this.guqinPluck(instance, {
        at: at + beat * (1 + step * 2.5),
        frequency: scaleFrequency(scene, degree),
        gain: step === 0 ? 0.105 : 0.085,
        decay: step === MOTIF.length - 1 ? 4 : 2.8,
        echo: beat * 0.62
      });
    });
    this.xiaoTone(instance, {
      at: at + beat * 6, duration: beat * 5.5,
      frequency: scaleFrequency(scene, MOTIF[2], -1), gain: 0.042
    });
  }

  /*
   * The road. The theme returns as a variant -- same four steps, walked
   * instead of declaimed: dotted, one note thrown up an octave, the tail
   * left hanging. Between statements the guqin wanders; the density breathes
   * but the bed underneath never stops.
   */
  phraseRoad(instance, at, beat, index) {
    const scene = instance.scene;
    const random = instance.random;
    if (index % 3 === 0) {
      const swing = [0, 1.5, 3.5, 5];
      MOTIF.forEach((degree, step) => {
        this.guqinPluck(instance, {
          at: at + beat * swing[step],
          frequency: scaleFrequency(scene, degree, step === 2 ? 1 : 0),
          gain: step === 2 ? 0.055 : 0.082,
          decay: 2.6,
          echo: step === 3 ? beat * 0.75 : 0
        });
      });
      return;
    }
    // One to three notes, placed on the beat grid, never none.
    const notes = 1 + Math.floor(random() * 3);
    let cursor = random() < 0.5 ? 0 : 1;
    for (let note = 0; note < notes; note += 1) {
      if (cursor >= scene.beats) break;
      const degree = Math.floor(random() * 6);
      const high = random() < 0.22;
      this.guqinPluck(instance, {
        at: at + cursor * beat,
        frequency: scaleFrequency(scene, degree, high ? 1 : 0),
        gain: high ? 0.055 : 0.08,
        decay: 2.8,
        echo: random() < 0.35 ? beat * 0.75 : 0
      });
      cursor += 1 + Math.floor(random() * 3);
    }
    if (random() < 0.4) {
      this.xiaoTone(instance, {
        at: at + beat * 4, duration: beat * 3.5,
        frequency: scaleFrequency(scene, 1 + Math.floor(random() * 3)), gain: 0.04
      });
    }
  }

  /*
   * Town. Warmer and busier: the 琵琶 takes the foreground the guqin holds
   * elsewhere, a 梆子 keeps time the way a market does, and the 箫 answers.
   */
  phraseTown(instance, at, beat, index) {
    const scene = instance.scene;
    const random = instance.random;
    const lead = Math.floor(random() * 5);
    this.pipaPluck(instance, { at, frequency: scaleFrequency(scene, lead), gain: 0.062, decay: 1.3 });
    this.pipaPluck(instance, {
      at: at + beat * 1.5, frequency: scaleFrequency(scene, lead + 2), gain: 0.05, decay: 1.1
    });
    if (index % 2 === 0) {
      this.pipaPluck(instance, {
        at: at + beat * 4, frequency: scaleFrequency(scene, lead + 1), gain: 0.05, decay: 1.4, roll: 4
      });
    } else {
      this.guqinPluck(instance, {
        at: at + beat * 4.5, frequency: scaleFrequency(scene, lead + 3, -1), gain: 0.07, decay: 2.4
      });
    }
    this.woodBlock(instance, { at: at + beat * 2, gain: 0.045 });
    this.woodBlock(instance, { at: at + beat * 6, gain: 0.032 });
    this.xiaoTone(instance, {
      at: at + beat * (random() < 0.5 ? 3 : 5), duration: beat * 3,
      frequency: scaleFrequency(scene, lead + 4), gain: 0.045, bright: true
    });
  }

  /*
   * Battle. A low drum, a clapper, and one chromatic colour -- the flat sixth,
   * the only note outside the mode in the entire score, and it appears every
   * fourth phrase and then leaves. Deliberately thin: strike, arrow, cavalry
   * and rout all have to sit in front of this, and a wall of gongs would bury
   * them.
   */
  phraseBattle(instance, at, beat, index) {
    const scene = instance.scene;
    const random = instance.random;
    const span = scene.beats * beat;
    if (index % 4 === 3) {
      this.xiaoTone(instance, {
        at: at + beat * 2, duration: beat * 5,
        frequency: chromaticFrequency(scene, 8), gain: 0.03, bright: true
      });
    }
    this.drumHit(instance, { at, gain: 0.11 });
    this.drumHit(instance, { at: at + beat * 3, gain: 0.08, pitch: 64 });
    if (index % 2 === 1) this.drumHit(instance, { at: at + beat * 6, gain: 0.066, pitch: 58 });
    this.woodBlock(instance, { at: at + beat * 1.5, gain: 0.03 });
    this.woodBlock(instance, { at: at + beat * 4.5, gain: 0.026 });
    this.musicTone(instance, {
      section: "xiao", at, duration: span + beat, frequency: scaleFrequency(scene, 3, -1),
      gain: 0.032, type: "sine", attack: 1, release: 1.4, cutoff: 300
    });
    if (random() < 0.5) {
      this.pipaPluck(instance, {
        at: at + beat * (4 + Math.floor(random() * 3)),
        frequency: scaleFrequency(scene, Math.floor(random() * 3) + 5),
        gain: 0.036, decay: 0.9
      });
    }
  }

  /*
   * Ending. The theme comes back whole, slower than the title stated it, with
   * the 箫 carrying the line the guqin plucks and a fifth note resolving to
   * the octave -- the one place in the score that closes rather than continues.
   */
  phraseEnding(instance, at, beat, index) {
    const scene = instance.scene;
    if (index % 2 === 1) {
      this.xiaoTone(instance, {
        at: at + beat, duration: beat * 7,
        frequency: scaleFrequency(scene, MOTIF[1]), gain: 0.048
      });
      this.guqinPluck(instance, {
        at: at + beat * 6, frequency: scaleFrequency(scene, MOTIF[0], -1), gain: 0.07, decay: 3.6
      });
      return;
    }
    [...MOTIF, MOTIF_RESOLUTION].forEach((degree, step) => {
      const last = step === MOTIF.length;
      this.guqinPluck(instance, {
        at: at + beat * (0.5 + step * 2.2),
        frequency: scaleFrequency(scene, degree),
        gain: last ? 0.1 : 0.08,
        decay: last ? 4.4 : 2.8,
        echo: beat * 0.6
      });
    });
    this.xiaoTone(instance, {
      at: at + beat * 4.5, duration: beat * 6,
      frequency: scaleFrequency(scene, MOTIF[3], -1), gain: 0.05
    });
  }
}

export const crownAudio = new CrownAudio();

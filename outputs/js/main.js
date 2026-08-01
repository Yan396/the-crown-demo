import { attemptFlee, skipBattle } from "./battle.js";
import { CONFIG, SUPPORTED_LANGUAGES } from "./data.js";
import {
  advanceActIfNeeded,
  advanceOnboarding,
  checkLowGoldTooltip,
  consumeTooltip,
  submitPromise,
  trackTownEntry,
  updateSessionPeaks
} from "./demo.js";
import { createMapRenderer } from "./map.js";
import { stampSeal } from "./seal.js";
import {
  acceptMercenaryContract,
  recruitMilitia,
  setAutoplay,
  worldTick
} from "./sim.js";
import {
  activeTown,
  autosaveState,
  clamp,
  createInitialState,
  createReplayState,
  loadState,
  nextWorldSeed,
  saveState
} from "./state.js";
import {
  recordQuitPoint,
  sharePlaytestResult,
  startTelemetrySession
} from "./telemetry.js";
import { createUi } from "./ui.js";

const canvas = document.getElementById("map");
const query = new URLSearchParams(window.location.search);
const autoplayEnabled = query.get("autoplay") === "1";
const requestedSeed = Number(query.get("seed"));
const autoplaySeed = Number.isFinite(requestedSeed) ? requestedSeed >>> 0 : CONFIG.SEED;

let state = autoplayEnabled
  ? createInitialState(autoplaySeed, { startedAt: new Date(0).toISOString() })
  : loadState();
const loadedExistingState = Boolean(state);
if (!state) state = createInitialState(CONFIG.SEED);
startTelemetrySession(state);

const renderer = createMapRenderer(canvas);
let saveAvailable = autoplayEnabled ? true : (loadedExistingState || saveState(state));
let logicAccumulator = 0;
let lastFrameAt = performance.now();
let activePointerId = null;
let ui;
let lastTooltipTownId = null;
let autoplayStopped = false;

const autoplayMetrics = {
  enabled: autoplayEnabled,
  seed: state.seed,
  firstBattleSeconds: null,
  act2Seconds: null,
  endingSeconds: null,
  activeSeconds: 0
};
window.__CROWN_AUTOPLAY__ = autoplayMetrics;

const perf = {
  frames: 0,
  droppedFrames: 0,
  fps: 0,
  windowStartedAt: performance.now(),
  windowFrames: 0
};
window.__CROWN_PERF__ = perf;

function persist(showFailure = false) {
  if (autoplayEnabled) return true;
  saveAvailable = saveState(state);
  if (!saveAvailable && showFailure) ui.showToast("toast.saveFailed");
  return saveAvailable;
}

function handleBattleResult(result) {
  if (!result) return;
  if (result.type === "victory") {
    stampSeal(ui.text("map.victorySeal"));
    ui.showToast("toast.victory", { loot: result.loot });
  } else if (result.type === "defeat") {
    stampSeal(ui.text("map.defeatSeal"), { tone: "loss" });
    ui.showToast("toast.defeat", { townId: result.townId });
  }
}

function sync() {
  ui.sync(state, { saveAvailable, autoplayEnabled });
}

function showNextTooltip() {
  const townId = activeTown(state)?.id || null;
  trackTownEntry(state, townId);
  lastTooltipTownId = townId;
  checkLowGoldTooltip(state);
  const tooltip = consumeTooltip(state);
  if (tooltip) ui.showContextTooltip(tooltip);
}

function recordAutoplayMilestone(name, seconds) {
  if (!autoplayEnabled || autoplayMetrics[name] !== null) return;
  autoplayMetrics[name] = seconds;
  const label = name === "act2Seconds" ? "Act 2" : name === "endingSeconds" ? "renown 100" : "first battle";
  console.info(`[CROWN autoplay] ${label}: ${(seconds / 60).toFixed(2)} active minutes`);
}

function resolveAutoplayModal() {
  if (!autoplayEnabled || !state.demo?.modal) return false;
  if (state.demo.modal === "onboarding") {
    advanceOnboarding(state);
    return true;
  }
  if (state.demo.modal === "troopPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_TROOP_PROMISE, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    return true;
  }
  if (state.demo.modal === "goldPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_GOLD_PROMISE, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    return true;
  }
  return false;
}

function finishAutoplaySetup() {
  if (!autoplayEnabled) return;
  setAutoplay(state, true);
  while (resolveAutoplayModal()) {
    // Tutorial taps and mirror answers intentionally consume no active time.
  }
}

function replaceState(nextState, toast = true) {
  state = nextState;
  startTelemetrySession(state);
  logicAccumulator = 0;
  lastFrameAt = performance.now();
  lastTooltipTownId = null;
  renderer.resize(state.player.pos);
  persist(true);
  sync();
  if (toast) ui.showToast("toast.newSeed", { seed: state.seed });
}

ui = createUi({
  onTogglePause() {
    if (state.demo.modal || state.demo.ended) return;
    state.paused = !state.paused;
    state.demo.pauseReason = state.paused ? "user" : null;
    logicAccumulator = 0;
    lastFrameAt = performance.now();
    persist(true);
    sync();
  },
  onLanguageChange(language) {
    if (!SUPPORTED_LANGUAGES.includes(language)) return;
    state.settings.language = language;
    persist(true);
    sync();
  },
  onRecruit() {
    const result = recruitMilitia(state);
    if (result.ok) {
      updateSessionPeaks(state);
      persist(true);
      ui.showToast("toast.recruited");
    } else if (result.reason === "gold") {
      ui.showToast("toast.goldInsufficient");
    } else if (result.reason === "paused") {
      ui.showToast("toast.paused");
    } else if (result.reason === "battle") {
      ui.showToast("toast.battleLocked");
    }
    checkLowGoldTooltip(state);
    showNextTooltip();
    sync();
  },
  onAcceptContract() {
    const result = acceptMercenaryContract(state);
    if (result.ok) {
      persist(true);
      ui.showToast("toast.contractAccepted", { factionId: result.contract.factionId });
    } else if (result.reason === "paused") {
      ui.showToast("toast.paused");
    } else if (result.reason === "battle") {
      ui.showToast("toast.battleLocked");
    }
    sync();
  },
  onSkipBattle() {
    if (state.paused) {
      ui.showToast("toast.paused");
      return;
    }
    const result = skipBattle(state);
    handleBattleResult(result);
    updateSessionPeaks(state);
    const transition = advanceActIfNeeded(state);
    if (transition?.type === "act2") persist();
    persist(true);
    sync();
  },
  onRetreat() {
    const result = attemptFlee(state);
    if (!result.ok && result.reason === "paused") ui.showToast("toast.paused");
    if (result.ok && result.success) ui.showToast("toast.retreatSuccess");
    if (result.ok && !result.success) ui.showToast("toast.retreatFailed");
    persist(true);
    sync();
  },
  onAdvanceOnboarding() {
    advanceOnboarding(state);
    persist(true);
    sync();
  },
  onSubmitPromise(value) {
    const result = submitPromise(state, value);
    if (!result.accepted) return;
    lastFrameAt = performance.now();
    logicAccumulator = 0;
    showNextTooltip();
    persist(true);
    sync();
  },
  async onShare() {
    const result = await sharePlaytestResult(state, state.settings.language);
    if (result.copied && !result.shared) ui.showToast("toast.copied");
    if (!result.copied && !result.shared && !result.cancelled) ui.showToast("toast.copyFailed");
  },
  onNewSeed(replay) {
    if (replay) {
      const next = createReplayState(state, { startedAt: new Date().toISOString() });
      next.demo.modal = "troopPromise";
      next.demo.pauseReason = "promise";
      next.paused = true;
      replaceState(next);
      return;
    }
    const next = createInitialState(nextWorldSeed(state), {
      language: state.settings.language,
      replayCount: state.telemetry.replayCount,
      startedAt: new Date().toISOString()
    });
    replaceState(next);
  }
});

finishAutoplaySetup();

function runLogicStep() {
  if (autoplayStopped) return;
  const result = worldTick(state);
  if (!result.advanced) {
    if (resolveAutoplayModal()) sync();
    return;
  }

  handleBattleResult(result.battleResult);
  updateSessionPeaks(state);
  const activeSeconds = state.telemetry.totalActiveSeconds;
  autoplayMetrics.activeSeconds = activeSeconds;
  if (state.stats.battles > 0) recordAutoplayMilestone("firstBattleSeconds", activeSeconds);

  const transition = advanceActIfNeeded(
    state,
    autoplayEnabled ? new Date(state.tick * CONFIG.LOGIC_MS).toISOString() : undefined
  );
  if (transition?.type === "act2") recordAutoplayMilestone("act2Seconds", activeSeconds);
  if (transition?.type === "ending") recordAutoplayMilestone("endingSeconds", activeSeconds);
  while (resolveAutoplayModal()) {
    // Resolve the Act 2 mirror question before the next simulated tick.
  }

  const townId = activeTown(state)?.id || null;
  if (townId !== lastTooltipTownId || result.dayAdvanced || result.battleResult) showNextTooltip();

  if (result.dayAdvanced) {
    saveAvailable = autoplayEnabled ? true : autosaveState(state, result);
  } else if (result.battleResult || transition) {
    persist();
  }

  if (
    autoplayEnabled &&
    !state.demo.ended &&
    activeSeconds >= CONFIG.AUTOPLAY_MAX_ACTIVE_SECONDS
  ) {
    autoplayStopped = true;
    state.paused = true;
    console.warn(`[CROWN autoplay] target missed at ${(activeSeconds / 60).toFixed(2)} active minutes`);
  }
  sync();
}

function updatePerf(now, elapsed) {
  perf.frames += 1;
  perf.windowFrames += 1;
  if (elapsed > 34) perf.droppedFrames += 1;
  const sampleDuration = now - perf.windowStartedAt;
  if (sampleDuration >= 2000) {
    perf.fps = Number((perf.windowFrames * 1000 / sampleDuration).toFixed(1));
    document.documentElement.dataset.crownFps = String(perf.fps);
    document.documentElement.dataset.crownDroppedFrames = String(perf.droppedFrames);
    perf.windowFrames = 0;
    perf.windowStartedAt = now;
  }
}

function frame(now) {
  const maximumFrameDelta = CONFIG.LOGIC_MS * CONFIG.MAX_CATCHUP_TICKS;
  const elapsed = clamp(now - lastFrameAt, 0, maximumFrameDelta);
  lastFrameAt = now;
  updatePerf(now, elapsed);

  if (state.paused || document.visibilityState === "hidden") {
    logicAccumulator = 0;
  } else {
    const speed = autoplayEnabled ? CONFIG.AUTOPLAY_MULTIPLIER : 1;
    logicAccumulator += elapsed * speed;
    let steps = 0;
    const maximumSteps = autoplayEnabled
      ? CONFIG.MAX_CATCHUP_TICKS * CONFIG.AUTOPLAY_MULTIPLIER
      : CONFIG.MAX_CATCHUP_TICKS;
    while (logicAccumulator >= CONFIG.LOGIC_MS && steps < maximumSteps) {
      runLogicStep();
      logicAccumulator -= CONFIG.LOGIC_MS;
      steps += 1;
    }
    if (steps === maximumSteps && logicAccumulator >= CONFIG.LOGIC_MS) {
      logicAccumulator %= CONFIG.LOGIC_MS;
    }
  }

  const alpha = state.paused ? 1 : clamp(logicAccumulator / CONFIG.LOGIC_MS, 0, 1);
  renderer.render(state, now, alpha, state.settings.language);
  requestAnimationFrame(frame);
}

function setMoveTargetFromPointer(event) {
  if (state.paused) {
    ui.showToast("toast.paused");
    return;
  }
  if (state.battle) {
    ui.showToast("toast.battleLocked");
    return;
  }
  if (ui.isSettingsOpen() || state.demo.modal || state.demo.ended) return;
  const bounds = canvas.getBoundingClientRect();
  state.player.moveTarget = renderer.screenToWorld(event.clientX - bounds.left, event.clientY - bounds.top);
}

canvas.addEventListener("pointerdown", (event) => {
  if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
  if (state.paused || state.battle || ui.isSettingsOpen()) {
    setMoveTargetFromPointer(event);
    return;
  }
  activePointerId = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  setMoveTargetFromPointer(event);
  event.preventDefault();
});

canvas.addEventListener("pointermove", (event) => {
  if (event.pointerId !== activePointerId) return;
  setMoveTargetFromPointer(event);
  event.preventDefault();
});

function finishPointer(event) {
  if (event.pointerId !== activePointerId) return;
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  activePointerId = null;
  event.preventDefault();
}

canvas.addEventListener("pointerup", finishPointer);
canvas.addEventListener("pointercancel", finishPointer);
window.addEventListener("resize", () => renderer.resize(state.player.pos));

function saveQuitPoint(screen) {
  if (autoplayEnabled) return;
  recordQuitPoint(state, screen);
  saveState(state);
}

window.addEventListener("beforeunload", () => saveQuitPoint(state.demo.ended ? "ending" : state.demo.modal || "world"));
window.addEventListener("pagehide", () => saveQuitPoint(state.demo.ended ? "ending" : state.demo.modal || "world"));
document.addEventListener("visibilitychange", () => {
  logicAccumulator = 0;
  lastFrameAt = performance.now();
  if (document.visibilityState === "hidden") saveQuitPoint(state.demo.ended ? "ending" : state.demo.modal || "world");
});

renderer.resize(state.player.pos);
sync();
requestAnimationFrame(frame);

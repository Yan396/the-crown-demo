import { skipBattle } from "./battle.js";
import { CONFIG, SUPPORTED_LANGUAGES } from "./data.js";
import { createMapRenderer } from "./map.js";
import { stampSeal } from "./seal.js";
import { recruitMilitia, worldTick } from "./sim.js";
import { autosaveState, clamp, createInitialState, loadState, saveState } from "./state.js";
import { createUi } from "./ui.js";

const canvas = document.getElementById("map");
let state = loadState();
const loadedExistingState = Boolean(state);
if (!state) state = createInitialState(CONFIG.SEED);

const renderer = createMapRenderer(canvas);
let saveAvailable = loadedExistingState || saveState(state);
let logicAccumulator = 0;
let lastFrameAt = performance.now();
let activePointerId = null;
let ui;

function persist(showFailure = false) {
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
  ui.sync(state, { saveAvailable });
}

ui = createUi({
  onTogglePause() {
    state.paused = !state.paused;
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
      persist(true);
      ui.showToast("toast.recruited");
    } else if (result.reason === "gold") {
      ui.showToast("toast.goldInsufficient");
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
    persist(true);
    sync();
  }
});

function runLogicStep() {
  const result = worldTick(state);
  if (!result.advanced) return;
  handleBattleResult(result.battleResult);

  if (result.dayAdvanced) {
    saveAvailable = autosaveState(state, result);
  } else if (result.battleResult) {
    persist();
  }
  sync();
}

function frame(now) {
  const maximumFrameDelta = CONFIG.LOGIC_MS * CONFIG.MAX_CATCHUP_TICKS;
  const elapsed = clamp(now - lastFrameAt, 0, maximumFrameDelta);
  lastFrameAt = now;

  if (state.paused) {
    logicAccumulator = 0;
  } else {
    logicAccumulator += elapsed;
    let steps = 0;
    while (logicAccumulator >= CONFIG.LOGIC_MS && steps < CONFIG.MAX_CATCHUP_TICKS) {
      runLogicStep();
      logicAccumulator -= CONFIG.LOGIC_MS;
      steps += 1;
    }
    if (steps === CONFIG.MAX_CATCHUP_TICKS && logicAccumulator >= CONFIG.LOGIC_MS) {
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
  if (ui.isSettingsOpen()) return;
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
window.addEventListener("pagehide", () => saveState(state));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveState(state);
});

renderer.resize(state.player.pos);
sync();
requestAnimationFrame(frame);

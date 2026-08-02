import {
  attemptFlee,
  chooseBattleCommand,
  choosePlayerFormation,
  counterFormation,
  skipBattle
} from "./battle.js";
import { createBattleStage } from "./battle-stage.js";
import { CONFIG, SUPPORTED_LANGUAGES } from "./data.js";
import {
  advanceActIfNeeded,
  advanceOnboarding,
  beginAct2Promise,
  beginAct3Promise,
  checkLowGoldTooltip,
  consumeTooltip,
  dismissFiefThreat,
  submitPromise,
  trackTownEntry,
  updateSessionPeaks
} from "./demo.js";
import { createMapRenderer } from "./map.js";
import {
  chooseKingdomEdict,
  declineFounding,
  dismissFoundingSeal,
  foundKingdom,
  selectOrigin
} from "./kingdom.js";
import { CONFIG_PRESENTATION } from "./presentation.js";
import { stampSeal } from "./seal.js";
import {
  acceptMercenaryContract,
  buyTownBattleBuff,
  chooseRoadEvent,
  hireLieutenant,
  recruitMilitia,
  replenishVeteran,
  setFiefGarrison,
  setAutoplay,
  verifyRoadEventChoiceEffects,
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
// F1 act 1: v1.1 (formation RPS + 陈莽) stops being a URL experiment and
// becomes the FULL build's baseline -- it is on unconditionally whenever this
// is not the demo build.
//
// The demo build keeps the ?v=1.1 opt-in on purpose: the friend-test URLs and
// the result codes coming back from them have to keep meaning what they meant
// when they were handed out (GLOBAL RULE 5 treats that telemetry as tuning
// input, so its baseline must not shift under it).
//
// DEMO stays true until Act 3 is playable; flipping it is the F1 ship gate,
// not this commit, because main has to stay playable end to end (RULE 5).
const fullVersion = !CONFIG.DEMO;
const v11Enabled = fullVersion || query.get("v") === "1.1";
const autoplayEnabled = query.get("autoplay") === "1";
const holdAutoplayRoadEvents = autoplayEnabled && query.get("qa") === "1" && query.get("holdEvents") === "1";
const holdAutoplayFormations = autoplayEnabled && query.get("qa") === "1" && query.get("holdFormations") === "1";
const seedParameter = query.get("seed");
const requestedSeed = seedParameter === null ? Number.NaN : Number(seedParameter);
const autoplaySeed = Number.isFinite(requestedSeed) ? requestedSeed >>> 0 : CONFIG.SEED;
const qaFreshEnabled = !autoplayEnabled && query.get("qa") === "1" && query.get("fresh") === "1";
const qaRecruitRecoveryEnabled = qaFreshEnabled && query.get("recruitRecovery") === "1";
const qaAct2TownEnabled = qaFreshEnabled && query.get("act2Town") === "1";

let state = autoplayEnabled
  ? createInitialState(autoplaySeed, {
    startedAt: new Date(0).toISOString(),
    v11: v11Enabled,
    fullVersion,
    f2: fullVersion,
    f3: fullVersion
  })
  : qaFreshEnabled
    ? createInitialState(autoplaySeed, {
      skipOnboarding: true,
      startedAt: new Date(0).toISOString(),
      v11: v11Enabled,
      fullVersion,
      f2: fullVersion,
      f3: fullVersion
    })
    : loadState(undefined, { v11: v11Enabled, fullVersion, f2: fullVersion, f3: fullVersion });
const loadedExistingState = Boolean(state);
if (!state) state = createInitialState(CONFIG.SEED, {
  v11: v11Enabled,
  fullVersion,
  f2: fullVersion,
  f3: fullVersion
});
if (qaRecruitRecoveryEnabled) {
  state.player.gold = 164;
  state.player.troops = [{ type: "militia", count: 3, xp: 0 }];
  const recoveryTown = state.towns.find((town) => town.id === CONFIG.START_TOWN_ID);
  if (recoveryTown) recoveryTown.recruitPool = 0;
}
if (qaAct2TownEnabled) {
  state.player.act = 2;
  state.player.renown = CONFIG.ACT2_RENOWN;
  state.player.gold = 500;
  state.player.troops = [
    { type: "militia", count: 5, xp: 0 },
    { type: "veteran", count: 1, xp: 3 }
  ];
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
}
startTelemetrySession(state);

const renderer = createMapRenderer(canvas);
let saveAvailable = autoplayEnabled || qaFreshEnabled ? true : (loadedExistingState || saveState(state));
let logicAccumulator = 0;
let lastFrameAt = performance.now();
let activePointerId = null;
let ui;
let lastTooltipTownId = null;
let autoplayStopped = false;
let actIntroTimer = null;

const autoplayMetrics = {
  enabled: autoplayEnabled,
  variant: fullVersion ? "full" : v11Enabled ? "1.1" : "1.0",
  seed: state.seed,
  firstBattleSeconds: null,
  act2Seconds: null,
  endingSeconds: null,
  act3Seconds: null,
  fiefThreatSeconds: null,
  foundingSeconds: null,
  edictSeconds: null,
  endingPath: null,
  act2RawSeconds: null,
  endingRawSeconds: null,
  activeSeconds: 0,
  battleRoundCounts: [],
  roadEventCardsChecked: 0,
  roadEventChoicesChecked: 0
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
  if (autoplayEnabled || qaFreshEnabled) return true;
  saveAvailable = saveState(state);
  if (!saveAvailable && showFailure) ui.showToast("toast.saveFailed");
  return saveAvailable;
}

const STAGE_HINT_KEY = "the-crown.stage-hint-seen";

let battleStage = null;

function getBattleStage() {
  if (battleStage) return battleStage;
  battleStage = createBattleStage(document.body, {
    translate: (key) => ui.text(key),
    hintSeen: () => {
      try { return localStorage.getItem(STAGE_HINT_KEY) === "1"; } catch (error) { return false; }
    },
    persistHint: () => {
      try { localStorage.setItem(STAGE_HINT_KEY, "1"); } catch (error) { /* private mode */ }
    },
    // The brief's playback controls write to the engine's own playback record.
    onSpeedChange: (speed) => {
      if (state.battlePlayback) state.battlePlayback.speed = speed;
    },
    onSkip: () => {
      if (state.battlePlayback) state.battlePlayback.skip = true;
    }
  });
  return battleStage;
}

function handleBattleResult(result, options = {}) {
  if (!result) return;
  if (result.type === "victory") {
    if (!options.transition && !options.staged) stampSeal(ui.text("map.victorySeal"));
    ui.playVictoryFx(result.loot, result.renown);
    ui.showToast("toast.victory", { loot: result.loot });
  } else if (result.type === "defeat") {
    if (!options.staged) stampSeal(ui.text("map.defeatSeal"), { tone: "loss" });
    ui.showToast("toast.defeat", { townId: result.townId });
  }
}

function scheduleAct2Intro() {
  if (state.demo?.modal !== "act2Transition") return;
  if (autoplayEnabled) {
    beginAct2Promise(state);
    return;
  }
  if (actIntroTimer) clearTimeout(actIntroTimer);
  const pauseMs = CONFIG.ACT_TRANSITION_PAUSE_MS ?? 1000;
  stampSeal(ui.text("map.act2Seal"), { hold: Math.max(220, pauseMs - 320) });
  actIntroTimer = setTimeout(() => {
    actIntroTimer = null;
    if (!beginAct2Promise(state).advanced) return;
    persist(true);
    sync();
  }, pauseMs);
}

function scheduleAct3Intro() {
  if (state.demo?.modal !== "act3Transition") return;
  if (autoplayEnabled) {
    beginAct3Promise(state);
    return;
  }
  if (actIntroTimer) clearTimeout(actIntroTimer);
  const pauseMs = CONFIG.ACT_TRANSITION_PAUSE_MS ?? 1000;
  stampSeal(ui.text("map.fiefSeal"), { hold: Math.max(220, pauseMs - 320) });
  actIntroTimer = setTimeout(() => {
    actIntroTimer = null;
    if (!beginAct3Promise(state).advanced) return;
    persist(true);
    sync();
  }, pauseMs);
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
  let reportedSeconds = seconds;
  if (v11Enabled && ["act2Seconds", "endingSeconds"].includes(name)) {
    const simulationRoundSeconds = CONFIG.BATTLE_ROUND_TICKS * CONFIG.LOGIC_MS / 1000;
    const simulatedBattleSeconds = autoplayMetrics.battleRoundCounts.reduce(
      (sum, rounds) => sum + rounds * simulationRoundSeconds,
      0
    );
    const presentationSeconds = autoplayMetrics.battleRoundCounts.reduce((sum, rounds) => {
      const contact = (
        CONFIG_PRESENTATION.DEPLOY_MS +
        CONFIG_PRESENTATION.STANDOFF_MS +
        CONFIG_PRESENTATION.CHARGE_MS
      );
      const melee = Math.min(
        CONFIG_PRESENTATION.MELEE_MAX_MS,
        Math.max(
          CONFIG_PRESENTATION.MELEE_MIN_MS,
          rounds * (CONFIG_PRESENTATION.ROUND_MS + CONFIG_PRESENTATION.ROUND_BREATH_MS)
        )
      );
      const settlement = (
        CONFIG_PRESENTATION.ROUT_SLOWMO_MS +
        CONFIG_PRESENTATION.FLEE_MIN_MS +
        CONFIG_PRESENTATION.FLEE_VAR_MS +
        CONFIG_PRESENTATION.VICTORY_HOLD_MS
      );
      return sum + (contact + melee + settlement) / 1000;
    }, 0);
    reportedSeconds = seconds - simulatedBattleSeconds + presentationSeconds;
    autoplayMetrics[name === "act2Seconds" ? "act2RawSeconds" : "endingRawSeconds"] = seconds;
  }
  autoplayMetrics[name] = reportedSeconds;
  const label = name === "act2Seconds"
    ? "Act 2"
    : name === "endingSeconds"
      ? "renown 100"
      : name === "act3Seconds"
        ? "Act 3"
        : name === "fiefThreatSeconds"
          ? "first fief threat"
          : "first battle";
  const units = v11Enabled && name !== "firstBattleSeconds" ? "player minutes" : "active minutes";
  console.info(`[CROWN autoplay] ${label}: ${(reportedSeconds / 60).toFixed(2)} ${units}`);
}

function resolveAutoplayModal() {
  if (!autoplayEnabled || !state.demo?.modal) return false;
  if (state.demo.modal === "roadEvent") {
    if (holdAutoplayRoadEvents) return false;
    chooseRoadEvent(state, CONFIG.AUTOPLAY_ROAD_EVENT_CHOICE_INDEX);
    return true;
  }
  if (state.demo.modal === "onboarding") {
    advanceOnboarding(state);
    return true;
  }
  if (state.demo.modal === "origin") {
    selectOrigin(state, CONFIG.AUTOPLAY_F2_ORIGIN);
    return true;
  }
  if (state.demo.modal === "troopPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_TROOP_PROMISE, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    return true;
  }
  if (state.demo.modal === "act2Transition") {
    beginAct2Promise(state);
    return true;
  }
  if (state.demo.modal === "goldPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_GOLD_PROMISE, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    return true;
  }
  if (state.demo.modal === "act3Transition") {
    beginAct3Promise(state);
    return true;
  }
  if (state.demo.modal === "fiefPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_FIEF_PROMISE, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    return true;
  }
  if (state.demo.modal === "fiefThreat") {
    dismissFiefThreat(state);
    return true;
  }
  if (state.demo.modal === "founding") {
    foundKingdom(state);
    return true;
  }
  if (state.demo.modal === "foundingSeal") {
    dismissFoundingSeal(state);
    return true;
  }
  if (state.demo.modal === "kingdomEdict") {
    chooseKingdomEdict(state, query.get("ending") === "continue" ? "continue" : "stop");
    return true;
  }
  if (state.demo.modal === "formation") {
    if (holdAutoplayFormations) return false;
    const report = state.battle?.formations?.reportedEnemy || "line";
    choosePlayerFormation(state, counterFormation(report));
    return true;
  }
  if (state.demo.modal === "battleCommand") {
    chooseBattleCommand(state, CONFIG.F3_AUTOPLAY_COMMAND);
    return true;
  }
  return false;
}

function finishAutoplaySetup() {
  if (!autoplayEnabled) return;
  const eventAudit = verifyRoadEventChoiceEffects({ v11: v11Enabled });
  autoplayMetrics.roadEventCardsChecked = eventAudit.cardsChecked;
  autoplayMetrics.roadEventChoicesChecked = eventAudit.choicesChecked;
  if (!eventAudit.ok) {
    throw new Error(`Autoplay road-event effect mismatch: ${JSON.stringify(eventAudit.failures)}`);
  }
  console.info(
    `[CROWN autoplay] road-event effects ${eventAudit.choicesChecked}/${eventAudit.choicesChecked}: ok`
  );
  setAutoplay(state, true, {
    fullVersion,
    origin: CONFIG.AUTOPLAY_F2_ORIGIN,
    endingChoice: query.get("ending") === "continue" ? "continue" : "stop"
  });
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
  onRecruit(arm = "spear") {
    const town = activeTown(state);
    const from = town ? renderer.worldToScreen(town.pos) : null;
    const result = recruitMilitia(state, arm);
    if (result.ok) {
      updateSessionPeaks(state);
      persist(true);
      ui.playRecruitFx(from, renderer.worldToScreen(state.player.pos));
      ui.showToast("toast.recruited");
    } else if (result.reason === "gold") {
      ui.showToast("toast.goldInsufficient");
    } else if (result.reason === "pool") {
      ui.showToast("toast.recruitEmpty");
    } else if (result.reason === "paused") {
      ui.showToast("toast.paused");
    } else if (result.reason === "battle") {
      ui.showToast("toast.battleLocked");
    }
    checkLowGoldTooltip(state);
    showNextTooltip();
    sync();
  },
  onReplenishVeteran() {
    const town = activeTown(state);
    const from = town ? renderer.worldToScreen(town.pos) : null;
    const result = replenishVeteran(state);
    if (result.ok) {
      updateSessionPeaks(state);
      persist(true);
      ui.playRecruitFx(from, renderer.worldToScreen(state.player.pos));
      ui.showToast("toast.veteranReplenished");
    } else if (result.reason === "noVeterans") {
      ui.showToast("toast.noVeterans");
    } else if (result.reason === "gold") {
      ui.showToast("toast.goldInsufficient");
    } else if (result.reason === "pool") {
      ui.showToast("toast.recruitEmpty");
    } else if (result.reason === "paused") {
      ui.showToast("toast.paused");
    } else if (result.reason === "battle") {
      ui.showToast("toast.battleLocked");
    }
    checkLowGoldTooltip(state);
    showNextTooltip();
    sync();
  },
  onBuyBattleBuff() {
    const result = buyTownBattleBuff(state);
    if (result.ok) {
      persist(true);
      ui.showToast("toast.buffPurchased", {
        bonus: Math.round(CONFIG.TAVERN_ATTACK_BUFF_BONUS * 100)
      });
    } else if (result.reason === "active") {
      ui.showToast("toast.buffActive");
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
  onSetGarrison(townId, desired) {
    const result = setFiefGarrison(state, townId, desired);
    if (!result.ok) return;
    persist(true);
    sync();
  },
  onDismissFiefThreat() {
    if (!dismissFiefThreat(state).dismissed) return;
    lastFrameAt = performance.now();
    logicAccumulator = 0;
    persist(true);
    sync();
  },
  onSelectContract(contractId) {
    const result = acceptMercenaryContract(state, activeTown(state)?.id || null, contractId);
    if (result.ok) {
      persist(true);
      ui.showToast("toast.contractAccepted");
    } else if (result.reason === "paused") {
      ui.showToast("toast.paused");
    } else if (result.reason === "battle") {
      ui.showToast("toast.battleLocked");
    } else {
      ui.showToast("toast.contractUnavailable");
    }
    sync();
  },
  onHireLieutenant() {
    const result = hireLieutenant(state);
    if (result.ok) {
      persist(true);
      ui.showToast("toast.lieutenantHired");
    } else if (result.reason === "gold") {
      ui.showToast("toast.goldInsufficient");
    } else {
      ui.showToast("toast.lieutenantUnavailable");
    }
    sync();
  },
  onChooseFormation(formation) {
    const result = choosePlayerFormation(state, formation);
    if (!result.ok) return;
    lastFrameAt = performance.now();
    logicAccumulator = 0;
    persist(true);
    sync();
  },
  onChooseBattleCommand(command) {
    const result = chooseBattleCommand(state, command);
    if (!result.ok) return;
    lastFrameAt = performance.now();
    logicAccumulator = 0;
    persist(true);
    sync();
  },
  onRoadEventChoice(choiceIndex) {
    const result = chooseRoadEvent(state, choiceIndex);
    if (!result.ok) return;
    updateSessionPeaks(state);
    persist(true);
    sync();
    ui.showRoadEventResult(result);
  },
  onSkipBattle() {
    if (state.paused) {
      ui.showToast("toast.paused");
      return;
    }
    const result = skipBattle(state);
    updateSessionPeaks(state);
    const transition = advanceActIfNeeded(state, undefined, { demoBuild: CONFIG.DEMO });
    const script = result?.battleScript || state.battleScript;

    const settle = (staged) => {
      handleBattleResult(result, { transition: Boolean(transition), staged });
      if (transition?.type === "ending") stampSeal(ui.text("ending.seal"));
      if (transition?.type === "act2") scheduleAct2Intro();
      if (transition?.type === "act3") scheduleAct3Intro();
      persist(true);
      sync();
    };

    if (!script) {
      settle(false);
      return;
    }
    // The stage is a replay of an already-resolved battle: state is settled
    // before a single frame plays, so a mid-playback reload loses no progress.
    persist(true);
    sync();
    getBattleStage().play(script, () => settle(true));
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
  onSelectOrigin(originId) {
    if (!selectOrigin(state, originId).ok) return;
    persist(true);
    sync();
  },
  onFoundKingdom() {
    const result = foundKingdom(state);
    if (!result.ok) return;
    stampSeal(ui.text("kingdom.seal"));
    persist(true);
    sync();
  },
  onDeclineFounding() {
    if (!declineFounding(state).ok) return;
    persist(true);
    sync();
  },
  onDismissFoundingSeal() {
    if (!dismissFoundingSeal(state).ok) return;
    lastFrameAt = performance.now();
    logicAccumulator = 0;
    persist(true);
    sync();
  },
  onKingdomEdict(choice) {
    const result = chooseKingdomEdict(state, choice);
    if (!result.ok) return;
    if (result.type === "ending") stampSeal(ui.text("ending.fullSeal"));
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
      if (!fullVersion) {
        next.demo.modal = "troopPromise";
        next.demo.pauseReason = "promise";
        next.paused = true;
      }
      replaceState(next);
      return;
    }
    const next = createInitialState(nextWorldSeed(state), {
      language: state.settings.language,
      replayCount: state.telemetry.replayCount,
      startedAt: new Date().toISOString(),
      v11: v11Enabled,
      fullVersion,
      f2: fullVersion,
      f3: fullVersion
    });
    replaceState(next);
  }
});

finishAutoplaySetup();
if (!autoplayEnabled && state.demo?.modal === "act2Transition") scheduleAct2Intro();
if (!autoplayEnabled && state.demo?.modal === "act3Transition") scheduleAct3Intro();

function runLogicStep() {
  if (autoplayStopped) return;
  const result = worldTick(state);
  if (!result.advanced) {
    if (resolveAutoplayModal()) sync();
    return;
  }

  updateSessionPeaks(state);
  const activeSeconds = state.telemetry.totalActiveSeconds;
  autoplayMetrics.activeSeconds = activeSeconds;
  if (result.battleResult?.battleScript) {
    autoplayMetrics.battleRoundCounts.push(
      result.battleResult.battleScript.events.filter((event) => event.type === "round_start").length
    );
  }
  if (state.stats.battles > 0) recordAutoplayMilestone("firstBattleSeconds", activeSeconds);

  const transition = advanceActIfNeeded(
    state,
    autoplayEnabled ? new Date(state.tick * CONFIG.LOGIC_MS).toISOString() : undefined,
    { demoBuild: CONFIG.DEMO }
  );
  handleBattleResult(result.battleResult, { transition: Boolean(transition) });
  if (transition?.type === "ending" && !autoplayEnabled) stampSeal(ui.text("ending.seal"));
  if (transition?.type === "act2") recordAutoplayMilestone("act2Seconds", activeSeconds);
  if (transition?.type === "act2" && autoplayEnabled) {
    state.autoplay.nextHuntTick = state.tick + CONFIG.AUTOPLAY_ACT2_RECOVERY_TICKS;
  }
  if (transition?.type === "ending") recordAutoplayMilestone("endingSeconds", activeSeconds);
  if (transition?.type === "act3") recordAutoplayMilestone("act3Seconds", activeSeconds);
  if (transition?.type === "founding") recordAutoplayMilestone("foundingSeconds", activeSeconds);
  if (state.kingdom?.decisionCount > 0) {
    recordAutoplayMilestone("edictSeconds", activeSeconds);
    autoplayMetrics.endingPath = state.kingdom.endingPath;
  }
  if (state.telemetry.chronicle.fiefThreat) {
    recordAutoplayMilestone(
      "fiefThreatSeconds",
      state.telemetry.chronicle.fiefThreat.activeSeconds ?? activeSeconds
    );
  }
  while (resolveAutoplayModal()) {
    // Resolve the Act 2 mirror question before the next simulated tick.
  }
  if (transition?.type === "act2" && !autoplayEnabled) scheduleAct2Intro();
  if (transition?.type === "act3" && !autoplayEnabled) scheduleAct3Intro();

  const townId = activeTown(state)?.id || null;
  if (townId !== lastTooltipTownId || result.dayAdvanced || result.battleResult) showNextTooltip();

  if (result.dayAdvanced) {
    saveAvailable = autoplayEnabled ? true : autosaveState(state, result);
  } else if (result.battleResult || transition) {
    persist();
  }

  const autoplayLimit = fullVersion
    ? CONFIG.AUTOPLAY_F2_HARD_LIMIT_SECONDS
    : CONFIG.AUTOPLAY_MAX_ACTIVE_SECONDS;
  if (autoplayEnabled && !state.demo.ended && activeSeconds >= autoplayLimit) {
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
  if (autoplayEnabled || qaFreshEnabled) return;
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

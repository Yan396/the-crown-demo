import { CONFIG, TROOP_TYPES } from "./data.js";
import { addEvent, getTroopCount } from "./state.js";
import {
  finalizeTelemetry,
  recordChronicleMilestone,
  recordPromiseCrossing
} from "./telemetry.js";

function timestamp(value) {
  return value || new Date().toISOString();
}

export function getDailyWage(party) {
  return party.troops.reduce((total, stack) => {
    return total + (TROOP_TYPES[stack.type]?.wage || 0) * stack.count;
  }, 0);
}

export function actTroopCap(state) {
  return state.player.act >= 2 ? CONFIG.ACT2_TROOP_CAP : CONFIG.ACT1_TROOP_CAP;
}

export function isDemoModalOpen(state) {
  return Boolean(state.demo?.modal);
}

export function advanceOnboarding(state) {
  if (state.demo?.modal !== "onboarding") return { advanced: false };
  if (state.demo.onboardingStep < 2) {
    state.demo.onboardingStep += 1;
    return { advanced: true, step: state.demo.onboardingStep };
  }
  state.demo.modal = "troopPromise";
  state.demo.pauseReason = "promise";
  state.paused = true;
  return { advanced: true, promise: "troops" };
}

function normalizedPromiseValue(kind, value) {
  const minimum = kind === "troops" ? CONFIG.PROMISE_TROOPS_MIN : CONFIG.PROMISE_GOLD_MIN;
  const maximum = kind === "troops" ? CONFIG.PROMISE_TROOPS_MAX : CONFIG.PROMISE_GOLD_MAX;
  const step = kind === "troops" ? CONFIG.PROMISE_TROOPS_STEP : CONFIG.PROMISE_GOLD_STEP;
  const numeric = Number(value);
  const clamped = Math.max(minimum, Math.min(maximum, Number.isFinite(numeric) ? numeric : minimum));
  return Math.round(clamped / step) * step;
}

export function submitPromise(state, value, occurredAt) {
  const modal = state.demo?.modal;
  const kind = modal === "troopPromise" ? "troops" : modal === "goldPromise" ? "gold" : null;
  if (!kind) return { accepted: false };
  const act = kind === "troops" ? 1 : 2;
  const statedGoal = normalizedPromiseValue(kind, value);
  const existing = state.player.promises.find((entry) => entry.act === act);
  if (existing) {
    existing.statedGoal = statedGoal;
  } else {
    state.player.promises.push({
      act,
      kind,
      statedGoal,
      actualAtActEnd: null,
      exceeded: false,
      exceededAtTick: null
    });
  }
  state.telemetry.promiseValues[kind] = statedGoal;
  if (kind === "troops") {
    state.demo.onboardingComplete = true;
  } else {
    queueTooltip(state, "act2");
  }
  state.demo.modal = null;
  state.demo.pauseReason = null;
  state.paused = false;
  updatePromiseOvershoots(state);
  return { accepted: true, act, kind, statedGoal, occurredAt: timestamp(occurredAt) };
}

export function setPromise(state, value, kind) {
  if (kind === "troops") state.demo.modal = "troopPromise";
  if (kind === "gold") state.demo.modal = "goldPromise";
  return submitPromise(state, value);
}

export function updatePromiseOvershoots(state) {
  for (const promise of state.player.promises) {
    const actual = promise.kind === "gold" ? state.player.gold : getTroopCount(state.player);
    if (!promise.exceeded && actual > promise.statedGoal) {
      promise.exceeded = true;
      promise.exceededAtTick = state.tick;
    }
    if (promise.exceeded) {
      recordPromiseCrossing(state, promise.kind, {
        tick: promise.exceededAtTick ?? state.tick,
        statedGoal: promise.statedGoal,
        actual: actual > promise.statedGoal ? actual : null
      });
    }
  }
}

export function updateSessionPeaks(state) {
  state.stats.peakTroops = Math.max(state.stats.peakTroops || 0, getTroopCount(state.player));
  state.stats.peakGold = Math.max(state.stats.peakGold || 0, state.player.gold);
  updatePromiseOvershoots(state);
}

export function queueTooltip(state, id) {
  if (!state.demo || state.demo.tooltipsSeen[id]) return false;
  if (!state.demo.pendingTooltips.includes(id)) state.demo.pendingTooltips.push(id);
  return true;
}

export function consumeTooltip(state) {
  if (!state.demo || state.demo.modal || state.demo.ended) return null;
  while (state.demo.pendingTooltips.length) {
    const id = state.demo.pendingTooltips.shift();
    if (state.demo.tooltipsSeen[id]) continue;
    state.demo.tooltipsSeen[id] = true;
    state.telemetry.tooltipViews[id] = (state.telemetry.tooltipViews[id] || 0) + 1;
    return id;
  }
  return null;
}

export function trackTownEntry(state, townId) {
  const previous = state.demo.lastTownId;
  state.demo.lastTownId = townId || null;
  if (!townId || previous === townId) return false;
  state.telemetry.townEntries += 1;
  queueTooltip(state, "town");
  return true;
}

export function checkLowGoldTooltip(state) {
  const wage = getDailyWage(state.player);
  if (wage > 0 && state.player.gold < wage * CONFIG.LOW_GOLD_WAGE_DAYS) {
    return queueTooltip(state, "lowGold");
  }
  return false;
}

export function advanceActIfNeeded(state, occurredAt) {
  if (!CONFIG.DEMO || state.demo.ended || state.demo.modal) return null;
  const now = timestamp(occurredAt);
  if (state.player.act === 1 && state.player.renown >= CONFIG.ACT2_RENOWN) {
    const promise = state.player.promises.find((entry) => entry.act === 1);
    if (!promise) return null;
    promise.actualAtActEnd = getTroopCount(state.player);
    state.telemetry.promiseFinalActuals.troops = promise.actualAtActEnd;
    state.player.act = 2;
    state.demo.act2Tick = state.tick;
    state.demo.modal = "act2Transition";
    state.demo.pauseReason = "actTransition";
    state.paused = true;
    state.telemetry.actTimestamps.act2 ||= now;
    recordChronicleMilestone(state, "act2", { renown: state.player.renown });
    addEvent(state, "log.act2", {}, "win");
    return { type: "act2", tick: state.tick };
  }
  if (state.player.act === 2 && state.player.renown >= CONFIG.DEMO_END_RENOWN) {
    const promise = state.player.promises.find((entry) => entry.act === 2);
    if (!promise) return null;
    return completeDemo(state, now);
  }
  return null;
}

export function beginAct2Promise(state) {
  if (state.demo?.modal !== "act2Transition") return { advanced: false };
  state.demo.modal = "goldPromise";
  state.demo.pauseReason = "promise";
  state.paused = true;
  return { advanced: true, promise: "gold" };
}

export function completeDemo(state, occurredAt) {
  if (state.demo.ended) return { type: "ending", tick: state.demo.endingTick };
  const goldPromise = state.player.promises.find((entry) => entry.act === 2);
  if (goldPromise) {
    goldPromise.actualAtActEnd = state.player.gold;
    state.telemetry.promiseFinalActuals.gold = goldPromise.actualAtActEnd;
  }
  updateSessionPeaks(state);
  state.demo.ended = true;
  state.demo.endingTick = state.tick;
  state.demo.modal = "ending";
  state.demo.pauseReason = "ending";
  state.paused = true;
  state.ending = { complete: true, visible: true, tick: state.tick };
  recordChronicleMilestone(state, "ending", { renown: state.player.renown });
  finalizeTelemetry(state, timestamp(occurredAt));
  return { type: "ending", tick: state.tick };
}

export function buildEndingSummary(state, occurredAt) {
  completeDemo(state, occurredAt);
  const battles = state.stats.battles || 0;
  const wins = state.stats.wins || 0;
  return {
    promises: state.player.promises.map((entry) => ({ ...entry })),
    stats: {
      days: state.stats.days || 0,
      battles,
      winRate: battles ? wins / battles : 0,
      peakTroops: state.stats.peakTroops || 0,
      peakGold: state.stats.peakGold || 0
    }
  };
}

export const checkActProgression = advanceActIfNeeded;
export const finishDemo = buildEndingSummary;

export function nextReplaySeed(state) {
  const replay = (state.telemetry?.replayCount || 0) + 1;
  return (state.seed + Math.imul(replay, 0x9e3779b9) + 0x6d2b79f5) >>> 0;
}

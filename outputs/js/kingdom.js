import { CONFIG, TOKENS } from "./data.js";
import {
  addEvent,
  clamp,
  copyPosition,
  getFaction,
  getTown,
  getTroopCount,
  incrementTroop
} from "./state.js";
import { finalizeTelemetry } from "./telemetry.js";
import { buildChronicleEntries } from "./chronicle.js";

const PLAYER_FACTION_ID = "player";

function moment(state, details = {}) {
  return {
    kind: details.kind || "kingdom",
    tick: state.tick,
    day: Math.floor(state.tick / CONFIG.TICKS_PER_DAY) + 1,
    activeSeconds: Number(state.telemetry?.totalActiveSeconds) || 0,
    ...details
  };
}

export function recordKingdomChronicle(state, kind, details = {}) {
  state.telemetry.chronicleEvents ||= [];
  const entry = moment(state, { kind, ...details });
  state.telemetry.chronicleEvents.push(entry);
  state.telemetry.chronicleEvents = state.telemetry.chronicleEvents.slice(-CONFIG.KINGDOM_CHRONICLE_EVENT_LIMIT);
  return entry;
}

export function selectOrigin(state, originId) {
  if (state.demo?.modal !== "origin" || state.kingdom?.origin) return { ok: false };
  const bonus = CONFIG.ORIGIN_BONUSES[originId];
  if (!bonus) return { ok: false };
  state.kingdom.origin = originId;
  state.player.origin = originId;
  state.player.gold += bonus.gold;
  state.player.renown += bonus.renown;
  state.demo.modal = "onboarding";
  state.demo.pauseReason = "onboarding";
  state.paused = true;
  recordKingdomChronicle(state, "origin", { originId });
  return { ok: true, originId, bonus: { ...bonus } };
}

function livingOriginalFactions(state) {
  return state.factions.filter((faction) => faction.id !== PLAYER_FACTION_ID && faction.alive);
}

function declareExpansionWar(state, patron, enemy) {
  if (!patron || !enemy || patron.atWarWith.includes(enemy.id)) return false;
  patron.atWarWith.push(enemy.id);
  enemy.atWarWith.push(patron.id);
  patron.atWarWith.sort();
  enemy.atWarWith.sort();
  patron.relations[enemy.id] = CONFIG.WAR_RELATION_THRESHOLD;
  enemy.relations[patron.id] = CONFIG.WAR_RELATION_THRESHOLD;
  patron.warStartedDays[enemy.id] = state.stats.days;
  enemy.warStartedDays[patron.id] = state.stats.days;
  if (state.mechanics) state.mechanics.warsDeclared += 1;
  addEvent(state, "log.warDeclared", {
    firstFactionId: patron.id,
    secondFactionId: enemy.id,
    relation: CONFIG.WAR_RELATION_THRESHOLD
  }, "danger");
  return true;
}

function expansionTarget(state, patron) {
  const enemies = livingOriginalFactions(state)
    .filter((faction) => faction.id !== patron.id && state.towns.some((town) => town.factionId === faction.id))
    .sort((first, second) => (
      Number(patron.relations[first.id] || 0) - Number(patron.relations[second.id] || 0) ||
      first.id.localeCompare(second.id)
    ));
  const enemy = enemies.find((candidate) => patron.atWarWith.includes(candidate.id)) || enemies[0];
  if (!enemy) return null;
  declareExpansionWar(state, patron, enemy);
  const held = state.player.fiefs.map((townId) => getTown(state, townId)).filter(Boolean);
  return state.towns
    .filter((town) => town.factionId === enemy.id)
    .map((town) => ({
      town,
      distance: held.reduce((minimum, fief) => Math.min(
        minimum,
        Math.hypot(town.pos.x - fief.pos.x, town.pos.y - fief.pos.y)
      ), Number.POSITIVE_INFINITY)
    }))
    .sort((first, second) => first.distance - second.distance || first.town.id.localeCompare(second.town.id))[0]?.town || null;
}

function musterPatronExpansion(state, patron) {
  if (!patron || state.player.fiefs.length >= CONFIG.ACT4_TOWN_COUNT) return null;
  const target = expansionTarget(state, patron);
  const lord = state.lords
    .filter((candidate) => candidate.factionId === patron.id)
    .sort((first, second) => getTroopCount(second) - getTroopCount(first) || first.id.localeCompare(second.id))[0];
  if (!target || !lord) return null;
  const missing = Math.max(0, CONFIG.ACT3_EXPANSION_LORD_MIN_TROOPS - getTroopCount(lord));
  if (missing) incrementTroop(lord, "militia", missing);
  lord.aiState = "attack";
  lord.targetKind = "town";
  lord.targetId = target.id;
  lord.moveTarget = copyPosition(target.pos);
  lord.aiStateSinceTick = state.tick;
  return { lord, target };
}

export function processAct3Expansion(state) {
  if (
    !state.features?.f2 ||
    state.player.act !== 3 ||
    state.kingdom.founded ||
    !state.player.factionId
  ) return null;
  const patron = getFaction(state, state.player.factionId);
  if (!patron) return null;
  let awarded = null;
  if (
    state.player.renown >= CONFIG.ACT3_SECOND_FIEF_RENOWN &&
    state.player.fiefs.length < 2
  ) {
    const town = state.towns
      .filter((candidate) => candidate.factionId === patron.id && !state.player.fiefs.includes(candidate.id))
      .sort((first, second) => first.id.localeCompare(second.id))[0];
    if (town) {
      state.player.fiefs.push(town.id);
      state.kingdom.expansionAwards += 1;
      awarded = town;
      recordKingdomChronicle(state, "fiefExpanded", { townId: town.id, factionId: patron.id });
      addEvent(state, "log.fiefExpanded", { townId: town.id, factionId: patron.id }, "win");
    }
  }
  const march = musterPatronExpansion(state, patron);
  return awarded || march ? { awarded: awarded?.id || null, target: march?.target.id || null } : null;
}

export function awardPatronCapture(state, town, oldFactionId, attackerFactionId) {
  if (
    !state.features?.f2 ||
    state.player.act !== 3 ||
    state.kingdom.founded ||
    attackerFactionId !== state.player.factionId ||
    oldFactionId === attackerFactionId ||
    state.player.fiefs.length >= CONFIG.ACT4_TOWN_COUNT ||
    state.player.fiefs.includes(town.id)
  ) return false;
  state.player.fiefs.push(town.id);
  state.kingdom.expansionAwards += 1;
  recordKingdomChronicle(state, "fiefExpanded", { townId: town.id, factionId: attackerFactionId });
  addEvent(state, "log.fiefExpanded", { townId: town.id, factionId: attackerFactionId }, "win");
  return true;
}

export function canOfferFounding(state) {
  if (
    !state.features?.f2 ||
    state.kingdom.founded ||
    state.player.act < 3 ||
    state.player.renown < CONFIG.ACT4_RENOWN ||
    state.player.fiefs.length < CONFIG.ACT4_TOWN_COUNT
  ) return false;
  const declined = state.kingdom.foundingDeclinedDay;
  return declined === null || state.stats.days - declined >= CONFIG.FOUNDING_REOFFER_DAYS;
}

export function offerFoundingIfNeeded(state) {
  if (state.demo?.modal || !canOfferFounding(state)) return null;
  state.kingdom.foundingOffered = true;
  state.demo.modal = "founding";
  state.demo.pauseReason = "founding";
  state.paused = true;
  return { type: "founding", tick: state.tick };
}

export function declineFounding(state) {
  if (state.demo?.modal !== "founding") return { ok: false };
  state.kingdom.foundingDeclinedDay = state.stats.days;
  state.demo.modal = null;
  state.demo.pauseReason = null;
  state.paused = false;
  recordKingdomChronicle(state, "foundingDeclined");
  return { ok: true };
}

function createPlayerFaction(state) {
  const existing = getFaction(state, PLAYER_FACTION_ID);
  if (existing) return existing;
  const originals = livingOriginalFactions(state);
  const faction = {
    id: PLAYER_FACTION_ID,
    nameKey: "factions.player",
    color: TOKENS.cinnabar,
    rulerNameIndex: -1,
    atWarWith: originals.map((entry) => entry.id).sort(),
    aggression: CONFIG.KINGDOM_PLAYER_AGGRESSION,
    relations: Object.fromEntries(originals.map((entry) => [entry.id, CONFIG.KINGDOM_WAR_RELATION])),
    warStartedDays: Object.fromEntries(originals.map((entry) => [entry.id, state.stats.days])),
    initialTownCount: state.player.fiefs.length,
    alive: true
  };
  originals.forEach((other) => {
    if (!other.atWarWith.includes(PLAYER_FACTION_ID)) other.atWarWith.push(PLAYER_FACTION_ID);
    other.atWarWith.sort();
    other.relations[PLAYER_FACTION_ID] = CONFIG.KINGDOM_WAR_RELATION;
    other.warStartedDays[PLAYER_FACTION_ID] = state.stats.days;
  });
  state.factions.push(faction);
  return faction;
}

export function foundKingdom(state) {
  if (state.demo?.modal !== "founding" || !canOfferFounding(state)) return { ok: false };
  const previousFactionId = state.player.factionId;
  createPlayerFaction(state);
  state.player.fiefs.forEach((townId) => {
    const town = getTown(state, townId);
    if (town) town.factionId = PLAYER_FACTION_ID;
  });
  state.player.factionId = PLAYER_FACTION_ID;
  state.player.act = 4;
  state.kingdom.founded = true;
  state.kingdom.foundedTick = state.tick;
  state.kingdom.foundedDay = state.stats.days;
  state.kingdom.kingDays = 0;
  state.kingdom.nextDecisionDay = CONFIG.KINGDOM_DECISION_INTERVAL_DAYS;
  state.kingdom.foundingDeclinedDay = null;
  state.demo.modal = "foundingSeal";
  state.demo.pauseReason = "actTransition";
  state.paused = true;
  state.telemetry.actTimestamps.act4 ||= new Date(
    Date.parse(state.telemetry.sessionStart || new Date(0).toISOString()) +
    state.telemetry.totalActiveSeconds * 1000
  ).toISOString();
  recordKingdomChronicle(state, "founded", { previousFactionId });
  addEvent(state, "log.kingdomFounded", { previousFactionId }, "win");
  return { ok: true, type: "founded", factionId: PLAYER_FACTION_ID };
}

export function dismissFoundingSeal(state) {
  if (state.demo?.modal !== "foundingSeal") return { ok: false };
  state.demo.modal = null;
  state.demo.pauseReason = null;
  state.paused = false;
  return { ok: true };
}

function weakestFief(state) {
  return state.player.fiefs
    .map((townId) => getTown(state, townId))
    .filter(Boolean)
    .map((town) => ({
      town,
      garrison: (town.garrison || []).reduce((sum, stack) => sum + stack.count, 0)
    }))
    .sort((first, second) => first.garrison - second.garrison || first.town.id.localeCompare(second.town.id))[0] || null;
}

function launchCoalitionWave(state) {
  const weakest = weakestFief(state)?.town;
  if (!weakest) return null;
  const marchers = livingOriginalFactions(state).map((faction) => {
    const lord = state.lords
      .filter((candidate) => candidate.factionId === faction.id)
      .sort((first, second) => getTroopCount(second) - getTroopCount(first) || first.id.localeCompare(second.id))[0];
    if (!lord) return null;
    incrementTroop(lord, "militia", CONFIG.KINGDOM_COALITION_REINFORCEMENTS);
    lord.aiState = "attack";
    lord.targetKind = "town";
    lord.targetId = weakest.id;
    lord.moveTarget = copyPosition(weakest.pos);
    lord.aiStateSinceTick = state.tick;
    return lord.id;
  }).filter(Boolean);
  state.kingdom.coalitionWaves += 1;
  recordKingdomChronicle(state, "coalition", { townId: weakest.id, wave: state.kingdom.coalitionWaves });
  addEvent(state, "log.coalitionWave", {
    townId: weakest.id,
    wave: state.kingdom.coalitionWaves,
    count: marchers.length
  }, "danger");
  return { townId: weakest.id, lords: marchers };
}

function warnRebellion(state, kingDay) {
  const weakest = weakestFief(state);
  if (!weakest) return null;
  state.kingdom.pendingRebellionTownId = weakest.town.id;
  state.kingdom.lastRebellionWarningDay = kingDay;
  addEvent(state, "log.rebellionWarning", {
    townId: weakest.town.id,
    garrison: weakest.garrison,
    threshold: CONFIG.KINGDOM_REBELLION_GARRISON_MIN +
      state.kingdom.decisionCount * CONFIG.KINGDOM_REBELLION_ESCALATION_PER_EDICT
  }, "danger");
  return weakest.town.id;
}

function resolveRebellion(state) {
  const selected = getTown(state, state.kingdom.pendingRebellionTownId) || weakestFief(state)?.town;
  state.kingdom.pendingRebellionTownId = null;
  state.kingdom.rebellionChecks += 1;
  if (!selected || !state.player.fiefs.includes(selected.id)) return { rebelled: false };
  const garrison = (selected.garrison || []).reduce((sum, stack) => sum + stack.count, 0);
  const threshold = CONFIG.KINGDOM_REBELLION_GARRISON_MIN +
    state.kingdom.decisionCount * CONFIG.KINGDOM_REBELLION_ESCALATION_PER_EDICT;
  if (garrison >= threshold) {
    addEvent(state, "log.rebellionHeld", { townId: selected.id, garrison, threshold }, "win");
    return { rebelled: false, townId: selected.id, garrison, threshold };
  }
  const fallback = getFaction(state, selected.originalFactionId)?.alive
    ? selected.originalFactionId
    : livingOriginalFactions(state)[0]?.id;
  state.player.fiefs = state.player.fiefs.filter((townId) => townId !== selected.id);
  if (fallback) selected.factionId = fallback;
  selected.underSiege = false;
  selected.siegeAttackerId = null;
  selected.siegeTicks = 0;
  selected.siegeDays = 0;
  selected.siege = null;
  state.kingdom.rebellions += 1;
  recordKingdomChronicle(state, "rebellion", { townId: selected.id, garrison, threshold });
  addEvent(state, "log.rebellion", { townId: selected.id, garrison, threshold }, "danger");
  return { rebelled: true, townId: selected.id, garrison, threshold };
}

export function processKingdomDay(state) {
  if (!state.kingdom?.founded || state.demo.ended) return null;
  const kingDay = Math.max(0, state.stats.days - state.kingdom.foundedDay);
  state.kingdom.kingDays = kingDay;
  const result = { kingDay, coalition: null, warning: null, rebellion: null, decision: false };
  if (kingDay > 0 && kingDay % CONFIG.KINGDOM_COALITION_WAVE_DAYS === 0) {
    result.coalition = launchCoalitionWave(state);
  }
  const interval = CONFIG.KINGDOM_REBELLION_INTERVAL_DAYS;
  if (kingDay > 0 && kingDay % interval === interval - CONFIG.KINGDOM_REBELLION_WARNING_DAYS) {
    result.warning = warnRebellion(state, kingDay);
  }
  if (kingDay > 0 && kingDay % interval === 0) result.rebellion = resolveRebellion(state);
  if (kingDay >= state.kingdom.nextDecisionDay && !state.demo.modal) {
    state.demo.modal = "kingdomEdict";
    state.demo.pauseReason = "kingdomEdict";
    state.paused = true;
    result.decision = true;
  }
  return result;
}

function finishFullEnding(state, occurredAt) {
  const fiefPromise = state.player.promises.find((entry) => entry.act === 3);
  if (fiefPromise) {
    fiefPromise.actualAtActEnd = state.player.fiefs.length;
    state.telemetry.promiseFinalActuals.fiefs = fiefPromise.actualAtActEnd;
  }
  state.demo.ended = true;
  state.demo.endingTick = state.tick;
  state.demo.modal = "ending";
  state.demo.pauseReason = "ending";
  state.paused = true;
  state.ending = {
    complete: true,
    visible: true,
    tick: state.tick,
    mode: "full",
    path: state.kingdom.endingPath
  };
  recordKingdomChronicle(state, "ending", { path: state.kingdom.endingPath });
  state.telemetry.endingChronicle = buildChronicleEntries(
    state.telemetry,
    state.settings?.language || "zh",
    { full: true }
  );
  finalizeTelemetry(state, occurredAt);
  return { ok: true, type: "ending", path: state.kingdom.endingPath };
}

export function chooseKingdomEdict(state, choice, occurredAt = new Date().toISOString()) {
  if (state.demo?.modal !== "kingdomEdict" || !["continue", "stop"].includes(choice)) {
    return { ok: false };
  }
  state.kingdom.decisionCount += 1;
  if (choice === "continue") {
    state.kingdom.conquestContinues = true;
    state.kingdom.endingPath = "conquest";
    state.kingdom.renownFrozenAt ??= state.player.renown;
    state.kingdom.nextDecisionDay += CONFIG.KINGDOM_DECISION_INTERVAL_DAYS;
    state.demo.modal = null;
    state.demo.pauseReason = null;
    state.paused = false;
    recordKingdomChronicle(state, "edictContinue", { kingDay: state.kingdom.kingDays });
    return { ok: true, type: "continue", nextDecisionDay: state.kingdom.nextDecisionDay };
  }
  state.kingdom.endingPath = state.kingdom.conquestContinues ? "conquest_then_stop" : "stop";
  recordKingdomChronicle(state, "edictStop", { kingDay: state.kingdom.kingDays });
  return finishFullEnding(state, occurredAt);
}

export function kingdomProgress(state) {
  if (state.kingdom?.founded) {
    return {
      kind: "kingDays",
      value: state.kingdom.kingDays,
      target: state.kingdom.nextDecisionDay
    };
  }
  return {
    kind: "founding",
    renown: state.player.renown,
    renownTarget: CONFIG.ACT4_RENOWN,
    towns: state.player.fiefs.length,
    townTarget: CONFIG.ACT4_TOWN_COUNT
  };
}

export { PLAYER_FACTION_ID };

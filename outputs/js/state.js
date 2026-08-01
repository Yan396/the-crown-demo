import {
  CONFIG,
  FACTION_DATA,
  LORD_DATA,
  LORD_START_FRACTIONS,
  SUPPORTED_LANGUAGES,
  TOWN_DATA,
  TROOP_TYPES
} from "./data.js";
import { createRng, isValidRng, randomBetween, randomInt } from "./rng.js";
import { createTelemetry, normalizeTelemetry } from "./telemetry.js";

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function copyPosition(position) {
  return { x: position.x, y: position.y };
}

export function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

export function getFaction(state, id) {
  return state.factions.find((faction) => faction.id === id) || null;
}

export function getTown(state, id) {
  return state.towns.find((town) => town.id === id) || null;
}

export function getLord(state, id) {
  return state.lords.find((lord) => lord.id === id) || null;
}

export function getTroopCount(party) {
  return party.troops.reduce((sum, stack) => sum + stack.count, 0);
}

export function getPartyStrength(party) {
  return party.troops.reduce((sum, stack) => {
    const type = TROOP_TYPES[stack.type];
    return sum + (type ? type.atk * stack.count : 0);
  }, 0);
}

export function getAverageDefense(party) {
  const total = getTroopCount(party);
  if (total <= 0) return 1;
  const defense = party.troops.reduce((sum, stack) => {
    const type = TROOP_TYPES[stack.type];
    return sum + (type ? type.def * stack.count : 0);
  }, 0);
  return defense / total;
}

export function incrementTroop(party, type, amount = 1) {
  let stack = party.troops.find((entry) => entry.type === type);
  if (!stack) {
    stack = { type, count: 0, xp: 0 };
    party.troops.push(stack);
  }
  stack.count = Math.max(0, stack.count + Math.floor(amount));
  return stack.count;
}

export function applyCasualties(party, casualtyCount) {
  let remaining = Math.max(0, Math.floor(casualtyCount));
  let applied = 0;
  for (const stack of party.troops) {
    if (remaining <= 0) break;
    const loss = Math.min(stack.count, remaining);
    stack.count -= loss;
    remaining -= loss;
    applied += loss;
  }
  party.troops = party.troops.filter((stack) => stack.count > 0);
  return applied;
}

export function awardSurvivorXp(party) {
  party.troops.forEach((stack) => {
    if (stack.count > 0) stack.xp += CONFIG.SURVIVOR_XP_PER_WIN;
  });
  const militia = party.troops.find((stack) => stack.type === "militia" && stack.xp >= 3);
  if (militia?.count > 0) {
    const promoted = militia.count;
    party.troops = party.troops.filter((stack) => stack !== militia);
    incrementTroop(party, "veteran", promoted);
  }
}

export function nearestTown(state, position, predicate = () => true) {
  return state.towns.filter(predicate).reduce((nearest, town) => {
    if (!nearest) return town;
    return distance(position, town.pos) < distance(position, nearest.pos) ? town : nearest;
  }, null);
}

export function nearestOwnTown(state, party) {
  return nearestTown(state, party.pos, (town) => town.factionId === party.factionId)
    || nearestTown(state, party.pos);
}

export function activeTown(state) {
  const town = nearestTown(state, state.player.pos);
  return town && distance(state.player.pos, town.pos) <= CONFIG.TOWN_INTERACTION_RADIUS ? town : null;
}

export function factionsAtWar(state, firstId, secondId) {
  return Boolean(getFaction(state, firstId)?.atWarWith.includes(secondId));
}

export function addEvent(state, key, parameters = {}, tone = "") {
  state.eventLog.unshift({ tick: state.tick, key, parameters, tone });
  if (state.eventLog.length > CONFIG.EVENT_LOG_LIMIT) state.eventLog.length = CONFIG.EVENT_LOG_LIMIT;
}

export function assignBanditMoveTarget(state, bandit) {
  const angle = randomBetween(state.rng, 0, Math.PI * 2);
  const range = randomBetween(state.rng, CONFIG.BANDIT_ROAM_MIN, CONFIG.BANDIT_ROAM_MAX);
  const margin = CONFIG.BANDIT_WORLD_MARGIN ?? 18;
  bandit.moveTarget = {
    x: clamp(bandit.pos.x + Math.cos(angle) * range, margin, CONFIG.WORLD_SIZE - margin),
    y: clamp(bandit.pos.y + Math.sin(angle) * range, margin, CONFIG.WORLD_SIZE - margin)
  };
}

function setEliteFields(bandit, elite) {
  bandit.elite = Boolean(elite);
  bandit.kind = elite ? "elite" : "normal";
  bandit.lootMultiplier = elite ? CONFIG.ELITE_BANDIT_LOOT_MULTIPLIER : 1;
  bandit.markerScale = elite
    ? CONFIG.ELITE_MARKER_SIZE_MULTIPLIER
    : (CONFIG.NORMAL_MARKER_SIZE_MULTIPLIER ?? 1);
  return bandit;
}

export function spawnBandit(state, options = {}) {
  if (state.bandits.length >= CONFIG.MAX_BANDITS) return null;
  const preferredTown = options.townId ? getTown(state, options.townId) : null;
  const town = preferredTown || state.towns[randomInt(state.rng, 0, state.towns.length)];
  const margin = CONFIG.BANDIT_WORLD_MARGIN ?? 18;
  let position = copyPosition(town.pos);

  for (let attempt = 0; attempt < (CONFIG.BANDIT_SPAWN_ATTEMPTS ?? 12); attempt += 1) {
    const angle = randomBetween(state.rng, 0, Math.PI * 2);
    const radius = randomBetween(state.rng, CONFIG.BANDIT_SPAWN_MIN, CONFIG.BANDIT_SPAWN_MAX);
    position = {
      x: clamp(town.pos.x + Math.cos(angle) * radius, margin, CONFIG.WORLD_SIZE - margin),
      y: clamp(town.pos.y + Math.sin(angle) * radius, margin, CONFIG.WORLD_SIZE - margin)
    };
    const safeMultiplier = CONFIG.BANDIT_PLAYER_SAFE_RADIUS_MULTIPLIER ?? 2.4;
    if (distance(position, state.player.pos) > CONFIG.ENCOUNTER_RADIUS * safeMultiplier) break;
  }

  const elite = Boolean(options.elite);
  const minimum = elite ? CONFIG.ELITE_BANDIT_STRENGTH_MIN : CONFIG.BANDIT_STRENGTH_MIN;
  const maximum = elite ? CONFIG.ELITE_BANDIT_STRENGTH_MAX : CONFIG.BANDIT_STRENGTH_MAX;
  const desiredStrength = Math.max(1, getPartyStrength(state.player)) * randomBetween(state.rng, minimum, maximum);
  const rawCount = desiredStrength / TROOP_TYPES.bandit.atk;
  const count = Math.max(1, elite ? Math.floor(rawCount) : Math.round(rawCount));
  const bandit = setEliteFields({
    id: `bandit_${state.nextBanditId}`,
    pos: position,
    prevPos: copyPosition(position),
    moveTarget: null,
    troops: [{ type: "bandit", count, xp: 0 }],
    gold: count * CONFIG.BANDIT_GOLD_PER_TROOP
  }, elite);
  state.nextBanditId += 1;
  assignBanditMoveTarget(state, bandit);
  state.bandits.push(bandit);
  return bandit;
}

// Save repair promotes an existing pack without consuming the simulation RNG.
export function repairEliteBandits(state) {
  if (!state.bandits.length) {
    const town = getTown(state, CONFIG.START_TOWN_ID) || state.towns[0];
    const angle = ((state.seed >>> 8) % 6283) / 1000;
    const radius = (CONFIG.BANDIT_SPAWN_MIN + CONFIG.BANDIT_SPAWN_MAX) / 2;
    const position = {
      x: clamp(town.pos.x + Math.cos(angle) * radius, 18, CONFIG.WORLD_SIZE - 18),
      y: clamp(town.pos.y + Math.sin(angle) * radius, 18, CONFIG.WORLD_SIZE - 18)
    };
    const ratio = CONFIG.ELITE_BANDIT_STRENGTH_MIN
      + ((state.seed >>> 16) % 501) / 1000;
    const count = Math.max(1, Math.floor(
      Math.max(1, getPartyStrength(state.player)) * ratio / TROOP_TYPES.bandit.atk
    ));
    const bandit = setEliteFields({
      id: `bandit_${state.nextBanditId}`,
      pos: position,
      prevPos: copyPosition(position),
      moveTarget: copyPosition(town.pos),
      troops: [{ type: "bandit", count, xp: 0 }],
      gold: count * CONFIG.BANDIT_GOLD_PER_TROOP
    }, true);
    state.nextBanditId += 1;
    state.bandits.push(bandit);
    return bandit;
  }
  const existing = state.bandits.filter((bandit) => bandit.elite || bandit.kind === "elite");
  const chosen = existing[0] || state.bandits.slice().sort((a, b) => a.id.localeCompare(b.id))[0];
  state.bandits.forEach((bandit) => setEliteFields(bandit, bandit === chosen));
  return chosen;
}

function initialRelation(firstId, secondId) {
  const demoPair = CONFIG.DEMO_INITIAL_WAR_FACTIONS || [];
  if (CONFIG.DEMO && demoPair.includes(firstId) && demoPair.includes(secondId)) {
    return CONFIG.DEMO_INITIAL_WAR_RELATION;
  }
  return CONFIG.DIPLOMACY_START_RELATION ?? 0;
}

function createFactions() {
  return FACTION_DATA.map((entry) => ({
    id: entry.id,
    nameKey: entry.nameKey,
    color: entry.color,
    rulerNameIndex: entry.rulerNameIndex,
    atWarWith: [],
    aggression: entry.aggression,
    relations: Object.fromEntries(
      FACTION_DATA.filter((other) => other.id !== entry.id)
        .map((other) => [other.id, initialRelation(entry.id, other.id)])
    ),
    warStartedDays: {},
    initialTownCount: TOWN_DATA.filter((town) => town.factionId === entry.id).length,
    alive: true
  }));
}

function createTowns() {
  return TOWN_DATA.map((entry) => ({
    id: entry.id,
    nameKey: entry.nameKey,
    pos: { x: entry.x, y: entry.y },
    factionId: entry.factionId,
    prosperity: CONFIG.TOWN_START_PROSPERITY,
    garrison: [{ type: "militia", count: CONFIG.TOWN_START_GARRISON, xp: 0 }],
    recruitPool: CONFIG.TOWN_START_RECRUIT_POOL,
    underSiege: false,
    siegeAttackerId: null,
    siegeDays: 0
  }));
}

function createLords(state) {
  const lords = [];
  state.factions.forEach((faction) => {
    const ownTowns = state.towns.filter((town) => town.factionId === faction.id);
    const [firstTown, secondTown] = ownTowns;
    LORD_DATA[faction.id].forEach((template, index) => {
      const fraction = LORD_START_FRACTIONS[index];
      const position = {
        x: firstTown.pos.x + (secondTown.pos.x - firstTown.pos.x) * fraction,
        y: firstTown.pos.y + (secondTown.pos.y - firstTown.pos.y) * fraction
      };
      const patrolIndex = index % 2 === 0 ? 1 : 0;
      const targetTown = patrolIndex === 0 ? firstTown : secondTown;
      lords.push({
        id: `${faction.id}_lord_${index + 1}`,
        nameIndex: template.nameIndex,
        factionId: faction.id,
        pos: position,
        prevPos: copyPosition(position),
        moveTarget: copyPosition(targetTown.pos),
        patrolTownIds: [firstTown.id, secondTown.id],
        patrolIndex,
        roadWaypoint: null,
        troops: [{ type: "militia", count: CONFIG.LORD_STARTING_MILITIA, xp: 0 }],
        troopCap: CONFIG.LORD_TROOP_CAP,
        gold: CONFIG.LORD_STARTING_GOLD,
        aiState: "patrol",
        targetId: targetTown.id,
        personality: template.personality,
        defeatedUntil: 0
      });
    });
  });
  return lords;
}

function createDemoState(options = {}) {
  const skipOnboarding = Boolean(options.skipOnboarding);
  return {
    onboardingComplete: skipOnboarding,
    onboardingStep: 0,
    modal: skipOnboarding ? null : "onboarding",
    pauseReason: skipOnboarding ? null : "onboarding",
    ended: false,
    act2Tick: null,
    endingTick: null,
    firstBattleTick: null,
    lastTownId: null,
    roadEvent: null,
    activeRoadEvent: null,
    tooltipsSeen: {
      town: Boolean(options.tooltipsSeen?.town),
      lowGold: Boolean(options.tooltipsSeen?.lowGold),
      act2: Boolean(options.tooltipsSeen?.act2)
    },
    pendingTooltips: []
  };
}

function createCasualState() {
  return {
    roadEventDay: -1,
    roadEventsToday: 0,
    lastRoadEventRollDay: -1,
    firstRoadEventDay: null,
    firstRoadEventTick: null,
    firstRoadEventSeconds: null,
    eventHistory: [],
    openingBattlesPrepared: 0,
    playerBattlesResolved: 0,
    winStreak: 0,
    lossStreak: 0,
    recoverySpawnsRemaining: 0,
    largeSpawnPending: false,
    banditBattlesBlockedDay: -1,
    nextBattleAttackMultiplier: 1,
    lastBattleBalance: null,
    lastSpawnBalance: null
  };
}

export function createInitialState(seed = CONFIG.SEED, options = {}) {
  const normalizedSeed = Number(seed) >>> 0;
  const startTown = TOWN_DATA.find((town) => town.id === CONFIG.START_TOWN_ID);
  const startPosition = { x: startTown.x, y: startTown.y };
  const demo = createDemoState(options);
  const state = {
    saveVersion: CONFIG.SAVE_VERSION,
    seed: normalizedSeed,
    rng: createRng(normalizedSeed),
    tick: 0,
    paused: Boolean(demo.modal),
    settings: { language: SUPPORTED_LANGUAGES.includes(options.language) ? options.language : "zh" },
    lastSavedTick: -1,
    player: {
      pos: startPosition,
      prevPos: copyPosition(startPosition),
      moveTarget: null,
      gold: CONFIG.STARTING_GOLD,
      renown: 0,
      act: 1,
      troops: [{ type: "militia", count: CONFIG.STARTING_MILITIA, xp: 0 }],
      factionId: null,
      relations: { north: 0, south: 0, east: 0 },
      fiefs: [],
      promises: [],
      contract: null,
      encounterCooldownUntil: 0
    },
    factions: createFactions(),
    towns: createTowns(),
    lords: [],
    bandits: [],
    eventLog: [],
    stats: {
      days: 0,
      battles: 0,
      wins: 0,
      kills: 0,
      goldEarned: 0,
      peakTroops: CONFIG.STARTING_MILITIA,
      peakGold: CONFIG.STARTING_GOLD
    },
    telemetry: createTelemetry({
      startedAt: options.startedAt || null,
      replayCount: options.replayCount || 0
    }),
    casual: createCasualState(),
    demo,
    ending: { complete: false, visible: false, tick: null },
    battle: null,
    nextBanditId: 1
  };

  state.lords = createLords(state);
  spawnBandit(state, { townId: CONFIG.START_TOWN_ID, elite: true });
  while (state.bandits.length < CONFIG.INITIAL_BANDITS) spawnBandit(state);
  // The demo contract names this collection at the root; player.promises is
  // retained as a compatibility alias for earlier Phase modules.
  state.promises = state.player.promises;
  return state;
}

function isPosition(value) {
  return Boolean(
    value && Number.isFinite(value.x) && Number.isFinite(value.y)
    && value.x >= 0 && value.x <= CONFIG.WORLD_SIZE
    && value.y >= 0 && value.y <= CONFIG.WORLD_SIZE
  );
}

function isTroopArray(value) {
  return Array.isArray(value) && value.every((stack) => (
    stack && Object.hasOwn(TROOP_TYPES, stack.type)
    && Number.isInteger(stack.count) && stack.count >= 0
    && Number.isInteger(stack.xp) && stack.xp >= 0
  ));
}

function isParty(value) {
  return Boolean(
    value && isPosition(value.pos) && isTroopArray(value.troops)
    && (value.moveTarget === null || isPosition(value.moveTarget))
  );
}

export function isValidState(value) {
  if (!value || value.saveVersion !== CONFIG.SAVE_VERSION) return false;
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) return false;
  if (!isValidRng(value.rng)) return false;
  if (!Number.isSafeInteger(value.tick) || value.tick < 0 || typeof value.paused !== "boolean") return false;
  if (!value.settings || !SUPPORTED_LANGUAGES.includes(value.settings.language)) return false;
  if (!Number.isSafeInteger(value.lastSavedTick) || value.lastSavedTick < -1) return false;
  if (!isParty(value.player) || !Number.isFinite(value.player.gold) || value.player.gold < 0) return false;
  if (!Number.isFinite(value.player.renown) || value.player.renown < 0) return false;
  if (
    ![1, 2].includes(value.player.act) ||
    !Array.isArray(value.player.promises) ||
    !Array.isArray(value.promises)
  ) return false;
  if (!Array.isArray(value.factions) || value.factions.length !== FACTION_DATA.length) return false;
  if (!Array.isArray(value.towns) || value.towns.length !== TOWN_DATA.length || !value.towns.every((town) => isPosition(town.pos))) return false;
  if (!Array.isArray(value.lords) || value.lords.length !== 12 || !value.lords.every(isParty)) return false;
  if (!Array.isArray(value.bandits) || !value.bandits.every(isParty)) return false;
  if (new Set(value.bandits.map((bandit) => bandit.id)).size !== value.bandits.length) return false;
  if (value.bandits.length && value.bandits.filter((bandit) => bandit.elite).length !== 1) return false;
  if (!Array.isArray(value.eventLog) || !value.stats || !value.telemetry || !value.demo || !value.casual) return false;
  if (
    !Array.isArray(value.casual.eventHistory) ||
    !Number.isSafeInteger(value.casual.openingBattlesPrepared) ||
    !Number.isSafeInteger(value.casual.playerBattlesResolved) ||
    !Number.isSafeInteger(value.casual.recoverySpawnsRemaining)
  ) return false;
  if (
    !Number.isFinite(value.telemetry.totalActiveSeconds) ||
    value.telemetry.totalActiveSeconds < 0 ||
    !Array.isArray(value.telemetry.eventChoices)
  ) return false;
  if (!Number.isSafeInteger(value.nextBanditId) || value.nextBanditId < 1) return false;
  if (value.battle !== null && (!value.battle || typeof value.battle.banditId !== "string")) return false;
  return true;
}

function normalizePromise(entry, index) {
  const act = entry?.act === 2 ? 2 : index + 1;
  return {
    act,
    kind: entry?.kind || (act === 1 ? "troops" : "gold"),
    statedGoal: Math.max(0, Number(entry?.statedGoal ?? entry?.value) || 0),
    actualAtActEnd: entry?.actualAtActEnd ?? entry?.actual ?? null,
    exceeded: Boolean(entry?.exceeded),
    exceededAtTick: entry?.exceededAtTick ?? null
  };
}

function migrateState(state) {
  const legacy = state.saveVersion === 1;
  if (!legacy && state.saveVersion !== CONFIG.SAVE_VERSION) return null;
  state.saveVersion = CONFIG.SAVE_VERSION;
  state.player.act = state.player.act >= 2 ? 2 : 1;
  state.player.promises = (state.promises || state.player.promises || [])
    .map(normalizePromise)
    .slice(0, 2);
  state.promises = state.player.promises;
  state.player.contract ||= null;
  state.stats = {
    days: 0,
    battles: 0,
    wins: 0,
    kills: 0,
    goldEarned: 0,
    peakTroops: getTroopCount(state.player),
    peakGold: state.player.gold,
    ...(state.stats || {})
  };
  state.stats.peakTroops = Math.max(state.stats.peakTroops || 0, getTroopCount(state.player));
  state.stats.peakGold = Math.max(state.stats.peakGold || 0, state.player.gold);
  state.telemetry = normalizeTelemetry(state.telemetry, { replayCount: state.telemetry?.replayCount || 0 });
  state.casual = { ...createCasualState(), ...(state.casual || {}) };
  state.casual.eventHistory = Array.isArray(state.casual.eventHistory)
    ? state.casual.eventHistory.slice(-CONFIG.ROAD_EVENT_HISTORY_LIMIT)
    : [];
  [
    "roadEventsToday",
    "openingBattlesPrepared",
    "playerBattlesResolved",
    "winStreak",
    "lossStreak",
    "recoverySpawnsRemaining"
  ].forEach((key) => {
    state.casual[key] = Math.max(0, Math.floor(Number(state.casual[key]) || 0));
  });
  state.casual.largeSpawnPending = Boolean(state.casual.largeSpawnPending);
  state.casual.banditBattlesBlockedDay = Number.isInteger(state.casual.banditBattlesBlockedDay)
    ? state.casual.banditBattlesBlockedDay
    : -1;
  state.casual.nextBattleAttackMultiplier = Math.max(
    1,
    Number(state.casual.nextBattleAttackMultiplier) || 1
  );
  state.demo = state.demo ? {
    ...createDemoState({ skipOnboarding: state.demo.onboardingComplete, tooltipsSeen: state.demo.tooltipsSeen }),
    ...state.demo,
    tooltipsSeen: { ...createDemoState().tooltipsSeen, ...(state.demo.tooltipsSeen || {}) },
    pendingTooltips: Array.isArray(state.demo.pendingTooltips) ? state.demo.pendingTooltips : []
  } : createDemoState();
  state.demo.roadEvent = state.demo.roadEvent || state.demo.activeRoadEvent || null;
  state.demo.activeRoadEvent = state.demo.activeRoadEvent || state.demo.roadEvent || null;
  state.ending ||= {
    complete: Boolean(state.demo.ended),
    visible: Boolean(state.demo.ended),
    tick: state.demo.endingTick ?? null
  };
  if (legacy) {
    state.eventLog = (state.eventLog || []).slice().reverse();
    state.demo.modal = "onboarding";
    state.demo.pauseReason = "onboarding";
    state.demo.onboardingComplete = false;
    state.paused = true;
  }

  state.factions.forEach((faction) => {
    faction.atWarWith ||= [];
    faction.relations ||= Object.fromEntries(
      state.factions.filter((other) => other.id !== faction.id)
        .map((other) => [other.id, initialRelation(faction.id, other.id)])
    );
    faction.warStartedDays ||= {};
    faction.initialTownCount ||= TOWN_DATA.filter((town) => town.factionId === faction.id).length;
    if (typeof faction.alive !== "boolean") faction.alive = true;
  });
  state.towns.forEach((town) => {
    town.garrison = isTroopArray(town.garrison) && town.garrison.length
      ? town.garrison
      : [{ type: "militia", count: CONFIG.TOWN_START_GARRISON, xp: 0 }];
    if (typeof town.underSiege !== "boolean") town.underSiege = false;
    town.siegeAttackerId ||= null;
    town.siegeDays ||= 0;
  });
  state.lords.forEach((lord) => {
    lord.troopCap ||= CONFIG.LORD_TROOP_CAP;
    lord.roadWaypoint ??= null;
    lord.defeatedUntil ||= 0;
  });
  state.bandits.forEach((bandit) => {
    if (!isPosition(bandit.prevPos)) bandit.prevPos = copyPosition(bandit.pos);
    if (!Number.isFinite(bandit.gold)) bandit.gold = getTroopCount(bandit) * CONFIG.BANDIT_GOLD_PER_TROOP;
  });
  repairEliteBandits(state);
  return state;
}

function prepareLoadedState(state) {
  state.player.prevPos = copyPosition(state.player.pos);
  state.lords.forEach((lord) => { lord.prevPos = copyPosition(lord.pos); });
  state.bandits.forEach((bandit) => { bandit.prevPos = copyPosition(bandit.pos); });
  return state;
}

function resolveStorage(storage) {
  if (storage) return storage;
  try {
    return globalThis.localStorage || null;
  } catch {
    return null;
  }
}

export function serializeState(state) {
  return JSON.stringify(state);
}

export function saveState(state, storage) {
  const target = resolveStorage(storage);
  if (!target) return false;
  const previousSavedTick = state.lastSavedTick;
  try {
    state.lastSavedTick = state.tick;
    target.setItem(CONFIG.SAVE_KEY, serializeState(state));
    return true;
  } catch {
    state.lastSavedTick = previousSavedTick;
    return false;
  }
}

export function loadState(storage) {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const raw = target.getItem(CONFIG.SAVE_KEY);
    if (!raw) return null;
    const parsed = migrateState(JSON.parse(raw));
    if (!parsed || !isValidState(parsed)) return null;
    return prepareLoadedState(parsed);
  } catch {
    return null;
  }
}

export function autosaveState(state, tickResult, storage) {
  if (!tickResult?.dayAdvanced) return false;
  return saveState(state, storage);
}

export function nextWorldSeed(state) {
  const replay = (state.telemetry?.replayCount || 0) + 1;
  return (state.seed + Math.imul(replay, 0x9e3779b9) + 0x6d2b79f5) >>> 0;
}

export function createReplayState(previousState, options = {}) {
  return createInitialState(nextWorldSeed(previousState), {
    language: previousState.settings.language,
    replayCount: (previousState.telemetry?.replayCount || 0) + 1,
    skipOnboarding: true,
    tooltipsSeen: previousState.demo?.tooltipsSeen,
    startedAt: options.startedAt || null
  });
}

export const startReplay = createReplayState;

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
  return applied;
}

export function awardSurvivorXp(party) {
  party.troops.forEach((stack) => {
    if (stack.count > 0) stack.xp += CONFIG.SURVIVOR_XP_PER_WIN;
  });
}

export function nearestTown(state, position) {
  return state.towns.reduce((nearest, town) => {
    if (!nearest) return town;
    return distance(position, town.pos) < distance(position, nearest.pos) ? town : nearest;
  }, null);
}

export function activeTown(state) {
  const town = nearestTown(state, state.player.pos);
  return town && distance(state.player.pos, town.pos) <= CONFIG.TOWN_INTERACTION_RADIUS ? town : null;
}

export function addEvent(state, key, parameters = {}, tone = "") {
  state.eventLog.push({ tick: state.tick, key, parameters, tone });
  if (state.eventLog.length > CONFIG.EVENT_LOG_LIMIT) {
    state.eventLog.splice(0, state.eventLog.length - CONFIG.EVENT_LOG_LIMIT);
  }
}

export function assignBanditMoveTarget(state, bandit) {
  const angle = randomBetween(state.rng, 0, Math.PI * 2);
  const range = randomBetween(state.rng, CONFIG.BANDIT_ROAM_MIN, CONFIG.BANDIT_ROAM_MAX);
  bandit.moveTarget = {
    x: clamp(bandit.pos.x + Math.cos(angle) * range, 18, CONFIG.WORLD_SIZE - 18),
    y: clamp(bandit.pos.y + Math.sin(angle) * range, 18, CONFIG.WORLD_SIZE - 18)
  };
}

export function spawnBandit(state, options = {}) {
  if (state.bandits.length >= CONFIG.MAX_BANDITS) return null;
  const preferredTown = options.townId ? getTown(state, options.townId) : null;
  const town = preferredTown || state.towns[randomInt(state.rng, 0, state.towns.length)];
  let position = copyPosition(town.pos);

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const angle = randomBetween(state.rng, 0, Math.PI * 2);
    const radius = randomBetween(state.rng, CONFIG.BANDIT_SPAWN_MIN, CONFIG.BANDIT_SPAWN_MAX);
    position = {
      x: clamp(town.pos.x + Math.cos(angle) * radius, 18, CONFIG.WORLD_SIZE - 18),
      y: clamp(town.pos.y + Math.sin(angle) * radius, 18, CONFIG.WORLD_SIZE - 18)
    };
    if (distance(position, state.player.pos) > CONFIG.ENCOUNTER_RADIUS * 2.4) break;
  }

  const desiredStrength = Math.max(1, getPartyStrength(state.player)) * randomBetween(
    state.rng,
    CONFIG.BANDIT_STRENGTH_MIN,
    CONFIG.BANDIT_STRENGTH_MAX
  );
  const count = Math.max(1, Math.round(desiredStrength / TROOP_TYPES.bandit.atk));
  const bandit = {
    id: `bandit_${state.nextBanditId}`,
    pos: position,
    prevPos: copyPosition(position),
    moveTarget: null,
    troops: [{ type: "bandit", count, xp: 0 }],
    gold: count * CONFIG.BANDIT_GOLD_PER_TROOP
  };
  state.nextBanditId += 1;
  assignBanditMoveTarget(state, bandit);
  state.bandits.push(bandit);
  return bandit;
}

function createFactions() {
  return FACTION_DATA.map((entry) => ({
    id: entry.id,
    nameKey: entry.nameKey,
    color: entry.color,
    rulerNameIndex: entry.rulerNameIndex,
    atWarWith: [],
    aggression: entry.aggression
  }));
}

function createTowns() {
  return TOWN_DATA.map((entry) => ({
    id: entry.id,
    nameKey: entry.nameKey,
    pos: { x: entry.x, y: entry.y },
    factionId: entry.factionId,
    prosperity: CONFIG.TOWN_START_PROSPERITY,
    garrison: [],
    recruitPool: CONFIG.TOWN_START_RECRUIT_POOL
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
        troops: [{ type: "militia", count: CONFIG.LORD_STARTING_MILITIA, xp: 0 }],
        gold: CONFIG.LORD_STARTING_GOLD,
        aiState: "patrol",
        targetId: targetTown.id,
        personality: template.personality
      });
    });
  });
  return lords;
}

export function createInitialState(seed = CONFIG.SEED) {
  const normalizedSeed = Number(seed) >>> 0;
  const startTown = TOWN_DATA.find((town) => town.id === CONFIG.START_TOWN_ID);
  const startPosition = { x: startTown.x, y: startTown.y };
  const state = {
    saveVersion: CONFIG.SAVE_VERSION,
    seed: normalizedSeed,
    rng: createRng(normalizedSeed),
    tick: 0,
    paused: false,
    settings: { language: "zh" },
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
      encounterCooldownUntil: 0
    },
    factions: createFactions(),
    towns: createTowns(),
    lords: [],
    bandits: [],
    eventLog: [],
    stats: { days: 0, battles: 0, kills: 0, goldEarned: 0 },
    battle: null,
    nextBanditId: 1
  };

  state.lords = createLords(state);
  spawnBandit(state, { townId: CONFIG.START_TOWN_ID });
  while (state.bandits.length < CONFIG.INITIAL_BANDITS) spawnBandit(state);
  addEvent(state, "log.initialMove");
  addEvent(state, "log.initialBattle");
  return state;
}

function isPosition(value) {
  return Boolean(
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    value.x >= 0 &&
    value.x <= CONFIG.WORLD_SIZE &&
    value.y >= 0 &&
    value.y <= CONFIG.WORLD_SIZE
  );
}

function isTroopArray(value) {
  return Array.isArray(value) && value.every((stack) => (
    stack &&
    typeof stack.type === "string" &&
    Number.isInteger(stack.count) &&
    stack.count >= 0 &&
    Number.isInteger(stack.xp) &&
    stack.xp >= 0
  ));
}

function isParty(value) {
  return Boolean(
    value &&
    isPosition(value.pos) &&
    isTroopArray(value.troops) &&
    (value.moveTarget === null || isPosition(value.moveTarget))
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
  if (!Array.isArray(value.factions) || value.factions.length !== FACTION_DATA.length) return false;
  if (!Array.isArray(value.towns) || value.towns.length !== TOWN_DATA.length || !value.towns.every((town) => isPosition(town.pos))) return false;
  if (!Array.isArray(value.lords) || value.lords.length !== 12 || !value.lords.every(isParty)) return false;
  if (!Array.isArray(value.bandits) || !value.bandits.every(isParty)) return false;
  if (new Set(value.bandits.map((bandit) => bandit.id)).size !== value.bandits.length) return false;
  if (!Array.isArray(value.eventLog) || !value.stats) return false;
  if (!Number.isSafeInteger(value.nextBanditId) || value.nextBanditId < 1) return false;
  if (value.battle !== null && (!value.battle || typeof value.battle.banditId !== "string")) return false;
  return true;
}

function prepareLoadedState(state) {
  state.player.prevPos = copyPosition(state.player.pos);
  state.lords.forEach((lord) => {
    lord.prevPos = copyPosition(lord.pos);
  });
  state.bandits.forEach((bandit) => {
    bandit.prevPos = copyPosition(bandit.pos);
  });
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
    const parsed = JSON.parse(raw);
    if (!isValidState(parsed)) return null;
    return prepareLoadedState(parsed);
  } catch {
    return null;
  }
}

export function autosaveState(state, tickResult, storage) {
  if (!tickResult?.dayAdvanced) return false;
  return saveState(state, storage);
}

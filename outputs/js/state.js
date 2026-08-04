import {
  CONFIG,
  CONFIG_V11,
  ARM_IDS,
  FACTION_DATA,
  LORD_DATA,
  LORD_START_FRACTIONS,
  LIEUTENANT_ROSTER,
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

export function isV11State(state) {
  return state?.features?.v11 === true;
}

export function getLieutenants(state) {
  if (state?.features?.f4) return Array.isArray(state.player?.lieutenants) ? state.player.lieutenants : [];
  return state?.player?.lieutenant ? [state.player.lieutenant] : [];
}

export function hasLieutenant(state, id) {
  return getLieutenants(state).some((entry) => entry.id === id);
}

export function syncLieutenantAlias(state) {
  if (!state?.features?.f4) return state?.player?.lieutenant || null;
  state.player.lieutenant = state.player.lieutenants?.[0] || null;
  return state.player.lieutenant;
}

export function getPartyStrength(party) {
  return party.troops.reduce((sum, stack) => {
    const type = TROOP_TYPES[stack.type];
    return sum + (type ? type.atk * stack.count : 0);
  }, 0);
}

export function troopArm(stack, fallback = "spear") {
  return ARM_IDS.includes(stack?.arm) ? stack.arm : fallback;
}

export function getArmCounts(party) {
  const counts = Object.fromEntries(ARM_IDS.map((arm) => [arm, 0]));
  for (const stack of party?.troops || party?.garrison || []) {
    counts[troopArm(stack)] += Math.max(0, Number(stack.count) || 0);
  }
  return counts;
}

export function getArmShares(party) {
  const counts = getArmCounts(party);
  const total = Math.max(1, Object.values(counts).reduce((sum, value) => sum + value, 0));
  return Object.fromEntries(ARM_IDS.map((arm) => [arm, counts[arm] / total]));
}

export function dominantArm(party) {
  const counts = getArmCounts(party);
  return ARM_IDS.slice().sort((first, second) => counts[second] - counts[first] || first.localeCompare(second))[0];
}

export function changePlayerRenown(state, amount) {
  const requested = Number(amount) || 0;
  if (!requested) return 0;
  if (state.kingdom?.renownFrozenAt !== null && state.kingdom?.renownFrozenAt !== undefined) {
    state.player.renown = state.kingdom.renownFrozenAt;
    return 0;
  }
  let applied = requested;
  if (
    requested > 0 &&
    state.features?.f2 &&
    state.player.act >= 3 &&
    !state.kingdom?.founded
  ) {
    applied = Math.max(1, Math.round(requested * CONFIG.ACT3_RENOWN_GAIN_MULTIPLIER));
  }
  if (
    requested > 0 &&
    state.features?.f2 &&
    state.player.act === 2
  ) {
    applied = Math.max(0, Math.min(applied, CONFIG.ACT3_RENOWN - state.player.renown));
  }
  const before = Math.max(0, Number(state.player.renown) || 0);
  state.player.renown = Math.max(0, before + applied);
  return state.player.renown - before;
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

export function incrementTroop(party, type, amount = 1, arm = null) {
  let stack = party.troops.find((entry) => (
    entry.type === type && (arm === null || troopArm(entry) === arm)
  ));
  if (!stack) {
    stack = { type, count: 0, xp: 0, ...(arm === null ? {} : { arm }) };
    party.troops.push(stack);
  }
  stack.count = Math.max(0, stack.count + Math.floor(amount));
  return stack.count;
}

/*
 * Per-soldier hitpoints. v1.1 ONLY.
 *
 * v1.0 parties never carry `hpPerSoldier`/`hpCurrent`: the fields are optional
 * additions on the stack, the v1.0 resolver never reads or writes them, and
 * nothing below is reachable without isV11State. That is what keeps the
 * default build byte-identical and the v1.0 save format unchanged.
 */
export function hpPerSoldierFor(type) {
  return CONFIG_V11.HP_PER_SOLDIER[type] || CONFIG_V11.HP_PER_SOLDIER_DEFAULT;
}

export function ensurePartyHp(party) {
  if (!party?.troops) return party;
  party.troops.forEach((stack) => {
    if (!Number.isFinite(stack.hpPerSoldier) || stack.hpPerSoldier <= 0) {
      stack.hpPerSoldier = hpPerSoldierFor(stack.type);
    }
    const full = Math.max(0, stack.count) * stack.hpPerSoldier;
    if (!Number.isFinite(stack.hpCurrent) || stack.hpCurrent > full || stack.hpCurrent < 0) {
      stack.hpCurrent = full;
    }
  });
  return party;
}

export function averageHpPerSoldier(party) {
  const total = getTroopCount(party);
  if (total <= 0) return CONFIG_V11.HP_PER_SOLDIER_DEFAULT;
  const sum = party.troops.reduce(
    (acc, stack) => acc + hpPerSoldierFor(stack.type) * stack.count, 0
  );
  return sum / total;
}

export function partyHp(party) {
  return (party?.troops || []).reduce((sum, stack) => sum + Math.max(0, stack.hpCurrent || 0), 0);
}

/**
 * Spend hitpoints across a party. A soldier dies only once his own pool is
 * gone, so a hit can be non-lethal -- which is the whole point. Returns how
 * many died, so the caller's casualty accounting is unchanged in shape.
 */
export function applyHpDamage(party, damage) {
  let remaining = Math.max(0, damage);
  let deaths = 0;
  for (const stack of party.troops) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, stack.hpCurrent);
    stack.hpCurrent -= take;
    remaining -= take;
    const alive = Math.max(0, Math.ceil(stack.hpCurrent / stack.hpPerSoldier));
    deaths += Math.max(0, stack.count - alive);
    stack.count = alive;
  }
  party.troops = party.troops.filter((stack) => stack.count > 0);
  return deaths;
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
  const ready = party.troops.filter((stack) => stack.type === "militia" && stack.xp >= 3);
  for (const militia of ready) {
    const promoted = militia.count;
    party.troops = party.troops.filter((stack) => stack !== militia);
    incrementTroop(party, "veteran", promoted, ARM_IDS.includes(militia.arm) ? militia.arm : null);
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
    troops: [{ type: "bandit", count, xp: 0, ...(state.features?.f3 ? { arm: "spear" } : {}) }],
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
      troops: [{ type: "bandit", count, xp: 0, ...(state.features?.f3 ? { arm: "spear" } : {}) }],
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

export function recruitPoolsForFaction(factionId) {
  const mix = CONFIG.F3_REGION_RECRUIT_MIX[factionId] || CONFIG.F3_REGION_RECRUIT_MIX.south;
  const total = CONFIG.TOWN_START_RECRUIT_POOL;
  const pools = { spear: 0, archer: 0, cavalry: 0 };
  let assigned = 0;
  ARM_IDS.forEach((arm, index) => {
    const count = index === ARM_IDS.length - 1
      ? total - assigned
      : Math.floor(total * mix[arm]);
    pools[arm] = count;
    assigned += count;
  });
  return pools;
}

function createTowns(f3 = false) {
  return TOWN_DATA.map((entry) => ({
    id: entry.id,
    nameKey: entry.nameKey,
    pos: { x: entry.x, y: entry.y },
    factionId: entry.factionId,
    originalFactionId: entry.factionId,
    prosperity: CONFIG.TOWN_START_PROSPERITY,
    garrison: [{
      type: "militia",
      count: CONFIG.TOWN_START_GARRISON,
      xp: 0,
      ...(f3 ? { arm: "spear" } : {})
    }],
    recruitPool: CONFIG.TOWN_START_RECRUIT_POOL,
    ...(f3 ? { recruitPools: recruitPoolsForFaction(entry.factionId) } : {}),
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
        troops: [{
          type: "militia",
          count: CONFIG.LORD_STARTING_MILITIA,
          xp: 0,
          ...(state.features.f3 ? {
            arm: ARM_IDS.slice().sort((first, second) => (
              CONFIG.F3_REGION_RECRUIT_MIX[faction.id][second] -
              CONFIG.F3_REGION_RECRUIT_MIX[faction.id][first] ||
              first.localeCompare(second)
            ))[0]
          } : {})
        }],
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
  const originPending = Boolean(options.f2) && !skipOnboarding;
  return {
    onboardingComplete: skipOnboarding,
    onboardingStep: -1,
    modal: skipOnboarding ? null : originPending ? "origin" : "onboarding",
    pauseReason: skipOnboarding ? null : originPending ? "origin" : "onboarding",
    ended: false,
    act2Tick: null,
    act3Tick: null,
    endingTick: null,
    firstBattleTick: null,
    lastTownId: null,
    roadEvent: null,
    activeRoadEvent: null,
    fiefThreat: null,
    fiefThreatKey: null,
    retreatStreak: 0,
    tooltipsSeen: {
      town: Boolean(options.tooltipsSeen?.town),
      lowGold: Boolean(options.tooltipsSeen?.lowGold),
      act2: Boolean(options.tooltipsSeen?.act2)
    },
    pendingTooltips: []
  };
}

function createKingdomState() {
  return {
    origin: null,
    expansionAwards: 0,
    foundingOffered: false,
    foundingDeclinedDay: null,
    founded: false,
    foundedTick: null,
    foundedDay: null,
    kingDays: 0,
    nextDecisionDay: CONFIG.KINGDOM_DECISION_INTERVAL_DAYS,
    decisionCount: 0,
    conquestContinues: false,
    renownFrozenAt: null,
    endingPath: null,
    coalitionWaves: 0,
    rebellionChecks: 0,
    rebellions: 0,
    lastRebellionWarningDay: null,
    pendingRebellionTownId: null
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
  const fullVersion = options.fullVersion === true;
  const f2 = options.f2 === true;
  const demo = createDemoState({ ...options, fullVersion, f2 });
  const state = {
    saveVersion: CONFIG.SAVE_VERSION,
    features: {
      v11: Boolean(options.v11),
      full: fullVersion,
      f2,
      f3: options.f3 === true,
      f4: options.f4 === true
    },
    seed: normalizedSeed,
    rng: createRng(normalizedSeed),
    tick: 0,
    paused: Boolean(demo.modal),
    settings: {
      language: SUPPORTED_LANGUAGES.includes(options.language) ? options.language : "zh",
      soundEnabled: options.soundEnabled !== false
    },
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
      lieutenant: null,
      ...(options.f4 === true ? { lieutenants: [] } : {}),
      origin: null,
      encounterCooldownUntil: 0
    },
    factions: createFactions(),
    towns: createTowns(options.f3 === true),
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
    kingdom: createKingdomState(),
    ending: { complete: false, visible: false, tick: null },
    battle: null,
    battleScript: null,
    battlePlayback: { speed: 1, skip: false },
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
    && (stack.arm === undefined || ARM_IDS.includes(stack.arm))
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

function hasExactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const wanted = expected.slice().sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isScriptSide(value) {
  if (!hasExactKeys(value, ["label", "tokens", "startTroops"])) return false;
  if (typeof value.label !== "string") return false;
  if (!Number.isSafeInteger(value.startTroops) || value.startTroops < 0) return false;
  if (!Array.isArray(value.tokens) || value.tokens.length > 24) return false;
  const tokenWeight = value.startTroops > 0 ? Math.ceil(value.startTroops / 24) : 1;
  const expectedTokens = value.startTroops > 0 ? Math.ceil(value.startTroops / tokenWeight) : 0;
  return value.tokens.length === expectedTokens && value.tokens.every((token, index) => (
    (hasExactKeys(token, ["idx", "troopType"]) || hasExactKeys(token, ["idx", "troopType", "arm"])) &&
    token.idx === index &&
    Object.hasOwn(TROOP_TYPES, token.troopType) &&
    (token.arm === undefined || ARM_IDS.includes(token.arm))
  ));
}

function isScriptReference(value, sides) {
  return Boolean(
    hasExactKeys(value, ["side", "idx"]) &&
    ["player", "enemy"].includes(value.side) &&
    Number.isSafeInteger(value.idx) &&
    value.idx >= 0 &&
    value.idx < sides[value.side].tokens.length
  );
}

export function isBattleScript(value) {
  const baseKeys = ["battleId", "terrain", "sides", "events"];
  const allowedKeys = [...baseKeys, "formations", "lieutenant", "lieutenantIds", "command"];
  if (!value || !baseKeys.every((key) => Object.hasOwn(value, key))) return false;
  if (Object.keys(value).some((key) => !allowedKeys.includes(key))) return false;
  if (Object.hasOwn(value, "lieutenant") && value.lieutenant !== "player") return false;
  // Presentation metadata only: which named officers ride with that side, so
  // the stage can draw them apart. Optional -- an older script without it still
  // validates and still falls back to the generic officer figure.
  if (
    Object.hasOwn(value, "lieutenantIds") &&
    (!Array.isArray(value.lieutenantIds) ||
      !value.lieutenantIds.every((id) => typeof id === "string" && id.length))
  ) return false;
  if (Object.hasOwn(value, "command") && !Object.hasOwn(CONFIG.F3_COMMANDS, value.command)) return false;
  if (
    Object.hasOwn(value, "formations") &&
    (
      !hasExactKeys(value.formations, ["player", "enemy"]) ||
      !["wedge", "line", "circle"].includes(value.formations.player) ||
      !["wedge", "line", "circle"].includes(value.formations.enemy)
    )
  ) return false;
  if (typeof value.battleId !== "string" || !value.battleId.length) return false;
  if (!["field", "town"].includes(value.terrain)) return false;
  if (!hasExactKeys(value.sides, ["player", "enemy"])) return false;
  if (!isScriptSide(value.sides.player) || !isScriptSide(value.sides.enemy)) return false;
  if (!Array.isArray(value.events) || value.events.length < 2) return false;

  let previousTime = -1;
  let battleStarts = 0;
  let battleEnds = 0;
  let roundStarts = 0;
  let firstRoundTime = Infinity;
  const moraleSides = new Set();
  const routSides = new Set();
  const casualtyCounts = { player: 0, enemy: 0 };
  const casualtiesByToken = { player: new Map(), enemy: new Map() };

  for (let index = 0; index < value.events.length; index += 1) {
    const event = value.events[index];
    if (!event || !Number.isSafeInteger(event.t) || event.t < 0 || event.t < previousTime) {
      return false;
    }
    previousTime = event.t;
    if (event.type === "battle_start") {
      if (!hasExactKeys(event, ["t", "type"]) || index !== 0) return false;
      battleStarts += 1;
      continue;
    }
    if (event.type === "volley") {
      if (!hasExactKeys(event, ["t", "type", "side", "arrows"])) return false;
      if (
        value.terrain !== "town" ||
        event.side !== "defender" ||
        !Number.isSafeInteger(event.arrows) ||
        event.arrows <= 0 ||
        event.t >= firstRoundTime
      ) return false;
      continue;
    }
    if (event.type === "archer_volley") {
      if (!hasExactKeys(event, ["t", "type", "side", "arrows"])) return false;
      if (
        value.terrain !== "field" ||
        !["player", "enemy"].includes(event.side) ||
        !Number.isSafeInteger(event.arrows) || event.arrows <= 0 ||
        event.t >= firstRoundTime
      ) return false;
      continue;
    }
    if (event.type === "command") {
      if (!hasExactKeys(event, ["t", "type", "side", "command"])) return false;
      if (event.side !== "player" || !Object.hasOwn(CONFIG.F3_COMMANDS, event.command)) return false;
      if (event.t >= firstRoundTime) return false;
      continue;
    }
    if (event.type === "round_start") {
      if (!hasExactKeys(event, ["t", "type", "n"])) return false;
      if (!Number.isSafeInteger(event.n) || event.n <= 0) return false;
      roundStarts += 1;
      firstRoundTime = Math.min(firstRoundTime, event.t);
      continue;
    }
    if (event.type === "strike") {
      // v1.1 adds `hpAfter`; v1.0 scripts never carry it. Additive only.
      const strikeKeys = ["t", "type", "from", "to", "kill", "dmgShown", "beat"];
      if (
        !hasExactKeys(event, strikeKeys) &&
        !hasExactKeys(event, [...strikeKeys, "hpAfter"])
      ) return false;
      if (
        Object.hasOwn(event, "hpAfter") &&
        (!Number.isSafeInteger(event.hpAfter) || event.hpAfter < 0)
      ) return false;
      if (roundStarts <= 0) return false;
      if (!isScriptReference(event.from, value.sides) || !isScriptReference(event.to, value.sides)) {
        return false;
      }
      if (event.from.side === event.to.side || typeof event.kill !== "boolean") return false;
      if (!Number.isSafeInteger(event.dmgShown) || event.dmgShown < 0) return false;
      if (![0, 1, 2].includes(event.beat)) return false;
      if (event.kill) {
        casualtyCounts[event.to.side] += 1;
        const byToken = casualtiesByToken[event.to.side];
        byToken.set(event.to.idx, (byToken.get(event.to.idx) || 0) + 1);
      }
      continue;
    }
    if (event.type === "morale") {
      if (!hasExactKeys(event, ["t", "type", "side", "level"])) return false;
      if (!["player", "enemy"].includes(event.side)) return false;
      if (!["steady", "wavering"].includes(event.level) || moraleSides.has(event.side)) return false;
      moraleSides.add(event.side);
      continue;
    }
    if (event.type === "rout") {
      if (!hasExactKeys(event, ["t", "type", "side"])) return false;
      if (!["player", "enemy"].includes(event.side) || routSides.has(event.side)) return false;
      routSides.add(event.side);
      continue;
    }
    if (event.type === "battle_end") {
      if (!hasExactKeys(event, ["t", "type", "winner", "loot", "survivors"])) return false;
      if (index !== value.events.length - 1 || !["player", "enemy", "draw"].includes(event.winner)) {
        return false;
      }
      if (!hasExactKeys(event.loot, ["gold", "renown"])) return false;
      if (!hasExactKeys(event.survivors, ["player", "enemy"])) return false;
      if (
        !Number.isSafeInteger(event.loot.gold) || event.loot.gold < 0 ||
        !Number.isSafeInteger(event.loot.renown) || event.loot.renown < 0
      ) return false;
      for (const side of ["player", "enemy"]) {
        if (
          !Number.isSafeInteger(event.survivors[side]) ||
          event.survivors[side] < 0 ||
          event.survivors[side] > value.sides[side].startTroops ||
          casualtyCounts[side] !== value.sides[side].startTroops - event.survivors[side]
        ) return false;
      }
      battleEnds += 1;
      continue;
    }
    return false;
  }

  if (battleStarts !== 1 || battleEnds !== 1) return false;
  for (const side of ["player", "enemy"]) {
    const startTroops = value.sides[side].startTroops;
    const tokenWeight = startTroops > 0 ? Math.ceil(startTroops / 24) : 1;
    for (const [idx, casualties] of casualtiesByToken[side]) {
      const capacity = Math.min(tokenWeight, startTroops - idx * tokenWeight);
      if (casualties > capacity) return false;
    }
  }
  return true;
}

function normalizeBattlePlayback(value) {
  return {
    speed: [1, 2, 4].includes(value?.speed) ? value.speed : 1,
    skip: value?.skip === true
  };
}

export function isValidState(value) {
  if (!value || value.saveVersion !== CONFIG.SAVE_VERSION) return false;
  if (!Number.isInteger(value.seed) || value.seed < 0 || value.seed > 0xffffffff) return false;
  if (!isValidRng(value.rng)) return false;
  if (!Number.isSafeInteger(value.tick) || value.tick < 0 || typeof value.paused !== "boolean") return false;
  if (
    !value.features ||
    typeof value.features.v11 !== "boolean" ||
    typeof value.features.full !== "boolean" ||
    typeof value.features.f2 !== "boolean" ||
    typeof value.features.f3 !== "boolean" ||
    typeof value.features.f4 !== "boolean"
  ) return false;
  if (
    !value.settings ||
    !SUPPORTED_LANGUAGES.includes(value.settings.language) ||
    typeof value.settings.soundEnabled !== "boolean"
  ) return false;
  if (!Number.isSafeInteger(value.lastSavedTick) || value.lastSavedTick < -1) return false;
  if (!isParty(value.player) || !Number.isFinite(value.player.gold) || value.player.gold < 0) return false;
  if (!Number.isFinite(value.player.renown) || value.player.renown < 0) return false;
  const validLieutenant = (entry) => Boolean(
    entry && LIEUTENANT_ROSTER.some((profile) => profile.id === entry.id) &&
    Number.isSafeInteger(entry.hiredAtTick) && entry.hiredAtTick >= 0 &&
    Number.isSafeInteger(entry.unpaidDays || 0) && (entry.unpaidDays || 0) >= 0
  );
  if (value.features.f4) {
    if (
      !Array.isArray(value.player.lieutenants) ||
      value.player.lieutenants.length > CONFIG.F4_LIEUTENANT_SLOTS ||
      !value.player.lieutenants.every(validLieutenant) ||
      new Set(value.player.lieutenants.map((entry) => entry.id)).size !== value.player.lieutenants.length ||
      value.player.lieutenant !== (value.player.lieutenants[0] || null)
    ) return false;
  } else if (
    value.player.lieutenant !== null &&
    (!isV11State(value) || value.player.lieutenant?.id !== "chen_mang" || !validLieutenant(value.player.lieutenant))
  ) return false;
  if (
    ![1, 2, 3, 4].includes(value.player.act) ||
    !Array.isArray(value.player.promises) ||
    !Array.isArray(value.promises) ||
    !Array.isArray(value.player.fiefs) ||
    !value.player.fiefs.every((townId) => typeof townId === "string" && value.towns?.some((town) => town.id === townId))
  ) return false;
  if (
    !value.kingdom || typeof value.kingdom.founded !== "boolean" ||
    !Array.isArray(value.factions) ||
    value.factions.length !== FACTION_DATA.length + (value.kingdom.founded ? 1 : 0)
  ) return false;
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
    !Array.isArray(value.telemetry.eventChoices) ||
    !Array.isArray(value.telemetry.lieutenantEventChoices) ||
    !value.telemetry.lieutenant ||
    !value.telemetry.promiseCrossings ||
    typeof value.telemetry.promiseCrossings !== "object" ||
    !value.telemetry.chronicle ||
    typeof value.telemetry.chronicle !== "object"
  ) return false;
  if (!Number.isSafeInteger(value.nextBanditId) || value.nextBanditId < 1) return false;
  if (value.battle !== null && (!value.battle || typeof value.battle.banditId !== "string")) return false;
  if (value.battleScript !== null && !isBattleScript(value.battleScript)) return false;
  if (
    !value.battlePlayback ||
    ![1, 2, 4].includes(value.battlePlayback.speed) ||
    typeof value.battlePlayback.skip !== "boolean"
  ) return false;
  return true;
}

function normalizePromise(entry, index) {
  const act = [1, 2, 3].includes(entry?.act) ? entry.act : Math.min(3, index + 1);
  const kind = entry?.kind || (act === 1 ? "troops" : act === 2 ? "gold" : "fiefs");
  const rawGoal = entry?.statedGoal ?? entry?.value;
  return {
    act,
    kind,
    statedGoal: kind === "fiefs" && rawGoal === "all"
      ? "all"
      : Math.max(0, Number(rawGoal) || 0),
    actualAtActEnd: entry?.actualAtActEnd ?? entry?.actual ?? null,
    exceeded: Boolean(entry?.exceeded),
    exceededAtTick: entry?.exceededAtTick ?? null
  };
}

function migrateState(state) {
  const legacy = state.saveVersion === 1;
  if (!legacy && state.saveVersion !== CONFIG.SAVE_VERSION) return null;
  state.saveVersion = CONFIG.SAVE_VERSION;
  state.features = {
    v11: state.features?.v11 === true,
    full: state.features?.full === true,
    f2: state.features?.f2 === true,
    f3: state.features?.f3 === true,
    f4: state.features?.f4 === true
  };
  state.settings = {
    language: SUPPORTED_LANGUAGES.includes(state.settings?.language) ? state.settings.language : "zh",
    // A real player preference again: a mute survives a refresh. Absent means
    // enabled, which is what keeps saves written before the field existed --
    // and saves written while it briefly did not -- loading with sound on.
    soundEnabled: state.settings?.soundEnabled !== false
  };
  state.player.act = state.player.act >= 4 ? 4 : state.player.act >= 3 ? 3 : state.player.act >= 2 ? 2 : 1;
  state.player.promises = (state.promises || state.player.promises || [])
    .map(normalizePromise)
    .slice(0, 3);
  state.promises = state.player.promises;
  state.player.fiefs = Array.isArray(state.player.fiefs)
    ? [...new Set(state.player.fiefs.filter((townId) => state.towns.some((town) => town.id === townId)))]
    : [];
  state.player.contract ||= null;
  state.player.origin ||= null;
  const legacyLieutenant = state.player.lieutenant;
  if (state.features.f4) {
    const sourceLieutenants = Array.isArray(state.player.lieutenants)
      ? state.player.lieutenants
      : legacyLieutenant ? [legacyLieutenant] : [];
    state.player.lieutenants = sourceLieutenants
      .filter((entry, index, entries) => (
        LIEUTENANT_ROSTER.some((profile) => profile.id === entry?.id) &&
        entries.findIndex((candidate) => candidate?.id === entry.id) === index
      ))
      .slice(0, CONFIG.F4_LIEUTENANT_SLOTS)
      .map((entry) => ({
        id: entry.id,
        hiredAtTick: Math.max(0, Math.floor(Number(entry.hiredAtTick) || 0)),
        unpaidDays: Math.max(0, Math.floor(Number(entry.unpaidDays) || 0))
      }));
    syncLieutenantAlias(state);
  } else {
    delete state.player.lieutenants;
    state.player.lieutenant = state.features.v11 && legacyLieutenant?.id === "chen_mang"
      ? {
        id: "chen_mang",
        hiredAtTick: Math.max(0, Math.floor(Number(legacyLieutenant.hiredAtTick) || 0))
      }
      : null;
  }
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
    ...createDemoState({
      skipOnboarding: state.demo.onboardingComplete,
      tooltipsSeen: state.demo.tooltipsSeen,
      fullVersion: state.features.full,
      f2: state.features.f2
    }),
    ...state.demo,
    tooltipsSeen: { ...createDemoState().tooltipsSeen, ...(state.demo.tooltipsSeen || {}) },
    pendingTooltips: Array.isArray(state.demo.pendingTooltips) ? state.demo.pendingTooltips : []
  } : createDemoState({ fullVersion: state.features.full, f2: state.features.f2 });
  state.demo.retreatStreak = Math.max(0, Math.floor(Number(state.demo.retreatStreak) || 0));
  state.kingdom = { ...createKingdomState(), ...(state.kingdom || {}) };
  state.kingdom.origin ||= state.player.origin || null;
  state.player.origin ||= state.kingdom.origin;
  state.demo.roadEvent = state.demo.roadEvent || state.demo.activeRoadEvent || null;
  state.demo.activeRoadEvent = state.demo.activeRoadEvent || state.demo.roadEvent || null;
  state.ending ||= {
    complete: Boolean(state.demo.ended),
    visible: Boolean(state.demo.ended),
    tick: state.demo.endingTick ?? null
  };
  state.battleScript = isBattleScript(state.battleScript) ? state.battleScript : null;
  state.battlePlayback = normalizeBattlePlayback(state.battlePlayback);
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
    town.originalFactionId ||= TOWN_DATA.find((entry) => entry.id === town.id)?.factionId || town.factionId;
    town.garrison = isTroopArray(town.garrison) && town.garrison.length
      ? town.garrison
      : [{ type: "militia", count: CONFIG.TOWN_START_GARRISON, xp: 0 }];
    if (state.features.f3) {
      town.recruitPools = ARM_IDS.every((arm) => Number.isFinite(town.recruitPools?.[arm]))
        ? Object.fromEntries(ARM_IDS.map((arm) => [arm, Math.max(0, Math.floor(town.recruitPools[arm]))]))
        : recruitPoolsForFaction(town.factionId);
      town.recruitPool = Object.values(town.recruitPools).reduce((sum, value) => sum + value, 0);
      town.garrison.forEach((stack) => { stack.arm ||= "spear"; });
    } else {
      delete town.recruitPools;
      town.garrison.forEach((stack) => { delete stack.arm; });
    }
    if (typeof town.underSiege !== "boolean") town.underSiege = false;
    town.siegeAttackerId ||= null;
    town.siegeDays ||= 0;
  });
  state.lords.forEach((lord) => {
    lord.troopCap ||= CONFIG.LORD_TROOP_CAP;
    lord.roadWaypoint ??= null;
    lord.defeatedUntil ||= 0;
    if (state.features.f3) {
      const mix = CONFIG.F3_REGION_RECRUIT_MIX[lord.factionId] || CONFIG.F3_REGION_RECRUIT_MIX.south;
      const arm = ARM_IDS.slice().sort((first, second) => mix[second] - mix[first] || first.localeCompare(second))[0];
      lord.troops.forEach((stack) => { stack.arm ||= arm; });
    } else {
      lord.troops.forEach((stack) => { delete stack.arm; });
    }
  });
  const playerArm = CONFIG.F3_ORIGIN_ARM[state.player.origin] || "spear";
  state.player.troops.forEach((stack) => {
    if (state.features.f3) stack.arm ||= playerArm;
    else delete stack.arm;
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
    target.setItem(isV11State(state) ? CONFIG.V11_SAVE_KEY : CONFIG.SAVE_KEY, serializeState(state));
    return true;
  } catch {
    state.lastSavedTick = previousSavedTick;
    return false;
  }
}

export function loadState(storage, options = {}) {
  const target = resolveStorage(storage);
  if (!target) return null;
  try {
    const v11 = options.v11 === true;
    const raw = target.getItem(v11 ? CONFIG.V11_SAVE_KEY : CONFIG.SAVE_KEY);
    if (!raw) return null;
    const source = JSON.parse(raw);
    source.features ||= {};
    source.features.full = options.fullVersion === true;
    source.features.f2 = options.f2 === true;
    source.features.f3 = options.f3 === true;
    source.features.f4 = options.f4 === true;
    const parsed = migrateState(source);
    if (!parsed || isV11State(parsed) !== v11 || !isValidState(parsed)) return null;
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
    soundEnabled: previousState.settings.soundEnabled,
    replayCount: (previousState.telemetry?.replayCount || 0) + 1,
    skipOnboarding: previousState.features?.full !== true,
    tooltipsSeen: previousState.demo?.tooltipsSeen,
    startedAt: options.startedAt || null,
    v11: isV11State(previousState),
    fullVersion: previousState.features?.full === true,
    f2: previousState.features?.f2 === true,
    f3: previousState.features?.f3 === true,
    f4: previousState.features?.f4 === true
  });
}

export const startReplay = createReplayState;

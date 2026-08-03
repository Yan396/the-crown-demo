import {
  CASUAL_EVENTS,
  CONFIG,
  F4_LIEUTENANT_EVENTS,
  LIEUTENANT_EVENTS,
  TROOP_TYPES
} from "./data.js";
import { nextFloat, randomBetween, randomInt } from "./rng.js";
import {
  addEvent,
  applyCasualties,
  changePlayerRenown,
  clamp,
  getLieutenants,
  getTroopCount,
  incrementTroop,
  isV11State,
  nearestTown
} from "./state.js";

export function getRoadEventDefinitions(state) {
  if (!isV11State(state)) return CASUAL_EVENTS;
  const activeIds = new Set(getLieutenants(state).map((entry) => entry.id));
  const deck = state.features?.f4 ? F4_LIEUTENANT_EVENTS : LIEUTENANT_EVENTS;
  const personal = deck.filter((event) => (
    [...activeIds].some((id) => event.id.startsWith(`${id}_`))
  ));
  return personal.length ? [...CASUAL_EVENTS, ...personal] : CASUAL_EVENTS;
}

function casualDefaults() {
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

export function ensureCasualState(state) {
  state.casual = { ...casualDefaults(), ...(state.casual || {}) };
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
  if (state.demo) {
    if (state.demo.roadEvent === undefined) state.demo.roadEvent = state.demo.activeRoadEvent || null;
    if (state.demo.activeRoadEvent === undefined) state.demo.activeRoadEvent = state.demo.roadEvent || null;
  }
  return state.casual;
}

function activeTroopCap(state) {
  return state.player.act >= 3
    ? CONFIG.ACT3_TROOP_CAP
    : state.player.act >= 2
      ? CONFIG.ACT2_TROOP_CAP
      : CONFIG.ACT1_TROOP_CAP;
}

function playerSnapshot(state, factionId) {
  return {
    gold: state.player.gold,
    troops: getTroopCount(state.player),
    renown: state.player.renown,
    relation: Number(state.player.relations[factionId]) || 0
  };
}

function snapshotDelta(before, after) {
  return Object.fromEntries(
    Object.keys(before).map((key) => [key, after[key] - before[key]])
  );
}

export function applyEffects(state, effects = {}, options = {}) {
  const factionId = options.factionId || state.factions[0]?.id || null;
  const beforeTroops = getTroopCount(state.player);
  const beforeGold = state.player.gold;
  state.player.gold = Math.max(0, state.player.gold + (Number(effects.gold) || 0));
  changePlayerRenown(state, Number(effects.renown) || 0);

  const requestedTroops = Number(effects.troops) || 0;
  const targetTroops = clamp(
    beforeTroops + requestedTroops,
    CONFIG.ROAD_EVENT_MIN_PLAYER_TROOPS,
    activeTroopCap(state)
  );
  const troopDelta = targetTroops - beforeTroops;
  if (troopDelta > 0) incrementTroop(state.player, "militia", troopDelta);
  if (troopDelta < 0) applyCasualties(state.player, -troopDelta);

  const relation = Number(state.player.relations[factionId]) || 0;
  state.player.relations[factionId] = clamp(
    relation + (Number(effects.relation) || 0),
    CONFIG.ROAD_EVENT_RELATION_MIN,
    CONFIG.ROAD_EVENT_RELATION_MAX
  );
  const special = {
    banditBattlesBlockedDay: null,
    nextBattleAttackMultiplier: null,
    deserterLost: 0
  };
  if (effects.blockBanditBattlesToday) {
    state.casual.banditBattlesBlockedDay = state.stats.days;
    special.banditBattlesBlockedDay = state.stats.days;
  }
  if (Number(effects.nextBattleAttackBonus) > 0) {
    state.casual.nextBattleAttackMultiplier = Math.max(
      state.casual.nextBattleAttackMultiplier,
      1 + Number(effects.nextBattleAttackBonus)
    );
    special.nextBattleAttackMultiplier = state.casual.nextBattleAttackMultiplier;
  }
  if (
    Number(effects.desertionChance) > 0 &&
    nextFloat(state.rng) < Number(effects.desertionChance)
  ) {
    const removable = Math.max(
      0,
      getTroopCount(state.player) - CONFIG.ROAD_EVENT_MIN_PLAYER_TROOPS
    );
    special.deserterLost = applyCasualties(
      state.player,
      Math.min(CONFIG.ROAD_EVENT_DESERTER_COUNT, removable)
    );
  }
  state.stats.goldEarned += Math.max(0, state.player.gold - beforeGold);
  state.stats.peakGold = Math.max(state.stats.peakGold || 0, state.player.gold);
  state.stats.peakTroops = Math.max(state.stats.peakTroops || 0, getTroopCount(state.player));
  return special;
}

function compactAppliedEffects(effects, delta, special) {
  const applied = Object.fromEntries(
    Object.entries(delta).filter(([, value]) => Number(value) !== 0)
  );
  if (effects.blockBanditBattlesToday && special.banditBattlesBlockedDay !== null) {
    applied.banditBattlesBlockedDay = special.banditBattlesBlockedDay;
  }
  if (Number(effects.nextBattleAttackBonus) > 0 && special.nextBattleAttackMultiplier !== null) {
    applied.nextBattleAttackMultiplier = special.nextBattleAttackMultiplier;
  }
  if (Number(effects.desertionChance) > 0) {
    applied.desertionChance = Number(effects.desertionChance);
    applied.deserterLost = special.deserterLost;
  }
  return applied;
}

function nextEventDefinition(state) {
  const definitions = getRoadEventDefinitions(state);
  const recent = new Set(
    state.casual.eventHistory
      .slice(-(definitions.length - 1))
      .map((entry) => entry.eventId)
  );
  const unseen = definitions.filter((event) => !recent.has(event.id));
  const candidates = unseen.length ? unseen : definitions;
  return candidates[randomInt(state.rng, 0, candidates.length)];
}

export function getActiveRoadEvent(state) {
  const active = state.demo?.activeRoadEvent || state.demo?.roadEvent;
  if (!active) return null;
  const event = getRoadEventDefinitions(state)
    .find((entry) => entry.id === (active.eventId || active.id)) || null;
  return event ? { ...active, event } : null;
}

export function processDailyRoadEvent(state, options = {}) {
  ensureCasualState(state);
  const day = state.stats.days;
  if (state.casual.roadEventDay !== day) {
    state.casual.roadEventDay = day;
    state.casual.roadEventsToday = 0;
  }
  if (!options.onRoad) return { triggered: false, reason: "offRoad", day };
  if (state.casual.lastRoadEventRollDay === day) {
    return { triggered: false, reason: "alreadyRolled", day };
  }
  state.casual.lastRoadEventRollDay = day;
  if (state.battle || state.demo?.modal || state.demo?.ended) {
    return { triggered: false, reason: "busy", day };
  }
  if (state.casual.roadEventsToday >= CONFIG.MAX_DAILY_EVENTS) {
    return { triggered: false, reason: "dailyLimit", day };
  }
  const pity = state.casual.firstRoadEventDay === null && day >= CONFIG.ROAD_FIRST_EVENT_PITY_DAY;
  if (!pity && nextFloat(state.rng) >= CONFIG.ROAD_DAILY_EVENT_CHANCE) {
    return { triggered: false, reason: "chance", day };
  }

  const event = nextEventDefinition(state);
  const town = nearestTown(state, state.player.pos);
  const roadEvent = {
    id: event.id,
    eventId: event.id,
    day,
    factionId: town?.factionId || state.factions[0]?.id || null,
    resumePaused: Boolean(state.paused),
    resumePauseReason: state.demo?.pauseReason || null
  };
  state.casual.roadEventsToday += 1;
  if (state.casual.firstRoadEventDay === null) {
    state.casual.firstRoadEventDay = day;
    state.casual.firstRoadEventTick = state.tick;
    state.casual.firstRoadEventSeconds = Number(state.telemetry?.totalActiveSeconds) || (
      state.tick * CONFIG.LOGIC_MS / 1000
    );
  }
  state.demo.roadEvent = roadEvent;
  state.demo.activeRoadEvent = roadEvent;
  state.demo.modal = "roadEvent";
  state.demo.pauseReason = "roadEvent";
  state.paused = true;
  addEvent(state, "log.roadEvent", {
    eventId: event.id,
    factionId: roadEvent.factionId,
    day
  });
  return { triggered: true, day, event, roadEvent };
}

export function chooseRoadEvent(state, choiceIndex) {
  ensureCasualState(state);
  const active = state.demo?.activeRoadEvent || state.demo?.roadEvent;
  if (!active) return { ok: false, reason: "noRoadEvent" };
  const event = getRoadEventDefinitions(state)
    .find((entry) => entry.id === (active.eventId || active.id));
  const index = Number(choiceIndex);
  if (!event) return { ok: false, reason: "missingEvent" };
  if (!Number.isInteger(index) || index < 0 || index >= event.choices.length) {
    return { ok: false, reason: "invalidChoice" };
  }

  const choice = event.choices[index];
  const before = playerSnapshot(state, active.factionId);
  const special = applyEffects(state, choice.effects, { factionId: active.factionId });
  const after = playerSnapshot(state, active.factionId);
  const delta = snapshotDelta(before, after);
  const effectsApplied = compactAppliedEffects(choice.effects, delta, special);
  const historyEntry = {
    eventId: event.id,
    choiceIndex: index,
    day: active.day,
    factionId: active.factionId,
    delta,
    effectsApplied
  };
  state.casual.eventHistory.push(historyEntry);
  state.casual.eventHistory = state.casual.eventHistory.slice(-CONFIG.ROAD_EVENT_HISTORY_LIMIT);
  if (state.telemetry) {
    state.telemetry.eventChoices = Array.isArray(state.telemetry.eventChoices)
      ? state.telemetry.eventChoices
      : [];
    state.telemetry.eventChoices.push({
      cardId: event.id,
      choice: index,
      effectsApplied,
      eventId: event.id,
      choiceIndex: index,
      day: active.day,
      delta: Object.fromEntries(Object.entries(delta).filter(([, value]) => value !== 0))
    });
    state.telemetry.eventChoices = state.telemetry.eventChoices.slice(-CONFIG.ROAD_EVENT_HISTORY_LIMIT);
    if (["chen_mang_", "shen_wen_", "jia_duojin_"].some((prefix) => event.id.startsWith(prefix))) {
      state.telemetry.lieutenantEventChoices = Array.isArray(state.telemetry.lieutenantEventChoices)
        ? state.telemetry.lieutenantEventChoices
        : [];
      state.telemetry.lieutenantEventChoices.push({
        cardId: event.id,
        choice: index,
        effectsApplied,
        day: active.day
      });
      state.telemetry.lieutenantEventChoices = state.telemetry.lieutenantEventChoices
        .slice(-CONFIG.ROAD_EVENT_HISTORY_LIMIT);
    }
  }
  state.demo.roadEvent = null;
  state.demo.activeRoadEvent = null;
  if (state.demo.modal === "roadEvent") {
    state.demo.modal = null;
    state.demo.pauseReason = active.resumePauseReason || null;
    state.paused = Boolean(active.resumePaused);
  }
  addEvent(state, "log.roadEventResolved", {
    eventId: event.id,
    choiceIndex: index,
    factionId: active.factionId,
    choiceLabel: choice.label,
    effectsApplied,
    ...delta
  });
  return {
    ok: true,
    eventId: event.id,
    choiceIndex: index,
    event,
    choice,
    effects: choice.effects,
    effectsApplied,
    applied: { delta, effectsApplied, ...special },
    before,
    after,
    delta,
    historyEntry
  };
}

export function areBanditBattlesBlocked(state) {
  ensureCasualState(state);
  const escortActive = state.player.contract?.active === true && state.player.contract.type === "escort";
  return escortActive || state.casual.banditBattlesBlockedDay === state.stats.days;
}

export function consumePlayerAttackMultiplier(state) {
  ensureCasualState(state);
  const multiplier = state.casual.nextBattleAttackMultiplier;
  state.casual.nextBattleAttackMultiplier = 1;
  return multiplier;
}

function banditCount(bandit) {
  return bandit.troops.find((stack) => stack.type === "bandit")?.count || 0;
}

function setBanditCount(bandit, count) {
  let stack = bandit.troops.find((entry) => entry.type === "bandit");
  if (!stack) {
    stack = { type: "bandit", count: 0, xp: 0 };
    bandit.troops.push(stack);
  }
  stack.count = Math.max(1, Math.floor(count));
}

function countForRatio(state, ratio) {
  const playerStrength = Math.max(TROOP_TYPES.militia.atk, state.player.troops.reduce((sum, stack) => {
    return sum + (TROOP_TYPES[stack.type]?.atk || 0) * stack.count;
  }, 0));
  return Math.max(1, Math.round(playerStrength * ratio / TROOP_TYPES.bandit.atk));
}

function openingCountForRatio(state, ratio) {
  const playerStrength = Math.max(TROOP_TYPES.militia.atk, state.player.troops.reduce((sum, stack) => {
    return sum + (TROOP_TYPES[stack.type]?.atk || 0) * stack.count;
  }, 0));
  const minimumCount = Math.max(1, Math.ceil(
    playerStrength * CONFIG.STARTER_BATTLE_STRENGTH_MIN / TROOP_TYPES.bandit.atk
  ));
  const maximumCount = Math.max(1, Math.floor(
    playerStrength * CONFIG.STARTER_BATTLE_STRENGTH_MAX / TROOP_TYPES.bandit.atk
  ));
  const desired = Math.max(1, Math.round(playerStrength * ratio / TROOP_TYPES.bandit.atk));
  return minimumCount <= maximumCount
    ? clamp(desired, minimumCount, maximumCount)
    : desired;
}

function maximumCountForRatio(state, ratio) {
  const playerStrength = Math.max(TROOP_TYPES.militia.atk, state.player.troops.reduce((sum, stack) => {
    return sum + (TROOP_TYPES[stack.type]?.atk || 0) * stack.count;
  }, 0));
  return Math.max(1, Math.floor(playerStrength * ratio / TROOP_TYPES.bandit.atk));
}

function rescaleLoot(bandit, oldCount, newCount, multiplier = 1) {
  const oldLoot = Number.isFinite(bandit.lootValue)
    ? bandit.lootValue
    : Math.floor((bandit.gold || 0) * CONFIG.LOOT_SHARE);
  const minimum = bandit.jackpot ? CONFIG.LOOT_JACKPOT_MIN : 1;
  const scaled = Math.max(
    minimum,
    Math.round(oldLoot * (newCount / Math.max(1, oldCount)) * multiplier)
  );
  bandit.lootValue = scaled;
  bandit.gold = Math.ceil(scaled / CONFIG.LOOT_SHARE);
  return scaled;
}

export function prepareStarterBattle(state, bandit) {
  ensureCasualState(state);
  if (!bandit || state.casual.openingBattlesPrepared >= CONFIG.STARTER_BATTLE_COUNT) return null;
  if (bandit.elite || bandit.isElite) return null;
  const battleNumber = state.casual.openingBattlesPrepared + 1;
  state.casual.openingBattlesPrepared = battleNumber;

  const ratio = randomBetween(
    state.rng,
    CONFIG.STARTER_BATTLE_STRENGTH_MIN,
    CONFIG.STARTER_BATTLE_STRENGTH_MAX
  );
  const oldCount = Math.max(1, banditCount(bandit));
  const newCount = openingCountForRatio(state, ratio);
  setBanditCount(bandit, newCount);
  const currentLoot = Number.isFinite(bandit.lootValue)
    ? bandit.lootValue
    : Math.floor((bandit.gold || 0) * CONFIG.LOOT_SHARE);
  bandit.casualBaseLootPerTroop ??= currentLoot / oldCount;
  const minimumLoot = bandit.jackpot ? CONFIG.LOOT_JACKPOT_MIN : 1;
  const lootValue = Math.max(minimumLoot, Math.round(
    bandit.casualBaseLootPerTroop * newCount * CONFIG.STARTER_BATTLE_LOOT_MULTIPLIER
  ));
  bandit.lootValue = lootValue;
  bandit.gold = Math.ceil(lootValue / CONFIG.LOOT_SHARE);
  const balance = {
    type: "starter",
    battleNumber,
    applied: true,
    targetRatio: ratio,
    actualRatio: newCount * TROOP_TYPES.bandit.atk / Math.max(
      TROOP_TYPES.militia.atk,
      state.player.troops.reduce((sum, stack) => sum + (TROOP_TYPES[stack.type]?.atk || 0) * stack.count, 0)
    ),
    troopCount: newCount,
    lootMultiplier: CONFIG.STARTER_BATTLE_LOOT_MULTIPLIER,
    lootValue
  };
  bandit.casualBalance = balance;
  state.casual.lastBattleBalance = balance;
  return balance;
}

export function isStarterBattleProtected(state, bandit) {
  ensureCasualState(state);
  return Boolean(
    bandit &&
    (bandit.elite || bandit.isElite) &&
    state.casual.openingBattlesPrepared < CONFIG.STARTER_BATTLE_COUNT
  );
}

export function recordPlayerBattleOutcome(state, outcome) {
  ensureCasualState(state);
  state.casual.playerBattlesResolved += 1;
  if (outcome === "win") {
    state.casual.winStreak += 1;
    state.casual.lossStreak = 0;
    if (state.casual.winStreak >= CONFIG.WIN_STREAK_TRIGGER) {
      state.casual.largeSpawnPending = true;
      state.casual.winStreak = 0;
    }
  } else if (outcome === "loss") {
    state.casual.lossStreak += 1;
    state.casual.winStreak = 0;
    if (state.casual.lossStreak >= CONFIG.LOSS_STREAK_TRIGGER) {
      state.casual.recoverySpawnsRemaining = CONFIG.LOSS_STREAK_SPAWN_COUNT;
      state.casual.lossStreak = 0;
    }
  }
  return {
    outcome,
    winStreak: state.casual.winStreak,
    lossStreak: state.casual.lossStreak,
    recoverySpawnsRemaining: state.casual.recoverySpawnsRemaining,
    largeSpawnPending: state.casual.largeSpawnPending
  };
}

export function getNextSpawnBalance(state) {
  ensureCasualState(state);
  if (state.casual.recoverySpawnsRemaining > 0) {
    return { type: "recovery", maxRatio: CONFIG.LOSS_STREAK_SPAWN_MAX_RATIO };
  }
  if (state.casual.largeSpawnPending) {
    return { type: "large", ratio: CONFIG.WIN_STREAK_BIG_SPAWN_RATIO };
  }
  return { type: "normal" };
}

export function applyCasualSpawnBalance(state, bandit) {
  ensureCasualState(state);
  if (!bandit || bandit.elite || bandit.isElite) return null;
  const rule = getNextSpawnBalance(state);
  if (rule.type === "normal") return null;

  const oldCount = Math.max(1, banditCount(bandit));
  let newCount = oldCount;
  if (rule.type === "recovery") {
    newCount = Math.min(oldCount, maximumCountForRatio(state, rule.maxRatio));
    state.casual.recoverySpawnsRemaining -= 1;
  } else {
    newCount = countForRatio(state, rule.ratio);
    state.casual.largeSpawnPending = false;
    bandit.largePack = true;
  }
  setBanditCount(bandit, newCount);
  const lootValue = rescaleLoot(bandit, oldCount, newCount);
  const balance = {
    ...rule,
    applied: true,
    troopCount: newCount,
    lootValue,
    remainingRecoverySpawns: state.casual.recoverySpawnsRemaining
  };
  bandit.casualBalance = balance;
  state.casual.lastSpawnBalance = balance;
  if (rule.type === "large") {
    const town = nearestTown(state, bandit.pos);
    addEvent(state, "log.largeBanditNearby", {
      banditId: bandit.id,
      townId: town?.id || null,
      ratio: CONFIG.WIN_STREAK_BIG_SPAWN_RATIO
    }, "danger");
  }
  return balance;
}

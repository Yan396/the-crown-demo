import { CONFIG, TROOP_TYPES } from "./data.js";
import { nextFloat, randomBetween, randomInt } from "./rng.js";
import {
  addEvent,
  assignBanditMoveTarget,
  clamp,
  copyPosition,
  distance,
  getPartyStrength,
  getTown,
  incrementTroop
} from "./state.js";

function desiredBanditCount(state, elite) {
  const playerStrength = Math.max(TROOP_TYPES.militia.atk, getPartyStrength(state.player));
  const minimum = elite ? CONFIG.ELITE_BANDIT_STRENGTH_MIN : CONFIG.BANDIT_STRENGTH_MIN;
  const maximum = elite ? CONFIG.ELITE_BANDIT_STRENGTH_MAX : CONFIG.BANDIT_STRENGTH_MAX;
  const desiredStrength = playerStrength * randomBetween(state.rng, minimum, maximum);
  let count = Math.max(1, Math.round(desiredStrength / TROOP_TYPES.bandit.atk));

  if (elite) {
    const minimumCount = Math.max(1, Math.ceil(playerStrength * minimum / TROOP_TYPES.bandit.atk));
    const maximumCount = Math.max(minimumCount, Math.floor(playerStrength * maximum / TROOP_TYPES.bandit.atk));
    count = clamp(count, minimumCount, maximumCount);
  }
  return count;
}

function rollLoot(state, count, elite) {
  const randomizedBase = Math.max(1, Math.floor(
    count * CONFIG.BANDIT_GOLD_PER_TROOP * CONFIG.LOOT_SHARE * randomBetween(
      state.rng,
      CONFIG.LOOT_RANDOM_MIN,
      CONFIG.LOOT_RANDOM_MAX
    )
  ));
  const jackpot = nextFloat(state.rng) < CONFIG.LOOT_JACKPOT_CHANCE;
  const jackpotAward = jackpot
    ? Math.max(
      CONFIG.LOOT_JACKPOT_MIN,
      randomizedBase + randomInt(state.rng, 0, CONFIG.LOOT_JACKPOT_BONUS_MAX + 1)
    )
    : randomizedBase;
  const multiplier = elite ? CONFIG.ELITE_BANDIT_LOOT_MULTIPLIER : 1;
  return {
    value: jackpotAward * multiplier,
    jackpot,
    multiplier
  };
}

function applyBanditProfile(state, bandit, elite, rerollStrength = true) {
  const isElite = Boolean(elite);
  if (rerollStrength) {
    const count = desiredBanditCount(state, isElite);
    const existing = bandit.troops.find((stack) => stack.type === "bandit");
    if (existing) existing.count = count;
    else incrementTroop(bandit, "bandit", count);
  }
  const count = bandit.troops.find((stack) => stack.type === "bandit")?.count || 1;
  const loot = rollLoot(state, count, isElite);
  bandit.elite = isElite;
  bandit.isElite = isElite;
  bandit.kind = isElite ? "elite" : "normal";
  bandit.markerScale = isElite
    ? CONFIG.ELITE_MARKER_SIZE_MULTIPLIER
    : CONFIG.NORMAL_MARKER_SIZE_MULTIPLIER;
  bandit.marker = {
    kind: isElite ? "elite" : "normal",
    sizeMultiplier: isElite
      ? CONFIG.ELITE_MARKER_SIZE_MULTIPLIER
      : CONFIG.NORMAL_MARKER_SIZE_MULTIPLIER,
    palette: isElite ? "dark" : "gray"
  };
  bandit.lootMultiplier = loot.multiplier;
  bandit.lootValue = loot.value;
  bandit.jackpot = loot.jackpot;
  // Keep legacy consumers meaningful while battle.js prefers lootValue.
  bandit.gold = Math.ceil(loot.value / CONFIG.LOOT_SHARE);
  return bandit;
}

function chooseSpawnPosition(state, town) {
  let position = copyPosition(town.pos);
  for (let attempt = 0; attempt < CONFIG.BANDIT_SPAWN_ATTEMPTS; attempt += 1) {
    const angle = randomBetween(state.rng, 0, Math.PI * 2);
    const radius = randomBetween(state.rng, CONFIG.BANDIT_SPAWN_MIN, CONFIG.BANDIT_SPAWN_MAX);
    position = {
      x: clamp(
        town.pos.x + Math.cos(angle) * radius,
        CONFIG.BANDIT_WORLD_MARGIN,
        CONFIG.WORLD_SIZE - CONFIG.BANDIT_WORLD_MARGIN
      ),
      y: clamp(
        town.pos.y + Math.sin(angle) * radius,
        CONFIG.BANDIT_WORLD_MARGIN,
        CONFIG.WORLD_SIZE - CONFIG.BANDIT_WORLD_MARGIN
      )
    };
    if (distance(position, state.player.pos) > (
      CONFIG.ENCOUNTER_RADIUS * CONFIG.BANDIT_PLAYER_SAFE_RADIUS_MULTIPLIER
    )) break;
  }
  return position;
}

export function spawnScaledBandit(state, options = {}) {
  const elite = Boolean(options.elite);
  const maximum = Number.isFinite(options.maximum)
    ? Math.max(CONFIG.MAX_BANDITS, Math.floor(options.maximum))
    : CONFIG.MAX_BANDITS;
  if (!elite && state.bandits.length >= maximum) return null;
  if (elite && state.bandits.some((bandit) => bandit.elite || bandit.isElite)) return null;

  const preferredTown = options.townId ? getTown(state, options.townId) : null;
  const town = preferredTown || state.towns[randomInt(state.rng, 0, state.towns.length)];
  const position = chooseSpawnPosition(state, town);
  const bandit = {
    id: `bandit_${state.nextBanditId}`,
    pos: position,
    prevPos: copyPosition(position),
    moveTarget: null,
    troops: [{ type: "bandit", count: 1, xp: 0 }],
    gold: 0
  };
  state.nextBanditId += 1;
  applyBanditProfile(state, bandit, elite, true);
  assignBanditMoveTarget(state, bandit);
  state.bandits.push(bandit);
  if (elite) {
    addEvent(state, "log.eliteSpawned", {
      banditId: bandit.id,
      townId: town.id,
      count: bandit.troops[0].count,
      jackpot: bandit.jackpot
    }, "danger");
  }
  return bandit;
}

function rescaleEliteIfNeeded(state, elite) {
  if (state.battle) return;
  const playerStrength = Math.max(TROOP_TYPES.militia.atk, getPartyStrength(state.player));
  const eliteStrength = getPartyStrength(elite);
  const minimumStrength = playerStrength * CONFIG.ELITE_BANDIT_STRENGTH_MIN;
  const maximumStrength = playerStrength * CONFIG.ELITE_BANDIT_STRENGTH_MAX;
  if (eliteStrength < minimumStrength || eliteStrength > maximumStrength) {
    applyBanditProfile(state, elite, true, true);
  }
}

export function ensureEliteBandit(state) {
  const elites = state.bandits
    .filter((bandit) => bandit.elite || bandit.isElite)
    .sort((first, second) => first.id.localeCompare(second.id));

  if (elites.length > 1) {
    elites.slice(1).forEach((bandit) => applyBanditProfile(state, bandit, false, true));
  }

  let elite = elites[0] || null;
  if (!elite) {
    // Keep the closest early-game target ordinary: the elite is promoted from
    // the bandit already farthest from the player.
    const candidate = [...state.bandits].sort((first, second) => (
      distance(second.pos, state.player.pos) - distance(first.pos, state.player.pos) ||
      first.id.localeCompare(second.id)
    ))[0];
    if (candidate) {
      elite = applyBanditProfile(state, candidate, true, true);
      const town = state.towns.reduce((nearest, entry) => {
        if (!nearest) return entry;
        return distance(entry.pos, elite.pos) < distance(nearest.pos, elite.pos) ? entry : nearest;
      }, null);
      addEvent(state, "log.eliteSpawned", {
        banditId: elite.id,
        townId: town?.id || null,
        count: elite.troops[0].count,
        jackpot: elite.jackpot
      }, "danger");
    } else {
      elite = spawnScaledBandit(state, { elite: true });
    }
  }

  rescaleEliteIfNeeded(state, elite);
  return elite;
}

export function normalizeBandits(state) {
  state.bandits.forEach((bandit) => {
    if (typeof bandit.elite !== "boolean" && typeof bandit.isElite !== "boolean") {
      applyBanditProfile(state, bandit, false, false);
      return;
    }
    bandit.elite = Boolean(bandit.elite || bandit.isElite);
    bandit.isElite = bandit.elite;
    if (!bandit.marker || !Number.isFinite(bandit.lootValue)) {
      applyBanditProfile(state, bandit, bandit.elite, false);
    }
  });
  return ensureEliteBandit(state);
}

export function removeBanditAndMaintainElite(state, banditId) {
  const removed = state.bandits.find((bandit) => bandit.id === banditId) || null;
  state.bandits = state.bandits.filter((bandit) => bandit.id !== banditId);
  if (removed?.elite || removed?.isElite) spawnScaledBandit(state, { elite: true });
  else ensureEliteBandit(state);
  return removed;
}

export function ensureLivingState(state) {
  state.stats.wins = Math.max(0, Number(state.stats.wins) || 0);
  state.stats.jackpots = Math.max(0, Number(state.stats.jackpots) || 0);
  state.stats.eliteWins = Math.max(0, Number(state.stats.eliteWins) || 0);
  state.stats.wagesPaid = Math.max(0, Number(state.stats.wagesPaid) || 0);
  state.stats.contractGold = Math.max(0, Number(state.stats.contractGold) || 0);
  state.mechanics ||= {};
  [
    "contractsAccepted",
    "contractBattles",
    "lordBattles",
    "townsCaptured",
    "warsDeclared",
    "peaceTreaties"
  ].forEach((key) => {
    state.mechanics[key] = Math.max(0, Number(state.mechanics[key]) || 0);
  });
  normalizeBandits(state);
  return state;
}

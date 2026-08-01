import { CONFIG } from "./data.js";
import { nextFloat } from "./rng.js";
import {
  addEvent,
  applyCasualties,
  assignBanditMoveTarget,
  awardSurvivorXp,
  copyPosition,
  distance,
  getAverageDefense,
  getPartyStrength,
  getTroopCount,
  incrementTroop,
  nearestTown
} from "./state.js";

function calculateCasualties(attackStrength, defender, multiplier) {
  const defenders = getTroopCount(defender);
  if (attackStrength <= 0 || defenders <= 0) return 0;
  const damage = attackStrength * multiplier * CONFIG.FIELD_TERRAIN;
  return Math.min(defenders, Math.max(1, Math.floor(damage / getAverageDefense(defender))));
}

function determineWinner(state, battle, bandit) {
  const playerRemaining = getTroopCount(state.player);
  const banditRemaining = getTroopCount(bandit);
  if (playerRemaining <= 0 && banditRemaining <= 0) return "bandit";
  if (playerRemaining <= 0) return "bandit";
  if (banditRemaining <= 0) return "player";

  const playerRouted = playerRemaining < battle.playerStart * CONFIG.ROUT_THRESHOLD;
  const banditRouted = banditRemaining < battle.banditStart * CONFIG.ROUT_THRESHOLD;
  if (playerRouted && !banditRouted) return "bandit";
  if (banditRouted && !playerRouted) return "player";

  if (playerRouted && banditRouted) {
    const playerRatio = playerRemaining / battle.playerStart;
    const banditRatio = banditRemaining / battle.banditStart;
    if (playerRatio !== banditRatio) return playerRatio > banditRatio ? "player" : "bandit";
    return getPartyStrength(state.player) > getPartyStrength(bandit) ? "player" : "bandit";
  }

  return null;
}

function removeBandit(state, id) {
  state.bandits = state.bandits.filter((bandit) => bandit.id !== id);
}

function finishBattle(state, winner, bandit) {
  const battle = state.battle;
  if (!battle) return null;
  state.stats.battles += 1;
  state.stats.kills += battle.banditCasualties;

  let result;
  if (winner === "player") {
    const loot = Math.floor(bandit.gold * CONFIG.LOOT_SHARE);
    const renown = battle.banditCasualties * CONFIG.RENOWN_PER_ENEMY_CASUALTY;
    state.player.gold += loot;
    state.player.renown += renown;
    state.stats.goldEarned += loot;
    awardSurvivorXp(state.player);
    removeBandit(state, bandit.id);
    addEvent(state, "log.victory", { loot, renown }, "win");
    result = { type: "victory", loot, renown };
  } else {
    const goldAfterLoss = Math.floor(state.player.gold * CONFIG.PLAYER_GOLD_RETAINED_ON_LOSS);
    const lostGold = state.player.gold - goldAfterLoss;
    state.player.gold = goldAfterLoss;

    if (getTroopCount(bandit) > 0) {
      bandit.gold += lostGold;
      awardSurvivorXp(bandit);
      assignBanditMoveTarget(state, bandit);
    } else {
      removeBandit(state, bandit.id);
    }

    if (getTroopCount(state.player) <= 0) incrementTroop(state.player, "militia", 1);
    const refuge = nearestTown(state, state.player.pos);
    state.player.pos = copyPosition(refuge.pos);
    state.player.prevPos = copyPosition(refuge.pos);
    state.player.moveTarget = null;
    state.player.encounterCooldownUntil = state.tick + CONFIG.RESPAWN_GRACE_TICKS;
    addEvent(state, "log.defeat", { lostGold, townId: refuge.id }, "loss");
    result = { type: "defeat", lostGold, townId: refuge.id };
  }

  state.battle = null;
  return result;
}

export function resolveBattleRound(state) {
  const battle = state.battle;
  if (!battle) return null;
  const bandit = state.bandits.find((entry) => entry.id === battle.banditId);
  if (!bandit) {
    state.battle = null;
    return null;
  }

  if (battle.round >= CONFIG.MAX_BATTLE_ROUNDS) {
    const winner = getPartyStrength(state.player) > getPartyStrength(bandit) ? "player" : "bandit";
    return finishBattle(state, winner, bandit);
  }

  const playerAttack = getPartyStrength(state.player);
  const banditAttack = getPartyStrength(bandit);
  const playerMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
    CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
  );
  const banditMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
    CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
  );
  const banditLoss = calculateCasualties(playerAttack, bandit, playerMultiplier);
  const playerLoss = calculateCasualties(banditAttack, state.player, banditMultiplier);

  const actualBanditLoss = applyCasualties(bandit, banditLoss);
  const actualPlayerLoss = applyCasualties(state.player, playerLoss);
  battle.round += 1;
  battle.playerCasualties += actualPlayerLoss;
  battle.banditCasualties += actualBanditLoss;
  addEvent(state, "log.battleRound", {
    round: battle.round,
    banditLoss: actualBanditLoss,
    playerLoss: actualPlayerLoss
  }, "round");

  const winner = determineWinner(state, battle, bandit);
  if (winner) return finishBattle(state, winner, bandit);
  battle.nextRoundTick = state.tick + CONFIG.BATTLE_ROUND_TICKS;
  return null;
}

export function startBattle(state, bandit) {
  if (state.battle) return null;
  state.player.moveTarget = null;
  state.battle = {
    banditId: bandit.id,
    playerStart: getTroopCount(state.player),
    banditStart: getTroopCount(bandit),
    playerCasualties: 0,
    banditCasualties: 0,
    round: 0,
    nextRoundTick: state.tick + CONFIG.BATTLE_ROUND_TICKS
  };
  addEvent(state, "log.encounter", {
    playerCount: getTroopCount(state.player),
    banditCount: getTroopCount(bandit)
  }, "round");

  if (getTroopCount(state.player) <= 0) return finishBattle(state, "bandit", bandit);
  return null;
}

export function checkForEncounter(state) {
  if (state.battle || state.tick < state.player.encounterCooldownUntil) return null;
  const candidates = state.bandits
    .map((bandit) => ({ bandit, separation: distance(state.player.pos, bandit.pos) }))
    .filter((entry) => entry.separation <= CONFIG.ENCOUNTER_RADIUS)
    .sort((first, second) => first.separation - second.separation || first.bandit.id.localeCompare(second.bandit.id));
  return candidates.length ? startBattle(state, candidates[0].bandit) : null;
}

export function skipBattle(state) {
  let result = null;
  let safety = CONFIG.MAX_BATTLE_ROUNDS;
  while (state.battle && safety > 0) {
    result = resolveBattleRound(state) || result;
    safety -= 1;
  }
  return result;
}

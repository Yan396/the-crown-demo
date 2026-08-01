import { CONFIG } from "./data.js";
import {
  areBanditBattlesBlocked,
  consumePlayerAttackMultiplier,
  isStarterBattleProtected,
  prepareStarterBattle,
  recordPlayerBattleOutcome
} from "./casual.js";
import { nextFloat } from "./rng.js";
import {
  recordBattleOutcome,
  recordBiggestBattle
} from "./telemetry.js";
import {
  ensureLivingState,
  removeBanditAndMaintainElite
} from "./living.js";
import {
  addEvent,
  applyCasualties,
  assignBanditMoveTarget,
  awardSurvivorXp,
  clamp,
  copyPosition,
  distance,
  getAverageDefense,
  getPartyStrength,
  getTroopCount,
  incrementTroop,
  nearestTown
} from "./state.js";

function calculateCasualties(attackStrength, defender, multiplier, terrain = CONFIG.FIELD_TERRAIN) {
  const defenders = getTroopCount(defender);
  if (attackStrength <= 0 || defenders <= 0) return 0;
  const damage = attackStrength * multiplier * terrain;
  return Math.min(defenders, Math.max(1, Math.floor(damage / getAverageDefense(defender))));
}

function routed(remaining, starting) {
  return starting > 0 && remaining < starting * CONFIG.ROUT_THRESHOLD;
}

function determineWinner(first, second, firstStart, secondStart) {
  const firstRemaining = getTroopCount(first);
  const secondRemaining = getTroopCount(second);
  if (firstRemaining <= 0 && secondRemaining <= 0) return "first";
  if (firstRemaining <= 0) return "second";
  if (secondRemaining <= 0) return "first";

  const firstRouted = routed(firstRemaining, firstStart);
  const secondRouted = routed(secondRemaining, secondStart);
  if (firstRouted && !secondRouted) return "second";
  if (secondRouted && !firstRouted) return "first";
  if (firstRouted && secondRouted) {
    const firstRatio = firstRemaining / firstStart;
    const secondRatio = secondRemaining / secondStart;
    if (firstRatio !== secondRatio) return firstRatio > secondRatio ? "first" : "second";
    return getPartyStrength(first) >= getPartyStrength(second) ? "first" : "second";
  }
  return null;
}

function incrementTelemetry(state, key, amount = 1) {
  if (!state.telemetry) return;
  state.telemetry[key] = Math.max(0, Number(state.telemetry[key]) || 0) + amount;
}

function playerContractPayment(state) {
  const contract = state.player.contract;
  if (!contract || contract.active === false || state.player.act < 2) return 0;
  const pay = Math.max(
    0,
    Number(contract.reward ?? contract.payPerBattle) || CONFIG.MERCENARY_PAY_PER_BATTLE
  );
  state.player.gold += pay;
  state.stats.goldEarned += pay;
  state.stats.contractGold += pay;
  contract.battlesWon = (contract.battlesWon || 0) + 1;
  contract.goldEarned = (contract.goldEarned || 0) + pay;
  state.mechanics.contractBattles += 1;
  const oldRelation = Number(state.player.relations[contract.factionId]) || 0;
  state.player.relations[contract.factionId] = oldRelation + CONFIG.MERCENARY_RELATION_PER_WIN;
  addEvent(state, "log.contractPaid", {
    contractId: contract.id,
    factionId: contract.factionId,
    reward: pay,
    battlesWon: contract.battlesWon
  }, "win");
  return pay;
}

function playerBattleWinner(state, battle, bandit) {
  const elite = Boolean(bandit.elite || bandit.isElite);
  const loot = Math.max(0, Number.isFinite(bandit.lootValue)
    ? bandit.lootValue
    : Math.floor(bandit.gold * CONFIG.LOOT_SHARE));
  const renown = battle.banditCasualties * CONFIG.RENOWN_PER_ENEMY_CASUALTY;
  state.player.gold += loot;
  state.player.renown += renown;
  state.stats.goldEarned += loot;
  state.stats.wins += 1;
  if (bandit.jackpot) state.stats.jackpots += 1;
  if (elite) state.stats.eliteWins += 1;
  incrementTelemetry(state, "battlesWon");
  if (getTroopCount(state.player) <= 0) incrementTroop(state.player, "militia", 1);
  awardSurvivorXp(state.player);
  removeBanditAndMaintainElite(state, bandit.id);
  const contractPay = playerContractPayment(state);

  addEvent(state, "log.victory", { loot, renown }, "win");
  if (bandit.jackpot) {
    addEvent(state, "log.jackpot", { banditId: bandit.id, bonus: loot, elite }, "win");
  }
  if (elite) addEvent(state, "log.eliteVictory", { banditId: bandit.id, loot }, "win");
  const casualOutcome = recordPlayerBattleOutcome(state, "win");
  return {
    type: "victory",
    loot,
    renown,
    elite,
    jackpot: Boolean(bandit.jackpot),
    contractPay,
    casualOutcome,
    progressionCheck: true
  };
}

function playerBattleLoser(state, bandit) {
  const goldAfterLoss = Math.floor(state.player.gold * CONFIG.PLAYER_GOLD_RETAINED_ON_LOSS);
  const lostGold = state.player.gold - goldAfterLoss;
  state.player.gold = goldAfterLoss;

  if (getTroopCount(bandit) > 0) {
    bandit.gold += lostGold;
    awardSurvivorXp(bandit);
    assignBanditMoveTarget(state, bandit);
  } else {
    removeBanditAndMaintainElite(state, bandit.id);
  }

  if (getTroopCount(state.player) <= 0) incrementTroop(state.player, "militia", 1);
  const refuge = nearestTown(state, state.player.pos);
  state.player.pos = copyPosition(refuge.pos);
  state.player.prevPos = copyPosition(refuge.pos);
  state.player.moveTarget = null;
  state.player.encounterCooldownUntil = state.tick + CONFIG.RESPAWN_GRACE_TICKS;
  addEvent(state, "log.defeat", { lostGold, townId: refuge.id }, "loss");
  const casualOutcome = recordPlayerBattleOutcome(state, "loss");
  return { type: "defeat", lostGold, townId: refuge.id, casualOutcome, progressionCheck: false };
}

function finishBattle(state, winner, bandit) {
  const battle = state.battle;
  if (!battle) return null;
  if (!battle.counted) {
    state.stats.battles += 1;
    incrementTelemetry(state, "battlesFought");
  }
  state.stats.kills += battle.banditCasualties;
  const result = winner === "player"
    ? playerBattleWinner(state, battle, bandit)
    : playerBattleLoser(state, bandit);
  result.balance = battle.balance || null;
  result.playerAttackMultiplier = battle.playerAttackMultiplier || 1;
  recordBattleOutcome(state, {
    tick: battle.startedAtTick ?? state.tick,
    outcome: result.type,
    banditId: bandit.id,
    townId: battle.nearTownId || nearestTown(state, state.player.pos)?.id || null,
    playerStart: battle.playerStart,
    enemyStart: battle.banditStart,
    elite: battle.elite ?? Boolean(bandit.elite || bandit.isElite)
  });
  state.battle = null;
  return result;
}

export function resolveBattleRound(state) {
  ensureLivingState(state);
  const battle = state.battle;
  if (!battle) return null;
  const bandit = state.bandits.find((entry) => entry.id === battle.banditId);
  if (!bandit) {
    state.battle = null;
    return null;
  }

  if (battle.round >= CONFIG.MAX_BATTLE_ROUNDS) {
    const winner = getPartyStrength(state.player) >= getPartyStrength(bandit) ? "player" : "bandit";
    return finishBattle(state, winner, bandit);
  }

  const playerAttack = getPartyStrength(state.player) * (battle.playerAttackMultiplier || 1);
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

  const winner = determineWinner(state.player, bandit, battle.playerStart, battle.banditStart);
  if (winner) return finishBattle(state, winner === "first" ? "player" : "bandit", bandit);
  battle.nextRoundTick = state.tick + CONFIG.BATTLE_ROUND_TICKS;
  return null;
}

export function startBattle(state, bandit) {
  ensureLivingState(state);
  if (state.battle) return null;
  if (areBanditBattlesBlocked(state)) {
    return { type: "blocked", reason: "escort", day: state.stats.days, banditId: bandit.id };
  }
  if (isStarterBattleProtected(state, bandit)) {
    return { type: "blocked", reason: "starterProtection", banditId: bandit.id };
  }
  const balance = prepareStarterBattle(state, bandit);
  const playerAttackMultiplier = consumePlayerAttackMultiplier(state);
  const playerStart = getTroopCount(state.player);
  const banditStart = getTroopCount(bandit);
  const elite = Boolean(bandit.elite || bandit.isElite);
  const nearTownId = nearestTown(state, state.player.pos)?.id || null;
  state.player.moveTarget = null;
  state.stats.battles += 1;
  incrementTelemetry(state, "battlesFought");
  if (state.demo && state.demo.firstBattleTick === null) state.demo.firstBattleTick = state.tick;
  state.battle = {
    banditId: bandit.id,
    playerStart,
    banditStart,
    startedAtTick: state.tick,
    nearTownId,
    elite,
    playerCasualties: 0,
    banditCasualties: 0,
    round: 0,
    nextRoundTick: state.tick + CONFIG.BATTLE_ROUND_TICKS,
    counted: true,
    balance,
    playerAttackMultiplier
  };
  recordBiggestBattle(state, {
    tick: state.tick,
    banditId: bandit.id,
    townId: nearTownId,
    playerStart,
    enemyStart: banditStart,
    elite
  });
  addEvent(state, "log.encounter", {
    playerCount: playerStart,
    banditCount: banditStart,
    elite
  }, "round");

  if (getTroopCount(state.player) <= 0) return finishBattle(state, "bandit", bandit);
  return null;
}

export function checkForEncounter(state) {
  if (
    state.battle ||
    areBanditBattlesBlocked(state) ||
    state.tick < state.player.encounterCooldownUntil
  ) return null;
  const candidates = state.bandits
    .map((bandit) => ({ bandit, separation: distance(state.player.pos, bandit.pos) }))
    .filter((entry) => (
      entry.separation <= CONFIG.ENCOUNTER_RADIUS &&
      !isStarterBattleProtected(state, entry.bandit)
    ))
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

export function attemptFlee(state) {
  if (state.paused) return { ok: false, reason: "paused" };
  if (!state.battle) return { ok: false, reason: "noBattle" };
  const battle = state.battle;
  const bandit = state.bandits.find((entry) => entry.id === battle.banditId) || null;
  const success = nextFloat(state.rng) < CONFIG.PLAYER_FLEE_SUCCESS_CHANCE;
  if (!success) {
    addEvent(state, "log.retreatFailed", { banditId: battle.banditId }, "loss");
    return { ok: true, success: false, type: "fleeFailed", banditId: battle.banditId };
  }

  if (bandit) {
    let dx = state.player.pos.x - bandit.pos.x;
    let dy = state.player.pos.y - bandit.pos.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) {
      dx = 1;
      dy = 0;
    } else {
      dx /= length;
      dy /= length;
    }
    const fleeDistance = CONFIG.ENCOUNTER_RADIUS * CONFIG.PLAYER_FLEE_DISTANCE_MULTIPLIER;
    state.player.pos = {
      x: clamp(state.player.pos.x + dx * fleeDistance, 0, CONFIG.WORLD_SIZE),
      y: clamp(state.player.pos.y + dy * fleeDistance, 0, CONFIG.WORLD_SIZE)
    };
    state.player.prevPos = copyPosition(state.player.pos);
    assignBanditMoveTarget(state, bandit);
  }
  state.player.moveTarget = null;
  state.player.encounterCooldownUntil = state.tick + CONFIG.RESPAWN_GRACE_TICKS;
  recordBattleOutcome(state, {
    tick: battle.startedAtTick ?? state.tick,
    outcome: "fled",
    banditId: battle.banditId,
    townId: battle.nearTownId || nearestTown(state, state.player.pos)?.id || null,
    playerStart: battle.playerStart,
    enemyStart: battle.banditStart,
    elite: battle.elite ?? Boolean(bandit?.elite || bandit?.isElite)
  });
  state.battle = null;
  incrementTelemetry(state, "battlesFled");
  addEvent(state, "log.retreatSuccess", { banditId: battle.banditId }, "win");
  return { ok: true, success: true, type: "fled", banditId: battle.banditId };
}

function terrainMultiplier(state, party) {
  if (!party.factionId) return CONFIG.FIELD_TERRAIN;
  const defending = state.towns.some((town) => (
    town.factionId === party.factionId && distance(town.pos, party.pos) <= CONFIG.TOWN_INTERACTION_RADIUS
  ));
  return defending ? CONFIG.TOWN_DEFENDER_TERRAIN : CONFIG.FIELD_TERRAIN;
}

function restoreMinimumSurvivor(party, kind) {
  if (getTroopCount(party) > 0) return;
  incrementTroop(party, kind === "bandit" ? "bandit" : "militia", CONFIG.LORD_MIN_RESPAWN_TROOPS);
}

function ownRefuge(state, lord) {
  const own = state.towns.filter((town) => town.factionId === lord.factionId);
  const candidates = own.length ? own : state.towns;
  return candidates.reduce((nearest, town) => {
    if (!nearest) return town;
    return distance(lord.pos, town.pos) < distance(lord.pos, nearest.pos) ? town : nearest;
  }, null);
}

function defeatAiParty(state, loser, loserKind, winner, winnerKind) {
  const stolen = Math.floor((loser.gold || 0) * CONFIG.LOOT_SHARE);
  loser.gold = Math.max(0, (loser.gold || 0) - stolen);
  winner.gold = Math.max(0, winner.gold || 0) + stolen;

  if (loserKind === "bandit") {
    removeBanditAndMaintainElite(state, loser.id);
  } else {
    restoreMinimumSurvivor(loser, "lord");
    const refuge = ownRefuge(state, loser);
    loser.pos = copyPosition(refuge.pos);
    loser.prevPos = copyPosition(refuge.pos);
    loser.moveTarget = null;
    loser.aiState = "recruit";
    loser.targetId = refuge.id;
    loser.targetKind = "town";
    loser.defeatedUntilTick = state.tick + CONFIG.LORD_DEFEAT_GRACE_TICKS;
    loser.defeatedUntil = loser.defeatedUntilTick;
  }
  restoreMinimumSurvivor(winner, winnerKind);
  awardSurvivorXp(winner);
  return stolen;
}

export function resolveAiBattle(state, first, second, options = {}) {
  ensureLivingState(state);
  const firstKind = options.firstKind || (first.factionId ? "lord" : "bandit");
  const secondKind = options.secondKind || (second.factionId ? "lord" : "bandit");
  const firstStart = getTroopCount(first);
  const secondStart = getTroopCount(second);
  let firstCasualties = 0;
  let secondCasualties = 0;
  let winner = null;

  for (let round = 0; round < CONFIG.MAX_BATTLE_ROUNDS && !winner; round += 1) {
    const firstMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
      CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
    );
    const secondMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
      CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
    );
    const lossToSecond = calculateCasualties(
      getPartyStrength(first),
      second,
      firstMultiplier,
      terrainMultiplier(state, first)
    );
    const lossToFirst = calculateCasualties(
      getPartyStrength(second),
      first,
      secondMultiplier,
      terrainMultiplier(state, second)
    );
    secondCasualties += applyCasualties(second, lossToSecond);
    firstCasualties += applyCasualties(first, lossToFirst);
    winner = determineWinner(first, second, firstStart, secondStart);
  }

  winner ||= getPartyStrength(first) >= getPartyStrength(second) ? "first" : "second";
  const winnerParty = winner === "first" ? first : second;
  const loserParty = winner === "first" ? second : first;
  const winnerKind = winner === "first" ? firstKind : secondKind;
  const loserKind = winner === "first" ? secondKind : firstKind;
  const stolen = defeatAiParty(state, loserParty, loserKind, winnerParty, winnerKind);
  state.mechanics.lordBattles += 1;
  addEvent(state, "log.lordBattle", {
    winnerId: winnerParty.id,
    loserId: loserParty.id,
    winnerKind,
    loserKind,
    firstCasualties,
    secondCasualties,
    stolen
  }, "world");
  return {
    winnerId: winnerParty.id,
    loserId: loserParty.id,
    winnerKind,
    loserKind,
    firstCasualties,
    secondCasualties,
    stolen
  };
}

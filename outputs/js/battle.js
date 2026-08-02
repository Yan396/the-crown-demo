import { CONFIG } from "./data.js";
import { STRINGS } from "./strings.js";
import {
  areBanditBattlesBlocked,
  consumePlayerAttackMultiplier,
  isStarterBattleProtected,
  prepareStarterBattle,
  recordPlayerBattleOutcome
} from "./casual.js";
import { createRng, nextFloat } from "./rng.js";
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
  isBattleScript,
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

const MAX_SCRIPT_TOKENS = 24;
const SCRIPT_TIMING = Object.freeze({
  volley: 260,
  firstRoundField: 420,
  firstRoundTown: 720,
  strikeLead: 220,
  beatGap: 210,
  beatJitter: 72,
  roundTail: 980,
  roundGap: 240,
  endTail: 360
});

function cloneRoster(party) {
  return (party?.troops || [])
    .filter((stack) => stack && Number.isFinite(stack.count) && stack.count > 0)
    .map((stack) => ({
      type: stack.type,
      count: Math.max(0, Math.floor(stack.count))
    }));
}

function rosterCount(roster) {
  return (roster || []).reduce((sum, stack) => sum + Math.max(0, Math.floor(stack.count || 0)), 0);
}

function reconstructRoster(party, startTroops, defaultType) {
  const target = Math.max(0, Math.floor(startTroops || 0));
  const roster = cloneRoster(party);
  const current = rosterCount(roster);
  if (current < target) {
    const type = roster[0]?.type || defaultType;
    const stack = roster.find((entry) => entry.type === type);
    if (stack) stack.count += target - current;
    else roster.unshift({ type, count: target - current });
  } else if (current > target) {
    let excess = current - target;
    for (let index = roster.length - 1; index >= 0 && excess > 0; index -= 1) {
      const removed = Math.min(roster[index].count, excess);
      roster[index].count -= removed;
      excess -= removed;
    }
  }
  return roster.filter((stack) => stack.count > 0);
}

function visualTerrain(state) {
  const town = nearestTown(state, state.player.pos);
  return town && distance(state.player.pos, town.pos) <= CONFIG.TOWN_INTERACTION_RADIUS
    ? "town"
    : "field";
}

function battleScriptId(state, bandit) {
  return `battle:${state.seed >>> 0}:${state.tick}:${state.stats.battles}:${bandit.id}`;
}

function presentationSeed(seed, battleId) {
  let hash = ((Number(seed) >>> 0) ^ 0x811c9dc5) >>> 0;
  const text = String(battleId);
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function randomIndex(rng, length) {
  return length > 1 ? Math.floor(nextFloat(rng) * length) : 0;
}

function shuffled(rng, entries) {
  const result = entries.slice();
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomIndex(rng, index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function troopTypeAt(roster, soldierIndex, fallback) {
  let cursor = Math.max(0, soldierIndex);
  for (const stack of roster) {
    if (cursor < stack.count) return stack.type;
    cursor -= stack.count;
  }
  return roster[roster.length - 1]?.type || fallback;
}

function buildTokenBuckets(roster, startTroops, fallbackType) {
  const total = Math.max(0, Math.floor(startTroops || 0));
  if (total <= 0) return { tokens: [], buckets: [] };
  const tokenWeight = Math.max(1, Math.ceil(total / MAX_SCRIPT_TOKENS));
  const tokenCount = Math.ceil(total / tokenWeight);
  const tokens = [];
  const buckets = [];
  for (let idx = 0; idx < tokenCount; idx += 1) {
    const offset = idx * tokenWeight;
    const capacity = Math.min(tokenWeight, total - offset);
    const troopType = troopTypeAt(roster, offset, fallbackType);
    tokens.push({ idx, troopType });
    buckets.push({ idx, capacity, remaining: capacity });
  }
  return { tokens, buckets };
}

function chooseWeightedBucket(rng, buckets, consume = false) {
  const available = buckets.filter((bucket) => bucket.remaining > 0);
  if (!available.length) return null;
  const total = available.reduce((sum, bucket) => sum + bucket.remaining, 0);
  let cursor = nextFloat(rng) * total;
  let selected = available[available.length - 1];
  for (const bucket of available) {
    cursor -= bucket.remaining;
    if (cursor < 0) {
      selected = bucket;
      break;
    }
  }
  if (consume) selected.remaining = Math.max(0, selected.remaining - 1);
  return selected;
}

function damageShares(totalDamage, count, rng) {
  if (count <= 0) return [];
  const total = Math.max(count, Math.round(Number(totalDamage) || count));
  const base = Math.floor(total / count);
  const remainder = total - base * count;
  const shares = Array.from({ length: count }, () => base);
  const order = shuffled(rng, Array.from({ length: count }, (_, index) => index));
  for (let index = 0; index < remainder; index += 1) shares[order[index]] += 1;
  return shares;
}

function ensureBattleCapture(state, battle, bandit) {
  battle.battleId ||= battleScriptId(state, bandit || { id: battle.banditId });
  battle.terrain = battle.terrain === "town" ? "town" : battle.terrain === "field"
    ? "field"
    : visualTerrain(state);
  battle.playerStartRoster = Array.isArray(battle.playerStartRoster)
    ? battle.playerStartRoster
    : reconstructRoster(state.player, battle.playerStart, "militia");
  battle.enemyStartRoster = Array.isArray(battle.enemyStartRoster)
    ? battle.enemyStartRoster
    : reconstructRoster(bandit, battle.banditStart, "bandit");
  battle.playerStartStrength = Math.max(
    0,
    Number(battle.playerStartStrength) || getPartyStrength({ troops: battle.playerStartRoster })
  );
  battle.enemyStartStrength = Math.max(
    0,
    Number(battle.enemyStartStrength) || getPartyStrength({ troops: battle.enemyStartRoster })
  );
  if (!Array.isArray(battle.rounds)) battle.rounds = [];
  if (
    battle.rounds.length === 0 &&
    battle.round > 0 &&
    ((battle.playerCasualties || 0) > 0 || (battle.banditCasualties || 0) > 0)
  ) {
    const playerRemaining = Math.max(0, battle.playerStart - battle.playerCasualties);
    const enemyRemaining = Math.max(0, battle.banditStart - battle.banditCasualties);
    battle.rounds.push({
      n: Math.max(1, battle.round),
      playerLoss: Math.max(0, battle.playerCasualties || 0),
      enemyLoss: Math.max(0, battle.banditCasualties || 0),
      playerDamage: Math.max(0, battle.banditCasualties || 0),
      enemyDamage: Math.max(0, battle.playerCasualties || 0),
      playerRemaining,
      enemyRemaining,
      playerStrengthRemaining: getPartyStrength(state.player),
      enemyStrengthRemaining: getPartyStrength(bandit || { troops: [] })
    });
  }
  return battle;
}

// The script contract keeps `label` a plain string, but the copy itself lives
// in strings.js like every other display string -- no module outside strings.js
// carries hardcoded copy.
function sideLabels(state) {
  const stage = (STRINGS[state.settings?.language] || STRINGS.zh).stage;
  return { player: stage.sidePlayer, enemy: stage.sideEnemy };
}

function buildStrikeDrafts(rng, round, playerBuckets, enemyBuckets) {
  const drafts = [];
  // Attacks are simultaneous in the production resolver. Keep round-start
  // attacker pools separate from the casualty buckets consumed below.
  const playerAttackBuckets = playerBuckets.map((bucket) => ({ ...bucket }));
  const enemyAttackBuckets = enemyBuckets.map((bucket) => ({ ...bucket }));
  const enemyDamage = damageShares(round.enemyDamage, round.playerLoss, rng);
  const playerDamage = damageShares(round.playerDamage, round.enemyLoss, rng);

  // One kill event is one resolved soldier casualty. When a side starts above
  // 24 troops, repeated target indices drain that token's inferred bucket;
  // presentation must not remove an aggregated token on its first hit.
  for (let index = 0; index < round.enemyLoss; index += 1) {
    const from = chooseWeightedBucket(rng, playerAttackBuckets, false);
    const to = chooseWeightedBucket(rng, enemyBuckets, true);
    if (!from || !to) break;
    drafts.push({
      from: { side: "player", idx: from.idx },
      to: { side: "enemy", idx: to.idx },
      kill: true,
      dmgShown: playerDamage[index]
    });
  }
  for (let index = 0; index < round.playerLoss; index += 1) {
    const from = chooseWeightedBucket(rng, enemyAttackBuckets, false);
    const to = chooseWeightedBucket(rng, playerBuckets, true);
    if (!from || !to) break;
    drafts.push({
      from: { side: "enemy", idx: from.idx },
      to: { side: "player", idx: to.idx },
      kill: true,
      dmgShown: enemyDamage[index]
    });
  }
  return shuffled(rng, drafts);
}

export function buildBattleScript(state, battle, result, winner) {
  const playerRoster = battle.playerStartRoster || reconstructRoster(
    state.player,
    battle.playerStart,
    "militia"
  );
  const enemyRoster = battle.enemyStartRoster || [{ type: "bandit", count: battle.banditStart }];
  const playerSide = buildTokenBuckets(playerRoster, battle.playerStart, "militia");
  const enemySide = buildTokenBuckets(enemyRoster, battle.banditStart, "bandit");
  const labels = sideLabels(state);
  const rng = createRng(presentationSeed(state.seed, battle.battleId));
  const events = [{ t: 0, type: "battle_start" }];

  if (battle.terrain === "town") {
    events.push({
      t: SCRIPT_TIMING.volley,
      type: "volley",
      // Contract literal: `defender` is an environmental cue, not a key in sides.
      side: "defender",
      arrows: 6 + Math.floor(nextFloat(rng) * 7)
    });
  }

  let roundTime = battle.terrain === "town"
    ? SCRIPT_TIMING.firstRoundTown
    : SCRIPT_TIMING.firstRoundField;
  let playerMorale = false;
  let enemyMorale = false;
  let playerRout = false;
  let enemyRout = false;
  const rounds = Array.isArray(battle.rounds) ? battle.rounds : [];

  rounds.forEach((round, roundIndex) => {
    const n = Math.max(1, Math.floor(round.n || roundIndex + 1));
    events.push({ t: roundTime, type: "round_start", n });
    const drafts = buildStrikeDrafts(rng, round, playerSide.buckets, enemySide.buckets);
    const waveCount = drafts.length >= 3 ? 3 : drafts.length >= 2 ? 2 : 1;
    drafts.forEach((draft, index) => {
      const beat = waveCount === 1 ? 0 : index % waveCount;
      events.push({
        t: roundTime + SCRIPT_TIMING.strikeLead + beat * SCRIPT_TIMING.beatGap
          + Math.floor(nextFloat(rng) * SCRIPT_TIMING.beatJitter),
        type: "strike",
        from: draft.from,
        to: draft.to,
        kill: draft.kill,
        dmgShown: draft.dmgShown,
        beat
      });
    });

    const statusTime = roundTime + SCRIPT_TIMING.roundTail;
    const playerStrengthRatio = battle.playerStartStrength > 0
      ? round.playerStrengthRemaining / battle.playerStartStrength
      : 0;
    const enemyStrengthRatio = battle.enemyStartStrength > 0
      ? round.enemyStrengthRemaining / battle.enemyStartStrength
      : 0;
    if (!playerMorale && playerStrengthRatio <= 0.5) {
      playerMorale = true;
      events.push({ t: statusTime, type: "morale", side: "player", level: "wavering" });
    }
    if (!enemyMorale && enemyStrengthRatio <= 0.5) {
      enemyMorale = true;
      events.push({ t: statusTime, type: "morale", side: "enemy", level: "wavering" });
    }
    if (
      !playerRout &&
      battle.playerStart > 0 &&
      round.playerRemaining < battle.playerStart * CONFIG.ROUT_THRESHOLD
    ) {
      playerRout = true;
      events.push({ t: statusTime + 40, type: "rout", side: "player" });
    }
    if (
      !enemyRout &&
      battle.banditStart > 0 &&
      round.enemyRemaining < battle.banditStart * CONFIG.ROUT_THRESHOLD
    ) {
      enemyRout = true;
      events.push({ t: statusTime + 40, type: "rout", side: "enemy" });
    }
    roundTime = statusTime + SCRIPT_TIMING.roundGap;
  });

  const survivors = {
    player: Math.max(0, battle.playerStart - battle.playerCasualties),
    enemy: Math.max(0, battle.banditStart - battle.banditCasualties)
  };
  const endTime = Math.max(
    roundTime + SCRIPT_TIMING.endTail,
    (events[events.length - 1]?.t || 0) + SCRIPT_TIMING.endTail
  );
  events.push({
    t: endTime,
    type: "battle_end",
    winner,
    loot: {
      gold: result?.type === "victory" ? Math.max(0, result.loot || 0) : 0,
      renown: result?.type === "victory" ? Math.max(0, result.renown || 0) : 0
    },
    survivors
  });
  events.sort((first, second) => first.t - second.t);

  return {
    battleId: battle.battleId,
    terrain: battle.terrain,
    sides: {
      player: { label: labels.player, tokens: playerSide.tokens, startTroops: battle.playerStart },
      enemy: { label: labels.enemy, tokens: enemySide.tokens, startTroops: battle.banditStart }
    },
    events
  };
}

export function validateBattleScript(script, expected = null) {
  const errors = [];
  if (!isBattleScript(script)) {
    return {
      ok: false,
      errors: [script ? "battleScript contract invalid" : "battleScript missing"],
      casualties: null,
      survivors: null
    };
  }
  const strikes = script.events.filter((event) => event.type === "strike" && event.kill === true);
  const casualties = {
    player: strikes.filter((event) => event.to?.side === "player").length,
    enemy: strikes.filter((event) => event.to?.side === "enemy").length
  };
  const endingEvents = script.events.filter((event) => event.type === "battle_end");
  const ending = endingEvents[endingEvents.length - 1] || null;
  const survivors = ending?.survivors || null;
  if (expected?.casualties) {
    if (casualties.player !== expected.casualties.player) errors.push("player casualties mismatch");
    if (casualties.enemy !== expected.casualties.enemy) errors.push("enemy casualties mismatch");
  }
  if (expected?.survivors) {
    if (survivors?.player !== expected.survivors.player) errors.push("player survivors mismatch");
    if (survivors?.enemy !== expected.survivors.enemy) errors.push("enemy survivors mismatch");
  }
  if (!ending) errors.push("battle_end missing");
  return { ok: errors.length === 0, errors, casualties, survivors };
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
  ensureBattleCapture(state, battle, bandit);
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
  const resolved = {
    casualties: {
      player: Math.max(0, battle.playerCasualties || 0),
      enemy: Math.max(0, battle.banditCasualties || 0)
    },
    survivors: {
      player: Math.max(0, battle.playerStart - battle.playerCasualties),
      enemy: Math.max(0, battle.banditStart - battle.banditCasualties)
    }
  };
  const battleScript = buildBattleScript(
    state,
    battle,
    result,
    winner === "player" ? "player" : "enemy"
  );
  state.battleScript = battleScript;
  state.battlePlayback ||= { speed: 1, skip: false };
  state.battlePlayback.skip = false;
  result.battleScript = battleScript;
  result.resolvedCasualties = resolved.casualties;
  result.resolvedSurvivors = resolved.survivors;
  result.battleScriptCheck = validateBattleScript(battleScript, resolved);
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
  ensureBattleCapture(state, battle, bandit);

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
  const playerDamage = playerAttack * playerMultiplier * CONFIG.FIELD_TERRAIN;
  const enemyDamage = banditAttack * banditMultiplier * CONFIG.FIELD_TERRAIN;
  const banditLoss = calculateCasualties(playerAttack, bandit, playerMultiplier);
  const playerLoss = calculateCasualties(banditAttack, state.player, banditMultiplier);

  const actualBanditLoss = applyCasualties(bandit, banditLoss);
  const actualPlayerLoss = applyCasualties(state.player, playerLoss);
  battle.round += 1;
  battle.playerCasualties += actualPlayerLoss;
  battle.banditCasualties += actualBanditLoss;
  battle.rounds.push({
    n: battle.round,
    playerLoss: actualPlayerLoss,
    enemyLoss: actualBanditLoss,
    playerDamage,
    enemyDamage,
    playerRemaining: getTroopCount(state.player),
    enemyRemaining: getTroopCount(bandit),
    playerStrengthRemaining: getPartyStrength(state.player),
    enemyStrengthRemaining: getPartyStrength(bandit)
  });
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
  const terrain = visualTerrain(state);
  state.player.moveTarget = null;
  state.stats.battles += 1;
  incrementTelemetry(state, "battlesFought");
  if (state.demo && state.demo.firstBattleTick === null) state.demo.firstBattleTick = state.tick;
  state.battle = {
    banditId: bandit.id,
    battleId: battleScriptId(state, bandit),
    terrain,
    playerStart,
    banditStart,
    playerStartRoster: cloneRoster(state.player),
    enemyStartRoster: cloneRoster(bandit),
    playerStartStrength: getPartyStrength(state.player),
    enemyStartStrength: getPartyStrength(bandit),
    startedAtTick: state.tick,
    nearTownId,
    elite,
    playerCasualties: 0,
    banditCasualties: 0,
    rounds: [],
    round: 0,
    nextRoundTick: state.tick + CONFIG.BATTLE_ROUND_TICKS,
    counted: true,
    balance,
    playerAttackMultiplier
  };
  state.battleScript = null;
  state.battlePlayback ||= { speed: 1, skip: false };
  state.battlePlayback.speed = state.battlePlayback.speed === 2 ? 2 : 1;
  state.battlePlayback.skip = false;
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
  // The production resolver's max-round winner check happens on the call
  // after the final damage round. Skipping is a one-shot request for instant
  // completion, so allow that zero-RNG terminal check without changing any
  // round, casualty, or winner formula.
  if (state.battle && state.battle.round >= CONFIG.MAX_BATTLE_ROUNDS) {
    result = resolveBattleRound(state) || result;
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
  incrementTelemetry(state, "battlesFled");
  addEvent(state, "log.retreatSuccess", { banditId: battle.banditId }, "win");
  ensureBattleCapture(state, battle, bandit);
  const result = { ok: true, success: true, type: "fled", banditId: battle.banditId };
  const resolved = {
    casualties: {
      player: Math.max(0, battle.playerCasualties || 0),
      enemy: Math.max(0, battle.banditCasualties || 0)
    },
    survivors: {
      player: Math.max(0, battle.playerStart - battle.playerCasualties),
      enemy: Math.max(0, battle.banditStart - battle.banditCasualties)
    }
  };
  const battleScript = buildBattleScript(state, battle, result, "enemy");
  state.battleScript = battleScript;
  state.battlePlayback ||= { speed: 1, skip: false };
  state.battlePlayback.skip = false;
  result.battleScript = battleScript;
  result.resolvedCasualties = resolved.casualties;
  result.resolvedSurvivors = resolved.survivors;
  result.battleScriptCheck = validateBattleScript(battleScript, resolved);
  state.battle = null;
  return result;
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

import { ARM_IDS, CONFIG, CONFIG_V11, FORMATION_IDS, TROOP_TYPES } from "./data.js";
import { STRINGS } from "./strings.js";
import {
  areBanditBattlesBlocked,
  consumePlayerAttackMultiplier,
  isStarterBattleProtected,
  prepareStarterBattle,
  recordPlayerBattleOutcome
} from "./casual.js";
import { createRng, nextFloat, randomInt } from "./rng.js";
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
  applyHpDamage,
  assignBanditMoveTarget,
  averageHpPerSoldier,
  awardSurvivorXp,
  changePlayerRenown,
  clamp,
  copyPosition,
  distance,
  ensurePartyHp,
  getAverageDefense,
  getArmShares,
  getLieutenants,
  getLord,
  getPartyStrength,
  getTroopCount,
  hasLieutenant,
  incrementTroop,
  isBattleScript,
  hpPerSoldierFor,
  isV11State,
  nearestTown,
  partyHp,
  syncLieutenantAlias
} from "./state.js";

const FORMATION_BEATS = Object.freeze({
  wedge: "line",
  line: "circle",
  circle: "wedge"
});

export function counterFormation(formation) {
  return FORMATION_IDS.find((candidate) => FORMATION_BEATS[candidate] === formation) || "line";
}

function weightedFormation(rng, weights) {
  let cursor = nextFloat(rng) * weights.reduce((sum, weight) => sum + weight, 0);
  for (let index = 0; index < FORMATION_IDS.length; index += 1) {
    cursor -= weights[index];
    if (cursor < 0) return FORMATION_IDS[index];
  }
  return FORMATION_IDS[FORMATION_IDS.length - 1];
}

function enemyFormation(state, rng, enemyKind, enemy) {
  if (state.features?.f3) {
    const shares = getArmShares(enemy);
    const highest = ARM_IDS.slice().sort((first, second) => (
      shares[second] - shares[first] || first.localeCompare(second)
    ))[0];
    return highest === "cavalry" ? "wedge" : highest === "archer" ? "line" : "circle";
  }
  if (enemyKind !== "lord") {
    return FORMATION_IDS[randomInt(rng, 0, FORMATION_IDS.length)];
  }
  const personality = Number(enemy?.personality) || 0.5;
  const profile = personality <= CONFIG.V11_LORD_FORMATION_CAUTIOUS_MAX
    ? "cautious"
    : personality >= CONFIG.V11_LORD_FORMATION_BOLD_MIN
      ? "bold"
      : "balanced";
  return weightedFormation(rng, CONFIG.V11_LORD_FORMATION_WEIGHTS[profile]);
}

function prepareFormations(state, enemyKind, enemy, playerStart, enemyStart, battleId) {
  if (!isV11State(state)) return null;
  // Formation/scout generation is deterministic but intentionally isolated
  // from state.rng: adding the v1.1 decision must not reshuffle bandit spawns,
  // loot, diplomacy, or the combat rolls that follow it.
  const rng = createRng(presentationSeed(state.seed, `${battleId}:formation`));
  const actualEnemy = enemyFormation(state, rng, enemyKind, enemy);
  const eligible = (
    playerStart >= CONFIG.V11_FORMATION_MIN_SIDE_TROOPS &&
    enemyStart >= CONFIG.V11_FORMATION_MIN_SIDE_TROOPS
  );
  if (!eligible) {
    return {
      player: "line",
      enemy: actualEnemy,
      reportedEnemy: actualEnemy,
      scoutAccurate: true,
      eligible: false,
      resolved: true,
      resumePaused: false
    };
  }
  const scoutAccurate = nextFloat(rng) < CONFIG.V11_FORMATION_SCOUT_ACCURACY;
  const alternatives = FORMATION_IDS.filter((formation) => formation !== actualEnemy);
  const reportedEnemy = scoutAccurate
    ? actualEnemy
    : alternatives[randomInt(rng, 0, alternatives.length)];
  return {
    player: null,
    enemy: actualEnemy,
    reportedEnemy,
    scoutAccurate,
    eligible: true,
    resolved: false,
    resumePaused: false
  };
}

function formationModifiers(formations) {
  const neutral = {
    player: { attack: 1, defense: 1 },
    enemy: { attack: 1, defense: 1 },
    winner: null
  };
  if (!formations?.player || !formations?.enemy || formations.player === formations.enemy) return neutral;
  const playerWins = FORMATION_BEATS[formations.player] === formations.enemy;
  const winner = playerWins ? "player" : "enemy";
  const loser = playerWins ? "enemy" : "player";
  neutral[winner] = {
    attack: CONFIG.V11_FORMATION_ATTACK_ADVANTAGE,
    defense: CONFIG.V11_FORMATION_DEFENSE_ADVANTAGE
  };
  neutral[loser] = {
    attack: CONFIG.V11_FORMATION_ATTACK_DISADVANTAGE,
    defense: CONFIG.V11_FORMATION_DEFENSE_DISADVANTAGE
  };
  neutral.winner = winner;
  return neutral;
}

export function armMatchupModifier(attacker, defender) {
  const attackShares = getArmShares(attacker);
  const defenseShares = getArmShares(defender);
  let delta = 0;
  ARM_IDS.forEach((attackArm) => {
    ARM_IDS.forEach((defenseArm) => {
      delta += attackShares[attackArm] * defenseShares[defenseArm]
        * (CONFIG.F3_ARM_MATRIX[attackArm]?.[defenseArm] || 0);
    });
  });
  return Math.max(0.5, 1 + delta);
}

function applyF3BattleModifiers(state, battle, enemy, base) {
  if (!state.features?.f3) return base;
  const result = {
    player: { ...base.player },
    enemy: { ...base.enemy },
    winner: base.winner
  };
  const playerShares = getArmShares(state.player);
  const enemyShares = getArmShares(enemy);
  result.player.attack *= armMatchupModifier(state.player, enemy);
  result.enemy.attack *= armMatchupModifier(enemy, state.player);
  const synergy = CONFIG.F3_FORMATION_SYNERGY;
  const applies = (formation, shares, terrain) => (
    (formation === "wedge" && shares.cavalry > Math.max(shares.spear, shares.archer)) ||
    (formation === "line" && terrain === "field" && shares.archer >= CONFIG.F3_ARCHER_VOLLEY_SHARE) ||
    (formation === "circle" && shares.spear > Math.max(shares.archer, shares.cavalry))
  );
  if (applies(battle.formations?.player, playerShares, battle.terrain)) result.player.attack *= 1 + synergy;
  if (applies(battle.formations?.enemy, enemyShares, battle.terrain)) result.enemy.attack *= 1 + synergy;
  const command = CONFIG.F3_COMMANDS[battle.commands?.player];
  if (command) {
    result.player.attack *= command.attack;
    result.player.defense *= command.defense;
  }
  return result;
}

export function choosePlayerFormation(state, formation) {
  const battle = state?.battle;
  if (!isV11State(state)) return { ok: false, reason: "variant" };
  if (!battle?.formations?.eligible || battle.formations.resolved) {
    return { ok: false, reason: "unavailable" };
  }
  if (!FORMATION_IDS.includes(formation)) return { ok: false, reason: "formation" };
  battle.formations.player = formation;
  battle.formations.resolved = true;
  battle.formationModifiers = formationModifiers(battle.formations);
  if (state.demo?.modal === "formation") {
    if (state.features?.f3 && !battle.commands?.resolved) {
      state.demo.modal = "battleCommand";
      state.demo.pauseReason = "battleCommand";
    } else {
      state.demo.modal = null;
      state.demo.pauseReason = null;
      state.paused = Boolean(battle.formations.resumePaused);
    }
  }
  addEvent(state, "log.formationChosen", {
    playerFormation: formation,
    enemyFormation: battle.formations.enemy,
    advantage: battle.formationModifiers.winner || "none"
  }, "round");
  return {
    ok: true,
    formation,
    enemyFormation: battle.formations.enemy,
    reportedEnemy: battle.formations.reportedEnemy,
    advantage: battle.formationModifiers.winner
  };
}

export function chooseBattleCommand(state, command) {
  const battle = state?.battle;
  if (!state.features?.f3) return { ok: false, reason: "variant" };
  if (!battle?.commands || battle.commands.resolved) return { ok: false, reason: "unavailable" };
  if (!Object.hasOwn(CONFIG.F3_COMMANDS, command)) return { ok: false, reason: "command" };
  battle.commands.player = command;
  battle.commands.resolved = true;
  const enemy = getBattleEnemy(state, battle);
  battle.formationModifiers = applyF3BattleModifiers(
    state,
    battle,
    enemy || { troops: [] },
    formationModifiers(battle.formations)
  );
  state.demo.modal = null;
  state.demo.pauseReason = null;
  state.paused = Boolean(battle.commands.resumePaused);
  addEvent(state, "log.battleCommand", { command }, "round");
  return { ok: true, command };
}

export function lieutenantResistance(state) {
  if (!isV11State(state)) return 1;
  let resistance = hasLieutenant(state, "chen_mang")
    ? (1 + CONFIG_V11.LIEUTENANT_HP_BONUS) * (1 + CONFIG_V11.LIEUTENANT_DEFENSE_BONUS)
    : 1;
  if (state.features?.f4 && hasLieutenant(state, "shen_wen")) {
    resistance *= 1 + CONFIG.F4_SHEN_DEFENSE_BONUS;
  }
  return resistance;
}

/*
 * The unfloored casualty figure -- exactly the value calculateCasualties
 * rounds down. v1.1 converts it into hitpoints instead of bodies, which is
 * what lets a hit be non-lethal.
 */
function casualtyPotential(attackStrength, defender, multiplier, terrain = CONFIG.FIELD_TERRAIN) {
  const defenders = getTroopCount(defender);
  if (attackStrength <= 0 || defenders <= 0) return 0;
  return (attackStrength * multiplier * terrain) / getAverageDefense(defender);
}

/**
 * One v1.1 round, in hitpoints.
 *
 * Damage is converted at HP_DAMAGE_PER_CASUALTY soldiers' worth per resolved
 * casualty, so v1.1 kills at roughly the v1.0 rate while allowing the damage
 * in between to be visible. 陈莽 stands in front of the player's pool and
 * soaks first, which is what makes his bar the one worth watching.
 */
function resolveHpRound(state, bandit, ctx) {
  ensurePartyHp(state.player);
  ensurePartyHp(bandit);
  const battle = state.battle;

  const toEnemy = casualtyPotential(
    ctx.playerAttack, bandit, ctx.playerMultiplier / ctx.formation.enemy.defense
  ) * averageHpPerSoldier(bandit) * CONFIG_V11.HP_DAMAGE_PER_CASUALTY;
  const toPlayer = casualtyPotential(
    ctx.banditAttack, state.player,
    ctx.banditMultiplier / (ctx.formation.player.defense * ctx.playerResistance)
  ) * averageHpPerSoldier(state.player) * CONFIG_V11.HP_DAMAGE_PER_CASUALTY;

  const enemyWaves = damageWaves(toEnemy);
  const playerWaves = damageWaves(toPlayer);
  let enemyDeaths = 0;
  let playerDeaths = 0;
  let enemyDamageApplied = 0;
  let playerDamageApplied = 0;
  let lieutenantAbsorbed = 0;
  const forced = { player: false, enemy: false };
  let outcome = null;

  for (let index = 0; index < BATTLE_STRIKE_WAVES; index += 1) {
    let playerBound = playerWaves[index];
    let absorbedThisWave = 0;
    if (Number.isFinite(battle.lieutenantHp) && battle.lieutenantHp > 0) {
      absorbedThisWave = Math.min(battle.lieutenantHp, playerBound);
      battle.lieutenantHp -= absorbedThisWave;
      playerBound -= absorbedThisWave;
      lieutenantAbsorbed += absorbedThisWave;
    }

    const enemyHit = applyRoutClampedHpDamage(bandit, enemyWaves[index]);
    const playerHit = applyRoutClampedHpDamage(state.player, playerBound);
    enemyDeaths += enemyHit.deaths;
    playerDeaths += playerHit.deaths;
    enemyDamageApplied += enemyHit.damage;
    playerDamageApplied += absorbedThisWave + playerHit.damage;
    forced.enemy ||= enemyHit.forcedRout;
    forced.player ||= playerHit.forcedRout;
    outcome = roundOutcome(state, bandit, battle, forced);
    if (outcome) break;
  }

  return {
    enemyDeaths,
    playerDeaths,
    enemyHpDealt: enemyDamageApplied,
    playerHpDealt: playerDamageApplied,
    lieutenantAbsorbed,
    lieutenantHp: Number.isFinite(battle.lieutenantHp) ? battle.lieutenantHp : null,
    playerHpRemaining: partyHp(state.player),
    enemyHpRemaining: partyHp(bandit),
    forced,
    outcome
  };
}

function calculateCasualties(attackStrength, defender, multiplier, terrain = CONFIG.FIELD_TERRAIN) {
  const defenders = getTroopCount(defender);
  if (attackStrength <= 0 || defenders <= 0) return 0;
  const damage = attackStrength * multiplier * terrain;
  return Math.min(defenders, Math.max(1, Math.floor(damage / getAverageDefense(defender))));
}

function routed(remaining, starting) {
  return starting > 0 && remaining < starting * CONFIG.ROUT_THRESHOLD;
}

function determineWinner(first, second, firstStart, secondStart, options = {}) {
  const firstRemaining = getTroopCount(first);
  const secondRemaining = getTroopCount(second);
  if (firstRemaining <= 0 && secondRemaining <= 0) {
    return options.allowDraw ? "draw" : "first";
  }
  if (firstRemaining <= 0) return "second";
  if (secondRemaining <= 0) return "first";

  const firstRouted = Boolean(options.firstForcedRout) || routed(firstRemaining, firstStart);
  const secondRouted = Boolean(options.secondForcedRout) || routed(secondRemaining, secondStart);
  if (firstRouted && !secondRouted) return "second";
  if (secondRouted && !firstRouted) return "first";
  if (firstRouted && secondRouted) {
    const firstStartStrength = Math.max(1, Number(options.firstStartStrength) || firstStart);
    const secondStartStrength = Math.max(1, Number(options.secondStartStrength) || secondStart);
    const firstRatio = getPartyStrength(first) / firstStartStrength;
    const secondRatio = getPartyStrength(second) / secondStartStrength;
    if (Math.abs(firstRatio - secondRatio) > Number.EPSILON) {
      return firstRatio > secondRatio ? "first" : "second";
    }
    if (options.allowDraw) return "draw";
    return getPartyStrength(first) >= getPartyStrength(second) ? "first" : "second";
  }
  return null;
}

const BATTLE_STRIKE_WAVES = 3;

function integerWaves(total) {
  const normalized = Math.max(0, Math.floor(Number(total) || 0));
  return Array.from({ length: BATTLE_STRIKE_WAVES }, (_, index) => (
    Math.floor(normalized / BATTLE_STRIKE_WAVES)
      + (index < normalized % BATTLE_STRIKE_WAVES ? 1 : 0)
  ));
}

function damageWaves(total) {
  const normalized = Math.max(0, Number(total) || 0);
  const share = normalized / BATTLE_STRIKE_WAVES;
  return [share, share, normalized - share * 2];
}

function applyRoutClampedCasualties(party, requested) {
  const available = getTroopCount(party);
  const wanted = Math.max(0, Math.floor(Number(requested) || 0));
  if (available <= 0 || wanted <= 0) {
    return { deaths: 0, forcedRout: available <= 0 && wanted > 0 };
  }
  const forcedRout = wanted >= available;
  const deaths = applyCasualties(party, Math.min(wanted, Math.max(0, available - 1)));
  return { deaths, forcedRout };
}

function applyRoutClampedHpDamage(party, requested) {
  const available = getTroopCount(party);
  const hp = partyHp(party);
  const wanted = Math.max(0, Number(requested) || 0);
  if (available <= 0 || wanted <= 0) {
    return { deaths: 0, damage: 0, forcedRout: available <= 0 && wanted > 0 };
  }
  const forcedRout = wanted >= hp;
  // A routed last soldier keeps a fractional positive pool. This is the clamp
  // that prevents a strike wave from erasing a side before rout is checked.
  const damage = Math.min(wanted, Math.max(0, hp - 0.5));
  return { deaths: applyHpDamage(party, damage), damage, forcedRout };
}

function roundOutcome(state, bandit, battle, forced = {}) {
  return determineWinner(
    state.player,
    bandit,
    battle.playerStart,
    battle.banditStart,
    {
      allowDraw: true,
      firstForcedRout: forced.player,
      secondForcedRout: forced.enemy,
      firstStartStrength: battle.playerStartStrength,
      secondStartStrength: battle.enemyStartStrength
    }
  );
}

function resolveCasualtyWaves(state, bandit, battle, playerLoss, enemyLoss) {
  const playerWaves = integerWaves(playerLoss);
  const enemyWaves = integerWaves(enemyLoss);
  let playerDeaths = 0;
  let enemyDeaths = 0;
  const forced = { player: false, enemy: false };
  let outcome = null;

  for (let index = 0; index < BATTLE_STRIKE_WAVES; index += 1) {
    const enemyHit = applyRoutClampedCasualties(bandit, enemyWaves[index]);
    const playerHit = applyRoutClampedCasualties(state.player, playerWaves[index]);
    enemyDeaths += enemyHit.deaths;
    playerDeaths += playerHit.deaths;
    forced.enemy ||= enemyHit.forcedRout;
    forced.player ||= playerHit.forcedRout;
    outcome = roundOutcome(state, bandit, battle, forced);
    if (outcome) break;
  }

  return { playerDeaths, enemyDeaths, forced, outcome };
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
      count: Math.max(0, Math.floor(stack.count)),
      ...(ARM_IDS.includes(stack.arm) ? { arm: stack.arm } : {})
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

export function getBattleEnemy(state, battle = state.battle) {
  if (!battle) return null;
  return battle.enemyKind === "lord"
    ? getLord(state, battle.banditId)
    : state.bandits.find((entry) => entry.id === battle.banditId) || null;
}

function prepareRiskyContractBattle(state, bandit) {
  const contract = state.player.contract;
  if (
    !contract?.active ||
    contract.type !== "risky" ||
    bandit.elite ||
    bandit.isElite
  ) return null;
  const multiplier = Number(contract.enemyStrengthMultiplier)
    || CONFIG.CONTRACT_RISKY_ENEMY_STRENGTH_MULTIPLIER;
  const playerStrength = Math.max(TROOP_TYPES.militia.atk, getPartyStrength(state.player));
  const oldCount = Math.max(1, getTroopCount(bandit));
  const newCount = Math.max(1, Math.round(
    playerStrength * multiplier / TROOP_TYPES.bandit.atk
  ));
  const stack = bandit.troops.find((entry) => entry.type === "bandit");
  if (stack) stack.count = newCount;
  else bandit.troops = [{ type: "bandit", count: newCount, xp: 0 }];
  const oldLoot = Number.isFinite(bandit.lootValue)
    ? bandit.lootValue
    : Math.floor((bandit.gold || 0) * CONFIG.LOOT_SHARE);
  bandit.lootValue = Math.max(1, Math.round(oldLoot * newCount / oldCount));
  bandit.gold = Math.ceil(bandit.lootValue / CONFIG.LOOT_SHARE);
  contract.engaged = true;
  return {
    type: "contractRisk",
    applied: true,
    targetRatio: multiplier,
    actualRatio: getPartyStrength(bandit) / playerStrength,
    troopCount: newCount
  };
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

function troopArmAt(roster, soldierIndex) {
  let cursor = Math.max(0, soldierIndex);
  for (const stack of roster) {
    if (cursor < stack.count) return ARM_IDS.includes(stack.arm) ? stack.arm : "spear";
    cursor -= stack.count;
  }
  return ARM_IDS.includes(roster[roster.length - 1]?.arm)
    ? roster[roster.length - 1].arm
    : "spear";
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
    tokens.push({ idx, troopType, ...(roster.some((stack) => ARM_IDS.includes(stack.arm))
      ? { arm: troopArmAt(roster, offset) }
      : {}) });
    buckets.push({
      idx,
      capacity,
      remaining: capacity,
      hpPerSoldier: hpPerSoldierFor(troopType)
    });
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
function sideLabels(state, battle = null) {
  const stage = (STRINGS[state.settings?.language] || STRINGS.zh).stage;
  return {
    player: stage.sidePlayer,
    enemy: battle?.enemyKind === "lord" ? stage.sideLord : stage.sideEnemy
  };
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

/*
 * v1.1 strike shaping.
 *
 * The kill drafts are left exactly as v1.0 built them -- one per resolved
 * casualty -- so the script still carries precisely the casualties the sim
 * decided and validateBattleScript still balances. What v1.1 adds is the
 * glancing blows in between, plus `hpAfter` on every strike so the stage can
 * bind a bar to real numbers instead of estimating.
 *
 * Bucket hitpoints are walked in FINAL emission order, so hpAfter is
 * monotonic as played.
 */
function addGlancingBlows(rng, round, playerBuckets, enemyBuckets, drafts) {
  const sides = [
    { from: "player", to: "enemy", buckets: enemyBuckets, attackers: playerBuckets,
      hpDealt: round.enemyHpDealt || 0 },
    { from: "enemy", to: "player", buckets: playerBuckets, attackers: enemyBuckets,
      hpDealt: round.playerHpDealt || 0 }
  ];
  sides.forEach((side) => {
    const live = side.buckets.filter((bucket) => bucket.hpPerSoldier > 0);
    if (!live.length || side.hpDealt <= 0) return;
    const perSoldier = live[0].hpPerSoldier;
    const blowSize = Math.max(1, perSoldier * CONFIG_V11.HP_GLANCING_BLOW_FRACTION);
    const blows = Math.max(1, Math.round(side.hpDealt / blowSize));
    for (let index = 0; index < blows; index += 1) {
      const from = chooseWeightedBucket(rng, side.attackers, false);
      const to = live[randomInt(rng, 0, live.length)];
      if (!from || !to) break;
      drafts.push({
        from: { side: side.from, idx: from.idx },
        to: { side: side.to, idx: to.idx },
        kill: false,
        dmgShown: Math.max(1, Math.round(blowSize))
      });
    }
  });
  return drafts;
}

// Walk the emitted order and stamp each strike with the target's remaining
// hitpoints. A kill drops the target one soldier; a glancing blow may not.
function stampHpAfter(drafts, playerBuckets, enemyBuckets) {
  const pools = { player: new Map(), enemy: new Map() };
  [["player", playerBuckets], ["enemy", enemyBuckets]].forEach(([side, buckets]) => {
    buckets.forEach((bucket) => {
      pools[side].set(bucket.idx, {
        hp: bucket.capacity * bucket.hpPerSoldier,
        per: bucket.hpPerSoldier
      });
    });
  });
  drafts.forEach((draft) => {
    const pool = pools[draft.to.side]?.get(draft.to.idx);
    if (!pool) { draft.hpAfter = 0; return; }
    const alive = Math.max(0, Math.ceil(pool.hp / pool.per));
    if (draft.kill) {
      pool.hp = Math.max(0, (alive - 1) * pool.per);
    } else {
      // Never let a glancing blow cross a head threshold.
      const floorHp = Math.max(0, (alive - 1) * pool.per);
      pool.hp = Math.max(floorHp + (alive > 0 ? 0.5 : 0), pool.hp - draft.dmgShown);
    }
    draft.hpAfter = Math.max(0, Math.round(pool.hp));
  });
  return drafts;
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
  const labels = sideLabels(state, battle);
  const rng = createRng(presentationSeed(state.seed, battle.battleId));
  const events = [{ t: 0, type: "battle_start" }];

  if (state.features?.f3 && battle.commands?.player) {
    events.push({ t: 80, type: "command", side: "player", command: battle.commands.player });
  }

  if (
    state.features?.f3 &&
    battle.terrain === "field" &&
    getArmShares({ troops: playerRoster }).archer >= CONFIG.F3_ARCHER_VOLLEY_SHARE
  ) {
    const archerTokens = playerSide.tokens.filter((token) => token.arm === "archer").length;
    events.push({
      t: SCRIPT_TIMING.volley,
      type: "archer_volley",
      side: "player",
      arrows: Math.max(1, archerTokens * CONFIG.F3_ARCHER_VOLLEY_ARROWS_PER_TOKEN)
    });
  }

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
  // Rout-clamped resolution may stop a side at one survivor even when the raw
  // HP round recorded enough damage for one additional death. Presentation
  // must follow the resolved survivor ledger, so cap per-round kill drafts to
  // the exact casualty totals without changing any battle data or outcome.
  const casualtyBudget = result?.resolvedCasualties || {
    player: Math.max(0, battle.playerCasualties || 0),
    enemy: Math.max(0, battle.banditCasualties || 0)
  };
  const scriptedCasualties = { player: 0, enemy: 0 };

  rounds.forEach((round, roundIndex) => {
    const n = Math.max(1, Math.floor(round.n || roundIndex + 1));
    events.push({ t: roundTime, type: "round_start", n });
    const scriptedRound = {
      ...round,
      playerLoss: Math.min(
        Math.max(0, Number(round.playerLoss) || 0),
        Math.max(0, casualtyBudget.player - scriptedCasualties.player)
      ),
      enemyLoss: Math.min(
        Math.max(0, Number(round.enemyLoss) || 0),
        Math.max(0, casualtyBudget.enemy - scriptedCasualties.enemy)
      )
    };
    scriptedCasualties.player += scriptedRound.playerLoss;
    scriptedCasualties.enemy += scriptedRound.enemyLoss;
    let drafts = buildStrikeDrafts(rng, scriptedRound, playerSide.buckets, enemySide.buckets);
    if (isV11State(state)) {
      drafts = shuffled(rng, addGlancingBlows(
        rng, scriptedRound, playerSide.buckets, enemySide.buckets, drafts
      ));
    }
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
        ...(draft.hpAfter === undefined ? {} : { hpAfter: draft.hpAfter }),
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
      (
        round.playerRouted ||
        round.playerRemaining < battle.playerStart * CONFIG.ROUT_THRESHOLD
      )
    ) {
      playerRout = true;
      events.push({ t: statusTime + 40, type: "rout", side: "player" });
    }
    if (
      !enemyRout &&
      battle.banditStart > 0 &&
      (
        round.enemyRouted ||
        round.enemyRemaining < battle.banditStart * CONFIG.ROUT_THRESHOLD
      )
    ) {
      enemyRout = true;
      events.push({ t: statusTime + 40, type: "rout", side: "enemy" });
    }
    roundTime = statusTime + SCRIPT_TIMING.roundGap;
  });

  const survivors = result?.resolvedSurvivors || {
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
      renown: ["victory", "draw"].includes(result?.type) ? Math.max(0, result.renown || 0) : 0
    },
    survivors
  });
  events.sort((first, second) => first.t - second.t);
  if (isV11State(state)) {
    stampHpAfter(
      events.filter((event) => event.type === "strike"),
      playerSide.buckets,
      enemySide.buckets
    );
  }

  const script = {
    battleId: battle.battleId,
    terrain: battle.terrain,
    sides: {
      player: { label: labels.player, tokens: playerSide.tokens, startTroops: battle.playerStart },
      enemy: { label: labels.enemy, tokens: enemySide.tokens, startTroops: battle.banditStart }
    },
    events
  };
  if (isV11State(state)) {
    script.formations = {
      player: battle.formations?.player || "line",
      enemy: battle.formations?.enemy || "line"
    };
    // Presentation marker only, and a top-level key like `formations` rather
    // than a side field: a side's shape is fixed by the contract. It names the
    // side he rides with; he is not a troop and holds no token capacity, so
    // survivor accounting is untouched.
    const officers = getLieutenants(state);
    if (officers.length) {
      script.lieutenant = "player";
      // Names, for drawing only. Nothing downstream of this reads them.
      script.lieutenantIds = officers
        .map((entry) => (typeof entry === "string" ? entry : entry?.id))
        .filter((id) => typeof id === "string" && id.length);
    }
  }
  if (state.features?.f3) script.command = battle.commands?.player || CONFIG.F3_AUTOPLAY_COMMAND;
  return script;
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

function playerContractPayment(state, battle, enemy) {
  const contract = state.player.contract;
  if (!contract || contract.active === false || state.player.act < 2) return 0;
  const enemyKind = battle.enemyKind || "bandit";
  if (contract.type === "risky" && (enemyKind !== "bandit" || battle.contractType !== "risky")) {
    return 0;
  }
  if (
    contract.type === "war" &&
    (enemyKind !== "lord" || enemy.factionId !== contract.targetFactionId)
  ) return 0;
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
  if (contract.type === "war") {
    const renown = Math.max(0, Number(contract.renownReward) || CONFIG.CONTRACT_WAR_RENOWN);
    const appliedRenown = changePlayerRenown(state, renown);
    contract.renownEarned = (contract.renownEarned || 0) + appliedRenown;
    contract.active = false;
    addEvent(state, "log.warContractPaid", {
      targetFactionId: contract.targetFactionId,
      reward: pay,
      renown: appliedRenown
    }, "win");
  } else {
    if (contract.type === "risky") contract.active = false;
    const oldRelation = Number(state.player.relations[contract.factionId]) || 0;
    state.player.relations[contract.factionId] = oldRelation + CONFIG.MERCENARY_RELATION_PER_WIN;
    addEvent(state, "log.contractPaid", {
      contractId: contract.id,
      factionId: contract.factionId,
      reward: pay,
      battlesWon: contract.battlesWon
    }, "win");
  }
  return pay;
}

function playerContractFailure(state, battle) {
  const contract = state.player.contract;
  if (
    !contract?.active ||
    contract.type !== "risky" ||
    battle.contractType !== "risky"
  ) return 0;
  const penalty = Math.min(
    state.player.renown,
    Math.max(0, Number(contract.failureRenown) || CONFIG.CONTRACT_RISKY_FAILURE_RENOWN)
  );
  changePlayerRenown(state, -penalty);
  contract.active = false;
  contract.failed = true;
  addEvent(state, "log.riskyFailed", { renown: penalty }, "loss");
  return penalty;
}

function playerBattleWinner(state, battle, enemy) {
  const enemyKind = battle.enemyKind || "bandit";
  const elite = enemyKind === "bandit" && Boolean(enemy.elite || enemy.isElite);
  const loot = enemyKind === "lord"
    ? defeatAiParty(state, enemy, "lord", state.player, "player")
    : Math.max(0, Number.isFinite(enemy.lootValue)
      ? enemy.lootValue
      : Math.floor(enemy.gold * CONFIG.LOOT_SHARE));
  if (enemyKind === "lord") {
    enemy.playerPursuitCooldownUntil = state.tick + CONFIG.LORD_PLAYER_PURSUIT_COOLDOWN_TICKS;
  }
  const requestedRenown = battle.banditCasualties * CONFIG.RENOWN_PER_ENEMY_CASUALTY;
  if (enemyKind === "bandit") state.player.gold += loot;
  const renown = changePlayerRenown(state, requestedRenown);
  state.stats.goldEarned += loot;
  state.stats.wins += 1;
  if (enemyKind === "bandit" && enemy.jackpot) state.stats.jackpots += 1;
  if (elite) state.stats.eliteWins += 1;
  incrementTelemetry(state, "battlesWon");
  if (getTroopCount(state.player) <= 0) incrementTroop(state.player, "militia", 1);
  if (enemyKind === "bandit") {
    awardSurvivorXp(state.player);
    removeBanditAndMaintainElite(state, enemy.id);
  }
  const contractPay = playerContractPayment(state, battle, enemy);

  addEvent(state, "log.victory", { loot, renown }, "win");
  if (enemyKind === "bandit" && enemy.jackpot) {
    addEvent(state, "log.jackpot", { banditId: enemy.id, bonus: loot, elite }, "win");
  }
  if (elite) addEvent(state, "log.eliteVictory", { banditId: enemy.id, loot }, "win");
  const casualOutcome = recordPlayerBattleOutcome(state, "win");
  return {
    type: "victory",
    loot,
    renown,
    elite,
    jackpot: enemyKind === "bandit" && Boolean(enemy.jackpot),
    contractPay,
    casualOutcome,
    progressionCheck: true
  };
}

function playerBattleLoser(state, battle, enemy) {
  const enemyKind = battle.enemyKind || "bandit";
  const goldAfterLoss = Math.floor(state.player.gold * CONFIG.PLAYER_GOLD_RETAINED_ON_LOSS);
  const lostGold = state.player.gold - goldAfterLoss;
  state.player.gold = goldAfterLoss;

  if (getTroopCount(enemy) > 0) {
    enemy.gold += lostGold;
    awardSurvivorXp(enemy);
    if (enemyKind === "bandit") assignBanditMoveTarget(state, enemy);
  } else if (enemyKind === "bandit") {
    removeBanditAndMaintainElite(state, enemy.id);
  } else {
    restoreMinimumSurvivor(enemy, "lord");
  }
  if (enemyKind === "lord") {
    enemy.playerPursuitCooldownUntil = state.tick + CONFIG.LORD_PLAYER_PURSUIT_COOLDOWN_TICKS;
    enemy.aiState = "patrol";
    enemy.targetKind = null;
    enemy.targetId = null;
    enemy.moveTarget = null;
  }

  if (getTroopCount(state.player) <= 0) incrementTroop(state.player, "militia", 1);
  const refuge = nearestTown(state, state.player.pos);
  state.player.pos = copyPosition(refuge.pos);
  state.player.prevPos = copyPosition(refuge.pos);
  state.player.moveTarget = null;
  state.player.encounterCooldownUntil = state.tick + CONFIG.RESPAWN_GRACE_TICKS;
  addEvent(state, "log.defeat", { lostGold, townId: refuge.id }, "loss");
  const contractRenownLost = playerContractFailure(state, battle);
  const casualOutcome = recordPlayerBattleOutcome(state, "loss");
  return {
    type: "defeat",
    lostGold,
    townId: refuge.id,
    contractRenownLost,
    casualOutcome,
    progressionCheck: false
  };
}

function playerBattleDraw(state, battle, enemy) {
  const enemyKind = battle.enemyKind || "bandit";
  const renown = Math.floor(
    battle.banditCasualties * CONFIG.RENOWN_PER_ENEMY_CASUALTY / 2
  );
  state.player.renown += renown;
  state.player.moveTarget = null;
  state.player.encounterCooldownUntil = state.tick + CONFIG.RESPAWN_GRACE_TICKS;

  if (enemyKind === "bandit") {
    assignBanditMoveTarget(state, enemy);
  } else {
    enemy.playerPursuitCooldownUntil = state.tick + CONFIG.LORD_PLAYER_PURSUIT_COOLDOWN_TICKS;
    enemy.aiState = "patrol";
    enemy.targetKind = null;
    enemy.targetId = null;
    enemy.moveTarget = null;
  }

  addEvent(state, "log.mutualDestruction", { renown }, "round");
  const casualOutcome = recordPlayerBattleOutcome(state, "draw");
  return {
    type: "draw",
    loot: 0,
    renown,
    casualOutcome,
    progressionCheck: true
  };
}

function finishBattle(state, winner, bandit) {
  const battle = state.battle;
  if (!battle) return null;
  ensureBattleCapture(state, battle, bandit);
  // The live rosters are the authoritative casualty ledger. HP stacks can
  // carry fractional pools across battles, so summing per-wave death deltas
  // may over-report when several stacks cross a head threshold together.
  // Normalize once, before rewards/stats/script generation, so no casualty
  // count can exceed the soldiers who actually entered this battle.
  battle.playerCasualties = Math.max(
    0,
    battle.playerStart - Math.min(battle.playerStart, getTroopCount(state.player))
  );
  battle.banditCasualties = Math.max(
    0,
    battle.banditStart - Math.min(battle.banditStart, getTroopCount(bandit))
  );
  if (!battle.counted) {
    state.stats.battles += 1;
    incrementTelemetry(state, "battlesFought");
  }
  state.stats.kills += battle.banditCasualties;
  const result = winner === "player"
    ? playerBattleWinner(state, battle, bandit)
    : winner === "draw"
      ? playerBattleDraw(state, battle, bandit)
      : playerBattleLoser(state, battle, bandit);
  const playerWiped = battle.playerStart - battle.playerCasualties <= 0;
  if (playerWiped && isV11State(state) && getLieutenants(state).length) {
    const lost = getLieutenants(state).map((entry) => entry.id);
    if (state.features?.f4) {
      state.player.lieutenants = [];
      syncLieutenantAlias(state);
    } else {
      state.player.lieutenant = null;
    }
    if (state.telemetry?.lieutenant) {
      state.telemetry.lieutenant.lostCount = Math.max(
        0,
        Number(state.telemetry.lieutenant.lostCount) || 0
      ) + lost.length;
    }
    if (state.features?.f4 && state.telemetry?.lieutenants) {
      state.telemetry.lieutenants.lostCount = Math.max(
        0,
        Number(state.telemetry.lieutenants.lostCount) || 0
      ) + lost.length;
    }
    lost.forEach((lieutenantId) => {
      addEvent(state, "log.lieutenantLost", { lieutenantId }, "loss");
    });
    result.lieutenantLost = lost;
  }
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
      player: getTroopCount(state.player),
      enemy: getTroopCount(bandit)
    }
  };
  result.resolvedCasualties = resolved.casualties;
  result.resolvedSurvivors = resolved.survivors;
  const battleScript = buildBattleScript(
    state,
    battle,
    result,
    winner === "player" ? "player" : winner === "draw" ? "draw" : "enemy"
  );
  state.battleScript = battleScript;
  state.battlePlayback ||= { speed: 1, skip: false };
  state.battlePlayback.skip = false;
  result.battleScript = battleScript;
  result.battleScriptCheck = validateBattleScript(battleScript, resolved);
  state.battle = null;
  return result;
}

export function resolveBattleRound(state) {
  ensureLivingState(state);
  const battle = state.battle;
  if (!battle) return null;
  const bandit = getBattleEnemy(state, battle);
  if (!bandit) {
    state.battle = null;
    return null;
  }
  ensureBattleCapture(state, battle, bandit);
  if (battle.formations?.eligible && !battle.formations.resolved) return null;
  if (state.features?.f3 && battle.commands && !battle.commands.resolved) return null;

  if (battle.round >= CONFIG.MAX_BATTLE_ROUNDS) {
    const winner = getPartyStrength(state.player) >= getPartyStrength(bandit) ? "player" : "bandit";
    return finishBattle(state, winner, bandit);
  }

  const formation = battle.formationModifiers || applyF3BattleModifiers(
    state,
    battle,
    bandit,
    formationModifiers(battle.formations)
  );
  const playerAttack = getPartyStrength(state.player)
    * (battle.playerAttackMultiplier || 1)
    * formation.player.attack;
  const banditAttack = getPartyStrength(bandit) * formation.enemy.attack;
  const playerMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
    CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
  );
  const banditMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
    CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
  );
  const playerDamage = playerAttack * playerMultiplier * CONFIG.FIELD_TERRAIN
    / formation.enemy.defense;
  const playerResistance = lieutenantResistance(state);
  const enemyDamage = banditAttack * banditMultiplier * CONFIG.FIELD_TERRAIN
    / (formation.player.defense * playerResistance);
  const banditLoss = calculateCasualties(
    playerAttack,
    bandit,
    playerMultiplier / formation.enemy.defense
  );
  const playerLoss = calculateCasualties(
    banditAttack,
    state.player,
    banditMultiplier / (formation.player.defense * playerResistance)
  );

  // v1.1 spends hitpoints; v1.0 removes whole soldiers. The two paths are
  // exclusive and v1.0 never touches an hp field.
  let actualBanditLoss;
  let actualPlayerLoss;
  let hpRound = null;
  let casualtyRound = null;
  if (isV11State(state)) {
    hpRound = resolveHpRound(state, bandit, {
      playerAttack,
      banditAttack,
      playerMultiplier,
      banditMultiplier,
      formation,
      playerResistance
    });
    actualBanditLoss = hpRound.enemyDeaths;
    actualPlayerLoss = hpRound.playerDeaths;
  } else {
    casualtyRound = resolveCasualtyWaves(
      state,
      bandit,
      battle,
      playerLoss,
      banditLoss
    );
    actualBanditLoss = casualtyRound.enemyDeaths;
    actualPlayerLoss = casualtyRound.playerDeaths;
  }
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
    enemyStrengthRemaining: getPartyStrength(bandit),
    playerRouted: Boolean(hpRound?.forced?.player || casualtyRound?.forced?.player)
      || routed(getTroopCount(state.player), battle.playerStart),
    enemyRouted: Boolean(hpRound?.forced?.enemy || casualtyRound?.forced?.enemy)
      || routed(getTroopCount(bandit), battle.banditStart),
    ...(hpRound ? {
      playerHpDealt: hpRound.playerHpDealt,
      enemyHpDealt: hpRound.enemyHpDealt,
      playerHpRemaining: hpRound.playerHpRemaining,
      enemyHpRemaining: hpRound.enemyHpRemaining,
      lieutenantHp: hpRound.lieutenantHp
    } : {})
  });
  addEvent(state, "log.battleRound", {
    round: battle.round,
    banditLoss: actualBanditLoss,
    playerLoss: actualPlayerLoss
  }, "round");

  const winner = hpRound?.outcome || casualtyRound?.outcome || roundOutcome(state, bandit, battle);
  if (winner) {
    return finishBattle(
      state,
      winner === "draw" ? "draw" : winner === "first" ? "player" : "bandit",
      bandit
    );
  }
  battle.nextRoundTick = state.tick + CONFIG.BATTLE_ROUND_TICKS;
  return null;
}

export function startBattle(state, bandit, options = {}) {
  ensureLivingState(state);
  if (state.battle) return null;
  const enemyKind = options.enemyKind === "lord" || state.lords.some((lord) => lord.id === bandit.id)
    ? "lord"
    : "bandit";
  if (areBanditBattlesBlocked(state)) {
    return { type: "blocked", reason: "escort", day: state.stats.days, banditId: bandit.id };
  }
  if (enemyKind === "bandit" && isStarterBattleProtected(state, bandit)) {
    return { type: "blocked", reason: "starterProtection", banditId: bandit.id };
  }
  const balance = enemyKind === "bandit"
    ? prepareRiskyContractBattle(state, bandit) || prepareStarterBattle(state, bandit)
    : null;
  const lieutenantAttackMultiplier = isV11State(state) && hasLieutenant(state, "chen_mang")
    ? 1 + CONFIG_V11.LIEUTENANT_ATTACK_BONUS
    : 1;
  const playerAttackMultiplier = consumePlayerAttackMultiplier(state) * lieutenantAttackMultiplier;
  const playerStart = getTroopCount(state.player);
  const banditStart = getTroopCount(bandit);
  const elite = Boolean(bandit.elite || bandit.isElite);
  const nearTownId = nearestTown(state, state.player.pos)?.id || null;
  const terrain = visualTerrain(state);
  state.player.moveTarget = null;
  state.stats.battles += 1;
  incrementTelemetry(state, "battlesFought");
  if (state.demo && state.demo.firstBattleTick === null) state.demo.firstBattleTick = state.tick;
  const battleId = battleScriptId(state, bandit);
  const formations = prepareFormations(
    state,
    enemyKind,
    bandit,
    playerStart,
    banditStart,
    battleId
  );
  const commands = state.features?.f3 ? {
    player: null,
    resolved: false,
    resumePaused: Boolean(state.paused)
  } : null;
  state.battle = {
    banditId: bandit.id,
    enemyKind,
    enemyFactionId: bandit.factionId || null,
    battleId,
    terrain,
    playerStart,
    banditStart,
    playerStartRoster: cloneRoster(state.player),
    enemyStartRoster: cloneRoster(bandit),
    playerStartStrength: getPartyStrength(state.player),
    enemyStartStrength: getPartyStrength(bandit),
    lieutenantHp: isV11State(state) && hasLieutenant(state, "chen_mang")
      ? CONFIG_V11.LIEUTENANT_HP
      : null,
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
    contractType: balance?.type === "contractRisk"
      ? "risky"
      : state.player.contract?.active && state.player.contract.type === "war" && enemyKind === "lord"
        ? "war"
        : null,
    playerAttackMultiplier,
    formations,
    commands,
    formationModifiers: formationModifiers(formations)
  };
  if (formations?.eligible) {
    formations.resumePaused = Boolean(state.paused);
    state.demo.modal = "formation";
    state.demo.pauseReason = "formation";
    state.paused = true;
  } else if (commands) {
    state.demo.modal = "battleCommand";
    state.demo.pauseReason = "battleCommand";
    state.paused = true;
  }
  state.battleScript = null;
  state.battlePlayback ||= { speed: 1, skip: false };
  state.battlePlayback.speed = [1, 2, 4].includes(state.battlePlayback.speed)
    ? state.battlePlayback.speed
    : 1;
  state.battlePlayback.skip = false;
  recordBiggestBattle(state, {
    tick: state.tick,
    banditId: bandit.id,
    townId: nearTownId,
    playerStart,
    enemyStart: banditStart,
    elite
  });
  addEvent(
    state,
    enemyKind === "lord" ? "log.lordEncounter" : "log.encounter",
    enemyKind === "lord"
      ? { playerCount: playerStart, enemyCount: banditStart, factionId: bandit.factionId }
      : { playerCount: playerStart, banditCount: banditStart, elite },
    "round"
  );
  if (isV11State(state) && hasLieutenant(state, "chen_mang")) {
    addEvent(state, "log.lieutenantBattle", { lieutenantId: "chen_mang" }, "round");
  }

  if (getTroopCount(state.player) <= 0) return finishBattle(state, "bandit", bandit);
  return null;
}

export function checkForEncounter(state) {
  if (
    state.battle ||
    areBanditBattlesBlocked(state) ||
    state.tick < state.player.encounterCooldownUntil ||
    (state.autoplay?.enabled && state.tick < (state.autoplay.nextHuntTick || 0))
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

export function checkForHostileLordEncounter(state) {
  if (
    state.battle ||
    state.player.act < 2 ||
    areBanditBattlesBlocked(state) ||
    state.tick < state.player.encounterCooldownUntil ||
    (state.autoplay?.enabled && state.tick < (state.autoplay.nextHuntTick || 0))
  ) return null;
  const candidates = state.lords
    .filter((lord) => (
      (lord.defeatedUntilTick || 0) <= state.tick &&
      (lord.playerPursuitCooldownUntil || 0) <= state.tick &&
      (Number(state.player.relations?.[lord.factionId]) || 0) < 0
    ))
    .map((lord) => ({ lord, separation: distance(state.player.pos, lord.pos) }))
    .filter((entry) => entry.separation <= CONFIG.ENCOUNTER_RADIUS)
    .sort((first, second) => (
      first.separation - second.separation || first.lord.id.localeCompare(second.lord.id)
    ));
  return candidates.length ? startBattle(state, candidates[0].lord, { enemyKind: "lord" }) : null;
}

export function skipBattle(state) {
  if (state.battle?.formations?.eligible && !state.battle.formations.resolved) {
    return { type: "blocked", reason: "formation" };
  }
  if (state.features?.f3 && state.battle?.commands && !state.battle.commands.resolved) {
    return { type: "blocked", reason: "battleCommand" };
  }
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
  const bandit = getBattleEnemy(state, battle);
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
    if ((battle.enemyKind || "bandit") === "bandit") assignBanditMoveTarget(state, bandit);
    else {
      bandit.playerPursuitCooldownUntil = state.tick + CONFIG.LORD_PLAYER_PURSUIT_COOLDOWN_TICKS;
      bandit.aiState = "patrol";
      bandit.targetKind = null;
      bandit.targetId = null;
      bandit.moveTarget = null;
    }
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
  const contractRenownLost = playerContractFailure(state, battle);
  addEvent(state, "log.retreatSuccess", { banditId: battle.banditId }, "win");
  ensureBattleCapture(state, battle, bandit);
  const result = {
    ok: true,
    success: true,
    type: "fled",
    banditId: battle.banditId,
    contractRenownLost
  };
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
  const aiFormation = (party) => {
    const shares = getArmShares(party);
    const arm = ARM_IDS.slice().sort((a, b) => shares[b] - shares[a] || a.localeCompare(b))[0];
    return arm === "cavalry" ? "wedge" : arm === "archer" ? "line" : "circle";
  };
  const firstFormation = state.features?.f3 ? aiFormation(first) : null;
  const secondFormation = state.features?.f3 ? aiFormation(second) : null;
  const aiAttack = (attacker, defender, formation) => {
    if (!state.features?.f3) return getPartyStrength(attacker);
    const shares = getArmShares(attacker);
    const synergy = (
      (formation === "wedge" && shares.cavalry > Math.max(shares.spear, shares.archer)) ||
      (formation === "line" && shares.archer >= CONFIG.F3_ARCHER_VOLLEY_SHARE) ||
      (formation === "circle" && shares.spear > Math.max(shares.archer, shares.cavalry))
    ) ? 1 + CONFIG.F3_FORMATION_SYNERGY : 1;
    return getPartyStrength(attacker) * armMatchupModifier(attacker, defender) * synergy;
  };

  for (let round = 0; round < CONFIG.MAX_BATTLE_ROUNDS && !winner; round += 1) {
    const firstMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
      CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
    );
    const secondMultiplier = CONFIG.BATTLE_DAMAGE_MIN + nextFloat(state.rng) * (
      CONFIG.BATTLE_DAMAGE_MAX - CONFIG.BATTLE_DAMAGE_MIN
    );
    const lossToSecond = calculateCasualties(
      aiAttack(first, second, firstFormation),
      second,
      firstMultiplier,
      terrainMultiplier(state, first)
    );
    const lossToFirst = calculateCasualties(
      aiAttack(second, first, secondFormation),
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
    stolen,
    ...(state.features?.f3 ? { formations: { first: firstFormation, second: secondFormation } } : {})
  };
}

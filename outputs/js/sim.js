import {
  factionsAreHostile,
  getGarrisonStrength,
  movePartyToward,
  reevaluateAllLords,
  updateBanditRoam,
  updateLordMovement
} from "./ai.js";
import {
  checkForEncounter,
  checkForHostileLordEncounter,
  chooseBattleCommand,
  choosePlayerFormation,
  counterFormation,
  resolveAiBattle,
  resolveBattleRound,
  skipBattle,
  validateBattleScript
} from "./battle.js";
import {
  applyCasualSpawnBalance,
  chooseRoadEvent as applyRoadEventChoice,
  ensureCasualState,
  getActiveRoadEvent,
  processDailyRoadEvent as rollDailyRoadEvent
} from "./casual.js";
import { ARM_IDS, CASUAL_EVENTS, CONFIG, LIEUTENANT_EVENTS, TROOP_TYPES } from "./data.js";
import {
  advanceActIfNeeded,
  advanceOnboarding,
  beginAct2Promise,
  beginAct3Promise,
  dismissFiefThreat,
  submitPromise
} from "./demo.js";
import {
  ensureEliteBandit,
  ensureLivingState,
  spawnScaledBandit
} from "./living.js";
import { createRng, nextFloat, randomInt } from "./rng.js";
import { buildRoads, isOnRoad } from "./roads.js";
import {
  awardPatronCapture,
  chooseKingdomEdict,
  declineFounding,
  dismissFoundingSeal,
  foundKingdom,
  processAct3Expansion,
  processKingdomDay,
  selectOrigin
} from "./kingdom.js";
import { recordChronicleMilestone } from "./telemetry.js";
import {
  activeTown,
  addEvent,
  changePlayerRenown,
  clamp,
  copyPosition,
  createInitialState,
  distance,
  dominantArm,
  getFaction,
  getPartyStrength,
  getTown,
  getTroopCount,
  incrementTroop,
  isV11State,
  nearestTown,
  recruitPoolsForFaction
} from "./state.js";

function snapshotPreviousPositions(state) {
  state.player.prevPos = copyPosition(state.player.pos);
  state.lords.forEach((lord) => {
    lord.prevPos = copyPosition(lord.pos);
  });
  state.bandits.forEach((bandit) => {
    bandit.prevPos = copyPosition(bandit.pos);
  });
}

function sortedFactionPairs(state) {
  const factions = state.factions.slice().sort((first, second) => first.id.localeCompare(second.id));
  const pairs = [];
  for (let firstIndex = 0; firstIndex < factions.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < factions.length; secondIndex += 1) {
      pairs.push([factions[firstIndex], factions[secondIndex]]);
    }
  }
  return pairs;
}

function normalizeFactionState(state) {
  state.factions.forEach((faction) => {
    faction.atWarWith ||= [];
    faction.relations ||= {};
    faction.warStartedDays ||= {};
    faction.initialTownCount ||= state.towns.filter((town) => town.factionId === faction.id).length;
    if (typeof faction.alive !== "boolean") faction.alive = true;
    state.factions.forEach((other) => {
      if (other.id === faction.id) return;
      if (!Number.isFinite(faction.relations[other.id])) {
        faction.relations[other.id] = CONFIG.DIPLOMACY_START_RELATION;
      }
    });
    faction.atWarWith = [...new Set(faction.atWarWith)].sort();
  });
}

function normalizeTownState(state) {
  state.towns.forEach((town) => {
    if (!Array.isArray(town.garrison) || !town.garrison.length) {
      town.garrison = [{ type: "militia", count: CONFIG.TOWN_START_GARRISON, xp: 0, ...(state.features?.f3 ? { arm: "spear" } : {}) }];
    }
    town.recruitPool = clamp(
      Number.isFinite(town.recruitPool) ? town.recruitPool : CONFIG.TOWN_START_RECRUIT_POOL,
      0,
      CONFIG.TOWN_RECRUIT_POOL_CAP
    );
    if (state.features?.f3) {
      town.recruitPools = ARM_IDS.every((arm) => Number.isFinite(town.recruitPools?.[arm]))
        ? Object.fromEntries(ARM_IDS.map((arm) => [arm, Math.max(0, Math.floor(town.recruitPools[arm]))]))
        : recruitPoolsForFaction(town.factionId);
      town.recruitPool = Object.values(town.recruitPools).reduce((sum, amount) => sum + amount, 0);
    }
    town.prosperity = clamp(
      Number.isFinite(town.prosperity) ? town.prosperity : CONFIG.TOWN_START_PROSPERITY,
      CONFIG.TOWN_MIN_PROSPERITY,
      CONFIG.TOWN_MAX_PROSPERITY
    );
    town.underSiege = Boolean(town.underSiege);
    town.siegeAttackerId ||= town.siege?.attackerLordId || null;
    town.siegeTicks = Math.max(0, Number(town.siegeTicks) || 0);
    town.siegeDays = town.siegeTicks / CONFIG.TICKS_PER_DAY;
    if (town.underSiege && !town.siege && town.siegeAttackerId) {
      const attacker = state.lords.find((lord) => lord.id === town.siegeAttackerId);
      town.siege = attacker ? {
        attackerLordId: attacker.id,
        attackerFactionId: attacker.factionId,
        startedTick: Math.max(0, state.tick - town.siegeTicks),
        progressTicks: town.siegeTicks
      } : null;
    }
  });
}

function normalizeLordState(state) {
  state.lords.forEach((lord) => {
    lord.troopCap ||= CONFIG.LORD_TROOP_CAP;
    lord.targetKind ||= lord.targetId ? "town" : null;
    lord.aiState ||= "patrol";
    lord.aiStateSinceTick ??= 0;
    lord.defeatedUntilTick ??= lord.defeatedUntil || 0;
    lord.defeatedUntil = lord.defeatedUntilTick;
  });
}

function setRelation(first, second, value) {
  first.relations[second.id] = value;
  second.relations[first.id] = value;
}

function declareWarInternal(state, first, second, relation) {
  if (!first || !second || first.id === second.id || !first.alive || !second.alive) return false;
  if (first.atWarWith.includes(second.id)) return false;
  first.atWarWith.push(second.id);
  second.atWarWith.push(first.id);
  first.atWarWith.sort();
  second.atWarWith.sort();
  first.warStartedDays[second.id] = state.stats.days;
  second.warStartedDays[first.id] = state.stats.days;
  setRelation(first, second, relation);
  state.mechanics.warsDeclared += 1;
  addEvent(state, "log.warDeclared", {
    firstFactionId: first.id,
    secondFactionId: second.id,
    relation
  }, "danger");
  musterFiefThreat(state, first, second);
  return true;
}

function musterFiefThreat(state, first, second) {
  if (state.player.act < 3 || !state.player.fiefs.length || !state.player.factionId) return null;
  const enemyFactionId = first.id === state.player.factionId
    ? second.id
    : second.id === state.player.factionId
      ? first.id
      : null;
  if (!enemyFactionId) return null;
  const town = heldFiefTowns(state).sort((a, b) => a.id.localeCompare(b.id))[0];
  const marching = state.lords.find((candidate) => (
    candidate.factionId === enemyFactionId &&
    candidate.aiState === "attack" &&
    candidate.targetKind === "town" &&
    candidate.targetId === town?.id
  ));
  if (marching) return marching;
  const lord = state.lords
    .filter((candidate) => candidate.factionId === enemyFactionId)
    .sort((a, b) => getTroopCount(b) - getTroopCount(a) || a.id.localeCompare(b.id))[0];
  if (!town || !lord) return null;
  const missing = Math.max(0, CONFIG.FIEF_THREAT_LORD_MIN_TROOPS - getTroopCount(lord));
  if (missing) incrementTroop(lord, "militia", missing);
  lord.aiState = "attack";
  lord.targetKind = "town";
  lord.targetId = town.id;
  lord.moveTarget = copyPosition(town.pos);
  lord.aiStateSinceTick = state.tick;
  addEvent(state, "log.fiefArmyMusters", {
    townId: town.id,
    factionId: enemyFactionId,
    lordId: lord.id,
    count: getTroopCount(lord)
  }, "danger");
  return lord;
}

function musterExistingFiefWar(state) {
  if (state.player.act < 3 || !state.player.fiefs.length || !state.player.factionId) return null;
  const patron = getFaction(state, state.player.factionId);
  if (!patron) return null;
  for (const enemyId of patron.atWarWith.slice().sort()) {
    const lord = musterFiefThreat(state, patron, getFaction(state, enemyId));
    if (lord) return lord;
  }
  return null;
}

export function initializeLivingWorld(state) {
  ensureLivingState(state);
  ensureCasualState(state);
  normalizeFactionState(state);
  normalizeTownState(state);
  normalizeLordState(state);
  state.living ||= {
    version: 1,
    initializedTick: state.tick,
    demoWarSeeded: false,
    starterBanditSeeded: false,
    aiInitialized: false
  };

  if (CONFIG.STARTER_BANDIT_ENABLED && !state.living.starterBanditSeeded) {
    state.living.starterBanditSeeded = true;
    const starter = spawnScaledBandit(state, { townId: CONFIG.START_TOWN_ID });
    applyCasualSpawnBalance(state, starter);
  }

  if (CONFIG.DEMO && !state.autoplay?.fullVersion && !state.living.demoWarSeeded) {
    state.living.demoWarSeeded = true;
    const [firstId, secondId] = CONFIG.DEMO_INITIAL_WAR_FACTIONS;
    declareWarInternal(
      state,
      getFaction(state, firstId),
      getFaction(state, secondId),
      CONFIG.DEMO_INITIAL_WAR_RELATION
    );
  }
  ensureEliteBandit(state);
  return state;
}

export function declareWar(state, firstFactionId, secondFactionId) {
  initializeLivingWorld(state);
  const first = getFaction(state, firstFactionId);
  const second = getFaction(state, secondFactionId);
  const relation = Math.min(
    first?.relations?.[secondFactionId] ?? CONFIG.WAR_RELATION_THRESHOLD,
    CONFIG.WAR_RELATION_THRESHOLD
  );
  return declareWarInternal(state, first, second, relation);
}

export function makePeace(state, firstFactionId, secondFactionId) {
  initializeLivingWorld(state);
  const first = getFaction(state, firstFactionId);
  const second = getFaction(state, secondFactionId);
  if (!first || !second || !first.atWarWith.includes(second.id)) return false;
  first.atWarWith = first.atWarWith.filter((id) => id !== second.id);
  second.atWarWith = second.atWarWith.filter((id) => id !== first.id);
  delete first.warStartedDays[second.id];
  delete second.warStartedDays[first.id];
  state.mechanics.peaceTreaties += 1;
  addEvent(state, "log.peaceDeclared", {
    firstFactionId: first.id,
    secondFactionId: second.id
  }, "world");
  return true;
}

function currentTownCount(state, factionId) {
  return state.towns.filter((town) => town.factionId === factionId).length;
}

function updateDiplomacy(state) {
  sortedFactionPairs(state).forEach(([first, second]) => {
    if (!first.alive || !second.alive) return;
    if (state.kingdom?.founded && [first.id, second.id].includes("player")) {
      if (!first.atWarWith.includes(second.id)) {
        declareWarInternal(state, first, second, CONFIG.KINGDOM_WAR_RELATION);
      }
      setRelation(first, second, CONFIG.KINGDOM_WAR_RELATION);
      return;
    }
    const drift = nextFloat(state.rng) < 0.5
      ? -CONFIG.DIPLOMACY_RELATION_DRIFT
      : CONFIG.DIPLOMACY_RELATION_DRIFT;
    const relation = (Number(first.relations[second.id]) || 0) + drift;
    setRelation(first, second, relation);
    if (!first.atWarWith.includes(second.id)) {
      const touchesPlayerFief = state.player.act >= 3 && state.player.fiefs.length > 0 &&
        [first.id, second.id].includes(state.player.factionId);
      const declarationChance = touchesPlayerFief
        ? CONFIG.FIEF_HOSTILITY_ROLL
        : CONFIG.WAR_DECLARATION_CHANCE;
      const declarationThreshold = touchesPlayerFief
        ? CONFIG.FIEF_WAR_RELATION_TRIGGER
        : CONFIG.WAR_RELATION_THRESHOLD;
      if (
        relation < declarationThreshold &&
        nextFloat(state.rng) < declarationChance
      ) {
        declareWarInternal(state, first, second, relation);
      }
      return;
    }

    const startedDay = first.warStartedDays[second.id] ?? state.stats.days;
    const duration = state.stats.days - startedDay;
    const firstLosses = Math.max(0, first.initialTownCount - currentTownCount(state, first.id));
    const secondLosses = Math.max(0, second.initialTownCount - currentTownCount(state, second.id));
    if (
      duration > CONFIG.PEACE_MIN_WAR_DAYS &&
      Math.max(firstLosses, secondLosses) >= CONFIG.PEACE_TOWN_LOSS_THRESHOLD &&
      nextFloat(state.rng) < CONFIG.PEACE_CHANCE
    ) {
      makePeace(state, first.id, second.id);
    }
  });
  musterExistingFiefWar(state);
  handleFactionEliminations(state);
}

function dailyWage(party) {
  return (party.troops || party.garrison || []).reduce((total, stack) => {
    return total + (TROOP_TYPES[stack.type]?.wage || 0) * stack.count;
  }, 0);
}

export function heldFiefTowns(state) {
  return state.player.fiefs
    .map((townId) => getTown(state, townId))
    .filter(Boolean);
}

export function fiefGarrisonWage(state) {
  return heldFiefTowns(state).reduce((total, town) => total + dailyWage(town), 0);
}

function garrisonCount(town) {
  return (town.garrison || []).reduce((total, stack) => total + stack.count, 0);
}

function transferTroops(source, target, amount) {
  const sourceKey = Array.isArray(source.troops) ? "troops" : "garrison";
  const targetKey = Array.isArray(target.troops) ? "troops" : "garrison";
  const sourceStacks = source[sourceKey] || [];
  const targetStacks = target[targetKey] || [];
  let remaining = Math.max(0, Math.floor(amount));
  let moved = 0;
  for (const stack of sourceStacks.slice()) {
    if (remaining <= 0) break;
    const quantity = Math.min(stack.count, remaining);
    if (quantity <= 0) continue;
    stack.count -= quantity;
    remaining -= quantity;
    moved += quantity;
    let destination = targetStacks.find((entry) => (
      entry.type === stack.type && entry.xp === stack.xp && entry.arm === stack.arm
    ));
    if (!destination) {
      destination = {
        type: stack.type,
        count: 0,
        xp: stack.xp,
        ...(stack.arm ? { arm: stack.arm } : {})
      };
      targetStacks.push(destination);
    }
    destination.count += quantity;
  }
  source[sourceKey] = sourceStacks.filter((stack) => stack.count > 0);
  target[targetKey] = targetStacks.filter((stack) => stack.count > 0);
  return moved;
}

export function setFiefGarrison(state, townId, desiredCount) {
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = getTown(state, townId);
  if (!town || !state.player.fiefs.includes(town.id)) {
    return { ok: false, reason: "notFief" };
  }
  if (activeTown(state)?.id !== town.id) return { ok: false, reason: "outsideTown" };
  const fieldBefore = getTroopCount(state.player);
  const garrisonBefore = garrisonCount(town);
  const maximum = Math.max(0, fieldBefore + garrisonBefore - CONFIG.FIEF_MIN_FIELD_TROOPS);
  const desired = clamp(Math.floor(Number(desiredCount) || 0), 0, maximum);
  if (desired > garrisonBefore) {
    transferTroops(state.player, town, desired - garrisonBefore);
  } else if (desired < garrisonBefore) {
    transferTroops(town, state.player, garrisonBefore - desired);
  }
  const field = getTroopCount(state.player);
  const garrison = garrisonCount(town);
  addEvent(state, "log.garrisonSet", { townId: town.id, field, garrison });
  return { ok: true, townId: town.id, field, garrison, maximum };
}

function payWage(party) {
  const due = dailyWage(party);
  const paid = Math.min(Math.max(0, party.gold || 0), due);
  party.gold = Math.max(0, (party.gold || 0) - paid);
  return { due, paid, unpaid: due - paid };
}

function processDailyEconomy(state) {
  const fiefTax = state.player.fiefs.reduce((sum, townId) => {
    const town = getTown(state, townId);
    return sum + (town ? Math.floor(town.prosperity * CONFIG.PLAYER_TOWN_TAX_RATE) : 0);
  }, 0);
  state.player.gold += fiefTax;
  state.stats.goldEarned += fiefTax;
  const wagesStarted = state.stats.days > CONFIG.WAGE_GRACE_DAYS;
  const fieldWage = dailyWage(state.player);
  const garrisonWage = fiefGarrisonWage(state);
  const totalPlayerWage = fieldWage + garrisonWage;
  const playerWage = wagesStarted
    ? (() => {
      const paid = Math.min(Math.max(0, state.player.gold || 0), totalPlayerWage);
      state.player.gold = Math.max(0, (state.player.gold || 0) - paid);
      return {
        due: totalPlayerWage,
        paid,
        unpaid: totalPlayerWage - paid,
        field: fieldWage,
        garrison: garrisonWage
      };
    })()
    : {
      due: totalPlayerWage,
      paid: 0,
      unpaid: 0,
      field: fieldWage,
      garrison: garrisonWage,
      deferred: true
    };
  state.stats.wagesPaid += playerWage.paid;

  let lordWagesPaid = 0;
  state.lords.forEach((lord) => {
    if (getFaction(state, lord.factionId)?.alive) lord.gold += CONFIG.LORD_DAILY_INCOME;
    const wage = payWage(lord);
    lordWagesPaid += wage.paid;
  });

  const recruitDay = state.stats.days % CONFIG.TOWN_RECRUIT_REGEN_DAYS === 0;
  state.towns.forEach((town) => {
    town.prosperity = clamp(
      town.prosperity + (town.underSiege
        ? CONFIG.TOWN_SIEGE_PROSPERITY_DELTA
        : CONFIG.TOWN_PEACE_PROSPERITY_DELTA),
      CONFIG.TOWN_MIN_PROSPERITY,
      CONFIG.TOWN_MAX_PROSPERITY
    );
    if (recruitDay) {
      if (state.features?.f3) {
        const room = Math.max(0, CONFIG.TOWN_RECRUIT_POOL_CAP - town.recruitPool);
        const gain = Math.min(room, CONFIG.TOWN_RECRUIT_GAIN);
        const mix = CONFIG.F3_REGION_RECRUIT_MIX[town.factionId]
          || CONFIG.F3_REGION_RECRUIT_MIX.south;
        const ranked = ARM_IDS.map((arm) => ({
          arm,
          exact: gain * (mix[arm] || 0),
          amount: Math.floor(gain * (mix[arm] || 0))
        }));
        let left = gain - ranked.reduce((sum, entry) => sum + entry.amount, 0);
        ranked.sort((first, second) => (
          (second.exact - second.amount) - (first.exact - first.amount)
          || first.arm.localeCompare(second.arm)
        ));
        for (let index = 0; index < ranked.length && left > 0; index += 1, left -= 1) {
          ranked[index].amount += 1;
        }
        ranked.forEach(({ arm, amount }) => { town.recruitPools[arm] += amount; });
        town.recruitPool = Object.values(town.recruitPools).reduce((sum, amount) => sum + amount, 0);
      } else {
        town.recruitPool = Math.min(
          CONFIG.TOWN_RECRUIT_POOL_CAP,
          town.recruitPool + CONFIG.TOWN_RECRUIT_GAIN
        );
      }
    }
  });

  if (wagesStarted) {
    addEvent(
      state,
      playerWage.unpaid > 0 ? "log.wagesShort" : "log.wages",
      {
        day: state.stats.days,
        wage: playerWage.due,
        paid: playerWage.paid,
        unpaid: playerWage.unpaid,
        fiefTax,
        lordWagesPaid,
        recruitPoolsGrew: recruitDay
      },
      playerWage.unpaid > 0 ? "loss" : ""
    );
  }
  return { fiefTax, playerWage, lordWagesPaid, recruitPoolsGrew: recruitDay };
}

function processDailyContract(state) {
  const contract = state.player.contract;
  if (!contract?.active || contract.type !== "escort") return null;
  contract.daysRemaining = Math.max(0, (Number(contract.daysRemaining) || 0) - 1);
  if (contract.daysRemaining > 0) {
    addEvent(state, "log.escortDay", { days: contract.daysRemaining }, "world");
    return { type: "escort", complete: false, daysRemaining: contract.daysRemaining };
  }
  const reward = Math.max(0, Number(contract.reward) || CONFIG.CONTRACT_ESCORT_REWARD);
  state.player.gold += reward;
  state.stats.goldEarned += reward;
  state.stats.contractGold += reward;
  contract.goldEarned = (contract.goldEarned || 0) + reward;
  contract.active = false;
  state.mechanics.contractBattles += 1;
  addEvent(state, "log.escortComplete", { reward }, "win");
  return { type: "escort", complete: true, reward, daysRemaining: 0 };
}

function completeFiefContract(state, contract) {
  const reward = Math.max(0, Number(contract.reward) || 0);
  state.player.gold += reward;
  state.stats.goldEarned += reward;
  state.stats.contractGold += reward;
  contract.goldEarned = (contract.goldEarned || 0) + reward;
  contract.active = false;
  const factionId = contract.factionId || state.player.factionId;
  if (factionId) {
    state.player.relations[factionId] = clamp(
      (Number(state.player.relations[factionId]) || 0) + CONFIG.FIEF_CONTRACT_RELATION,
      CONFIG.ROAD_EVENT_RELATION_MIN,
      CONFIG.ROAD_EVENT_RELATION_MAX
    );
  }
  state.mechanics.contractBattles += 1;
  addEvent(state, contract.type === "reinforce" ? "log.reinforceComplete" : "log.patrolComplete", {
    townId: contract.targetTownId,
    reward,
    relation: CONFIG.FIEF_CONTRACT_RELATION
  }, "win");
  return { type: contract.type, complete: true, reward, townId: contract.targetTownId };
}

export function processFiefContract(state) {
  const contract = state.player.contract;
  if (!contract?.active || !["reinforce", "patrol"].includes(contract.type)) return null;
  const town = getTown(state, contract.targetTownId);
  if (!town || !state.player.fiefs.includes(town.id)) {
    contract.active = false;
    addEvent(state, "log.fiefContractEnded", { townId: contract.targetTownId }, "loss");
    return { type: contract.type, complete: false, failed: true };
  }
  if (contract.type === "reinforce") {
    const garrison = garrisonCount(town);
    if (garrison >= contract.targetGarrison) return completeFiefContract(state, contract);
    return { type: "reinforce", complete: false, garrison, target: contract.targetGarrison };
  }
  const roads = buildRoads(state.seed);
  const onOwnRoad = isOnRoad(roads, state.player.pos.x, state.player.pos.y) &&
    distance(state.player.pos, town.pos) <= contract.patrolRadius;
  if (onOwnRoad) contract.progressTicks = (contract.progressTicks || 0) + 1;
  if ((contract.progressTicks || 0) >= contract.requiredTicks) {
    return completeFiefContract(state, contract);
  }
  return {
    type: "patrol",
    complete: false,
    progressTicks: contract.progressTicks || 0,
    requiredTicks: contract.requiredTicks
  };
}

function warZoneTowns(state) {
  return state.towns.filter((town) => {
    const faction = getFaction(state, town.factionId);
    return Boolean(faction?.alive && faction.atWarWith?.some((id) => getFaction(state, id)?.alive));
  }).sort((first, second) => first.id.localeCompare(second.id));
}

function spawnWarDeserters(state) {
  if (state.bandits.length >= CONFIG.WAR_ZONE_MAX_BANDITS) return null;
  const towns = warZoneTowns(state);
  if (!towns.length || nextFloat(state.rng) >= CONFIG.DESERTER_BANDIT_DAILY_CHANCE) return null;
  const town = towns[randomInt(state.rng, 0, towns.length)];
  const bandit = spawnScaledBandit(state, {
    townId: town.id,
    maximum: CONFIG.WAR_ZONE_MAX_BANDITS
  });
  if (!bandit) return null;
  const balance = applyCasualSpawnBalance(state, bandit);
  addEvent(state, "log.warBandits", {
    factionId: town.factionId,
    townId: town.id,
    banditId: bandit.id
  }, "danger");
  return { bandit, townId: town.id, factionId: town.factionId, balance };
}

function surfaceTownPriceEffects(state) {
  const town = activeTown(state);
  if (!town) return;
  const price = townRecruitPrice(state, town);
  const noticeKey = `${price.hostile ? 1 : 0}:${price.warZone ? 1 : 0}`;
  if (town.playerPriceNoticeKey === noticeKey) return;
  town.playerPriceNoticeKey = noticeKey;
  if (price.hostile) {
    addEvent(state, "log.hostileTownPrices", {
      factionId: town.factionId,
      townId: town.id,
      percent: Math.round((CONFIG.HOSTILE_TOWN_RECRUIT_PRICE_MULTIPLIER - 1) * 100)
    }, "danger");
  }
  if (price.warZone) {
    addEvent(state, "log.warTownPrices", {
      factionId: town.factionId,
      townId: town.id,
      percent: Math.round((CONFIG.WAR_ZONE_RECRUIT_PRICE_MULTIPLIER - 1) * 100)
    }, "danger");
  }
}

function resetSiege(state, town, lifted = true, preserveProgress = false) {
  if (lifted && town.underSiege) {
    addEvent(state, "log.siegeLifted", {
      townId: town.id,
      attackerLordId: town.siegeAttackerId
    });
  }
  town.underSiege = false;
  town.siegeAttackerId = null;
  if (preserveProgress && town.siege) {
    town.siege.attackerLordId = null;
    return;
  }
  town.siegeTicks = 0;
  town.siegeDays = 0;
  town.siege = null;
}

function handleFactionEliminations(state) {
  state.factions
    .slice()
    .sort((first, second) => first.id.localeCompare(second.id))
    .forEach((faction) => {
      if (!faction.alive || currentTownCount(state, faction.id) > 0) return;
      faction.alive = false;
      const surviving = state.factions
        .filter((candidate) => candidate.id !== faction.id && candidate.alive && currentTownCount(state, candidate.id) > 0)
        .sort((first, second) => first.id.localeCompare(second.id));
      state.factions.forEach((other) => {
        other.atWarWith = other.atWarWith.filter((id) => id !== faction.id);
        delete other.warStartedDays[faction.id];
      });
      faction.atWarWith = [];
      faction.warStartedDays = {};
      addEvent(state, "log.factionFallen", { factionId: faction.id }, "danger");

      state.lords
        .filter((lord) => lord.factionId === faction.id)
        .sort((first, second) => first.id.localeCompare(second.id))
        .forEach((lord) => {
          if (!surviving.length) return;
          const destination = surviving.length === 1
            ? surviving[0]
            : surviving[randomInt(state.rng, 0, surviving.length)];
          const oldFactionId = lord.factionId;
          lord.factionId = destination.id;
          lord.aiState = "patrol";
          lord.targetKind = "town";
          lord.patrolTownIds = state.towns
            .filter((town) => town.factionId === destination.id)
            .sort((first, second) => first.id.localeCompare(second.id))
            .slice(0, 2)
            .map((town) => town.id);
          lord.patrolIndex = 0;
          const target = getTown(state, lord.patrolTownIds[0]);
          lord.targetId = target?.id || null;
          lord.moveTarget = target ? copyPosition(target.pos) : null;
          addEvent(state, "log.lordDefected", {
            lordId: lord.id,
            oldFactionId,
            newFactionId: destination.id,
            factionId: destination.id
          });
        });

      if (state.player.contract?.factionId === faction.id) {
        state.player.contract.active = false;
        addEvent(state, "log.contractEnded", { factionId: faction.id }, "loss");
      }
    });
}

function captureTown(state, town, attacker) {
  const oldFactionId = town.factionId;
  const heldFief = state.player.fiefs.includes(town.id);
  const originalGrant = state.telemetry?.chronicle?.fiefGranted;
  town.factionId = attacker.factionId;
  town.prosperity = clamp(
    town.prosperity - CONFIG.TOWN_CAPTURE_PROSPERITY_LOSS,
    CONFIG.TOWN_MIN_PROSPERITY,
    CONFIG.TOWN_MAX_PROSPERITY
  );
  town.garrison = [{ type: "militia", count: CONFIG.TOWN_CAPTURE_GARRISON, xp: 0, ...(state.features?.f3 ? { arm: "spear" } : {}) }];
  resetSiege(state, town, false);
  state.mechanics.townsCaptured += 1;
  addEvent(state, "log.townCaptured", {
    townId: town.id,
    oldFactionId,
    newFactionId: attacker.factionId,
    factionId: attacker.factionId,
    lordId: attacker.id
  }, "danger");
  awardPatronCapture(state, town, oldFactionId, attacker.factionId);
  if (heldFief && attacker.factionId !== state.player.factionId) {
    state.player.fiefs = state.player.fiefs.filter((townId) => townId !== town.id);
    changePlayerRenown(state, -CONFIG.FIEF_LOSS_RENOWN);
    if (state.player.factionId) {
      state.player.relations[state.player.factionId] = clamp(
        (Number(state.player.relations[state.player.factionId]) || 0) - CONFIG.FIEF_LOSS_RELATION,
        CONFIG.ROAD_EVENT_RELATION_MIN,
        CONFIG.ROAD_EVENT_RELATION_MAX
      );
    }
    state.telemetry.chronicle.fiefLost ||= {
      tick: state.tick,
      day: Math.floor(state.tick / CONFIG.TICKS_PER_DAY) + 1,
      activeSeconds: Number(state.telemetry.totalActiveSeconds) || 0,
      townId: town.id,
      attackerFactionId: attacker.factionId
    };
    if (state.player.contract?.targetTownId === town.id) state.player.contract.active = false;
    addEvent(state, "log.fiefLost", {
      townId: town.id,
      renown: CONFIG.FIEF_LOSS_RENOWN,
      relation: CONFIG.FIEF_LOSS_RELATION
    }, "loss");
  } else if (
    !heldFief &&
    originalGrant?.townId === town.id &&
    originalGrant.factionId === attacker.factionId
  ) {
    if (!state.player.fiefs.includes(town.id)) state.player.fiefs.push(town.id);
    state.telemetry.chronicle.fiefRecaptured ||= {
      tick: state.tick,
      day: Math.floor(state.tick / CONFIG.TICKS_PER_DAY) + 1,
      activeSeconds: Number(state.telemetry.totalActiveSeconds) || 0,
      townId: town.id,
      factionId: attacker.factionId
    };
    addEvent(state, "log.fiefRecaptured", { townId: town.id }, "win");
  }
  handleFactionEliminations(state);
}

function queueFiefThreat(state, town, attacker) {
  if (!state.player.fiefs.includes(town.id) || state.demo.modal) return false;
  const key = `${town.id}:${town.siege?.startedTick ?? state.tick}`;
  if (state.demo.fiefThreatKey === key) return false;
  const threat = {
    townId: town.id,
    attackerLordId: attacker.id,
    garrison: garrisonCount(town),
    enemy: getTroopCount(attacker),
    startedTick: town.siege?.startedTick ?? state.tick
  };
  state.demo.fiefThreatKey = key;
  state.demo.fiefThreat = threat;
  state.demo.modal = "fiefThreat";
  state.demo.pauseReason = "fiefThreat";
  state.paused = true;
  state.telemetry.chronicle.fiefThreat ||= {
    tick: state.tick,
    day: Math.floor(state.tick / CONFIG.TICKS_PER_DAY) + 1,
    activeSeconds: Number(state.telemetry.totalActiveSeconds) || 0,
    ...threat
  };
  addEvent(state, "log.fiefThreat", threat, "danger");
  return true;
}

function validSiegeCandidates(state, town) {
  // A town garrison receives the same 1.5 defensive terrain value used by
  // nearby lord battles. FIELD_TERRAIN remains 1 so open-field combat is not
  // accidentally buffed by the siege rule.
  const requiredStrength = Math.max(1, getGarrisonStrength(town))
    * CONFIG.SIEGE_STRENGTH_RATIO
    * CONFIG.TOWN_DEFENDER_TERRAIN;
  return state.lords
    .filter((lord) => (
      lord.aiState === "attack" &&
      lord.targetKind === "town" &&
      lord.targetId === town.id &&
      lord.factionId !== town.factionId &&
      factionsAreHostile(state, lord.factionId, town.factionId) &&
      (lord.defeatedUntilTick || 0) <= state.tick &&
      distance(lord.pos, town.pos) <= CONFIG.SIEGE_ADJACENCY_RADIUS &&
      getPartyStrength(lord) >= requiredStrength
    ))
    .sort((first, second) => getPartyStrength(second) - getPartyStrength(first) || first.id.localeCompare(second.id));
}

export function updateSieges(state) {
  state.towns.forEach((town) => {
    const candidates = validSiegeCandidates(state, town);
    let attacker = town.siegeAttackerId
      ? candidates.find((lord) => lord.id === town.siegeAttackerId)
      : null;
    if (!attacker) attacker = candidates[0] || null;
    if (!attacker) {
      // Progress pauses between assaults by the same faction. It resets if a
      // rival faction takes over the siege, or when the town is captured.
      resetSiege(state, town, true, true);
      return;
    }

    const continuingFaction = town.siege?.attackerFactionId || null;
    if (!town.siege || continuingFaction !== attacker.factionId) {
      town.underSiege = true;
      town.siegeAttackerId = attacker.id;
      town.siegeTicks = 0;
      town.siegeDays = 0;
      town.siege = {
        attackerLordId: attacker.id,
        attackerFactionId: attacker.factionId,
        startedTick: state.tick,
        progressTicks: 0
      };
      addEvent(state, "log.siegeStarted", {
        townId: town.id,
        attackerLordId: attacker.id,
        attackerFactionId: attacker.factionId
      }, "danger");
      queueFiefThreat(state, town, attacker);
    } else if (!town.underSiege || town.siegeAttackerId !== attacker.id) {
      // An allied lord can take command without erasing the faction's
      // uninterrupted adjacent siege progress.
      town.underSiege = true;
      town.siegeAttackerId = attacker.id;
      town.siege.attackerLordId = attacker.id;
    }

    town.underSiege = true;
    town.siegeTicks += 1;
    town.siegeDays = town.siegeTicks / CONFIG.TICKS_PER_DAY;
    town.siege.progressTicks = town.siegeTicks;
    if (town.siegeTicks >= CONFIG.SIEGE_REQUIRED_TICKS) captureTown(state, town, attacker);
  });
}

function partyStillPresent(state, party, kind) {
  return kind === "lord"
    ? state.lords.some((candidate) => candidate.id === party.id)
    : state.bandits.some((candidate) => candidate.id === party.id);
}

function resolveAiEncounters(state) {
  const engagedBanditId = state.battle && state.battle.enemyKind !== "lord"
    ? state.battle.banditId
    : null;
  const engagedLordId = state.battle?.enemyKind === "lord" ? state.battle.banditId : null;
  const pairs = [];
  const availableLords = state.lords.filter((lord) => (
    (lord.defeatedUntilTick || 0) <= state.tick && lord.id !== engagedLordId
  ));

  availableLords.forEach((lord) => {
    state.bandits.forEach((bandit) => {
      if (bandit.id === engagedBanditId) return;
      const separation = distance(lord.pos, bandit.pos);
      if (separation <= CONFIG.AI_PARTY_ENCOUNTER_RADIUS) {
        pairs.push({ first: lord, firstKind: "lord", second: bandit, secondKind: "bandit", separation });
      }
    });
  });

  for (let firstIndex = 0; firstIndex < availableLords.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < availableLords.length; secondIndex += 1) {
      const first = availableLords[firstIndex];
      const second = availableLords[secondIndex];
      if (!factionsAreHostile(state, first.factionId, second.factionId)) continue;
      const separation = distance(first.pos, second.pos);
      if (separation <= CONFIG.AI_PARTY_ENCOUNTER_RADIUS) {
        pairs.push({ first, firstKind: "lord", second, secondKind: "lord", separation });
      }
    }
  }

  pairs.sort((first, second) => (
    first.separation - second.separation ||
    `${first.first.id}|${first.second.id}`.localeCompare(`${second.first.id}|${second.second.id}`)
  ));
  const used = new Set();
  const results = [];
  pairs.forEach((pair) => {
    if (used.has(pair.first.id) || used.has(pair.second.id)) return;
    if (!partyStillPresent(state, pair.first, pair.firstKind)) return;
    if (!partyStillPresent(state, pair.second, pair.secondKind)) return;
    used.add(pair.first.id);
    used.add(pair.second.id);
    results.push(resolveAiBattle(state, pair.first, pair.second, pair));
  });
  return results;
}

function movementSpeed(state, party, baseSpeed) {
  if (!CONFIG.ROAD_MOVEMENT) return baseSpeed;
  const roads = buildRoads(state.seed);
  const originMultiplier = party === state.player
    ? (CONFIG.ORIGIN_BONUSES[state.kingdom?.origin]?.roadSpeed || 1)
    : 1;
  return baseSpeed * originMultiplier * (isOnRoad(roads, party.pos.x, party.pos.y)
    ? CONFIG.ROAD_SPEED_MULTIPLIER
    : CONFIG.OFF_ROAD_SPEED_MULTIPLIER);
}

export function processDailyRoadEvent(state, options = {}) {
  const roads = buildRoads(state.seed);
  const geometricallyOnRoad = typeof options.onRoad === "boolean"
    ? options.onRoad
    : isOnRoad(roads, state.player.pos.x, state.player.pos.y);
  const onRoad = geometricallyOnRoad && !activeTown(state);
  return rollDailyRoadEvent(state, { ...options, onRoad });
}

export function chooseRoadEvent(state, choiceIndex) {
  return applyRoadEventChoice(state, choiceIndex);
}

export { getActiveRoadEvent };

// URL-only autoplay preflight: every card/choice resolves against its own
// state, so a stale closure or a missing declarative effect fails loudly.
export function verifyRoadEventChoiceEffects(options = {}) {
  const failures = [];
  let choicesChecked = 0;
  const v11 = options.v11 === true;
  const definitions = v11 ? [...CASUAL_EVENTS, ...LIEUTENANT_EVENTS] : CASUAL_EVENTS;

  definitions.forEach((event, eventIndex) => {
    event.choices.forEach((choice, choiceIndex) => {
      choicesChecked += 1;
      const probe = createInitialState(0xe700 + eventIndex * 2 + choiceIndex, {
        skipOnboarding: true,
        startedAt: new Date(0).toISOString(),
        v11
      });
      if (event.id.startsWith("chen_mang_")) {
        probe.player.lieutenant = { id: "chen_mang", hiredAtTick: 0 };
      }
      ensureCasualState(probe);
      probe.player.gold = 1000;
      probe.player.renown = 100;
      incrementTroop(probe.player, "militia", 5);
      probe.stats.days = 5;
      const factionId = probe.factions[0]?.id;
      probe.player.relations[factionId] = 0;
      // Seed 7's first draw is below 5%, exercising the desertion branch.
      probe.rng = createRng(7);
      const active = {
        id: event.id,
        eventId: event.id,
        day: probe.stats.days,
        factionId,
        resumePaused: false,
        resumePauseReason: null
      };
      probe.demo.roadEvent = active;
      probe.demo.activeRoadEvent = active;
      probe.demo.modal = "roadEvent";
      probe.demo.pauseReason = "roadEvent";
      probe.paused = true;

      const result = applyRoadEventChoice(probe, choiceIndex);
      const expected = {
        gold: Number(choice.effects.gold) || 0,
        renown: Number(choice.effects.renown) || 0,
        troops: Number(choice.effects.troops) || 0,
        relation: Number(choice.effects.relation) || 0
      };
      if (Number(choice.effects.desertionChance) > 0) {
        expected.troops -= CONFIG.ROAD_EVENT_DESERTER_COUNT;
      }
      for (const key of Object.keys(expected)) {
        if (result?.delta?.[key] !== expected[key]) {
          failures.push({
            cardId: event.id,
            choice: choiceIndex,
            field: key,
            expected: expected[key],
            actual: result?.delta?.[key]
          });
        }
      }
      if (
        choice.effects.blockBanditBattlesToday &&
        result?.applied?.banditBattlesBlockedDay !== probe.stats.days
      ) {
        failures.push({ cardId: event.id, choice: choiceIndex, field: "blockBanditBattlesToday" });
      }
      if (
        Number(choice.effects.nextBattleAttackBonus) > 0 &&
        result?.applied?.nextBattleAttackMultiplier !== 1 + Number(choice.effects.nextBattleAttackBonus)
      ) {
        failures.push({ cardId: event.id, choice: choiceIndex, field: "nextBattleAttackBonus" });
      }
      if (
        Number(choice.effects.desertionChance) > 0 &&
        result?.applied?.deserterLost !== CONFIG.ROAD_EVENT_DESERTER_COUNT
      ) {
        failures.push({ cardId: event.id, choice: choiceIndex, field: "desertionChance" });
      }

      const telemetry = probe.telemetry.eventChoices.at(-1);
      if (
        telemetry?.cardId !== event.id ||
        telemetry?.choice !== choiceIndex ||
        !telemetry?.effectsApplied ||
        telemetry.effectsApplied !== result?.effectsApplied
      ) {
        failures.push({ cardId: event.id, choice: choiceIndex, field: "telemetry" });
      }
      if (
        event.id.startsWith("chen_mang_") &&
        probe.telemetry.lieutenantEventChoices.at(-1)?.cardId !== event.id
      ) {
        failures.push({ cardId: event.id, choice: choiceIndex, field: "lieutenantTelemetry" });
      }
      const report = probe.eventLog[0];
      if (
        report?.key !== "log.roadEventResolved" ||
        report?.parameters?.effectsApplied !== result?.effectsApplied
      ) {
        failures.push({ cardId: event.id, choice: choiceIndex, field: "report" });
      }
    });
  });

  return {
    ok: failures.length === 0,
    cardsChecked: definitions.length,
    choicesChecked,
    failures
  };
}

function progressionHook(state) {
  const target = state.player.act >= CONFIG.DEMO_MAX_ACT
    ? CONFIG.DEMO_END_RENOWN
    : CONFIG.ACT2_RENOWN;
  return {
    act: state.player.act,
    targetRenown: target,
    targetReached: state.player.renown >= target,
    demoEndingEligible: CONFIG.DEMO && state.player.act === CONFIG.DEMO_MAX_ACT && state.player.renown >= CONFIG.DEMO_END_RENOWN
  };
}

function nearestBandit(state, includeElite = false) {
  const maximumStrength = getPartyStrength(state.player) * CONFIG.AUTOPLAY_MAX_TARGET_STRENGTH_RATIO;
  const candidates = state.bandits.filter((bandit) => (
    (includeElite || !bandit.elite) && getPartyStrength(bandit) <= maximumStrength
  ));
  return candidates.reduce((nearest, bandit) => {
    if (!nearest) return bandit;
    const gap = distance(state.player.pos, bandit.pos);
    const nearestGap = distance(state.player.pos, nearest.pos);
    if (gap !== nearestGap) return gap < nearestGap ? bandit : nearest;
    return bandit.id.localeCompare(nearest.id) < 0 ? bandit : nearest;
  }, null);
}

function autoplayDecision(state) {
  if (!state.autoplay?.enabled || state.battle || state.demo?.ended) return;
  const catchupActive = (
    state.player.act >= 2 &&
    state.telemetry.totalActiveSeconds >= CONFIG.AUTOPLAY_CATCHUP_START_SECONDS
  );
  if (catchupActive) {
    state.autoplay.nextHuntTick = Math.min(
      state.autoplay.nextHuntTick || state.tick,
      state.tick + CONFIG.AUTOPLAY_CATCHUP_RECOVERY_TICKS
    );
  }
  const town = activeTown(state);
  const troopCap = state.player.act >= 3
    ? CONFIG.ACT3_TROOP_CAP
    : state.player.act >= 2
      ? CONFIG.ACT2_TROOP_CAP
      : CONFIG.ACT1_TROOP_CAP;
  const troops = getTroopCount(state.player);
  const contract = activeContract(state);
  const fullVersion = state.autoplay.fullVersion === true;

  if (fullVersion && state.player.act >= 3 && state.player.fiefs.length) {
    const fief = heldFiefTowns(state).sort((first, second) => first.id.localeCompare(second.id))[0];
    if (fief && garrisonCount(fief) < CONFIG.FIEF_REINFORCE_TARGET) {
      if (town?.id === fief.id && troops > CONFIG.FIEF_MIN_FIELD_TROOPS) {
        setFiefGarrison(
          state,
          fief.id,
          Math.min(
            CONFIG.FIEF_REINFORCE_TARGET,
            troops + garrisonCount(fief) - CONFIG.FIEF_MIN_FIELD_TROOPS
          )
        );
      } else {
        state.player.moveTarget = copyPosition(fief.pos);
      }
      return;
    }
  }

  if (
    isV11State(state) &&
    state.player.act >= 2 &&
    !state.player.lieutenant &&
    town &&
    state.player.gold >= CONFIG.V11_LIEUTENANT_COST
  ) {
    state.player.moveTarget = null;
    hireLieutenant(state);
    return;
  }

  if (contract?.type === "escort") {
    state.player.moveTarget = null;
    return;
  }

  if (state.player.act >= 2 && !contract) {
    if (town && (!fullVersion || town.factionId === state.autoplay.patronFactionId)) {
      acceptMercenaryContract(state, town.id, "risky");
    }
    else {
      const destination = nearestTown(
        state,
        state.player.pos,
        fullVersion
          ? (entry) => entry.factionId === state.autoplay.patronFactionId
          : () => true
      ) || nearestTown(state, state.player.pos);
      state.player.moveTarget = copyPosition(destination.pos);
      return;
    }
  }

  const canRecruitHere = Boolean(
    town &&
    troops < troopCap &&
    state.player.gold - townRecruitPrice(state, town).cost >= CONFIG.AUTOPLAY_GOLD_RESERVE &&
    town.recruitPool > 0
  );
  if (canRecruitHere) {
    state.player.moveTarget = null;
    if (state.tick % CONFIG.AUTOPLAY_REEVALUATE_TICKS === 0) {
      let recruitArm = "spear";
      if (state.features?.f3) {
        const scouted = state.bandits.find((bandit) => bandit.id === state.autoplay.targetBanditId)
          || nearestBandit(state, true);
        const enemyArm = dominantArm(scouted || { troops: [] });
        recruitArm = enemyArm === "spear" ? "archer" : enemyArm === "archer" ? "cavalry" : "spear";
        if ((town.recruitPools?.[recruitArm] || 0) <= 0) {
          recruitArm = ARM_IDS.find((arm) => (town.recruitPools?.[arm] || 0) > 0) || "spear";
        }
        state.autoplay.counterArmChosen = recruitArm;
      }
      recruitMilitia(state, recruitArm);
    }
    return;
  }

  if (
    troops < troopCap * CONFIG.AUTOPLAY_RETREAT_TROOP_RATIO &&
    state.player.gold >= Math.min(...state.towns.map((entry) => townRecruitPrice(state, entry).cost)) &&
    state.towns.some((entry) => entry.recruitPool > 0)
  ) {
    const recruitable = state.towns.filter((entry) => entry.recruitPool > 0);
    const destination = nearestTown(
      state,
      state.player.pos,
      (entry) => recruitable.some((candidate) => candidate.id === entry.id)
    ) || nearestTown(state, state.player.pos);
    state.player.moveTarget = copyPosition(destination.pos);
    return;
  }

  if (state.tick < (state.autoplay.nextHuntTick || 0)) {
    state.player.moveTarget = null;
    return;
  }
  const target = nearestBandit(state, state.player.act >= 2 && !state.bandits.some((bandit) => !bandit.elite));
  state.player.moveTarget = target ? copyPosition(target.pos) : null;
  state.autoplay.targetBanditId = target?.id || null;
}

export function setAutoplay(state, enabled = true, options = {}) {
  state.autoplay ||= {
    enabled: false,
    nextHuntTick: 0,
    targetBanditId: null
  };
  state.autoplay.enabled = Boolean(enabled);
  state.autoplay.fullVersion = options.fullVersion === true;
  state.autoplay.patronFactionId ||= options.patronFactionId || "north";
  state.autoplay.origin = options.origin || state.autoplay.origin || CONFIG.AUTOPLAY_F2_ORIGIN;
  state.autoplay.endingChoice = options.endingChoice || state.autoplay.endingChoice || "stop";
  state.autoplay.maxDecisions = Math.max(1, Number(options.maxDecisions) || state.autoplay.maxDecisions || 1);
  if (!state.autoplay.enabled) {
    state.autoplay.targetBanditId = null;
    state.player.moveTarget = null;
  }
  return state.autoplay;
}

function recordActiveTick(state) {
  if (!state.telemetry) return;
  const seconds = CONFIG.LOGIC_MS / 1000;
  state.telemetry.totalActiveSeconds = Number((
    (Number(state.telemetry.totalActiveSeconds) || 0) + seconds
  ).toFixed(3));
}

function eventsSince(state, previousNewestEvent) {
  if (!previousNewestEvent) return state.eventLog.slice();
  const previousIndex = state.eventLog.indexOf(previousNewestEvent);
  return previousIndex < 0 ? state.eventLog.slice() : state.eventLog.slice(0, previousIndex);
}

// Clock-, DOM-, and storage-free. main.js owns scheduling, modal transitions,
// and autosave; the return value exposes the hooks it needs.
export function worldTick(state) {
  if (state.paused) {
    return {
      advanced: false,
      dayAdvanced: false,
      battleResult: null,
      aiBattleResults: [],
      roadEventResult: null,
      progression: progressionHook(state),
      events: []
    };
  }

  const previousNewestEvent = state.eventLog[0] || null;
  initializeLivingWorld(state);

  state.tick += 1;
  recordActiveTick(state);
  snapshotPreviousPositions(state);
  const battleAtTickStart = Boolean(state.battle);

  if (!state.living.aiInitialized) {
    state.living.aiInitialized = true;
    reevaluateAllLords(state);
  }
  autoplayDecision(state);

  if (!state.battle) {
    movePartyToward(state.player, movementSpeed(state, state.player, CONFIG.PLAYER_SPEED));
  }
  const fiefContractResult = processFiefContract(state);
  surfaceTownPriceEffects(state);
  const engagedLordId = state.battle?.enemyKind === "lord" ? state.battle.banditId : null;
  state.lords.forEach((lord) => {
    if (lord.id !== engagedLordId) {
      updateLordMovement(state, lord, movementSpeed(state, lord, CONFIG.LORD_SPEED));
    }
  });

  const engagedBanditId = state.battle && state.battle.enemyKind !== "lord"
    ? state.battle.banditId
    : null;
  state.bandits.slice().forEach((bandit) => {
    if (bandit.id !== engagedBanditId) {
      updateBanditRoam(state, bandit, movementSpeed(state, bandit, CONFIG.BANDIT_SPEED));
    }
  });

  let battleResult = null;
  if (state.battle && state.battlePlayback?.skip) {
    // `skip` is a one-shot resolution latch. The presentation that set it
    // owns the decision not to play the resulting timeline; speed remains a
    // persistent presentation preference.
    battleResult = skipBattle(state);
    state.battlePlayback.skip = false;
  } else if (state.battle && state.tick >= state.battle.nextRoundTick) {
    battleResult = resolveBattleRound(state);
  }
  if (!battleAtTickStart && !state.battle) {
    battleResult = checkForHostileLordEncounter(state) || checkForEncounter(state) || battleResult;
  }
  let battleScriptCheck = null;
  if (
    battleResult &&
    state.autoplay?.enabled &&
    ["victory", "defeat", "fled"].includes(battleResult.type)
  ) {
    battleScriptCheck = validateBattleScript(state.battleScript, {
      casualties: battleResult.resolvedCasualties,
      survivors: battleResult.resolvedSurvivors
    });
    if (!battleScriptCheck.ok) {
      throw new Error(`Autoplay battleScript mismatch: ${battleScriptCheck.errors.join(", ")}`);
    }
    state.autoplay.battleScriptsChecked = Math.max(
      0,
      Number(state.autoplay.battleScriptsChecked) || 0
    ) + 1;
    if (state.autoplay.battleScriptsChecked !== state.stats.battles) {
      throw new Error(
        `Autoplay battleScript coverage mismatch: checked ${state.autoplay.battleScriptsChecked}, battles ${state.stats.battles}`
      );
    }
    if (typeof globalThis.document !== "undefined") {
      console.info(
        `[CROWN autoplay] battleScript ${state.autoplay.battleScriptsChecked}/${state.stats.battles}: ok`
      );
    }
  }
  if (battleResult && state.autoplay?.enabled) {
    const catchupActive = (
      state.player.act >= 2 &&
      state.telemetry.totalActiveSeconds >= CONFIG.AUTOPLAY_CATCHUP_START_SECONDS
    );
    const recoveryTicks = catchupActive
      ? CONFIG.AUTOPLAY_CATCHUP_RECOVERY_TICKS
      : state.player.act >= 2
        ? CONFIG.AUTOPLAY_ACT2_RECOVERY_TICKS
        : CONFIG.AUTOPLAY_ACT1_RECOVERY_TICKS;
    state.autoplay.nextHuntTick = state.tick + recoveryTicks;
  }

  const aiBattleResults = resolveAiEncounters(state);
  updateSieges(state);

  if (state.tick % CONFIG.AI_REEVALUATE_TICKS === 0) reevaluateAllLords(state);

  const dayAdvanced = state.tick % CONFIG.TICKS_PER_DAY === 0;
  let dailyEconomyResult = null;
  let dailyContractResult = null;
  let spawnBalance = null;
  let warSpawnResult = null;
  let roadEventResult = null;
  let act3ExpansionResult = null;
  let kingdomDayResult = null;
  if (dayAdvanced) {
    state.stats.days += 1;
    dailyEconomyResult = processDailyEconomy(state);
    dailyContractResult = processDailyContract(state);
    act3ExpansionResult = processAct3Expansion(state);
    kingdomDayResult = processKingdomDay(state);
    if (state.bandits.length < CONFIG.MAX_BANDITS) {
      const spawned = spawnScaledBandit(state);
      spawnBalance = applyCasualSpawnBalance(state, spawned);
    }
    roadEventResult = processDailyRoadEvent(state);
    warSpawnResult = spawnWarDeserters(state);
  }
  // Roll once on the first road tick of a day, not only at the exact day
  // boundary. A player who leaves town just after dawn must still be eligible
  // for that day's card and the three-minute first-event pity.
  if (!roadEventResult?.triggered) roadEventResult = processDailyRoadEvent(state);
  if (state.tick % CONFIG.DIPLOMACY_INTERVAL_TICKS === 0) updateDiplomacy(state);
  ensureEliteBandit(state);

  return {
    advanced: true,
    dayAdvanced,
    battleResult,
    aiBattleResults,
    dailyEconomyResult,
    dailyContractResult,
    fiefContractResult,
    spawnBalance,
    warSpawnResult,
    roadEventResult,
    act3ExpansionResult,
    kingdomDayResult,
    battleScriptCheck,
    progression: progressionHook(state),
    events: eventsSince(state, previousNewestEvent)
  };
}

export function recruitMilitia(state, requestedArm = "spear") {
  if (state.telemetry) state.telemetry.recruitClicks = (state.telemetry.recruitClicks || 0) + 1;
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = activeTown(state);
  if (!town) return { ok: false, reason: "outsideTown" };
  const arm = state.features?.f3 && ARM_IDS.includes(requestedArm) ? requestedArm : null;
  const troops = getTroopCount(state.player);
  const cap = state.player.act >= 3
    ? CONFIG.ACT3_TROOP_CAP
    : state.player.act >= 2
      ? CONFIG.ACT2_TROOP_CAP
      : CONFIG.ACT1_TROOP_CAP;
  if (troops >= cap) return { ok: false, reason: "cap", cap };
  const armPool = arm ? Math.max(0, town.recruitPools?.[arm] || 0) : town.recruitPool;
  const recoveryRecruit = armPool <= 0 && troops < CONFIG.PLAYER_RECOVERY_RECRUIT_FLOOR;
  if (armPool <= 0 && !recoveryRecruit) {
    return { ok: false, reason: "pool", ...(arm ? { arm } : {}) };
  }
  const price = townRecruitPrice(state, town, CONFIG.RECRUIT_COST);
  if (state.player.gold < price.cost) return { ok: false, reason: "gold", cost: price.cost };

  state.player.gold -= price.cost;
  if (!recoveryRecruit) {
    town.recruitPool -= 1;
    if (arm) town.recruitPools[arm] -= 1;
  }
  incrementTroop(state.player, "militia", 1, arm);
  state.stats.peakTroops = Math.max(state.stats.peakTroops || 0, getTroopCount(state.player));
  addEvent(state, "log.recruit", { townId: town.id, cost: price.cost });
  return { ok: true, townId: town.id, cap, recruitPool: town.recruitPool, arm, cost: price.cost, price };
}

export function townRecruitPrice(state, townOrId = null, baseCost = CONFIG.RECRUIT_COST) {
  const town = typeof townOrId === "string"
    ? getTown(state, townOrId)
    : townOrId || activeTown(state);
  if (!town) return { cost: Math.ceil(baseCost), hostile: false, warZone: false, multiplier: 1 };
  const faction = getFaction(state, town.factionId);
  const hostile = (Number(state.player.relations?.[town.factionId]) || 0) < 0;
  const warZone = Boolean(faction?.alive && faction.atWarWith?.some((id) => getFaction(state, id)?.alive));
  const hostileSurcharge = hostile
    ? CONFIG.HOSTILE_TOWN_RECRUIT_PRICE_MULTIPLIER - 1
    : 0;
  const warSurcharge = warZone
    ? CONFIG.WAR_ZONE_RECRUIT_PRICE_MULTIPLIER - 1
    : 0;
  const multiplier = 1 + hostileSurcharge + warSurcharge;
  return {
    cost: Math.ceil(Math.max(0, baseCost) * multiplier),
    hostile,
    warZone,
    multiplier
  };
}

function townSpendGate(state) {
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = activeTown(state);
  if (!town) return { ok: false, reason: "outsideTown" };
  const troops = getTroopCount(state.player);
  const cap = state.player.act >= 2 ? CONFIG.ACT2_TROOP_CAP : CONFIG.ACT1_TROOP_CAP;
  if (troops >= cap) return { ok: false, reason: "cap", cap, town };
  return { ok: true, town, troops, cap };
}

export function replenishVeteran(state) {
  const gate = townSpendGate(state);
  if (!gate.ok) return gate;
  const veteran = state.player.troops.find((stack) => stack.type === "veteran" && stack.count > 0);
  if (!veteran) return { ok: false, reason: "noVeterans" };
  if (gate.town.recruitPool <= 0) return { ok: false, reason: "pool" };
  const price = townRecruitPrice(state, gate.town, CONFIG.VETERAN_REPLENISH_COST);
  if (state.player.gold < price.cost) return { ok: false, reason: "gold", cost: price.cost };

  state.player.gold -= price.cost;
  gate.town.recruitPool -= 1;
  incrementTroop(state.player, "veteran", 1);
  state.stats.peakTroops = Math.max(state.stats.peakTroops || 0, getTroopCount(state.player));
  addEvent(state, "log.veteranReplenished", { townId: gate.town.id, cost: price.cost });
  return {
    ok: true,
    townId: gate.town.id,
    cap: gate.cap,
    recruitPool: gate.town.recruitPool,
    cost: price.cost,
    price,
    preservedXp: veteran.xp
  };
}

export function buyTownBattleBuff(state) {
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = activeTown(state);
  if (!town) return { ok: false, reason: "outsideTown" };
  ensureCasualState(state);
  if (state.casual.nextBattleAttackMultiplier > 1) return { ok: false, reason: "active" };
  if (state.player.gold < CONFIG.TAVERN_ATTACK_BUFF_COST) {
    return { ok: false, reason: "gold", cost: CONFIG.TAVERN_ATTACK_BUFF_COST };
  }
  state.player.gold -= CONFIG.TAVERN_ATTACK_BUFF_COST;
  state.casual.nextBattleAttackMultiplier = 1 + CONFIG.TAVERN_ATTACK_BUFF_BONUS;
  addEvent(state, "log.battleBuffPurchased", {
    townId: town.id,
    cost: CONFIG.TAVERN_ATTACK_BUFF_COST,
    bonus: Math.round(CONFIG.TAVERN_ATTACK_BUFF_BONUS * 100)
  });
  return {
    ok: true,
    townId: town.id,
    cost: CONFIG.TAVERN_ATTACK_BUFF_COST,
    multiplier: state.casual.nextBattleAttackMultiplier
  };
}

export function hireLieutenant(state) {
  if (!isV11State(state)) return { ok: false, reason: "variant" };
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  if (state.player.act < 2 || state.demo?.ended) return { ok: false, reason: "act" };
  const town = activeTown(state);
  if (!town) return { ok: false, reason: "outsideTown" };
  if (state.player.lieutenant) return { ok: false, reason: "occupied" };
  if (state.player.gold < CONFIG.V11_LIEUTENANT_COST) {
    return { ok: false, reason: "gold", cost: CONFIG.V11_LIEUTENANT_COST };
  }
  state.player.gold -= CONFIG.V11_LIEUTENANT_COST;
  state.player.lieutenant = { id: "chen_mang", hiredAtTick: state.tick };
  if (state.telemetry?.lieutenant) {
    state.telemetry.lieutenant.hired = true;
    state.telemetry.lieutenant.hireCount = Math.max(
      0,
      Number(state.telemetry.lieutenant.hireCount) || 0
    ) + 1;
    state.telemetry.lieutenant.firstHiredAt ||= {
      tick: state.tick,
      day: state.stats.days + 1,
      activeSeconds: Number(state.telemetry.totalActiveSeconds) || 0
    };
  }
  addEvent(state, "log.lieutenantHired", {
    lieutenantId: "chen_mang",
    townId: town.id,
    cost: CONFIG.V11_LIEUTENANT_COST
  }, "win");
  return {
    ok: true,
    lieutenant: state.player.lieutenant,
    townId: town.id,
    cost: CONFIG.V11_LIEUTENANT_COST
  };
}

function activeContract(state) {
  return state.player.contract?.active === true ? state.player.contract : null;
}

function warTargetForTown(state, town) {
  const faction = getFaction(state, town.factionId);
  return (faction?.atWarWith || [])
    .map((id) => getFaction(state, id))
    .filter((candidate) => candidate?.alive)
    .sort((first, second) => first.id.localeCompare(second.id))[0] || null;
}

export function getTavernContracts(state, townId = null) {
  if (state.player.act < 2 || state.demo?.ended) return null;
  const town = townId ? getTown(state, townId) : activeTown(state);
  if (!town) return [];
  const faction = getFaction(state, town.factionId);
  if (!faction?.alive) return [];
  const offers = [
    {
      id: `escort:${town.id}`,
      type: "escort",
      factionId: faction.id,
      townId: town.id,
      reward: CONFIG.CONTRACT_ESCORT_REWARD,
      days: CONFIG.CONTRACT_ESCORT_DAYS
    },
    {
      id: `risky:${town.id}`,
      type: "risky",
      factionId: faction.id,
      townId: town.id,
      reward: CONFIG.CONTRACT_RISKY_REWARD,
      payPerBattle: CONFIG.CONTRACT_RISKY_REWARD,
      enemyStrengthMultiplier: CONFIG.CONTRACT_RISKY_ENEMY_STRENGTH_MULTIPLIER,
      failureRenown: CONFIG.CONTRACT_RISKY_FAILURE_RENOWN
    }
  ];
  const target = warTargetForTown(state, town);
  if (target) {
    offers.push({
      id: `war:${faction.id}:${target.id}`,
      type: "war",
      factionId: faction.id,
      targetFactionId: target.id,
      townId: town.id,
      reward: CONFIG.CONTRACT_WAR_REWARD,
      renownReward: CONFIG.CONTRACT_WAR_RENOWN,
      relationPenalty: CONFIG.CONTRACT_WAR_RELATION_PENALTY
        * (state.player.act >= 3 ? CONFIG.FIEF_WAR_RELATION_MULTIPLIER : 1)
    });
  }
  if (state.player.act >= 3 && state.player.fiefs.length) {
    const fief = heldFiefTowns(state).sort((first, second) => first.id.localeCompare(second.id))[0];
    if (fief) {
      offers.push({
        id: `reinforce:${fief.id}`,
        type: "reinforce",
        factionId: state.player.factionId || fief.factionId,
        townId: town.id,
        targetTownId: fief.id,
        targetGarrison: CONFIG.FIEF_REINFORCE_TARGET,
        reward: CONFIG.FIEF_REINFORCE_REWARD
      });
      offers.push({
        id: `patrol:${fief.id}`,
        type: "patrol",
        factionId: state.player.factionId || fief.factionId,
        townId: town.id,
        targetTownId: fief.id,
        requiredTicks: CONFIG.FIEF_PATROL_REQUIRED_TICKS,
        patrolRadius: CONFIG.FIEF_PATROL_RADIUS,
        reward: CONFIG.FIEF_PATROL_REWARD
      });
    }
  }
  return offers;
}

// Compatibility singular: existing callers and saves receive the combat offer.
export function getTavernContract(state, townId = null) {
  const offers = getTavernContracts(state, townId) || [];
  return offers.find((offer) => offer.type === "risky") || offers[0] || null;
}

export function acceptMercenaryContract(state, townId = null, contractId = null) {
  initializeLivingWorld(state);
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = activeTown(state);
  if (!town || (townId && town.id !== townId)) return { ok: false, reason: "outsideTown" };
  if (activeContract(state)) return { ok: false, reason: "active", contract: state.player.contract };
  const offers = getTavernContracts(state, town.id);
  const offer = contractId
    ? offers.find((entry) => entry.id === contractId || entry.type === contractId)
    : getTavernContract(state, town.id);
  if (!offer) return { ok: false, reason: "unavailable" };
  state.player.contract = {
    ...offer,
    active: true,
    acceptedDay: state.stats.days,
    acceptedTick: state.tick,
    battlesWon: 0,
    goldEarned: 0
  };
  if (offer.type === "escort") {
    state.player.contract.daysRemaining = offer.days;
    addEvent(state, "log.escortAccepted", { days: offer.days }, "world");
  } else if (offer.type === "risky") {
    addEvent(state, "log.riskyAccepted", {
      ratio: offer.enemyStrengthMultiplier
    }, "danger");
  } else if (offer.type === "war") {
    const before = Number(state.player.relations[offer.targetFactionId]) || 0;
    state.player.relations[offer.targetFactionId] = clamp(
      before - offer.relationPenalty,
      CONFIG.ROAD_EVENT_RELATION_MIN,
      CONFIG.ROAD_EVENT_RELATION_MAX
    );
    addEvent(state, "log.warContractAccepted", {
      factionId: offer.factionId,
      targetFactionId: offer.targetFactionId,
      relation: offer.relationPenalty
    }, "danger");
  } else if (offer.type === "reinforce") {
    addEvent(state, "log.reinforceAccepted", {
      townId: offer.targetTownId,
      target: offer.targetGarrison,
      reward: offer.reward
    }, "world");
  } else if (offer.type === "patrol") {
    state.player.contract.progressTicks = 0;
    addEvent(state, "log.patrolAccepted", {
      townId: offer.targetTownId,
      reward: offer.reward
    }, "world");
  }
  state.mechanics.contractsAccepted += 1;
  recordChronicleMilestone(state, "firstContract", {
    townId: offer.townId,
    factionId: offer.factionId,
    contractType: offer.type
  });
  return { ok: true, contract: state.player.contract };
}

function deterministicTimestamp(state) {
  return new Date(state.tick * CONFIG.LOGIC_MS).toISOString();
}

function resolveAutoplayModal(state) {
  if (!state.demo?.modal) return false;
  if (state.demo.modal === "roadEvent") {
    chooseRoadEvent(state, CONFIG.AUTOPLAY_ROAD_EVENT_CHOICE_INDEX);
    return true;
  }
  if (state.demo.modal === "onboarding") {
    advanceOnboarding(state);
    return true;
  }
  if (state.demo.modal === "origin") {
    selectOrigin(state, state.autoplay?.origin || CONFIG.AUTOPLAY_F2_ORIGIN);
    return true;
  }
  if (state.demo.modal === "troopPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_TROOP_PROMISE, deterministicTimestamp(state));
    return true;
  }
  if (state.demo.modal === "act2Transition") {
    beginAct2Promise(state);
    return true;
  }
  if (state.demo.modal === "goldPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_GOLD_PROMISE, deterministicTimestamp(state));
    return true;
  }
  if (state.demo.modal === "act3Transition") {
    beginAct3Promise(state);
    return true;
  }
  if (state.demo.modal === "fiefPromise") {
    submitPromise(state, CONFIG.AUTOPLAY_FIEF_PROMISE, deterministicTimestamp(state));
    return true;
  }
  if (state.demo.modal === "fiefThreat") {
    dismissFiefThreat(state);
    return true;
  }
  if (state.demo.modal === "founding") {
    foundKingdom(state);
    return true;
  }
  if (state.demo.modal === "foundingSeal") {
    dismissFoundingSeal(state);
    return true;
  }
  if (state.demo.modal === "kingdomEdict") {
    chooseKingdomEdict(
      state,
      state.autoplay?.endingChoice || "stop",
      deterministicTimestamp(state)
    );
    return true;
  }
  if (state.demo.modal === "formation") {
    const report = state.battle?.formations?.reportedEnemy || "line";
    choosePlayerFormation(state, counterFormation(report));
    return true;
  }
  if (state.demo.modal === "battleCommand") {
    chooseBattleCommand(state, CONFIG.F3_AUTOPLAY_COMMAND);
    return true;
  }
  return false;
}

export function simulateAutoplay(seed = CONFIG.SEED, options = {}) {
  const fullVersion = options.fullVersion === true;
  const v11 = fullVersion || options.v11 === true;
  const roadEventEffectAudit = verifyRoadEventChoiceEffects({ v11 });
  if (!roadEventEffectAudit.ok) {
    throw new Error(`Autoplay road-event effect mismatch: ${JSON.stringify(roadEventEffectAudit.failures)}`);
  }
  const state = createInitialState(seed, {
    startedAt: new Date(0).toISOString(),
    v11,
    fullVersion,
    f2: options.phase2 === true || options.phase3 === true,
    f3: options.phase3 === true
  });
  setAutoplay(state, true, {
    fullVersion,
    patronFactionId: options.patronFactionId || "north",
    origin: options.origin || CONFIG.AUTOPLAY_F2_ORIGIN,
    endingChoice: options.endingChoice || "stop",
    maxDecisions: options.maxDecisions || 1
  });
  initializeLivingWorld(state);
  while (resolveAutoplayModal(state)) {
    // Onboarding and promise steps consume no active simulation time.
  }

  const maximumActiveSeconds = Math.max(
    0,
    Number(options.maxActiveSeconds) || (fullVersion
      ? CONFIG.AUTOPLAY_FULL_MAX_ACTIVE_SECONDS
      : CONFIG.AUTOPLAY_MAX_ACTIVE_SECONDS)
  );
  let firstBattleSeconds = null;
  let firstEventSeconds = null;
  let act2Seconds = null;
  let endingSeconds = null;
  let act3Seconds = null;
  let fiefThreatSeconds = null;
  let foundingSeconds = null;
  let edictSeconds = null;
  let act2BattleCount = null;
  let endingBattleCount = null;
  let resolvedBattleRounds = 0;
  let act2BattleRounds = null;
  let endingBattleRounds = null;
  const resolvedBattleRoundCounts = [];
  let act2BattleRoundCounts = null;
  let battleScriptsChecked = 0;

  while (
    state.telemetry.totalActiveSeconds < maximumActiveSeconds &&
    !state.demo.ended &&
    (!fullVersion || options.phase2 === true || fiefThreatSeconds === null) &&
    !(
      fullVersion &&
      state.autoplay.endingChoice === "continue" &&
      state.kingdom.decisionCount >= state.autoplay.maxDecisions
    )
  ) {
    const burst = Math.max(1, CONFIG.AUTOPLAY_MULTIPLIER);
    for (let index = 0; index < burst && !state.demo.ended; index += 1) {
      const result = worldTick(state);
      if (!result.advanced) {
        if (!resolveAutoplayModal(state)) break;
        continue;
      }
      const activeSeconds = state.telemetry.totalActiveSeconds;
      if (result.battleResult?.battleScript) {
        const roundCount = result.battleResult.battleScript.events
          .filter((event) => event.type === "round_start").length;
        resolvedBattleRounds += roundCount;
        resolvedBattleRoundCounts.push(roundCount);
      }
      if (result.battleScriptCheck?.ok) battleScriptsChecked += 1;
      if (firstBattleSeconds === null && state.stats.battles > 0) firstBattleSeconds = activeSeconds;
      if (firstEventSeconds === null && result.roadEventResult?.triggered) {
        firstEventSeconds = activeSeconds;
      }
      const transition = advanceActIfNeeded(state, deterministicTimestamp(state), {
        demoBuild: !fullVersion
      });
      if (transition?.type === "act2") {
        state.autoplay.nextHuntTick = state.tick + CONFIG.AUTOPLAY_ACT2_RECOVERY_TICKS;
        if (act2Seconds === null) act2Seconds = activeSeconds;
        if (act2BattleCount === null) act2BattleCount = state.stats.battles;
        if (act2BattleRounds === null) act2BattleRounds = resolvedBattleRounds;
        if (act2BattleRoundCounts === null) act2BattleRoundCounts = resolvedBattleRoundCounts.slice();
      }
      if (transition?.type === "ending") {
        endingSeconds = activeSeconds;
        endingBattleCount = state.stats.battles;
        endingBattleRounds = resolvedBattleRounds;
      }
      if (transition?.type === "act3" && act3Seconds === null) act3Seconds = activeSeconds;
      if (transition?.type === "founding" && foundingSeconds === null) foundingSeconds = activeSeconds;
      if (state.telemetry.chronicle.fiefThreat && fiefThreatSeconds === null) {
        fiefThreatSeconds = state.telemetry.chronicle.fiefThreat.activeSeconds;
      }
      while (resolveAutoplayModal(state)) {
        // Resolve the Act 2 promise before advancing more ticks.
      }
      if (state.kingdom.founded && foundingSeconds === null) foundingSeconds = activeSeconds;
      if (state.kingdom.decisionCount > 0 && edictSeconds === null) edictSeconds = activeSeconds;
      if (state.telemetry.totalActiveSeconds >= maximumActiveSeconds) break;
    }
  }

  if (state.demo.ended && endingSeconds === null) endingSeconds = state.telemetry.totalActiveSeconds;
  if ((state.demo.ended || fullVersion) && battleScriptsChecked !== state.stats.battles) {
    throw new Error(
      `Autoplay battleScript coverage mismatch: checked ${battleScriptsChecked}, battles ${state.stats.battles}`
    );
  }
  return {
    state,
    variant: fullVersion ? "full" : v11 ? "1.1" : "1.0",
    firstBattleSeconds,
    firstEventSeconds,
    act2Seconds,
    endingSeconds,
    act3Seconds,
    fiefThreatSeconds,
    foundingSeconds,
    edictSeconds,
    endingPath: state.kingdom.endingPath,
    kingdomDecisions: state.kingdom.decisionCount,
    fiefThreatDelaySeconds: act3Seconds === null || fiefThreatSeconds === null
      ? null
      : fiefThreatSeconds - act3Seconds,
    act2BattleCount,
    endingBattleCount: endingBattleCount ?? (state.demo.ended ? state.stats.battles : null),
    act2BattleRounds,
    endingBattleRounds: endingBattleRounds ?? (state.demo.ended ? resolvedBattleRounds : null),
    act2BattleRoundCounts,
    endingBattleRoundCounts: state.demo.ended ? resolvedBattleRoundCounts.slice() : null,
    battleScriptsChecked,
    roadEventChoicesChecked: roadEventEffectAudit.choicesChecked,
    activeSeconds: state.telemetry.totalActiveSeconds,
    targets: {
      firstBattleMax: CONFIG.AUTOPLAY_FIRST_BATTLE_TARGET_SECONDS,
      firstEventMax: CONFIG.ROAD_FIRST_EVENT_TARGET_SECONDS,
      act2Min: CONFIG.AUTOPLAY_ACT2_TARGET_MIN_SECONDS,
      act2Max: CONFIG.AUTOPLAY_ACT2_TARGET_MAX_SECONDS,
      endingMin: CONFIG.AUTOPLAY_END_TARGET_MIN_SECONDS,
      endingMax: CONFIG.AUTOPLAY_END_TARGET_MAX_SECONDS,
      act3Min: CONFIG.AUTOPLAY_ACT3_TARGET_MIN_SECONDS,
      act3Max: CONFIG.AUTOPLAY_ACT3_TARGET_MAX_SECONDS,
      fiefThreatMax: CONFIG.AUTOPLAY_FIEF_THREAT_MAX_SECONDS
    }
  };
}

export const runAutoplay = simulateAutoplay;

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
  resolveAiBattle,
  resolveBattleRound
} from "./battle.js";
import {
  applyCasualSpawnBalance,
  chooseRoadEvent as applyRoadEventChoice,
  ensureCasualState,
  getActiveRoadEvent,
  processDailyRoadEvent as rollDailyRoadEvent
} from "./casual.js";
import { CONFIG, TROOP_TYPES } from "./data.js";
import {
  advanceActIfNeeded,
  advanceOnboarding,
  beginAct2Promise,
  submitPromise
} from "./demo.js";
import {
  ensureEliteBandit,
  ensureLivingState,
  spawnScaledBandit
} from "./living.js";
import { nextFloat, randomInt } from "./rng.js";
import { buildRoads, isOnRoad } from "./roads.js";
import {
  activeTown,
  addEvent,
  clamp,
  copyPosition,
  createInitialState,
  distance,
  getFaction,
  getPartyStrength,
  getTown,
  getTroopCount,
  incrementTroop,
  nearestTown
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
      town.garrison = [{ type: "militia", count: CONFIG.TOWN_START_GARRISON, xp: 0 }];
    }
    town.recruitPool = clamp(
      Number.isFinite(town.recruitPool) ? town.recruitPool : CONFIG.TOWN_START_RECRUIT_POOL,
      0,
      CONFIG.TOWN_RECRUIT_POOL_CAP
    );
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
  return true;
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

  if (CONFIG.DEMO && !state.living.demoWarSeeded) {
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
    const drift = nextFloat(state.rng) < 0.5
      ? -CONFIG.DIPLOMACY_RELATION_DRIFT
      : CONFIG.DIPLOMACY_RELATION_DRIFT;
    const relation = (Number(first.relations[second.id]) || 0) + drift;
    setRelation(first, second, relation);
    if (!first.atWarWith.includes(second.id)) {
      if (
        relation < CONFIG.WAR_RELATION_THRESHOLD &&
        nextFloat(state.rng) < CONFIG.WAR_DECLARATION_CHANCE
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
  handleFactionEliminations(state);
}

function dailyWage(party) {
  return party.troops.reduce((total, stack) => {
    return total + (TROOP_TYPES[stack.type]?.wage || 0) * stack.count;
  }, 0);
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
  const playerWage = wagesStarted
    ? payWage(state.player)
    : { due: dailyWage(state.player), paid: 0, unpaid: 0, deferred: true };
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
      town.recruitPool = Math.min(
        CONFIG.TOWN_RECRUIT_POOL_CAP,
        town.recruitPool + CONFIG.TOWN_RECRUIT_GAIN
      );
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
  town.factionId = attacker.factionId;
  town.prosperity = clamp(
    town.prosperity - CONFIG.TOWN_CAPTURE_PROSPERITY_LOSS,
    CONFIG.TOWN_MIN_PROSPERITY,
    CONFIG.TOWN_MAX_PROSPERITY
  );
  town.garrison = [{ type: "militia", count: CONFIG.TOWN_CAPTURE_GARRISON, xp: 0 }];
  resetSiege(state, town, false);
  state.mechanics.townsCaptured += 1;
  addEvent(state, "log.townCaptured", {
    townId: town.id,
    oldFactionId,
    newFactionId: attacker.factionId,
    factionId: attacker.factionId,
    lordId: attacker.id
  }, "danger");
  handleFactionEliminations(state);
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

function updateSieges(state) {
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
  const engagedBanditId = state.battle?.banditId || null;
  const pairs = [];
  const availableLords = state.lords.filter((lord) => (lord.defeatedUntilTick || 0) <= state.tick);

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
  return baseSpeed * (isOnRoad(roads, party.pos.x, party.pos.y)
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
  const troopCap = state.player.act >= 2 ? CONFIG.ACT2_TROOP_CAP : CONFIG.ACT1_TROOP_CAP;
  const troops = getTroopCount(state.player);

  if (state.player.act >= 2 && !state.player.contract) {
    if (town) acceptMercenaryContract(state, town.id);
    else {
      const destination = nearestTown(state, state.player.pos);
      state.player.moveTarget = copyPosition(destination.pos);
      return;
    }
  }

  const canRecruitHere = Boolean(
    town &&
    troops < troopCap &&
    state.player.gold - CONFIG.RECRUIT_COST >= CONFIG.AUTOPLAY_GOLD_RESERVE &&
    town.recruitPool > 0
  );
  if (canRecruitHere) {
    state.player.moveTarget = null;
    if (state.tick % CONFIG.AUTOPLAY_REEVALUATE_TICKS === 0) recruitMilitia(state);
    return;
  }

  if (
    troops < troopCap * CONFIG.AUTOPLAY_RETREAT_TROOP_RATIO &&
    state.player.gold >= CONFIG.RECRUIT_COST &&
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

export function setAutoplay(state, enabled = true) {
  state.autoplay ||= {
    enabled: false,
    nextHuntTick: 0,
    targetBanditId: null
  };
  state.autoplay.enabled = Boolean(enabled);
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
  state.lords.forEach((lord) => {
    updateLordMovement(state, lord, movementSpeed(state, lord, CONFIG.LORD_SPEED));
  });

  const engagedBanditId = state.battle?.banditId || null;
  state.bandits.slice().forEach((bandit) => {
    if (bandit.id !== engagedBanditId) {
      updateBanditRoam(state, bandit, movementSpeed(state, bandit, CONFIG.BANDIT_SPEED));
    }
  });

  let battleResult = null;
  if (state.battle && state.tick >= state.battle.nextRoundTick) {
    battleResult = resolveBattleRound(state);
  }
  if (!battleAtTickStart && !state.battle) {
    battleResult = checkForEncounter(state) || battleResult;
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
  let spawnBalance = null;
  let roadEventResult = null;
  if (dayAdvanced) {
    state.stats.days += 1;
    dailyEconomyResult = processDailyEconomy(state);
    if (state.bandits.length < CONFIG.MAX_BANDITS) {
      const spawned = spawnScaledBandit(state);
      spawnBalance = applyCasualSpawnBalance(state, spawned);
    }
    roadEventResult = processDailyRoadEvent(state);
  }
  if (state.tick % CONFIG.DIPLOMACY_INTERVAL_TICKS === 0) updateDiplomacy(state);
  ensureEliteBandit(state);

  return {
    advanced: true,
    dayAdvanced,
    battleResult,
    aiBattleResults,
    dailyEconomyResult,
    spawnBalance,
    roadEventResult,
    progression: progressionHook(state),
    events: eventsSince(state, previousNewestEvent)
  };
}

export function recruitMilitia(state) {
  if (state.telemetry) state.telemetry.recruitClicks = (state.telemetry.recruitClicks || 0) + 1;
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = activeTown(state);
  if (!town) return { ok: false, reason: "outsideTown" };
  const cap = state.player.act >= 2 ? CONFIG.ACT2_TROOP_CAP : CONFIG.ACT1_TROOP_CAP;
  if (getTroopCount(state.player) >= cap) return { ok: false, reason: "cap", cap };
  if (town.recruitPool <= 0) return { ok: false, reason: "pool" };
  if (state.player.gold < CONFIG.RECRUIT_COST) return { ok: false, reason: "gold" };

  state.player.gold -= CONFIG.RECRUIT_COST;
  town.recruitPool -= 1;
  incrementTroop(state.player, "militia", 1);
  state.stats.peakTroops = Math.max(state.stats.peakTroops || 0, getTroopCount(state.player));
  addEvent(state, "log.recruit", { townId: town.id, cost: CONFIG.RECRUIT_COST });
  return { ok: true, townId: town.id, cap, recruitPool: town.recruitPool };
}

export function getTavernContract(state, townId = null) {
  if (state.player.act < 2 || state.demo?.ended) return null;
  const town = townId ? getTown(state, townId) : activeTown(state);
  if (!town) return null;
  const faction = getFaction(state, town.factionId);
  if (!faction?.alive) return null;
  return {
    id: `mercenary:${faction.id}`,
    type: "mercenary",
    factionId: faction.id,
    townId: town.id,
    payPerBattle: CONFIG.MERCENARY_PAY_PER_BATTLE,
    reward: CONFIG.MERCENARY_PAY_PER_BATTLE
  };
}

export function acceptMercenaryContract(state, townId = null) {
  initializeLivingWorld(state);
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = activeTown(state);
  if (!town || (townId && town.id !== townId)) return { ok: false, reason: "outsideTown" };
  const offer = getTavernContract(state, town.id);
  if (!offer) return { ok: false, reason: "unavailable" };
  state.player.contract = {
    ...offer,
    active: true,
    acceptedDay: state.stats.days,
    acceptedTick: state.tick,
    battlesWon: 0,
    goldEarned: 0
  };
  state.mechanics.contractsAccepted += 1;
  addEvent(state, "log.contractAccepted", {
    contractId: offer.id,
    factionId: offer.factionId,
    townId: offer.townId,
    payPerBattle: offer.payPerBattle,
    reward: offer.reward
  }, "win");
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
  return false;
}

export function simulateAutoplay(seed = CONFIG.SEED, options = {}) {
  const state = createInitialState(seed, { startedAt: new Date(0).toISOString() });
  initializeLivingWorld(state);
  setAutoplay(state, true);
  while (resolveAutoplayModal(state)) {
    // Onboarding and promise steps consume no active simulation time.
  }

  const maximumActiveSeconds = Math.max(
    0,
    Number(options.maxActiveSeconds) || CONFIG.AUTOPLAY_MAX_ACTIVE_SECONDS
  );
  let firstBattleSeconds = null;
  let firstEventSeconds = null;
  let act2Seconds = null;
  let endingSeconds = null;

  while (state.telemetry.totalActiveSeconds < maximumActiveSeconds && !state.demo.ended) {
    const burst = Math.max(1, CONFIG.AUTOPLAY_MULTIPLIER);
    for (let index = 0; index < burst && !state.demo.ended; index += 1) {
      const result = worldTick(state);
      if (!result.advanced) {
        if (!resolveAutoplayModal(state)) break;
        continue;
      }
      const activeSeconds = state.telemetry.totalActiveSeconds;
      if (firstBattleSeconds === null && state.stats.battles > 0) firstBattleSeconds = activeSeconds;
      if (firstEventSeconds === null && result.roadEventResult?.triggered) {
        firstEventSeconds = activeSeconds;
      }
      const transition = advanceActIfNeeded(state, deterministicTimestamp(state));
      if (transition?.type === "act2" && act2Seconds === null) act2Seconds = activeSeconds;
      if (transition?.type === "ending") endingSeconds = activeSeconds;
      while (resolveAutoplayModal(state)) {
        // Resolve the Act 2 promise before advancing more ticks.
      }
      if (state.telemetry.totalActiveSeconds >= maximumActiveSeconds) break;
    }
  }

  if (state.demo.ended && endingSeconds === null) endingSeconds = state.telemetry.totalActiveSeconds;
  return {
    state,
    firstBattleSeconds,
    firstEventSeconds,
    act2Seconds,
    endingSeconds,
    activeSeconds: state.telemetry.totalActiveSeconds,
    targets: {
      firstBattleMax: CONFIG.AUTOPLAY_FIRST_BATTLE_TARGET_SECONDS,
      firstEventMax: CONFIG.ROAD_FIRST_EVENT_TARGET_SECONDS,
      act2Min: CONFIG.AUTOPLAY_ACT2_TARGET_MIN_SECONDS,
      act2Max: CONFIG.AUTOPLAY_ACT2_TARGET_MAX_SECONDS,
      endingMin: CONFIG.AUTOPLAY_END_TARGET_MIN_SECONDS,
      endingMax: CONFIG.AUTOPLAY_END_TARGET_MAX_SECONDS
    }
  };
}

export const runAutoplay = simulateAutoplay;

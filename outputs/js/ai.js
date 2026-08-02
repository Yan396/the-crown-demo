import { CONFIG, TROOP_TYPES } from "./data.js";
import { nextFloat } from "./rng.js";
import { buildRoads, nextRoadWaypoint, ROAD_CONFIG } from "./roads.js";
import {
  addEvent,
  clamp,
  copyPosition,
  distance,
  getFaction,
  getPartyStrength,
  getTown,
  getTroopCount,
  incrementTroop
} from "./state.js";

export function movePartyToward(party, speed) {
  if (!party.moveTarget) return false;
  const dx = party.moveTarget.x - party.pos.x;
  const dy = party.moveTarget.y - party.pos.y;
  const remaining = Math.hypot(dx, dy);

  if (remaining <= speed || remaining <= CONFIG.ARRIVAL_RADIUS) {
    party.pos.x = party.moveTarget.x;
    party.pos.y = party.moveTarget.y;
    party.moveTarget = null;
    return true;
  }

  party.pos.x = clamp(party.pos.x + (dx / remaining) * speed, 0, CONFIG.WORLD_SIZE);
  party.pos.y = clamp(party.pos.y + (dy / remaining) * speed, 0, CONFIG.WORLD_SIZE);
  return false;
}

export function factionsAreHostile(state, firstFactionId, secondFactionId) {
  if (!firstFactionId || !secondFactionId || firstFactionId === secondFactionId) return false;
  const first = getFaction(state, firstFactionId);
  return Boolean(first?.atWarWith?.includes(secondFactionId));
}

function ownTowns(state, lord) {
  return state.towns.filter((town) => town.factionId === lord.factionId);
}

function nearestByPosition(items, position, positionOf = (item) => item.pos) {
  return items.reduce((nearest, item) => {
    if (!nearest) return item;
    const itemDistance = distance(position, positionOf(item));
    const nearestDistance = distance(position, positionOf(nearest));
    if (itemDistance !== nearestDistance) return itemDistance < nearestDistance ? item : nearest;
    return String(item.id).localeCompare(String(nearest.id)) < 0 ? item : nearest;
  }, null);
}

export function getGarrisonStrength(town) {
  return (town.garrison || []).reduce((sum, stack) => {
    return sum + (TROOP_TYPES[stack.type]?.atk || 0) * stack.count;
  }, 0);
}

export function hostilePartiesNear(state, lord, radius = CONFIG.LORD_ENEMY_SCAN_RADIUS) {
  const hostileLords = state.lords
    .filter((other) => (
      other.id !== lord.id &&
      (!other.defeatedUntilTick || other.defeatedUntilTick <= state.tick) &&
      factionsAreHostile(state, lord.factionId, other.factionId)
    ))
    .map((party) => ({ kind: "lord", party }));
  const hostileBandits = state.bandits.map((party) => ({ kind: "bandit", party }));

  return [...hostileLords, ...hostileBandits]
    .map((entry) => ({ ...entry, separation: distance(lord.pos, entry.party.pos) }))
    .filter((entry) => entry.separation <= radius)
    .sort((first, second) => (
      first.separation - second.separation || first.party.id.localeCompare(second.party.id)
    ));
}

function setLordIntent(lord, aiState, target, targetKind) {
  lord.aiState = aiState;
  lord.targetId = target?.id || null;
  lord.targetKind = targetKind || null;
  lord.moveTarget = target ? copyPosition(target.pos) : null;
  lord.aiStateSinceTick ??= 0;
}

function refreshPatrolRoute(state, lord) {
  const towns = ownTowns(state, lord).sort((first, second) => first.id.localeCompare(second.id));
  lord.patrolTownIds = towns.slice(0, 2).map((town) => town.id);
  if (!lord.patrolTownIds.length) {
    lord.patrolIndex = 0;
    return null;
  }
  lord.patrolIndex = clamp(lord.patrolIndex || 0, 0, lord.patrolTownIds.length - 1);
  return getTown(state, lord.patrolTownIds[lord.patrolIndex]);
}

function chooseNextPatrolTown(state, lord) {
  const validIds = (lord.patrolTownIds || []).filter((id) => getTown(state, id)?.factionId === lord.factionId);
  if (!validIds.length || validIds.length !== lord.patrolTownIds.length) refreshPatrolRoute(state, lord);
  if (!lord.patrolTownIds.length) return null;
  lord.patrolIndex = lord.patrolTownIds.length === 1
    ? 0
    : ((lord.patrolIndex || 0) + 1) % lord.patrolTownIds.length;
  return getTown(state, lord.patrolTownIds[lord.patrolIndex]);
}

function setPatrolIntent(state, lord) {
  let target = chooseNextPatrolTown(state, lord);
  if (!target) target = refreshPatrolRoute(state, lord);
  setLordIntent(lord, "patrol", target, "town");
}

function nearestOwnTown(state, lord) {
  return nearestByPosition(ownTowns(state, lord), lord.pos);
}

function nearestBesiegedOwnTown(state, lord) {
  return nearestByPosition(
    ownTowns(state, lord).filter((town) => (
      town.underSiege && town.siege && town.siege.attackerFactionId !== lord.factionId
    )),
    lord.pos
  );
}

function eligibleSiegeTargets(state, lord) {
  const strength = getPartyStrength(lord);
  return state.towns.filter((town) => (
    factionsAreHostile(state, lord.factionId, town.factionId) &&
    strength >= Math.max(1, getGarrisonStrength(town)) *
      CONFIG.SIEGE_STRENGTH_RATIO * CONFIG.TOWN_DEFENDER_TERRAIN
  ));
}

function ensureLordFields(lord) {
  lord.targetKind ||= lord.targetId ? "town" : null;
  lord.aiState ||= "patrol";
  lord.aiStateSinceTick ??= 0;
  lord.defeatedUntilTick ??= lord.defeatedUntil || 0;
  lord.defeatedUntil = lord.defeatedUntilTick;
  lord.playerPursuitCooldownUntil ??= 0;
}

// Implements the ordered Phase 2 state machine and adds a strategic town target
// only when the normal party/defense branches do not apply.
export function reevaluateLordAi(state, lord) {
  ensureLordFields(lord);
  if (lord.defeatedUntilTick > state.tick) return lord.aiState;
  const previousState = lord.aiState;
  const troopCount = getTroopCount(lord);
  const ownTown = nearestOwnTown(state, lord);
  const playerRelation = Number(state.player.relations?.[lord.factionId]) || 0;
  const hostilePlayer = state.player.act >= 2 && playerRelation < 0 &&
    (lord.playerPursuitCooldownUntil || 0) <= state.tick &&
    distance(lord.pos, state.player.pos) <= CONFIG.HOSTILE_LORD_PLAYER_SCAN_RADIUS;

  if (hostilePlayer) {
    const alreadyPursuing = lord.aiState === "attack" && lord.targetKind === "player";
    setLordIntent(lord, "attack", { id: "player", pos: state.player.pos }, "player");
    if (!alreadyPursuing) {
      addEvent(state, "log.hostileLordPursuit", {
        lordId: lord.id,
        factionId: lord.factionId
      }, "danger");
    }
    if (lord.aiState !== previousState) lord.aiStateSinceTick = state.tick;
    return lord.aiState;
  }

  if (
    troopCount < CONFIG.LORD_TROOP_CAP * CONFIG.LORD_RECRUIT_THRESHOLD_RATIO &&
    lord.gold > CONFIG.LORD_RECRUIT_MIN_GOLD &&
    ownTown
  ) {
    setLordIntent(lord, "recruit", ownTown, "town");
  } else {
    const activeSiegeTown = state.towns.find((town) => (
      town.underSiege &&
      town.siegeAttackerId === lord.id &&
      town.factionId !== lord.factionId &&
      factionsAreHostile(state, lord.factionId, town.factionId) &&
      getPartyStrength(lord) >= Math.max(1, getGarrisonStrength(town)) *
        CONFIG.SIEGE_STRENGTH_RATIO * CONFIG.TOWN_DEFENDER_TERRAIN
    ));
    if (activeSiegeTown) {
      setLordIntent(lord, "attack", activeSiegeTown, "town");
      if (lord.aiState !== previousState) lord.aiStateSinceTick = state.tick;
      return lord.aiState;
    }
    const nearby = hostilePartiesNear(state, lord);
    const enemy = nearby[0] || null;
    const ownStrength = Math.max(1, getPartyStrength(lord));
    const enemyStrength = enemy ? Math.max(1, getPartyStrength(enemy.party)) : 1;
    const strengthRatio = ownStrength / enemyStrength;
    const attackThreshold = CONFIG.LORD_ATTACK_RATIO_BASE + (
      lord.personality * CONFIG.LORD_ATTACK_PERSONALITY_SCALE
    );

    if (enemy && strengthRatio > attackThreshold) {
      setLordIntent(lord, "attack", enemy.party, enemy.kind);
    } else if (enemy && strengthRatio < CONFIG.LORD_FLEE_RATIO && ownTown) {
      setLordIntent(lord, "flee", ownTown, "town");
    } else {
      const threatenedTown = nearestBesiegedOwnTown(state, lord);
      if (threatenedTown) {
        setLordIntent(lord, "defend", threatenedTown, "town");
      } else {
        // Faction-wide stable ordering concentrates an army on one objective
        // instead of spreading four lords across both enemy towns forever.
        const siegeTarget = eligibleSiegeTargets(state, lord)
          .sort((first, second) => first.id.localeCompare(second.id))[0] || null;
        const faction = getFaction(state, lord.factionId);
        if (siegeTarget && (CONFIG.DEMO || nextFloat(state.rng) < (faction?.aggression || 0))) {
          setLordIntent(lord, "attack", siegeTarget, "town");
        } else {
          setPatrolIntent(state, lord);
        }
      }
    }
  }

  if (lord.aiState !== previousState) lord.aiStateSinceTick = state.tick;
  return lord.aiState;
}

export function reevaluateAllLords(state) {
  state.lords
    .slice()
    .sort((first, second) => first.id.localeCompare(second.id))
    .forEach((lord) => reevaluateLordAi(state, lord));
}

function recruitLordAtTown(state, lord, town) {
  if (!town || town.factionId !== lord.factionId || town.recruitPool <= 0) return 0;
  const current = getTroopCount(lord);
  const capacity = Math.max(0, CONFIG.LORD_TROOP_CAP - current);
  const affordable = Math.max(0, Math.floor(
    (lord.gold - CONFIG.LORD_RECRUIT_GOLD_RESERVE) / TROOP_TYPES.militia.cost
  ));
  const playerReserve = Math.max(0, CONFIG.PLAYER_TOWN_RECRUIT_RESERVE);
  const availableToLord = Math.max(0, town.recruitPool - playerReserve);
  const quantity = Math.min(capacity, availableToLord, affordable);
  if (quantity <= 0) return 0;
  incrementTroop(lord, "militia", quantity);
  town.recruitPool -= quantity;
  lord.gold -= quantity * TROOP_TYPES.militia.cost;
  addEvent(state, "log.lordRecruited", {
    lordId: lord.id,
    townId: town.id,
    count: quantity
  });
  return quantity;
}

function resolveDynamicTarget(state, lord) {
  if (lord.targetKind === "lord") return state.lords.find((party) => party.id === lord.targetId) || null;
  if (lord.targetKind === "bandit") return state.bandits.find((party) => party.id === lord.targetId) || null;
  if (lord.targetKind === "town") return getTown(state, lord.targetId);
  if (lord.targetKind === "player") return state.player;
  return null;
}

function moveLordTowardTownOnRoad(state, lord, town, speed) {
  const roads = buildRoads(state.seed);
  let remainingSpeed = Math.max(0, speed);
  // A tick normally crosses at most one point, but consuming the remaining
  // budget keeps x1.2/x0.85 as real movement speeds even near short segments.
  const maximumHops = roads.reduce((sum, road) => sum + road.points.length, 1);

  for (let hop = 0; hop < maximumHops; hop += 1) {
    const finalDx = town.pos.x - lord.pos.x;
    const finalDy = town.pos.y - lord.pos.y;
    const finalGap = Math.hypot(finalDx, finalDy);
    if (finalGap <= remainingSpeed || finalGap <= CONFIG.ARRIVAL_RADIUS) {
      lord.pos.x = town.pos.x;
      lord.pos.y = town.pos.y;
      lord.moveTarget = null;
      return true;
    }

    const waypoint = nextRoadWaypoint(roads, lord.pos, town.id);
    if (!waypoint) {
      // A disconnected or malformed network must not strand the AI.
      lord.moveTarget = copyPosition(town.pos);
      return movePartyToward(lord, remainingSpeed);
    }
    lord.moveTarget = copyPosition(waypoint);
    const dx = waypoint.x - lord.pos.x;
    const dy = waypoint.y - lord.pos.y;
    const gap = Math.hypot(dx, dy);
    if (gap <= ROAD_CONFIG.NAV_EPSILON) continue;
    if (gap <= remainingSpeed) {
      lord.pos.x = waypoint.x;
      lord.pos.y = waypoint.y;
      remainingSpeed -= gap;
      if (remainingSpeed <= ROAD_CONFIG.NAV_EPSILON) return false;
      continue;
    }

    lord.pos.x = clamp(lord.pos.x + (dx / gap) * remainingSpeed, 0, CONFIG.WORLD_SIZE);
    lord.pos.y = clamp(lord.pos.y + (dy / gap) * remainingSpeed, 0, CONFIG.WORLD_SIZE);
    return false;
  }

  // Defensive fallback for degenerate zero-length polylines.
  lord.moveTarget = copyPosition(town.pos);
  return movePartyToward(lord, remainingSpeed);
}

export function updateLordMovement(state, lord, speed = CONFIG.LORD_SPEED) {
  ensureLordFields(lord);
  if (lord.defeatedUntilTick > state.tick) return false;
  let target = resolveDynamicTarget(state, lord);
  if (!target && lord.aiState !== "patrol") {
    reevaluateLordAi(state, lord);
    target = resolveDynamicTarget(state, lord);
  }

  let arrived = false;
  if (target && lord.targetKind === "town" && CONFIG.ROAD_MOVEMENT) {
    arrived = moveLordTowardTownOnRoad(state, lord, target, speed);
  } else {
    if (target) lord.moveTarget = copyPosition(target.pos);
    arrived = movePartyToward(lord, speed);
  }
  if (!arrived) return false;

  if (lord.aiState === "recruit") {
    recruitLordAtTown(state, lord, getTown(state, lord.targetId));
  } else if (lord.aiState === "patrol") {
    const nextTown = chooseNextPatrolTown(state, lord);
    if (nextTown) {
      lord.targetId = nextTown.id;
      lord.targetKind = "town";
      lord.moveTarget = copyPosition(nextTown.pos);
    }
  }
  return true;
}

// Preserved Phase 1 API; Phase 2 callers should prefer updateLordMovement.
export function updateLordPatrol(state, lord, speed = CONFIG.LORD_SPEED) {
  if (lord.aiState !== "patrol") setPatrolIntent(state, lord);
  return updateLordMovement(state, lord, speed);
}

export function updateBanditRoam(state, bandit, speed = CONFIG.BANDIT_SPEED) {
  if (movePartyToward(bandit, speed)) {
    const angle = nextFloat(state.rng) * Math.PI * 2;
    const range = CONFIG.BANDIT_ROAM_MIN + nextFloat(state.rng) * (
      CONFIG.BANDIT_ROAM_MAX - CONFIG.BANDIT_ROAM_MIN
    );
    bandit.moveTarget = {
      x: clamp(bandit.pos.x + Math.cos(angle) * range, CONFIG.BANDIT_WORLD_MARGIN, CONFIG.WORLD_SIZE - CONFIG.BANDIT_WORLD_MARGIN),
      y: clamp(bandit.pos.y + Math.sin(angle) * range, CONFIG.BANDIT_WORLD_MARGIN, CONFIG.WORLD_SIZE - CONFIG.BANDIT_WORLD_MARGIN)
    };
  }
}

export const evaluateLordAI = reevaluateLordAi;
export const reevaluateLordAI = reevaluateLordAi;

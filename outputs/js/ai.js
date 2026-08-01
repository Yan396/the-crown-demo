import { CONFIG } from "./data.js";
import { buildRoads, findRoad, isOnRoad } from "./roads.js";
import { assignBanditMoveTarget, clamp, copyPosition, getTown } from "./state.js";

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

// Roads are faster than open country. Free-moving parties (player, bandits) are
// tested against the network each tick; lords are always on a road by
// construction, so they always take the bonus.
export function terrainSpeed(state, party, baseSpeed) {
  if (!CONFIG.ROAD_MOVEMENT) return baseSpeed;
  const roads = buildRoads(state.seed);
  const onRoad = isOnRoad(roads, party.pos.x, party.pos.y);
  return baseSpeed * (onRoad ? CONFIG.ROAD_SPEED_MULTIPLIER : CONFIG.OFF_ROAD_SPEED_MULTIPLIER);
}

// Walking direction along a road's point array: forward when the destination is
// the road's second town, backward when it is the first.
function routeFor(state, lord) {
  const roads = buildRoads(state.seed);
  const destinationId = lord.patrolTownIds[lord.patrolIndex];
  const originId = lord.patrolTownIds[lord.patrolIndex === 0 ? 1 : 0];
  const road = findRoad(roads, originId, destinationId);
  if (!road) return null;
  return { road, forward: road.townIds[1] === destinationId };
}

function waypointAt(route, index) {
  const { road, forward } = route;
  const count = road.points.length;
  const resolved = forward ? index : count - 1 - index;
  if (resolved < 0 || resolved >= count) return null;
  return road.points[resolved];
}

// Saves written before road movement have no waypoint, so derive one from where
// the lord currently stands rather than snapping it back to a town.
function nearestWaypointIndex(route, position) {
  const count = route.road.points.length;
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < count; index += 1) {
    const point = waypointAt(route, index);
    const gap = Math.hypot(point.x - position.x, point.y - position.y);
    if (gap < bestDistance) {
      bestDistance = gap;
      best = index;
    }
  }
  return Math.min(count - 1, best + 1);
}

function turnAround(state, lord) {
  lord.patrolIndex = lord.patrolIndex === 0 ? 1 : 0;
  const nextTown = getTown(state, lord.patrolTownIds[lord.patrolIndex]);
  lord.targetId = nextTown.id;
  lord.aiState = "patrol";
  lord.roadWaypoint = 1;
  const route = routeFor(state, lord);
  lord.moveTarget = route
    ? copyPosition(waypointAt(route, 1) || nextTown.pos)
    : copyPosition(nextTown.pos);
}

export function updateLordPatrol(state, lord) {
  const route = CONFIG.ROAD_MOVEMENT ? routeFor(state, lord) : null;

  // No road between the patrol pair: fall back to the straight-line march.
  if (!route) {
    if (!movePartyToward(lord, CONFIG.LORD_SPEED)) return;
    lord.patrolIndex = lord.patrolIndex === 0 ? 1 : 0;
    const nextTown = getTown(state, lord.patrolTownIds[lord.patrolIndex]);
    lord.moveTarget = copyPosition(nextTown.pos);
    lord.targetId = nextTown.id;
    lord.aiState = "patrol";
    return;
  }

  if (!Number.isInteger(lord.roadWaypoint)) {
    lord.roadWaypoint = nearestWaypointIndex(route, lord.pos);
  }
  if (!lord.moveTarget) {
    const point = waypointAt(route, lord.roadWaypoint);
    lord.moveTarget = copyPosition(point || getTown(state, lord.targetId).pos);
  }

  const speed = CONFIG.LORD_SPEED * CONFIG.ROAD_SPEED_MULTIPLIER;
  if (!movePartyToward(lord, speed)) return;

  // Reached a waypoint: step to the next one, or turn around at the far town.
  const next = lord.roadWaypoint + 1;
  const point = waypointAt(route, next);
  if (!point) {
    turnAround(state, lord);
    return;
  }
  lord.roadWaypoint = next;
  lord.moveTarget = copyPosition(point);
}

export function updateBanditRoam(state, bandit) {
  if (movePartyToward(bandit, terrainSpeed(state, bandit, CONFIG.BANDIT_SPEED))) {
    assignBanditMoveTarget(state, bandit);
  }
}

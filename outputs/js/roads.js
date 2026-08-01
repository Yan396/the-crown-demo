import { TOWN_DATA } from "./data.js";

/*
 * The road network.
 *
 * Roads started life inside the map renderer as decoration. Once lords march
 * along them they became shared game data, so they live here and both the
 * simulation and the renderer read the SAME network — otherwise a lord would
 * visibly walk beside the road it is supposed to be on.
 *
 * The network is a pure function of the world seed, so it is recomputed on load
 * rather than serialized: nothing here enters the save format. It also uses its
 * own random stream, independent of both `state.rng` (which feeds bandit spawns)
 * and the renderer's art stream, so adding or removing terrain decoration can
 * never shift where a road runs.
 */

export const ROAD_CONFIG = Object.freeze({
  MAX_SPAN: 1200,      // towns closer than this are joined by a road
  WOBBLE: 70,          // perpendicular offset of the midpoints, in world units
  MIDPOINTS_MIN: 2,
  MIDPOINTS_MAX: 3,
  SMOOTH_PASSES: 2,
  // A party within this of a centreline counts as on-road. Tuned, not guessed:
  // at 92 the off-road penalty applied almost everywhere (a straight line
  // between two towns leaves a road that wobbles +/-70px) and battles/day fell
  // from 0.42 to 0.26. 130 restores 0.46 — see work/pacing.mjs.
  CORRIDOR: 130,
  // Navigation uses exact centreline projections. This is deliberately much
  // smaller than CORRIDOR: the latter controls the speed bonus, while this
  // epsilon only prevents floating-point noise from making a lord oscillate at
  // a shared polyline vertex.
  NAV_EPSILON: 1e-6
});

function roadRandom(seed) {
  let value = (seed ^ 0x0dea1a5e) >>> 0;
  return function nextRandom() {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

// Chaikin smoothing turns control points into a road rather than a zig-zag.
function smoothPolyline(points, passes) {
  let current = points;
  for (let pass = 0; pass < passes; pass += 1) {
    const smoothed = [current[0]];
    for (let index = 0; index < current.length - 1; index += 1) {
      const a = current[index];
      const b = current[index + 1];
      smoothed.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      smoothed.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    smoothed.push(current[current.length - 1]);
    current = smoothed;
  }
  return current;
}

const networkCache = new Map();
const navigationCache = new WeakMap();

export function buildRoads(seed) {
  const key = seed >>> 0;
  const cached = networkCache.get(key);
  if (cached) return cached;

  const roll = roadRandom(key);
  const next = (minimum, maximum) => minimum + (maximum - minimum) * roll();
  const roads = [];

  for (let i = 0; i < TOWN_DATA.length; i += 1) {
    for (let j = i + 1; j < TOWN_DATA.length; j += 1) {
      const from = TOWN_DATA[i];
      const to = TOWN_DATA[j];
      const span = Math.hypot(to.x - from.x, to.y - from.y);
      if (span > ROAD_CONFIG.MAX_SPAN) continue;

      const nx = -(to.y - from.y) / span;
      const ny = (to.x - from.x) / span;
      const midpoints = ROAD_CONFIG.MIDPOINTS_MIN
        + Math.floor(next(0, ROAD_CONFIG.MIDPOINTS_MAX - ROAD_CONFIG.MIDPOINTS_MIN + 1));

      const control = [{ x: from.x, y: from.y }];
      for (let step = 1; step <= midpoints; step += 1) {
        const t = step / (midpoints + 1);
        const offset = next(-ROAD_CONFIG.WOBBLE, ROAD_CONFIG.WOBBLE);
        control.push({
          x: from.x + (to.x - from.x) * t + nx * offset,
          y: from.y + (to.y - from.y) * t + ny * offset
        });
      }
      control.push({ x: to.x, y: to.y });

      roads.push(Object.freeze({
        id: `${from.id}__${to.id}`,
        townIds: Object.freeze([from.id, to.id]),
        points: Object.freeze(smoothPolyline(control, ROAD_CONFIG.SMOOTH_PASSES))
      }));
    }
  }

  const network = Object.freeze(roads);
  networkCache.set(key, network);
  return network;
}

export function findRoad(roads, townIdA, townIdB) {
  return roads.find((road) => (
    (road.townIds[0] === townIdA && road.townIds[1] === townIdB) ||
    (road.townIds[0] === townIdB && road.townIds[1] === townIdA)
  )) || null;
}

function polylineMetrics(points) {
  const cumulative = [0];
  for (let index = 0; index < points.length - 1; index += 1) {
    cumulative.push(cumulative[index] + Math.hypot(
      points[index + 1].x - points[index].x,
      points[index + 1].y - points[index].y
    ));
  }
  return { cumulative, length: cumulative[cumulative.length - 1] || 0 };
}

function navigationFor(roads) {
  const cached = navigationCache.get(roads);
  if (cached) return cached;

  const adjacency = new Map(TOWN_DATA.map((town) => [town.id, []]));
  const metrics = new Map();
  roads.forEach((road) => {
    const measure = polylineMetrics(road.points);
    metrics.set(road.id, measure);
    const [firstTownId, secondTownId] = road.townIds;
    if (!adjacency.has(firstTownId)) adjacency.set(firstTownId, []);
    if (!adjacency.has(secondTownId)) adjacency.set(secondTownId, []);
    adjacency.get(firstTownId).push({
      road,
      fromTownId: firstTownId,
      toTownId: secondTownId,
      length: measure.length
    });
    adjacency.get(secondTownId).push({
      road,
      fromTownId: secondTownId,
      toTownId: firstTownId,
      length: measure.length
    });
  });
  adjacency.forEach((edges) => edges.sort((first, second) => (
    first.road.id.localeCompare(second.road.id) ||
    first.toTownId.localeCompare(second.toTownId)
  )));

  const navigation = { adjacency, metrics, pathCache: new Map() };
  navigationCache.set(roads, navigation);
  return navigation;
}

function routeSignature(legs) {
  return legs.map((leg) => `${leg.road.id}:${leg.toTownId}`).join(">");
}

// Dijkstra is weighted by the actual curved polyline length, not town-to-town
// air distance. Equal routes are resolved by their stable road-id signature so
// navigation never consumes or depends on the simulation RNG.
export function findRoadPath(roads, fromTownId, toTownId) {
  if (fromTownId === toTownId) return { distance: 0, legs: [], signature: "" };
  const navigation = navigationFor(roads);
  const cacheKey = `${fromTownId}__${toTownId}`;
  if (navigation.pathCache.has(cacheKey)) return navigation.pathCache.get(cacheKey);
  if (!navigation.adjacency.has(fromTownId) || !navigation.adjacency.has(toTownId)) {
    navigation.pathCache.set(cacheKey, null);
    return null;
  }

  const best = new Map([[fromTownId, { distance: 0, legs: [], signature: "" }]]);
  const open = new Set([fromTownId]);
  while (open.size) {
    const currentTownId = [...open].sort((firstId, secondId) => {
      const first = best.get(firstId);
      const second = best.get(secondId);
      return first.distance - second.distance ||
        first.signature.localeCompare(second.signature) ||
        firstId.localeCompare(secondId);
    })[0];
    open.delete(currentTownId);
    const current = best.get(currentTownId);
    if (currentTownId === toTownId) break;

    for (const edge of navigation.adjacency.get(currentTownId)) {
      const legs = [...current.legs, edge];
      const candidate = {
        distance: current.distance + edge.length,
        legs,
        signature: routeSignature(legs)
      };
      const previous = best.get(edge.toTownId);
      const improvesDistance = !previous || candidate.distance < previous.distance - ROAD_CONFIG.NAV_EPSILON;
      const winsTie = previous &&
        Math.abs(candidate.distance - previous.distance) <= ROAD_CONFIG.NAV_EPSILON &&
        candidate.signature.localeCompare(previous.signature) < 0;
      if (improvesDistance || winsTie) {
        best.set(edge.toTownId, candidate);
        open.add(edge.toTownId);
      }
    }
  }

  const result = best.get(toTownId) || null;
  navigation.pathCache.set(cacheKey, result);
  return result;
}

function projectToSegment(position, first, second) {
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, (
      (position.x - first.x) * dx + (position.y - first.y) * dy
    ) / lengthSquared));
  const point = { x: first.x + dx * t, y: first.y + dy * t };
  return { point, t, gap: Math.hypot(position.x - point.x, position.y - point.y) };
}

function nextPointFromTown(leg) {
  if (!leg) return null;
  const points = leg.road.points;
  if (points.length < 2) return null;
  return leg.road.townIds[0] === leg.fromTownId ? points[1] : points[points.length - 2];
}

function nextPointTowardEndpoint(candidate) {
  const { road, segmentIndex, projection, endpointTownId, path } = candidate;
  const points = road.points;
  const towardFirst = endpointTownId === road.townIds[0];
  if (towardFirst) {
    if (projection.t > ROAD_CONFIG.NAV_EPSILON) return points[segmentIndex];
    if (segmentIndex > 0) return points[segmentIndex - 1];
  } else {
    if (projection.t < 1 - ROAD_CONFIG.NAV_EPSILON) return points[segmentIndex + 1];
    if (segmentIndex + 2 < points.length) return points[segmentIndex + 2];
  }
  return nextPointFromTown(path.legs[0]);
}

// Returns exactly one centreline waypoint toward a town. A party off the road
// first joins the geometrically nearest segment; once on it, the two possible
// directions are ranked by remaining curved distance plus the deterministic
// town-graph path. `null` means the target is disconnected and callers should
// retain their straight-line fallback.
export function nextRoadWaypoint(roads, position, targetTownId) {
  const navigation = navigationFor(roads);
  const projections = [];
  let nearestGap = Infinity;

  roads.forEach((road) => {
    for (let segmentIndex = 0; segmentIndex < road.points.length - 1; segmentIndex += 1) {
      const projection = projectToSegment(
        position,
        road.points[segmentIndex],
        road.points[segmentIndex + 1]
      );
      if (projection.gap < nearestGap) nearestGap = projection.gap;
      projections.push({ road, segmentIndex, projection });
    }
  });
  if (!Number.isFinite(nearestGap)) return null;

  const nearest = projections.filter((entry) => (
    entry.projection.gap <= nearestGap + ROAD_CONFIG.NAV_EPSILON
  ));
  const candidates = [];
  nearest.forEach((entry) => {
    const measure = navigation.metrics.get(entry.road.id);
    const segmentLength = measure.cumulative[entry.segmentIndex + 1] -
      measure.cumulative[entry.segmentIndex];
    const arcFromFirst = measure.cumulative[entry.segmentIndex] +
      segmentLength * entry.projection.t;
    entry.road.townIds.forEach((endpointTownId, endpointIndex) => {
      const path = findRoadPath(roads, endpointTownId, targetTownId);
      if (!path) return;
      const partialDistance = endpointIndex === 0
        ? arcFromFirst
        : measure.length - arcFromFirst;
      candidates.push({
        ...entry,
        endpointTownId,
        path,
        remainingDistance: partialDistance + path.distance
      });
    });
  });
  if (!candidates.length) return null;

  candidates.sort((first, second) => (
    first.remainingDistance - second.remainingDistance ||
    first.road.id.localeCompare(second.road.id) ||
    first.segmentIndex - second.segmentIndex ||
    first.endpointTownId.localeCompare(second.endpointTownId) ||
    first.path.signature.localeCompare(second.path.signature)
  ));
  const chosen = candidates[0];
  if (chosen.projection.gap > ROAD_CONFIG.NAV_EPSILON) return chosen.projection.point;
  return nextPointTowardEndpoint(chosen);
}

function pointToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
  t = t < 0 ? 0 : (t > 1 ? 1 : t);
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

export function distanceToRoad(points, x, y) {
  let best = Infinity;
  for (let index = 0; index < points.length - 1; index += 1) {
    const gap = pointToSegment(
      x, y,
      points[index].x, points[index].y,
      points[index + 1].x, points[index + 1].y
    );
    if (gap < best) best = gap;
  }
  return best;
}

export function isOnRoad(roads, x, y) {
  return roads.some((road) => distanceToRoad(road.points, x, y) <= ROAD_CONFIG.CORRIDOR);
}

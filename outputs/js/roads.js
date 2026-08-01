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
  CORRIDOR: 130
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

import assert from "node:assert/strict";
import test from "node:test";

import { updateLordMovement } from "../outputs/js/ai.js";
import { CONFIG } from "../outputs/js/data.js";
import {
  copyPosition,
  createInitialState,
  getTown,
  loadState,
  saveState
} from "../outputs/js/state.js";
import {
  buildRoads,
  distanceToRoad,
  findRoadPath,
  nextRoadWaypoint
} from "../outputs/js/roads.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function configureTownJourney(state, options = {}) {
  const lord = state.lords[0];
  const from = getTown(state, options.fromId || "frost_gate");
  const to = getTown(state, options.toId || "red_harbor");
  lord.pos = copyPosition(from.pos);
  lord.prevPos = copyPosition(from.pos);
  lord.moveTarget = copyPosition(to.pos);
  lord.aiState = options.aiState || "attack";
  lord.targetKind = "town";
  lord.targetId = to.id;
  lord.defeatedUntil = 0;
  lord.defeatedUntilTick = 0;
  return { lord, from, to };
}

function nearestRoadGap(roads, position) {
  return Math.min(...roads.map((road) => (
    distanceToRoad(road.points, position.x, position.y)
  )));
}

function movementSnapshot(lord) {
  return {
    pos: clone(lord.pos),
    moveTarget: clone(lord.moveTarget),
    aiState: lord.aiState,
    targetKind: lord.targetKind,
    targetId: lord.targetId,
    patrolIndex: lord.patrolIndex,
    troops: clone(lord.troops),
    gold: lord.gold,
    roadWaypoint: lord.roadWaypoint
  };
}

test("road graph uses deterministic curved-distance multi-hop paths", () => {
  const first = buildRoads(CONFIG.SEED);
  const second = buildRoads(CONFIG.SEED);
  assert.equal(first, second, "same seed should reuse the exact deterministic network");

  const path = findRoadPath(first, "frost_gate", "red_harbor");
  assert.ok(path, "connected towns must have a road path");
  assert.deepEqual(
    path.legs.map((leg) => leg.road.id),
    ["frost_gate__river_bend", "river_bend__red_harbor"]
  );
  assert.ok(path.distance > 0);
  assert.equal(nextRoadWaypoint([], { x: 100, y: 100 }, "red_harbor"), null);
});

test("all town intents, including flee, follow the visible road polylines", () => {
  for (const aiState of ["attack", "defend", "recruit", "flee"]) {
    const state = createInitialState(CONFIG.SEED, { skipOnboarding: true });
    const { lord, to } = configureTownJourney(state, { aiState });
    const roads = buildRoads(state.seed);
    const rngBefore = clone(state.rng);
    let closestToMiddleTown = Infinity;
    let arrived = false;

    for (let tick = 0; tick < 200 && !arrived; tick += 1) {
      arrived = updateLordMovement(
        state,
        lord,
        CONFIG.LORD_SPEED * CONFIG.ROAD_SPEED_MULTIPLIER
      );
      assert.ok(
        nearestRoadGap(roads, lord.pos) < 1e-5,
        `${aiState} left the road centreline at tick ${tick}`
      );
      const middle = getTown(state, "river_bend");
      closestToMiddleTown = Math.min(
        closestToMiddleTown,
        Math.hypot(lord.pos.x - middle.pos.x, lord.pos.y - middle.pos.y)
      );
    }

    assert.ok(arrived, `${aiState} must eventually reach the final town`);
    assert.deepEqual(lord.pos, to.pos);
    assert.ok(closestToMiddleTown < CONFIG.LORD_SPEED * CONFIG.ROAD_SPEED_MULTIPLIER);
    assert.deepEqual(state.rng, rngBefore, "road navigation must not consume state.rng");
  }
});

test("intermediate waypoints do not trigger final-town patrol arrival", () => {
  const state = createInitialState(CONFIG.SEED, { skipOnboarding: true });
  const { lord, to } = configureTownJourney(state, {
    aiState: "patrol",
    fromId: "frost_gate",
    toId: "black_pine"
  });
  lord.patrolTownIds = ["frost_gate", "black_pine"];
  lord.patrolIndex = 1;

  const firstStepArrived = updateLordMovement(state, lord, CONFIG.LORD_SPEED);
  assert.equal(firstStepArrived, false);
  assert.equal(lord.targetId, to.id);
  assert.equal(lord.patrolIndex, 1);

  let finalArrival = false;
  for (let tick = 0; tick < 200 && !finalArrival; tick += 1) {
    finalArrival = updateLordMovement(state, lord, CONFIG.LORD_SPEED);
  }
  assert.equal(finalArrival, true);
  assert.deepEqual(lord.pos, to.pos);
  assert.equal(lord.targetId, "frost_gate", "patrol may turn only at the final town");
  assert.equal(lord.patrolIndex, 0);
});

test("moving lord and bandit targets retain direct dynamic pursuit", () => {
  for (const targetKind of ["lord", "bandit"]) {
    const state = createInitialState(CONFIG.SEED, { skipOnboarding: true });
    const lord = state.lords[0];
    const target = targetKind === "lord" ? state.lords[4] : state.bandits[0];
    lord.pos = { x: 100, y: 100 };
    lord.prevPos = copyPosition(lord.pos);
    target.pos = { x: 400, y: 500 };
    lord.aiState = "attack";
    lord.targetKind = targetKind;
    lord.targetId = target.id;
    lord.moveTarget = copyPosition(target.pos);
    const rngBefore = clone(state.rng);

    updateLordMovement(state, lord, 10);
    assert.ok(Math.abs(lord.pos.x - 106) < 1e-10);
    assert.ok(Math.abs(lord.pos.y - 108) < 1e-10);

    target.pos = { x: 106, y: 208 };
    updateLordMovement(state, lord, 10);
    assert.ok(Math.abs(lord.pos.x - 106) < 1e-10);
    assert.ok(Math.abs(lord.pos.y - 118) < 1e-10);
    assert.deepEqual(state.rng, rngBefore);
  }
});

test("v2 save/load resumes the exact same road journey", () => {
  const uninterrupted = createInitialState(CONFIG.SEED, { skipOnboarding: true });
  const interrupted = createInitialState(CONFIG.SEED, { skipOnboarding: true });
  const first = configureTownJourney(uninterrupted);
  const second = configureTownJourney(interrupted);
  // A real v2 build briefly wrote an integer here. It remains harmless and must
  // neither invalidate the save nor influence the now-derived route.
  first.lord.roadWaypoint = 7;
  second.lord.roadWaypoint = 7;

  for (let tick = 0; tick < 20; tick += 1) {
    updateLordMovement(uninterrupted, first.lord, CONFIG.LORD_SPEED);
    updateLordMovement(interrupted, second.lord, CONFIG.LORD_SPEED);
  }
  const storage = new MemoryStorage();
  assert.equal(saveState(interrupted, storage), true);
  const resumed = loadState(storage);
  assert.ok(resumed);
  assert.equal(resumed.saveVersion, 2);
  const resumedLord = resumed.lords.find((lord) => lord.id === second.lord.id);

  for (let tick = 0; tick < 100; tick += 1) {
    updateLordMovement(uninterrupted, first.lord, CONFIG.LORD_SPEED);
    updateLordMovement(resumed, resumedLord, CONFIG.LORD_SPEED);
  }
  assert.deepEqual(movementSnapshot(resumedLord), movementSnapshot(first.lord));
  assert.deepEqual(resumed.rng, uninterrupted.rng);
});

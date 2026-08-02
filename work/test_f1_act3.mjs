import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG } from "../outputs/js/data.js";
import {
  advanceActIfNeeded,
  beginAct2Promise,
  beginAct3Promise,
  dismissFiefThreat,
  submitPromise
} from "../outputs/js/demo.js";
import { createInitialState, loadState, saveState } from "../outputs/js/state.js";
import { buildRoads } from "../outputs/js/roads.js";
import {
  acceptMercenaryContract,
  declareWar,
  fiefGarrisonWage,
  getTavernContracts,
  initializeLivingWorld,
  setFiefGarrison,
  processFiefContract,
  simulateAutoplay,
  updateSieges,
  worldTick
} from "../outputs/js/sim.js";

function promisedState(seed = 0xf100) {
  const state = createInitialState(seed, {
    skipOnboarding: true,
    startedAt: new Date(0).toISOString(),
    v11: true
  });
  state.paused = false;
  state.demo.modal = "troopPromise";
  assert.equal(submitPromise(state, 20).accepted, true);
  return state;
}

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function enterActTwo(state) {
  state.player.renown = CONFIG.ACT2_RENOWN;
  const transition = advanceActIfNeeded(state, new Date(0).toISOString());
  assert.equal(transition?.type, "act2");
  assert.equal(beginAct2Promise(state).advanced, true);
  assert.equal(submitPromise(state, 500).accepted, true);
  return state;
}

test("Act progression keeps the demo's 50/100 boundary", () => {
  const state = enterActTwo(promisedState());
  state.player.renown = CONFIG.DEMO_END_RENOWN;
  const transition = advanceActIfNeeded(state, new Date(1_000).toISOString());
  assert.equal(transition?.type, "ending");
  assert.equal(state.player.act, 2);
  assert.equal(state.demo.ended, true);
  assert.deepEqual(state.player.fiefs, []);
});

test("full progression waits for both renown and relation, then grants a border fief", () => {
  const state = enterActTwo(promisedState(0xf101));
  state.player.renown = CONFIG.DEMO_END_RENOWN;
  assert.equal(advanceActIfNeeded(state, undefined, { demoBuild: false }), null);
  state.player.renown = CONFIG.ACT3_RENOWN;
  state.player.relations.north = CONFIG.ACT3_RELATION - 1;
  assert.equal(advanceActIfNeeded(state, undefined, { demoBuild: false }), null);

  state.player.relations.north = CONFIG.ACT3_RELATION;
  const transition = advanceActIfNeeded(state, new Date(2_000).toISOString(), {
    demoBuild: false
  });
  assert.equal(transition?.type, "act3");
  assert.equal(state.player.act, 3);
  assert.equal(state.player.factionId, "north");
  assert.equal(state.player.fiefs.length, 1);
  assert.equal(state.towns.find((town) => town.id === state.player.fiefs[0]).factionId, "north");
  assert.equal(state.demo.modal, "act3Transition");
  assert.equal(state.demo.ended, false);
  assert.equal(state.telemetry.chronicle.fiefGranted.townId, state.player.fiefs[0]);

  assert.equal(beginAct3Promise(state).advanced, true);
  const promise = submitPromise(state, 2);
  assert.equal(promise.accepted, true);
  assert.deepEqual(state.player.promises.at(-1), {
    act: 3,
    kind: "fiefs",
    statedGoal: 2,
    actualAtActEnd: null,
    exceeded: false,
    exceededAtTick: null
  });
});

test("the fief slider makes one real field/garrison split and both halves cost wages", () => {
  const state = enterActTwo(promisedState(0xf102));
  state.player.renown = CONFIG.ACT3_RENOWN;
  state.player.relations.north = CONFIG.ACT3_RELATION;
  const transition = advanceActIfNeeded(state, undefined, { demoBuild: false });
  beginAct3Promise(state);
  submitPromise(state, 2);
  const town = state.towns.find((entry) => entry.id === transition.townId);
  state.player.troops = [{ type: "militia", count: 10, xp: 0 }];
  town.garrison = [{ type: "militia", count: 2, xp: 0 }];
  state.player.pos = { ...town.pos };
  state.player.prevPos = { ...town.pos };
  state.paused = false;
  initializeLivingWorld(state);

  const split = setFiefGarrison(state, town.id, 7);
  assert.deepEqual({ field: split.field, garrison: split.garrison }, { field: 5, garrison: 7 });
  assert.equal(fiefGarrisonWage(state), 7);
  assert.equal(setFiefGarrison(state, town.id, 99).field, CONFIG.FIEF_MIN_FIELD_TROOPS);

  const garrison = town.garrison.reduce((sum, stack) => sum + stack.count, 0);
  const goldBefore = state.player.gold;
  state.stats.days = CONFIG.WAGE_GRACE_DAYS;
  state.tick = CONFIG.TICKS_PER_DAY - 1;
  const result = worldTick(state);
  assert.equal(result.dayAdvanced, true);
  assert.equal(result.dailyEconomyResult.playerWage.garrison, garrison);
  assert.equal(
    state.player.gold,
    goldBefore + result.dailyEconomyResult.fiefTax - result.dailyEconomyResult.playerWage.paid
  );
});

test("a real siege sends one messenger, then loss and allied recapture use existing capture rules", () => {
  const state = enterActTwo(promisedState(0xf103));
  state.player.renown = CONFIG.ACT3_RENOWN;
  state.player.relations.north = CONFIG.ACT3_RELATION;
  const transition = advanceActIfNeeded(state, undefined, { demoBuild: false });
  beginAct3Promise(state);
  submitPromise(state, 2);
  initializeLivingWorld(state);
  declareWar(state, "north", "south");
  const town = state.towns.find((entry) => entry.id === transition.townId);
  state.player.pos = { x: CONFIG.WORLD_SIZE - 1, y: CONFIG.WORLD_SIZE - 1 };
  state.player.prevPos = { ...state.player.pos };
  const attacker = state.lords.find((lord) => lord.factionId === "south");
  attacker.troops = [{ type: "militia", count: 100, xp: 0 }];
  attacker.pos = { ...town.pos };
  attacker.prevPos = { ...town.pos };
  attacker.aiState = "attack";
  attacker.targetKind = "town";
  attacker.targetId = town.id;
  state.paused = false;
  state.demo.modal = null;

  updateSieges(state);
  assert.equal(town.underSiege, true);
  assert.equal(state.demo.modal, "fiefThreat");
  assert.equal(state.demo.fiefThreat.townId, town.id);
  assert.equal(state.telemetry.chronicle.fiefThreat.townId, town.id);
  assert.equal(dismissFiefThreat(state).dismissed, true);

  town.siegeTicks = CONFIG.SIEGE_REQUIRED_TICKS - 1;
  town.siege.progressTicks = town.siegeTicks;
  const renownBefore = state.player.renown;
  updateSieges(state);
  assert.equal(town.factionId, "south");
  assert.equal(state.player.fiefs.includes(town.id), false);
  assert.equal(state.player.renown, renownBefore - CONFIG.FIEF_LOSS_RENOWN);
  assert.equal(
    state.player.relations.north,
    CONFIG.ACT3_RELATION - CONFIG.FIEF_LOSS_RELATION
  );
  assert.equal(state.telemetry.chronicle.fiefLost.townId, town.id);

  const liberator = state.lords.find((lord) => lord.factionId === "north");
  liberator.troops = [{ type: "militia", count: 100, xp: 0 }];
  liberator.pos = { ...town.pos };
  liberator.prevPos = { ...town.pos };
  liberator.aiState = "attack";
  liberator.targetKind = "town";
  liberator.targetId = town.id;
  town.underSiege = true;
  town.siegeAttackerId = liberator.id;
  town.siegeTicks = CONFIG.SIEGE_REQUIRED_TICKS - 1;
  town.siege = {
    attackerLordId: liberator.id,
    attackerFactionId: "north",
    startedTick: state.tick,
    progressTicks: town.siegeTicks
  };
  updateSieges(state);
  assert.equal(town.factionId, "north");
  assert.equal(state.player.fiefs.includes(town.id), true);
  assert.equal(state.telemetry.chronicle.fiefRecaptured.townId, town.id);
});

test("the tavern adds reinforcement and real-road patrol contracts only after enfeoffment", () => {
  const state = enterActTwo(promisedState(0xf104));
  const startTown = state.towns.find((town) => town.id === CONFIG.START_TOWN_ID);
  state.player.pos = { ...startTown.pos };
  state.player.prevPos = { ...startTown.pos };
  state.paused = false;
  initializeLivingWorld(state);
  assert.equal(getTavernContracts(state, startTown.id).some((offer) => offer.type === "reinforce"), false);

  state.player.renown = CONFIG.ACT3_RENOWN;
  state.player.relations.north = CONFIG.ACT3_RELATION;
  const transition = advanceActIfNeeded(state, undefined, { demoBuild: false });
  beginAct3Promise(state);
  submitPromise(state, 2);
  const fief = state.towns.find((town) => town.id === transition.townId);
  state.player.pos = { ...fief.pos };
  state.player.prevPos = { ...fief.pos };
  state.paused = false;
  const offers = getTavernContracts(state, fief.id);
  assert.ok(offers.some((offer) => offer.type === "reinforce"));
  assert.ok(offers.some((offer) => offer.type === "patrol"));
  const war = offers.find((offer) => offer.type === "war");
  if (war) {
    assert.equal(
      war.relationPenalty,
      CONFIG.CONTRACT_WAR_RELATION_PENALTY * CONFIG.FIEF_WAR_RELATION_MULTIPLIER
    );
  }

  state.player.gold = 0;
  state.player.troops = [{ type: "militia", count: 20, xp: 0 }];
  fief.garrison = [{ type: "militia", count: 2, xp: 0 }];
  assert.equal(acceptMercenaryContract(state, fief.id, "reinforce").ok, true);
  setFiefGarrison(state, fief.id, CONFIG.FIEF_REINFORCE_TARGET);
  const completed = processFiefContract(state);
  assert.equal(completed.complete, true);
  assert.equal(state.player.gold, CONFIG.FIEF_REINFORCE_REWARD);

  state.player.contract = null;
  assert.equal(acceptMercenaryContract(state, fief.id, "patrol").ok, true);
  const road = buildRoads(state.seed).find((entry) => entry.townIds.includes(fief.id));
  const roadPoint = road.points.find((point) => (
    Math.hypot(point.x - fief.pos.x, point.y - fief.pos.y) <= CONFIG.FIEF_PATROL_RADIUS
  ));
  state.player.pos = { ...roadPoint };
  for (let tick = 0; tick < CONFIG.FIEF_PATROL_REQUIRED_TICKS; tick += 1) {
    processFiefContract(state);
  }
  assert.equal(state.player.contract.active, false);
  assert.equal(
    state.player.gold,
    CONFIG.FIEF_REINFORCE_REWARD + CONFIG.FIEF_PATROL_REWARD
  );
});

test("the existing v2 save slot round-trips Act 3, an all-fiefs promise, and a threat modal", () => {
  const state = enterActTwo(promisedState(0xf105));
  state.player.renown = CONFIG.ACT3_RENOWN;
  state.player.relations.north = CONFIG.ACT3_RELATION;
  advanceActIfNeeded(state, undefined, { demoBuild: false });
  beginAct3Promise(state);
  submitPromise(state, "all");
  state.demo.fiefThreat = {
    townId: state.player.fiefs[0],
    attackerLordId: "south_lord_1",
    garrison: 7,
    enemy: 30,
    startedTick: state.tick
  };
  state.demo.modal = "fiefThreat";
  state.demo.pauseReason = "fiefThreat";
  state.paused = true;
  const storage = new MemoryStorage();
  assert.equal(saveState(state, storage), true);
  const loaded = loadState(storage, { v11: true });
  assert.equal(loaded.player.act, 3);
  assert.equal(loaded.player.promises.at(-1).statedGoal, "all");
  assert.deepEqual(loaded.player.fiefs, state.player.fiefs);
  assert.deepEqual(loaded.demo.fiefThreat, state.demo.fiefThreat);
});

test("full autoplay reaches enfeoffment in 35–45 minutes and a real siege threat within 15", () => {
  const result = simulateAutoplay(CONFIG.SEED, { fullVersion: true });
  assert.ok(result.act3Seconds >= CONFIG.AUTOPLAY_ACT3_TARGET_MIN_SECONDS);
  assert.ok(result.act3Seconds <= CONFIG.AUTOPLAY_ACT3_TARGET_MAX_SECONDS);
  assert.ok(result.fiefThreatSeconds !== null);
  assert.ok(result.fiefThreatDelaySeconds <= CONFIG.AUTOPLAY_FIEF_THREAT_MAX_SECONDS);
  assert.equal(result.state.player.act, 3);
  assert.equal(result.state.player.fiefs.length, 1);
  assert.equal(result.state.telemetry.chronicle.fiefThreat.townId, result.state.player.fiefs[0]);
  assert.equal(result.battleScriptsChecked, result.state.stats.battles);
});

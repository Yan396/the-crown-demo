import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG } from "../outputs/js/data.js";
import {
  advanceActIfNeeded,
  beginAct2Promise,
  beginAct3Promise,
  submitPromise
} from "../outputs/js/demo.js";
import { createInitialState } from "../outputs/js/state.js";

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


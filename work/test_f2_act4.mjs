import assert from "node:assert/strict";
import test from "node:test";

import { CONFIG } from "../outputs/js/data.js";
import { advanceActIfNeeded, submitPromise } from "../outputs/js/demo.js";
import {
  canOfferFounding,
  chooseKingdomEdict,
  declineFounding,
  dismissFoundingSeal,
  foundKingdom,
  offerFoundingIfNeeded,
  processKingdomDay,
  selectOrigin
} from "../outputs/js/kingdom.js";
import { simulateAutoplay } from "../outputs/js/sim.js";
import { changePlayerRenown, createInitialState, getFaction } from "../outputs/js/state.js";
import { buildResultCode, decodeCrownCode } from "../outputs/js/telemetry.js";

function act3Candidate(seed = 0xf200) {
  const state = createInitialState(seed, {
    skipOnboarding: true,
    startedAt: new Date(0).toISOString(),
    fullVersion: true,
    f2: true,
    v11: true
  });
  state.player.act = 3;
  state.player.renown = CONFIG.ACT4_RENOWN;
  state.player.factionId = "south";
  state.player.promises = [
    { act: 1, kind: "troops", statedGoal: 20, actualAtActEnd: 32, exceeded: true, exceededAtTick: 100 },
    { act: 2, kind: "gold", statedGoal: 500, actualAtActEnd: 420, exceeded: false, exceededAtTick: null },
    { act: 3, kind: "fiefs", statedGoal: 2, actualAtActEnd: null, exceeded: true, exceededAtTick: 200 }
  ];
  state.promises = state.player.promises;
  state.player.fiefs = ["river_bend", "red_harbor", "golden_field"];
  state.player.fiefs.forEach((townId) => {
    const town = state.towns.find((entry) => entry.id === townId);
    town.factionId = "south";
    town.garrison = [{ type: "militia", count: 20, xp: 0 }];
  });
  return state;
}

test("F2 origin is a one-time full-build choice with CONFIG-owned tilts", () => {
  const state = createInitialState(0xf201, { fullVersion: true, f2: true });
  assert.equal(state.demo.modal, "origin");
  const before = { gold: state.player.gold, renown: state.player.renown };
  const result = selectOrigin(state, "border");
  assert.equal(result.ok, true);
  assert.equal(state.player.origin, "border");
  assert.equal(state.kingdom.origin, "border");
  assert.equal(state.player.gold, before.gold + CONFIG.ORIGIN_BONUSES.border.gold);
  assert.equal(state.player.renown, before.renown + CONFIG.ORIGIN_BONUSES.border.renown);
  assert.equal(state.demo.modal, "onboarding");
  assert.equal(selectOrigin(state, "hunter").ok, false);
});

test("F2 founding requires 500 renown and three towns, can be declined, then reoffers", () => {
  const state = act3Candidate();
  state.player.renown = CONFIG.ACT4_RENOWN - 1;
  assert.equal(canOfferFounding(state), false);
  state.player.renown = CONFIG.ACT4_RENOWN;
  state.player.fiefs.pop();
  assert.equal(canOfferFounding(state), false);
  state.player.fiefs.push("golden_field");
  assert.equal(offerFoundingIfNeeded(state)?.type, "founding");
  assert.equal(declineFounding(state).ok, true);
  assert.equal(canOfferFounding(state), false);
  state.stats.days += CONFIG.FOUNDING_REOFFER_DAYS;
  assert.equal(offerFoundingIfNeeded(state)?.type, "founding");

  const result = foundKingdom(state);
  assert.equal(result.ok, true);
  assert.equal(state.player.act, 4);
  assert.equal(state.player.factionId, "player");
  assert.equal(state.factions.length, 4);
  assert.equal(getFaction(state, "player").color, "#B03A2E");
  for (const faction of state.factions.filter((entry) => entry.id !== "player" && entry.alive)) {
    assert.ok(faction.atWarWith.includes("player"));
    assert.ok(getFaction(state, "player").atWarWith.includes(faction.id));
  }
  assert.equal(dismissFoundingSeal(state).ok, true);
});

test("F2 king-day clock launches coalitions, warns one day early, and resolves rebellion", () => {
  const state = act3Candidate(0xf202);
  offerFoundingIfNeeded(state);
  foundKingdom(state);
  dismissFoundingSeal(state);
  state.kingdom.foundedDay = 0;

  state.stats.days = CONFIG.KINGDOM_COALITION_WAVE_DAYS;
  const wave = processKingdomDay(state);
  assert.equal(wave.coalition.lords.length, 3);
  assert.equal(state.kingdom.coalitionWaves, 1);

  state.player.fiefs.forEach((townId) => {
    state.towns.find((town) => town.id === townId).garrison = [{ type: "militia", count: 1, xp: 0 }];
  });
  state.stats.days = CONFIG.KINGDOM_REBELLION_INTERVAL_DAYS - CONFIG.KINGDOM_REBELLION_WARNING_DAYS;
  assert.ok(processKingdomDay(state).warning);
  state.stats.days = CONFIG.KINGDOM_REBELLION_INTERVAL_DAYS;
  assert.equal(processKingdomDay(state).rebellion.rebelled, true);
  assert.equal(state.player.fiefs.length, 2);
});

test("F2 continue path freezes renown silently and returns the edict every 30 days", () => {
  const state = act3Candidate(0xf203);
  offerFoundingIfNeeded(state);
  foundKingdom(state);
  dismissFoundingSeal(state);
  state.kingdom.foundedDay = 0;
  state.stats.days = CONFIG.KINGDOM_DECISION_INTERVAL_DAYS;
  state.player.fiefs.forEach((townId) => {
    state.towns.find((town) => town.id === townId).garrison = [{ type: "militia", count: 50, xp: 0 }];
  });
  assert.equal(processKingdomDay(state).decision, true);
  const beforeEvents = state.eventLog.length;
  const frozenAt = state.player.renown;
  assert.equal(chooseKingdomEdict(state, "continue").type, "continue");
  assert.equal(changePlayerRenown(state, 999), 0);
  assert.equal(state.player.renown, frozenAt);
  assert.equal(state.eventLog.length, beforeEvents, "the freeze must not announce itself");
  state.stats.days = CONFIG.KINGDOM_DECISION_INTERVAL_DAYS * 2;
  assert.equal(processKingdomDay(state).decision, true);
  const ending = chooseKingdomEdict(state, "stop", new Date(0).toISOString());
  assert.equal(ending.path, "conquest_then_stop");
  assert.equal(state.demo.ended, true);
});

test("F2 autoplay reaches the stop ending in 2.5–4h and proves the endless path has no victory", () => {
  const stop = simulateAutoplay(CONFIG.SEED, {
    fullVersion: true,
    phase2: true,
    endingChoice: "stop",
    maxActiveSeconds: CONFIG.AUTOPLAY_F2_HARD_LIMIT_SECONDS
  });
  assert.ok(stop.foundingSeconds !== null);
  assert.ok(stop.edictSeconds >= CONFIG.AUTOPLAY_F2_MIN_ACTIVE_SECONDS);
  assert.ok(stop.edictSeconds <= CONFIG.AUTOPLAY_F2_MAX_ACTIVE_SECONDS);
  assert.equal(stop.state.demo.ended, true);
  assert.equal(stop.endingPath, "stop");
  assert.ok(stop.state.telemetry.endingChronicle.length >= CONFIG.KINGDOM_CHRONICLE_MIN_LINES);
  assert.ok(stop.state.telemetry.endingChronicle.length <= CONFIG.KINGDOM_CHRONICLE_MAX_LINES);

  const payload = decodeCrownCode(buildResultCode(stop.state));
  assert.equal(payload.version, 2);
  assert.equal(payload.ending.path, "stop");
  assert.equal(payload.promises.length, 3);
  assert.equal(payload.ending.chronicle.length, stop.state.telemetry.endingChronicle.length);

  const endless = simulateAutoplay(CONFIG.SEED, {
    fullVersion: true,
    phase2: true,
    endingChoice: "continue",
    maxDecisions: 2,
    maxActiveSeconds: CONFIG.AUTOPLAY_F2_HARD_LIMIT_SECONDS
  });
  assert.equal(endless.state.demo.ended, false);
  assert.equal(endless.endingPath, "conquest");
  assert.equal(endless.kingdomDecisions, 2);
  assert.equal(endless.state.player.renown, endless.state.kingdom.renownFrozenAt);
});

test("demo build still ends at renown 100 and never enters F2", () => {
  const state = createInitialState(0xf204, { skipOnboarding: true });
  state.player.act = 2;
  state.player.renown = CONFIG.DEMO_END_RENOWN;
  state.demo.modal = "goldPromise";
  submitPromise(state, CONFIG.AUTOPLAY_GOLD_PROMISE, new Date(0).toISOString());
  const result = advanceActIfNeeded(state, new Date(0).toISOString(), { demoBuild: true });
  assert.equal(result.type, "ending");
  assert.equal(state.factions.length, 3);
  assert.equal(state.kingdom.founded, false);
});

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { skipBattle, startBattle } from "../outputs/js/battle.js";
import { buildChronicleEntries } from "../outputs/js/chronicle.js";
import { CONFIG } from "../outputs/js/data.js";
import { updatePromiseOvershoots } from "../outputs/js/demo.js";
import {
  createInitialState,
  getTroopCount,
  loadState,
  saveState
} from "../outputs/js/state.js";
import { acceptMercenaryContract, simulateAutoplay } from "../outputs/js/sim.js";
import {
  buildPlaytestPayload,
  buildResultCode,
  decodeCrownCode,
  recordBiggestBattle,
  recordChronicleMilestone
} from "../outputs/js/telemetry.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

test("narrative telemetry migrates and survives save/load", () => {
  const oldState = createInitialState(0xa001, {
    skipOnboarding: true,
    startedAt: "2026-08-02T00:00:00.000Z"
  });
  delete oldState.telemetry.promiseCrossings;
  delete oldState.telemetry.chronicle;
  const legacyStorage = new MemoryStorage();
  legacyStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(oldState));
  const migrated = loadState(legacyStorage);
  assert.ok(migrated);
  assert.deepEqual(migrated.telemetry.promiseCrossings, { troops: null, gold: null });
  assert.deepEqual(migrated.telemetry.chronicle, {
    firstWin: null,
    firstContract: null,
    biggestBattle: null,
    act2: null,
    ending: null
  });

  migrated.telemetry.chronicle.firstContract = { tick: 10, day: 1, townId: "river_bend" };
  const roundTripStorage = new MemoryStorage();
  assert.equal(saveState(migrated, roundTripStorage), true);
  assert.deepEqual(loadState(roundTripStorage).telemetry.chronicle.firstContract, {
    tick: 10,
    day: 1,
    townId: "river_bend"
  });
});

test("promise crossing captures the first real crossing exactly once", () => {
  const state = createInitialState(0xa002, {
    skipOnboarding: true,
    startedAt: "2026-08-02T00:00:00.000Z"
  });
  state.player.promises.push({
    act: 1,
    kind: "troops",
    statedGoal: 5,
    actualAtActEnd: null,
    exceeded: false,
    exceededAtTick: null
  });
  state.tick = 120;
  state.telemetry.totalActiveSeconds = 60;
  updatePromiseOvershoots(state);
  assert.equal(state.telemetry.promiseCrossings.troops, null, "equal is not an overshoot");

  state.player.troops[0].count = 6;
  updatePromiseOvershoots(state);
  assert.deepEqual(state.telemetry.promiseCrossings.troops, {
    tick: 120,
    day: 3,
    activeSeconds: 60,
    at: "2026-08-02T00:01:00.000Z",
    statedGoal: 5,
    actual: 6
  });

  state.tick = 180;
  state.telemetry.totalActiveSeconds = 90;
  state.player.troops[0].count = 4;
  updatePromiseOvershoots(state);
  assert.equal(state.telemetry.promiseCrossings.troops.tick, 120);
  assert.equal(state.telemetry.promiseCrossings.troops.actual, 6);
});

test("battle and contract hooks record real firsts and the largest battle", () => {
  const state = createInitialState(0xa003, {
    skipOnboarding: true,
    startedAt: "2026-08-02T00:00:00.000Z"
  });
  state.casual.openingBattlesPrepared = 2;
  state.player.troops = [{ type: "militia", count: 100, xp: 0 }];
  const bandit = state.bandits.find((entry) => !entry.elite);
  bandit.troops = [{ type: "militia", count: 1, xp: 0 }];
  bandit.pos = { ...state.player.pos };
  bandit.prevPos = { ...bandit.pos };
  state.tick = 30;
  assert.equal(startBattle(state, bandit), null);
  const result = skipBattle(state);
  assert.equal(result.type, "victory");
  assert.equal(state.telemetry.chronicle.firstWin.tick, 30);
  assert.equal(state.telemetry.chronicle.firstWin.townId, "river_bend");
  assert.equal(state.telemetry.chronicle.biggestBattle.outcome, "victory");
  assert.equal(state.telemetry.chronicle.biggestBattle.totalStart, 101);

  state.tick = 40;
  recordBiggestBattle(state, {
    banditId: "larger",
    townId: "river_bend",
    playerStart: 120,
    enemyStart: 30
  });
  assert.equal(state.telemetry.chronicle.biggestBattle.banditId, "larger");
  recordBiggestBattle(state, { banditId: "smaller", playerStart: 1, enemyStart: 1 });
  assert.equal(state.telemetry.chronicle.biggestBattle.banditId, "larger");

  state.player.act = 2;
  state.paused = false;
  state.player.pos = { ...state.towns.find((town) => town.id === "river_bend").pos };
  state.player.prevPos = { ...state.player.pos };
  state.tick = 50;
  const contract = acceptMercenaryContract(state, "river_bend");
  assert.equal(contract.ok, true);
  assert.deepEqual(
    {
      tick: state.telemetry.chronicle.firstContract.tick,
      townId: state.telemetry.chronicle.firstContract.townId,
      factionId: state.telemetry.chronicle.firstContract.factionId
    },
    { tick: 50, townId: "river_bend", factionId: "south" }
  );
});

test("chronicle selects three to five notable real events deterministically", () => {
  const state = createInitialState(0xa004, {
    skipOnboarding: true,
    startedAt: "2026-08-02T00:00:00.000Z"
  });
  const telemetry = state.telemetry;
  telemetry.chronicle.firstWin = { tick: 10, day: 1, townId: "river_bend" };
  telemetry.promiseCrossings.troops = { tick: 20, day: 1, statedGoal: 60, actual: 61 };
  telemetry.chronicle.firstContract = {
    tick: 30,
    day: 2,
    townId: "river_bend",
    factionId: "south"
  };
  telemetry.promiseCrossings.gold = { tick: 40, day: 2, statedGoal: 500, actual: 501 };
  telemetry.chronicle.biggestBattle = {
    tick: 50,
    day: 2,
    playerStart: 40,
    enemyStart: 32,
    totalStart: 72
  };
  telemetry.chronicle.act2 = { tick: 60, day: 2 };
  telemetry.chronicle.ending = { tick: 70, day: 3 };

  const zh = buildChronicleEntries(telemetry, "zh");
  const en = buildChronicleEntries(telemetry, "en");
  assert.equal(zh.length, 5);
  assert.deepEqual(zh.map((entry) => entry.type), [
    "firstWin",
    "troopsCrossing",
    "firstContract",
    "goldCrossing",
    "biggestBattle"
  ]);
  assert.match(zh[0].text, /河湾城/);
  assert.match(zh[2].text, /南盟/);
  assert.equal(zh[4].text.match(/\d+/g)?.length, 1, "largest-battle copy keeps only its day number");
  assert.match(en[0].text, /Riverbend/);
  assert.match(en[2].text, /Southern League/);
  assert.deepEqual(buildChronicleEntries(telemetry, "zh"), zh);

  const sparse = createInitialState(0xa005, { startedAt: "2026-08-02T00:00:00.000Z" }).telemetry;
  recordChronicleMilestone({ tick: 600, telemetry: sparse }, "act2");
  recordChronicleMilestone({ tick: 1200, telemetry: sparse }, "ending");
  const fallback = buildChronicleEntries(sparse, "zh");
  assert.equal(fallback.length, 3);
  assert.deepEqual(fallback.map((entry) => entry.type), ["start", "act2", "ending"]);
});

test("ending DOM order, share payload, and decoder include the chronicle timeline", () => {
  const index = fs.readFileSync(path.join(ROOT, "outputs/index.html"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "outputs/js/ui.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "outputs/css/ui.css"), "utf8");
  assert.ok(index.indexOf("id=\"mirror-table\"") < index.indexOf("id=\"ending-chronicle\""));
  assert.ok(index.indexOf("id=\"ending-chronicle\"") < index.indexOf("id=\"ending-stats\""));
  assert.match(ui, /buildChronicleEntries\(state\.telemetry,\s*language\(\)\)/);
  assert.match(ui, /item\.dataset\.eventType\s*=\s*entry\.type/);
  assert.match(css, /\.ending-chronicle\s*\{[^}]*list-style:\s*none/s);
  assert.match(css, /\.ending-chronicle li\s*\{[^}]*min-height:\s*min\(36svh,\s*304px\)/s);

  const result = simulateAutoplay(CONFIG.SEED, { multiplier: 20, maxActiveSeconds: 1800, v11: true });
  assert.equal(result.state.demo.ended, true);
  const entries = buildChronicleEntries(result.state.telemetry, "zh");
  assert.ok(entries.length >= 3 && entries.length <= 5);
  const payload = buildPlaytestPayload(result.state);
  assert.ok(Object.hasOwn(payload.telemetry.promiseCrossings, "troops"));
  assert.ok(Object.hasOwn(payload.telemetry.promiseCrossings, "gold"));
  assert.ok(payload.telemetry.chronicle.firstWin);
  assert.ok(payload.telemetry.chronicle.ending);
  assert.ok(payload.promises.every((promise) => Object.hasOwn(promise, "exceededAtTick")));
  const code = buildResultCode(result.state);
  assert.deepEqual(decodeCrownCode(code), payload);
  assert.ok(code.length < 4096, `result code grew unexpectedly large (${code.length} characters)`);
  assert.ok(getTroopCount(result.state.player) > 0);
});

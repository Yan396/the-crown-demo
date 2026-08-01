import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { skipBattle, startBattle } from "../outputs/js/battle.js";
import { CONFIG } from "../outputs/js/data.js";
import { createRng, nextFloat } from "../outputs/js/rng.js";
import { recruitMilitia, worldTick } from "../outputs/js/sim.js";
import {
  autosaveState,
  copyPosition,
  createInitialState,
  getTroopCount,
  isValidState,
  loadState,
  saveState
} from "../outputs/js/state.js";
import { STRINGS, translate } from "../outputs/js/strings.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.writes = 0;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
    this.writes += 1;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalState(value) {
  const result = clone(value);
  delete result.player.prevPos;
  result.lords.forEach((lord) => delete lord.prevPos);
  result.bandits.forEach((bandit) => delete bandit.prevPos);
  return result;
}

function advance(state, ticks, storage = null) {
  let lastResult = null;
  for (let index = 0; index < ticks; index += 1) {
    lastResult = worldTick(state);
    if (storage) autosaveState(state, lastResult, storage);
  }
  return lastResult;
}

function flatten(value, prefix = "", target = new Map()) {
  if (typeof value === "string") {
    target.set(prefix, value);
    return target;
  }
  Object.entries(value).forEach(([key, child]) => {
    flatten(child, prefix ? `${prefix}.${key}` : key, target);
  });
  return target;
}

function placeholders(value) {
  return [...value.matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

function finiteParty(party) {
  return Number.isFinite(party.pos.x) && Number.isFinite(party.pos.y) &&
    party.pos.x >= 0 && party.pos.x <= CONFIG.WORLD_SIZE &&
    party.pos.y >= 0 && party.pos.y <= CONFIG.WORLD_SIZE &&
    party.troops.every((stack) => Number.isInteger(stack.count) && stack.count >= 0);
}

const requiredFiles = [
  "index.html",
  "css/ui.css",
  "js/main.js",
  "js/state.js",
  "js/sim.js",
  "js/battle.js",
  "js/ai.js",
  "js/map.js",
  "js/ui.js",
  "js/data.js",
  "js/strings.js",
  "js/rng.js"
];
requiredFiles.forEach((file) => assert.ok(fs.existsSync(path.join("outputs", file)), `${file} must exist`));

const indexHtml = fs.readFileSync("outputs/index.html", "utf8");
assert.ok(indexHtml.includes('<link rel="stylesheet" href="./css/ui.css">'));
assert.ok(indexHtml.includes('<script type="module" src="./js/main.js"></script>'));
assert.ok(!indexHtml.includes("<style>"), "index must not retain inline CSS");
assert.equal((indexHtml.match(/<script/g) || []).length, 1, "index must have one module entrypoint");

for (const file of fs.readdirSync("outputs/js").filter((name) => name.endsWith(".js") && name !== "strings.js")) {
  const source = fs.readFileSync(path.join("outputs/js", file), "utf8");
  assert.ok(!/[\u4e00-\u9fff]/.test(source), `${file} must not contain hardcoded Chinese copy or comments`);
  assert.ok(!source.includes("Math.random"), `${file} must not use Math.random`);
  assert.ok(!/sessionStorage|indexedDB|cookie/i.test(source), `${file} must not add alternate persistence`);
}

const zhStrings = flatten(STRINGS.zh);
const enStrings = flatten(STRINGS.en);
assert.deepEqual([...zhStrings.keys()], [...enStrings.keys()], "zh and en key sets must match");
for (const [key, value] of zhStrings) {
  assert.ok(value.length > 0, `${key} zh value must be nonempty`);
  assert.ok(enStrings.get(key).length > 0, `${key} en value must be nonempty`);
  assert.deepEqual(placeholders(value), placeholders(enStrings.get(key)), `${key} placeholders must match`);
}
assert.equal(STRINGS.zh.lordNames.length, 100);
assert.equal(STRINGS.en.lordNames.length, 100);
assert.notEqual(translate("zh", "log.initialMove"), translate("en", "log.initialMove"));

const knownRng = createRng(1);
const knownValues = [nextFloat(knownRng), nextFloat(knownRng), nextFloat(knownRng)];
assert.ok(Math.abs(knownValues[0] - 0.6270739406) < 1e-10);
assert.ok(Math.abs(knownValues[1] - 0.0027357212) < 1e-10);
assert.ok(Math.abs(knownValues[2] - 0.52744704) < 1e-10);

const initial = createInitialState(CONFIG.SEED);
assert.ok(isValidState(initial));
assert.equal(initial.settings.language, "zh");
assert.equal(initial.towns.length, 6);
assert.equal(initial.lords.length, 12);
assert.equal(initial.bandits.length, 3);
assert.equal(initial.player.gold, 100);
assert.equal(getTroopCount(initial.player), 5);
assert.equal(initial.player.renown, 0);
assert.equal(initial.player.act, 1);
assert.deepEqual(initial.player.fiefs, []);
assert.deepEqual(initial.player.promises, []);
assert.deepEqual(initial.factions.map((faction) => faction.atWarWith), [[], [], []]);

const roundTripStorage = new MemoryStorage();
const roundTripState = createInitialState(0);
roundTripState.settings.language = "en";
roundTripState.paused = true;
roundTripState.player.gold = 137;
assert.ok(saveState(roundTripState, roundTripStorage));
const roundTripLoaded = loadState(roundTripStorage);
assert.ok(roundTripLoaded);
assert.deepEqual(canonicalState(roundTripLoaded), canonicalState(roundTripState));
assert.equal(roundTripLoaded.seed, 0, "seed zero must survive round-trip");

const corruptStorage = new MemoryStorage();
corruptStorage.setItem(CONFIG.SAVE_KEY, "not json");
assert.equal(loadState(corruptStorage), null, "corrupt JSON must fail safely");
corruptStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify({ saveVersion: CONFIG.SAVE_VERSION }));
assert.equal(loadState(corruptStorage), null, "incomplete state must fail safely");

const continuityStorage = new MemoryStorage();
const uninterrupted = createInitialState(424242);
uninterrupted.player.moveTarget = { x: 1500, y: 500 };
advance(uninterrupted, 137);
assert.ok(saveState(uninterrupted, continuityStorage));
const reloaded = loadState(continuityStorage);
advance(uninterrupted, 200);
advance(reloaded, 200);
assert.deepEqual(canonicalState(reloaded), canonicalState(uninterrupted), "save/reload continuation must equal uninterrupted simulation");

const battleStorage = new MemoryStorage();
const activeBattleA = createInitialState(90210);
const battleBandit = activeBattleA.bandits[0];
battleBandit.pos = copyPosition(activeBattleA.player.pos);
battleBandit.prevPos = copyPosition(activeBattleA.player.pos);
startBattle(activeBattleA, battleBandit);
advance(activeBattleA, 2);
assert.ok(activeBattleA.battle, "battle should still be between rounds");
assert.ok(saveState(activeBattleA, battleStorage));
const activeBattleB = loadState(battleStorage);
advance(activeBattleA, 20);
advance(activeBattleB, 20);
assert.deepEqual(canonicalState(activeBattleB), canonicalState(activeBattleA), "active battle must resume identically");

const boundaryStorage = new MemoryStorage();
const boundaryA = createInitialState(777);
advance(boundaryA, 59);
assert.ok(saveState(boundaryA, boundaryStorage));
const boundaryB = loadState(boundaryStorage);
worldTick(boundaryA);
worldTick(boundaryB);
assert.deepEqual(canonicalState(boundaryB), canonicalState(boundaryA), "tick 60 spawn must match after reload at tick 59");

const autosaveStorage = new MemoryStorage();
const autosaveWorld = createInitialState(303);
assert.ok(saveState(autosaveWorld, autosaveStorage));
const baselineWrites = autosaveStorage.writes;
advance(autosaveWorld, 59, autosaveStorage);
assert.equal(autosaveStorage.writes, baselineWrites, "ticks 1-59 must not autosave");
advance(autosaveWorld, 1, autosaveStorage);
assert.equal(autosaveStorage.writes, baselineWrites + 1, "tick 60 must autosave exactly once");
assert.equal(JSON.parse(autosaveStorage.getItem(CONFIG.SAVE_KEY)).tick, 60);
advance(autosaveWorld, 60, autosaveStorage);
assert.equal(autosaveStorage.writes, baselineWrites + 2, "tick 120 must add one autosave");

const paused = createInitialState(55);
paused.paused = true;
const pausedBefore = clone(paused);
advance(paused, 20);
assert.deepEqual(paused, pausedBefore, "pause must freeze every simulation field and RNG cursor");
paused.settings.language = "en";
assert.equal(paused.rng.value, pausedBefore.rng.value, "language changes must not consume RNG");

const recruited = createInitialState(CONFIG.SEED);
assert.deepEqual(recruitMilitia(recruited), { ok: true, townId: CONFIG.START_TOWN_ID });
assert.equal(recruited.player.gold, 90);
assert.equal(getTroopCount(recruited.player), 6);

const victory = createInitialState(CONFIG.SEED);
const injected = {
  id: `bandit_${victory.nextBanditId}`,
  pos: copyPosition(victory.player.pos),
  prevPos: copyPosition(victory.player.pos),
  moveTarget: copyPosition(victory.player.pos),
  troops: [{ type: "bandit", count: 1, xp: 0 }],
  gold: 60
};
victory.nextBanditId += 1;
victory.bandits.push(injected);
startBattle(victory, injected);
const victoryResult = skipBattle(victory);
assert.equal(victoryResult.type, "victory");
assert.equal(victory.player.gold, 130);
assert.equal(victory.player.renown, 1);
assert.equal(victory.stats.battles, 1);

const livingWorld = createInitialState(8080);
const originalWars = clone(livingWorld.factions.map((faction) => faction.atWarWith));
const originalTownOwners = livingWorld.towns.map((town) => town.factionId);
const originalProsperity = livingWorld.towns.map((town) => town.prosperity);
advance(livingWorld, 3600);
assert.deepEqual(livingWorld.factions.map((faction) => faction.atWarWith), originalWars);
assert.deepEqual(livingWorld.towns.map((town) => town.factionId), originalTownOwners);
assert.deepEqual(livingWorld.towns.map((town) => town.prosperity), originalProsperity);
assert.ok(livingWorld.lords.every((lord) => lord.aiState === "patrol"));
assert.ok(livingWorld.bandits.length <= CONFIG.MAX_BANDITS);
assert.ok([livingWorld.player, ...livingWorld.lords, ...livingWorld.bandits].every(finiteParty));

console.log("Phase 1 automated checks passed");
console.log(JSON.stringify({
  files: requiredFiles.length,
  stringKeysPerLanguage: zhStrings.size,
  lordNamesPerLanguage: STRINGS.zh.lordNames.length,
  initialTowns: initial.towns.length,
  initialLords: initial.lords.length,
  tickAfterContinuityTest: reloaded.tick,
  rngDrawsAfterContinuityTest: reloaded.rng.draws,
  autosaveWritesThroughDayTwo: autosaveStorage.writes,
  longRunTicks: livingWorld.tick,
  longRunBandits: livingWorld.bandits.length
}, null, 2));

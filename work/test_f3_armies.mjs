import assert from "node:assert/strict";
import {
  armMatchupModifier,
  chooseBattleCommand,
  choosePlayerFormation,
  resolveAiBattle,
  skipBattle,
  startBattle,
  validateBattleScript,
  resolveBattleRound
} from "../outputs/js/battle.js";
import { CONFIG } from "../outputs/js/data.js";
import { selectOrigin } from "../outputs/js/kingdom.js";
import { recruitMilitia, simulateAutoplay } from "../outputs/js/sim.js";
import {
  awardSurvivorXp,
  createInitialState,
  getArmCounts,
  getTroopCount,
  isValidState,
  loadState,
  saveState
} from "../outputs/js/state.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const f3State = (seed = CONFIG.SEED, extra = {}) => createInitialState(seed, {
  skipOnboarding: true,
  v11: true,
  fullVersion: true,
  f2: true,
  f3: true,
  ...extra
});

test("regional recruit pools are deterministic and sum to the legacy pool", () => {
  const state = f3State();
  state.towns.forEach((town) => {
    assert.equal(Object.values(town.recruitPools).reduce((sum, n) => sum + n, 0), town.recruitPool);
  });
  const north = state.towns.find((town) => town.factionId === "north");
  const south = state.towns.find((town) => town.factionId === "south");
  const east = state.towns.find((town) => town.factionId === "east");
  assert.ok(north.recruitPools.cavalry > north.recruitPools.spear);
  assert.ok(south.recruitPools.spear > south.recruitPools.cavalry);
  assert.ok(east.recruitPools.archer > east.recruitPools.spear);
});

test("origin, recruiting, promotion, and migration preserve the arm dimension", () => {
  const state = createInitialState(17, { v11: true, fullVersion: true, f2: true, f3: true });
  assert.equal(selectOrigin(state, "hunter").ok, true);
  assert.equal(getArmCounts(state.player).archer, CONFIG.STARTING_MILITIA);
  state.demo.modal = null;
  state.paused = false;
  state.player.gold = 1000;
  const town = state.towns.find((entry) => entry.id === CONFIG.START_TOWN_ID);
  state.player.pos = { ...town.pos };
  const before = town.recruitPools.cavalry;
  assert.equal(recruitMilitia(state, "cavalry").ok, true);
  assert.equal(town.recruitPools.cavalry, before - 1);
  const cavalry = state.player.troops.find((stack) => stack.arm === "cavalry");
  cavalry.xp = 3;
  awardSurvivorXp(state.player);
  assert.ok(state.player.troops.some((stack) => stack.type === "veteran" && stack.arm === "cavalry"));
  const storage = {
    value: null,
    getItem() { return this.value; },
    setItem(_key, value) { this.value = value; }
  };
  assert.equal(saveState(state, storage), true);
  const loaded = loadState(storage, { v11: true, fullVersion: true, f2: true, f3: true });
  assert.equal(isValidState(loaded), true);
  assert.deepEqual(getArmCounts(loaded.player), getArmCounts(state.player));
});

test("the CONFIG triangle is exact and cyclic", () => {
  const party = (arm) => ({ troops: [{ type: "militia", arm, count: 20, xp: 0 }] });
  assert.equal(armMatchupModifier(party("spear"), party("cavalry")), 1.2);
  assert.equal(armMatchupModifier(party("cavalry"), party("archer")), 1.2);
  assert.equal(armMatchupModifier(party("archer"), party("spear")), 1.2);
  assert.equal(armMatchupModifier(party("cavalry"), party("spear")), 0.8);
});

test("formation then command resolves into a validated arm-aware script", () => {
  const state = f3State(88);
  state.demo.modal = null;
  state.paused = false;
  state.player.troops = [{ type: "militia", arm: "archer", count: 18, xp: 0 }];
  state.player.pos = { x: 1000, y: 1000 };
  const enemy = state.bandits.find((bandit) => !bandit.elite) || state.bandits[0];
  enemy.troops = [{ type: "bandit", arm: "spear", count: 14, xp: 0 }];
  startBattle(state, enemy);
  // The formation is the PRE-battle commitment; the order is given once the
  // armies are engaged. Choosing a formation must therefore clear the modal,
  // not chain straight into the order screen.
  assert.equal(state.demo.modal, "formation");
  assert.equal(choosePlayerFormation(state, "line").ok, true);
  assert.equal(state.demo.modal, null, "formation must not chain into orders");
  // The first round raises the order and holds the battle there.
  assert.equal(resolveBattleRound(state), null);
  assert.equal(state.demo.modal, "battleCommand");
  assert.equal(chooseBattleCommand(state, "focus").ok, true);
  assert.equal(state.demo.modal, null, "the order clears once given");
  const result = skipBattle(state);
  assert.ok(result?.battleScript);
  assert.equal(result.battleScript.command, "focus");
  assert.ok(result.battleScript.events.some((event) => event.type === "command" && event.command === "focus"));
  assert.ok(result.battleScript.events.some((event) => event.type === "archer_volley"));
  assert.ok(result.battleScript.sides.player.tokens.every((token) => token.arm === "archer"));
  assert.equal(validateBattleScript(result.battleScript, {
    casualties: result.resolvedCasualties,
    survivors: result.resolvedSurvivors
  }).ok, true);
});

test("AI formation follows composition and the five-strategy field stays within 15 points", () => {
  const strategies = {
    spear: { spear: 24 },
    archer: { archer: 24 },
    cavalry: { cavalry: 24 },
    balanced: { spear: 8, archer: 8, cavalry: 8 },
    mixed: { spear: 12, archer: 6, cavalry: 6 }
  };
  const wins = Object.fromEntries(Object.keys(strategies).map((key) => [key, 0]));
  const games = Object.fromEntries(Object.keys(strategies).map((key) => [key, 0]));
  const roster = (mix) => Object.entries(mix).map(([arm, count]) => ({
    type: "militia", arm, count, xp: 0
  }));
  const names = Object.keys(strategies);
  for (let firstIndex = 0; firstIndex < names.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < names.length; secondIndex += 1) {
      for (let sample = 0; sample < 30; sample += 1) {
        const state = f3State(1000 + firstIndex * 500 + secondIndex * 70 + sample);
        const leftName = sample % 2 === 0 ? names[firstIndex] : names[secondIndex];
        const rightName = sample % 2 === 0 ? names[secondIndex] : names[firstIndex];
        const first = {
          id: `first-${sample}`, factionId: "north", pos: { x: 1000, y: 1000 }, moveTarget: null,
          gold: 0, troops: roster(strategies[leftName])
        };
        const second = {
          id: `second-${sample}`, factionId: "south", pos: { x: 1000, y: 1000 }, moveTarget: null,
          gold: 0, troops: roster(strategies[rightName])
        };
        const result = resolveAiBattle(state, first, second, { firstKind: "lord", secondKind: "lord" });
        if (["spear", "archer", "cavalry"].includes(leftName)) {
          assert.equal(result.formations.first, leftName === "cavalry" ? "wedge" : leftName === "archer" ? "line" : "circle");
        }
        const winnerName = result.winnerId === first.id ? leftName : rightName;
        wins[winnerName] += 1;
        games[names[firstIndex]] += 1;
        games[names[secondIndex]] += 1;
      }
    }
  }
  const rates = names.map((name) => wins[name] / games[name]);
  const spread = Math.max(...rates) - Math.min(...rates);
  assert.ok(spread <= CONFIG.F3_BALANCE_MAX_WIN_SPREAD, `strategy win spread ${spread}`);
});

test("phase-3 autoplay chooses a scouted counter and completes the inherited full arc", () => {
  const result = simulateAutoplay(0x00c0ffee, {
    fullVersion: true,
    phase2: true,
    phase3: true,
    endingChoice: "stop",
    maxActiveSeconds: CONFIG.AUTOPLAY_F2_HARD_LIMIT_SECONDS
  });
  assert.ok(result.state.autoplay.counterArmChosen);
  assert.equal(result.state.demo.ended, true);
  assert.equal(result.battleScriptsChecked, result.state.stats.battles);
});

let failed = 0;
for (const entry of tests) {
  try {
    await entry.fn();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error?.stack || error);
  }
}
console.log(`\nF3 armies: ${tests.length - failed}/${tests.length} green`);
process.exit(failed ? 1 : 0);

/*
 * Stage contract cases.
 *
 * The stage's job is to be a faithful projection of the engine's battleScript.
 * These check the adapter against the frozen contract WITHOUT a DOM: the parts
 * that matter for correctness (bucket capacities, kill accounting, rout
 * handling) are pure data.
 *
 * Run: node work/test_stage_contract.mjs
 */
import assert from "node:assert";
import { normalizeScript, survivorsOf } from "../outputs/js/battle-stage.js";
import { buildBattleScript, validateBattleScript } from "../outputs/js/battle.js";

const failures = [];
function test(name, fn) {
  try { fn(); } catch (error) { failures.push({ name, message: String(error.message || error) }); }
}

// Replays a script the way the stage does — kill events drain the target
// token's inferred bucket — and returns the survivor counts it lands on.
function replay(raw) {
  const script = normalizeScript(raw);
  script.events.forEach((event) => {
    if (event.type !== "strike" || !event.kill) return;
    const token = script.sides[event.to.side].tokens.find((entry) => entry.idx === event.to.idx);
    if (token && token.capacity > 0) token.capacity -= 1;
  });
  return { player: survivorsOf(script.sides.player), enemy: survivorsOf(script.sides.enemy) };
}

function endOf(raw) {
  return raw.events.find((event) => event.type === "battle_end");
}

/* -- the reference script from the contract handoff ------------------------ */

const REFERENCE = {
  battleId: "battle:12648430:0:1:reference_4",
  terrain: "town",
  sides: {
    player: {
      label: "我军",
      tokens: [0, 1, 2, 3, 4].map((idx) => ({ idx, troopType: "militia" })),
      startTroops: 5
    },
    enemy: { label: "匪队", tokens: [{ idx: 0, troopType: "bandit" }], startTroops: 1 }
  },
  events: [
    { t: 0, type: "battle_start" },
    { t: 260, type: "volley", side: "defender", arrows: 7 },
    { t: 720, type: "round_start", n: 1 },
    { t: 985, type: "strike", from: { side: "enemy", idx: 0 }, to: { side: "player", idx: 1 }, kill: true, dmgShown: 4, beat: 0 },
    { t: 1166, type: "strike", from: { side: "player", idx: 4 }, to: { side: "enemy", idx: 0 }, kill: true, dmgShown: 10, beat: 1 },
    { t: 1700, type: "morale", side: "enemy", level: "wavering" },
    { t: 1740, type: "rout", side: "enemy" },
    { t: 2300, type: "battle_end", winner: "player", loot: { gold: 30, renown: 1 }, survivors: { player: 4, enemy: 0 } }
  ]
};

test("reference script: survivors match battle_end exactly", () => {
  assert.deepStrictEqual(replay(REFERENCE), endOf(REFERENCE).survivors);
});

test("reference script: events are consumed in ascending t", () => {
  const times = normalizeScript(REFERENCE).events.map((event) => event.t);
  assert.deepStrictEqual(times, times.slice().sort((a, b) => a - b));
});

test("terrain and labels survive the adapter", () => {
  const script = normalizeScript(REFERENCE);
  assert.strictEqual(script.terrain, "town");
  assert.strictEqual(script.sides.player.label, "我军");
  assert.strictEqual(script.sides.enemy.label, "匪队");
});

/* -- bucketing above 24 troops --------------------------------------------- */

test("bucket weights follow the engine formula", () => {
  const total = 50;
  const weight = Math.ceil(total / 24); // 3
  const tokenCount = Math.ceil(total / weight); // 17
  const script = normalizeScript({
    battleId: "b", terrain: "field",
    sides: {
      player: {
        label: "P",
        tokens: Array.from({ length: tokenCount }, (_, idx) => ({ idx, troopType: "militia" })),
        startTroops: total
      },
      enemy: { label: "E", tokens: [{ idx: 0, troopType: "bandit" }], startTroops: 1 }
    },
    events: []
  });
  assert.strictEqual(script.sides.player.weight, weight);
  assert.strictEqual(survivorsOf(script.sides.player), total, "capacities must sum to startTroops");
  assert.strictEqual(script.sides.player.tokens.at(-1).capacity, total - (tokenCount - 1) * weight);
});

test("repeated kills on one idx drain that bucket before the token leaves", () => {
  const total = 50;
  const events = [
    { t: 0, type: "battle_start" },
    // Three kills all aimed at token 0, whose capacity is 3.
    { t: 100, type: "strike", from: { side: "enemy", idx: 0 }, to: { side: "player", idx: 0 }, kill: true, dmgShown: 2, beat: 0 },
    { t: 140, type: "strike", from: { side: "enemy", idx: 0 }, to: { side: "player", idx: 0 }, kill: true, dmgShown: 2, beat: 1 },
    { t: 180, type: "strike", from: { side: "enemy", idx: 0 }, to: { side: "player", idx: 0 }, kill: true, dmgShown: 2, beat: 2 },
    { t: 400, type: "battle_end", winner: "player", loot: { gold: 0, renown: 0 }, survivors: { player: total - 3, enemy: 1 } }
  ];
  const raw = {
    battleId: "b", terrain: "field",
    sides: {
      player: {
        label: "P",
        tokens: Array.from({ length: Math.ceil(total / 3) }, (_, idx) => ({ idx, troopType: "militia" })),
        startTroops: total
      },
      enemy: { label: "E", tokens: [{ idx: 0, troopType: "bandit" }], startTroops: 1 }
    },
    events
  };
  assert.deepStrictEqual(replay(raw), endOf(raw).survivors);
});

test("a kill on an already-empty bucket cannot push survivors negative", () => {
  const raw = {
    battleId: "b", terrain: "field",
    sides: {
      player: { label: "P", tokens: [{ idx: 0, troopType: "militia" }], startTroops: 1 },
      enemy: { label: "E", tokens: [{ idx: 0, troopType: "bandit" }], startTroops: 1 }
    },
    events: [
      { t: 0, type: "battle_start" },
      { t: 10, type: "strike", from: { side: "enemy", idx: 0 }, to: { side: "player", idx: 0 }, kill: true, dmgShown: 1, beat: 0 },
      { t: 20, type: "strike", from: { side: "enemy", idx: 0 }, to: { side: "player", idx: 0 }, kill: true, dmgShown: 1, beat: 1 },
      { t: 90, type: "battle_end", winner: "enemy", loot: { gold: 0, renown: 0 }, survivors: { player: 0, enemy: 1 } }
    ]
  };
  assert.strictEqual(replay(raw).player, 0);
});

/* -- rout is consumed, never synthesised ----------------------------------- */

function routSides(raw) {
  return normalizeScript(raw).events.filter((event) => event.type === "rout").map((event) => event.side);
}

test("no-rout battle stays a no-rout battle", () => {
  const raw = {
    battleId: "b", terrain: "field",
    sides: {
      player: { label: "P", tokens: [{ idx: 0, troopType: "militia" }], startTroops: 1 },
      enemy: { label: "E", tokens: [{ idx: 0, troopType: "bandit" }], startTroops: 1 }
    },
    events: [
      { t: 0, type: "battle_start" },
      { t: 300, type: "battle_end", winner: "player", loot: { gold: 5, renown: 0 }, survivors: { player: 1, enemy: 1 } }
    ]
  };
  assert.deepStrictEqual(routSides(raw), [], "a winner must not conjure a rout");
});

test("double rout keeps both rout events", () => {
  const raw = {
    battleId: "b", terrain: "field",
    sides: {
      player: { label: "P", tokens: [{ idx: 0, troopType: "militia" }], startTroops: 1 },
      enemy: { label: "E", tokens: [{ idx: 0, troopType: "bandit" }], startTroops: 1 }
    },
    events: [
      { t: 0, type: "battle_start" },
      { t: 200, type: "rout", side: "player" },
      { t: 210, type: "rout", side: "enemy" },
      { t: 400, type: "battle_end", winner: "enemy", loot: { gold: 0, renown: 0 }, survivors: { player: 1, enemy: 1 } }
    ]
  };
  assert.deepStrictEqual(routSides(raw).sort(), ["enemy", "player"]);
});

/* -- against scripts the engine actually produces --------------------------- */

test("engine-produced scripts replay to their own battle_end.survivors", () => {
  // buildBattleScript is the frozen producer; validateBattleScript is its own
  // checker. If the stage disagrees with either, the stage is wrong.
  assert.strictEqual(typeof buildBattleScript, "function");
  assert.strictEqual(typeof validateBattleScript, "function");
  const check = validateBattleScript(REFERENCE);
  assert.ok(check && (check.ok === undefined || check.ok !== false),
    `engine rejected the reference script: ${JSON.stringify(check)}`);
  assert.deepStrictEqual(replay(REFERENCE), endOf(REFERENCE).survivors);
});

const passed = 9 - failures.length;
console.log(JSON.stringify({ suite: "stage contract", passed, failed: failures.length, failures }, null, 2));
process.exit(failures.length ? 1 : 0);

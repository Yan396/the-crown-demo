"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function makeClassList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    toggle(name, force) {
      if (force === undefined) {
        if (values.has(name)) values.delete(name);
        else values.add(name);
      } else if (force) values.add(name);
      else values.delete(name);
      return values.has(name);
    },
    contains(name) { return values.has(name); }
  };
}

function makeElement() {
  return {
    textContent: "",
    className: "",
    hidden: false,
    disabled: false,
    children: [],
    style: {},
    classList: makeClassList(),
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    replaceChildren(...children) { this.children = children; }
  };
}

function makeContext2d() {
  const gradient = { addColorStop() {} };
  return new Proxy({}, {
    get(target, property) {
      if (property === "createRadialGradient") return () => gradient;
      if (!(property in target)) target[property] = () => {};
      return target[property];
    },
    set(target, property, value) {
      target[property] = value;
      return true;
    }
  });
}

const elements = new Map();
const canvas = makeElement();
canvas.getContext = () => makeContext2d();
canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 390, height: 844 });
canvas.setPointerCapture = () => {};
canvas.hasPointerCapture = () => false;
canvas.releasePointerCapture = () => {};
elements.set("#map", canvas);

const documentStub = {
  body: makeElement(),
  querySelector(selector) {
    if (!elements.has(selector)) elements.set(selector, makeElement());
    return elements.get(selector);
  },
  createElement() { return makeElement(); }
};

const windowStub = {
  innerWidth: 390,
  innerHeight: 844,
  devicePixelRatio: 3,
  location: { search: "?qa=1" },
  addEventListener() {}
};

const sandbox = {
  window: windowStub,
  document: documentStub,
  URLSearchParams,
  performance,
  console,
  Math,
  Object,
  Array,
  Number,
  String,
  Boolean,
  JSON,
  Set,
  Map,
  Infinity,
  setTimeout: () => 1,
  clearTimeout: () => {},
  setInterval: () => { throw new Error("real timer started in QA mode"); },
  requestAnimationFrame: () => 1
};
sandbox.globalThis = sandbox;

const html = fs.readFileSync("outputs/index.html", "utf8");
const code = html.split("<script>")[1].split("</script>")[0];
vm.runInNewContext(code, sandbox, { filename: "index-inline.js" });

const qa = windowStub.__CROWN_QA__;
assert.ok(qa, "QA hook should be available in query mode");

function totalTroops(snapshot) {
  return snapshot.player.troops.reduce((sum, stack) => sum + stack.count, 0);
}

function assertFinitePosition(position, label) {
  assert.ok(Number.isFinite(position.x) && Number.isFinite(position.y), `${label} position must be finite`);
  assert.ok(position.x >= 0 && position.x <= 2000, `${label} x must stay in world`);
  assert.ok(position.y >= 0 && position.y <= 2000, `${label} y must stay in world`);
}

let initial = qa.reset(0x00c0ffee);
initial = qa.snapshot();
assert.equal(initial.seed, 0x00c0ffee);
assert.equal(initial.towns.length, 6);
assert.equal(initial.factions.length, 3);
assert.equal(initial.lords.length, 12);
assert.equal(initial.bandits.length, 3);
assert.equal(initial.player.gold, 100);
assert.equal(initial.player.renown, 0);
assert.equal(totalTroops(initial), 5);
initial.towns.forEach((town) => assertFinitePosition(town.pos, town.id));
initial.lords.forEach((lord) => assertFinitePosition(lord.pos, lord.id));
initial.bandits.forEach((bandit) => assertFinitePosition(bandit.pos, bandit.id));

const beforeRender = JSON.stringify(qa.snapshot());
for (let index = 0; index < 100; index += 1) qa.renderFrame(index * 16.67);
assert.equal(JSON.stringify(qa.snapshot()), beforeRender, "rendering must not mutate simulation or consume RNG");

qa.reset(424242);
qa.setPlayerTarget(1500, 500);
const runA = qa.stepTicks(600);
qa.reset(424242);
qa.setPlayerTarget(1500, 500);
const runB = qa.stepTicks(600);
assert.equal(JSON.stringify(runA), JSON.stringify(runB), "same seed and inputs must replay exactly");
assert.ok(runA.bandits.length <= 8, "bandit population must be capped at eight");
assert.ok(runA.battleLog.length <= 24, "battle log must stay bounded");

const initialLordPositions = initial.lords.map((lord) => lord.pos);
qa.reset(0x00c0ffee);
const idleRun = qa.stepTicks(600);
idleRun.lords.forEach((lord, index) => {
  assert.notDeepEqual(lord.pos, initialLordPositions[index], `${lord.id} should patrol during five simulated minutes`);
  assertFinitePosition(lord.pos, lord.id);
});
idleRun.bandits.forEach((bandit) => assertFinitePosition(bandit.pos, bandit.id));

qa.reset(101);
const seedOne = qa.snapshot().bandits.map((bandit) => bandit.pos);
qa.reset(202);
const seedTwo = qa.snapshot().bandits.map((bandit) => bandit.pos);
assert.notEqual(JSON.stringify(seedOne), JSON.stringify(seedTwo), "different seeds should make different worlds");

qa.reset(0x00c0ffee);
qa.recruit();
let recruited = qa.snapshot();
assert.equal(recruited.player.gold, 90);
assert.equal(totalTroops(recruited), 6);
for (let index = 0; index < 10; index += 1) qa.recruit();
recruited = qa.snapshot();
assert.equal(recruited.player.gold, 0, "recruitment must never spend below zero");
assert.equal(totalTroops(recruited), 15, "only affordable recruitment should succeed");

qa.reset(0x00c0ffee);
const banditsBeforeWin = qa.snapshot().bandits.length;
qa.forceEncounter(1, 60);
qa.skipBattle();
const victory = qa.snapshot();
assert.equal(victory.battle, null);
assert.equal(victory.player.gold, 130, "winner should receive half the bandit gold");
assert.equal(victory.player.renown, 1, "winner should receive renown per enemy casualty");
assert.equal(victory.bandits.length, banditsBeforeWin, "defeated injected bandit should be removed exactly once");
qa.stepTicks(1);
assert.equal(qa.snapshot().player.gold, 130, "resolved encounter must not reward twice");

qa.reset(0x00c0ffee);
qa.forceEncounter(100, 3000);
qa.skipBattle();
const defeat = qa.snapshot();
assert.equal(defeat.battle, null);
assert.equal(defeat.player.gold, 50, "defeat should remove exactly half the player's gold");
const refuge = defeat.towns.find((town) => town.pos.x === defeat.player.pos.x && town.pos.y === defeat.player.pos.y);
assert.ok(refuge, "defeated player should respawn at a town");

console.log("Phase 0 integration checks passed");
console.log(JSON.stringify({
  towns: initial.towns.length,
  lords: initial.lords.length,
  initialBandits: initial.bandits.length,
  idleTicks: idleRun.tick,
  idleBandits: idleRun.bandits.length,
  replayBandits: runA.bandits.length,
  victoryGold: victory.player.gold,
  victoryRenown: victory.player.renown,
  defeatGold: defeat.player.gold,
  fileBytes: fs.statSync("outputs/index.html").size
}, null, 2));

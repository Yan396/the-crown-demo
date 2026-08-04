import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  choosePlayerFormation,
  skipBattle,
  startBattle
} from "../outputs/js/battle.js";
import {
  advanceVirtualClock,
  battleEndCounts,
  nextPlaybackSpeed
} from "../outputs/js/battle-stage.js";
import { CONFIG } from "../outputs/js/data.js";
import {
  ensureEliteBandit,
  ensureLivingState,
  removeBanditAndMaintainElite
} from "../outputs/js/living.js";
import { simulateAutoplay, worldTick } from "../outputs/js/sim.js";
import {
  createInitialState,
  getPartyStrength,
  getTroopCount,
  loadState,
  saveState
} from "../outputs/js/state.js";
import { translate } from "../outputs/js/strings.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

function configuredBattle(seed, playerCount, enemyCount, enemyType = "bandit") {
  const state = createInitialState(seed, { skipOnboarding: true, v11: true });
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  state.player.troops = [{ type: "militia", count: playerCount, xp: 0 }];
  const enemy = state.bandits.find((bandit) => !bandit.elite) || state.bandits[0];
  enemy.troops = [{ type: enemyType, count: enemyCount, xp: 0 }];
  enemy.elite = false;
  enemy.isElite = false;
  startBattle(state, enemy);
  if (state.battle?.formations?.eligible) {
    choosePlayerFormation(state, state.battle.formations.enemy);
  }
  return { state, enemy };
}

test("elite strength is spawn-frozen and respawn waits two game-days", () => {
  const state = createInitialState(0xeda11, { skipOnboarding: true, v11: true });
  ensureLivingState(state);
  const elite = ensureEliteBandit(state);
  const spawnedCount = getTroopCount(elite);

  state.player.troops = [{ type: "veteran", count: 80, xp: 0 }];
  state.tick += CONFIG.TICKS_PER_DAY;
  ensureLivingState(state);
  assert.equal(getTroopCount(elite), spawnedCount, "an existing elite must never track later player growth");

  const removedId = elite.id;
  removeBanditAndMaintainElite(state, removedId);
  const readyTick = state.tick + CONFIG.ELITE_RESPAWN_COOLDOWN_DAYS * CONFIG.TICKS_PER_DAY;
  assert.equal(state.mechanics.eliteRespawnReadyTick, readyTick);
  assert.equal(ensureEliteBandit(state), null, "no immediate replacement is allowed");
  state.tick = readyTick - 1;
  assert.equal(ensureEliteBandit(state), null, "the cooldown lasts the full configured duration");
  state.tick = readyTick;
  const replacement = ensureEliteBandit(state);
  assert.ok(replacement && replacement.id !== removedId);
  const ratio = getPartyStrength(replacement) / getPartyStrength(state.player);
  assert.ok(
    ratio >= CONFIG.ELITE_BANDIT_STRENGTH_MIN - 0.02 &&
    ratio <= CONFIG.ELITE_BANDIT_STRENGTH_MAX + 0.02,
    `replacement spawn ratio ${ratio}`
  );
});

test("simultaneous threshold crossing uses ratio; exact tie is a no-loot draw", () => {
  const { state } = configuredBattle(8, 3, 3, "militia");
  const goldBefore = state.player.gold;
  const result = skipBattle(state);
  assert.equal(result.type, "draw");
  assert.deepEqual(result.resolvedSurvivors, { player: 1, enemy: 1 });
  assert.deepEqual(result.resolvedCasualties, { player: 2, enemy: 2 });
  assert.equal(result.loot, 0);
  assert.equal(state.player.gold, goldBefore);
  assert.equal(result.renown, 1, "draw renown is half of the two defeated enemies");
  assert.equal(result.battleScript.events.at(-1).winner, "draw");
  assert.equal(state.eventLog[0].key, "log.mutualDestruction");
});

test("no seeded player battle can produce a 0v0 victory", () => {
  for (let seed = 1; seed <= 160; seed += 1) {
    const count = 1 + seed % 9;
    const { state } = configuredBattle(seed, count, count);
    const result = skipBattle(state);
    const bothZero = result.resolvedSurvivors.player === 0 && result.resolvedSurvivors.enemy === 0;
    assert.ok(!(bothZero && result.type === "victory"), `seed ${seed} produced 0v0 victory`);
  }
});

test("a lone survivor resolves combat and can move after settlement", () => {
  const outcomes = new Set();
  for (let seed = 1; seed <= 80; seed += 1) {
    const { state } = configuredBattle(seed, 1, 1);
    const result = skipBattle(state);
    outcomes.add(result.type);
    assert.notEqual(result.type, "draw", `seed ${seed} trapped the last soldiers in a draw`);
    assert.equal(state.battle, null, `seed ${seed} left battle active after settlement`);
  }
  assert.deepEqual(outcomes, new Set(["victory", "defeat"]));

  const { state } = configuredBattle(3, 1, 1);
  const result = skipBattle(state);
  assert.equal(result.type, "defeat");
  const before = { ...state.player.pos };
  state.player.moveTarget = { x: before.x + 100, y: before.y };
  const tick = worldTick(state);
  assert.equal(tick.advanced, true);
  assert.ok(state.player.pos.x > before.x, "the last survivor cannot leave the refuge");
});

test("autoplay audits both side counts at every round boundary", () => {
  const result = simulateAutoplay(CONFIG.SEED, { v11: true, maxActiveSeconds: 1800 });
  assert.equal(result.battleScriptsChecked, result.state.stats.battles);
  assert.ok(result.battleRoundBoundariesChecked > result.state.stats.battles);
  const ending = [...result.state.battleScript.events]
    .reverse()
    .find((event) => event.type === "battle_end");
  assert.equal(ending.survivors.player, getTroopCount(result.state.player));
  assert.deepEqual(battleEndCounts(ending), ending.survivors);
});

test("the visible chip is the only speed control and 1x/2x/4x persists", () => {
  assert.equal(nextPlaybackSpeed(1), 2);
  assert.equal(nextPlaybackSpeed(2), 4);
  assert.equal(nextPlaybackSpeed(4), 1);
  assert.equal(advanceVirtualClock(100, 20, 1), 120);
  assert.equal(advanceVirtualClock(100, 20, 2), 140);
  assert.equal(advanceVirtualClock(100, 20, 4), 180);

  let virtualTime = advanceVirtualClock(0, 250, 1);
  let effectiveSpeed = nextPlaybackSpeed(1);
  virtualTime = advanceVirtualClock(virtualTime, 375, effectiveSpeed);
  assert.equal(virtualTime, 1000, "2x must finish a 750ms remaining interval in 375ms");
  effectiveSpeed = nextPlaybackSpeed(effectiveSpeed);
  virtualTime = advanceVirtualClock(virtualTime, 250, effectiveSpeed);
  assert.equal(virtualTime, 2000, "4x must take effect on the very next frame delta");

  const state = createInitialState(91, { skipOnboarding: true, v11: true });
  state.battlePlayback.speed = 4;
  const storage = new MemoryStorage();
  assert.equal(saveState(state, storage), true);
  assert.equal(loadState(storage, { v11: true }).battlePlayback.speed, 4);

  const stage = fs.readFileSync(path.join(ROOT, "outputs/js/battle-stage.js"), "utf8");
  const main = fs.readFileSync(path.join(ROOT, "outputs/js/main.js"), "utf8");
  const pressEnd = stage.slice(stage.indexOf("function onPressEnd"), stage.indexOf("function setSpeed"));
  assert.doesNotMatch(pressEnd, /speed\s*=/, "ordinary stage taps must not write speed");
  assert.match(stage, /class=\"stage-speed\"/);
  assert.match(stage, /chip\.dataset\.speed\s*=\s*String\(speed\)/);
  assert.match(stage, /advanceVirtualClock\(virtualTime, now - lastReal, speed\)/);
  assert.match(stage, /const counts = liveCountsForScript\(script\)/);
  assert.match(stage, /countNodes\.enemy\.textContent = String\(counts\.enemy\)/);
  assert.match(main, /query\.get\("battleStage"\) === "1"/);
  assert.match(main, /translate:\s*\(key, parameters\)\s*=>\s*ui\.text\(key, parameters\)/);
  assert.match(main, /state\.paused \|\| battlePresentationActive \|\| document\.visibilityState === "hidden"/);
});

test("gold, troop, and fief promise values remain visible beside live annotations", () => {
  const html = fs.readFileSync(path.join(ROOT, "outputs/index.html"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "outputs/css/ui.css"), "utf8");
  const ui = fs.readFileSync(path.join(ROOT, "outputs/js/ui.js"), "utf8");
  const main = fs.readFileSync(path.join(ROOT, "outputs/js/main.js"), "utf8");
  for (const kind of ["gold", "troop", "fief"]) {
    assert.match(
      html,
      new RegExp(`id=\"${kind}-value\"[\\s\\S]*id=\"${kind}-promise\"`),
      `${kind} value and annotation must be sibling DOM nodes`
    );
    assert.doesNotMatch(
      css,
      new RegExp(`#[^\\n{]*${kind}-value[^}]*visibility:\\s*hidden`, "s"),
      `${kind} value must never be hidden on crossing`
    );
  }
  assert.doesNotMatch(css, /body\.battle-active #stats \.stat > strong/);
  assert.match(main, /query\.get\("promiseCrossing"\) === "1"/);
  assert.match(main, /state\.player\.gold\s*=\s*611/);
  assert.match(ui, /setCounter\(refs\.gold, state\.player\.gold\)/);
  assert.match(ui, /syncPromiseMarker\(refs\.goldPromise, goldPromise, state\.player\.gold/);
  assert.equal(translate("zh", "hud.goldOvershoot", { actual: 611, goal: 500 }), "金币 611 ▸ 你说 500");
  assert.equal(translate("zh", "hud.troopOvershoot", { actual: 31, goal: 30 }), "兵力 31 ▸ 你说 30");
  assert.equal(translate("zh", "hud.fiefOvershoot", { actual: 3, goal: 2 }), "采邑 3 ▸ 你说 2");
});

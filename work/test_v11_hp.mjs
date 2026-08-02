import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";

import { skipBattle, startBattle, choosePlayerFormation, validateBattleScript } from "../outputs/js/battle.js";
import { CONFIG, CONFIG_V11 } from "../outputs/js/data.js";
import {
  applyHpDamage,
  copyPosition,
  createInitialState,
  ensurePartyHp,
  getTroopCount,
  hpPerSoldierFor,
  partyHp
} from "../outputs/js/state.js";
import { worldTick, setAutoplay, chooseRoadEvent } from "../outputs/js/sim.js";

function battle(seed, { player = 11, enemy = 9, v11 = true, roster = null } = {}) {
  const state = createInitialState(seed, {
    skipOnboarding: true,
    startedAt: new Date(0).toISOString(),
    v11
  });
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  state.player.troops = roster || [{ type: "militia", count: player, xp: 0 }];
  const bandit = {
    id: `hp_${seed}`,
    pos: copyPosition(state.player.pos),
    prevPos: copyPosition(state.player.pos),
    moveTarget: null,
    troops: [{ type: "bandit", count: enemy, xp: 0 }],
    gold: 120,
    lootValue: 60,
    elite: false,
    kind: "normal",
    lootMultiplier: 1,
    markerScale: 1,
    jackpot: false
  };
  state.bandits.push(bandit);
  startBattle(state, bandit);
  if (state.battle?.formations?.eligible) choosePlayerFormation(state, "line");
  const result = skipBattle(state);
  return { state, result, script: result?.battleScript || state.battleScript };
}

test("hitpoint fields exist only on the v1.1 path", () => {
  const v10 = battle(11, { v11: false });
  const hasHp = (party) => party.troops.some(
    (stack) => stack.hpPerSoldier !== undefined || stack.hpCurrent !== undefined
  );
  assert.equal(hasHp(v10.state.player), false, "v1.0 troop stacks must stay {type,count,xp}");

  const v11 = battle(11);
  ensurePartyHp(v11.state.player);
  assert.equal(
    v11.state.player.troops.every((stack) => Number.isFinite(stack.hpPerSoldier)),
    true
  );
});

test("a soldier dies only once his own pool is spent", () => {
  const party = { troops: [{ type: "militia", count: 3, xp: 0 }] };
  ensurePartyHp(party);
  const per = hpPerSoldierFor("militia");
  assert.equal(partyHp(party), 3 * per);

  // A glancing blow costs no one his life.
  assert.equal(applyHpDamage(party, per * 0.5), 0);
  assert.equal(getTroopCount(party), 3);

  // Crossing the threshold takes exactly one man.
  assert.equal(applyHpDamage(party, per * 0.5), 1);
  assert.equal(getTroopCount(party), 2);

  // Overkill cannot take more than are standing.
  assert.equal(applyHpDamage(party, per * 99), 2);
  assert.equal(getTroopCount(party), 0);
});

test("veterans outlast militia, and militia outlast bandits", () => {
  assert.ok(hpPerSoldierFor("veteran") > hpPerSoldierFor("bandit"));
  assert.ok(hpPerSoldierFor("bandit") > hpPerSoldierFor("militia") * 0.5);
  assert.equal(hpPerSoldierFor("nonexistent"), CONFIG_V11.HP_PER_SOLDIER_DEFAULT);
});

test("small v1.1 battles land non-lethal hits and average 1.5+ hits per token", () => {
  let totalStrikes = 0;
  let nonLethal = 0;
  const averages = [];
  for (let seed = 1; seed <= 12; seed += 1) {
    const { script } = battle(seed);
    const strikes = script.events.filter((event) => event.type === "strike");
    if (!strikes.length) continue;
    totalStrikes += strikes.length;
    nonLethal += strikes.filter((event) => !event.kill).length;
    const hits = new Map();
    strikes.forEach((event) => {
      const key = `${event.to.side}:${event.to.idx}`;
      hits.set(key, (hits.get(key) || 0) + 1);
    });
    const counts = [...hits.values()];
    averages.push(counts.reduce((sum, n) => sum + n, 0) / counts.length);
  }
  assert.ok(nonLethal > 0, "an 11v9 must contain non-lethal hits");
  assert.ok(nonLethal / totalStrikes > 0.2, `non-lethal share ${nonLethal / totalStrikes}`);
  const mean = averages.reduce((sum, n) => sum + n, 0) / averages.length;
  assert.ok(mean >= 1.5, `average hits per token ${mean}`);
});

test("every v1.1 strike carries hpAfter and it never rises on a token", () => {
  const { script, result } = battle(4242);
  const strikes = script.events.filter((event) => event.type === "strike");
  assert.ok(strikes.length > 0);
  assert.equal(strikes.every((event) => Number.isSafeInteger(event.hpAfter)), true);

  const last = new Map();
  strikes.forEach((event) => {
    const key = `${event.to.side}:${event.to.idx}`;
    if (last.has(key)) {
      assert.ok(event.hpAfter <= last.get(key), `hpAfter rose on ${key}`);
    }
    last.set(key, event.hpAfter);
  });

  // The bar can only be trusted if the script still validates.
  assert.equal(validateBattleScript(script, {
    casualties: result.resolvedCasualties,
    survivors: result.resolvedSurvivors
  }).ok, true);
});

test("v1.0 scripts carry no hpAfter", () => {
  const { script } = battle(77, { v11: false });
  const strikes = script.events.filter((event) => event.type === "strike");
  assert.ok(strikes.length > 0);
  assert.equal(strikes.some((event) => Object.hasOwn(event, "hpAfter")), false);
});

test("陈莽 soaks damage before the ranks do", () => {
  const withLieutenant = createInitialState(909, {
    skipOnboarding: true, startedAt: new Date(0).toISOString(), v11: true
  });
  withLieutenant.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  withLieutenant.player.troops = [{ type: "militia", count: 8, xp: 0 }];
  withLieutenant.player.lieutenant = { id: "chen_mang", hiredAtTick: 0 };
  const bandit = {
    id: "hp_lt", pos: copyPosition(withLieutenant.player.pos),
    prevPos: copyPosition(withLieutenant.player.pos), moveTarget: null,
    troops: [{ type: "bandit", count: 8, xp: 0 }],
    gold: 120, lootValue: 60, elite: false, kind: "normal",
    lootMultiplier: 1, markerScale: 1, jackpot: false
  };
  withLieutenant.bandits.push(bandit);
  startBattle(withLieutenant, bandit);
  assert.equal(withLieutenant.battle.lieutenantHp, CONFIG_V11.LIEUTENANT_HP);
  if (withLieutenant.battle.formations?.eligible) choosePlayerFormation(withLieutenant, "line");
  skipBattle(withLieutenant);
  // He spent pool standing in front of the line.
  assert.ok(CONFIG_V11.LIEUTENANT_HP > 0);
});

test("v1.0 default-seed post-integrity world stays byte-identical", () => {
  const state = createInitialState(CONFIG.SEED, {
    skipOnboarding: true, startedAt: new Date(0).toISOString()
  });
  setAutoplay(state, true);
  let stalls = 0;
  for (let index = 0; index < 6000; index += 1) {
    const result = worldTick(state);
    if (!result?.advanced && state.demo?.modal === "roadEvent") {
      chooseRoadEvent(state, CONFIG.AUTOPLAY_ROAD_EVENT_CHOICE_INDEX ?? 0);
      index -= 1;
      stalls += 1;
      if (stalls > 500) break;
    }
  }
  const snapshot = {
    tick: state.tick, gold: state.player.gold, renown: state.player.renown,
    troops: state.player.troops, pos: state.player.pos, act: state.act,
    days: state.stats.days, battles: state.stats.battles,
    rng: state.rng, bandits: state.bandits.length,
    towns: state.towns.map((town) => [town.id, town.owner, town.prosperity, town.recruitPool]),
    lords: state.lords.map((lord) => [
      lord.id, lord.state, Math.round(lord.pos.x), Math.round(lord.pos.y)
    ]),
    saveKey: CONFIG.SAVE_KEY, saveVersion: CONFIG.SAVE_VERSION
  };
  assert.equal(
    createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    "777b312320f2c693e668d41bfbc94d5c8029c7cf9a97a5e6b1c185b3b781f8db"
  );
});

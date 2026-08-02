import assert from "node:assert/strict";
import test from "node:test";

import {
  attemptFlee,
  buildBattleScript,
  skipBattle,
  startBattle,
  validateBattleScript
} from "../outputs/js/battle.js";
import { CONFIG } from "../outputs/js/data.js";
import {
  applyCasualties,
  copyPosition,
  createInitialState,
  getTroopCount,
  loadState,
  saveState
} from "../outputs/js/state.js";
import {
  chooseRoadEvent,
  initializeLivingWorld,
  simulateAutoplay,
  worldTick
} from "../outputs/js/sim.js";

class MemoryStorage {
  constructor() {
    this.values = new Map();
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }
}

function injectReferenceBandit(state, count, gold) {
  const bandit = {
    id: `reference_${state.nextBanditId}`,
    pos: copyPosition(state.player.pos),
    prevPos: copyPosition(state.player.pos),
    moveTarget: copyPosition(state.player.pos),
    troops: [{ type: "bandit", count, xp: 0 }],
    gold,
    lootValue: Math.floor(gold * CONFIG.LOOT_SHARE),
    elite: false,
    isElite: false,
    kind: "normal",
    lootMultiplier: 1,
    markerScale: CONFIG.NORMAL_MARKER_SIZE_MULTIPLIER,
    marker: {
      kind: "normal",
      sizeMultiplier: CONFIG.NORMAL_MARKER_SIZE_MULTIPLIER,
      palette: "gray"
    },
    jackpot: false
  };
  state.nextBanditId += 1;
  state.bandits.push(bandit);
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  return bandit;
}

function referenceBattle({ count, gold, field = false } = {}) {
  const state = createInitialState(CONFIG.SEED, { skipOnboarding: true });
  if (field) {
    state.player.pos = { x: CONFIG.WORLD_SIZE / 2, y: CONFIG.WORLD_SIZE / 2 };
    state.player.prevPos = copyPosition(state.player.pos);
  }
  const bandit = injectReferenceBandit(state, count, gold);
  bandit.pos = copyPosition(state.player.pos);
  bandit.prevPos = copyPosition(state.player.pos);
  startBattle(state, bandit);
  const result = skipBattle(state);
  return { state, result };
}

function keys(value) {
  return Object.keys(value).sort();
}

function assertExactContract(script) {
  assert.deepEqual(keys(script), ["battleId", "events", "sides", "terrain"]);
  assert.equal(typeof script.battleId, "string");
  assert.ok(["field", "town"].includes(script.terrain));
  assert.deepEqual(keys(script.sides), ["enemy", "player"]);

  for (const sideName of ["player", "enemy"]) {
    const side = script.sides[sideName];
    assert.deepEqual(keys(side), ["label", "startTroops", "tokens"]);
    assert.equal(typeof side.label, "string");
    assert.ok(Number.isSafeInteger(side.startTroops) && side.startTroops >= 0);
    assert.ok(side.tokens.length <= 24);
    side.tokens.forEach((token, idx) => {
      assert.deepEqual(keys(token), ["idx", "troopType"]);
      assert.equal(token.idx, idx);
      assert.equal(typeof token.troopType, "string");
    });
  }

  assert.equal(script.events[0]?.type, "battle_start");
  assert.equal(script.events.at(-1)?.type, "battle_end");
  assert.equal(script.events.filter((event) => event.type === "battle_end").length, 1);
  let previousTime = -1;
  for (const event of script.events) {
    assert.ok(Number.isSafeInteger(event.t) && event.t >= previousTime);
    previousTime = event.t;
    if (event.type === "battle_start") assert.deepEqual(keys(event), ["t", "type"]);
    if (event.type === "volley") {
      assert.deepEqual(keys(event), ["arrows", "side", "t", "type"]);
      assert.equal(event.side, "defender");
      assert.ok(Number.isSafeInteger(event.arrows) && event.arrows > 0);
    }
    if (event.type === "round_start") {
      assert.deepEqual(keys(event), ["n", "t", "type"]);
      assert.ok(Number.isSafeInteger(event.n) && event.n > 0);
    }
    if (event.type === "strike") {
      assert.deepEqual(keys(event), ["beat", "dmgShown", "from", "kill", "t", "to", "type"]);
      assert.deepEqual(keys(event.from), ["idx", "side"]);
      assert.deepEqual(keys(event.to), ["idx", "side"]);
      assert.ok(["player", "enemy"].includes(event.from.side));
      assert.ok(["player", "enemy"].includes(event.to.side));
      assert.notEqual(event.from.side, event.to.side);
      assert.ok([0, 1, 2].includes(event.beat));
      assert.equal(event.kill, true);
      assert.ok(Number.isSafeInteger(event.dmgShown) && event.dmgShown >= 0);
      assert.ok(event.from.idx >= 0 && event.from.idx < script.sides[event.from.side].tokens.length);
      assert.ok(event.to.idx >= 0 && event.to.idx < script.sides[event.to.side].tokens.length);
    }
    if (event.type === "morale") {
      assert.deepEqual(keys(event), ["level", "side", "t", "type"]);
      assert.ok(["player", "enemy"].includes(event.side));
      assert.ok(["steady", "wavering"].includes(event.level));
    }
    if (event.type === "rout") {
      assert.deepEqual(keys(event), ["side", "t", "type"]);
      assert.ok(["player", "enemy"].includes(event.side));
    }
    if (event.type === "battle_end") {
      assert.deepEqual(keys(event), ["loot", "survivors", "t", "type", "winner"]);
      assert.deepEqual(keys(event.loot), ["gold", "renown"]);
      assert.deepEqual(keys(event.survivors), ["enemy", "player"]);
      assert.ok(["player", "enemy", "draw"].includes(event.winner));
    }
  }
}

function assertResolvedCasualties(result) {
  const check = validateBattleScript(result.battleScript, {
    casualties: result.resolvedCasualties,
    survivors: result.resolvedSurvivors
  });
  assert.equal(check.ok, true, check.errors.join(", "));
  assert.deepEqual(check.casualties, result.resolvedCasualties);
  assert.deepEqual(check.survivors, result.resolvedSurvivors);
}

test("reference outcomes keep their RNG while the rout clamp preserves one survivor", () => {
  const victory = referenceBattle({ count: 1, gold: 60 });
  assert.equal(victory.result.type, "victory");
  assert.equal(victory.state.player.gold, 130);
  assert.equal(victory.state.player.renown, 0);
  assert.deepEqual(victory.state.rng, {
    algorithm: "mulberry32-v1",
    value: 2852120795,
    draws: 25
  });
  assert.deepEqual(victory.result.resolvedSurvivors, { player: 4, enemy: 1 });
  assertResolvedCasualties(victory.result);

  const defeat = referenceBattle({ count: 100, gold: 3000 });
  assert.equal(defeat.result.type, "defeat");
  assert.equal(defeat.state.player.gold, 50);
  assert.deepEqual(defeat.state.rng, {
    algorithm: "mulberry32-v1",
    value: 2220285125,
    draws: 27
  });
  assert.deepEqual(defeat.result.resolvedSurvivors, { player: 1, enemy: 96 });
  assert.equal(getTroopCount(defeat.state.player), 1);
  assertResolvedCasualties(defeat.result);
});

test("battleScript follows the exact event contract and is deterministic", () => {
  const first = referenceBattle({ count: 1, gold: 60 });
  const second = referenceBattle({ count: 1, gold: 60 });
  assert.deepEqual(first.result.battleScript, second.result.battleScript);
  assertExactContract(first.result.battleScript);
  const roundLog = first.state.eventLog.find((entry) => entry.key === "log.battleRound");
  assert.deepEqual(roundLog?.parameters, { round: 1, banditLoss: 0, playerLoss: 1 });
});

test("token buckets cap at 24 while every real casualty remains a kill event", () => {
  const state = createInitialState(77, { skipOnboarding: true });
  const beforeRng = structuredClone(state.rng);
  const syntheticBattle = {
    battleId: "battle:77:synthetic",
    terrain: "field",
    playerStart: 60,
    banditStart: 80,
    playerStartRoster: [{ type: "militia", count: 40 }, { type: "veteran", count: 20 }],
    enemyStartRoster: [{ type: "bandit", count: 80 }],
    playerStartStrength: 100,
    enemyStartStrength: 100,
    playerCasualties: 30,
    banditCasualties: 45,
    rounds: [{
      n: 1,
      playerLoss: 30,
      enemyLoss: 45,
      playerDamage: 240,
      enemyDamage: 180,
      playerRemaining: 30,
      enemyRemaining: 35,
      playerStrengthRemaining: 50,
      enemyStrengthRemaining: 44
    }]
  };
  const script = buildBattleScript(state, syntheticBattle, { type: "victory", loot: 12, renown: 4 }, "player");
  assert.deepEqual(state.rng, beforeRng, "presentation RNG must not consume gameplay RNG");
  assert.equal(script.sides.player.tokens.length, Math.ceil(60 / Math.ceil(60 / 24)));
  assert.equal(script.sides.enemy.tokens.length, Math.ceil(80 / Math.ceil(80 / 24)));
  assert.ok(script.sides.player.tokens.length <= 24);
  assert.ok(script.sides.enemy.tokens.length <= 24);
  const kills = script.events.filter((event) => event.type === "strike" && event.kill);
  assert.equal(kills.filter((event) => event.to.side === "player").length, 30);
  assert.equal(kills.filter((event) => event.to.side === "enemy").length, 45);
  assert.ok(new Set(kills.map((event) => `${event.to.side}:${event.to.idx}`)).size < kills.length);
  assertExactContract(script);
});

test("each round preserves its own casualties, damage shares, and hit waves", () => {
  const state = createInitialState(78, { skipOnboarding: true });
  const battle = {
    battleId: "battle:78:rounds",
    terrain: "field",
    playerStart: 30,
    banditStart: 30,
    playerStartRoster: [{ type: "militia", count: 30 }],
    enemyStartRoster: [{ type: "bandit", count: 30 }],
    playerStartStrength: 60,
    enemyStartStrength: 60,
    playerCasualties: 9,
    banditCasualties: 12,
    rounds: [
      {
        n: 1,
        playerLoss: 4,
        enemyLoss: 5,
        playerDamage: 41,
        enemyDamage: 32,
        playerRemaining: 26,
        enemyRemaining: 25,
        playerStrengthRemaining: 52,
        enemyStrengthRemaining: 50
      },
      {
        n: 2,
        playerLoss: 5,
        enemyLoss: 7,
        playerDamage: 53,
        enemyDamage: 39,
        playerRemaining: 21,
        enemyRemaining: 18,
        playerStrengthRemaining: 42,
        enemyStrengthRemaining: 36
      }
    ]
  };
  const script = buildBattleScript(state, battle, { type: "victory", loot: 20, renown: 3 }, "player");
  const starts = script.events
    .map((event, index) => event.type === "round_start" ? index : -1)
    .filter((index) => index >= 0);
  assert.equal(starts.length, 2);
  battle.rounds.forEach((round, index) => {
    const end = starts[index + 1] ?? script.events.findIndex((event) => event.type === "battle_end");
    const strikes = script.events.slice(starts[index] + 1, end).filter((event) => event.type === "strike");
    assert.equal(strikes.filter((event) => event.to.side === "player").length, round.playerLoss);
    assert.equal(strikes.filter((event) => event.to.side === "enemy").length, round.enemyLoss);
    assert.equal(
      strikes.filter((event) => event.from.side === "player").reduce((sum, event) => sum + event.dmgShown, 0),
      Math.round(round.playerDamage)
    );
    assert.equal(
      strikes.filter((event) => event.from.side === "enemy").reduce((sum, event) => sum + event.dmgShown, 0),
      Math.round(round.enemyDamage)
    );
    assert.deepEqual([...new Set(strikes.map((event) => event.beat))].sort(), [0, 1, 2]);
  });
});

test("town volley is presentation-only", () => {
  const town = referenceBattle({ count: 1, gold: 60 });
  const field = referenceBattle({ count: 1, gold: 60, field: true });
  assert.equal(town.result.battleScript.terrain, "town");
  assert.equal(field.result.battleScript.terrain, "field");
  assert.equal(town.result.battleScript.events.some((event) => event.type === "volley"), true);
  assert.equal(field.result.battleScript.events.some((event) => event.type === "volley"), false);
  assert.deepEqual(town.result.resolvedCasualties, field.result.resolvedCasualties);
  assert.deepEqual(town.result.resolvedSurvivors, field.result.resolvedSurvivors);
  assert.equal(town.result.type, field.result.type);
  assert.equal(town.state.player.gold, field.state.player.gold);
  assert.deepEqual(town.state.rng, field.state.rng);
});

test("battlePlayback skip is one-shot and resolves immediately", () => {
  const state = createInitialState(CONFIG.SEED, { skipOnboarding: true });
  initializeLivingWorld(state);
  const bandit = injectReferenceBandit(state, 1, 60);
  startBattle(state, bandit);
  state.battle.nextRoundTick = state.tick + 999;
  state.battlePlayback.speed = 2;
  state.battlePlayback.skip = true;
  const tick = worldTick(state);
  assert.equal(tick.battleResult?.type, "victory");
  assert.equal(state.battle, null);
  assert.equal(state.battlePlayback.speed, 2);
  assert.equal(state.battlePlayback.skip, false);
  assert.ok(state.battleScript);
});

test("successful retreat still emits a contract-valid tactical ending", () => {
  const state = createInitialState(17, { skipOnboarding: true });
  const bandit = injectReferenceBandit(state, 5, 60);
  startBattle(state, bandit);
  let result = null;
  for (let attempt = 0; attempt < 12 && state.battle; attempt += 1) {
    result = attemptFlee(state);
  }
  assert.equal(result?.type, "fled");
  assert.ok(result.battleScript);
  assert.equal(result.battleScript.events.at(-1).winner, "enemy");
  assert.equal(
    result.battleScript.events.some((event) => event.type === "rout"),
    false,
    "retreat must not fabricate a 30% rout threshold crossing"
  );
  assertResolvedCasualties(result);
  assertExactContract(result.battleScript);
});

test("old v2 saves gain defaults and new scripts round-trip", () => {
  const legacyStorage = new MemoryStorage();
  const oldState = createInitialState(91, { skipOnboarding: true });
  delete oldState.battleScript;
  delete oldState.battlePlayback;
  legacyStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(oldState));
  const migrated = loadState(legacyStorage);
  assert.ok(migrated);
  assert.equal(migrated.battleScript, null);
  assert.deepEqual(migrated.battlePlayback, { speed: 1, skip: false });

  const current = referenceBattle({ count: 1, gold: 60 }).state;
  current.battlePlayback.speed = 2;
  const storage = new MemoryStorage();
  assert.equal(saveState(current, storage), true);
  const loaded = loadState(storage);
  assert.ok(loaded);
  assert.deepEqual(loaded.battleScript, current.battleScript);
  assert.deepEqual(loaded.battlePlayback, { speed: 2, skip: false });
});

test("invalid scripts and playback commands fail closed on load", () => {
  const baseline = referenceBattle({ count: 1, gold: 60 }).state;
  const malformedScripts = [];

  const unknownEvent = structuredClone(baseline.battleScript);
  unknownEvent.events.splice(-1, 0, { t: 2000, type: "teleport" });
  malformedScripts.push(unknownEvent);

  const invalidTime = structuredClone(baseline.battleScript);
  invalidTime.events[1].t = -1;
  malformedScripts.push(invalidTime);

  const ghostIndex = structuredClone(baseline.battleScript);
  ghostIndex.events.find((event) => event.type === "strike").to.idx = 999;
  malformedScripts.push(ghostIndex);

  const duplicateEnd = structuredClone(baseline.battleScript);
  duplicateEnd.events.push(structuredClone(duplicateEnd.events.at(-1)));
  malformedScripts.push(duplicateEnd);

  const fieldVolley = structuredClone(baseline.battleScript);
  fieldVolley.terrain = "field";
  malformedScripts.push(fieldVolley);

  malformedScripts.forEach((script) => {
    assert.equal(validateBattleScript(script).ok, false);
    const state = createInitialState(212, { skipOnboarding: true });
    state.battleScript = script;
    state.battlePlayback = { speed: 1, skip: "false" };
    const storage = new MemoryStorage();
    storage.setItem(CONFIG.SAVE_KEY, JSON.stringify(state));
    const loaded = loadState(storage);
    assert.ok(loaded);
    assert.equal(loaded.battleScript, null);
    assert.deepEqual(loaded.battlePlayback, { speed: 1, skip: false });
  });
});

test("legacy mid-battle saves synthesize prior losses without losing casualty totals", () => {
  const state = createInitialState(119, { skipOnboarding: true });
  const bandit = injectReferenceBandit(state, 12, 360);
  startBattle(state, bandit);
  applyCasualties(state.player, 1);
  applyCasualties(bandit, 2);
  state.battle.round = 1;
  state.battle.playerCasualties = 1;
  state.battle.banditCasualties = 2;
  delete state.battle.battleId;
  delete state.battle.terrain;
  delete state.battle.playerStartRoster;
  delete state.battle.enemyStartRoster;
  delete state.battle.playerStartStrength;
  delete state.battle.enemyStartStrength;
  delete state.battle.rounds;
  const storage = new MemoryStorage();
  assert.equal(saveState(state, storage), true);
  const loaded = loadState(storage);
  assert.ok(loaded?.battle);
  const result = skipBattle(loaded);
  assert.ok(result);
  assertResolvedCasualties(result);
  assert.ok(result.resolvedCasualties.player >= 1);
  assert.ok(result.resolvedCasualties.enemy >= 2);
});

function clearRoadModal(state) {
  while (state.demo?.modal === "roadEvent") {
    const result = chooseRoadEvent(state, 0);
    assert.equal(result?.ok, true);
  }
}

function replayReference() {
  const state = createInitialState(424242, {
    skipOnboarding: true,
    startedAt: new Date(0).toISOString()
  });
  initializeLivingWorld(state);
  state.player.moveTarget = { x: 1500, y: 500 };
  let advanced = 0;
  let guard = 0;
  while (advanced < 600) {
    assert.ok(++guard < 5000);
    clearRoadModal(state);
    const result = worldTick(state);
    if (result.advanced) advanced += 1;
  }
  clearRoadModal(state);
  return state;
}

test("reference replay and v1.1 autoplay freeze the post-integrity outputs", () => {
  const replay = replayReference();
  assert.equal(replay.bandits.length, 7);
  assert.deepEqual(replay.rng, {
    algorithm: "mulberry32-v1",
    value: 443767118,
    draws: 556
  });

  const autoplay = simulateAutoplay(CONFIG.SEED, { maxActiveSeconds: 1800, v11: true });
  assert.deepEqual({
    firstBattleSeconds: autoplay.firstBattleSeconds,
    firstEventSeconds: autoplay.firstEventSeconds,
    act2Seconds: autoplay.act2Seconds,
    endingSeconds: autoplay.endingSeconds,
    battleScriptsChecked: autoplay.battleScriptsChecked,
    stateBattleScriptsChecked: autoplay.state.autoplay.battleScriptsChecked,
    gold: autoplay.state.player.gold,
    troops: getTroopCount(autoplay.state.player),
    renown: autoplay.state.player.renown,
    battles: autoplay.state.stats.battles,
    wins: autoplay.state.stats.wins,
    bandits: autoplay.state.bandits.length,
    rng: autoplay.state.rng
  }, {
    firstBattleSeconds: 6.5,
    firstEventSeconds: 170.5,
    act2Seconds: 618.5,
    endingSeconds: 1538,
    battleScriptsChecked: 13,
    stateBattleScriptsChecked: 13,
    gold: 864,
    troops: 35,
    renown: 144,
    battles: 13,
    wins: 13,
    bandits: 11,
    rng: {
      algorithm: "mulberry32-v1",
      value: 2808164380,
      draws: 3254
    }
  });
});

const sample = referenceBattle({ count: 1, gold: 60 }).result.battleScript;
console.log("SAMPLE_BATTLE_SCRIPT");
console.log(JSON.stringify(sample, null, 2));

import assert from "node:assert/strict";
import test from "node:test";

import {
  choosePlayerFormation,
  counterFormation,
  skipBattle,
  startBattle,
  validateBattleScript
} from "../outputs/js/battle.js";
import { normalizeScript } from "../outputs/js/battle-stage.js";
import { CONFIG, CONFIG_V11, FORMATION_IDS, LIEUTENANT_EVENTS } from "../outputs/js/data.js";
import { CONFIG_PRESENTATION } from "../outputs/js/presentation.js";
import { getRoadEventDefinitions } from "../outputs/js/casual.js";
import {
  copyPosition,
  createInitialState,
  getTroopCount,
  loadState,
  saveState
} from "../outputs/js/state.js";
import {
  chooseRoadEvent,
  hireLieutenant,
  simulateAutoplay,
  verifyRoadEventChoiceEffects
} from "../outputs/js/sim.js";

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

function battleState(seed = 1, options = {}) {
  const state = createInitialState(seed, {
    skipOnboarding: true,
    startedAt: new Date(0).toISOString(),
    v11: true
  });
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  state.player.troops = [{ type: "militia", count: options.playerCount ?? 5, xp: 0 }];
  const bandit = {
    id: `v11_reference_${seed}`,
    pos: copyPosition(state.player.pos),
    prevPos: copyPosition(state.player.pos),
    moveTarget: null,
    troops: [{ type: "bandit", count: options.enemyCount ?? 5, xp: 0 }],
    gold: 120,
    lootValue: 60,
    elite: false,
    kind: "normal",
    lootMultiplier: 1,
    markerScale: 1,
    jackpot: false
  };
  state.bandits.push(bandit);
  return { state, bandit };
}

test("v1.0 and v1.1 use isolated save slots", () => {
  const storage = new MemoryStorage();
  const stable = createInitialState(11, { skipOnboarding: true });
  const v11 = createInitialState(22, { skipOnboarding: true, v11: true });
  assert.equal(saveState(stable, storage), true);
  assert.equal(saveState(v11, storage), true);
  assert.ok(storage.getItem(CONFIG.SAVE_KEY));
  assert.ok(storage.getItem(CONFIG.V11_SAVE_KEY));
  assert.equal(loadState(storage)?.seed, 11);
  assert.equal(loadState(storage, { v11: true })?.seed, 22);
  assert.equal(loadState(storage)?.features.v11, false);
  assert.equal(loadState(storage, { v11: true })?.features.v11, true);
});

test("formation selection is a gated RPS decision and reaches battleScript", () => {
  for (const enemyFormation of FORMATION_IDS) {
    let selected = false;
    for (let seed = 1; seed < 200 && !selected; seed += 1) {
      const { state, bandit } = battleState(seed);
      startBattle(state, bandit);
      if (state.battle.formations.enemy !== enemyFormation) continue;
      selected = true;
      assert.equal(state.demo.modal, "formation");
      assert.equal(state.paused, true);
      const playerFormation = counterFormation(enemyFormation);
      const pick = choosePlayerFormation(state, playerFormation);
      assert.equal(pick.ok, true);
      assert.equal(pick.advantage, "player");
      assert.equal(state.battle.formationModifiers.player.attack, CONFIG.V11_FORMATION_ATTACK_ADVANTAGE);
      assert.equal(state.battle.formationModifiers.player.defense, CONFIG.V11_FORMATION_DEFENSE_ADVANTAGE);
      assert.equal(state.battle.formationModifiers.enemy.attack, 1);
      assert.equal(state.paused, false);
      const result = skipBattle(state);
      assert.ok(["victory", "defeat"].includes(result.type));
      assert.deepEqual(result.battleScript.formations, {
        player: playerFormation,
        enemy: enemyFormation
      });
      assert.deepEqual(normalizeScript(result.battleScript).formations, result.battleScript.formations);
      assert.equal(validateBattleScript(result.battleScript, {
        casualties: result.resolvedCasualties,
        survivors: result.resolvedSurvivors
      }).ok, true);
    }
    assert.equal(selected, true, `missing deterministic ${enemyFormation} sample`);
  }
});

test("formation modal skips trivial fights and scout accuracy stays near 80 percent", () => {
  const trivial = battleState(301, { playerCount: 3, enemyCount: 3 });
  startBattle(trivial.state, trivial.bandit);
  assert.equal(trivial.state.demo.modal, null);
  assert.equal(trivial.state.battle.formations.eligible, false);
  assert.equal(trivial.state.battle.formations.player, "line");

  let accurate = 0;
  const samples = 400;
  for (let seed = 1; seed <= samples; seed += 1) {
    const { state, bandit } = battleState(0x110000 + seed);
    startBattle(state, bandit);
    if (state.battle.formations.scoutAccurate) accurate += 1;
  }
  const rate = accurate / samples;
  assert.ok(rate >= 0.75 && rate <= 0.85, `scout accuracy ${rate}`);
});

test("Chen Mang hires in Act 2, buffs battle attack, and stays with a routed survivor", () => {
  const { state, bandit } = battleState(401, { playerCount: 3, enemyCount: 2 });
  state.player.act = 2;
  state.player.gold = 500;
  const hired = hireLieutenant(state);
  assert.equal(hired.ok, true);
  assert.equal(state.player.gold, 500 - CONFIG.V11_LIEUTENANT_COST);
  assert.equal(state.player.lieutenant.id, "chen_mang");
  assert.equal(state.telemetry.lieutenant.hired, true);
  assert.equal(state.telemetry.lieutenant.hireCount, 1);

  startBattle(state, bandit);
  assert.equal(state.battle.playerAttackMultiplier, 1 + CONFIG_V11.LIEUTENANT_ATTACK_BONUS);
  assert.ok(state.eventLog.some((entry) => entry.key === "log.lieutenantBattle"));
  skipBattle(state);

  const wipe = battleState(402, { playerCount: 1, enemyCount: 50 });
  wipe.state.player.act = 2;
  wipe.state.player.gold = 500;
  assert.equal(hireLieutenant(wipe.state).ok, true);
  const loss = startBattle(wipe.state, wipe.bandit) || skipBattle(wipe.state);
  const resolved = loss?.type ? loss : skipBattle(wipe.state);
  assert.equal(resolved.type, "defeat");
  assert.equal(wipe.state.player.lieutenant?.id, "chen_mang");
  assert.equal(wipe.state.telemetry.lieutenant.lostCount, 0);
  assert.equal(getTroopCount(wipe.state.player), 1);
});

test("Chen Mang's three cards are gated and share the live effects pipeline", () => {
  const state = createInitialState(501, { skipOnboarding: true, v11: true });
  assert.equal(getRoadEventDefinitions(state).length, 20);
  state.player.act = 2;
  state.player.gold = 500;
  assert.equal(hireLieutenant(state).ok, true);
  assert.equal(getRoadEventDefinitions(state).length, 23);
  assert.deepEqual(
    getRoadEventDefinitions(state).slice(-3).map((event) => event.id),
    LIEUTENANT_EVENTS.map((event) => event.id)
  );

  const audit = verifyRoadEventChoiceEffects({ v11: true });
  assert.equal(audit.ok, true);
  assert.equal(audit.cardsChecked, 23);
  assert.equal(audit.choicesChecked, 46);

  const pursuit = LIEUTENANT_EVENTS[0];
  const beforeGold = state.player.gold;
  const beforeTroops = getTroopCount(state.player);
  const active = {
    id: pursuit.id,
    eventId: pursuit.id,
    day: 1,
    factionId: "south",
    resumePaused: false,
    resumePauseReason: null
  };
  state.demo.roadEvent = active;
  state.demo.activeRoadEvent = active;
  state.demo.modal = "roadEvent";
  state.paused = true;
  const result = chooseRoadEvent(state, 0);
  assert.equal(result.ok, true);
  assert.equal(state.player.gold - beforeGold, CONFIG.V11_LIEUTENANT_PURSUIT_GOLD);
  assert.equal(getTroopCount(state.player) - beforeTroops, -CONFIG.V11_LIEUTENANT_PURSUIT_TROOPS);
  assert.equal(state.telemetry.lieutenantEventChoices.at(-1).cardId, pursuit.id);
});

test("default-seed v1.1 autoplay reaches the ending and audits all new choices", () => {
  const stable = simulateAutoplay(CONFIG.SEED);
  const stableReplay = simulateAutoplay(CONFIG.SEED);
  const v11 = simulateAutoplay(CONFIG.SEED, { v11: true });
  assert.deepEqual(
    {
      act2Seconds: stableReplay.act2Seconds,
      endingSeconds: stableReplay.endingSeconds,
      state: stableReplay.state
    },
    {
      act2Seconds: stable.act2Seconds,
      endingSeconds: stable.endingSeconds,
      state: stable.state
    },
    "the updated rout resolver must remain deterministic for the legacy variant"
  );
  assert.equal(v11.variant, "1.1");
  assert.ok(v11.firstBattleSeconds <= CONFIG.AUTOPLAY_FIRST_BATTLE_TARGET_SECONDS);
  const presentationSeconds = (rounds) => {
    const contact = (
      CONFIG_PRESENTATION.DEPLOY_MS +
      CONFIG_PRESENTATION.STANDOFF_MS +
      CONFIG_PRESENTATION.CHARGE_MS
    );
    const idealMelee = rounds * (
      CONFIG_PRESENTATION.ROUND_MS + CONFIG_PRESENTATION.ROUND_BREATH_MS
    );
    const melee = Math.min(
      CONFIG_PRESENTATION.MELEE_MAX_MS,
      Math.max(CONFIG_PRESENTATION.MELEE_MIN_MS, idealMelee)
    );
    const settlement = (
      CONFIG_PRESENTATION.ROUT_SLOWMO_MS +
      CONFIG_PRESENTATION.FLEE_MIN_MS +
      CONFIG_PRESENTATION.FLEE_VAR_MS +
      CONFIG_PRESENTATION.VICTORY_HOLD_MS
    );
    return (contact + melee + settlement) / 1000;
  };
  const simulationRoundSeconds = CONFIG.BATTLE_ROUND_TICKS * CONFIG.LOGIC_MS / 1000;
  const playerFacingSeconds = (rawSeconds, roundCounts) => (
    rawSeconds - roundCounts.reduce((sum, rounds) => sum + rounds * simulationRoundSeconds, 0)
    + roundCounts.reduce((sum, rounds) => sum + presentationSeconds(rounds), 0)
  );
  const playerAct2 = playerFacingSeconds(v11.act2Seconds, v11.act2BattleRoundCounts);
  const playerEnding = playerFacingSeconds(v11.endingSeconds, v11.endingBattleRoundCounts);
  // CONFIG's targets govern the 20x autoplay clock. Presentation adds about
  // two minutes at 1x; keep that visible as a separate sanity bound without
  // silently retuning gameplay in a battle-integrity patch.
  assert.ok(v11.act2Seconds >= CONFIG.AUTOPLAY_ACT2_TARGET_MIN_SECONDS);
  assert.ok(v11.act2Seconds <= CONFIG.AUTOPLAY_ACT2_TARGET_MAX_SECONDS);
  assert.ok(v11.endingSeconds >= CONFIG.AUTOPLAY_END_TARGET_MIN_SECONDS);
  assert.ok(v11.endingSeconds <= CONFIG.AUTOPLAY_END_TARGET_MAX_SECONDS);
  assert.ok(playerAct2 <= CONFIG.AUTOPLAY_ACT2_TARGET_MAX_SECONDS + 30);
  assert.ok(playerEnding <= CONFIG.AUTOPLAY_END_TARGET_MAX_SECONDS + 30);
  assert.equal(v11.roadEventChoicesChecked, 46);
  assert.equal(v11.state.demo.ended, true);
  assert.equal(v11.state.telemetry.lieutenant.hired, true);
});

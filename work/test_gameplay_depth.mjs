import assert from "node:assert/strict";
import test from "node:test";

import { reevaluateLordAi } from "../outputs/js/ai.js";
import {
  attemptFlee,
  checkForHostileLordEncounter,
  startBattle
} from "../outputs/js/battle.js";
import { chooseRoadEvent } from "../outputs/js/casual.js";
import { CONFIG } from "../outputs/js/data.js";
import {
  acceptMercenaryContract,
  buyTownBattleBuff,
  declareWar,
  getTavernContracts,
  initializeLivingWorld,
  replenishVeteran,
  townRecruitPrice,
  worldTick
} from "../outputs/js/sim.js";
import {
  createInitialState,
  factionsAtWar,
  getPartyStrength,
  getTown
} from "../outputs/js/state.js";

function actTwoState(seed = 0xd330) {
  const state = createInitialState(seed, { skipOnboarding: true, startedAt: new Date(0).toISOString() });
  state.player.act = 2;
  state.paused = false;
  state.demo.modal = null;
  initializeLivingWorld(state);
  // These tests are about war-zone economics, so the war is a PREMISE of the
  // fixture, not something to inherit. The demo build happened to seed one
  // (CONFIG.DEMO in initializeLivingWorld); the full build does not, which is
  // what turned three assertions red. Declaring it here makes the fixture
  // build-agnostic instead of quietly demo-only.
  const [warFirst, warSecond] = CONFIG.DEMO_INITIAL_WAR_FACTIONS;
  if (!factionsAtWar(state, warFirst, warSecond)) declareWar(state, warFirst, warSecond);
  const town = getTown(state, CONFIG.START_TOWN_ID);
  state.player.pos = { ...town.pos };
  state.player.prevPos = { ...town.pos };
  return { state, town };
}

function clearRoadEvent(state) {
  while (state.demo?.modal === "roadEvent") {
    assert.equal(chooseRoadEvent(state, 0).ok, true);
  }
}

test("town spend is a real three-way economy with additive live-world prices", () => {
  const { state, town } = actTwoState();
  const warPrice = townRecruitPrice(state, town, CONFIG.RECRUIT_COST);
  assert.equal(warPrice.warZone, true);
  assert.equal(warPrice.cost, 15);
  state.player.relations[town.factionId] = -1;
  const hostileWarPrice = townRecruitPrice(state, town, CONFIG.RECRUIT_COST);
  assert.equal(hostileWarPrice.hostile, true);
  assert.equal(hostileWarPrice.cost, 20);

  state.player.gold = 500;
  state.player.troops = [{ type: "veteran", count: 1, xp: 7 }];
  const replenish = replenishVeteran(state);
  assert.equal(replenish.ok, true);
  assert.equal(replenish.cost, 40);
  assert.deepEqual(state.player.troops, [{ type: "veteran", count: 2, xp: 7 }]);

  const buff = buyTownBattleBuff(state);
  assert.equal(buff.ok, true);
  assert.equal(buff.multiplier, 1 + CONFIG.TAVERN_ATTACK_BUFF_BONUS);
  assert.equal(buyTownBattleBuff(state).reason, "active");
});

test("taverns expose two or three mutually exclusive, typed offers", () => {
  const { state, town } = actTwoState(0xd331);
  const offers = getTavernContracts(state, town.id);
  assert.deepEqual(offers.map((offer) => offer.type), ["escort", "risky", "war"]);
  const accepted = acceptMercenaryContract(state, town.id, "war");
  assert.equal(accepted.ok, true);
  assert.equal(state.player.relations[accepted.contract.targetFactionId], -CONFIG.CONTRACT_WAR_RELATION_PENALTY);
  assert.equal(acceptMercenaryContract(state, town.id, "escort").reason, "active");
});

test("escort occupies exactly three daily boundaries and then pays", () => {
  const { state, town } = actTwoState(0xd332);
  const accepted = acceptMercenaryContract(state, town.id, "escort");
  assert.equal(accepted.ok, true);
  const goldBefore = state.player.gold;
  for (let day = 1; day <= CONFIG.CONTRACT_ESCORT_DAYS; day += 1) {
    state.tick = day * CONFIG.TICKS_PER_DAY - 1;
    state.paused = false;
    state.demo.modal = null;
    const tick = worldTick(state);
    assert.equal(tick.dayAdvanced, true);
    clearRoadEvent(state);
    assert.equal(state.player.contract.active, day < CONFIG.CONTRACT_ESCORT_DAYS);
  }
  assert.equal(state.player.contract.daysRemaining, 0);
  assert.equal(
    state.player.gold,
    goldBefore + CONFIG.CONTRACT_ESCORT_REWARD - state.stats.wagesPaid,
    "the safe payout still bears the real three-day wage cost"
  );
});

test("risky contract scales the next ordinary enemy and fleeing applies the declared penalty", () => {
  const { state, town } = actTwoState(0xd333);
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  state.player.renown = 40;
  const accepted = acceptMercenaryContract(state, town.id, "risky");
  assert.equal(accepted.ok, true);
  const bandit = state.bandits.find((entry) => !entry.elite);
  bandit.pos = { ...state.player.pos };
  startBattle(state, bandit);
  assert.equal(state.battle.balance.type, "contractRisk");
  const ratio = getPartyStrength(bandit) / getPartyStrength(state.player);
  assert.ok(Math.abs(ratio - CONFIG.CONTRACT_RISKY_ENEMY_STRENGTH_MULTIPLIER) <= 0.16);
  let flee = null;
  for (let attempt = 0; attempt < 20 && state.battle; attempt += 1) flee = attemptFlee(state);
  assert.equal(flee?.success, true);
  assert.equal(state.player.renown, 40 - CONFIG.CONTRACT_RISKY_FAILURE_RENOWN);
  assert.equal(state.player.contract.active, false);
});

test("negative Act 2 relations drive the matching lord into a real player encounter", () => {
  const { state } = actTwoState(0xd334);
  const lord = state.lords.find((entry) => entry.factionId === "north");
  state.player.relations.north = -1;
  lord.pos = { x: state.player.pos.x + 20, y: state.player.pos.y };
  lord.prevPos = { ...lord.pos };
  reevaluateLordAi(state, lord);
  assert.equal(lord.targetKind, "player");
  const result = checkForHostileLordEncounter(state);
  assert.equal(result, null);
  assert.equal(state.battle.enemyKind, "lord");
  assert.equal(state.battle.banditId, lord.id);
});

test("war zones can hold fifty percent more deterministic deserter bandits", () => {
  const { state } = actTwoState(0xd335);
  while (state.bandits.length < CONFIG.MAX_BANDITS) {
    state.tick += 1;
    worldTick(state);
    clearRoadEvent(state);
  }
  for (let day = 1; day <= 20 && state.bandits.length <= CONFIG.MAX_BANDITS; day += 1) {
    state.tick = Math.ceil(state.tick / CONFIG.TICKS_PER_DAY) * CONFIG.TICKS_PER_DAY
      + CONFIG.TICKS_PER_DAY - 1;
    state.paused = false;
    state.demo.modal = null;
    worldTick(state);
    clearRoadEvent(state);
  }
  assert.ok(state.bandits.length > CONFIG.MAX_BANDITS);
  assert.ok(state.bandits.length <= CONFIG.WAR_ZONE_MAX_BANDITS);
  assert.ok(state.eventLog.some((entry) => entry.key === "log.warBandits"));
});

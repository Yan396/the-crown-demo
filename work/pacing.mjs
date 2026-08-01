/*
 * Headless pacing probe. This build has no ?autoplay=1, so this stands in for
 * it: run the real worldTick loop with no DOM and report the pacing metrics
 * that road movement could plausibly disturb.
 *
 * Usage: node work/pacing.mjs [ticks]
 */
import { CONFIG } from "../outputs/js/data.js";
import { createInitialState, getTroopCount } from "../outputs/js/state.js";
import { worldTick } from "../outputs/js/sim.js";

const TICKS = Number(process.argv[2] || 6000);

// The player wanders between towns instead of standing still, so road bonuses
// and off-road penalties both get exercised.
const TOUR = [
  { x: 430, y: 1490 }, { x: 1200, y: 1650 }, { x: 1575, y: 1265 },
  { x: 1615, y: 620 }, { x: 1080, y: 275 }, { x: 390, y: 350 }
];

function run(seed) {
  const state = createInitialState(seed);
  let leg = 0;
  let battles = 0;
  let victories = 0;
  let firstBattleTick = null;
  const goldByDay = [];

  state.player.moveTarget = { ...TOUR[0] };

  for (let tick = 0; tick < TICKS; tick += 1) {
    const before = state.battle;
    const result = worldTick(state);

    if (!before && state.battle) {
      battles += 1;
      if (firstBattleTick === null) firstBattleTick = state.tick;
    }
    if (result.battleResult?.type === "victory") victories += 1;

    if (!state.player.moveTarget && !state.battle) {
      leg = (leg + 1) % TOUR.length;
      state.player.moveTarget = { ...TOUR[leg] };
    }
    if (result.dayAdvanced) goldByDay.push(state.player.gold);
  }

  const days = state.stats.days;
  return {
    days,
    lapsCompleted: leg,
    battles,
    victories,
    battlesPerDay: +(battles / Math.max(1, days)).toFixed(3),
    firstBattleTick,
    endGold: state.player.gold,
    endTroops: getTroopCount(state.player),
    endRenown: state.player.renown,
    goldDay10: goldByDay[9] ?? null,
    goldDay50: goldByDay[49] ?? null
  };
}

const label = CONFIG.ROAD_MOVEMENT
  ? `ROAD_MOVEMENT=on  (on-road x${CONFIG.ROAD_SPEED_MULTIPLIER} / off-road x${CONFIG.OFF_ROAD_SPEED_MULTIPLIER})`
  : "ROAD_MOVEMENT=off (baseline)";
console.log(label, `| ${TICKS} ticks`);
console.log(JSON.stringify(run(CONFIG.SEED), null, 2));

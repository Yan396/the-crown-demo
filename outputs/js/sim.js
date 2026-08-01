import { updateBanditRoam, updateLordPatrol, movePartyToward } from "./ai.js";
import { checkForEncounter, resolveBattleRound } from "./battle.js";
import { CONFIG } from "./data.js";
import { activeTown, addEvent, copyPosition, incrementTroop, spawnBandit } from "./state.js";

function snapshotPreviousPositions(state) {
  state.player.prevPos = copyPosition(state.player.pos);
  state.lords.forEach((lord) => {
    lord.prevPos = copyPosition(lord.pos);
  });
  state.bandits.forEach((bandit) => {
    bandit.prevPos = copyPosition(bandit.pos);
  });
}

// The simulation is clock-, DOM-, and storage-free; main.js owns scheduling and autosave.
export function worldTick(state) {
  if (state.paused) return { advanced: false, dayAdvanced: false, battleResult: null };
  state.tick += 1;
  snapshotPreviousPositions(state);
  const battleAtTickStart = Boolean(state.battle);

  if (!state.battle) movePartyToward(state.player, CONFIG.PLAYER_SPEED);
  state.lords.forEach((lord) => updateLordPatrol(state, lord));

  const engagedBanditId = state.battle?.banditId || null;
  state.bandits.forEach((bandit) => {
    if (bandit.id !== engagedBanditId) updateBanditRoam(state, bandit);
  });

  let battleResult = null;
  if (state.battle && state.tick >= state.battle.nextRoundTick) {
    battleResult = resolveBattleRound(state);
  }
  if (!battleAtTickStart && !state.battle) {
    battleResult = checkForEncounter(state) || battleResult;
  }

  const dayAdvanced = state.tick % CONFIG.TICKS_PER_DAY === 0;
  if (dayAdvanced) {
    state.stats.days += 1;
    if (state.bandits.length < CONFIG.MAX_BANDITS) spawnBandit(state);
  }

  return { advanced: true, dayAdvanced, battleResult };
}

export function recruitMilitia(state) {
  if (state.paused) return { ok: false, reason: "paused" };
  if (state.battle) return { ok: false, reason: "battle" };
  const town = activeTown(state);
  if (!town) return { ok: false, reason: "outsideTown" };
  if (state.player.gold < CONFIG.RECRUIT_COST) return { ok: false, reason: "gold" };

  state.player.gold -= CONFIG.RECRUIT_COST;
  incrementTroop(state.player, "militia", 1);
  addEvent(state, "log.recruit", { townId: town.id, cost: CONFIG.RECRUIT_COST });
  return { ok: true, townId: town.id };
}

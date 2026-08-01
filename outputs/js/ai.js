import { CONFIG } from "./data.js";
import { assignBanditMoveTarget, clamp, copyPosition, getTown } from "./state.js";

export function movePartyToward(party, speed) {
  if (!party.moveTarget) return false;
  const dx = party.moveTarget.x - party.pos.x;
  const dy = party.moveTarget.y - party.pos.y;
  const remaining = Math.hypot(dx, dy);

  if (remaining <= speed || remaining <= CONFIG.ARRIVAL_RADIUS) {
    party.pos.x = party.moveTarget.x;
    party.pos.y = party.moveTarget.y;
    party.moveTarget = null;
    return true;
  }

  party.pos.x = clamp(party.pos.x + (dx / remaining) * speed, 0, CONFIG.WORLD_SIZE);
  party.pos.y = clamp(party.pos.y + (dy / remaining) * speed, 0, CONFIG.WORLD_SIZE);
  return false;
}

// Phase 1 intentionally keeps lords on the Phase 0 two-town patrol behavior.
export function updateLordPatrol(state, lord) {
  if (!movePartyToward(lord, CONFIG.LORD_SPEED)) return;
  lord.patrolIndex = lord.patrolIndex === 0 ? 1 : 0;
  const nextTown = getTown(state, lord.patrolTownIds[lord.patrolIndex]);
  lord.moveTarget = copyPosition(nextTown.pos);
  lord.targetId = nextTown.id;
  lord.aiState = "patrol";
}

export function updateBanditRoam(state, bandit) {
  if (movePartyToward(bandit, CONFIG.BANDIT_SPEED)) {
    assignBanditMoveTarget(state, bandit);
  }
}

import { CONFIG } from "./data.js";
import { activeTown, addEvent } from "./state.js";
import { recordChronicleMilestone } from "./telemetry.js";

export function getContractOffer(state) {
  if (state.player.act < 2 || state.demo?.ended || state.battle) return null;
  const town = activeTown(state);
  if (!town) return null;
  return {
    id: `mercenary_${town.factionId}`,
    factionId: town.factionId,
    townId: town.id,
    reward: CONFIG.MERCENARY_PAY_PER_BATTLE,
    payPerBattle: CONFIG.MERCENARY_PAY_PER_BATTLE,
    active: true
  };
}

export function acceptContract(state, offer = getContractOffer(state)) {
  if (!offer) return { ok: false, reason: "unavailable" };
  if (state.player.contract?.active && state.player.contract.factionId === offer.factionId) {
    return { ok: false, reason: "active", contract: state.player.contract };
  }
  state.player.contract = {
    ...offer,
    acceptedAtTick: state.tick,
    battlesWon: 0,
    goldEarned: 0
  };
  if (state.mechanics) state.mechanics.contractsAccepted += 1;
  addEvent(state, "log.contractAccepted", {
    townId: offer.townId,
    factionId: offer.factionId
  }, "win");
  recordChronicleMilestone(state, "firstContract", {
    townId: offer.townId,
    factionId: offer.factionId
  });
  return { ok: true, contract: state.player.contract };
}

export const generateContractOffer = getContractOffer;
export const takeContract = acceptContract;

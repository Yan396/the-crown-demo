import {
  acceptMercenaryContract,
  getTavernContract,
  getTavernContracts
} from "./sim.js";

// Compatibility facade for the Phase 2.5 contract probes. Production and
// tests now resolve offers through one implementation instead of maintaining
// a second, stale contract pipeline.
export function getContractOffer(state) {
  return getTavernContract(state);
}

export function getContractOffers(state) {
  return getTavernContracts(state) || [];
}

export function acceptContract(state, offer = getContractOffer(state)) {
  if (!offer) return { ok: false, reason: "unavailable" };
  return acceptMercenaryContract(state, offer.townId, offer.id || offer.type);
}

export const generateContractOffer = getContractOffer;
export const takeContract = acceptContract;

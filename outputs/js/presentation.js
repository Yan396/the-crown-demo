/*
 * Presentation tuning for the battle stage.
 *
 * DELIBERATELY SEPARATE from data.js/CONFIG. Nothing here reaches the
 * simulation: these values move pixels and milliseconds only. Changing any of
 * them must never change a battle's outcome, a saved field, or an RNG draw --
 * the stage is a replay of an already-resolved script, so retiming it is free.
 *
 * The engine's own `t` values are a compact ordering, not a performance. The
 * stage rebuilds an absolute schedule from these numbers while keeping the
 * event ORDER and DATA exactly as the engine emitted them.
 */
export const CONFIG_PRESENTATION = Object.freeze({
  /* -- phase 1: deploy ----------------------------------------------------- */
  DEPLOY_MS: 2500,
  DEPLOY_SETTLE_MS: 420,      // the synchronised dip once both lines are in place

  /* -- phase 2: standoff --------------------------------------------------- */
  STANDOFF_MS: 1000,          // held still on purpose; the silence is the beat
  VOLLEY_OFFSET_MS: 300,      // into the standoff, town fights only

  /* -- phase 3: charge ----------------------------------------------------- */
  CHARGE_MS: 1500,
  CHARGE_BACK_RANK_LAG_MS: 200,
  CHARGE_LEAD_MS: 120,        // everything speeds up just before contact

  /* -- phase 4: melee ------------------------------------------------------ */
  CONTACT_PAUSE_MS: 80,
  ROUND_MS: 2400,
  ROUND_BREATH_MS: 400,       // both sides give half a step, then press back in
  // The engine often resolves a small fight in a single round. The melee is the
  // main act, so it is given a floor as well as a ceiling: few rounds stretch,
  // many rounds compress, and either way the battle lands in the 12-20s band.
  MELEE_MIN_MS: 7200,
  MELEE_MAX_MS: 12000,
  STRIKE_PAUSE_MS: 60,
  KILL_FALL_MS: 80,           // the dying token lags before melting
  CLOSE_RANKS_MS: 260,        // neighbours recoil, then fill the gap
  CLOSE_RANKS_PX: 7,

  /* -- phase 5: rout and settlement ---------------------------------------- */
  ROUT_SLOWMO_MS: 300,
  FLEE_MIN_MS: 700,
  FLEE_VAR_MS: 700,
  VICTORY_HOLD_MS: 500,       // winners hold their weapons up before the seal
  SEAL_TO_TALLY_MS: 400,      // the tally must not land on top of the field

  /* -- shared -------------------------------------------------------------- */
  ARROW_FLIGHT_MS: 620,
  LONG_PRESS_MS: 600,

  /* -- camera -------------------------------------------------------------- */
  // One continuous push from a wide deployment shot to a tight rout.
  ZOOM_DEPLOY: 0.94,
  ZOOM_STANDOFF: 0.97,
  ZOOM_CHARGE: 1.04,
  ZOOM_MELEE: 1.08,
  ZOOM_ROUT: 1.13
});

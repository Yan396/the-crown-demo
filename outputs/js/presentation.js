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

  // How far the lines have closed on the centreline by the end of the charge.
  // Not a pixel offset: a ratio toward a measured target, because a fixed
  // nudge never reaches the middle of a 390px screen.
  CHARGE_CONVERGE: 0.82,

  /* -- phase 4: melee ------------------------------------------------------ */
  CONTACT_PAUSE_MS: 80,
  // The melee band. Each side's own spread is remapped onto a band straddling
  // the centreline, so the two armies interleave instead of holding one half
  // of the screen each. BIAS > 0.5 pushes each side's leading edge PAST the
  // centre, which is what produces the overlap.
  MELEE_BAND_PX: 112,
  MELEE_BAND_MAX_RATIO: 0.3,  // cap the band as a share of stage width
  MELEE_BIAS: 0.85,
  MELEE_JITTER_PX: 11,
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
  TALLY_VIEWPORT_MARGIN_PX: 8,

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

/*
 * v1.1 formation layouts.
 *
 * These exist only when the script carries a `formations` block, which only
 * happens under ?v=1.1 -- v1.0 keeps the plain row packing untouched.
 *
 * Each layout returns a parade position in stage pixels for one token:
 *   x  along the approach axis, already multiplied by `dir`
 *      (+1 = the player's side advancing right, -1 = the enemy advancing left)
 *   y  vertical offset, negative is further up the sheet
 *   rank  depth index, used for the charge lag and the draw scale
 *
 * The shapes have to differ at a GLANCE on a 390px screen, so they are pushed
 * well past anatomical sense: a wedge is a hard V, a line is one flat row, a
 * circle is a ring with a man in the middle.
 */
export const FORMATION_SHAPE = Object.freeze({
  WEDGE_DEPTH_PX: 26,   // how far each rank falls back from the tip
  WEDGE_LIFT_PX: 21,    // how far each rank steps off the spine
  LINE_GAP_PX: 27,
  LINE_WAVER_PX: 3,     // a flat row, with just enough waver to look hand-drawn
  CIRCLE_RX_PX: 54,
  CIRCLE_RY_PX: 34,
  JITTER_SCALE: 0.25    // formations keep their shape: damp the usual scatter
});

export const FORMATION_LAYOUTS = Object.freeze({
  // 锋矢 — a spearhead. One man at the point, the rest falling back in two
  // symmetrical arms.
  wedge(index, count, dir) {
    const rank = Math.ceil(index / 2);
    const arm = index === 0 ? 0 : (index % 2 === 1 ? -1 : 1);
    const deepest = Math.ceil((count - 1) / 2);
    return {
      x: (deepest - rank) * FORMATION_SHAPE.WEDGE_DEPTH_PX * dir,
      y: arm * rank * FORMATION_SHAPE.WEDGE_LIFT_PX,
      rank
    };
  },

  // 横列 — one flat rank, shoulder to shoulder, no depth at all.
  line(index, count, dir) {
    const gap = Math.min(FORMATION_SHAPE.LINE_GAP_PX, 190 / Math.max(1, count));
    return {
      x: index * gap * dir,
      y: (index % 2 ? 1 : -1) * FORMATION_SHAPE.LINE_WAVER_PX,
      rank: 0
    };
  },

  // 圆阵 — a ring facing outward with one man held in the middle.
  circle(index, count, dir) {
    const centre = FORMATION_SHAPE.CIRCLE_RX_PX;
    if (index === 0 || count < 3) return { x: centre * dir, y: 0, rank: 1 };
    const onRing = count - 1;
    const angle = ((index - 1) / onRing) * Math.PI * 2;
    return {
      x: (centre + Math.cos(angle) * FORMATION_SHAPE.CIRCLE_RX_PX) * dir,
      y: Math.sin(angle) * FORMATION_SHAPE.CIRCLE_RY_PX,
      rank: Math.sin(angle) > 0 ? 0 : 1
    };
  }
});

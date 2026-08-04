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
  DEPLOY_DEPTH_LAG_MS: 260,   // a raked rank marches in back-to-front too
  DEPLOY_LAG_MAX_MS: 620,     // ...but everyone is IN before the standoff
  CHARGE_LEAD_MS: 120,        // everything speeds up just before contact

  // How far the lines have closed on the centreline by the end of the charge.
  // Not a pixel offset: a ratio toward a measured target, because a fixed
  // nudge never reaches the middle of a 390px screen.
  CHARGE_CONVERGE: 0.82,

  /* -- phase 4: melee ------------------------------------------------------ */
  CONTACT_PAUSE_MS: 80,
  // Stage shake is rationed to exactly two moments in a whole battle: first
  // contact and the final blow. Everything else earns its weight from holds,
  // knockback and splatter. How far it throws is derived from the stage width,
  // so a 390px phone and an 1100px desktop feel the same.
  SHAKE_BUDGET: 2,
  SHAKE_WIDTH_RATIO: 0.004,
  SHAKE_MIN_PX: 2,
  SHAKE_MAX_PX: 7,
  // The melee band. Each side's own spread is remapped onto a band straddling
  // the centreline, so the two armies interleave instead of holding one half
  // of the screen each. BIAS > 0.5 pushes each side's leading edge PAST the
  // centre, which is what produces the overlap.
  // The band has to GROW with the army. A fixed width read fine at 5-10 tokens
  // and collapsed into one unreadable clump at 40+, because every extra man was
  // packed into the same 112px.
  // BIAS is where a side's own spread sits relative to the centreline. At 0.85
  // only the leading 15% of each army crossed it and the two bulks stood a
  // stage apart with an empty middle -- which is precisely the "can I see them
  // fighting" failure. At 0.5 the two spreads are centred on the same line, so
  // the armies genuinely interleave.
  // The band also has to be WIDE enough to be a battle. Squeezed to a third of
  // the stage, 32 figures became one black clump in the middle of an empty
  // sheet -- the two armies were interleaved, but there was nothing to read
  // inside the smudge. Each side now spreads across most of the stage, so the
  // ranks interpenetrate along a front instead of piling onto a point.
  MELEE_BAND_PX: 140,
  MELEE_BAND_PER_TOKEN_PX: 20,
  MELEE_BAND_MAX_RATIO: 0.62,
  MELEE_BIAS: 0.5,
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
  // The kill is three held beats, not one fade: the killer holds his weapon up,
  // THEN the body holds its death pose, THEN it dissolves into the stain.
  KILL_RAISE_MS: 140,
  DEATH_POSE_MS: 160,

  /* -- phase 5: rout and settlement ---------------------------------------- */
  ROUT_SLOWMO_MS: 300,
  FLEE_MIN_MS: 700,
  FLEE_VAR_MS: 700,
  VICTORY_HOLD_MS: 500,       // winners hold their weapons up before the seal
  SEAL_TO_TALLY_MS: 400,      // the tally must not land on top of the field
  TALLY_VIEWPORT_MARGIN_PX: 8,

  /* -- health bars (v1.1 only) --------------------------------------------- */
  HP_LOW_RATIO: 0.3,          // below this the cinnabar deepens and pulses once
  HP_FLASH_MS: 260,           // the single flash a bar gives as its token dies

  /* -- playback speed ------------------------------------------------------ */
  SPEED_STEPS: Object.freeze([1, 2, 4]),

  /* -- F3 unit motion ------------------------------------------------------ */
  // Arrows launch this far BEFORE their strike so the impact stays on the beat.
  ARROW_LEAD_MS: 320,
  ARROW_ARC_PX: 46,           // bezier rise; the shot must read as an arc
  ARROW_SPREAD_MS: 60,        // stagger inside one volley
  VOLLEY_MIN_ARROWS: 3,       // a volley reads as a shower at 3-5 shafts and
  VOLLEY_MAX_ARROWS: 5,       // as noise beyond that, whatever the roster says
  VOLLEY_ANGLE_VARIANCE_PX: 34,
  VOLLEY_MISS_RATE: 0.1,      // decorative shafts only -- see MISS_ note below
  ARROW_STUCK_MS: 2000,       // a missed shaft stands in the ground, then fades
  // The bow cycle, as four held poses. The draw is the one that has to read at
  // 26px: arm back, string bent, shaft lying on the bow and breaking the
  // outline. It is the longest hold for exactly that reason.
  BOW_NOCK_MS: 100,
  BOW_DRAW_MS: 200,
  BOW_RELEASE_MS: 60,
  BOW_RECOVER_MS: 100,
  // Cavalry cover far more ground than the infantry advance and land first.
  CAVALRY_ADVANCE_MULTIPLIER: 2.2,
  CAVALRY_LEAD_MS: 300,
  // Visual movement only. These multipliers never enter battle resolution or
  // the scripted strike clock: they only change how quickly a token reaches
  // an already-resolved presentation position.
  UNIT_MOVE_SPEEDS: Object.freeze({
    cavalry: 2.2,
    militia: 1,
    veteran: 0.85,
    archer: 0.6
  }),
  UNIT_DEPLOY_BASE_MS: 1200,
  UNIT_CHARGE_BASE_MS: 1500,
  UNIT_REPOSITION_BASE_MS: 620,
  // Bowmen own the rear edge of every formation and do not close with the
  // melee line. Rear is expressed both in camera depth and away from centre.
  ARCHER_REAR_DEPTH: 0.92,
  ARCHER_REAR_OFFSET_PX: 22,
  // Must match `.stage-ranks-player { left }` / `-enemy { right }` in ui.css:
  // it is the only room the rear offset has before a figure leaves the page.
  RANK_INSET_RATIO: 0.07,
  ARCHER_HOLD_BACK_DEPTH: 0.08,
  ARCHER_RANGE_ARC_MS: 900,
  ARCHER_OVERRUN_MARGIN_PX: 12,
  ARCHER_OVERRUN_BACKSTEP_PX: 12,
  // Legacy alias for the heavy tier's contact hold. The performance reads the
  // tier table now; this key is kept, and kept truthful, because it is part of
  // the existing presentation contract.
  CAVALRY_HIT_PAUSE_MS: 130,
  CAVALRY_KNOCKBACK_PX: 16,
  INFANTRY_KNOCKBACK_PX: 10,
  // A horse that hit home is PAST the line it hit; the infantry closes in
  // behind it. Without this the charge lands and then politely queues up.
  CAVALRY_BREAKTHROUGH_PX: 26,
  CAVALRY_REAR_MS: 160,       // the horse rears before both go down as one mass
  // Held keyframes: the silhouette must be STILL long enough to be read.
  POSE_WINDUP_MS: 120,
  POSE_CONTACT_MS: 100,
  POSE_FOLLOW_MS: 100,
  // An officer never waits for a slot and holds every pose a beat longer, so
  // his blows read as the ones that matter.
  LIEUTENANT_EXTRA_HOLD_MS: 60,
  // Too many tokens moving in one frame is a blur, not a battle.
  MAX_CONCURRENT_ACTORS: 6,
  STAGE_TOKEN_CAP: 16,

  /* -- 1b: how big a figure is on this stage -------------------------------- */
  // A token is sized from the STAGE, not from a fixed pixel count, so the two
  // armies occupy the same share of the sheet on a 390px phone and on an
  // 1100px desktop. Two ceilings, because both failure modes are real: too tall
  // for the sheet, or too tall for the room each man actually has beside him.
  TOKEN_HEIGHT_RATIO: 0.32,     // of the world height
  TOKEN_HEIGHT_PER_SPACING: 3.4, // of the lateral room one man has
  TOKEN_MIN_HEIGHT_PX: 70,
  TOKEN_MAX_HEIGHT_PX: 104,
  TOKEN_ASPECT: 0.8,            // width / height
  LIEUTENANT_SCALE: 1.3,        // 6a: an officer is 30% larger, exactly

  /* -- 1c: placing the field on a full-bleed page ---------------------------- */
  // The army band is a FIXED height -- CAMERA.DEPTH_RISE_PX plus one figure --
  // because depth is drawn in real pixels, not as a share of the sheet. That
  // was invisible while the sheet was a 400px card. On a stage that fills the
  // viewport the band has to be PLACED, or a tall phone shows a correct battle
  // pinned to the bottom under an acre of blank paper.
  //
  // Measured UP FROM THE BOTTOM of the world, so a value under 0.5 leaves more
  // sky above the heads than ground below the feet -- which is how the band
  // already read on the old sheet, and how a ground plane is drawn.
  STAGE_BAND_CENTRE_FROM_BOTTOM: 0.46,
  STAGE_GROUND_MIN_PX: 12,   // the front rank's feet never touch the dispatch line
  WALL_LIFT_RATIO: 0.5,      // crenellations stand this far up the band

  /* -- ink discipline ------------------------------------------------------- */
  // The field has to read as aftermath, not as mud. Blots scale with how many
  // men a bucket stood for, are 40% smaller than the first pass, and the whole
  // layer is repainted with an age ramp once it runs past its area budget.
  STAIN_SCALE: 0.6,
  STAIN_AREA_CAP_RATIO: 0.16, // of the world's area
  STAIN_OLDEST_ALPHA: 0.3,
  SLASH_FLASH_MS: 90,         // the 2px ink slash along the strike vector
  SPLATTER_SPREAD_PX: 22,

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
 * Weight tiers — impact identity, expressed as RHYTHM rather than as numbers.
 *
 * The eyes-closed test is the spec: at 1x, a cavalry blow and a militia blow
 * must be tellable apart from their timing alone. So a heavier tier telegraphs
 * for longer AND holds the contact for longer; the knockback and the splatter
 * only confirm what the timing already said.
 *
 * Presentation only. A tier is chosen from the troopType/arm the engine already
 * put on the token; it never feeds back into damage, kills or survivors.
 */
export const WEIGHT_TIERS = Object.freeze({
  light: Object.freeze({
    windupMs: 100, contactMs: 60, followMs: 100,
    knockbackPx: 6, splatterScale: 0.8, blots: 2, inkBurst: false, jolt: 0
  }),
  medium: Object.freeze({
    windupMs: 140, contactMs: 90, followMs: 100,
    knockbackPx: 10, splatterScale: 1.2, blots: 3, inkBurst: false, jolt: 0
  }),
  heavy: Object.freeze({
    windupMs: 200, contactMs: 130, followMs: 100,
    knockbackPx: 16, splatterScale: 1.8, blots: 5, inkBurst: true, jolt: 4
  })
});

export const TIER_ORDER = Object.freeze(["light", "medium", "heavy"]);

/**
 * Which tier a drawn token hits at.
 *
 * `arm` wins over `troopType` because a mounted man is heavy whatever stack he
 * came out of, and an officer is heavy because the stage draws him as one.
 */
export function weightTierFor(token) {
  if (!token) return "light";
  if (token.isLieutenant || token.arm === "cavalry" || token.troopType === "cavalry") return "heavy";
  if (token.troopType === "veteran" || token.troopType === "lieutenant") return "medium";
  if (token.arm === "spear") return "medium";
  return "light";
}

/** Presentation-only travel speed for a resolved token. */
export function movementSpeedFor(token) {
  if (token?.arm === "cavalry" || token?.troopType === "cavalry") {
    return CONFIG_PRESENTATION.UNIT_MOVE_SPEEDS.cavalry;
  }
  if (token?.arm === "archer") return CONFIG_PRESENTATION.UNIT_MOVE_SPEEDS.archer;
  if (token?.troopType === "veteran") return CONFIG_PRESENTATION.UNIT_MOVE_SPEEDS.veteran;
  return CONFIG_PRESENTATION.UNIT_MOVE_SPEEDS.militia;
}

export function movementDurationMs(token, baseMs) {
  return Math.round(Math.max(0, Number(baseMs) || 0) / movementSpeedFor(token));
}

export function tierOf(token) {
  return WEIGHT_TIERS[weightTierFor(token)];
}

/** Total length of one strike performance at a tier, officers held longer. */
export function strikeDurationMs(tierName, isLieutenant = false) {
  const tier = WEIGHT_TIERS[tierName] || WEIGHT_TIERS.light;
  return tier.windupMs + tier.contactMs + tier.followMs
    + (isLieutenant ? CONFIG_PRESENTATION.LIEUTENANT_EXTRA_HOLD_MS : 0);
}

/** 1c: one formula for how far the two allowed shakes throw the world. */
export function shakeOffsetPx(stageWidth) {
  const raw = (Number(stageWidth) || 0) * CONFIG_PRESENTATION.SHAKE_WIDTH_RATIO;
  return Math.max(
    CONFIG_PRESENTATION.SHAKE_MIN_PX,
    Math.min(CONFIG_PRESENTATION.SHAKE_MAX_PX, raw)
  );
}

/**
 * The two moments in a battle at which the field asks for an order.
 *
 * Derived from the script alone -- round boundaries and the melee shape -- so
 * the same script always asks at the same two beats. That is what makes a
 * recorded injection replayable, and what keeps autoplay deterministic.
 *
 * Returns absolute virtual-clock times in the stage's own schedule.
 */
/*
 * v1.1 formation layouts.
 *
 * These exist only when the script carries a `formations` block, which only
 * happens under ?v=1.1 -- v1.0 keeps the plain row packing untouched.
 *
 * Each layout returns one token's place in the cross-section:
 *   x      along the approach axis, already multiplied by `dir`
 *          (+1 = the player advancing right, -1 = the enemy advancing left)
 *   depth  0 = nearest the camera, 1 = far side of the field. Never raw pixels:
 *          depthPlacement turns it into rise, scale and haze together.
 *   rank   used for the charge lag
 *
 * The shapes have to differ at a GLANCE on a 390px screen, so they are pushed
 * well past anatomical sense: a wedge is a hard V, a line is one flat row, a
 * circle is a ring with a man in the middle.
 */
/*
 * The camera is a side-on cross-section of the field, and it has to stay
 * internally consistent: the ONLY way a figure moves up the frame is by
 * standing further from the camera, and anything further away is also smaller
 * and paler. A token that rises without shrinking reads as floating, which is
 * exactly what the ranks looked like before.
 *
 * Every placement below is expressed as (lateral x, depth 0..1), never as raw
 * vertical pixels, so the three cues can never disagree.
 */
export const CAMERA = Object.freeze({
  DEPTH_RISE_PX: 140,  // how far the far rank sits up the sheet -- the FLOOR
  // 1c: on a full-bleed stage a fixed rise is what leaves the page empty. The
  // formation's DEPTH grows with the sheet; the men do not (TOKEN_MAX_HEIGHT_PX
  // still binds). A deeper field with normal-sized men is how you would draw
  // it; scaling the figures up instead would just be a magnified small stage.
  DEPTH_RISE_RATIO: 0.5,     // of the world height
  DEPTH_RISE_MAX_PX: 480,    // ...but a desktop is not a vertical scatter
  NEAR_SCALE: 1.18,    // front of the field
  FAR_SCALE: 0.74,     // back of the field
  // Haze, not disappearance. The far rank has to stay INK -- at 0.42 a raked
  // line put most of an army below half opacity and the battle read as a smear
  // of grey. Depth is carried by scale and overlap first, tone last.
  FAR_FADE: 0.74       // atmospheric haze on the far rank
});

/**
 * 1b — how tall a drawn figure is on THIS stage.
 *
 * Two ceilings, and the smaller wins:
 *   - a share of the world height, so the two armies fill the sheet;
 *   - a multiple of the lateral room each man has, so a crowded phone rank
 *     stays a rank of men instead of one solid black mass.
 */
export function tokenHeightPx(worldHeight, spacingPx) {
  const byStage = (Number(worldHeight) || 0) * CONFIG_PRESENTATION.TOKEN_HEIGHT_RATIO;
  const byRoom = (Number(spacingPx) || 0) * CONFIG_PRESENTATION.TOKEN_HEIGHT_PER_SPACING;
  return Math.round(Math.max(
    CONFIG_PRESENTATION.TOKEN_MIN_HEIGHT_PX,
    Math.min(CONFIG_PRESENTATION.TOKEN_MAX_HEIGHT_PX, Math.min(byStage, byRoom))
  ));
}

/**
 * 1b — the share of the stage the two armies stand in.
 *
 * Measured the way the eye measures it: from the feet of the nearest man to the
 * top of the head of the furthest. `depthSpread` is how much of the 0..1 depth
 * range the formation actually uses -- a raked 横列 uses the least, so it is the
 * case the >= 40% floor has to hold for.
 */
export function armyBandRatio({ worldHeight, tokenHeight, depthSpread = 1, nearDepth = 0 }) {
  if (!worldHeight) return 0;
  const scaleAt = (depth) => CAMERA.NEAR_SCALE - depth * (CAMERA.NEAR_SCALE - CAMERA.FAR_SCALE);
  const farDepth = Math.min(1, nearDepth + depthSpread);
  const nearFeet = -nearDepth * CAMERA.DEPTH_RISE_PX;
  const farHead = -farDepth * CAMERA.DEPTH_RISE_PX - tokenHeight * scaleAt(farDepth);
  const nearHead = nearFeet - tokenHeight * scaleAt(nearDepth);
  const farFeet = -farDepth * CAMERA.DEPTH_RISE_PX;
  const lowest = Math.max(nearFeet, farFeet);
  const highest = Math.min(nearHead, farHead);
  return (lowest - highest) / worldHeight;
}

/*
 * How far the far rank rises on a stage of this height. Clamped at both ends:
 * the shipped 140px is the floor, so a short landscape stage is unchanged.
 */
export function depthRiseFor(worldHeight) {
  const target = (Number(worldHeight) || 0) * CAMERA.DEPTH_RISE_RATIO;
  return Math.round(Math.max(
    CAMERA.DEPTH_RISE_PX,
    Math.min(CAMERA.DEPTH_RISE_MAX_PX, target)
  ));
}

export function depthPlacement(depth, rise = CAMERA.DEPTH_RISE_PX) {
  const d = Math.max(0, Math.min(1, depth));
  return {
    ty: -d * rise,
    scale: CAMERA.NEAR_SCALE - d * (CAMERA.NEAR_SCALE - CAMERA.FAR_SCALE),
    fade: 1 - d * (1 - CAMERA.FAR_FADE),
    // Nearer figures occlude further ones, or the cross-section falls apart.
    z: Math.round((1 - d) * 100)
  };
}

export const FORMATION_SHAPE = Object.freeze({
  WEDGE_DEPTH_PX: 26,   // how far each rank falls back from the tip
  WEDGE_LIFT_PX: 21,    // how far each rank steps off the spine
  LINE_GAP_PX: 27,
  LINE_WAVER_PX: 3,     // a flat row, with just enough waver to look hand-drawn
  LINE_NEAR_DEPTH: 0.34, // the rake across a 横列, near end to far end
  LINE_FAR_DEPTH: 0.66,
  CIRCLE_RX_PX: 54,
  CIRCLE_RY_PX: 34,
  JITTER_SCALE: 0.25    // formations keep their shape: damp the usual scatter
});

export const FORMATION_LAYOUTS = Object.freeze({
  // 锋矢 — a spearhead. The point stands nearest the camera; the two arms fall
  // back AND recede into the field, so the V is a wedge in depth, not a V
  // painted flat on the sheet.
  wedge(index, count, dir) {
    const rank = Math.ceil(index / 2);
    const arm = index === 0 ? 0 : (index % 2 === 1 ? -1 : 1);
    const deepest = Math.max(1, Math.ceil((count - 1) / 2));
    // The two arms sit at slightly different depths so they never overlap.
    const spread = arm === 0 ? 0.5 : arm < 0 ? 0.24 : 0.76;
    return {
      x: (deepest - rank) * FORMATION_SHAPE.WEDGE_DEPTH_PX * dir,
      depth: Math.min(1, (rank / (deepest + 1)) * 0.55 + spread * 0.45),
      rank
    };
  },

  // 横列 — one rank, raked. Every man is on the SAME line, which is what makes
  // it read as a line rather than a crowd; the line is simply set slightly
  // oblique to the camera rather than dead side-on, so the rank has depth to
  // stand in. A perfectly flat row collapsed the army into a strip roughly one
  // figure tall, which is exactly what 1b's "armies occupy >= 40% of stage
  // height" exists to prevent.
  line(index, count, dir, halfWidth = 190) {
    const gap = Math.min(FORMATION_SHAPE.LINE_GAP_PX, halfWidth / Math.max(1, count));
    const along = count > 1 ? index / (count - 1) : 0.5;
    return {
      x: index * gap * dir,
      depth: FORMATION_SHAPE.LINE_NEAR_DEPTH
        + along * (FORMATION_SHAPE.LINE_FAR_DEPTH - FORMATION_SHAPE.LINE_NEAR_DEPTH),
      rank: 0
    };
  },

  // 圆阵 — a ring seen side-on is an ellipse: the near arc sits low and large,
  // the far arc high and small, with one man held in the middle.
  circle(index, count, dir) {
    const centre = FORMATION_SHAPE.CIRCLE_RX_PX;
    if (index === 0 || count < 3) return { x: centre * dir, depth: 0.5, rank: 1 };
    const onRing = count - 1;
    const angle = ((index - 1) / onRing) * Math.PI * 2;
    return {
      x: (centre + Math.cos(angle) * FORMATION_SHAPE.CIRCLE_RX_PX) * dir,
      depth: (1 + Math.sin(angle)) / 2,
      rank: Math.sin(angle) > 0 ? 1 : 0
    };
  }
});

import { stampSeal } from "./seal.js";
import { crownAudio } from "./audio.js";
import {
  CONFIG_PRESENTATION as P,
  FORMATION_LAYOUTS,
  FORMATION_SHAPE,
  WEIGHT_TIERS,
  commandWindows,
  depthPlacement,
  movementDurationMs,
  movementSpeedFor,
  shakeOffsetPx,
  strikeDurationMs,
  tokenHeightPx,
  weightTierFor
} from "./presentation.js";

/*
 * Battle cinematics — a full-screen paper stage that PLAYS a battleScript.
 *
 * Presentation only. Every number on screen (damage, kills, loot, survivors)
 * is read from the script the engine handed over; this module resolves
 * nothing, consumes no gameplay RNG, and writes no game state. Watched
 * playback and skipped playback are two projections of the same event array,
 * which is why they cannot disagree.
 *
 * Contract: outputs/js/battle.js buildBattleScript (battle-engine ac45303).
 *
 * Performance: tokens are DOM nodes animated with transform/opacity only; the
 * ink-stain layer is a separate canvas that ACCUMULATES (painted on kill,
 * never redrawn per frame); the whole subtree is built on play() and removed
 * on dispose().
 */

// Import-safe outside a browser; the suite smoke-imports every module in Node.
const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

const MAX_SCRIPT_TOKENS = 24; // mirrors the engine's bucketing constant

// Kept as the module's local names; the values now live in presentation.js so
// the whole performance can be retimed from one place.
// The hit pause is no longer here: it is the tier's own contact hold, read from
// WEIGHT_TIERS at the moment of the blow. P.STRIKE_PAUSE_MS stays in the
// presentation config as the untiered default it always was.
const TIMING = Object.freeze({
  ROUT_SLOWMO: P.ROUT_SLOWMO_MS,
  LONG_PRESS: P.LONG_PRESS_MS,
  ARROW_FLIGHT: P.ARROW_FLIGHT_MS
});

const PHASES = Object.freeze(["deploy", "standoff", "charge", "melee", "rout"]);

export function normalizePlaybackSpeed(value) {
  const numeric = Number(value);
  return [1, 2, 4].includes(numeric) ? numeric : 1;
}

export function nextPlaybackSpeed(value) {
  const current = normalizePlaybackSpeed(value);
  return current === 1 ? 2 : current === 2 ? 4 : 1;
}

export function advanceVirtualClock(current, realDelta, playbackSpeed) {
  return current + Math.max(0, Number(realDelta) || 0) * normalizePlaybackSpeed(playbackSpeed);
}

export function battleEndCounts(event) {
  return {
    player: Math.max(0, Math.floor(Number(event?.survivors?.player) || 0)),
    enemy: Math.max(0, Math.floor(Number(event?.survivors?.enemy) || 0))
  };
}

export function archerLineCrossed(sideKey, archerXs, foeXs, margin = P.ARCHER_OVERRUN_MARGIN_PX) {
  if (!archerXs.length || !foeXs.length) return false;
  const line = sideKey === "player" ? Math.max(...archerXs) : Math.min(...archerXs);
  return sideKey === "player"
    ? Math.min(...foeXs) <= line + margin
    : Math.max(...foeXs) >= line - margin;
}

function seededRandom(seed) {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  return function nextRandom() {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Adapter for the frozen engine contract:
 *   { battleId, terrain, sides: { player, enemy }, events: [{ t, type, ... }] }
 *
 * Two things the contract fixes that are easy to get wrong, both handled here:
 *
 * 1. Rout is a real event and is NEVER inferred. A battle may end with no rout
 *    at all, or with BOTH sides routing; deriving one from `winner` would
 *    invent a rout the engine never emitted.
 * 2. Above 24 troops one token stands for several men. `weight` and per-token
 *    `capacity` are re-derived with the engine's own formula, so repeated kills
 *    on one idx drain that bucket and the token only leaves the field when it
 *    empties. That is what makes watched and skipped survivors land exactly on
 *    battle_end.survivors.
 */
/**
 * Fold the engine's buckets down to at most STAGE_TOKEN_CAP drawn figures.
 *
 * PRESENTATION ONLY. Capacity is summed, never rounded, so survivorsOf() and
 * therefore the end-of-battle count are bit-for-bit what they were; the engine
 * keeps its own 24-bucket arithmetic untouched. A merged token simply stands
 * for more men, exactly as a token already did above 24 troops.
 */
export function aggregateTokens(tokens) {
  const cap = P.STAGE_TOKEN_CAP;
  if (tokens.length <= cap) {
    return tokens.map((token) => ({ ...token, covers: [token.idx] }));
  }
  const perVisual = Math.ceil(tokens.length / cap);
  const merged = [];
  for (let start = 0; start < tokens.length; start += perVisual) {
    const group = tokens.slice(start, start + perVisual);
    const head = group[0];
    merged.push({
      idx: head.idx,
      troopType: head.troopType,
      arm: head.arm || null,
      capacity: group.reduce((sum, token) => sum + token.capacity, 0),
      covers: group.map((token) => token.idx),
      node: null
    });
  }
  return merged;
}

export function normalizeScript(raw) {
  const sides = {};
  ["player", "enemy"].forEach((key) => {
    const source = raw.sides[key];
    const total = Math.max(0, Math.floor(source.startTroops || 0));
    const weight = Math.max(1, Math.ceil(total / MAX_SCRIPT_TOKENS));
    sides[key] = {
      label: source.label,
      startTroops: total,
      weight,
      tokens: aggregateTokens(
        (source.tokens || []).map((token) => ({
          idx: token.idx,
          troopType: token.troopType,
          arm: token.arm || null,
          capacity: Math.max(0, Math.min(weight, total - token.idx * weight)),
          node: null
        }))
      )
    };
    // Engine idx -> the visual token that stands for it. Strike events name an
    // engine idx, so this is what keeps them resolvable after aggregation.
    sides[key].byIdx = new Map();
    sides[key].tokens.forEach((token) => {
      token.covers.forEach((idx) => sides[key].byIdx.set(idx, token));
    });
  });
  const normalized = {
    battleId: raw.battleId,
    terrain: raw.terrain,
    sides,
    events: raw.events.slice().sort((first, second) => first.t - second.t)
  };
  if (raw.lieutenant === "player") normalized.lieutenant = "player";
  normalized.lieutenantIds = Array.isArray(raw.lieutenantIds)
    ? raw.lieutenantIds.filter((id) => typeof id === "string" && id.length)
    : [];
  if (raw.formations) {
    normalized.formations = {
      player: raw.formations.player || "line",
      enemy: raw.formations.enemy || "line"
    };
  }
  if (raw.command) normalized.command = raw.command;
  return normalized;
}

/**
 * Rebuild an absolute performance schedule for an already-ordered event array.
 *
 * The engine's `t` is a compact ordering, not a performance: a whole battle
 * arrives inside a couple of seconds, which reads as one blur. This spreads the
 * SAME events, in the SAME order, carrying the SAME data, across five legible
 * phases.
 *
 * It returns times only. No event is added, dropped, reordered or edited, so
 * survivors still land exactly on battle_end.survivors and a skipped battle
 * still settles identically to a watched one.
 */
/**
 * Split the melee budget across however many rounds the engine emitted.
 *
 * The ceiling is authoritative: MAX_BATTLE_ROUNDS is 100, so a pathological
 * fight must compress rather than run for minutes. The floor stretches a
 * one-round fight so the main act still has body.
 */
export function meleeShape(roundCount) {
  if (!roundCount) return { roundMs: P.ROUND_MS, breathMs: P.ROUND_BREATH_MS, totalMs: 0 };
  const ideal = roundCount * (P.ROUND_MS + P.ROUND_BREATH_MS);
  const totalMs = Math.min(P.MELEE_MAX_MS, Math.max(P.MELEE_MIN_MS, ideal));
  const slot = totalMs / roundCount;
  const breathMs = Math.min(P.ROUND_BREATH_MS, slot * 0.2);
  return { roundMs: Math.max(0, slot - breathMs), breathMs, totalMs };
}

export function scheduleEvents(events) {
  const times = new Array(events.length).fill(undefined);
  const contactAt = P.DEPLOY_MS + P.STANDOFF_MS + P.CHARGE_MS;

  // Bucket strikes/morale under the round they belong to.
  const rounds = [];
  let current = null;
  events.forEach((event, index) => {
    if (event.type === "round_start") {
      current = { head: index, items: [] };
      rounds.push(current);
    } else if (current && (event.type === "strike" || event.type === "morale")) {
      current.items.push(index);
    }
  });

  const { roundMs, breathMs } = meleeShape(rounds.length);

  let clock = contactAt;
  rounds.forEach((round) => {
    times[round.head] = clock;
    const count = round.items.length;
    round.items.forEach((index, position) => {
      // Spread inside the round, leaving the breath at the end clear.
      times[index] = clock + Math.round(((position + 1) / (count + 1)) * roundMs);
    });
    clock += roundMs + breathMs;
  });

  const fleeMs = P.ROUT_SLOWMO_MS + P.FLEE_MIN_MS + P.FLEE_VAR_MS;
  events.forEach((event, index) => {
    if (times[index] !== undefined) return;
    if (event.type === "battle_start") times[index] = 0;
    else if (event.type === "volley" || event.type === "archer_volley") {
      times[index] = P.DEPLOY_MS + P.VOLLEY_OFFSET_MS;
    } else if (event.type === "command") times[index] = Math.max(0, P.DEPLOY_MS - 180);
    else if (event.type === "rout") times[index] = clock;
    else if (event.type === "battle_end") times[index] = clock + fleeMs + P.VICTORY_HOLD_MS;
    else times[index] = clock;
  });

  // The engine's order is authoritative; never let a rounding land out of it.
  for (let index = 1; index < times.length; index += 1) {
    if (times[index] < times[index - 1]) times[index] = times[index - 1];
  }
  return times;
}

export function survivorsOf(side) {
  return side.tokens.reduce((sum, token) => sum + token.capacity, 0);
}

/**
 * Per-token damage budgets, derived from the script alone.
 *
 * IMPORTANT: this engine has no hitpoint pool. TROOP_TYPES carries atk/def/
 * cost/wage and nothing else, and troops are lost by COUNT -- there is no
 * `hp`/`hpMax` on a token, a troop stack or the lieutenant to read. So a bar
 * cannot display "current HP"; it has to be derived.
 *
 * What the script does carry is every strike's `dmgShown` and `kill` against a
 * named token. Because the whole event array is known before the first frame,
 * each token's budget can be totalled up front: the damage it will have taken
 * by the time the blow that empties it lands. The bar then drains on the
 * engine's own numbers and reaches exactly zero on the killing blow, instead
 * of on an invented scale.
 *
 * Read-only: nothing here is written back, and the engine stays the single
 * source of truth for who dies and when.
 */
export function hpCeilings(events) {
  const ceilings = new Map();
  events.forEach((event) => {
    if (event.type !== "strike" || !event.to || !Number.isFinite(event.hpAfter)) return;
    const key = `${event.to.side}:${event.to.idx}`;
    // The first strike a token takes leaves it at its highest recorded hpAfter,
    // so that value plus one blow is the closest honest read on its full pool.
    if (!ceilings.has(key)) {
      ceilings.set(key, event.hpAfter + Math.max(1, Number(event.dmgShown) || 1));
    }
  });
  return ceilings;
}

export function damageBudgets(events) {
  const budgets = new Map();
  const running = new Map();
  events.forEach((event) => {
    if (event.type !== "strike" || !event.to) return;
    const key = `${event.to.side}:${event.to.idx}`;
    const taken = (running.get(key) || 0) + Math.max(0, Number(event.dmgShown) || 0);
    running.set(key, taken);
    // A token can be hit after an earlier kill when it stands for several men;
    // the budget tracks the latest total, so the bar empties on the last one.
    if (event.kill) budgets.set(key, taken);
  });
  // Survivors never empty: their budget is everything they will absorb.
  running.forEach((taken, key) => {
    if (!budgets.has(key)) budgets.set(key, taken);
  });
  return budgets;
}

/* ---- ink figure as a DOM token ------------------------------------------- */

// Filled calligraphic silhouettes, not line figures: every part is a tapering
// closed shape so a token reads as one brush mass at 24px tall. Variants are
// keyed off the troop types the engine already emits -- no type is invented
// here, and nothing below feeds back into the simulation.
//
// All figures are drawn facing +x; the enemy rank flips the <svg> in CSS.
// Props (spear, bow, banner, saber) deliberately cross the body outline,
// because that overhang is what makes the class readable at a glance.

// The town's own archers, standing on the crenellations of a `town` fight.
//
// These are NOT troop tokens and never reuse one. The contract's `volley`
// carries side: 'defender', which is an environmental cue -- it does NOT say
// the enemy side is the defender -- so no unit's figure is ever swapped for a
// bow. The wall garrison is scenery that belongs to the terrain.
function archerFigure() {
  return (
    '<svg viewBox="0 0 32 34" aria-hidden="true" focusable="false">' +
    '<g class="fig-pose" fill="currentColor">' +
    // The bow: a deep arc well clear of the body, so the silhouette has a hole
    // in it. That hole is what says "archer" before any detail resolves.
    '<path class="archer-bow" d="M21.6 3.4Q28.4 15 21.6 26.6L19.8 25.6'
    + 'Q26 15 19.8 4.4Z"/>' +
    // String and nocked shaft. Both are classed so the draw can bend one and
    // carry the other; at full draw the shaft breaks the outline on both sides.
    '<path class="archer-string" d="M20.7 4.1 14.4 15.3 20.7 26 20.2 26 13.9 15.3 20.2 4.1Z"/>' +
    '<path class="archer-arrow" d="M11.6 14.6 24.2 14.4 24.2 15.6 11.6 16.1Z"/>' +
    '<path class="archer-head" d="M23.4 14.2 26.6 15 23.4 15.9Z"/>' +
    '<circle cx="12.2" cy="5.4" r="3"/>' +
    '<path d="M9.2 9Q12.2 7.4 15.2 9L16.8 21.8Q12.2 23.6 7.6 21.8Z"/>' +
    '<path d="M10 22.2 8.8 30.6Q10.1 31.3 11.4 30.6L11.8 22.6Z"/>' +
    '<path d="M13 22.6 14.8 30.6Q16.1 31.3 17.3 30.6L15.2 22.2Z"/>' +
    // Bow arm, held out straight and still through the whole cycle.
    '<path d="M14.6 11.4Q18.4 12.4 20.4 14.2L19 15.6Q16.8 13.8 13.4 13.2Z"/>' +
    // Draw arm. This is the part that MOVES: back to the cheek on the draw,
    // snapped open on release. Everything else stays put.
    '<path class="archer-draw-arm" d="M14.2 11.8Q16.8 12.6 18 14.4'
    + 'L16.6 15.8Q15.4 14.2 13.2 13.6Z"/>' +
    "</g></svg>"
  );
}

// Cloth levy: narrow shoulders, a robe hem flaring over thin legs, and a spear
// whose shaft leaves the outline at both ends.
function militiaFigure() {
  return (
    '<g class="fig-melee">' +
    '<path d="M8.2 25.6 23.8 5.2 25.4 6.4 9.8 26.8Z"/>' +
    '<path d="M23.4 5.8 28.6 1.4 26.6 7.6Z"/>' +
    "</g>" +
    '<circle cx="12.2" cy="5.4" r="3"/>' +
    '<path d="M9.2 9Q12.2 7.4 15.2 9L16.8 21.8Q12.2 23.6 7.6 21.8Z"/>' +
    '<path d="M10 22.2 8.8 30.6Q10.1 31.3 11.4 30.6L11.8 22.6Z"/>' +
    '<path d="M13 22.6 14.8 30.6Q16.1 31.3 17.3 30.6L15.2 22.2Z"/>' +
    '<path class="fig-accent" d="M9.1 18.2Q12.4 19.4 15.9 18.2L16.2 20.2Q12.4 21.4 8.8 20.2Z"/>' +
    '<path class="fig-melee" d="M14.6 10.4Q18 11.4 20.4 13.4L19 15Q16.6 13.2 13.6 12.6Z"/>'
  );
}

// Line trooper: broader mass, a pauldron cap reading as the armour line, round
// shield, raised blade and a small back banner. Drawn ~15% larger in its own
// coordinates rather than scaled, so no transform can fight the pose keyframes.
function veteranFigure() {
  return (
    '<path d="M8.4 12 5.4 0.8 6.9 0.4 9.9 11.8Z"/>' +
    '<path class="fig-accent" d="M6.2 1.4Q3.2 2.8 1.2 1.4Q2.8 5 6.9 4Z"/>' +
    '<g class="fig-melee"><path d="M16.6 9.2 24.6 0.6 26.2 1.8 18.2 10.4Z"/></g>' +
    '<circle cx="12.8" cy="4.8" r="3.3"/>' +
    '<path d="M7.6 9.4Q12.8 6.9 18 9.4L18.8 21.6Q12.8 23.8 6.8 21.6Z"/>' +
    '<path d="M7.3 9.7Q12.8 6.7 18.3 9.7Q18.7 12.1 17.8 13Q12.8 10.4 7.8 13Q6.9 12.1 7.3 9.7Z"/>' +
    '<path d="M9.4 22 8 31Q9.5 31.8 11 31L11.6 22.6Z"/>' +
    '<path d="M14 22.6 15.6 31Q17.1 31.8 18.5 31L16.2 22Z"/>' +
    // The shield carries clear of the torso: overlapping it would fuse both
    // into one unreadable mass at 24px.
    '<g class="fig-melee">' +
    '<path d="M17.4 13.4Q20 13.8 21.6 15.2L20.4 17Q18.6 15.4 16.6 15.2Z"/>' +
    '<circle cx="22.8" cy="17" r="4.5"/>' +
    "</g>"
  );
}

// Brigand: hunched spine, unkempt hair breaking the head outline, no armour
// line at all, and a crescent saber.
function banditFigure() {
  return (
    '<g class="fig-melee"><path d="M17.2 13.4Q23 11 25.2 5.2L23.3 4.5Q21.4 9.8 16.4 12Z"/></g>' +
    // Head sits low and forward of the hips, and the upper back bulges: that
    // curve is the whole read, so it is exaggerated well past anatomy.
    '<circle cx="14.6" cy="8.6" r="2.9"/>' +
    '<path d="M11.6 7.6 9.4 4.6 12.2 6.4 11.2 3 13.6 5.8 14.2 2.6 15.8 6 17.8 4 17 6.8 19.4 6.2 17.4 8.4Z"/>' +
    '<path d="M11 12.4Q14.4 10 17.2 12.6L17.8 21.6Q13.6 23.4 9.4 21.6Q7.6 16 11 12.4Z"/>' +
    '<path d="M10.8 22 8.8 29.4Q9.8 30.4 11.4 29.9L12.4 22.4Z"/>' +
    '<path d="M13.8 22.4 15.6 29.6Q17 30.2 18 29.4L16.2 22Z"/>' +
    '<path class="fig-melee" d="M16.2 13.2Q18.8 13.2 20.8 12L21.4 13.7Q18.8 15.2 15.8 15Z"/>'
  );
}

/*
 * Horse and rider as ONE brush mass.
 *
 * Three things carry the read at 26px and nothing else does: the arched neck
 * rising out of the barrel, four legs that stay separable under the body, and
 * the rider's blade leaving the outline at the top right. The two leg groups
 * are drawn as alternating halves of a gallop -- CSS shows one at a time in
 * steps(2), which is the whole cycle. Anything more becomes a smear.
 */
function cavalryFigure() {
  return (
    // Barrel and haunch: one sweep, deepest under the saddle.
    '<path d="M2.6 21.4Q5.4 13.6 14 16.2L21.6 13Q28 14 30 19.6L25.6 20.8'
    + 'Q22 23.4 16.4 23.2L6.4 24Q3.4 23.8 2.6 21.4Z"/>' +
    // Arched neck and head, thrown forward into the run.
    '<path d="M21.4 13.6Q23.4 7.2 27.4 4.2L30.6 6.4Q26.8 9.4 25.6 14.6Z"/>' +
    '<path d="M27 3.6 31.6 5.2 30.4 8.2 26.2 6.4Z"/>' +
    // Tail streaming back — the counterweight that stops the mass reading as a dog.
    '<path d="M3.2 17.4Q-0.8 18.6 -1.6 23.4L1.4 22.6Q2 19.6 4.2 19Z"/>' +
    // Gallop frame A: near foreleg reaching, off hind trailing.
    '<g class="horse-legs horse-legs-a">' +
    '<path d="M22.4 22.4 26.2 30.6 28.4 30.2 25.2 21.8Z"/>' +
    '<path d="M7.4 23.2 3.6 30.4 5.8 31.2 10.2 23.6Z"/>' +
    '<path d="M18.2 23 19.4 30.8 21.4 30.6 20.6 22.8Z"/>' +
    '<path d="M10.6 23.4 9.4 30.2 11.4 30.6 12.8 23.4Z"/>' +
    "</g>" +
    // Gallop frame B: the pair swapped, so the alternation reads as legs.
    '<g class="horse-legs horse-legs-b">' +
    '<path d="M22.6 22.4 24 30.8 26.2 30.6 25.4 21.8Z"/>' +
    '<path d="M7.2 23.2 6.6 30.6 8.8 30.8 10.4 23.6Z"/>' +
    '<path d="M18 23 22.2 30 24 29 20.4 22.8Z"/>' +
    '<path d="M10.8 23.4 6.8 29.8 8.6 30.8 13 23.4Z"/>' +
    "</g>" +
    // Rider: seated, leaning with the charge.
    '<path d="M12.4 16.4 11.2 8.4Q15.4 5 18.8 9.2L19.4 16.8Z"/>' +
    '<circle cx="14.6" cy="4.8" r="2.8"/>' +
    '<path class="fig-accent" d="M11.8 11.6Q15 12.8 18.6 11.6L19 13.8Q15.2 15 11.4 13.8Z"/>' +
    // Blade held high and clear of the horse — the overhang is the class cue.
    '<g class="fig-melee"><path d="M16.6 12.4 27.8 -0.4 29.6 1.2 18.6 14.4Z"/></g>'
  );
}

// 陈莽, the v1.1 lieutenant. He has to be findable in a crowd at a glance, so
// every silhouette cue is pushed: tallest mass, a crested topknot breaking the
// head outline, a cape falling behind the legs, a tall command banner, and a
// guandao whose blade and shaft leave the body outline on both sides.
//
// Drawn in the same 32x34 box as everyone else but filling far more of it --
// scaling a normal figure would just make a bigger militiaman, and the read
// has to come from shape, not size alone.
function lieutenantFigure() {
  return (
    // Command banner, tall and behind everything.
    '<path d="M7.4 13 3.4 0.6 5.1 0.2 9.1 12.6Z"/>' +
    '<path class="fig-accent" d="M4.1 1.1Q0.4 2.6 -1.8 0.9Q0 5.6 5.1 4.4Z"/>' +
    // Cape: one heavy sweep from the shoulders past the knees.
    '<path d="M8.4 9.6Q13 7.4 17.6 9.6L19.4 25.8Q13 28.6 6.4 25.8Z"/>' +
    // Guandao held across the body, blade high and butt low.
    '<g class="fig-melee">' +
    '<path d="M5.6 30.4 25.8 3.4 27.6 4.8 7.4 31.8Z"/>' +
    '<path d="M24.4 4.6Q30.4 1.2 30.8 -1.4Q32.4 3.6 27.2 8.2Z"/>' +
    "</g>" +
    // Head with a crested topknot.
    '<circle cx="13" cy="5.2" r="3.5"/>' +
    '<path d="M10.6 2.6Q13 -2.2 15.6 2.6Q13.4 1.2 10.6 2.6Z"/>' +
    '<path d="M12.2 -0.6 13.9 -0.6 13.4 2.4 12.7 2.4Z"/>' +
    // Torso: broader than a veteran, with a hard shoulder line.
    '<path d="M7.6 9.8Q13 6.8 18.4 9.8L19.2 22.4Q13 25 6.8 22.4Z"/>' +
    '<path d="M7.2 10.1Q13 6.6 18.8 10.1Q19.3 12.9 18.3 14Q13 11 7.7 14Q6.7 12.9 7.2 10.1Z"/>' +
    '<path d="M9 22.8 7.4 32Q9 32.9 10.7 32L11.4 23.4Z"/>' +
    '<path d="M14.6 23.4 16.4 32Q18.1 32.9 19.6 32L17.2 22.8Z"/>' +
    '<path class="fig-accent" d="M8.2 18.6Q13 20.2 17.8 18.6L18.2 21Q13 22.6 7.8 21Z"/>'
  );
}

/*
 * The three officers, drawn apart at silhouette level so they separate at 26px
 * the way their seal portraits do: 莽 leans in behind a heavy blade, 稳 stands
 * square behind a shield, 贪 hangs back around a money bag.
 */
function officerMang() {
  return (
    '<path d="M7.4 13 3.4 0.6 5.1 0.2 9.1 12.6Z"/>' +
    '<path class="fig-accent" d="M4.1 1.1Q0.4 2.6 -1.8 0.9Q0 5.6 5.1 4.4Z"/>' +
    '<g class="fig-melee">' +
    '<path d="M5.6 30.4 25.8 3.4 27.6 4.8 7.4 31.8Z"/>' +
    '<path d="M24.4 4.6Q30.4 1.2 30.8 -1.4Q32.4 3.6 27.2 8.2Z"/>' +
    "</g>" +
    '<circle cx="14" cy="5.4" r="3.5"/>' +
    '<path d="M11.6 2.8Q14 -2 16.6 2.8Q14.4 1.4 11.6 2.8Z"/>' +
    '<path d="M8.6 10.4Q14 6.9 19.4 10.4L20.6 22.6Q14 25.2 7.8 22.6Z"/>' +
    '<path d="M10 23 8.4 32Q10 32.9 11.7 32L12.4 23.6Z"/>' +
    '<path d="M15.6 23.6 17.4 32Q19.1 32.9 20.6 32L18.2 23Z"/>' +
    '<path class="fig-accent" d="M9.2 18.8Q14 20.4 18.8 18.8L19.2 21.2Q14 22.8 8.8 21.2Z"/>'
  );
}

function officerWen() {
  return (
    '<path d="M6.6 12 4.2 0.8 5.8 0.5 8.2 11.8Z"/>' +
    '<path class="fig-accent" d="M5 1.2Q1.8 2.6 -0.2 1.2Q1.4 4.8 5.8 3.8Z"/>' +
    '<circle cx="12.4" cy="5" r="3.3"/>' +
    '<path d="M9 2.4h6.8v2.1H9z"/>' +
    '<path d="M7.4 9.6Q12.4 7.2 17.4 9.6L18 22.2Q12.4 24.6 6.8 22.2Z"/>' +
    '<path d="M7.1 9.9Q12.4 6.9 17.7 9.9Q18.1 12.4 17.2 13.4Q12.4 10.6 7.6 13.4Q6.7 12.4 7.1 9.9Z"/>' +
    '<path d="M8.8 22.6 7.6 32Q9.2 32.8 10.8 32L11.4 23.2Z"/>' +
    '<path d="M14 23.2 15.6 32Q17.2 32.8 18.6 32L17 22.6Z"/>' +
    '<g class="fig-melee">' +
    '<path d="M17 13.6Q19.8 14 21.6 15.6L20.2 17.4Q18.2 15.8 16.2 15.6Z"/>' +
    '<circle cx="24" cy="17.4" r="6.2"/>' +
    "</g>"
  );
}

function officerTan() {
  return (
    // Every officer carries a personal banner; his is the shortest and hangs
    // back off the shoulder, which is its own read next to 莽's and 稳's.
    '<path d="M5.8 13.4 4.4 1.6 6 1.4 7.4 13.2Z"/>' +
    '<path class="fig-accent" d="M5.2 2.2Q2.6 3.8 0.8 2.6Q2 5.8 5.6 4.8Z"/>' +
    '<circle cx="12.6" cy="5.8" r="3.4"/>' +
    '<path d="M9.4 3.6Q12.6 1 15.8 3.6 12.6 2.6 9.4 3.6Z"/>' +
    '<path d="M9.6 10.2Q12.6 8.2 15.6 10.2L16.8 21.8Q12.6 23.8 8.4 21.8Z"/>' +
    '<path d="M10 22.2 8.2 30.8Q9.5 31.6 11 30.9L11.8 22.6Z"/>' +
    '<path d="M13.4 22.6 15.4 30.6Q16.8 31.2 17.8 30.4L15.6 22.2Z"/>' +
    '<g class="fig-melee">' +
    '<path d="M16.2 13.4Q19 13.8 20.8 15.2L19.6 17Q17.6 15.6 15.6 15.4Z"/>' +
    '<path d="M21.4 15.2Q27.6 16.6 27.2 22.4Q26.8 27.6 21.6 27.4Q16.8 27.2 17 22Q17.2 16.6 21.4 15.2Z"/>' +
    "</g>" +
    '<path class="fig-accent" d="M20.4 14.2q2.6-1 5 .2l-.6 2.2q-2-1-4.2-.2Z"/>'
  );
}

const OFFICERS = { chen_mang: officerMang, shen_wen: officerWen, jia_duojin: officerTan };

export function officerFigureFor(id) {
  return OFFICERS[id] || null;
}

const FIGURES = {
  militia: militiaFigure,
  veteran: veteranFigure,
  bandit: banditFigure,
  cavalry: cavalryFigure,
  lieutenant: lieutenantFigure
};

function figureSvg(troopType, arm = null) {
  if (arm === "archer") return archerFigure();
  if (arm === "cavalry") {
    return '<svg viewBox="0 0 32 34" aria-hidden="true" focusable="false">' +
      '<g class="fig-pose" fill="currentColor">' + cavalryFigure() + "</g></svg>";
  }
  const draw = FIGURES[troopType] || FIGURES.militia;
  // `fig-pose` carries the lean/turn keyframes so the <svg> keeps facing as its
  // own untouched property.
  return (
    '<svg viewBox="0 0 32 34" aria-hidden="true" focusable="false">' +
    '<g class="fig-pose" fill="currentColor">' + draw() + "</g>" +
    "</svg>"
  );
}

function crenellationSvg() {
  return (
    '<svg viewBox="0 0 200 34" preserveAspectRatio="none" aria-hidden="true" focusable="false">' +
    '<path d="M0 34V14h12v-8h14v8h14v-8h14v8h14v-8h14v8h14v-8h14v8h14v-8h14v8h14v-8h14v8h12v20z"' +
    ' fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>' +
    "</svg>"
  );
}

/* ---- the stage ------------------------------------------------------------ */

export function createBattleStage(host, options = {}) {
  const translate = options.translate || ((key) => key);
  const persistHint = options.persistHint || (() => {});
  const hintSeen = options.hintSeen || (() => false);
  const audio = options.audio || null;

  let root = null;
  let stainContext = null;
  let worldNode = null;
  let logNode = null;
  let countNodes = {};
  let rafId = 0;
  let virtualTime = 0;
  let lastReal = 0;
  let speed = 1;
  let frozenUntilReal = 0;
  let timeline = [];
  let cursor = 0;
  let playing = false;
  let suspended = false;
  let script = null;
  let endEvent = null;
  let doneCallback = null;
  let pressTimer = 0;
  let pressFired = false;
  let pending = [];
  let roll = seededRandom(1);
  // 1c: a battle is allowed exactly two shakes. Spending one is a decision.
  let shakesSpent = 0;
  let finalStrikeIndex = -1;
  // 8a: every blot the field is carrying, so the layer can be repainted with an
  // age ramp once it runs past its area budget instead of silting up.
  let stains = [];
  let stainArea = 0;
  // 7: the orders actually given, in order. This array IS the replay record.
  let commandLog = [];
  let commandWindowsAt = [];
  let commandGateAt = -1;
  let commandTimer = 0;
  let archerRangeShown = new Set();
  let focusedTarget = null;

  /*
   * ITEM 9 — the one clock.
   *
   * Every visual beat calls this, and everything that wants to react to a beat
   * subscribes here: the shipped CrownAudio cues, the optional `audio` adapter
   * a host may pass, and `onBeat` for anything later. There is deliberately no
   * second path -- a cue that fires outside emitBeat is a bug, because it would
   * be riding a different clock than the animation it belongs to.
   *
   * Payload: { type, tier, kill, side, dmgShown, at } -- `at` is the stage's
   * own virtual time, so a listener can align to the performance and not to
   * wall clock.
   */
  function emitBeat(payload) {
    const beat = { tier: "light", kill: false, at: virtualTime, ...payload };
    // The shipped sound. Kept exactly as it was; only its trigger moved here.
    switch (beat.type) {
      case "strike":
        if (beat.tier === "heavy") crownAudio.cavalry();
        else crownAudio.hit({ kill: Boolean(beat.kill), dmgShown: beat.dmgShown });
        break;
      case "arrow": crownAudio.arrow(); break;
      case "charge": crownAudio.charge(); break;
      case "rout": crownAudio.rout(); break;
      default: break;
    }
    // Host adapter (main.js passes CrownAudio itself). Only cues the switch
    // above does not already own, so nothing can double-fire.
    if (audio && !["strike", "arrow", "charge", "rout"].includes(beat.type)) {
      audio[beat.type]?.(beat);
    }
    options.onBeat?.(beat);
    return beat;
  }

  /* -- construction -------------------------------------------------------- */

  function buildDom() {
    root = document.createElement("section");
    root.id = "battle-stage";
    root.className = "battle-stage";
    // Source order IS grid order: plates take the first auto row, the world
    // takes the 1fr row (it must have height for the ranks to stand on), the
    // dispatch line takes the last auto row.
    root.innerHTML =
      '<button class="stage-speed" type="button"></button>' +
      '<div class="stage-paper">' +
      '<header class="stage-plates">' +
      '<div class="stage-plate"><b class="plate-name"></b><span class="plate-count"></span></div>' +
      '<div class="stage-plate"><b class="plate-name"></b><span class="plate-count"></span></div>' +
      "</header>" +
      '<div class="stage-world">' +
      '<canvas class="stage-stains"></canvas>' +
      '<div class="stage-wall" hidden>' + crenellationSvg() + "</div>" +
      '<div class="stage-archers" hidden></div>' +
      '<div class="stage-ranks stage-ranks-player"></div>' +
      '<div class="stage-ranks stage-ranks-enemy"></div>' +
      "</div>" +
      '<p class="stage-log" aria-live="polite"></p>' +
      '<p class="stage-hint" hidden></p>' +
      "</div>" +
      // Outside .stage-paper on purpose: the paper clips its children, and the
      // tally has to sit BELOW the battlefield rather than on top of it.
      '<div class="stage-tally" hidden></div>';
    host.appendChild(root);
    worldNode = root.querySelector(".stage-world");
    logNode = root.querySelector(".stage-log");

    const canvas = root.querySelector(".stage-stains");
    const rect = worldNode.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    stainContext = canvas.getContext("2d");
    stainContext.scale(dpr, dpr);

    root.addEventListener("pointerdown", onPressStart);
    root.addEventListener("pointerup", onPressEnd);
    root.addEventListener("pointercancel", onPressCancel);
    root.querySelector(".stage-speed").addEventListener("click", cycleSpeed);
  }

  function spawnSide(sideKey) {
    const side = script.sides[sideKey];
    const budgets = damageBudgets(script.events);
    const hpMaxes = hpCeilings(script.events);
    const rankHost = root.querySelector(`.stage-ranks-${sideKey}`);
    const shown = side.tokens.length;
    // Each side gets ~42% of the stage width. Choose the rank depth that fits
    // that budget rather than a fixed one, or the two armies interpenetrate on
    // a phone.
    const halfWidth = Math.max(120, worldNode.clientWidth * 0.42);
    const spacing = Math.max(21, Math.min(40, halfWidth / 7));
    // 1b: the drawn figure is sized from the stage it stands on, so the two
    // armies fill the same share of the sheet at 390px and at 1100px. Set on
    // the world node once per side; both sides compute the same numbers.
    const tokenH = tokenHeightPx(worldNode.clientHeight, spacing);
    worldNode.style.setProperty("--token-h", `${tokenH}px`);
    worldNode.style.setProperty("--token-w", `${Math.round(tokenH * P.TOKEN_ASPECT)}px`);
    worldNode.style.setProperty(
      "--officer-h", `${Math.round(tokenH * P.LIEUTENANT_SCALE)}px`
    );
    worldNode.style.setProperty(
      "--officer-w", `${Math.round(tokenH * P.TOKEN_ASPECT * P.LIEUTENANT_SCALE)}px`
    );
    const maxPerRow = Math.max(3, Math.floor(halfWidth / spacing));
    const rows = Math.min(3, Math.max(1, Math.ceil(shown / maxPerRow)));
    const perRow = Math.ceil(shown / rows) || 1;
    const dir = sideKey === "player" ? 1 : -1;
    const formation = script.formations?.[sideKey] || null;
    if (formation) rankHost.dataset.formation = formation;

    side.tokens.forEach((token, index) => {
      let row = Math.floor(index / perRow);
      let column = index % perRow;
      let formationX = null;
      // v1.1 only: the script carries `formations` solely under ?v=1.1, so the
      // default build keeps its plain row packing untouched.
      const layout = formation ? FORMATION_LAYOUTS[formation] : null;
      let depth = rows > 1 ? row / (rows - 1) : 0.42;
      if (layout) {
        const placed = layout(index, shown, dir, halfWidth);
        formationX = placed.x;
        depth = placed.depth;
        row = placed.rank;
        column = index;
      }
      // Archers always own the rear-most camera rank. This is a drawing rule,
      // not a roster change: the token keeps its engine index and capacity.
      if (token.arm === "archer") depth = Math.max(depth, P.ARCHER_REAR_DEPTH);
      // The lieutenant takes the leading position of his own side. He replaces
      // no soldier: the token keeps its troopType and capacity, only the drawn
      // figure changes, so survivor accounting is unaffected.
      // Officers take the leading positions of their own side, one each, in
      // roster order. Without ids (an older script) the generic officer figure
      // is used exactly as before.
      const officerIds = script.lieutenantIds || [];
      const isLieutenant = script.lieutenant === sideKey
        && index < Math.max(1, officerIds.length);
      const officerId = isLieutenant ? officerIds[index] || null : null;
      const officerDraw = officerId ? officerFigureFor(officerId) : null;
      token.isLieutenant = isLieutenant;
      token.officerId = officerId;
      // The tier is fixed once, at spawn, from what the engine already put on
      // the token. It decides the rhythm of every blow this figure throws.
      token.tier = weightTierFor(token);
      const node = document.createElement("i");
      node.className = isLieutenant
        ? `stage-token unit-${token.troopType || "militia"} tier-${token.tier} is-lieutenant${
          officerId ? ` officer-${officerId}` : ""}`
        : `stage-token unit-${token.troopType || "militia"} tier-${token.tier}${
          token.arm ? ` arm-${token.arm}` : ""}`;
      node.innerHTML = officerDraw
        ? `<svg viewBox="0 0 32 34" aria-hidden="true" focusable="false">`
          + `<g class="fig-pose" fill="currentColor">${officerDraw()}</g></svg>`
        : figureSvg(isLieutenant ? "lieutenant" : token.troopType, token.arm);
      // 6b: an officer is named on the field, always visible, so "that big one
      // is somebody" needs no click to confirm.
      if (isLieutenant) {
        const plate = document.createElement("b");
        plate.className = "stage-name";
        plate.textContent = officerId
          ? translate(`lieutenant.${officerId}Name`)
          : translate("stage.officer");
        node.appendChild(plate);
      }
      const bar = document.createElement("b");
      bar.className = "stage-hp";
      bar.innerHTML = '<i></i>';
      node.appendChild(bar);
      token.hpNode = bar.firstChild;
      token.hpBar = bar;
      token.damageTaken = 0;
      token.damageBudget = budgets.get(`${sideKey}:${token.idx}`) || 0;
      token.hpMax = hpMaxes.get(`${sideKey}:${token.idx}`) || 0;
      token.hpCurrent = token.hpMax;
      // Lateral scatter only. A random VERTICAL nudge would lift a man off the
      // ground line for no reason the camera can justify.
      const scatter = layout ? FORMATION_SHAPE.JITTER_SCALE : 1;
      const jx = (roll() - 0.5) * 14 * scatter;
      const cam = depthPlacement(depth);
      let tx = (formationX ?? ((column * spacing + row * spacing * 0.4) * dir)) + jx;
      // Along the battle axis, rear is away from the centre line.
      if (token.arm === "archer") tx -= dir * P.ARCHER_REAR_OFFSET_PX;
      node.style.setProperty("--tx", `${tx}px`);
      node.style.setProperty("--ty", `${cam.ty.toFixed(1)}px`);
      node.style.setProperty("--tscale", cam.scale.toFixed(3));
      node.style.setProperty("--fade", cam.fade.toFixed(2));
      node.style.zIndex = String(cam.z);
      node.style.setProperty("--sway", `${(1.6 + roll() * 1.2).toFixed(2)}s`);
      token.moveSpeed = movementSpeedFor(token);
      node.style.setProperty("--deploy-ms", `${movementDurationMs(token, P.UNIT_DEPLOY_BASE_MS)}ms`);
      node.style.setProperty("--charge-ms", `${movementDurationMs(token, P.UNIT_CHARGE_BASE_MS)}ms`);
      node.style.setProperty(
        "--reposition-ms", `${movementDurationMs(token, P.UNIT_REPOSITION_BASE_MS)}ms`
      );
      // Back ranks lag into the charge, so the advance has depth.
      // Back ranks set off later so the advance has depth -- but the whole
      // march has to be IN by the end of deploy. A wedge is nine ranks deep, so
      // an uncapped lag left most of an army invisible at first contact.
      const lag = Math.min(
        P.DEPLOY_LAG_MAX_MS,
        row * P.CHARGE_BACK_RANK_LAG_MS + depth * P.DEPLOY_DEPTH_LAG_MS
      ) - (token.arm === "cavalry" ? P.CAVALRY_LEAD_MS : 0);
      node.style.setProperty("--lag", `${Math.round(lag)}ms`);
      rankHost.appendChild(node);
      token.node = node;
      token.tx = tx;
      token.row = row;
      token.depth = depth;
      token.baseDepth = depth;
      token.melee = 0;
      token.jitterX = roll() - 0.5;
      // Parade position along the stage, derived rather than measured: the
      // rank anchors are left/right 7% of the world and the token box is
      // tokenH * TOKEN_ASPECT wide, so this holds before any animation ran.
      const anchor = sideKey === "player"
        ? worldNode.clientWidth * 0.07
        : worldNode.clientWidth * 0.93;
      token.baseX = anchor + tx + tokenH / 2 * P.TOKEN_ASPECT;
    });
  }

  // Scenery for a town fight: a fixed row of archers standing on the wall.
  // Deterministic count and placement, and no relation to either side's roster.
  const WALL_ARCHERS = 5;

  function spawnWallArchers() {
    const host = root.querySelector(".stage-archers");
    if (!host) return;
    host.hidden = false;
    for (let index = 0; index < WALL_ARCHERS; index += 1) {
      const archer = document.createElement("i");
      archer.className = "wall-archer";
      archer.innerHTML = archerFigure();
      // Spread across the wall box itself, so the garrison reads as standing
      // on the crenellations rather than floating behind the enemy rank.
      archer.style.setProperty("--ax", `${6 + index * 20}%`);
      archer.style.setProperty("--adelay", `${index * 55}ms`);
      host.appendChild(archer);
    }
  }

  /* -- phases ---------------------------------------------------------------- */

  const ZOOM_BY_PHASE = {
    deploy: P.ZOOM_DEPLOY,
    standoff: P.ZOOM_STANDOFF,
    charge: P.ZOOM_CHARGE,
    melee: P.ZOOM_MELEE,
    rout: P.ZOOM_ROUT
  };

  function setPhase(name) {
    if (!root || !worldNode) return;
    PHASES.forEach((phase) => root.classList.toggle(`phase-${phase}`, phase === name));
    root.dataset.phase = name;
    worldNode.style.setProperty("--zoom", String(ZOOM_BY_PHASE[name] || 1));
    // 5b: a horse gallops while it is covering ground and paws the ground while
    // it is not. Driven off the phase, so the two can never be on at once.
    const moving = name === "deploy" || name === "charge";
    ["player", "enemy"].forEach((sideKey) => {
      script?.sides[sideKey]?.tokens.forEach((token) => {
        if (token.arm === "cavalry" && token.node) {
          token.node.classList.toggle("is-moving", moving);
        }
        if (token.node) {
          const advances = name === "deploy" || (name === "charge" && token.arm !== "archer");
          token.node.classList.toggle("is-advancing", advances);
        }
      });
    });
  }

  // Contact: one hard freeze, an ink band torn open along the centre line, and
  // the two straight ranks dissolving into a single interleaved melee.
  function onContact() {
    if (!root) return;
    setPhase("melee");
    root.classList.remove("is-lead");
    frozenUntilReal = performance.now() + P.CONTACT_PAUSE_MS;
    root.classList.add("is-hit-paused");
    pending.push(window.setTimeout(
      () => root && root.classList.remove("is-hit-paused"), P.CONTACT_PAUSE_MS
    ));
    // Shake #1 of 2. The other is spent on the final blow.
    shake("contact");
    splashCentreBand();
    convergeTo(1);
  }

  function splashCentreBand() {
    if (!worldNode) return;
    const width = worldNode.clientWidth;
    const height = worldNode.clientHeight;
    for (let index = 0; index < 9; index += 1) {
      paintStain(
        width * 0.5 + (roll() - 0.5) * width * 0.16,
        height * (0.62 + (roll() - 0.5) * 0.22),
        roll() < 0.4
      );
    }
  }

  /**
   * Close both lines on the centreline by `ratio` (0 = parade, 1 = full melee).
   *
   * The offset is a fraction of each token's REAL distance to the middle of the
   * stage, not a fixed nudge: the ranks are anchored at left/right 7%, so on a
   * 390px screen a constant offset leaves a visibly empty middle and the blows
   * look like they land across a gap.
   *
   * At ratio 1 each side's own spread is remapped onto a band centred on the
   * line, with the leading edge biased PAST it. That overlap is the point: the
   * two armies interleave instead of holding one half of the screen each.
   */
  function convergeTo(ratio) {
    if (!worldNode) return;
    const width = worldNode.clientWidth;
    const centre = width / 2;
    const crowd = Math.max(
      script.sides.player.tokens.length,
      script.sides.enemy.tokens.length
    );
    // Widen for the crowd, then clamp to the stage: a big battle spreads out
    // instead of stacking every man on the same few pixels.
    const band = Math.min(
      width * P.MELEE_BAND_MAX_RATIO,
      Math.max(P.MELEE_BAND_PX, crowd * P.MELEE_BAND_PER_TOKEN_PX)
    );

    ["player", "enemy"].forEach((sideKey) => {
      const dir = sideKey === "player" ? 1 : -1;
      const tokens = script.sides[sideKey].tokens.filter((token) => token.node);
      if (!tokens.length) return;
      const bases = tokens.map((token) => token.baseX);
      const low = Math.min(...bases);
      const high = Math.max(...bases);
      const span = high - low || 1;

      tokens.forEach((token) => {
        // 0 = furthest from the enemy, 1 = closest. The enemy rank runs the
        // other way along x, so its normalised order is inverted.
        const along = (token.baseX - low) / span;
        const leading = dir === 1 ? along : 1 - along;
        const target = centre + dir * (leading - P.MELEE_BIAS) * band;
        const jitter = token.jitterX * P.MELEE_JITTER_PX * ratio;
        // Every melee token receives the same resolved destination. Its own
        // CSS travel duration creates the staggered arrival; scheduled strike
        // beats remain on the one virtual timeline. Archers hold their rear
        // ground through the charge and receive no centre travel.
        const mounted = token.arm === "cavalry";
        const progress = token.arm === "archer" ? 0 : ratio;
        const travel = (target - token.baseX) * progress;
        if (mounted) {
          token.node.style.setProperty("--lag", `-${P.CAVALRY_LEAD_MS}ms`);
        }
        token.melee = Math.round(travel + jitter);
        token.node.style.setProperty("--mx", `${token.melee}px`);
        // No vertical component: closing on the centreline happens along the
        // ground, so depth (and therefore height and scale) is unchanged.
      });
    });
    refreshArcherOverrun();
  }

  function setTokenDepth(token, depth) {
    if (!token?.node) return;
    token.depth = Math.max(0, Math.min(1, depth));
    const cam = depthPlacement(token.depth);
    token.node.style.setProperty("--ty", `${cam.ty.toFixed(1)}px`);
    token.node.style.setProperty("--tscale", cam.scale.toFixed(3));
    token.node.style.setProperty("--fade", cam.fade.toFixed(2));
    token.node.style.zIndex = String(cam.z);
  }

  function tokenAxisX(token) {
    return (token?.baseX || 0) + (token?.melee || 0);
  }

  // Once a hostile melee token crosses the rear bow line, that bow line is
  // spent: bow as stave, one backward step, and no more decorative volleys.
  function refreshArcherOverrun() {
    if (!script) return;
    ["player", "enemy"].forEach((sideKey) => {
      const foeKey = sideKey === "player" ? "enemy" : "player";
      const archers = script.sides[sideKey].tokens.filter(
        (token) => token.arm === "archer" && token.node && token.capacity > 0 && !token.overrun
      );
      const foes = script.sides[foeKey].tokens.filter(
        (token) => token.arm !== "archer" && token.node && token.capacity > 0
      );
      if (!archers.length || !foes.length) return;
      const crossed = archerLineCrossed(
        sideKey,
        archers.map(tokenAxisX),
        foes.map(tokenAxisX)
      );
      if (!crossed) return;
      const retreat = sideKey === "player" ? -P.ARCHER_OVERRUN_BACKSTEP_PX
        : P.ARCHER_OVERRUN_BACKSTEP_PX;
      archers.forEach((token) => {
        token.overrun = true;
        token.melee = (token.melee || 0) + retreat;
        token.node.style.setProperty("--mx", `${token.melee}px`);
        token.node.classList.add("is-overrun");
        token.node.classList.remove("is-loosing", "is-aiming-focus");
      });
    });
  }

  // A round boundary: half a step back from both sides, then press in again.
  function breatheRound() {
    if (!root || root.dataset.phase !== "melee") return;
    const { breathMs } = meleeShape(
      script.events.filter((event) => event.type === "round_start").length
    );
    if (breathMs < 60) return; // too compressed to read; skip rather than flicker
    root.classList.add("is-breathing");
    pending.push(window.setTimeout(() => root && root.classList.remove("is-breathing"), breathMs));
  }

  // A gap in the line is filled: the two nearest survivors recoil, then move
  // across. This is what makes the line read as alive rather than as a grid.
  function closeRanks(sideKey, gapToken) {
    const neighbours = script.sides[sideKey].tokens
      .filter((token) => token !== gapToken && token.node && token.capacity > 0)
      .sort((first, second) =>
        Math.abs(first.tx - gapToken.tx) - Math.abs(second.tx - gapToken.tx))
      .slice(0, 2);
    neighbours.forEach((token) => {
      const toward = gapToken.tx > token.tx ? 1 : -1;
      token.node.classList.add("is-recoiling");
      pending.push(window.setTimeout(() => {
        if (!token.node) return;
        token.node.classList.remove("is-recoiling");
        token.melee = (token.melee || 0) + toward * P.CLOSE_RANKS_PX;
        token.node.style.setProperty("--mx", `${token.melee}px`);
      }, P.CLOSE_RANKS_MS));
    });
  }

  // Read-only projection of the engine's own damage numbers onto a bar. Never
  // writes back: capacity, kills and survivors stay the engine's to decide.
  function syncHealthBar(token) {
    if (!token?.hpNode) return;
    const budget = token.damageBudget;
    // Dead is dead regardless of the arithmetic: capacity is the authority.
    // v1.1 scripts carry hpAfter, so the bar is the engine's own number. Older
    // scripts fall back to the derived budget.
    const ratio = token.capacity <= 0
      ? 0
      : token.hpMax > 0
        ? Math.max(0, Math.min(1, token.hpCurrent / token.hpMax))
        : budget > 0
          ? Math.max(0, Math.min(1, 1 - token.damageTaken / budget))
          : 1;
    token.hpNode.style.transform = `scaleX(${ratio.toFixed(3)})`;
    token.hpBar.classList.toggle("is-low", ratio > 0 && ratio < P.HP_LOW_RATIO);
  }

  function flashHealthBar(token) {
    if (!token?.hpBar) return;
    token.hpBar.classList.remove("is-flash");
    void token.hpBar.offsetWidth;
    token.hpBar.classList.add("is-flash");
    // The bar leaves with its token: the melt/flee animation carries it away.
    pending.push(window.setTimeout(() => {
      if (token.hpBar) token.hpBar.hidden = true;
    }, P.HP_FLASH_MS));
  }

  function syncCounts() {
    if (!countNodes.player) return;
    const counts = endEvent
      ? battleEndCounts(endEvent)
      : {
        player: survivorsOf(script.sides.player),
        enemy: survivorsOf(script.sides.enemy)
      };
    countNodes.player.textContent = String(counts.player);
    countNodes.enemy.textContent = String(counts.enemy);
  }

  function tokenAt(sideKey, idx) {
    const side = script.sides[sideKey];
    // Engine idx first: after aggregation several engine buckets share one
    // drawn figure, and a strike still names the engine's idx.
    return side.byIdx?.get(idx) || side.tokens.find((token) => token.idx === idx) || null;
  }

  /* -- ink ------------------------------------------------------------------ */

  /*
   * ITEM 8a — the field must read as AFTERMATH, not as mud.
   *
   * Three rules, all of them about restraint: a blot is 40% smaller than the
   * first pass; how many blots a death leaves scales with how many men that
   * bucket stood for (one token can be twelve men); and the whole layer carries
   * a total-area budget. When the budget is spent the layer is repainted with
   * an age ramp -- the oldest marks drop to 30% -- rather than allowed to keep
   * darkening until the paper is black.
   */
  function drawBlot(blot, alphaScale) {
    stainContext.fillStyle = `rgba(43, 38, 32, ${(blot.alpha * alphaScale).toFixed(3)})`;
    stainContext.beginPath();
    stainContext.ellipse(blot.x, blot.y, blot.rx, blot.ry, blot.rotate, 0, Math.PI * 2);
    stainContext.fill();
  }

  function repaintStains() {
    if (!stainContext || !worldNode) return;
    stainContext.clearRect(0, 0, worldNode.clientWidth, worldNode.clientHeight);
    const oldest = stains.length - 1;
    stains.forEach((blot, index) => {
      // Newest at full strength, oldest at STAIN_OLDEST_ALPHA, linearly between.
      const age = oldest > 0 ? 1 - index / oldest : 1;
      drawBlot(blot, P.STAIN_OLDEST_ALPHA + (1 - P.STAIN_OLDEST_ALPHA) * (1 - age));
    });
  }

  function paintStain(x, y, big, scale = 1, men = 1) {
    if (!stainContext || !worldNode) return;
    // A bucket standing for a dozen men leaves more than a bucket of one, but
    // sub-linearly: a square root, or a big battle paints itself solid.
    const bulk = Math.max(1, Math.sqrt(Math.max(1, men)));
    const blots = Math.max(1, Math.round((big ? 4 : 2) * scale * Math.min(2, bulk)));
    const cap = worldNode.clientWidth * worldNode.clientHeight * P.STAIN_AREA_CAP_RATIO;
    for (let index = 0; index < blots; index += 1) {
      const radius = ((big ? 5 : 3) + roll() * (big ? 7 : 4)) * P.STAIN_SCALE * scale;
      const blot = {
        x: x + (roll() - 0.5) * 18,
        y: y + (roll() - 0.5) * 12,
        rx: radius,
        ry: radius * (0.6 + roll() * 0.5),
        rotate: roll() * Math.PI,
        alpha: 0.08 + roll() * 0.11
      };
      stains.push(blot);
      stainArea += Math.PI * blot.rx * blot.ry;
      drawBlot(blot, 1);
    }
    if (stainArea <= cap) return;
    // Over budget: drop the eldest marks until back under, then redraw what is
    // left with the age ramp. Repainting only happens at the boundary, so this
    // is not a per-frame cost.
    while (stains.length > 1 && stainArea > cap) {
      const gone = stains.shift();
      stainArea -= Math.PI * gone.rx * gone.ry;
    }
    repaintStains();
  }

  /**
   * ITEM 8b — splatter throws along the strike vector, not in a ring.
   *
   * `angle` is the direction the blow travelled, so the ink lands behind the
   * man who took it. A ring reads as a decal; a throw reads as a hit.
   */
  function splatter(x, y, angle, tier) {
    const spread = P.SPLATTER_SPREAD_PX * tier.splatterScale;
    for (let index = 0; index < tier.blots; index += 1) {
      const drift = (roll() - 0.35) * spread;
      const lateral = (roll() - 0.5) * spread * 0.45;
      paintStain(
        x + Math.cos(angle) * drift - Math.sin(angle) * lateral,
        y + Math.sin(angle) * drift + Math.cos(angle) * lateral,
        false,
        tier.splatterScale
      );
    }
  }

  // A 2px ink slash laid along the blow. One frame of confirmation, gone before
  // it can become decoration.
  function slash(x, y, angle, tier) {
    const node = document.createElement("i");
    node.className = "stage-slash";
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.setProperty("--slash-angle", `${(angle * 180 / Math.PI).toFixed(1)}deg`);
    node.style.setProperty("--slash-len", `${Math.round(20 * tier.splatterScale)}px`);
    ephemeral(node, P.SLASH_FLASH_MS + 60);
  }

  /*
   * F3 unit motion. All of it is scripted along precomputed paths driven by
   * events the engine already emitted -- no physics, no feedback, and nothing
   * here reads or writes a battle result.
   */
  let activeActors = 0;

  // Too many silhouettes moving in one frame is a blur. Over the cap a token
  // still takes its damage on time; only its POSE is nudged into the next
  // beat, so data and display never disagree.
  function actorSlot(run, { tier = "light", priority = false } = {}) {
    const hold = strikeDurationMs(tier, priority);
    // 6c: an officer's blow NEVER waits for a slot. His strikes are the ones the
    // eye is meant to follow, so they cannot be pushed into a later wave.
    if (priority || activeActors < P.MAX_CONCURRENT_ACTORS) {
      activeActors += 1;
      run();
      pending.push(window.setTimeout(
        () => { activeActors = Math.max(0, activeActors - 1); }, hold
      ));
      return;
    }
    pending.push(window.setTimeout(() => actorSlot(run, { tier, priority }), P.POSE_WINDUP_MS));
  }

  // A quadratic bezier from bow to chest, the shaft rotated to its own
  // velocity so it never flies sideways.
  function flyArrow(from, to, delay = 0, { miss = false } = {}) {
    if (!worldNode) return;
    const arrow = document.createElement("i");
    arrow.className = miss ? "stage-shaft is-miss" : "stage-shaft";
    worldNode.appendChild(arrow);
    const midX = (from.x + to.x) / 2;
    const midY = Math.min(from.y, to.y) - P.ARROW_ARC_PX;
    const frames = [];
    const STEPS = 12;
    for (let step = 0; step <= STEPS; step += 1) {
      const t = step / STEPS;
      const inv = 1 - t;
      const x = inv * inv * from.x + 2 * inv * t * midX + t * t * to.x;
      const y = inv * inv * from.y + 2 * inv * t * midY + t * t * to.y;
      const dx = 2 * inv * (midX - from.x) + 2 * t * (to.x - midX);
      const dy = 2 * inv * (midY - from.y) + 2 * t * (to.y - midY);
      frames.push({
        offset: t,
        transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${
          (Math.atan2(dy, dx) * 180 / Math.PI).toFixed(1)}deg)`,
        // A shaft that hits vanishes AT contact. A shaft that misses does not:
        // it stays where it stuck, which is the whole point of drawing it.
        opacity: miss ? 1 : (t > 0.92 ? 0 : 1)
      });
    }
    if (!reducedMotion.matches && arrow.animate) {
      arrow.animate(frames, { duration: P.ARROW_LEAD_MS, delay, easing: "linear", fill: "both" });
    }
    if (!miss) {
      ephemeral(arrow, delay + P.ARROW_LEAD_MS + 40);
      return;
    }
    // 4c: overshoot, stand in the ground at an angle, fade after two seconds.
    // Misses are what make a volley read as a volley rather than as a cue.
    pending.push(window.setTimeout(() => {
      if (!arrow.isConnected) return;
      arrow.style.transform =
        `translate(${to.x.toFixed(1)}px, ${to.y.toFixed(1)}px) rotate(64deg)`;
      arrow.getAnimations?.().forEach((animation) => animation.cancel());
      arrow.classList.add("is-stuck");
    }, delay + P.ARROW_LEAD_MS));
    ephemeral(arrow, delay + P.ARROW_LEAD_MS + P.ARROW_STUCK_MS + 400);
  }

  // The four-pose bow cycle. Started NOCK+DRAW before the shaft leaves, so the
  // release snap and the launch are the same instant rather than two events.
  function drawBow(node) {
    if (!node) return;
    node.classList.remove("is-loosing");
    void node.offsetWidth;
    node.classList.add("is-loosing");
    pending.push(window.setTimeout(
      () => node && node.classList.remove("is-loosing"),
      P.BOW_NOCK_MS + P.BOW_DRAW_MS + P.BOW_RELEASE_MS + P.BOW_RECOVER_MS
    ));
  }

  function stagePoint(node) {
    const stage = worldNode.getBoundingClientRect();
    const box = node.getBoundingClientRect();
    return { x: box.left - stage.left + box.width / 2, y: box.top - stage.top + box.height * 0.85 };
  }

  /* -- flourishes ----------------------------------------------------------- */

  function ephemeral(node, life) {
    worldNode.appendChild(node);
    pending.push(window.setTimeout(() => node.remove(), life));
  }

  function burst(x, y, angle = 0, heavy = false) {
    const node = document.createElement("i");
    node.className = heavy ? "stage-burst is-heavy" : "stage-burst";
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    node.style.setProperty("--burst-angle", `${(angle * 180 / Math.PI).toFixed(1)}deg`);
    ephemeral(node, 450);
  }

  function damageNumber(x, y, amount, kill) {
    const node = document.createElement("b");
    node.className = "stage-damage" + (kill ? " is-kill" : "");
    node.textContent = `-${amount}`;
    node.style.left = `${x}px`;
    node.style.top = `${y - 30}px`;
    ephemeral(node, 750);
  }

  function fallenBanner(x, y) {
    const node = document.createElement("i");
    node.className = "stage-banner-fall";
    node.innerHTML =
      '<svg viewBox="0 0 20 34" aria-hidden="true"><path d="M4 2v30" stroke="currentColor" stroke-width="2"/>' +
      '<path d="M4 3l12 4-12 4z" fill="currentColor"/></svg>';
    node.style.left = `${x}px`;
    node.style.top = `${y - 26}px`;
    worldNode.appendChild(node);
  }

  /*
   * ITEM 1c — the stage shakes twice in a whole battle and never again.
   *
   * First contact and the final blow. That is the entire budget, and it is the
   * reason both of them land: a camera that shakes on every kill is a camera
   * that is never still, and nothing inside it can be read. How far it throws
   * comes from the stage width, so a phone and a desktop feel the same.
   *
   * World layer only. The frame, the nameplates and the dispatch line are
   * outside `.stage-world` precisely so they cannot move.
   */
  function shake(reason) {
    if (!root || !worldNode) return false;
    if (shakesSpent >= P.SHAKE_BUDGET) return false;
    shakesSpent += 1;
    root.style.setProperty("--shake", `${shakeOffsetPx(worldNode.clientWidth).toFixed(1)}px`);
    root.classList.remove("is-shaking");
    void root.offsetWidth;
    root.classList.add("is-shaking");
    pending.push(window.setTimeout(
      () => root && root.classList.remove("is-shaking"), 300
    ));
    emitBeat({ type: "shake", reason });
    return true;
  }

  // The heavy tier's own jolt. Local to the man who was hit -- it is impact,
  // not camera, so it does not spend from the two-shake budget.
  function heavyJolt(node) {
    if (!node) return;
    node.classList.remove("is-jolted");
    void node.offsetWidth;
    node.classList.add("is-jolted");
    pending.push(window.setTimeout(() => node.classList.remove("is-jolted"), 220));
  }

  function log(text) {
    if (logNode) logNode.textContent = text;
  }

  /* -- event performances ---------------------------------------------------- */

  /*
   * ITEM 4d — a volley is 3 to 5 shafts, 60ms apart, fanned.
   *
   * The engine may say a dozen; a dozen simultaneous shafts is static, not a
   * shower. Three to five staggered on a fixed beat with angle variance reads
   * as a volley at any roster size, so the count is clamped here. The engine's
   * number changes nothing but this drawing, which is why clamping it is free.
   *
   * These arrows carry NO damage -- `volley`/`archer_volley` are atmosphere and
   * the contract gives them no target. That is exactly why the 10% miss rate
   * lives here and not on the per-strike shafts: a miss must never contradict a
   * hit the engine already resolved.
   */
  function volleyArrows(event, from, targets, fallback, baseDelay = 0) {
    const count = Math.max(
      P.VOLLEY_MIN_ARROWS, Math.min(P.VOLLEY_MAX_ARROWS, event.arrows || P.VOLLEY_MIN_ARROWS)
    );
    for (let index = 0; index < count; index += 1) {
      // The shaft leaves on the release snap, never during the draw.
      const delay = baseDelay + index * P.ARROW_SPREAD_MS;
      const target = targets.length ? targets[Math.floor(roll() * targets.length)] : null;
      const landing = target ? stagePoint(target.node) : fallback;
      const missed = roll() < P.VOLLEY_MISS_RATE;
      const fan = (roll() - 0.5) * P.VOLLEY_ANGLE_VARIANCE_PX;
      const to = missed
        // Overshoots past the rank and into the ground behind it.
        ? { x: landing.x + fan + (from.x < landing.x ? 34 : -34), y: worldNode.clientHeight * 0.92 }
        : { x: landing.x + fan, y: landing.y };
      pending.push(window.setTimeout(() => emitBeat({ type: "arrow", volley: true }), delay));
      flyArrow(from, to, delay, { miss: missed });
      if (!missed) {
        pending.push(window.setTimeout(
          () => paintStain(to.x, to.y, false, 0.7), delay + P.ARROW_LEAD_MS
        ));
      }
    }
  }

  function performVolley(event) {
    // `defender` here is an environmental cue, not a key in sides (the engine's
    // own words), so the arrows belong to the town and arc from the wall side.
    log(translate("stage.volley"));
    const targets = script.sides.player.tokens.filter((token) => token.capacity > 0 && token.node);
    volleyArrows(
      event,
      { x: worldNode.clientWidth * 0.78, y: worldNode.clientHeight * 0.34 },
      targets,
      { x: worldNode.clientWidth * 0.25, y: worldNode.clientHeight * 0.62 }
    );

    // The wall's own archers loose the volley. No troop token is touched: the
    // contract's `defender` is terrain, not a side.
    const archers = root.querySelector(".stage-archers");
    if (archers) {
      archers.classList.remove("is-loosing");
      void archers.offsetWidth;
      archers.classList.add("is-loosing");
      pending.push(window.setTimeout(
        () => archers && archers.classList.remove("is-loosing"),
        TIMING.ARROW_FLIGHT + 260
      ));
    }
  }

  function showArcherRange(sideKey, shooters, targets) {
    if (!worldNode || archerRangeShown.has(sideKey) || !shooters.length) return;
    archerRangeShown.add(sideKey);
    const sourcePoints = shooters.map((token) => stagePoint(token.node));
    const targetPoints = targets.length
      ? targets.map((token) => stagePoint(token.node))
      : [{
        x: worldNode.clientWidth * (sideKey === "player" ? 0.72 : 0.28),
        y: worldNode.clientHeight * 0.62
      }];
    const average = (points, key) => points.reduce((sum, point) => sum + point[key], 0) / points.length;
    const from = { x: average(sourcePoints, "x"), y: average(sourcePoints, "y") };
    const to = { x: average(targetPoints, "x"), y: average(targetPoints, "y") };
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("stage-range-arc");
    svg.setAttribute("viewBox", `0 0 ${worldNode.clientWidth} ${worldNode.clientHeight}`);
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const crest = Math.max(18, Math.abs(to.x - from.x) * 0.16);
    path.setAttribute(
      "d", `M ${from.x.toFixed(1)} ${from.y.toFixed(1)} Q ${((from.x + to.x) / 2).toFixed(1)} ${
        (Math.min(from.y, to.y) - crest).toFixed(1)} ${to.x.toFixed(1)} ${to.y.toFixed(1)}`
    );
    svg.appendChild(path);
    ephemeral(svg, P.ARCHER_RANGE_ARC_MS);
  }

  function performArcherVolley(event) {
    const targetSide = event.side === "player" ? "enemy" : "player";
    const shooters = script.sides[event.side]?.tokens.filter(
      (token) => token.arm === "archer" && token.node && token.capacity > 0 && !token.overrun
    ) || [];
    // An overrun bow line has become a defensive line; it cannot loose again.
    if (!shooters.length) return;
    log(translate("stage.volley"));
    const liveTargets = script.sides[targetSide].tokens.filter(
      (token) => token.capacity > 0 && token.node
    );
    const focus = focusedTarget?.side === targetSide && focusedTarget.token.capacity > 0
      ? focusedTarget.token : null;
    const targets = focus ? [focus] : liveTargets;
    showArcherRange(event.side, shooters, targets);
    // The shooters draw as one rank, so the volley has a visible source.
    shooters.forEach((token, index) => {
      pending.push(window.setTimeout(() => drawBow(token.node), index * P.ARROW_SPREAD_MS));
    });
    volleyArrows(
      event,
      {
        x: worldNode.clientWidth * (event.side === "player" ? 0.22 : 0.78),
        y: worldNode.clientHeight * 0.55
      },
      targets,
      {
        x: worldNode.clientWidth * (targetSide === "enemy" ? 0.75 : 0.25),
        y: worldNode.clientHeight * 0.62
      },
      P.BOW_NOCK_MS + P.BOW_DRAW_MS
    );
    if (focus) {
      const clearAfter = P.BOW_NOCK_MS + P.BOW_DRAW_MS + P.ARROW_LEAD_MS;
      pending.push(window.setTimeout(clearFocusedTarget, clearAfter));
    }
  }

  function performFocusedVolley(shooters, mark) {
    const ready = shooters.filter((token) => token.node && token.capacity > 0 && !token.overrun);
    if (!ready.length || !mark?.node || mark.capacity <= 0) return;
    ready.forEach((token, index) => {
      pending.push(window.setTimeout(() => drawBow(token.node), index * P.ARROW_SPREAD_MS));
    });
    const points = ready.map((token) => stagePoint(token.node));
    const from = {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length
    };
    volleyArrows(
      { arrows: ready.length },
      from,
      [mark],
      stagePoint(mark.node),
      P.BOW_NOCK_MS + P.BOW_DRAW_MS
    );
    pending.push(window.setTimeout(
      clearFocusedTarget,
      P.BOW_NOCK_MS + P.BOW_DRAW_MS + P.ARROW_LEAD_MS
    ));
  }

  // The ONLY state this module mutates: inferred bucket capacities, which exist
  // purely so the counts on screen match battle_end.survivors.
  function applyKill(event) {
    const target = tokenAt(event.to.side, event.to.idx);
    if (!target || target.capacity <= 0) return false;
    target.capacity -= 1;
    return target.capacity === 0;
  }

  // Fired ARROW_LEAD_MS before the strike it belongs to, so the shaft is in
  // the air and lands exactly on the beat rather than after it.
  // The draw begins NOCK+DRAW before the shaft leaves, so the release snap and
  // the launch are one instant. Called from its own timeline cue.
  function nockArrow(event) {
    const from = tokenAt(event.from.side, event.from.idx);
    if (from?.overrun) return;
    drawBow(from?.node);
  }

  // Fired ARROW_LEAD_MS before the strike it belongs to, on the release snap,
  // so the shaft is in the air and lands exactly on the beat rather than after.
  // These shafts carry a resolved hit and therefore never miss.
  function launchArrow(event) {
    const from = tokenAt(event.from.side, event.from.idx);
    const to = tokenAt(event.to.side, event.to.idx);
    if (!from?.node || !to?.node || from.overrun) return;
    flyArrow(stagePoint(from.node), stagePoint(to.node), 0);
    emitBeat({ type: "arrow", side: event.from.side });
  }

  /*
   * ITEMS 2, 3, 5d, 8b — one blow, performed at its tier's rhythm.
   *
   * Everything that distinguishes a cavalry blow from a militia blow is set
   * here from WEIGHT_TIERS: how long the man telegraphs, how long the contact
   * is held, how far the victim goes, how wide the ink throws. None of it is
   * read back by anything: the damage, the kill and the survivor count all came
   * off the script and are applied unchanged.
   */
  function performStrike(event, index) {
    const source = tokenAt(event.from.side, event.from.idx);
    const target = tokenAt(event.to.side, event.to.idx);
    const tierName = source ? source.tier || weightTierFor(source) : "light";
    const tier = WEIGHT_TIERS[tierName];
    const mounted = source?.arm === "cavalry";
    const officer = Boolean(source?.isLieutenant);
    emitBeat({
      type: "strike",
      tier: tierName,
      kill: Boolean(event.kill),
      dmgShown: event.dmgShown,
      side: event.from.side,
      lieutenant: officer
    });
    // The hit-pause IS the contact hold: the whole stage stops for exactly as
    // long as the silhouette is held in its contact pose.
    const pause = tier.contactMs + (officer ? P.LIEUTENANT_EXTRA_HOLD_MS : 0);
    if (source?.node) {
      actorSlot(() => {
        source.node.classList.remove("is-striking");
        void source.node.offsetWidth;
        source.node.classList.toggle("is-charging", mounted);
        source.node.classList.add("is-striking");
        // 5d: the horse ends FORWARD of the line it broke; the foot closes in
        // behind it. Applied once per mount, so it reads as a breakthrough
        // rather than as a mount slowly walking off the stage.
        if (mounted && !source.brokeThrough) {
          source.brokeThrough = true;
          const dir = event.from.side === "player" ? 1 : -1;
          source.melee = (source.melee || 0) + dir * P.CAVALRY_BREAKTHROUGH_PX;
          source.node.style.setProperty("--mx", `${source.melee}px`);
        }
      }, { tier: tierName, priority: officer });
    }
    if (!target?.node) {
      if (event.kill) applyKill(event);
      syncCounts();
      return;
    }
    target.node.style.setProperty("--knock", `${tier.knockbackPx}px`);

    frozenUntilReal = performance.now() + pause;
    root.classList.add("is-hit-paused");
    pending.push(window.setTimeout(() => root && root.classList.remove("is-hit-paused"), pause));

    const point = stagePoint(target.node);
    // The blow travelled from the attacker to the target; the ink follows it.
    const origin = source?.node ? stagePoint(source.node) : { x: point.x - 30, y: point.y };
    const angle = Math.atan2(point.y - origin.y, point.x - origin.x);
    burst(point.x, point.y - 16, angle, tier.inkBurst);
    slash(point.x, point.y - 14, angle, tier);
    splatter(point.x, point.y, angle, tier);
    if (tier.jolt) heavyJolt(target.node);
    damageNumber(point.x, point.y, event.dmgShown, event.kill);
    target.damageTaken += Math.max(0, Number(event.dmgShown) || 0);
    if (Number.isFinite(event.hpAfter)) target.hpCurrent = Math.max(0, event.hpAfter);
    // The bar appears the moment this man has something to report, and not
    // before -- see .stage-hp in ui.css.
    target.node.classList.add("is-hurt");

    if (event.kill) {
      const emptied = applyKill(event);
      paintStain(point.x, point.y, true, tier.splatterScale, script.sides[event.to.side].weight);
      if (emptied) killBeat(event, source, target, point, tier);
      else reel(target);
      if (emptied && focusedTarget?.token === target) clearFocusedTarget();
    } else {
      reel(target);
    }
    // Shake #2 of 2, spent on the blow that ends the battle and nothing else.
    if (index === finalStrikeIndex) shake("final-blow");
    syncHealthBar(target);
    syncCounts();
    refreshArcherOverrun();
  }

  function reel(target) {
    target.node.classList.remove("is-reeling");
    void target.node.offsetWidth;
    target.node.classList.add("is-reeling");
  }

  /*
   * ITEM 2c / 5e / 6d — a death is three held beats, never one fade.
   *
   *   killer holds his weapon up      140ms
   *   body holds its death pose       160ms   (a horse rears first)
   *   body dissolves into the stain
   *
   * An officer's token adds the banner drop and its own line, because his is
   * the token the eye was already following.
   */
  function killBeat(event, source, target, point, tier) {
    syncHealthBar(target);
    flashHealthBar(target);
    if (source?.node) {
      source.node.classList.add("is-finishing");
      pending.push(window.setTimeout(
        () => source.node && source.node.classList.remove("is-finishing"), P.KILL_RAISE_MS
      ));
    }
    const mounted = target.arm === "cavalry";
    const posture = mounted ? P.CAVALRY_REAR_MS : P.DEATH_POSE_MS;
    pending.push(window.setTimeout(() => {
      if (!target.node) return;
      target.node.classList.add(mounted ? "is-rearing" : "is-dying");
    }, P.KILL_RAISE_MS));
    pending.push(window.setTimeout(() => {
      if (!target.node) return;
      target.node.classList.remove("is-dying", "is-rearing");
      target.node.classList.add("is-dead");
      // Horse and man go down as ONE mass, so they leave one large mark.
      if (mounted) paintStain(point.x, point.y, true, 2.1, script.sides[event.to.side].weight);
    }, P.KILL_RAISE_MS + posture));
    closeRanks(event.to.side, target);
    emitBeat({
      type: "kill", tier: target.tier || "light", kill: true,
      side: event.to.side, lieutenant: Boolean(target.isLieutenant)
    });
    if (target.isLieutenant) {
      fallenBanner(point.x, point.y);
      log(translate("stage.bannerFalls"));
    } else if (roll() < 0.12) {
      fallenBanner(point.x, point.y);
    }
  }

  function performMorale(event) {
    const ranks = root.querySelector(`.stage-ranks-${event.side}`);
    if (ranks) ranks.classList.toggle("is-wavering", event.level === "wavering");
  }

  function performRout(event) {
    emitBeat({ type: "rout", side: event.side });
    log(translate("stage.rout"));
    // The breaking blow lands in slow motion with the camera pushing in.
    setPhase("rout");
    root.classList.add("is-slowmo");
    pending.push(window.setTimeout(() => {
      if (!root) return;
      root.classList.remove("is-slowmo");
      script.sides[event.side].tokens.forEach((token, index) => {
        if (!token.node || token.capacity <= 0) return;
        token.node.style.setProperty(
          "--flee-dur", `${Math.round(P.FLEE_MIN_MS + roll() * P.FLEE_VAR_MS)}ms`
        );
        token.node.style.setProperty("--flee-drift", `${Math.round((roll() - 0.5) * 60)}px`);
        token.node.classList.add("is-fleeing");
        // 8c: they turn, and they leave their colours on the ground. Every
        // third man, so the field is littered rather than paved.
        if (index % 3 === 0) {
          const where = stagePoint(token.node);
          fallenBanner(where.x, where.y);
        }
      });
      // Both sides can rout; only cheer with troops that are not themselves
      // fleeing.
      const other = event.side === "player" ? "enemy" : "player";
      script.sides[other].tokens.forEach((token) => {
        if (token.node && token.capacity > 0 && !token.node.classList.contains("is-fleeing")) {
          token.node.classList.add("is-cheering");
        }
      });
    }, TIMING.ROUT_SLOWMO));
  }

  /* -- ITEM 7: orders, given on the field ------------------------------------ */

  /*
   * An order is something you give to an army that is already fighting, so it
   * is asked for twice during the melee and never before it. There is no
   * pre-battle order screen; the formation is the pre-battle commitment.
   *
   * PRESENTATION ONLY, and that boundary is the whole design. The engine
   * resolved this battle before the first frame -- casualties, survivors and
   * winner are already on the script. An order therefore CANNOT and DOES NOT
   * re-resolve anything: it moves ranks, it writes a dispatch line, and it goes
   * into telemetry. The balance-side command formula (CONFIG.F3_COMMANDS,
   * applyF3BattleModifiers, chooseBattleCommand) is untouched and still owns
   * the number side exactly as before.
   *
   * Replay: the two windows come from commandWindows(script), which reads only
   * the script, so the same battle always asks at the same two beats. What was
   * chosen is appended to `commandLog`, and that array is the replay record --
   * feed it back through options.replayCommands and the performance repeats.
   */
  function commandOptionsAt() {
    const alive = (sideKey) => script.sides[sideKey].tokens
      .filter((token) => token.capacity > 0).length;
    const own = alive("player");
    const foe = alive("enemy");
    const offered = [];
    // Contextual: you press when you can afford to, you steady when you cannot,
    // and you concentrate when there is a mass worth concentrating on.
    if (own >= foe) offered.push("charge");
    offered.push("hold");
    if (foe >= P.COMMAND_FOCUS_TOKENS) offered.push("focus");
    return offered;
  }

  function closeCommandGate() {
    window.clearTimeout(commandTimer);
    commandTimer = 0;
    const wasOpen = commandGateAt >= 0;
    commandGateAt = -1;
    root?.querySelector(".stage-orders")?.remove();
    root?.classList.remove("is-awaiting-order");
    // The melee was held while the chips were up; let it run on again.
    if (wasOpen) frozenUntilReal = performance.now();
  }

  function issueCommand(command, source = "player") {
    if (!root || !script) return null;
    const index = commandLog.length;
    closeCommandGate();
    const record = { n: index + 1, command, t: Math.round(virtualTime), source };
    commandLog.push(record);
    // The order lands on its own beat: 200ms of slow motion, then execution.
    root.classList.add("is-slowmo");
    pending.push(window.setTimeout(
      () => root && root.classList.remove("is-slowmo"), P.COMMAND_SLOWMO_MS
    ));
    log(translate(`battleCommand.${command}`));
    pending.push(window.setTimeout(() => executeCommand(command), P.COMMAND_SLOWMO_MS));
    emitBeat({ type: "command", command, n: record.n });
    options.onCommand?.(record);
    return record;
  }

  /* The three orders, as three visibly different things happening to the line. */
  function executeCommand(command) {
    if (!root || !worldNode) return;
    const own = script.sides.player.tokens.filter((token) => token.node && token.capacity > 0);
    const meleeOwn = own.filter((token) => token.arm !== "archer");
    const archers = own.filter((token) => token.arm === "archer" && !token.overrun);
    if (command === "charge") {
      // 全线压上 — melee steps in; the bow line deliberately stays behind.
      meleeOwn.forEach((token) => {
        token.melee = (token.melee || 0) + P.COMMAND_PRESS_STEP_PX;
        token.node.style.setProperty("--mx", `${token.melee}px`);
      });
      root.classList.add("order-press");
      pending.push(window.setTimeout(() => root && root.classList.remove("order-press"), 700));
      refreshArcherOverrun();
      return;
    }
    if (command === "hold") {
      // 稳住阵线 — melee closes on itself while bows take one rear depth step.
      if (!meleeOwn.length && !archers.length) return;
      const centre = meleeOwn.length
        ? meleeOwn.reduce((sum, token) => sum + token.melee, 0) / meleeOwn.length : 0;
      meleeOwn.forEach((token) => {
        token.melee = Math.round(centre + (token.melee - centre) * P.COMMAND_HOLD_TIGHTEN);
        token.node.style.setProperty("--mx", `${token.melee}px`);
      });
      archers.forEach((token) => {
        setTokenDepth(token, Math.min(1, token.depth + P.ARCHER_HOLD_BACK_DEPTH));
      });
      root.classList.add("order-hold");
      pending.push(window.setTimeout(() => root && root.classList.remove("order-hold"), 700));
      refreshArcherOverrun();
      return;
    }
    // 集火敌将 — three melee figures converge; bows turn and put their next
    // decorative volley into the same marked target.
    const foes = script.sides.enemy.tokens.filter((token) => token.node && token.capacity > 0);
    if (!foes.length) return;
    // Deterministic pick: the enemy standing furthest forward, i.e. the one the
    // line is already up against.
    const mark = foes.reduce((best, token) => (token.melee < best.melee ? token : best), foes[0]);
    clearFocusedTarget();
    focusedTarget = { side: "enemy", token: mark };
    mark.node.classList.add("is-marked");
    archers.forEach((token) => token.node.classList.add("is-aiming-focus"));
    const markX = mark.melee + mark.baseX;
    meleeOwn
      .slice()
      .sort((first, second) =>
        Math.abs(first.baseX + first.melee - markX) - Math.abs(second.baseX + second.melee - markX))
      .slice(0, P.COMMAND_FOCUS_TOKENS)
      .forEach((token) => {
        token.melee = Math.round(token.melee + (markX - (token.baseX + token.melee)) * 0.55);
        token.node.style.setProperty("--mx", `${token.melee}px`);
        token.node.classList.add("is-converging");
        pending.push(window.setTimeout(
          () => token.node && token.node.classList.remove("is-converging"), P.COMMAND_FOCUS_MS
        ));
      });
    performFocusedVolley(archers, mark);
    refreshArcherOverrun();
  }

  function clearFocusedTarget() {
    if (focusedTarget?.token?.node) focusedTarget.token.node.classList.remove("is-marked");
    script?.sides.player.tokens.forEach((token) => {
      token.node?.classList.remove("is-aiming-focus");
    });
    script?.sides.enemy.tokens.forEach((token) => {
      token.node?.classList.remove("is-aiming-focus");
    });
    focusedTarget = null;
  }

  // The chips. Rendered inside the stage, over the melee, because that is where
  // the decision is being made.
  function openCommandGate(windowIndex) {
    if (!root || commandLog.length >= P.COMMAND_WINDOWS) return;
    const offered = commandOptionsAt();
    const fallback = offered.includes(P.COMMAND_DEFAULT) ? P.COMMAND_DEFAULT : offered[0];
    // Autoplay, reduced motion and a skipped battle never wait for a human.
    if (options.autoCommand?.() || reducedMotion.matches) {
      issueCommand(fallback, "auto");
      return;
    }
    const replay = options.replayCommands?.()?.[windowIndex];
    if (replay?.command && offered.includes(replay.command)) {
      issueCommand(replay.command, "replay");
      return;
    }
    commandGateAt = windowIndex;
    root.classList.add("is-awaiting-order");
    // Hold the melee where it is. The order is given INTO the fight, and the
    // fight has to be legible while you decide.
    frozenUntilReal = Number.POSITIVE_INFINITY;
    const bar = document.createElement("div");
    bar.className = "stage-orders";
    bar.innerHTML =
      `<small>${translate("battleCommand.kicker")}</small><div class="stage-order-chips">` +
      offered.map((key) =>
        `<button type="button" data-order="${key}">${translate(`battleCommand.${key}`)}</button>`
      ).join("") + "</div>";
    bar.addEventListener("click", (clicked) => {
      const button = clicked.target.closest("[data-order]");
      if (!button) return;
      clicked.stopPropagation();
      issueCommand(button.dataset.order, "player");
    });
    root.querySelector(".stage-paper").appendChild(bar);
    // The field will not wait for ever: an unanswered window resolves itself so
    // a battle can never stall on a chip nobody pressed.
    commandTimer = window.setTimeout(() => {
      if (commandGateAt === windowIndex) issueCommand(fallback, "timeout");
    }, P.COMMAND_AUTO_MS);
  }

  /* -- timeline -------------------------------------------------------------- */

  // The engine owns pacing: every event carries an absolute `t`, so the stage
  // walks the event array rather than inventing a schedule of its own.
  function buildTimeline() {
    const times = scheduleEvents(script.events);
    // The last blow of the battle: the one moment the second shake is for.
    finalStrikeIndex = -1;
    script.events.forEach((event, index) => {
      if (event.type === "strike") finalStrikeIndex = index;
    });
    const scripted = script.events.map((event, index) => ({
      at: times[index],
      order: index * 2 + 1,
      run: () => {
        switch (event.type) {
          case "battle_start":
            root.classList.add("is-entering");
            log(translate("stage.march"));
            pending.push(window.setTimeout(
              () => root && root.classList.remove("is-entering"),
              P.DEPLOY_MS - P.DEPLOY_SETTLE_MS
            ));
            // Both lines arrive, then dip together: one beat that says "formed".
            pending.push(window.setTimeout(() => {
              if (!root) return;
              root.classList.add("is-set");
              pending.push(window.setTimeout(
                () => root && root.classList.remove("is-set"), P.DEPLOY_SETTLE_MS
              ));
            }, P.DEPLOY_MS - P.DEPLOY_SETTLE_MS));
            break;
          case "volley": performVolley(event); break;
          case "archer_volley": performArcherVolley(event); break;
          // A `command` recorded by the engine is a pre-resolution artefact of
          // the balance side; the stage no longer performs it, because the
          // order the player actually gives now happens in the melee windows.
          case "command": break;
          case "round_start":
            log(translate("stage.round").replace("{n}", String(event.n)));
            breatheRound();
            break;
          case "strike": performStrike(event, index); break;
          case "morale": performMorale(event); break;
          case "rout": performRout(event); break;
          case "battle_end": showSettlement(event, false); break;
          default: break;
        }
      },
      // Data-only projection, used by skip. Only strikes and the ending carry
      // any; everything else is pure theatre.
      dataRun: () => {
        if (event.type === "strike" && event.kill) applyKill(event);
        if (event.type === "battle_end") showSettlement(event, true);
      }
    }));

    // Phase cues ride the same virtual clock as the script, so 2x compresses
    // the phases instead of desynchronising them. They carry no data at all:
    // dataRun is a no-op, which is what keeps skip identical to watching.
    const contactAt = P.DEPLOY_MS + P.STANDOFF_MS + P.CHARGE_MS;
    // One arrow cue per archer strike, launched ARROW_LEAD_MS early so the
    // shaft is already in the air when the hit lands on the beat. Offsetting
    // the LAUNCH keeps the impact in sync; delaying the hit would not.
    const arrowCues = [];
    const drawLead = P.ARROW_LEAD_MS + P.BOW_NOCK_MS + P.BOW_DRAW_MS;
    script.events.forEach((event, index) => {
      if (event.type !== "strike") return;
      const shooter = script.sides[event.from.side]?.byIdx?.get(event.from.idx);
      if (shooter?.arm !== "archer") return;
      // Two cues, not one: the draw starts a full nock+draw earlier so the
      // release snap and the launch are the same instant.
      arrowCues.push({ at: Math.max(0, times[index] - drawLead), run: () => nockArrow(event) });
      arrowCues.push({
        at: Math.max(0, times[index] - P.ARROW_LEAD_MS),
        run: () => launchArrow(event)
      });
    });

    // ITEM 7: two order windows, derived from the script so a replay asks at
    // the same two beats. They carry no data — dataRun is a no-op — so a
    // skipped battle is unaffected by them in every way.
    // `command` is emitted on the script only when the F3 army system is on,
    // so it is the marker for "this build has battle orders at all". The demo
    // build never carries it and therefore is never asked -- the demo boundary
    // is not something the stage may widen.
    commandWindowsAt = script.command ? commandWindows(script.events, times) : [];
    const orderCues = commandWindowsAt.map((at, windowIndex) => ({
      at, run: () => openCommandGate(windowIndex)
    }));

    const cues = [
      ...arrowCues,
      ...orderCues,
      { at: 0, run: () => setPhase("deploy") },
      { at: P.DEPLOY_MS, run: () => { setPhase("standoff"); log(translate("stage.standoff")); } },
      {
        at: P.DEPLOY_MS + P.STANDOFF_MS,
        run: () => {
          setPhase("charge");
          emitBeat({ type: "charge" });
          log(translate("stage.charge"));
          // The charge is an actual advance: the lines travel most of the way
          // to the centre during this phase, back ranks following on --lag.
          convergeTo(P.CHARGE_CONVERGE);
        }
      },
      { at: contactAt - P.CHARGE_LEAD_MS, run: () => root && root.classList.add("is-lead") },
      { at: contactAt, run: onContact }
    // Negative order: on a shared timestamp the phase is set before the event
    // that belongs to it runs.
    ].map((cue, index) => ({ ...cue, order: index - 100, dataRun: () => {} }));

    timeline = scripted.concat(cues)
      .sort((first, second) => (first.at - second.at) || (first.order - second.order));
    cursor = 0;
  }

  /* -- settlement ------------------------------------------------------------ */

  function showSettlement(event, skipped) {
    if (!root) return;
    playing = false;
    endEvent = event;
    const finalCounts = battleEndCounts(event);
    root.dataset.playerSurvivors = String(finalCounts.player);
    root.dataset.enemySurvivors = String(finalCounts.enemy);
    countNodes.player.textContent = String(finalCounts.player);
    countNodes.enemy.textContent = String(finalCounts.enemy);

    const won = event.winner === "player";
    const drawn = event.winner === "draw";
    const sealKey = won ? "map.victorySeal" : drawn ? "map.drawSeal" : "map.defeatSeal";
    stampSeal(translate(sealKey), won || drawn ? {} : { tone: "loss" });

    const tally = root.querySelector(".stage-tally");
    tally.hidden = false;
    // Dock it to the paper's lower edge, measured rather than assumed, so it
    // rises into the empty space under the sheet at any viewport height.
    const paper = root.querySelector(".stage-paper");
    if (paper) {
      // Clamp to the viewport: with a full-height battlefield the paper's lower
      // edge can sit close enough to the bottom that the panel would slide off.
      const below = paper.getBoundingClientRect().bottom;
      const room = window.innerHeight - tally.offsetHeight - P.TALLY_VIEWPORT_MARGIN_PX;
      tally.style.top = `${Math.round(Math.max(0, Math.min(below, room)))}px`;
    }
    // The seal lands first; the tally slides up from under the field a beat
    // later, so it never covers the ranks it is reporting on.
    if (!skipped && !reducedMotion.matches) {
      pending.push(window.setTimeout(
        () => tally && tally.classList.add("is-in"), P.SEAL_TO_TALLY_MS
      ));
    } else {
      tally.classList.add("is-in");
    }
    tally.innerHTML =
      `<dl><div><dt>${translate("stage.tallyGold")}</dt><dd data-target="${event.loot.gold}">0</dd></div>` +
      `<div><dt>${translate("stage.tallyRenown")}</dt><dd data-target="${event.loot.renown}">0</dd></div></dl>` +
      `<button type="button" class="stage-continue">${translate("stage.continue")}</button>`;

    const numbers = [...tally.querySelectorAll("dd")];
    if (reducedMotion.matches || skipped) {
      numbers.forEach((node) => { node.textContent = node.dataset.target; });
    } else {
      numbers.forEach((node, index) => {
        const target = Number(node.dataset.target);
        // Counting starts with the slide-in, not while the panel is still down.
        const start = performance.now() + P.SEAL_TO_TALLY_MS + index * 350;
        const step = (now) => {
          if (!root) return;
          const progress = Math.min(1, (now - start) / 500);
          if (progress > 0) node.textContent = String(Math.round(target * progress));
          if (progress < 1) requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
      });
    }
    tally.querySelector(".stage-continue").addEventListener("click", () => {
      const done = doneCallback;
      dispose();
      if (done) done();
    });
  }

  /* -- clock ------------------------------------------------------------------ */

  function tick(now) {
    if (!playing) return;
    if (suspended) {
      lastReal = now;
      rafId = requestAnimationFrame(tick);
      return;
    }
    if (now > frozenUntilReal) virtualTime = advanceVirtualClock(virtualTime, now - lastReal, speed);
    lastReal = now;
    while (cursor < timeline.length && timeline[cursor].at <= virtualTime) {
      timeline[cursor].run();
      cursor += 1;
    }
    if (cursor < timeline.length && playing) rafId = requestAnimationFrame(tick);
  }

  /* -- controls --------------------------------------------------------------- */

  function onPressStart(event) {
    if (event.target.closest(".stage-continue, .stage-speed")) return;
    pressFired = false;
    pressTimer = window.setTimeout(() => { pressFired = true; skip(); }, TIMING.LONG_PRESS);
  }

  function onPressEnd(event) {
    window.clearTimeout(pressTimer);
    if (event.target.closest(".stage-speed")) return;
    // A normal stage tap intentionally does nothing. Long-press is the only
    // stage-wide gesture; speed belongs exclusively to the visible chip.
    pressFired = false;
  }

  function setSpeed(value, notify = true) {
    speed = normalizePlaybackSpeed(value);
    if (!root) return speed;
    root.classList.toggle("is-fast", speed === 2);
    root.classList.toggle("is-very-fast", speed === 4);
    const chip = root.querySelector(".stage-speed");
    if (chip) {
      chip.textContent = `▶▶ ${speed}×`;
      chip.setAttribute("aria-label", translate("stage.speedLabel", { speed }));
      chip.dataset.speed = String(speed);
    }
    if (notify && options.onSpeedChange) options.onSpeedChange(speed);
    return speed;
  }

  function cycleSpeed(event) {
    event.stopPropagation();
    setSpeed(nextPlaybackSpeed(speed));
  }

  function onPressCancel() {
    window.clearTimeout(pressTimer);
  }

  function skip() {
    if (!playing) return;
    playing = false;
    // A skipped battle is not asked for orders: the orders are performance, and
    // there is no performance left to give them to.
    closeCommandGate();
    cancelAnimationFrame(rafId);
    if (options.onSkip) options.onSkip();
    // Apply the DATA of everything unplayed — same script, no theatre — so a
    // skipped battle settles identically to a watched one.
    for (; cursor < timeline.length; cursor += 1) timeline[cursor].dataRun();
    if (root) root.classList.add("is-skipped");
  }

  /* -- public ------------------------------------------------------------------ */

  function play(rawScript, onDone) {
    dispose();
    suspended = false;
    script = normalizeScript(rawScript);
    doneCallback = onDone || null;
    shakesSpent = 0;
    stains = [];
    stainArea = 0;
    commandLog = [];
    commandWindowsAt = [];
    commandGateAt = -1;
    archerRangeShown = new Set();
    focusedTarget = null;
    roll = seededRandom(
      (script.sides.player.startTroops * 73856093) ^ (script.sides.enemy.startTroops * 19349663)
    );

    buildDom();
    setSpeed(typeof options.initialSpeed === "function" ? options.initialSpeed() : options.initialSpeed, false);
    document.body.classList.add("battle-stage-open");
    const names = root.querySelectorAll(".plate-name");
    countNodes = {
      player: root.querySelectorAll(".plate-count")[0],
      enemy: root.querySelectorAll(".plate-count")[1]
    };
    names[0].textContent = script.sides.player.label;
    names[1].textContent = script.sides.enemy.label;
    // `formations` is emitted for every v1.1 battle and never for v1.0, so it
    // is the variant marker the script already carries. The health bars are
    // built either way but CSS keeps them hidden without this class, so a v1.0
    // battle can never show one.
    root.classList.toggle("is-v11", Boolean(script.formations));
    if (script.terrain === "town") {
      root.querySelector(".stage-wall").hidden = false;
      spawnWallArchers();
    }

    spawnSide("player");
    spawnSide("enemy");
    syncCounts();
    buildTimeline();

    if (reducedMotion.matches) {
      // No performance at all: settle straight from the same data.
      for (; cursor < timeline.length; cursor += 1) timeline[cursor].dataRun();
      return;
    }

    if (!hintSeen()) {
      const hint = root.querySelector(".stage-hint");
      hint.hidden = false;
      hint.textContent = translate("stage.hint");
      pending.push(window.setTimeout(() => { if (root) hint.hidden = true; }, 3600));
      persistHint();
    }

    playing = true;
    virtualTime = 0;
    lastReal = performance.now();
    frozenUntilReal = 0;
    rafId = requestAnimationFrame(tick);
  }

  function dispose() {
    playing = false;
    suspended = false;
    cancelAnimationFrame(rafId);
    window.clearTimeout(pressTimer);
    window.clearTimeout(commandTimer);
    commandTimer = 0;
    commandGateAt = -1;
    archerRangeShown = new Set();
    focusedTarget = null;
    stains = [];
    stainArea = 0;
    pending.forEach((id) => window.clearTimeout(id));
    pending = [];
    if (root) {
      root.remove();
      root = null;
    }
    worldNode = null;
    logNode = null;
    stainContext = null;
    countNodes = {};
    timeline = [];
    cursor = 0;
    audio?.disposeBattle?.();
    document.body.classList.remove("battle-stage-open");
  }

  return {
    play,
    skip,
    dispose,
    setSuspended(value) {
      suspended = Boolean(value);
      lastReal = typeof performance !== "undefined" ? performance.now() : lastReal;
      return suspended;
    },
    get playing() { return playing; },
    // Survivors as the stage currently believes them — compared against
    // battle_end.survivors by the contract cases.
    get survivors() {
      return endEvent
        ? battleEndCounts(endEvent)
        : script
        ? { player: survivorsOf(script.sides.player), enemy: survivorsOf(script.sides.enemy) }
        : null;
    },
    get endEvent() { return endEvent; },
    get speed() { return speed; },
    // ITEM 7's replay record: the orders given, in order, with the beat each
    // was given on. Feed back through options.replayCommands to repeat a run.
    get commands() { return commandLog.map((entry) => ({ ...entry })); },
    // The two beats this script asks on. Derived, not stored, so it is the same
    // answer every time the same script is played.
    get commandWindows() { return commandWindowsAt.slice(); },
    get shakesSpent() { return shakesSpent; },
    // QA seam for the 390x844 still-frame acceptance. Coordinates are read
    // from the compositor, not reconstructed from the formation formula.
    get unitPositions() {
      if (!script || !worldNode) return [];
      const stageBox = worldNode.getBoundingClientRect();
      return ["player", "enemy"].flatMap((sideKey) =>
        script.sides[sideKey].tokens.filter((token) => token.node).map((token) => {
          const box = token.node.getBoundingClientRect();
          return {
            side: sideKey,
            idx: token.idx,
            troopType: token.troopType,
            arm: token.arm,
            speed: token.moveSpeed,
            depth: token.depth,
            overrun: Boolean(token.overrun),
            x: +(box.left - stageBox.left + box.width / 2).toFixed(1),
            y: +(box.top - stageBox.top + box.height * 0.85).toFixed(1)
          };
        })
      );
    },
    // Test seam: drive an order without a pointer, exactly as a chip would.
    issueCommand(command) { return issueCommand(command, "test"); }
  };
}

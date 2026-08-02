import { stampSeal } from "./seal.js";
import {
  CONFIG_PRESENTATION as P,
  FORMATION_LAYOUTS,
  FORMATION_SHAPE,
  depthPlacement
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
const TIMING = Object.freeze({
  HIT_PAUSE: P.STRIKE_PAUSE_MS,
  ROUT_SLOWMO: P.ROUT_SLOWMO_MS,
  LONG_PRESS: P.LONG_PRESS_MS,
  ARROW_FLIGHT: P.ARROW_FLIGHT_MS
});

const PHASES = Object.freeze(["deploy", "standoff", "charge", "melee", "rout"]);

const TOKEN_WIDTH = 38; // mirrors .stage-token width in ui.css

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
      tokens: (source.tokens || []).map((token) => ({
        idx: token.idx,
        troopType: token.troopType,
        arm: token.arm || null,
        capacity: Math.max(0, Math.min(weight, total - token.idx * weight)),
        node: null
      }))
    };
  });
  const normalized = {
    battleId: raw.battleId,
    terrain: raw.terrain,
    sides,
    events: raw.events.slice().sort((first, second) => first.t - second.t)
  };
  if (raw.lieutenant === "player") normalized.lieutenant = "player";
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
    '<path d="M20.4 4.2Q26.4 15 20.4 25.8L18.9 24.9Q24.4 15 18.9 5.1Z"/>' +
    '<path class="archer-string" d="M19.5 4.9 13.5 15.3 19.5 25.1 19.1 25.1 13.1 15.3 19.1 4.9Z"/>' +
    '<path class="archer-arrow" d="M13.8 14.7 22.4 14.5 22.4 15.5 13.8 15.9Z"/>' +
    '<circle cx="12.2" cy="5.4" r="3"/>' +
    '<path d="M9.2 9Q12.2 7.4 15.2 9L16.8 21.8Q12.2 23.6 7.6 21.8Z"/>' +
    '<path d="M10 22.2 8.8 30.6Q10.1 31.3 11.4 30.6L11.8 22.6Z"/>' +
    '<path d="M13 22.6 14.8 30.6Q16.1 31.3 17.3 30.6L15.2 22.2Z"/>' +
    '<path d="M14.6 11.4Q17.4 12.6 18.6 14.2L17.2 15.4Q15.6 13.8 13.4 13.2Z"/>' +
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

function cavalryFigure() {
  return (
    '<path d="M3 22Q7 15 15 17L23 14Q28 15 29 19L25 20Q22 22 17 22L7 23Z"/>' +
    '<path d="M7 22 5 31H7.2L10 23M20 21l2 10h2.2l-1-12"/>' +
    '<path d="M13 17 12 8Q16 5 19 9L20 17Z"/>' +
    '<circle cx="15.5" cy="5" r="2.8"/>' +
    '<g class="fig-melee"><path d="M17 13 28 2 29.4 3.4 19 15Z"/></g>'
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
  let script = null;
  let endEvent = null;
  let doneCallback = null;
  let pressTimer = 0;
  let pressFired = false;
  let pending = [];
  let roll = seededRandom(1);

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
      '<button type="button" class="stage-speed" aria-live="polite"></button>' +
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
        const placed = layout(index, shown, dir);
        formationX = placed.x;
        depth = placed.depth;
        row = placed.rank;
        column = index;
      }
      // The lieutenant takes the leading position of his own side. He replaces
      // no soldier: the token keeps its troopType and capacity, only the drawn
      // figure changes, so survivor accounting is unaffected.
      const isLieutenant = script.lieutenant === sideKey && index === 0;
      const node = document.createElement("i");
      node.className = isLieutenant
        ? `stage-token unit-${token.troopType || "militia"} is-lieutenant`
        : `stage-token unit-${token.troopType || "militia"}${token.arm ? ` arm-${token.arm}` : ""}`;
      node.innerHTML = figureSvg(isLieutenant ? "lieutenant" : token.troopType, token.arm);
      // Every token carries a bar; CSS keeps them hidden outside v1.1.
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
      const tx = (formationX ?? ((column * spacing + row * spacing * 0.4) * dir)) + jx;
      node.style.setProperty("--tx", `${tx}px`);
      node.style.setProperty("--ty", `${cam.ty.toFixed(1)}px`);
      node.style.setProperty("--tscale", cam.scale.toFixed(3));
      node.style.setProperty("--fade", cam.fade.toFixed(2));
      node.style.zIndex = String(cam.z);
      node.style.setProperty("--sway", `${(1.6 + roll() * 1.2).toFixed(2)}s`);
      // Back ranks lag into the charge, so the advance has depth.
      node.style.setProperty("--lag", `${row * P.CHARGE_BACK_RANK_LAG_MS - (token.arm === "cavalry" ? 300 : 0)}ms`);
      rankHost.appendChild(node);
      token.node = node;
      token.tx = tx;
      token.row = row;
      token.melee = 0;
      token.jitterX = roll() - 0.5;
      // Parade position along the stage, derived rather than measured: the
      // rank anchors are left/right 7% of the world and the token box is
      // TOKEN_WIDTH wide, so this holds before any animation has run.
      const anchor = sideKey === "player"
        ? worldNode.clientWidth * 0.07
        : worldNode.clientWidth * 0.93;
      token.baseX = anchor + tx + TOKEN_WIDTH / 2;
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
    shake(12);
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
        const travel = (target - token.baseX) * ratio;
        const jitter = token.jitterX * P.MELEE_JITTER_PX * ratio;
        token.melee = Math.round(travel + jitter);
        token.node.style.setProperty("--mx", `${token.melee}px`);
        // No vertical component: closing on the centreline happens along the
        // ground, so depth (and therefore height and scale) is unchanged.
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
    return script.sides[sideKey].tokens.find((token) => token.idx === idx) || null;
  }

  /* -- ink ------------------------------------------------------------------ */

  function paintStain(x, y, big) {
    if (!stainContext) return;
    const blots = big ? 4 : 2;
    for (let index = 0; index < blots; index += 1) {
      const radius = (big ? 5 : 3) + roll() * (big ? 7 : 4);
      stainContext.fillStyle = `rgba(43, 38, 32, ${(0.14 + roll() * 0.2).toFixed(2)})`;
      stainContext.beginPath();
      stainContext.ellipse(
        x + (roll() - 0.5) * 18, y + (roll() - 0.5) * 12,
        radius, radius * (0.6 + roll() * 0.5), roll() * Math.PI, 0, Math.PI * 2
      );
      stainContext.fill();
    }
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

  function burst(x, y) {
    const node = document.createElement("i");
    node.className = "stage-burst";
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
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

  function shake(pixels) {
    root.style.setProperty("--shake", `${pixels}px`);
    root.classList.remove("is-shaking");
    void root.offsetWidth;
    root.classList.add("is-shaking");
  }

  function log(text) {
    if (logNode) logNode.textContent = text;
  }

  /* -- event performances ---------------------------------------------------- */

  function performVolley(event) {
    // `defender` here is an environmental cue, not a key in sides (the engine's
    // own words), so the arrows belong to the town and arc from the wall side.
    log(translate("stage.volley"));
    const targets = script.sides.player.tokens.filter((token) => token.capacity > 0 && token.node);
    const arrows = Math.max(1, Math.min(9, event.arrows || 3));
    for (let index = 0; index < arrows; index += 1) {
      const arrow = document.createElement("i");
      arrow.className = "stage-arrow";
      const target = targets.length ? targets[Math.floor(roll() * targets.length)] : null;
      const to = target ? stagePoint(target.node)
        : { x: worldNode.clientWidth * 0.25, y: worldNode.clientHeight * 0.62 };
      arrow.style.setProperty("--from-x", `${worldNode.clientWidth * (0.7 + roll() * 0.2)}px`);
      arrow.style.setProperty("--to-x", `${to.x + (roll() - 0.5) * 26}px`);
      arrow.style.setProperty("--to-y", `${to.y}px`);
      arrow.style.setProperty("--delay", `${Math.round(roll() * 200)}ms`);
      ephemeral(arrow, TIMING.ARROW_FLIGHT + 260);
      pending.push(window.setTimeout(() => paintStain(to.x, to.y, false), TIMING.ARROW_FLIGHT));
    }

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

  function performArcherVolley(event) {
    log(translate("stage.volley"));
    const targetSide = event.side === "player" ? "enemy" : "player";
    const targets = script.sides[targetSide].tokens.filter((token) => token.capacity > 0 && token.node);
    const arrows = Math.max(1, Math.min(12, event.arrows || 3));
    for (let index = 0; index < arrows; index += 1) {
      const arrow = document.createElement("i");
      arrow.className = "stage-arrow";
      const target = targets.length ? targets[Math.floor(roll() * targets.length)] : null;
      const to = target ? stagePoint(target.node)
        : { x: worldNode.clientWidth * (targetSide === "enemy" ? 0.75 : 0.25), y: worldNode.clientHeight * 0.62 };
      const fromRatio = event.side === "player" ? 0.22 : 0.78;
      arrow.style.setProperty("--from-x", `${worldNode.clientWidth * fromRatio}px`);
      arrow.style.setProperty("--to-x", `${to.x + (roll() - 0.5) * 26}px`);
      arrow.style.setProperty("--to-y", `${to.y}px`);
      arrow.style.setProperty("--delay", `${Math.round(roll() * 180)}ms`);
      ephemeral(arrow, TIMING.ARROW_FLIGHT + 260);
    }
  }

  // The ONLY state this module mutates: inferred bucket capacities, which exist
  // purely so the counts on screen match battle_end.survivors.
  function applyKill(event) {
    const target = tokenAt(event.to.side, event.to.idx);
    if (!target || target.capacity <= 0) return false;
    target.capacity -= 1;
    return target.capacity === 0;
  }

  function performStrike(event) {
    const source = tokenAt(event.from.side, event.from.idx);
    const target = tokenAt(event.to.side, event.to.idx);
    if (source?.node) {
      source.node.classList.remove("is-striking");
      void source.node.offsetWidth;
      source.node.classList.add("is-striking");
    }
    if (!target?.node) {
      if (event.kill) applyKill(event);
      syncCounts();
      return;
    }

    // 60ms hit-pause: the whole stage freezes on impact.
    frozenUntilReal = performance.now() + TIMING.HIT_PAUSE;
    root.classList.add("is-hit-paused");
    pending.push(window.setTimeout(() => root && root.classList.remove("is-hit-paused"), TIMING.HIT_PAUSE));

    const point = stagePoint(target.node);
    burst(point.x, point.y - 16);
    damageNumber(point.x, point.y, event.dmgShown, event.kill);
    target.damageTaken += Math.max(0, Number(event.dmgShown) || 0);
    if (Number.isFinite(event.hpAfter)) target.hpCurrent = Math.max(0, event.hpAfter);

    if (event.kill) {
      const emptied = applyKill(event);
      paintStain(point.x, point.y, true);
      if (emptied) {
        // The body hangs a beat before it melts, and the line closes over it.
        syncHealthBar(target);
        flashHealthBar(target);
        pending.push(window.setTimeout(() => {
          if (target.node) target.node.classList.add("is-dead");
        }, P.KILL_FALL_MS));
        closeRanks(event.to.side, target);
        if (roll() < 0.15) fallenBanner(point.x, point.y);
      } else {
        target.node.classList.remove("is-reeling");
        void target.node.offsetWidth;
        target.node.classList.add("is-reeling");
      }
      shake(Math.min(10, 5 + script.sides[event.to.side].weight * 2));
    } else {
      target.node.classList.remove("is-reeling");
      void target.node.offsetWidth;
      target.node.classList.add("is-reeling");
    }
    syncHealthBar(target);
    syncCounts();
  }

  function performMorale(event) {
    const ranks = root.querySelector(`.stage-ranks-${event.side}`);
    if (ranks) ranks.classList.toggle("is-wavering", event.level === "wavering");
  }

  function performRout(event) {
    log(translate("stage.rout"));
    // The breaking blow lands in slow motion with the camera pushing in.
    setPhase("rout");
    root.classList.add("is-slowmo");
    pending.push(window.setTimeout(() => {
      if (!root) return;
      root.classList.remove("is-slowmo");
      script.sides[event.side].tokens.forEach((token) => {
        if (!token.node || token.capacity <= 0) return;
        token.node.style.setProperty(
          "--flee-dur", `${Math.round(P.FLEE_MIN_MS + roll() * P.FLEE_VAR_MS)}ms`
        );
        token.node.style.setProperty("--flee-drift", `${Math.round((roll() - 0.5) * 60)}px`);
        token.node.classList.add("is-fleeing");
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

  /* -- timeline -------------------------------------------------------------- */

  // The engine owns pacing: every event carries an absolute `t`, so the stage
  // walks the event array rather than inventing a schedule of its own.
  function buildTimeline() {
    const times = scheduleEvents(script.events);
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
          case "command": log(translate(`battleCommand.${event.command}`)); break;
          case "round_start":
            log(translate("stage.round").replace("{n}", String(event.n)));
            breatheRound();
            break;
          case "strike": performStrike(event); break;
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
    const cues = [
      { at: 0, run: () => setPhase("deploy") },
      { at: P.DEPLOY_MS, run: () => { setPhase("standoff"); log(translate("stage.standoff")); } },
      {
        at: P.DEPLOY_MS + P.STANDOFF_MS,
        run: () => {
          setPhase("charge");
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
    script = normalizeScript(rawScript);
    doneCallback = onDone || null;
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
    cancelAnimationFrame(rafId);
    window.clearTimeout(pressTimer);
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
    document.body.classList.remove("battle-stage-open");
  }

  return {
    play,
    skip,
    dispose,
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
    get speed() { return speed; }
  };
}

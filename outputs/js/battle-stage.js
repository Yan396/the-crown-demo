import { stampSeal } from "./seal.js";

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

const TIMING = Object.freeze({
  HIT_PAUSE: 60,        // full-stage freeze on impact
  ROUT_SLOWMO: 300,
  LONG_PRESS: 600,
  ARROW_FLIGHT: 620
});

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
        capacity: Math.max(0, Math.min(weight, total - token.idx * weight)),
        node: null
      }))
    };
  });
  return {
    battleId: raw.battleId,
    terrain: raw.terrain,
    sides,
    events: raw.events.slice().sort((first, second) => first.t - second.t)
  };
}

export function survivorsOf(side) {
  return side.tokens.reduce((sum, token) => sum + token.capacity, 0);
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

const FIGURES = {
  militia: militiaFigure,
  veteran: veteranFigure,
  bandit: banditFigure
};

function figureSvg(troopType) {
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
      '<div class="stage-tally" hidden></div>' +
      "</div>";
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
  }

  function spawnSide(sideKey) {
    const side = script.sides[sideKey];
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

    side.tokens.forEach((token, index) => {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const node = document.createElement("i");
      node.className = `stage-token unit-${token.troopType || "militia"}`;
      node.innerHTML = figureSvg(token.troopType);
      const jx = (roll() - 0.5) * 14;
      const jy = (roll() - 0.5) * 10;
      const scale = 1 + (rows - 1 - row) * 0.12;
      node.style.setProperty("--tx", `${(column * spacing + row * spacing * 0.4) * dir + jx}px`);
      node.style.setProperty("--ty", `${row * -42 + jy}px`);
      node.style.setProperty("--tscale", scale.toFixed(2));
      node.style.setProperty("--sway", `${(1.6 + roll() * 1.2).toFixed(2)}s`);
      rankHost.appendChild(node);
      token.node = node;
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

  function syncCounts() {
    if (!countNodes.player) return;
    countNodes.player.textContent = String(survivorsOf(script.sides.player));
    countNodes.enemy.textContent = String(survivorsOf(script.sides.enemy));
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

    if (event.kill) {
      const emptied = applyKill(event);
      paintStain(point.x, point.y, true);
      if (emptied) {
        target.node.classList.add("is-dead");
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
    syncCounts();
  }

  function performMorale(event) {
    const ranks = root.querySelector(`.stage-ranks-${event.side}`);
    if (ranks) ranks.classList.toggle("is-wavering", event.level === "wavering");
  }

  function performRout(event) {
    log(translate("stage.rout"));
    root.classList.add("is-slowmo");
    pending.push(window.setTimeout(() => {
      if (!root) return;
      root.classList.remove("is-slowmo");
      script.sides[event.side].tokens.forEach((token) => {
        if (!token.node || token.capacity <= 0) return;
        token.node.style.setProperty("--flee-dur", `${Math.round(700 + roll() * 700)}ms`);
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
    timeline = script.events.map((event) => ({
      at: event.t,
      run: () => {
        switch (event.type) {
          case "battle_start":
            root.classList.add("is-entering");
            log(translate("stage.march"));
            pending.push(window.setTimeout(() => root && root.classList.remove("is-entering"), 600));
            break;
          case "volley": performVolley(event); break;
          case "round_start":
            worldNode.style.setProperty("--zoom", (1 + Math.min(0.15, event.n * 0.03)).toFixed(3));
            log(translate("stage.round").replace("{n}", String(event.n)));
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
    cursor = 0;
  }

  /* -- settlement ------------------------------------------------------------ */

  function showSettlement(event, skipped) {
    if (!root) return;
    playing = false;
    endEvent = event;
    syncCounts();

    const won = event.winner === "player";
    stampSeal(translate(won ? "map.victorySeal" : "map.defeatSeal"), won ? {} : { tone: "loss" });

    const tally = root.querySelector(".stage-tally");
    tally.hidden = false;
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
        const start = performance.now() + index * 350;
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
    if (now > frozenUntilReal) virtualTime += (now - lastReal) * speed;
    lastReal = now;
    while (cursor < timeline.length && timeline[cursor].at <= virtualTime) {
      timeline[cursor].run();
      cursor += 1;
    }
    if (cursor < timeline.length && playing) rafId = requestAnimationFrame(tick);
  }

  /* -- controls --------------------------------------------------------------- */

  function onPressStart(event) {
    if (event.target.closest(".stage-continue")) return;
    pressFired = false;
    pressTimer = window.setTimeout(() => { pressFired = true; skip(); }, TIMING.LONG_PRESS);
  }

  function onPressEnd() {
    window.clearTimeout(pressTimer);
    if (pressFired || !playing) return;
    speed = speed === 1 ? 2 : 1;
    root.classList.toggle("is-fast", speed === 2);
    if (options.onSpeedChange) options.onSpeedChange(speed);
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
    document.body.classList.add("battle-stage-open");
    const names = root.querySelectorAll(".plate-name");
    countNodes = {
      player: root.querySelectorAll(".plate-count")[0],
      enemy: root.querySelectorAll(".plate-count")[1]
    };
    names[0].textContent = script.sides.player.label;
    names[1].textContent = script.sides.enemy.label;
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
    speed = 1;
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
      return script
        ? { player: survivorsOf(script.sides.player), enemy: survivorsOf(script.sides.enemy) }
        : null;
    },
    get endEvent() { return endEvent; }
  };
}

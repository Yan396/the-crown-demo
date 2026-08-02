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

function figureSvg() {
  // Same brush vocabulary as the map figures: head, spine, legs, one arm.
  return (
    '<svg viewBox="0 0 24 30" aria-hidden="true" focusable="false">' +
    '<circle cx="12" cy="5" r="2.6" fill="currentColor"/>' +
    '<path d="M12 8v9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
    '<path d="M12 17l-4 9M12 17l4 9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" fill="none"/>' +
    '<path class="arm" d="M12 10.5l7 3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>' +
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
      node.className = "stage-token";
      node.innerHTML = figureSvg();
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
    if (script.terrain === "town") root.querySelector(".stage-wall").hidden = false;

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

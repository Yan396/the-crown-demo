import { stampSeal } from "./seal.js";

/*
 * Battle cinematics — a full-screen paper stage that PLAYS a battleScript.
 *
 * This module renders only. It never resolves combat: every number it shows
 * (damage, kills, loot) is read from the script it is handed, which is why the
 * skip path and the watched path cannot disagree — both are projections of the
 * same array of events.
 *
 * CONTRACT NOTE (important): the shared battleScript EVENT CONTRACT was not in
 * the repo when this was built (the brief's schema paste was an empty
 * placeholder). Everything downstream consumes the internal form produced by
 * normalizeScript() below, so when the real schema lands, reconciling means
 * editing ONE function. The internal form is documented at normalizeScript.
 *
 * Performance: tokens are DOM nodes animated with transform/opacity only; the
 * ink-stain layer is a separate canvas that accumulates (painted on kill,
 * never redrawn per frame); the whole stage subtree is created on play() and
 * discarded on dispose().
 */

// Module scope must stay import-safe outside a browser: the test suite imports
// every production module in Node to smoke them.
const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

const TIMING = Object.freeze({
  FADE_IN: 400,
  ENTRANCE: 600,
  STANDOFF: 400,
  BEAT: 360,            // gap between the three beats of a round
  ROUND_GAP: 420,       // breath between rounds
  HIT_STAGGER_MIN: 40,  // simultaneous hits land as ragged volleys, not a table
  HIT_STAGGER_MAX: 80,
  HIT_PAUSE: 60,        // full-stage freeze on impact
  VOLLEY: 700,
  ROUT_SLOWMO: 300,
  ROUT_FLEE: 900,
  CHEER: 500,
  LONG_PRESS: 600
});

const STAGE_MAX_TOKENS = 21; // per side; beyond this ranks read as mush

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
 * The single reconciliation point with the other agent's battleScript.
 *
 * Internal form:
 * {
 *   attacker: { name, count },     defender: { name, count },
 *   terrain: "field" | "town",     result: "attacker" | "defender",
 *   loot: { gold, renown },
 *   rounds: [ { volley?: true, strikes: [
 *     { beat: 0|1|2, side: "attacker"|"defender", hits: [ { damage, kill } ] }
 *   ] } ],
 *   routSide: "attacker" | "defender"
 * }
 *
 * Accepts either that form directly or a flat event list ({type: ...} items,
 * per the brief's event names) and folds the latter into rounds.
 */
export function normalizeScript(raw) {
  if (raw.rounds) return raw;
  const script = {
    attacker: raw.meta?.attacker ?? raw.attacker,
    defender: raw.meta?.defender ?? raw.defender,
    terrain: raw.meta?.terrain ?? raw.terrain ?? "field",
    result: raw.meta?.result ?? raw.result,
    loot: raw.meta?.loot ?? raw.loot ?? { gold: 0, renown: 0 },
    rounds: [],
    routSide: null
  };
  let current = null;
  (raw.events || []).forEach((event) => {
    switch (event.type) {
      case "round_start":
        current = { strikes: [] };
        script.rounds.push(current);
        break;
      case "volley":
        if (!current) { current = { strikes: [] }; script.rounds.push(current); }
        current.volley = true;
        break;
      case "strike":
        if (!current) { current = { strikes: [] }; script.rounds.push(current); }
        current.strikes.push({ beat: event.beat ?? 0, side: event.side, hits: event.hits || [] });
        break;
      case "rout":
        script.routSide = event.side;
        break;
      default:
        break; // battle_start / morale / battle_end need no folding
    }
  });
  if (!script.routSide) script.routSide = script.result === "attacker" ? "defender" : "attacker";
  return script;
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
  let stainCanvas = null;
  let stainContext = null;
  let tokens = { attacker: [], defender: [] };
  let counts = { attacker: 0, defender: 0 };
  let countNodes = {};
  let logNode = null;
  let worldNode = null;
  let rafId = 0;
  let virtualTime = 0;
  let lastReal = 0;
  let speed = 1;
  let frozenUntilReal = 0;
  let timeline = [];
  let cursor = 0;
  let playing = false;
  let script = null;
  let doneCallback = null;
  let pressTimer = 0;
  let pressFired = false;
  let roll = seededRandom(1);

  /* -- construction -------------------------------------------------------- */

  function buildDom() {
    root = document.createElement("section");
    root.id = "battle-stage";
    root.className = "battle-stage";
    root.innerHTML =
      '<div class="stage-paper">' +
      // Source order IS grid order: plates take the first auto row, the world
      // takes the 1fr row (it must have height for the ranks to sit on), the
      // dispatch line takes the last auto row.
      '<header class="stage-plates">' +
      '<div class="stage-plate"><b class="plate-name"></b><span class="plate-count"></span></div>' +
      '<div class="stage-plate"><b class="plate-name"></b><span class="plate-count"></span></div>' +
      "</header>" +
      '<div class="stage-world">' +
      '<canvas class="stage-stains"></canvas>' +
      '<div class="stage-wall" hidden>' + crenellationSvg() + "</div>" +
      '<div class="stage-ranks stage-ranks-attacker"></div>' +
      '<div class="stage-ranks stage-ranks-defender"></div>' +
      "</div>" +
      '<p class="stage-log" aria-live="polite"></p>' +
      '<p class="stage-hint" hidden></p>' +
      '<div class="stage-tally" hidden></div>' +
      "</div>";
    host.appendChild(root);
    worldNode = root.querySelector(".stage-world");
    stainCanvas = root.querySelector(".stage-stains");
    logNode = root.querySelector(".stage-log");

    // Size the stain canvas from the laid-out world box.
    const rect = worldNode.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    stainCanvas.width = Math.max(1, Math.round(rect.width * dpr));
    stainCanvas.height = Math.max(1, Math.round(rect.height * dpr));
    stainContext = stainCanvas.getContext("2d");
    stainContext.scale(dpr, dpr);

    root.addEventListener("pointerdown", onPressStart);
    root.addEventListener("pointerup", onPressEnd);
    root.addEventListener("pointercancel", onPressCancel);
  }

  function spawnSide(side, info, facing) {
    const rankHost = root.querySelector(side === "attacker" ? ".stage-ranks-attacker" : ".stage-ranks-defender");
    const shown = Math.min(info.count, STAGE_MAX_TOKENS);
    // Each side gets ~42% of the stage width. Choose the rank depth that fits
    // that budget rather than a fixed one, or the two armies interpenetrate on
    // a phone.
    const halfWidth = Math.max(120, worldNode.clientWidth * 0.42);
    const spacing = Math.max(21, Math.min(40, halfWidth / 7));
    const maxPerRow = Math.max(3, Math.floor(halfWidth / spacing));
    const rows = Math.min(3, Math.max(1, Math.ceil(shown / maxPerRow)));
    const perRow = Math.ceil(shown / rows);
    for (let index = 0; index < shown; index += 1) {
      const row = Math.floor(index / perRow);
      const column = index % perRow;
      const token = document.createElement("i");
      token.className = "stage-token";
      token.innerHTML = figureSvg();
      // Loose array, not a line: jitter every slot; the front row is slightly
      // larger for cheap perspective.
      const jx = (roll() - 0.5) * 14;
      const dir = side === "attacker" ? 1 : -1;
      const jy = (roll() - 0.5) * 10;
      const scale = 1 + (rows - 1 - row) * 0.12;
      token.style.setProperty("--tx", `${(column * spacing + row * spacing * 0.4) * dir + jx}px`);
      token.style.setProperty("--ty", `${row * -42 + jy}px`);
      token.style.setProperty("--tscale", scale.toFixed(2));
      token.style.setProperty("--facing", facing);
      token.style.setProperty("--sway", `${(1.6 + roll() * 1.2).toFixed(2)}s`);
      rankHost.appendChild(token);
      tokens[side].push(token);
    }
  }

  function alive(side) {
    return tokens[side].filter((t) => !t.classList.contains("is-dead"));
  }

  function setCount(side, value) {
    counts[side] = Math.max(0, value);
    countNodes[side].textContent = String(counts[side]);
  }

  /* -- ink ------------------------------------------------------------------ */

  function paintStain(x, y, big) {
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

  function tokenStagePoint(token) {
    const stage = worldNode.getBoundingClientRect();
    const r = token.getBoundingClientRect();
    return { x: r.left - stage.left + r.width / 2, y: r.top - stage.top + r.height * 0.85 };
  }

  /* -- flourishes ----------------------------------------------------------- */

  function burst(x, y) {
    const node = document.createElement("i");
    node.className = "stage-burst";
    node.style.left = `${x}px`;
    node.style.top = `${y}px`;
    worldNode.appendChild(node);
    window.setTimeout(() => node.remove(), 450);
  }

  function damageNumber(x, y, amount, kill) {
    const node = document.createElement("b");
    node.className = "stage-damage" + (kill ? " is-kill" : "");
    node.textContent = `-${amount}`;
    node.style.left = `${x}px`;
    node.style.top = `${y - 30}px`;
    worldNode.appendChild(node);
    window.setTimeout(() => node.remove(), 750);
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
    logNode.textContent = text;
  }

  /* -- timeline ------------------------------------------------------------- */

  // Build [{at, run}] once per script; the loop just walks it. Skip = execute
  // every remaining entry's data effect without its animation.
  function buildTimeline() {
    const line = [];
    let at = 0;
    const push = (delay, run, dataRun) => {
      at += delay;
      line.push({ at, run, dataRun: dataRun || run });
    };

    push(0, () => {
      root.classList.add("is-entering");
      log(translate("stage.march"));
    }, () => {});
    push(TIMING.ENTRANCE, () => root.classList.remove("is-entering"), () => {});
    push(TIMING.STANDOFF, () => log(translate("stage.standoff")), () => {});

    script.rounds.forEach((round, roundIndex) => {
      // Virtual camera: a slow push-in across the whole battle.
      const zoom = 1 + Math.min(0.15, (roundIndex + 1) / script.rounds.length * 0.15);
      push(TIMING.ROUND_GAP, () => {
        worldNode.style.setProperty("--zoom", zoom.toFixed(3));
        log(translate("stage.round").replace("{n}", String(roundIndex + 1)));
      }, () => {});

      if (round.volley) {
        push(200, () => playVolley(), () => {});
        push(TIMING.VOLLEY, () => {}, () => {});
      }

      const byBeat = [[], [], []];
      round.strikes.forEach((strike) => byBeat[Math.min(2, strike.beat)].push(strike));
      byBeat.forEach((beatStrikes) => {
        if (!beatStrikes.length) return;
        push(TIMING.BEAT, () => beatStrikes.forEach((s, i) => playStrike(s, i)), () => beatStrikes.forEach(applyStrikeData));
      });
    });

    push(TIMING.ROUND_GAP, () => playRout(), () => applyRoutData());
    push(TIMING.ROUT_SLOWMO + TIMING.ROUT_FLEE + TIMING.CHEER, () => showSettlement(false), () => {});
    timeline = line;
    cursor = 0;
  }

  /* -- event performances --------------------------------------------------- */

  function playVolley() {
    log(translate("stage.volley"));
    const targets = alive("attacker");
    const count = 2 + Math.round(roll());
    for (let index = 0; index < count; index += 1) {
      const arrow = document.createElement("i");
      arrow.className = "stage-arrow";
      const fromX = worldNode.clientWidth * (0.68 + roll() * 0.18);
      const target = targets[Math.floor(roll() * targets.length)];
      const to = target ? tokenStagePoint(target) : { x: worldNode.clientWidth * 0.25, y: worldNode.clientHeight * 0.62 };
      arrow.style.setProperty("--from-x", `${fromX}px`);
      arrow.style.setProperty("--to-x", `${to.x + (roll() - 0.5) * 26}px`);
      arrow.style.setProperty("--to-y", `${to.y}px`);
      arrow.style.setProperty("--delay", `${Math.round(roll() * 160)}ms`);
      worldNode.appendChild(arrow);
      window.setTimeout(() => {
        paintStain(to.x, to.y, false);
        arrow.remove();
      }, TIMING.VOLLEY - 60 + Math.round(roll() * 120));
    }
  }

  function applyStrikeData(strike) {
    const targetSide = strike.side === "attacker" ? "defender" : "attacker";
    strike.hits.forEach((hit) => {
      if (!hit.kill) return;
      const pool = alive(targetSide);
      const token = pool[pool.length - 1];
      if (token) token.classList.add("is-dead");
      setCount(targetSide, counts[targetSide] - 1);
    });
  }

  function playStrike(strike, beatOffsetIndex) {
    const sourceSide = strike.side;
    const targetSide = sourceSide === "attacker" ? "defender" : "attacker";
    const attackers = alive(sourceSide);
    const kills = strike.hits.filter((h) => h.kill).length;

    // The striking rank lunges together.
    attackers.slice(0, 6).forEach((token) => {
      token.classList.remove("is-striking");
      void token.offsetWidth;
      token.classList.add("is-striking");
    });

    strike.hits.forEach((hit, hitIndex) => {
      // Ragged, not simultaneous: each hit lands 40-80ms after the last.
      const lag = beatOffsetIndex * 90 + hitIndex *
        (TIMING.HIT_STAGGER_MIN + roll() * (TIMING.HIT_STAGGER_MAX - TIMING.HIT_STAGGER_MIN));
      window.setTimeout(() => {
        if (!root) return;
        const pool = alive(targetSide);
        const token = pool.length ? pool[Math.min(pool.length - 1, Math.floor(roll() * pool.length))] : null;
        if (!token) return;
        // 60ms hit-pause: the whole stage freezes on impact.
        frozenUntilReal = performance.now() + TIMING.HIT_PAUSE;
        root.classList.add("is-hit-paused");
        window.setTimeout(() => root && root.classList.remove("is-hit-paused"), TIMING.HIT_PAUSE);

        const point = tokenStagePoint(token);
        burst(point.x, point.y - 16);
        damageNumber(point.x, point.y, hit.damage, hit.kill);
        if (hit.kill) {
          token.classList.add("is-dead");
          paintStain(point.x, point.y, true);
          if (roll() < 0.15) fallenBanner(point.x, point.y);
          setCount(targetSide, counts[targetSide] - 1);
        } else {
          token.classList.remove("is-reeling");
          void token.offsetWidth;
          token.classList.add("is-reeling");
        }
      }, lag);
    });

    if (kills >= 2) shake(Math.min(10, 4 + kills * 2));
    if (counts[targetSide] - kills <= Math.ceil(tokens[targetSide].length * 0.4)) {
      root.querySelector(`.stage-ranks-${targetSide}`).classList.add("is-wavering");
    }
  }

  function applyRoutData() {
    // Counts are already applied strike by strike; nothing extra to settle.
  }

  function playRout() {
    const loser = script.routSide;
    const winner = loser === "attacker" ? "defender" : "attacker";
    log(translate("stage.rout"));
    // The last blow in slow motion, then the field breaks.
    root.classList.add("is-slowmo");
    window.setTimeout(() => {
      if (!root) return;
      root.classList.remove("is-slowmo");
      alive(loser).forEach((token) => {
        token.style.setProperty("--flee-dur", `${Math.round(TIMING.ROUT_FLEE * (0.7 + roll() * 0.6))}ms`);
        token.style.setProperty("--flee-drift", `${Math.round((roll() - 0.5) * 60)}px`);
        token.classList.add("is-fleeing");
      });
      alive(winner).forEach((token) => token.classList.add("is-cheering"));
    }, TIMING.ROUT_SLOWMO);
  }

  /* -- settlement ----------------------------------------------------------- */

  function showSettlement(skipped) {
    if (!root) return;
    playing = false;
    const tally = root.querySelector(".stage-tally");
    const won = script.result === "attacker";
    stampSeal(translate(won ? "map.victorySeal" : "map.defeatSeal"), won ? {} : { tone: "loss" });

    tally.hidden = false;
    tally.innerHTML =
      `<dl><div><dt>${translate("stage.tallyGold")}</dt><dd data-target="${script.loot.gold}">0</dd></div>` +
      `<div><dt>${translate("stage.tallyRenown")}</dt><dd data-target="${script.loot.renown}">0</dd></div></dl>` +
      `<button type="button" class="stage-continue">${translate("stage.continue")}</button>`;

    const numbers = [...tally.querySelectorAll("dd")];
    if (reducedMotion.matches || skipped) {
      numbers.forEach((n) => { n.textContent = n.dataset.target; });
    } else {
      // Tick-up, one item after the other.
      numbers.forEach((node, index) => {
        const target = Number(node.dataset.target);
        const start = performance.now() + index * 350;
        const step = (now) => {
          if (!root) return;
          const t = Math.min(1, (now - start) / 500);
          if (t > 0) node.textContent = String(Math.round(target * t));
          if (t < 1) requestAnimationFrame(step);
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

  /* -- clock ---------------------------------------------------------------- */

  function tick(now) {
    if (!playing) return;
    if (now > frozenUntilReal) {
      virtualTime += (now - lastReal) * speed;
    }
    lastReal = now;
    while (cursor < timeline.length && timeline[cursor].at <= virtualTime) {
      timeline[cursor].run();
      cursor += 1;
    }
    if (cursor < timeline.length) rafId = requestAnimationFrame(tick);
  }

  /* -- controls ------------------------------------------------------------- */

  function onPressStart(event) {
    if (event.target.closest(".stage-continue")) return;
    pressFired = false;
    pressTimer = window.setTimeout(() => {
      pressFired = true;
      skip();
    }, TIMING.LONG_PRESS);
  }

  function onPressEnd() {
    window.clearTimeout(pressTimer);
    if (pressFired || !playing) return;
    speed = speed === 1 ? 2 : 1;
    root.classList.toggle("is-fast", speed === 2);
  }

  function onPressCancel() {
    window.clearTimeout(pressTimer);
  }

  function skip() {
    if (!playing) return;
    playing = false;
    cancelAnimationFrame(rafId);
    // Apply the DATA of everything not yet played — same script, no theatre —
    // so a skipped battle settles identically to a watched one.
    for (; cursor < timeline.length; cursor += 1) timeline[cursor].dataRun();
    root.classList.add("is-skipped");
    showSettlement(true);
  }

  /* -- public --------------------------------------------------------------- */

  function play(rawScript, onDone) {
    dispose();
    script = normalizeScript(rawScript);
    doneCallback = onDone || null;
    roll = seededRandom((script.attacker.count * 73856093) ^ (script.defender.count * 19349663));

    buildDom();
    document.body.classList.add("battle-stage-open");
    countNodes = {
      attacker: root.querySelectorAll(".plate-count")[0],
      defender: root.querySelectorAll(".plate-count")[1]
    };
    const names = root.querySelectorAll(".plate-name");
    names[0].textContent = script.attacker.name;
    names[1].textContent = script.defender.name;
    setCount("attacker", script.attacker.count);
    setCount("defender", script.defender.count);
    if (script.terrain === "town") root.querySelector(".stage-wall").hidden = false;

    spawnSide("attacker", script.attacker, "1");
    spawnSide("defender", script.defender, "-1");

    if (reducedMotion.matches) {
      // No performance at all: settle immediately from the same data.
      buildTimeline();
      for (; cursor < timeline.length; cursor += 1) timeline[cursor].dataRun();
      showSettlement(true);
      return;
    }

    if (!hintSeen()) {
      const hint = root.querySelector(".stage-hint");
      hint.hidden = false;
      hint.textContent = translate("stage.hint");
      window.setTimeout(() => { if (root) hint.hidden = true; }, 3600);
      persistHint();
    }

    buildTimeline();
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
    if (root) {
      root.remove();
      root = null;
    }
    document.body.classList.remove("battle-stage-open");
    tokens = { attacker: [], defender: [] };
    counts = { attacker: 0, defender: 0 };
    timeline = [];
    cursor = 0;
  }

  return { play, skip, dispose, get playing() { return playing; }, get counts() { return { ...counts }; } };
}

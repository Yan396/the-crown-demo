import { TOKENS } from "./data.js";
import { getTroopCount } from "./state.js";

/*
 * Battle presentation.
 *
 * Pure theatre. It reads `state.battle` and the two parties' troop counts and
 * draws what the existing formulas already decided — it never resolves a round,
 * never touches CONFIG, and never draws from `state.rng`. Turning this file off
 * changes nothing about who wins.
 *
 * The one piece of memory it keeps is the ink left on the paper: casualties
 * dissolve into stains that stay for the rest of the engagement, so a long
 * battle visibly dirties its own ground. That lives here, not in `state`, so
 * the save format is untouched.
 */

const VIEW = Object.freeze({
  STRIP_HEIGHT: 132,
  RANK_WIDTH: 6,          // figures per row
  MAX_FIGURES: 18,        // beyond this the ranks read as mush
  FIGURE_HEIGHT: 17,
  LUNGE_MS: 200,
  FLOAT_MS: 700,
  ROUT_FRACTION: 0.5      // below this a side switches to the retreating pose
});

const reducedMotion = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

function motionOff() {
  return reducedMotion.matches;
}

function colorWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  return `rgba(${parseInt(value.slice(0, 2), 16)}, ${parseInt(value.slice(2, 4), 16)}, ${parseInt(value.slice(4, 6), 16)}, ${alpha})`;
}

function blotRandom(seed) {
  let value = (seed ^ 0x51ed270b) >>> 0;
  return function nextRandom() {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/* -- an ink figure, three poses ------------------------------------------- */
// Brush strokes, not a sprite: head dot, spine, legs, one arm. `facing` is +1
// for a figure looking right, -1 for left.
function drawFigure(g, x, y, height, facing, pose, alpha) {
  const head = height * 0.22;
  const hipY = y - height * 0.42;
  const shoulderY = y - height * 0.72;
  const lean = pose === "charge" ? facing * height * 0.16 : (pose === "retreat" ? -facing * height * 0.1 : 0);

  g.save();
  g.strokeStyle = colorWithAlpha(TOKENS.ink, alpha);
  g.fillStyle = colorWithAlpha(TOKENS.ink, alpha);
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = Math.max(1.2, height * 0.115);

  // Head.
  g.beginPath();
  g.arc(x + lean, shoulderY - head * 0.72, head * 0.5, 0, Math.PI * 2);
  g.fill();

  // Spine.
  g.beginPath();
  g.moveTo(x + lean, shoulderY - head * 0.2);
  g.lineTo(x + lean * 0.4, hipY);
  g.stroke();

  // Legs: a charging figure strides, a retreating one back-steps.
  const stride = pose === "stand" ? height * 0.16 : height * 0.26;
  g.beginPath();
  g.moveTo(x + lean * 0.4, hipY);
  g.lineTo(x - stride * 0.6 + lean * 0.4, y);
  g.moveTo(x + lean * 0.4, hipY);
  g.lineTo(x + stride * 0.6 + lean * 0.4, y);
  g.stroke();

  // Arm and weapon.
  const armY = shoulderY + height * 0.06;
  const reach = pose === "charge" ? height * 0.5 : height * 0.32;
  g.beginPath();
  g.moveTo(x + lean, armY);
  if (pose === "retreat") {
    // Weapon trailing, body turned away.
    g.lineTo(x - facing * reach * 0.8, armY + height * 0.2);
  } else if (pose === "charge") {
    // Levelled, driving forward.
    g.lineTo(x + lean + facing * reach, armY + height * 0.02);
  } else {
    // At the ready: angled DOWN and forward. Pointing it up reads as surrender.
    g.lineTo(x + lean + facing * reach, armY + height * 0.17);
  }
  g.stroke();
  g.restore();
}

/* -- the view -------------------------------------------------------------- */

export function createBattlefield() {
  let key = null;          // identifies the current engagement
  let lastRound = -1;
  let roundAt = 0;         // timestamp of the last round transition
  let attacker = 1;        // which side lunged most recently
  let stains = [];         // persist for the whole engagement
  let floaters = [];

  function reset(newKey) {
    key = newKey;
    lastRound = -1;
    roundAt = 0;
    stains = [];
    floaters = [];
  }

  function noteRound(battle, now, geometry) {
    const roll = blotRandom((battle.round * 2654435761) ^ battle.playerStart);
    // Casualties this round, per side.
    const playerLoss = battle.playerCasualties - (noteRound.lastPlayer ?? 0);
    const banditLoss = battle.banditCasualties - (noteRound.lastBandit ?? 0);
    noteRound.lastPlayer = battle.playerCasualties;
    noteRound.lastBandit = battle.banditCasualties;

    const spill = (side, count) => {
      for (let index = 0; index < count && stains.length < 90; index += 1) {
        stains.push({
          x: side === "player" ? geometry.leftX + roll() * geometry.halfWidth * 0.8
            : geometry.rightX - roll() * geometry.halfWidth * 0.8,
          y: geometry.baseY - roll() * VIEW.STRIP_HEIGHT * 0.42,
          r: 2.4 + roll() * 4.6,
          a: 0.16 + roll() * 0.2
        });
      }
    };
    spill("player", playerLoss);
    spill("bandit", banditLoss);

    if (playerLoss > 0) {
      floaters.push({ side: -1, text: `-${playerLoss}`, at: now });
    }
    if (banditLoss > 0) {
      floaters.push({ side: 1, text: `-${banditLoss}`, at: now });
    }
    attacker = banditLoss >= playerLoss ? 1 : -1;
  }

  function drawRank(g, count, total, centreX, baseY, facing, pose, lungeOffset) {
    const shown = Math.min(count, VIEW.MAX_FIGURES);
    const rows = Math.ceil(shown / VIEW.RANK_WIDTH) || 1;
    const spacing = 15;
    for (let index = 0; index < shown; index += 1) {
      const row = Math.floor(index / VIEW.RANK_WIDTH);
      const column = index % VIEW.RANK_WIDTH;
      const inRow = Math.min(VIEW.RANK_WIDTH, shown - row * VIEW.RANK_WIDTH);
      const x = centreX + (column - (inRow - 1) / 2) * spacing * facing;
      // Row 0 is the front rank, standing on the ground line.
      const y = baseY - row * 13;
      const offset = row === 0 ? lungeOffset : lungeOffset * 0.3;
      const depth = 0.9 - row * 0.22;
      drawFigure(g, x + offset, y, VIEW.FIGURE_HEIGHT, facing, pose, Math.max(0.4, depth));
    }
    return shown;
  }

  function draw(g, state, now, viewportWidth, viewportHeight, language, translate) {
    const battle = state.battle;
    if (!battle) {
      if (key !== null) reset(null);
      return;
    }

    const bandit = state.bandits.find((entry) => entry.id === battle.banditId);
    if (!bandit) return;

    const engagementKey = `${battle.banditId}:${battle.playerStart}:${battle.banditStart}`;
    if (engagementKey !== key) {
      reset(engagementKey);
      noteRound.lastPlayer = 0;
      noteRound.lastBandit = 0;
    }

    const stripTop = viewportHeight * 0.34;
    const baseY = stripTop + VIEW.STRIP_HEIGHT * 0.72;
    const margin = Math.min(26, viewportWidth * 0.06);
    const left = margin;
    const width = viewportWidth - margin * 2;
    const geometry = {
      leftX: left + width * 0.26,
      rightX: left + width * 0.74,
      halfWidth: width * 0.22,
      baseY
    };

    if (battle.round !== lastRound) {
      lastRound = battle.round;
      roundAt = now;
      if (battle.round > 0) noteRound(battle, now, geometry);
    }

    const sinceRound = now - roundAt;
    const lungeT = motionOff() ? 0 : Math.max(0, 1 - sinceRound / VIEW.LUNGE_MS);
    // ease-out-back on the way in, so the charge has weight.
    const lunge = lungeT > 0 ? Math.sin(lungeT * Math.PI) * 6 : 0;

    g.save();

    // Paper strip.
    g.fillStyle = colorWithAlpha(TOKENS.paper, 0.93);
    g.fillRect(left, stripTop, width, VIEW.STRIP_HEIGHT);
    g.strokeStyle = colorWithAlpha(TOKENS.ink, 0.28);
    g.lineWidth = 1;
    g.strokeRect(left + 0.5, stripTop + 0.5, width - 1, VIEW.STRIP_HEIGHT - 1);

    // Ground line.
    g.strokeStyle = colorWithAlpha(TOKENS.ink, 0.34);
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(left + 14, baseY + 3);
    g.lineTo(left + width - 14, baseY + 3);
    g.stroke();

    // The dead, already soaked into the paper.
    stains.forEach((stain) => {
      g.fillStyle = colorWithAlpha(TOKENS.ink, stain.a);
      g.beginPath();
      g.arc(stain.x, stain.y, stain.r, 0, Math.PI * 2);
      g.fill();
    });

    const playerCount = getTroopCount(state.player);
    const banditCount = getTroopCount(bandit);
    const playerPose = playerCount / Math.max(1, battle.playerStart) < VIEW.ROUT_FRACTION ? "retreat" : (attacker === 1 && lunge > 0 ? "charge" : "stand");
    const banditPose = banditCount / Math.max(1, battle.banditStart) < VIEW.ROUT_FRACTION ? "retreat" : (attacker === -1 && lunge > 0 ? "charge" : "stand");

    drawRank(g, playerCount, battle.playerStart, geometry.leftX, baseY, 1, playerPose, attacker === 1 ? lunge : 0);
    drawRank(g, banditCount, battle.banditStart, geometry.rightX, baseY, -1, banditPose, attacker === -1 ? -lunge : 0);

    // Counts, in the display face.
    g.font = `700 13px ${TOKENS.fontDisplay}`;
    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = colorWithAlpha(TOKENS.ink, 0.86);
    g.fillText(String(playerCount), geometry.leftX, stripTop + 8);
    g.fillText(String(banditCount), geometry.rightX, stripTop + 8);
    g.font = `600 10px ${TOKENS.fontBody}`;
    g.fillStyle = colorWithAlpha(TOKENS.ink, 0.5);
    g.fillText(translate(language, "report.battle"), left + width / 2, stripTop + 9);

    // Damage numerals drift up and fade.
    floaters = floaters.filter((floater) => now - floater.at < VIEW.FLOAT_MS);
    if (!motionOff()) {
      floaters.forEach((floater) => {
        const t = (now - floater.at) / VIEW.FLOAT_MS;
        const x = floater.side === -1 ? geometry.leftX : geometry.rightX;
        g.font = `700 15px ${TOKENS.fontDisplay}`;
        g.fillStyle = colorWithAlpha(TOKENS.cinnabar, (1 - t) * 0.9);
        g.textBaseline = "alphabetic";
        g.fillText(floater.text, x, baseY - 26 - t * 24);
      });
    }
    g.restore();
  }

  return { draw };
}

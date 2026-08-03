import assert from "node:assert/strict";
import test from "node:test";

import { aggregateTokens, normalizeScript, survivorsOf } from "../outputs/js/battle-stage.js";
import { CONFIG_PRESENTATION as P } from "../outputs/js/presentation.js";

const sideOf = (n, arm) => ({
  label: "x", startTroops: n,
  tokens: Array.from({ length: n }, (_, i) => ({ idx: i, troopType: "militia", arm }))
});

function script(playerArm, enemyArm, n) {
  return {
    battleId: "f3", terrain: "field",
    sides: { player: sideOf(n, playerArm), enemy: sideOf(n, enemyArm) },
    events: [
      { t: 0, type: "battle_start" },
      { t: 1, type: "round_start", n: 1 },
      { t: 2, type: "strike", from: { side: "player", idx: 0 }, to: { side: "enemy", idx: 0 },
        kill: false, dmgShown: 1, beat: 0 },
      { t: 3, type: "battle_end", winner: "player",
        loot: { gold: 1, renown: 1 }, survivors: { player: n, enemy: n } }
    ]
  };
}

test("stage never draws more than the token cap per side", () => {
  for (const n of [4, 16, 24, 60]) {
    const s = normalizeScript(script("spear", "spear", Math.min(n, 24)));
    assert.ok(s.sides.player.tokens.length <= P.STAGE_TOKEN_CAP,
      `${n}: drew ${s.sides.player.tokens.length}`);
    assert.ok(s.sides.enemy.tokens.length <= P.STAGE_TOKEN_CAP);
  }
});

test("aggregation preserves capacity exactly — survivors cannot drift", () => {
  for (const n of [1, 7, 16, 17, 24]) {
    const raw = Array.from({ length: n }, (_, i) => ({
      idx: i, troopType: "militia", arm: "spear", capacity: 3, node: null
    }));
    const merged = aggregateTokens(raw);
    assert.ok(merged.length <= P.STAGE_TOKEN_CAP);
    assert.equal(
      merged.reduce((sum, t) => sum + t.capacity, 0),
      raw.reduce((sum, t) => sum + t.capacity, 0),
      `capacity drifted at n=${n}`
    );
  }
});

test("every engine bucket still resolves to a drawn token after aggregation", () => {
  const s = normalizeScript(script("spear", "spear", 24));
  const covered = new Set();
  s.sides.player.tokens.forEach((t) => t.covers.forEach((idx) => covered.add(idx)));
  for (let idx = 0; idx < 24; idx += 1) {
    assert.ok(covered.has(idx), `engine idx ${idx} lost its figure`);
  }
});

test("survivorsOf is unchanged by aggregation", () => {
  const s = normalizeScript(script("spear", "spear", 24));
  assert.equal(survivorsOf(s.sides.player), s.sides.player.startTroops);
  assert.equal(survivorsOf(s.sides.enemy), s.sides.enemy.startTroops);
});

test("arm survives normalisation, so archers and cavalry are addressable", () => {
  const s = normalizeScript(script("archer", "cavalry", 8));
  assert.equal(s.sides.player.tokens[0].arm, "archer");
  assert.equal(s.sides.enemy.tokens[0].arm, "cavalry");
});

test("motion constants keep cavalry ahead of, and heavier than, infantry", () => {
  assert.ok(P.CAVALRY_ADVANCE_MULTIPLIER > 1.5, "cavalry must cover real ground");
  assert.ok(P.CAVALRY_LEAD_MS > 0, "cavalry must arrive first");
  assert.ok(P.CAVALRY_HIT_PAUSE_MS > P.STRIKE_PAUSE_MS, "cavalry must land heavier");
  assert.ok(P.CAVALRY_KNOCKBACK_PX > P.INFANTRY_KNOCKBACK_PX);
  assert.ok(P.ARROW_LEAD_MS > 0, "arrows launch before their hit, never after");
  assert.ok(P.MAX_CONCURRENT_ACTORS <= 8, "too many actors at once is a blur");
  assert.equal(P.STAGE_TOKEN_CAP, 16);
});

test("pose holds are long enough to be read as frames", () => {
  for (const ms of [P.POSE_WINDUP_MS, P.POSE_CONTACT_MS, P.POSE_FOLLOW_MS]) {
    assert.ok(ms >= 100, `a ${ms}ms hold is too short to register`);
  }
});

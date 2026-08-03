import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { officerFigureFor, normalizeScript } from "../outputs/js/battle-stage.js";
import { isBattleScript } from "../outputs/js/state.js";
import { crownAudio, CrownAudio } from "../outputs/js/audio.js";

const IDS = ["chen_mang", "shen_wen", "jia_duojin"];

const side = (label) => ({
  label, startTroops: 4,
  tokens: Array.from({ length: 4 }, (_, i) => ({ idx: i, troopType: "militia" }))
});
const script = (extra = {}) => ({
  battleId: "rc", terrain: "field",
  sides: { player: side("我军"), enemy: side("匪队") },
  events: [
    { t: 0, type: "battle_start" },
    { t: 1, type: "round_start", n: 1 },
    { t: 2, type: "strike", from: { side: "player", idx: 0 }, to: { side: "enemy", idx: 0 },
      kill: true, dmgShown: 4, beat: 0 },
    { t: 3, type: "battle_end", winner: "player",
      loot: { gold: 1, renown: 1 }, survivors: { player: 4, enemy: 3 } }
  ],
  ...extra
});

/* ---- officers ----------------------------------------------------------- */

test("each officer draws a different silhouette", () => {
  const drawn = IDS.map((id) => {
    const draw = officerFigureFor(id);
    assert.equal(typeof draw, "function", `${id} has no figure`);
    return draw();
  });
  assert.equal(new Set(drawn).size, 3, "two officers share a silhouette");
  drawn.forEach((svg) => assert.ok(svg.length > 120, "figure too sparse to read at 26px"));
});

test("an unknown id falls back rather than throwing", () => {
  assert.equal(officerFigureFor("nobody"), null);
  assert.equal(officerFigureFor(undefined), null);
});

test("lieutenantIds is optional: old scripts still validate and fall back", () => {
  assert.equal(isBattleScript(script({ lieutenant: "player", lieutenantIds: IDS })), true);
  assert.equal(isBattleScript(script({ lieutenant: "player" })), true);
  assert.equal(isBattleScript(script({ lieutenant: "player", lieutenantIds: [1] })), false);
  assert.deepEqual(normalizeScript(script({ lieutenant: "player" })).lieutenantIds, []);
  assert.deepEqual(
    normalizeScript(script({ lieutenant: "player", lieutenantIds: IDS })).lieutenantIds, IDS
  );
});

test("officer metadata cannot move capacity or survivors", () => {
  const plain = normalizeScript(script({ lieutenant: "player" }));
  const named = normalizeScript(script({ lieutenant: "player", lieutenantIds: IDS }));
  const cap = (s) => s.sides.player.tokens.reduce((sum, t) => sum + t.capacity, 0);
  assert.equal(cap(plain), cap(named));
  assert.equal(plain.sides.player.startTroops, named.sides.player.startTroops);
});

/* ---- audio wiring ------------------------------------------------------- */

test("the reconciled cues live on CrownAudio, not a second audio system", () => {
  ["arrow", "cavalry", "recruit", "tap", "charge", "hit", "seal", "rout"]
    .forEach((name) => assert.equal(typeof crownAudio[name], "function", `missing ${name}`));
  assert.equal(typeof CrownAudio, "function");
});

test("the real call paths fire their cue — not just the methods existing", () => {
  const stage = readFileSync("outputs/js/battle-stage.js", "utf8");
  const main = readFileSync("outputs/js/main.js", "utf8");
  // The cues still fire on the real paths; what changed is that they all hang
  // off the single beat hook instead of being sprinkled through the performers.
  assert.match(stage, /case "arrow": crownAudio\.arrow\(\); break;/, "arrows must sound");
  assert.match(
    stage,
    /if \(beat\.tier === "heavy"\) crownAudio\.cavalry\(\);/,
    "the heavy tier -- cavalry and officers -- needs its own impact"
  );
  assert.match(stage, /crownAudio\.hit\(\{ kill: Boolean\(beat\.kill\)/, "lighter contact keeps the existing hit");
  assert.match(stage, /emitBeat\(\{ type: "arrow"/, "arrow cues ride the shared clock");
  assert.match(main, /crownAudio\.recruit\(\)/, "a successful recruit must sound");
  assert.match(main, /crownAudio\.bindFirstGesture\(/, "audio arms on a real gesture");
});

test("muting creates no node, and the preference is not the save", () => {
  const source = readFileSync("outputs/js/audio.js", "utf8");
  crownAudio.setEnabled(false);
  assert.equal(crownAudio.arrow(), undefined);
  assert.equal(crownAudio.cavalry(), undefined);
  assert.equal(crownAudio.recruit(), undefined);
  crownAudio.setEnabled(true);
  assert.ok(!/SAVE_KEY|V11_SAVE_KEY|saveVersion/.test(source), "audio must not reach the save");
});

test("audio ships no files, opens no connections, and draws no unseeded randomness", () => {
  const source = readFileSync("outputs/js/audio.js", "utf8");
  assert.ok(!/new\s+Audio\b|<audio\b|\.(?:mp3|wav|ogg|m4a|aac|flac)\b/.test(source),
    "audio must be synthesised, never loaded");
  assert.ok(!/fetch\(|XMLHttpRequest|WebSocket/.test(source), "no network audio");
  assert.ok(!/Math\.random\s*\(/.test(source), "noise must not use unseeded randomness");
  assert.match(source, /createOscillator|createBuffer/);
});

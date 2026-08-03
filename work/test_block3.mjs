import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { officerFigureFor, normalizeScript } from "../outputs/js/battle-stage.js";
import { STRINGS } from "../outputs/js/strings.js";
import * as audio from "../outputs/js/audio.js";
import { isBattleScript } from "../outputs/js/state.js";

const IDS = ["chen_mang", "shen_wen", "jia_duojin"];

/* ---- A · three officers ------------------------------------------------- */

test("each officer draws a different figure", () => {
  const drawn = IDS.map((id) => {
    const draw = officerFigureFor(id);
    assert.equal(typeof draw, "function", `${id} has no figure`);
    return draw();
  });
  assert.equal(new Set(drawn).size, 3, "two officers share a silhouette");
  drawn.forEach((svg) => assert.ok(svg.length > 120, "figure is too sparse to read"));
});

test("an unknown or absent id falls back instead of throwing", () => {
  assert.equal(officerFigureFor("nobody"), null);
  assert.equal(officerFigureFor(undefined), null);
});

function script(extra = {}) {
  const side = (label) => ({
    label, startTroops: 4,
    tokens: Array.from({ length: 4 }, (_, i) => ({ idx: i, troopType: "militia" }))
  });
  return {
    battleId: "b3", terrain: "field",
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
  };
}

test("lieutenantIds ride the script and survive normalisation", () => {
  const s = normalizeScript(script({ lieutenant: "player", lieutenantIds: IDS }));
  assert.deepEqual(s.lieutenantIds, IDS);
});

test("a script without lieutenantIds still normalises — old scripts keep working", () => {
  const s = normalizeScript(script({ lieutenant: "player" }));
  assert.deepEqual(s.lieutenantIds, []);
});

test("the contract accepts lieutenantIds and rejects a malformed one", () => {
  assert.equal(isBattleScript(script({ lieutenant: "player", lieutenantIds: IDS })), true);
  assert.equal(isBattleScript(script({ lieutenant: "player" })), true, "optional, not required");
  assert.equal(isBattleScript(script({ lieutenant: "player", lieutenantIds: [1, 2] })), false);
});

/* ---- B · rules card ----------------------------------------------------- */

test("rules copy is complete in both languages and lives only in strings.js", () => {
  const zh = Object.keys(STRINGS.zh.rules);
  const en = Object.keys(STRINGS.en.rules);
  assert.deepEqual(zh, en, "zh and en rules keys must match");
  ["march", "arms", "battle", "mirror", "builds"].forEach((key) => {
    assert.ok(STRINGS.zh.rules[`${key}Title`], `missing zh ${key}Title`);
    assert.ok(STRINGS.zh.rules[`${key}Body`], `missing zh ${key}Body`);
    assert.ok(STRINGS.en.rules[`${key}Body`], `missing en ${key}Body`);
  });
  const source = readFileSync("outputs/js/rules.js", "utf8");
  assert.ok(!/[一-鿿]/.test(source), "rules.js must carry no hardcoded copy");
});

test("a hidden rules overlay cannot swallow a tap", () => {
  const css = readFileSync("outputs/css/ui.css", "utf8");
  assert.match(css, /\.rules-layer\[hidden\][^}]*pointer-events:\s*none/);
});

/* ---- C · audio ---------------------------------------------------------- */

test("audio ships no files and opens no connections", () => {
  const source = readFileSync("outputs/js/audio.js", "utf8");
  assert.ok(!/fetch\(|XMLHttpRequest|new Audio\(|\.mp3|\.wav|\.ogg/.test(source),
    "audio must be synthesised, never loaded");
  assert.match(source, /createOscillator|createBuffer/);
});

test("without a gesture nothing is unlocked and nothing plays", () => {
  // Node has no AudioContext at all, which is also the degradation path.
  assert.equal(audio.unlock(), false);
  assert.equal(audio.isUnlocked(), false);
  assert.equal(audio.play("tap"), false, "a locked context must stay silent");
});

test("every cue the game speaks exists", () => {
  ["tap", "card", "recruit", "arrow", "cavalry", "hit", "charge", "sealWin", "sealLoss"]
    .forEach((name) => assert.equal(typeof audio.CUES[name], "function", `missing cue ${name}`));
});

test("the real call paths emit their cue — not just the cue table existing", () => {
  // Asserting on source is the only way to prove the WIRING without a DOM:
  // a cue table full of sounds nothing ever calls is the failure mode here.
  const stage = readFileSync("outputs/js/battle-stage.js", "utf8");
  const main = readFileSync("outputs/js/main.js", "utf8");
  assert.match(stage, /emitCue\("arrow"/, "per-strike arrows must sound");
  assert.match(stage, /emitCue\(mounted \? "cavalry" : "hit"/, "cavalry and spear must differ");
  assert.match(stage, /emitCue\(won \? "sealWin" : "sealLoss"\)/, "the seal must sound once");
  assert.match(main, /emitCue\("recruit"\)/, "a successful recruit must sound");
  assert.match(main, /armOnFirstGesture\(\)/, "any first gesture must arm audio");
});

test("cue emission is observable and throttled", () => {
  const seen = [];
  const off = audio.onCue((name) => seen.push(name));
  audio.emitCue("recruit");
  audio.emitCue("arrow", { throttleMs: 5000 });
  audio.emitCue("arrow", { throttleMs: 5000 });   // inside the window: dropped
  off();
  audio.emitCue("hit");                            // observer removed
  assert.deepEqual(seen, ["recruit", "arrow"]);
});

test("mute is a UI preference and never touches the save contract", () => {
  const source = readFileSync("outputs/js/audio.js", "utf8");
  assert.match(source, /localStorage/);
  assert.ok(!/SAVE_KEY|V11_SAVE_KEY|saveVersion/.test(source),
    "audio must not reach into the save");
  assert.equal(audio.setMuted(true), true);
  assert.equal(audio.isMuted(), true);
  assert.equal(audio.play("hit"), false, "muted must create no node at all");
  assert.equal(audio.setMuted(false), false);
});

test("a missing AudioContext degrades silently rather than throwing", () => {
  assert.doesNotThrow(() => { audio.play("cavalry"); audio.dispose(); });
});

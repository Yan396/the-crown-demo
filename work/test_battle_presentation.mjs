/*
 * BATTLE PRESENTATION — the permanent gate for the consolidated spec.
 *
 * One test per numbered item that can be asserted without a browser, plus the
 * two regressions that made the earlier passes look landed when they were not:
 *
 *   - a later duplicate CSS rule silently overriding the held pose keyframes;
 *   - a second audio path firing alongside the beat hook.
 *
 * Both were invisible to every previous suite, because every previous suite
 * asked "does the code exist" rather than "does the code WIN". So several
 * assertions here are deliberately about cascade order and single-definition,
 * not about presence.
 *
 * Everything here is presentation. If an assertion in this file starts
 * constraining a battle outcome, the assertion is wrong, not the engine.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import {
  CONFIG_PRESENTATION as P,
  CAMERA,
  FORMATION_LAYOUTS,
  FORMATION_SHAPE,
  TIER_ORDER,
  WEIGHT_TIERS,
  armyBandRatio,
  commandWindows,
  shakeOffsetPx,
  strikeDurationMs,
  tokenHeightPx,
  weightTierFor
} from "../outputs/js/presentation.js";
import { normalizeScript, officerFigureFor } from "../outputs/js/battle-stage.js";
import { CONFIG } from "../outputs/js/data.js";
import { STRINGS } from "../outputs/js/strings.js";

const css = readFileSync(new URL("../outputs/css/ui.css", import.meta.url), "utf8");
const stage = readFileSync(new URL("../outputs/js/battle-stage.js", import.meta.url), "utf8");
const battle = readFileSync(new URL("../outputs/js/battle.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
const guide = readFileSync(new URL("../outputs/styleguide.html", import.meta.url), "utf8");

// A CSS identifier may contain a hyphen, so `\\b` alone counts token-knock-heavy
// as a token-knock. Anything that would continue the name disqualifies a match.
function keyframeNames(name) {
  return [...css.matchAll(new RegExp(`@keyframes\\s+${name}(?![\\w-])`, "g"))].length;
}

/* ---- global principles --------------------------------------------------- */

// Comments talk ABOUT the gameplay boundary constantly; only code may not cross it.
const stageCode = stage
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|\s)\/\/[^\n]*/g, "$1");

test("G1: the stage stays a replay -- no gameplay RNG, CONFIG or state writes", () => {
  assert.doesNotMatch(stageCode, /state\.rng|nextFloat\s*\(/, "the stage must never draw a gameplay random");
  assert.doesNotMatch(stageCode, /\bCONFIG\./, "the stage must not read gameplay CONFIG");
  assert.doesNotMatch(stageCode, /Math\.random/, "presentation randomness is the seeded local roll()");
});

test("G3: exactly one clock -- every battle cue goes through emitBeat", () => {
  assert.match(stage, /function emitBeat\(payload\)/);
  // The audio adapter a host passes must not be able to fire a cue the hook
  // already owns; that double-firing is what emitBeat exists to prevent.
  assert.match(stage, /!\["strike", "arrow", "charge", "rout"\]\.includes\(beat\.type\)/);
  for (const cue of ["hit", "arrow", "charge", "rout", "cavalry"]) {
    const direct = new RegExp(`(?<!// )crownAudio\\.${cue}\\(`, "g");
    const hits = [...stage.matchAll(direct)];
    assert.ok(hits.length > 0, `${cue} must still sound`);
  }
  // Every crownAudio call site lives inside emitBeat's switch, so no performer
  // can start a second pipeline by accident.
  const hookBody = stage.slice(stage.indexOf("function emitBeat"), stage.indexOf("function emitBeat") + 1400);
  const total = [...stage.matchAll(/crownAudio\.\w+\(/g)].length;
  const inHook = [...hookBody.matchAll(/crownAudio\.\w+\(/g)].length;
  assert.equal(total, inHook, "a crownAudio call outside emitBeat is a second audio pipeline");
});

test("G4: ink only -- no emoji, gradients-as-decoration or glow filters on the stage", () => {
  const block = css.slice(css.indexOf("==== battle stage"));
  assert.doesNotMatch(block, /drop-shadow\([^)]*rgb|box-shadow:[^;]*(?:cyan|magenta|#0ff)/i);
  assert.doesNotMatch(stage, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, "no emoji in the stage");
});

/* ---- 1. stage composition ------------------------------------------------ */

test("1a: never more than 16 drawn figures a side", () => {
  assert.equal(P.STAGE_TOKEN_CAP, 16);
  for (const n of [1, 16, 17, 24]) {
    const side = {
      label: "x", startTroops: n,
      tokens: Array.from({ length: n }, (_, i) => ({ idx: i, troopType: "militia" }))
    };
    const script = normalizeScript({
      battleId: "b", terrain: "field", sides: { player: side, enemy: side },
      events: [{ t: 0, type: "battle_start" }]
    });
    assert.ok(script.sides.player.tokens.length <= 16, `${n} drew too many`);
  }
});

test("1b: the sheet is capped at ~1100px and letterboxed", () => {
  assert.match(css, /\.stage-paper\s*\{[^}]*width:\s*min\(1100px,\s*100%\)/);
  // A cyclic percentage in an auto grid track measured the stage at 88x0 during
  // play(), which silently shrank the stain canvas and every derived size.
  assert.match(css, /\.battle-stage\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/);
  assert.match(css, /\.battle-stage\s*\{[^}]*grid-template-rows:\s*minmax\(0,\s*1fr\)/);
});

test("1b: the two armies stand in at least 40% of the stage height", () => {
  // The flattest formation is the case the floor has to hold for.
  const spread = FORMATION_SHAPE.LINE_FAR_DEPTH - FORMATION_SHAPE.LINE_NEAR_DEPTH;
  // 390x844 phone and a 1280x800 desktop, world heights measured from the
  // shipped sheet height minus its plate and dispatch rows.
  for (const [worldHeight, spacing, label] of [[230, 23, "390x844"], [224, 40, "desktop"]]) {
    const tokenHeight = tokenHeightPx(worldHeight, spacing);
    const ratio = armyBandRatio({
      worldHeight, tokenHeight, depthSpread: spread,
      nearDepth: FORMATION_SHAPE.LINE_NEAR_DEPTH
    });
    assert.ok(ratio >= 0.4, `${label}: armies fill only ${(ratio * 100).toFixed(1)}% of the stage`);
  }
});

test("1c: two shakes a battle, sized from the stage, on the world layer only", () => {
  assert.equal(P.SHAKE_BUDGET, 2);
  assert.match(stage, /if \(shakesSpent >= P\.SHAKE_BUDGET\) return false;/);
  // Spent on first contact and on the final blow, and nowhere else.
  assert.match(stage, /shake\("contact"\)/);
  assert.match(stage, /if \(index === finalStrikeIndex\) shake\("final-blow"\)/);
  assert.equal([...stage.matchAll(/\bshake\("/g)].length, 2, "only two shake sites may exist");
  // clamp(stageWidth * 0.004, 2, 7)
  assert.equal(shakeOffsetPx(390), 2);
  assert.equal(shakeOffsetPx(1100), 4.4);
  assert.equal(shakeOffsetPx(4000), 7);
  // The frame, the nameplates and the dispatch line are outside .stage-world,
  // so animating the world is what keeps them still.
  assert.match(css, /\.battle-stage\.is-shaking \.stage-world\s*\{\s*animation: stage-shake/);
  assert.doesNotMatch(css, /\.battle-stage\.is-shaking \.stage-paper/);
});

/* ---- 2 & 3. poses and weight tiers --------------------------------------- */

test("2a/3: the strike pose is held keyframes, and no later rule overrides them", () => {
  for (const tier of TIER_ORDER) {
    assert.equal(keyframeNames(`pose-strike-${tier}`), 1, `pose-strike-${tier} must be defined once`);
    assert.match(css, new RegExp(`@keyframes pose-strike-${tier}[^}]*\\{[^@]*?transform: rotate`));
  }
  // steps(1) is what makes the silhouette STATIONARY inside each pose.
  assert.match(css, /\.stage-token\.is-striking \.fig-pose\s*\{\s*animation: pose-strike-light 260ms steps\(1, end\)/);
  assert.match(css, /\.stage-token\.tier-medium\.is-striking \.fig-pose\s*\{\s*animation: pose-strike-medium 330ms steps\(1, end\)/);
  assert.match(css, /\.stage-token\.tier-heavy\.is-striking \.fig-pose\s*\{\s*animation: pose-strike-heavy 430ms steps\(1, end\)/);
  // THE REGRESSION: a second `.is-striking .fig-pose` rule later in the file
  // silently replaced all of the above with a 220ms two-step, so none of the
  // tier rhythm ever reached the screen.
  // Only three rules may SET the animation; the officer rules only lengthen it.
  const setters = [...css.matchAll(
    /\.stage-token(?:\.[\w-]+)*\.is-striking \.fig-pose\s*\{\s*animation:\s*([\w-]+)/g
  )].map((match) => match[1]);
  assert.deepEqual(setters, ["pose-strike-light", "pose-strike-medium", "pose-strike-heavy"]);
  assert.equal(keyframeNames("fig-strike"), 0, "the old 220ms fig-strike must stay deleted");
});

test("3: heavier means a longer telegraph AND a longer hold -- rhythm, not numbers", () => {
  const [light, medium, heavy] = TIER_ORDER.map((name) => WEIGHT_TIERS[name]);
  assert.deepEqual(
    [light.windupMs, medium.windupMs, heavy.windupMs], [100, 140, 200]
  );
  assert.deepEqual(
    [light.contactMs, medium.contactMs, heavy.contactMs], [60, 90, 130]
  );
  assert.deepEqual(
    [light.knockbackPx, medium.knockbackPx, heavy.knockbackPx], [6, 10, 16]
  );
  for (const tier of TIER_ORDER) assert.equal(WEIGHT_TIERS[tier].followMs, 100);
  // Strictly monotonic on both axes: that is the eyes-closed test.
  assert.ok(light.windupMs < medium.windupMs && medium.windupMs < heavy.windupMs);
  assert.ok(light.contactMs < medium.contactMs && medium.contactMs < heavy.contactMs);
  assert.ok(light.splatterScale < medium.splatterScale && medium.splatterScale < heavy.splatterScale);
  assert.equal(heavy.inkBurst, true, "only the heavy tier bursts");
  assert.equal(light.inkBurst, false);
  // A whole strike is the sum of its three holds.
  assert.equal(strikeDurationMs("heavy"), 430);
  assert.equal(strikeDurationMs("heavy", true), 430 + P.LIEUTENANT_EXTRA_HOLD_MS);
});

test("3: tiers come from what the engine already put on a token", () => {
  assert.equal(weightTierFor({ troopType: "militia" }), "light");
  assert.equal(weightTierFor({ troopType: "bandit" }), "light");
  assert.equal(weightTierFor({ troopType: "veteran" }), "medium");
  assert.equal(weightTierFor({ troopType: "militia", arm: "spear" }), "medium");
  assert.equal(weightTierFor({ troopType: "militia", arm: "cavalry" }), "heavy");
  assert.equal(weightTierFor({ troopType: "militia", isLieutenant: true }), "heavy");
  // The legacy aliases still agree with the table they now come from.
  assert.equal(P.CAVALRY_KNOCKBACK_PX, WEIGHT_TIERS.heavy.knockbackPx);
  assert.equal(P.INFANTRY_KNOCKBACK_PX, WEIGHT_TIERS.medium.knockbackPx);
});

test("3: knockback is the tier's, and exactly one rule owns it", () => {
  // THE SECOND REGRESSION OF THE SAME SHAPE: a later duplicate
  // `.stage-token.is-reeling` set `animation: token-reel`, which ignored
  // --knock, so the per-tier knockback was configured and asserted for months
  // and never once reached the screen.
  const owners = [...css.matchAll(/^\.stage-token\.is-reeling \{/gm)];
  assert.equal(owners.length, 1, "exactly one rule may own the knockback");
  assert.equal(keyframeNames("token-reel"), 0, "the --knock-discarding duplicate must stay deleted");
  assert.equal(keyframeNames("token-knock"), 1);
  assert.equal(keyframeNames("token-knock-heavy"), 1);
  assert.match(css, /@keyframes token-knock \{[\s\S]*?var\(--knock, 8px\) \* var\(--facing, 1\)/);
  // The heavy variant composes by overriding the NAME, so it cannot drop --knock.
  assert.match(css, /\.stage-token\.is-jolted \{\s*animation-name: token-knock-heavy;\s*\}/);
  assert.equal(keyframeNames("token-jolt"), 0);
  // Facing belongs to the rank, so a knocked enemy is thrown away from the blow.
  assert.match(css, /\.stage-ranks-enemy \.stage-token \{\s*--facing: -1;\s*\}/);
  assert.match(stage, /target\.node\.style\.setProperty\("--knock", `\$\{tier\.knockbackPx\}px`\)/);
});

test("2b: at most six figures move at once, and the rest freeze on a contact hold", () => {
  assert.equal(P.MAX_CONCURRENT_ACTORS, 6);
  assert.match(stage, /if \(priority \|\| activeActors < P\.MAX_CONCURRENT_ACTORS\)/);
  // Queued, never dropped: a token still takes its damage on time.
  assert.match(stage, /pending\.push\(window\.setTimeout\(\(\) => actorSlot\(run/);
  // The freeze covers the token layer but NOT .fig-pose, so the man throwing
  // the blow keeps moving while everyone else holds still.
  assert.match(css, /\.battle-stage\.is-hit-paused \.stage-world,\s*\n\.battle-stage\.is-hit-paused \.stage-token\s*\{\s*animation-play-state: paused/);
});

test("2c/5e: a kill is three held beats, and a horse rears before it falls", () => {
  assert.equal(P.KILL_RAISE_MS, 140);
  assert.equal(P.DEATH_POSE_MS, 160);
  assert.equal(P.CAVALRY_REAR_MS, 160);
  assert.match(stage, /source\.node\.classList\.add\("is-finishing"\)/);
  assert.match(stage, /target\.node\.classList\.add\(mounted \? "is-rearing" : "is-dying"\)/);
  assert.match(stage, /classList\.add\("is-dead"\)/);
  assert.match(css, /@keyframes pose-finish[\s\S]{0,120}rotate\(-16deg\)/);
  assert.match(css, /@keyframes pose-die[\s\S]{0,120}rotate\(26deg\)/);
  assert.match(css, /@keyframes horse-rear/);
  // Horse and man go down as ONE mass, so they leave one large mark.
  assert.match(stage, /if \(mounted\) paintStain\(point\.x, point\.y, true, 2\.1/);
});

/* ---- 4. archers ---------------------------------------------------------- */

test("4a: the bow cycle is four held poses with the draw held longest", () => {
  assert.deepEqual(
    [P.BOW_NOCK_MS, P.BOW_DRAW_MS, P.BOW_RELEASE_MS, P.BOW_RECOVER_MS],
    [100, 200, 60, 100]
  );
  assert.ok(P.BOW_DRAW_MS > P.BOW_NOCK_MS + P.BOW_RELEASE_MS, "the draw is the pose that has to read");
  // THE REGRESSION: `archer-loose` was defined twice and the later, simpler
  // definition won, so the held draw was never on screen.
  assert.equal(keyframeNames("archer-loose"), 1, "archer-loose must be defined exactly once");
  assert.equal(keyframeNames("wall-archer-loose"), 1, "the wall garrison needs its own name");
  assert.match(css, /--bow-cycle:\s*460ms/);
  assert.match(css, /\.stage-token\.is-loosing \.fig-pose\s*\{\s*animation: archer-loose var\(--bow-cycle\) steps\(1, end\)/);
  // At full draw the string bends, the arm goes back and the shaft is ON the bow.
  assert.match(css, /@keyframes archer-string-pull[\s\S]*?21\.8%, 65\.2% \{ transform: translateX\(-4px\) scaleX\(1\.5\)/);
  assert.match(css, /@keyframes archer-draw-arm/);
  assert.match(css, /@keyframes archer-arrow-gone[\s\S]*?0%,\s+65\.2% \{ opacity: 1;/);
  // The drawn silhouette needs a bow arc and a shaft breaking the outline.
  assert.match(stage, /class="archer-bow"/);
  assert.match(stage, /class="archer-arrow"/);
  assert.match(stage, /class="archer-draw-arm"/);
});

test("4b: an archer's strike launches a real shaft, on the beat", () => {
  assert.equal(P.ARROW_LEAD_MS, 320);
  // Rotated to its own velocity tangent along a quadratic bezier.
  assert.match(stage, /Math\.atan2\(dy, dx\) \* 180 \/ Math\.PI/);
  assert.match(stage, /const inv = 1 - t;/);
  // Two cues: the draw starts nock+draw earlier so the release IS the launch.
  assert.match(stage, /const drawLead = P\.ARROW_LEAD_MS \+ P\.BOW_NOCK_MS \+ P\.BOW_DRAW_MS;/);
  assert.match(stage, /run: \(\) => nockArrow\(event\)/);
  assert.match(stage, /run: \(\) => launchArrow\(event\)/);
});

test("4c: shafts that carry a resolved hit never miss; volley shafts do", () => {
  assert.equal(P.VOLLEY_MISS_RATE, 0.1);
  assert.equal(P.ARROW_STUCK_MS, 2000);
  // The miss lives in the volley path only. A per-strike shaft that missed
  // would contradict damage the engine already resolved.
  const launch = stage.slice(stage.indexOf("function launchArrow"), stage.indexOf("function performStrike"));
  assert.doesNotMatch(launch, /miss/, "a resolved hit's shaft must never miss");
  assert.match(stage, /const missed = roll\(\) < P\.VOLLEY_MISS_RATE;/);
  assert.match(css, /\.stage-shaft\.is-stuck/);
});

test("4d: a volley is 3-5 shafts, 60ms apart, fanned", () => {
  assert.equal(P.VOLLEY_MIN_ARROWS, 3);
  assert.equal(P.VOLLEY_MAX_ARROWS, 5);
  assert.equal(P.ARROW_SPREAD_MS, 60);
  assert.ok(P.VOLLEY_ANGLE_VARIANCE_PX > 0, "a volley without angle variance is a barcode");
  assert.match(stage, /P\.VOLLEY_MIN_ARROWS, Math\.min\(P\.VOLLEY_MAX_ARROWS/);
  assert.match(stage, /baseDelay \+ index \* P\.ARROW_SPREAD_MS/);
});

/* ---- 5. cavalry ---------------------------------------------------------- */

test("5a/5b: horse and rider are one mass with four legs and a gallop", () => {
  const figure = stage.slice(stage.indexOf("function cavalryFigure"), stage.indexOf("function officerMang"));
  assert.match(figure, /horse-legs-a/);
  assert.match(figure, /horse-legs-b/);
  // Four legs in each frame of the two-frame cycle.
  for (const frame of ["a", "b"]) {
    const group = figure.slice(figure.indexOf(`horse-legs-${frame}`));
    const legs = [...group.slice(0, group.indexOf("</g>")).matchAll(/<path /g)].length;
    assert.equal(legs, 4, `gallop frame ${frame} must have four readable legs`);
  }
  assert.match(figure, /fig-melee/, "the rider's blade has to break the outline");
  assert.match(css, /@keyframes gallop-a/);
  assert.match(css, /@keyframes gallop-b/);
  assert.match(css, /@keyframes gallop-bob[\s\S]{0,120}translateY\(-3\.5px\)/);
  assert.match(css, /@keyframes dust-plume/);
  assert.match(css, /@keyframes horse-paw/);
  // Gallop and paw are mutually exclusive, driven off the phase.
  assert.match(stage, /const moving = name === "deploy" \|\| name === "charge";/);
  assert.match(css, /\.stage-token\.arm-cavalry:not\(\.is-moving\):not\(\.is-dead\) \.horse-legs-a/);
});

test("5c/5d: the charge covers 2.2x, arrives first, and HARD STOPS on contact", () => {
  assert.equal(P.CAVALRY_ADVANCE_MULTIPLIER, 2.2);
  assert.equal(P.CAVALRY_LEAD_MS, 300);
  // Multiplying the TRAVEL sent a mount straight through the enemy army and out
  // the far side; multiplying the PROGRESS and clamping at 1 arrives early and
  // stops on the line.
  assert.match(stage, /Math\.min\(1, ratio \* P\.CAVALRY_ADVANCE_MULTIPLIER\)/);
  assert.doesNotMatch(stage, /travel \*= P\.CAVALRY_ADVANCE_MULTIPLIER/);
  // ...and then ends forward of the line it broke, exactly once.
  assert.ok(P.CAVALRY_BREAKTHROUGH_PX > 0);
  assert.match(stage, /if \(mounted && !source\.brokeThrough\)/);
  // The legacy alias now states the same fact the tier table does.
  assert.equal(P.CAVALRY_HIT_PAUSE_MS, WEIGHT_TIERS.heavy.contactMs);
});

/* ---- 6. lieutenants ------------------------------------------------------ */

test("6a: an officer is 30% larger, banners and all, with his own silhouette", () => {
  assert.equal(P.LIEUTENANT_SCALE, 1.3);
  assert.match(css, /--officer-h[^;]*;/);
  const ids = ["chen_mang", "shen_wen", "jia_duojin"];
  const drawn = ids.map((id) => officerFigureFor(id)());
  assert.equal(new Set(drawn).size, 3, "two officers share a silhouette");
  // Every officer carries a personal banner -- 贾多金 had none.
  drawn.forEach((svg, index) => {
    assert.match(svg, /fig-accent/, `${ids[index]} has no banner pennant`);
  });
});

test("6b: an officer is named on the field, always", () => {
  assert.match(stage, /plate\.className = "stage-name"/);
  assert.match(stage, /translate\(`lieutenant\.\$\{officerId\}Name`\)/);
  assert.match(css, /\.stage-name\s*\{/);
  for (const language of ["zh", "en"]) {
    for (const id of ["chen_mang", "shen_wen", "jia_duojin"]) {
      assert.ok(STRINGS[language].lieutenant[`${id}Name`], `${language}/${id} has no name`);
    }
    assert.ok(STRINGS[language].stage.officer, `${language} has no officer fallback`);
  }
});

test("6c/6d: an officer never queues, holds longer, and his banner falls", () => {
  assert.equal(P.LIEUTENANT_EXTRA_HOLD_MS, 60);
  assert.match(stage, /\{ tier: tierName, priority: officer \}/);
  assert.match(stage, /if \(priority \|\| activeActors/);
  assert.match(stage, /if \(target\.isLieutenant\) \{\s*\n\s*fallenBanner/);
  assert.match(stage, /log\(translate\("stage\.bannerFalls"\)\)/);
  for (const language of ["zh", "en"]) {
    assert.ok(STRINGS[language].stage.bannerFalls, `${language} has no banner line`);
  }
});

/* ---- 7. orders, given in the melee --------------------------------------- */

test("7: there is NO pre-battle order screen anywhere", () => {
  assert.doesNotMatch(html, /battle-command-modal|data-battle-command/,
    "the pre-battle order screen must be gone from the document");
  assert.doesNotMatch(
    readFileSync(new URL("../outputs/js/ui.js", import.meta.url), "utf8"),
    /battleCommandModal|onChooseBattleCommand/,
    "the pre-battle order screen must be gone from the UI layer"
  );
  // Choosing a formation must not chain into an order screen...
  assert.match(battle, /\/\/ The formation is the whole pre-battle commitment and it ends here/);
  // ...and startBattle must not open one either.
  assert.doesNotMatch(
    battle.slice(battle.indexOf("export function startBattle")),
    /demo\.modal = "battleCommand"/
  );
  // The formation stays the one pre-battle choice.
  assert.match(html, /id="formation-modal"/);
});

test("7: two deterministic order windows, derived from the script alone", () => {
  assert.equal(P.COMMAND_WINDOWS, 2);
  const times = [0, 5000, 7000, 9000, 11000, 13000];
  const events = [
    { type: "battle_start" }, { type: "round_start", n: 1 }, { type: "strike" },
    { type: "round_start", n: 2 }, { type: "round_start", n: 3 }, { type: "battle_end" }
  ];
  const first = commandWindows(events, times);
  const again = commandWindows(events, times);
  assert.deepEqual(first, again, "the same script must ask at the same two beats");
  assert.equal(first.length, 2);
  assert.ok(first[1] > first[0], "the two windows must be distinct beats");
  // A one-round battle still gets two windows.
  const single = commandWindows(
    [{ type: "round_start", n: 1 }, { type: "battle_end" }], [5000, 9000]
  );
  assert.equal(single.length, 2);
  assert.ok(single[1] > single[0]);
  // No windows at all still yields two, so the gate can never silently vanish.
  assert.equal(commandWindows([{ type: "battle_end" }], [1000]).length, 2);
});

test("7: the demo build is never asked for an order", () => {
  // `script.command` is emitted only under F3, so it is the build marker. The
  // demo has no army system and the stage may not widen that boundary.
  assert.match(stage, /commandWindowsAt = script\.command \? commandWindows\(script\.events, times\) : \[\];/);
  assert.match(battle, /if \(state\.features\?\.f3\) script\.command =/);
});

test("7: an order is presentation -- it cannot re-resolve a battle", () => {
  const gate = stage.slice(stage.indexOf("function issueCommand"), stage.indexOf("function openCommandGate"));
  assert.doesNotMatch(gate, /\b(?:capacity|survivors|damageTaken|hpCurrent)\s*(?:=|[-+]=)/,
    "an order must not write a resolved number");
  assert.doesNotMatch(gate, /applyKill|winner|\bloot\b|syncCounts/,
    "an order must not touch the settlement");
  // It moves ranks, writes a dispatch line, and is recorded. That is all.
  assert.match(gate, /log\(translate\(`battleCommand\.\$\{command\}`\)\)/);
  assert.match(gate, /options\.onCommand\?\.\(record\)/);
  assert.match(gate, /root\.classList\.add\("is-slowmo"\)/);
  assert.equal(P.COMMAND_SLOWMO_MS, 200);
  // The three orders are three visibly different things.
  const exec = stage.slice(stage.indexOf("function executeCommand"));
  assert.match(exec, /P\.COMMAND_PRESS_STEP_PX/, "压上 steps the ranks in");
  assert.match(exec, /P\.COMMAND_HOLD_TIGHTEN/, "稳住 tightens the spread");
  assert.match(exec, /classList\.add\("is-marked"\)/, "集火 marks a target");
  assert.match(exec, /slice\(0, P\.COMMAND_FOCUS_TOKENS\)/, "集火 converges three tokens");
  assert.equal(P.COMMAND_FOCUS_TOKENS, 3);
});

test("7: the record replays, and never exceeds two", () => {
  assert.match(stage, /if \(!root \|\| commandLog\.length >= P\.COMMAND_WINDOWS\) return;/);
  assert.match(stage, /const replay = options\.replayCommands\?\.\(\)\?\.\[windowIndex\];/);
  assert.match(stage, /commandLog\.push\(record\)/);
  assert.match(stage, /\{ n: index \+ 1, command, t: Math\.round\(virtualTime\), source \}/);
  // Autoplay and reduced motion answer instantly; a skipped battle is never asked.
  assert.match(stage, /if \(options\.autoCommand\?\.\(\) \|\| reducedMotion\.matches\)/);
  assert.match(stage, /closeCommandGate\(\);\s*\n\s*cancelAnimationFrame/);
});

test("7: the balance-side command formula is untouched", () => {
  assert.deepEqual(Object.keys(CONFIG.F3_COMMANDS).sort(), ["charge", "focus", "hold"]);
  assert.deepEqual(CONFIG.F3_COMMANDS.charge, { attack: 1.1, defense: 0.9 });
  assert.deepEqual(CONFIG.F3_COMMANDS.hold, { attack: 1, defense: 1.1 });
  assert.deepEqual(CONFIG.F3_COMMANDS.focus, { attack: 1.05, defense: 1 });
  assert.equal(CONFIG.F3_AUTOPLAY_COMMAND, "hold");
  assert.match(battle, /export function chooseBattleCommand\(state, command\)/);
  assert.match(battle, /applyF3BattleModifiers\(/);
  // An unanswered order resolves to the value it always resolved to under
  // autoplay, rather than stalling on a modal that no longer exists.
  assert.match(battle, /chooseBattleCommand\(state, CONFIG\.F3_AUTOPLAY_COMMAND\)/);
});

/* ---- 8. effects discipline ----------------------------------------------- */

test("8a: stains scale with the bucket, are smaller, capped, and age out", () => {
  assert.equal(P.STAIN_SCALE, 0.6, "40% smaller than the first pass");
  assert.equal(P.STAIN_OLDEST_ALPHA, 0.3);
  assert.ok(P.STAIN_AREA_CAP_RATIO > 0 && P.STAIN_AREA_CAP_RATIO < 1);
  assert.match(stage, /const bulk = Math\.max\(1, Math\.sqrt\(Math\.max\(1, men\)\)\)/);
  assert.match(stage, /if \(stainArea <= cap\) return;/);
  assert.match(stage, /function repaintStains\(\)/);
  assert.match(stage, /P\.STAIN_OLDEST_ALPHA \+ \(1 - P\.STAIN_OLDEST_ALPHA\)/);
});

test("8b: splatter throws along the strike vector, with a 2px slash", () => {
  assert.equal(P.SLASH_FLASH_MS, 90);
  assert.match(stage, /const angle = Math\.atan2\(point\.y - origin\.y, point\.x - origin\.x\);/);
  assert.match(stage, /function splatter\(x, y, angle, tier\)/);
  assert.match(stage, /Math\.cos\(angle\) \* drift - Math\.sin\(angle\) \* lateral/);
  assert.match(css, /\.stage-slash\s*\{[^}]*height:\s*2px/);
  assert.match(css, /@keyframes slash-flash/);
});

test("8c: the rout is slow-mo, dropped banners, then a held cheer", () => {
  assert.equal(P.ROUT_SLOWMO_MS, 300);
  assert.equal(P.VICTORY_HOLD_MS, 500);
  assert.match(stage, /if \(index % 3 === 0\)[\s\S]{0,120}fallenBanner/);
  assert.match(stage, /classList\.add\("is-cheering"\)/);
  assert.match(css, /\.stage-token\.is-cheering \.fig-pose\s*\{\s*animation: fig-cheer 500ms/);
});

/* ---- 9. the beat hook ---------------------------------------------------- */

test("9: every beat is emitted with its tier, type and kill", () => {
  assert.match(stage, /options\.onBeat\?\.\(beat\)/);
  assert.match(stage, /const beat = \{ tier: "light", kill: false, at: virtualTime, \.\.\.payload \};/);
  const strike = stage.slice(stage.indexOf("function performStrike"));
  assert.match(strike, /type: "strike",\s*\n\s*tier: tierName,\s*\n\s*kill: Boolean\(event\.kill\)/);
  for (const type of ["arrow", "charge", "rout", "kill", "command", "shake"]) {
    assert.match(stage, new RegExp(`type: "${type}"`), `no beat is emitted for ${type}`);
  }
});

/* ---- acceptance ---------------------------------------------------------- */

test("acceptance: the styleguide carries the three recordings", () => {
  for (const clip of ["field-15s", "archer-volley", "cavalry-charge"]) {
    assert.match(guide, new RegExp(`clips/${clip}\\.webm`), `${clip} is not in the styleguide`);
    const file = new URL(`../outputs/clips/${clip}.webm`, import.meta.url);
    const bytes = readFileSync(file).length;
    assert.ok(bytes > 20_000, `${clip} is too small to be a real recording (${bytes} bytes)`);
    // A real recording is a container, not a still: check the Matroska magic.
    const head = readFileSync(file).subarray(0, 4);
    assert.deepEqual([...head], [0x1a, 0x45, 0xdf, 0xa3], `${clip} is not a webm container`);
  }
  // The harness must actually drive the shipped stage, not a mock of it.
  assert.match(guide, /import \{ createBattleStage \} from "\.\/js\/battle-stage\.js"/);
  assert.match(guide, /window\.__SG_PLAY__/);
});

test("acceptance: individual strikes stay countable at 2x", () => {
  // At 2x the whole performance halves, so the shortest contact hold on the
  // lightest tier is the worst case. Below ~25ms a hit stops registering as a
  // separate event at all.
  for (const tier of TIER_ORDER) {
    const at2x = WEIGHT_TIERS[tier].contactMs / 2;
    assert.ok(at2x >= 30, `${tier} contact is ${at2x}ms at 2x -- not countable`);
    assert.ok(strikeDurationMs(tier) / 2 >= 130, `${tier} whole strike vanishes at 2x`);
  }
  assert.deepEqual([...P.SPEED_STEPS], [1, 2, 4]);
});

test("the camera stays a cross-section: further is higher, smaller AND paler", () => {
  assert.ok(CAMERA.NEAR_SCALE > CAMERA.FAR_SCALE);
  assert.ok(CAMERA.FAR_FADE > 0 && CAMERA.FAR_FADE < 1);
  // Haze, not disappearance: below about 0.6 a raked rank stops being ink.
  assert.ok(CAMERA.FAR_FADE >= 0.6, "the far rank must still read as ink");
  assert.ok(CAMERA.DEPTH_RISE_PX > 0);
  // A 横列 is still one line, not a staircase.
  const spread = FORMATION_SHAPE.LINE_FAR_DEPTH - FORMATION_SHAPE.LINE_NEAR_DEPTH;
  assert.ok(spread > 0 && spread <= 0.4, `a line raked over ${spread} of the field is a queue`);
  const first = FORMATION_LAYOUTS.line(0, 8, 1, 400);
  const last = FORMATION_LAYOUTS.line(7, 8, 1, 400);
  assert.ok(last.x > first.x, "a line runs along the field");
  assert.equal(first.rank, last.rank, "a line is one rank");
});

test("figures are sized from the stage, within sane bounds", () => {
  assert.ok(tokenHeightPx(230, 23) >= P.TOKEN_MIN_HEIGHT_PX);
  assert.ok(tokenHeightPx(2000, 500) <= P.TOKEN_MAX_HEIGHT_PX);
  // A crowded phone rank is limited by the room each man has, not by the sheet.
  assert.ok(tokenHeightPx(600, 20) < tokenHeightPx(600, 60), "lateral room must cap the figure");
});

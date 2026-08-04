/*
 * Full-bleed battle stage gate.
 *
 * The bug this locks down: the stage was a min(1100px) x min(44vh, 400px)
 * card, centred with padding on a 0.9-alpha scrim, so the darkened map showed
 * around all four edges and players reported "only seeing half the battle".
 *
 * Static assertions only -- the geometry itself is verified in a real browser
 * by work/shots_fullscreen.mjs, which is a dev tool rather than a gate because
 * it needs Chromium. What is asserted here is every rule that browser check
 * depends on, so a regression cannot land silently between screenshot runs.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { CONFIG_PRESENTATION as P, depthRiseFor, tokenHeightPx } from "../outputs/js/presentation.js";

const css = readFileSync(new URL("../outputs/css/ui.css", import.meta.url), "utf8");
const stage = readFileSync(new URL("../outputs/js/battle-stage.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");

/*
 * The declarations of the rule whose selector list is exactly this selector,
 * so a match cannot leak in from a neighbour -- and so a shared rule like
 * `.stage-plates, .stage-world, .stage-log { ... }` is not mistaken for the
 * standalone `.stage-log` rule just because it ends with that name.
 */
function block(selector) {
  const needle = `${selector} {`;
  for (let at = css.indexOf(needle); at >= 0; at = css.indexOf(needle, at + 1)) {
    const before = css.slice(0, at).trimEnd();
    if (before.endsWith(",")) continue;   // part of a selector list
    return css.slice(at, css.indexOf("}", at));
  }
  assert.fail(`missing rule: ${selector}`);
  return "";
}

/* ---- the layer fills the viewport --------------------------------------- */

test("the stage layer is the viewport: fixed, inset 0, dvw/dvh with a fallback", () => {
  const layer = block(".battle-stage");
  assert.match(layer, /position:\s*fixed/);
  assert.match(layer, /inset:\s*0/);
  // 100vh is the LARGE viewport on a phone -- taller than what is actually
  // visible -- so the dynamic units have to win where they are supported.
  assert.match(layer, /width:\s*100vw/, "missing the vw fallback");
  assert.match(layer, /height:\s*100vh/, "missing the vh fallback");
  assert.match(layer, /width:\s*100dvw/);
  assert.match(layer, /height:\s*100dvh/);
  assert.ok(
    layer.indexOf("100vh") < layer.indexOf("100dvh"),
    "the dvh declaration must come after the vh one or the fallback wins"
  );
  // Padding on the LAYER is what letterboxed the card and let the map show.
  assert.match(layer, /padding:\s*0/);
  assert.match(layer, /place-items:\s*stretch/);
});

test("the layer is opaque: no dimmed map may show through it", () => {
  const layer = block(".battle-stage");
  assert.match(layer, /background:\s*var\(--paper\)/);
  assert.doesNotMatch(layer, /rgba\([^)]*0\.9\)/, "the 0.9 scrim is the reported bug");
  // Anything translucent at all would let the map read through.
  const background = layer.match(/background:\s*([^;]+);/)?.[1] || "";
  assert.doesNotMatch(background, /rgba|hsla|transparent/, `translucent stage: ${background}`);
});

test("the paper is full-bleed with no card affordance", () => {
  const paper = block(".stage-paper");
  assert.match(paper, /width:\s*100%/);
  assert.match(paper, /height:\s*100%/);
  assert.match(paper, /grid-template-rows:\s*auto minmax\(0, 1fr\) auto/);
  for (const banned of [/44vh/, /box-shadow/, /justify-self/, /align-self/, /margin:/]) {
    assert.doesNotMatch(paper, banned, `card affordance survives: ${banned}`);
  }
  // The field inside it IS bounded -- rank spacing is a frozen formation rule,
  // so an unbounded field strands the armies in the middle of a wide desktop.
  // This is content width, not a card: the paper either side is the same paper.
  assert.match(paper, /--field-w:\s*min\(100%, 1280px\)/);
  assert.match(
    css,
    /\.stage-plates,\s*\n\.stage-world,\s*\n\.stage-log\s*\{[^}]*width:\s*var\(--field-w\)/,
    "the chrome must share the field column"
  );
});

/* ---- the map behind it is gone, not merely covered ---------------------- */

test("every map surface is hidden while the stage is open", () => {
  // Covered-but-present is not enough: these are interactive, and a stray tap
  // through a gap would act on the world mid-battle.
  for (const id of ["#ticker", "#legend", "#report", "#renown-gate", "#town-sheet"]) {
    assert.match(
      css,
      new RegExp(`body\\.battle-stage-open[^{]*${id.replace("#", "#")}[^{]*\\{[^}]*display:\\s*none`),
      `${id} still shows during a battle`
    );
  }
  assert.match(block("body.battle-stage-open"), /overflow:\s*hidden/, "the page must not scroll");
});

test("the map HUD is suppressed but the one sound switch survives", () => {
  // The HUD sits at z-index 5, ABOVE the stage's 4, so without this the gold /
  // troops / renown bar and the pause and settings buttons sit on the field.
  assert.match(
    css,
    /body\.battle-stage-open #hud > \*:not\(\.hud-actions\),\s*\n\s*body\.battle-stage-open \.hud-actions > \*:not\(#sound-button\)\s*\{[^}]*display:\s*none/,
    "the HUD must collapse to the sound button alone"
  );
  // #app-overlay is a stacking context at z-index 2, so the HUD's own z-index
  // can never beat the stage's 4 -- the overlay itself has to be lifted.
  assert.match(block("body.battle-stage-open #app-overlay"), /z-index:\s*6/);
  const hud = block("body.battle-stage-open #hud");
  assert.match(hud, /position:\s*fixed/);
  assert.match(hud, /z-index:\s*6/, "the controls must sit above the stage");
  assert.match(hud, /left:\s*calc\(env\(safe-area-inset-left/, "left corner, inside the safe area");
  assert.match(hud, /top:\s*calc\(env\(safe-area-inset-top/);
  assert.match(block("body.battle-stage-open #sound-button"), /pointer-events:\s*auto/);
  // Still exactly one sound control in the document -- the stage does not mint
  // a second one of its own.
  assert.equal([...html.matchAll(/id="sound-button"/g)].length, 1);
});

test("the speed chip is in the opposite corner, also inside the safe area", () => {
  const speed = block(".stage-speed");
  assert.match(speed, /position:\s*fixed/);
  assert.match(speed, /z-index:\s*6/);
  assert.match(speed, /top:\s*calc\(env\(safe-area-inset-top/);
  assert.match(speed, /right:\s*calc\(env\(safe-area-inset-right/);
  // One chip, one long-press skip, both still owned by the stage.
  assert.equal([...stage.matchAll(/class="stage-speed"/g)].length, 1);
  assert.match(stage, /\.stage-speed"\)\.addEventListener\("click", cycleSpeed\)/);
  assert.match(stage, /onPressStart|onPressEnd/, "long-press skip must survive");
});

test("the chrome carries the safe area, so the paper itself still bleeds", () => {
  const plates = block(".stage-plates");
  assert.match(plates, /env\(safe-area-inset-top/);
  // Wide enough to clear both corner controls.
  assert.match(plates, /env\(safe-area-inset-left, 0px\) \+ 74px/);
  assert.match(plates, /env\(safe-area-inset-right, 0px\) \+ 74px/);
  const log = block(".stage-log");
  assert.match(log, /env\(safe-area-inset-bottom/);
  assert.match(block(".stage-hint"), /env\(safe-area-inset-bottom/);
});

/* ---- the field fills the page instead of being pinned low --------------- */

test("the ground line is placed from the measured band, not a fixed percentage", () => {
  // Depth rise is a fixed pixel count, so on a full-bleed stage a fixed
  // `bottom: 15%` leaves the battle pinned low under an acre of blank paper.
  assert.match(block(".stage-ranks"), /bottom:\s*var\(--ground-bottom, 15%\)/);
  assert.match(block(".stage-wall"), /bottom:\s*var\(--wall-bottom, 30%\)/);
  assert.match(block(".stage-archers"), /bottom:\s*var\(--wall-bottom, 30%\)/);
  assert.match(stage, /function layoutGround\(tokenHeight\)/);
  assert.match(stage, /layoutGround\(tokenH\);/, "the ground must be placed when the ranks are built");
  assert.match(stage, /--ground-bottom/);
  assert.match(stage, /--wall-bottom/);
});

test("the band lands centred at every shipped viewport, and never off the page", () => {
  // The world height each viewport leaves once the plates and dispatch line
  // have taken their rows, measured from the shipped chrome.
  const CHROME = 96;
  const VIEWPORTS = [
    [390, 844, "390x844 portrait"],
    [844, 390, "844x390 landscape"],
    [1366, 768, "1366x768 laptop"],
    [2048, 1280, "2048x1280 desktop"]
  ];
  for (const [width, height, label] of VIEWPORTS) {
    const worldHeight = height - CHROME;
    const spacing = Math.max(21, Math.min(40, Math.max(120, width * 0.42) / 7));
    const tokenHeight = tokenHeightPx(worldHeight, spacing);
    const band = depthRiseFor(worldHeight) + tokenHeight;
    const centre = worldHeight * P.STAGE_BAND_CENTRE_FROM_BOTTOM;
    const ground = Math.round(Math.max(
      P.STAGE_GROUND_MIN_PX,
      Math.min(Math.max(P.STAGE_GROUND_MIN_PX, worldHeight - band), centre - band / 2)
    ));
    assert.ok(ground >= P.STAGE_GROUND_MIN_PX, `${label}: feet below the page`);
    assert.ok(ground + band <= worldHeight + 1, `${label}: heads clipped off the top`);
    // Centred means the empty paper is shared, not all dumped on one side --
    // and with more sky above the heads than ground below the feet.
    const below = ground;
    const above = worldHeight - (ground + band);
    // Only meaningful where there is real slack to distribute: on a short
    // landscape stage the band already fills the page and the few pixels left
    // over cannot be "balanced".
    if (worldHeight - band > 80) {
      assert.ok(above >= below, `${label}: ${above}px sky vs ${below}px ground -- upside down`);
      assert.ok(
        below >= (above + below) * 0.3,
        `${label}: the band is stranded at the top (${below} vs ${above})`
      );
    }
    // ...and the field actually FILLS the page rather than floating in it.
    assert.ok(
      band / worldHeight >= 0.45,
      `${label}: the armies use only ${(band / worldHeight * 100).toFixed(0)}% of the stage`
    );
  }
});

test("figures are not simply scaled up to fill the bigger stage", () => {
  // The whole point of the cap: a full-bleed stage must NOT turn a 70px
  // silhouette into a 300px one. The battlefield grows; the men do not.
  const tall = tokenHeightPx(1184, 40);
  assert.equal(tall, P.TOKEN_MAX_HEIGHT_PX, "the figure cap must still bind on a big stage");
  // What grows with the page is the DEPTH of the formation, not the men.
  assert.ok(depthRiseFor(1184) > depthRiseFor(280), "the field must deepen on a bigger stage");
  assert.equal(depthRiseFor(200), 140, "a short landscape stage keeps the shipped rise");
  assert.ok(P.TOKEN_MAX_HEIGHT_PX <= 104);
  // ...and no blanket transform was added to the world to fake the fill.
  const world = block(".stage-world");
  assert.match(world, /transform:\s*scale\(var\(--zoom, 1\)\)/, "only the existing camera zoom");
});

/* ---- the way out ---------------------------------------------------------- */

test("the tally is measured AFTER it has content, so 继续 stays on screen", () => {
  // The regression this exists for: offsetHeight was read while the panel was
  // still empty, so the clamp used a ~36px box and pushed the real ~141px
  // panel -- and the only button out of a battle -- below the fold. It was
  // survivable only while the sheet was a short centred card, because
  // `paper.bottom` was then small enough that the clamp never won.
  const at = stage.indexOf('const tally = root.querySelector(".stage-tally")');
  assert.ok(at > 0, "the tally block moved");
  const body = stage.slice(at, at + 2600);
  const content = body.indexOf("tally.innerHeight") >= 0
    ? body.indexOf("tally.innerHeight")
    : body.indexOf("tally.innerHTML =");
  const measure = body.indexOf("tally.offsetHeight");
  assert.ok(content > 0 && measure > 0, "tally content or measurement missing");
  assert.ok(
    content < measure,
    "the tally is measured before it has content -- the clamp will be wrong"
  );
  // ...and it is still clamped into the viewport at all.
  assert.match(body, /window\.innerHeight - tally\.offsetHeight - P\.TALLY_VIEWPORT_MARGIN_PX/);
  assert.match(body, /Math\.max\(0, Math\.min\(below, room\)\)/);
  // The button that leaves the battle must still be wired to dispose.
  assert.match(stage, /\.stage-continue"\)\.addEventListener\("click", \(\) => \{[\s\S]{0,120}dispose\(\);/);
});

/* ---- teardown ----------------------------------------------------------- */

test("dispose removes the layer and every trace of the takeover", () => {
  const dispose = stage.slice(stage.indexOf("function dispose()"));
  const body = dispose.slice(0, dispose.indexOf("\n  }"));
  assert.match(body, /root\.remove\(\)/);
  assert.match(body, /root = null/);
  assert.match(body, /document\.body\.classList\.remove\("battle-stage-open"\)/);
  // Every path out of a battle -- end, skip, dispose -- goes through dispose.
  assert.match(stage, /\.battle-stage\[hidden\]|hidden/);
  assert.match(css, /\.battle-stage\[hidden\]\s*\{[^}]*display:\s*none\s*!important/);
  assert.match(css, /\.battle-stage\[hidden\]\s*\{[^}]*pointer-events:\s*none\s*!important/);
  // The class is the only thing holding the map's layout hostage, so removing
  // it restores the HUD, the scroll and every hidden surface in one step.
  assert.equal([...stage.matchAll(/classList\.add\("battle-stage-open"\)/g)].length, 1);
  assert.equal([...stage.matchAll(/classList\.remove\("battle-stage-open"\)/g)].length, 1);
});

test("no sound state is touched by opening or closing the stage", () => {
  // The stage releases battle VOICES; it must never flip the player's switch.
  assert.match(stage, /audio\?\.disposeBattle\?\.\(\)/);
  assert.doesNotMatch(stage, /setEnabled\(/, "the stage must not touch the sound preference");
});

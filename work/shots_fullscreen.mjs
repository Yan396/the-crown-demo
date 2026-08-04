/*
 * Full-bleed battle stage: real-browser geometry probe and screenshots.
 *
 * DEV TOOL, not a gate -- it needs Chromium, which is not a repository
 * dependency. work/test_battle_fullscreen.mjs asserts every CSS rule this
 * relies on; this is what proves the rules actually add up to a full-screen
 * stage on a real engine, at the four shipped viewports.
 *
 *   CROWN_PLAYWRIGHT=/path/to/node_modules/playwright node work/shots_fullscreen.mjs
 *
 * Writes deploy/battle-fullscreen-<viewport>-<phase>.png next to the report.
 */
import { createServer } from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputs = path.join(root, "outputs");
const shotDir = process.env.CROWN_SHOT_DIR || path.join(root, "work", "shots");

const VIEWPORTS = [
  { label: "390x844", width: 390, height: 844 },
  { label: "844x390", width: 844, height: 390 },
  { label: "1366x768", width: 1366, height: 768 },
  { label: "2048x1280", width: 2048, height: 1280 }
];

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".webmanifest": "application/manifest+json", ".json": "application/json",
  ".png": "image/png", ".webm": "video/webm"
};

async function loadPlaywright() {
  const override = process.env.CROWN_PLAYWRIGHT;
  const candidates = override
    ? [path.join(override, "index.mjs"), override]
    : ["playwright"];
  for (const candidate of candidates) {
    try {
      return await import(candidate.startsWith("/") ? pathToFileURL(candidate).href : candidate);
    } catch { /* try the next one */ }
  }
  throw new Error("playwright not found; set CROWN_PLAYWRIGHT");
}

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const file = path.join(outputs, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(outputs) || !fs.existsSync(file)) {
    response.writeHead(404); response.end(); return;
  }
  response.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
  response.end(fs.readFileSync(file));
});
await new Promise((resolve) => server.listen(0, resolve));
const port = server.address().port;

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CROWN_CHROMIUM || undefined,
  args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"]
});

fs.mkdirSync(shotDir, { recursive: true });
const report = [];
let failures = 0;

for (const viewport of VIEWPORTS) {
  const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  // The QA hooks already used by the stage recorder: a deterministic field
  // battle with all three arms present, played through the real stage.
  await page.goto(`http://localhost:${port}/?qa=1&fresh=1`, { waitUntil: "load" });
  await page.waitForTimeout(400);
  // The page never scrolls by design (body is fixed + overflow hidden), so the
  // teardown check compares against the real baseline rather than assuming.
  const baseline = await page.evaluate(() => ({
    overflow: getComputedStyle(document.body).overflow,
    hudDisplay: getComputedStyle(document.getElementById("hud")).display
  }));
  await page.evaluate(() => window.__CROWN_QA__.beginBattle("field"));
  await page.evaluate(() => window.__CROWN_QA__.playBattle());
  await page.waitForTimeout(900);          // deploy: both lines on the field

  const deploy = await measure(page);
  await page.screenshot({ path: path.join(shotDir, `battle-fullscreen-${viewport.label}-deploy.png`) });

  await page.waitForTimeout(4200);         // into the melee
  const melee = await measure(page);
  await page.screenshot({ path: path.join(shotDir, `battle-fullscreen-${viewport.label}-melee.png`) });

  for (const [phase, m] of [["deploy", deploy], ["melee", melee]]) {
    const problems = [];
    const edge = (name, value) => {
      if (Math.abs(value) > 1) problems.push(`${name} off by ${value.toFixed(2)}px`);
    };
    edge("left", m.overlay.left);
    edge("top", m.overlay.top);
    edge("right", m.overlay.right - m.viewport.width);
    edge("bottom", m.overlay.bottom - m.viewport.height);
    if (Math.abs(m.paper.width - m.viewport.width) > 1) problems.push("paper is not full width");
    if (Math.abs(m.paper.height - m.viewport.height) > 1) problems.push("paper is not full height");
    if (m.scrollX || m.scrollY) problems.push("the page scrolls");
    if (m.overflowX) problems.push("horizontal overflow");
    if (m.visibleMapSurfaces.length) problems.push(`map visible: ${m.visibleMapSurfaces.join(",")}`);
    if (!m.speed.visible) problems.push("speed chip not visible");
    if (!m.sound.visible) problems.push("sound button not visible");
    if (m.speed.outsideSafe) problems.push("speed chip outside the safe viewport");
    if (m.sound.outsideSafe) problems.push("sound button outside the safe viewport");
    // Deployment marches the ranks IN from off-stage, so a token outside the
    // clip box is expected there and only a fault once the lines have met.
    if (phase === "melee" && m.tokensOutOfBounds) {
      problems.push(`${m.tokensOutOfBounds} tokens out of bounds (worst ${m.worstToken}px ${m.worstEdge})`);
    }
    if (errors.length) problems.push(`console: ${errors[0]}`);
    if (problems.length) failures += 1;
    report.push({
      viewport: viewport.label, phase,
      overlay: `${Math.round(m.overlay.width)}x${Math.round(m.overlay.height)}`,
      world: `${Math.round(m.world.width)}x${Math.round(m.world.height)}`,
      tokenH: m.tokenHeight, ground: m.ground,
      bandBelow: m.bandBelow, bandAbove: m.bandAbove,
      tokens: m.tokenCount,
      ok: problems.length ? `FAIL ${problems.join("; ")}` : "ok"
    });
  }

  // Teardown: nothing of the takeover may survive the battle.
  await page.evaluate(() => window.__CROWN_STAGE__?.dispose?.());
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({
    bodyClass: document.body.className,
    overlay: Boolean(document.getElementById("battle-stage")),
    hudVisible: getComputedStyle(document.getElementById("hud")).display !== "none",
    hudDisplay: getComputedStyle(document.getElementById("hud")).display,
    hudPosition: getComputedStyle(document.getElementById("hud")).position,
    bodyOverflow: getComputedStyle(document.body).overflow
  }));
  const teardownProblems = [];
  if (after.overlay) teardownProblems.push("overlay survived dispose");
  if (/battle-stage-open/.test(after.bodyClass)) teardownProblems.push("body class survived");
  if (!after.hudVisible) teardownProblems.push("HUD did not come back");
  if (after.hudPosition !== "absolute") teardownProblems.push("HUD stuck in its battle slot");
  if (after.bodyOverflow !== baseline.overflow) {
    teardownProblems.push(`scroll state not restored (${after.bodyOverflow} vs ${baseline.overflow})`);
  }
  if (after.hudDisplay !== baseline.hudDisplay) teardownProblems.push("HUD layout not restored");
  if (teardownProblems.length) failures += 1;
  report.push({
    viewport: viewport.label, phase: "after dispose",
    overlay: "-", world: "-", tokenH: "-", ground: "-", bandBelow: "-", bandAbove: "-", tokens: "-",
    ok: teardownProblems.length ? `FAIL ${teardownProblems.join("; ")}` : "ok"
  });

  await page.close();
}

console.table(report);
console.info(`shots -> ${shotDir}`);
await browser.close();
server.close();
process.exit(failures ? 1 : 0);

async function measure(page) {
  return page.evaluate(() => {
    const rect = (node) => (node ? node.getBoundingClientRect() : null);
    const overlay = rect(document.querySelector(".battle-stage"));
    const paper = rect(document.querySelector(".stage-paper"));
    const world = document.querySelector(".stage-world");
    const worldRect = rect(world);
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const seen = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return false;
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
      const box = node.getBoundingClientRect();
      if (!box.width || !box.height) return false;
      // Visible only counts if it is actually ON TOP of the stage.
      const z = Number(getComputedStyle(node).zIndex) || 0;
      return z > 4;
    };
    const chipBox = (selector) => {
      const node = document.querySelector(selector);
      if (!node) return { visible: false, outsideSafe: true };
      const style = getComputedStyle(node);
      const box = node.getBoundingClientRect();
      const visible = style.display !== "none" && style.visibility !== "hidden" &&
        Number(style.opacity) !== 0 && box.width > 0 && box.height > 0;
      const outsideSafe = box.left < 0 || box.top < 0 ||
        box.right > window.innerWidth + 0.5 || box.bottom > window.innerHeight + 0.5;
      // ...and it must be the topmost thing at its own centre, or it is not
      // actually clickable.
      const hit = document.elementFromPoint(
        Math.min(window.innerWidth - 1, Math.max(0, box.left + box.width / 2)),
        Math.min(window.innerHeight - 1, Math.max(0, box.top + box.height / 2))
      );
      return { visible: visible && Boolean(hit && node.contains(hit)), outsideSafe };
    };
    const tokens = [...document.querySelectorAll(".stage-token")];
    // The PAPER is the visible clip box; .stage-world is transformed by the
    // camera zoom, so its rect can legitimately exceed the screen.
    const bounds = paper || { left: 0, top: 0, right: 0, bottom: 0 };
    let worstToken = 0;
    let worstEdge = "-";
    const outOfBounds = tokens.filter((token) => {
      const box = token.getBoundingClientRect();
      const sides = [
        ["left", bounds.left - box.right], ["right", box.left - bounds.right],
        ["top", bounds.top - box.bottom], ["bottom", box.top - bounds.bottom]
      ];
      const [edge, escape] = sides.reduce((a, b) => (b[1] > a[1] ? b : a));
      if (escape > worstToken) { worstToken = escape; worstEdge = edge; }
      return escape > 4;
    }).length;
    const groundRaw = world ? getComputedStyle(world).getPropertyValue("--ground-bottom").trim() : "";
    const ground = Number.parseFloat(groundRaw) || 0;
    const tokenHeight = Number.parseFloat(
      world ? getComputedStyle(world).getPropertyValue("--token-h") : ""
    ) || 0;
    const band = Number.parseFloat(getComputedStyle(world).getPropertyValue('--band-h')) || 0;
    return {
      viewport,
      overlay: overlay
        ? { left: overlay.left, top: overlay.top, right: overlay.right, bottom: overlay.bottom, width: overlay.width, height: overlay.height }
        : { left: 9e9, top: 9e9, right: 0, bottom: 0, width: 0, height: 0 },
      paper: paper ? { width: paper.width, height: paper.height } : { width: 0, height: 0 },
      world: worldRect ? { width: worldRect.width, height: worldRect.height } : { width: 0, height: 0 },
      scrollX: window.scrollX, scrollY: window.scrollY,
      overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
      visibleMapSurfaces: ["#ticker", "#legend", "#report", "#town-sheet", "#renown-gate"].filter(seen),
      speed: chipBox(".stage-speed"),
      sound: chipBox("#sound-button"),
      tokenCount: tokens.length,
      tokensOutOfBounds: outOfBounds,
      worstToken: Math.round(worstToken),
      worstEdge,
      tokenHeight: Math.round(tokenHeight),
      ground: Math.round(ground),
      bandBelow: Math.round(ground),
      bandAbove: Math.round((worldRect?.height || 0) - ground - band)
    };
  });
}

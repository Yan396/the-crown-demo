/*
 * Battle-stage recorder and frame-budget probe.
 *
 * DEV TOOL, not a gate. It drives outputs/styleguide.html in a real Chromium
 * and produces the four acceptance recordings that styleguide.html embeds, plus a
 * frame-time report used to verify the 60fps budget at 390x844.
 *
 * Why a real browser and not the editor's preview pane: a hidden or backgrounded
 * tab has requestAnimationFrame throttled to a crawl (and, in the pane's case,
 * no layout at all). Any "recording" made there is a slideshow of a stage that
 * never actually ran. So this launches its own Chromium with background
 * throttling disabled and records the compositor's real output.
 *
 * Playwright is deliberately NOT a repository dependency -- nothing shipped
 * needs it. Point CROWN_PLAYWRIGHT at an install, or run it from a directory
 * where `playwright` resolves:
 *
 *   node work/record_stage.mjs                 # record all three clips + probe
 *   node work/record_stage.mjs --probe         # frame budget only, no video
 *   CROWN_PLAYWRIGHT=/path/to/node_modules/playwright node work/record_stage.mjs
 */
import { createServer } from "node:http";
import { execFileSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputs = path.join(root, "outputs");
const clipsDir = path.join(outputs, "clips");

const PHONE = { width: 390, height: 844 };
// Recorded at the phone size, published at three-quarters of it: an ink drawing
// survives the downscale intact and the three clips then fit the shipped bundle.
const CLIP_SCALE_W = 292;

/* The four acceptance recordings, and what each one has to show. */
const CLIPS = [
  {
    name: "field-15s",
    fixture: "field",
    ms: 15000,
    kbps: 230,
    what: "mid-size field battle at 1x -- the promo standard"
  },
  {
    name: "archer-volley",
    fixture: "archers",
    ms: 9000,
    kbps: 170,
    what: "the bow cycle close: nock, full draw, release snap, shafts in flight"
  },
  {
    name: "cavalry-charge",
    fixture: "cavalry",
    ms: 9000,
    kbps: 170,
    what: "the charge arriving ahead of the infantry and stopping on contact"
  },
  {
    name: "archer-kill",
    fixture: "archerKill",
    ms: 9000,
    kbps: 170,
    what: "one resolved archer kill: draw, flight, impact, recoil, ink, number, death"
  }
];

async function loadPlaywright() {
  const override = process.env.CROWN_PLAYWRIGHT;
  const candidates = [
    override && pathToFileURL(path.join(override, "index.js")).href,
    override,
    "playwright"
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const loaded = await import(candidate);
      // A CJS install shows up as { default: { chromium, ... } }.
      const module = loaded?.chromium ? loaded : loaded?.default;
      if (module?.chromium) return module;
    } catch { /* try the next one */ }
  }
  throw new Error(
    "playwright not found. Install it somewhere and set CROWN_PLAYWRIGHT to that "
    + "node_modules/playwright directory."
  );
}

/*
 * Playwright ships its own ffmpeg (that is how it writes video at all), so the
 * re-encode needs no system install. Its build is deliberately minimal --
 * matroska in, libvpx_vp8 out, scale/crop filters -- which is exactly enough.
 */
function ffmpegPath() {
  if (process.env.CROWN_FFMPEG) return process.env.CROWN_FFMPEG;
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const linux = path.join(os.homedir(), ".cache", "ms-playwright");
  for (const base of [cache, linux]) {
    if (!fs.existsSync(base)) continue;
    const dir = fs.readdirSync(base).find((name) => name.startsWith("ffmpeg-"));
    if (!dir) continue;
    const found = fs.readdirSync(path.join(base, dir)).find((name) => name.startsWith("ffmpeg-"));
    if (found) return path.join(base, dir, found);
  }
  return null;
}

async function transcode(from, to, clip) {
  const ffmpeg = ffmpegPath();
  if (!ffmpeg) {
    fs.copyFileSync(from, to);
    console.warn("  (no ffmpeg found; copied the raw recording, which is large)");
    return;
  }
  execFileSync(ffmpeg, [
    "-y", "-i", from,
    "-c:v", "libvpx",
    "-b:v", `${clip.kbps || 200}k`,
    "-crf", "34",
    "-vf", `scale=${CLIP_SCALE_W}:-2`,
    "-an",
    to
  ], { stdio: "ignore" });
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".webm": "video/webm",
  ".svg": "image/svg+xml"
};

function serve(directory) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      const url = new URL(request.url, "http://localhost");
      const file = path.join(directory, decodeURIComponent(url.pathname));
      if (!file.startsWith(directory) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        response.writeHead(404).end("not found");
        return;
      }
      response.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      fs.createReadStream(file).pipe(response);
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

/*
 * Frame-time sampling from inside the page.
 *
 * Reports the honest numbers rather than an average that hides the stutters:
 * the median frame, the 95th percentile, and how many frames blew the 16.7ms
 * budget. A promo clip is judged on its worst frames, not its mean.
 */
const PROBE = `(async (durationMs) => {
  const frames = [];
  let last = performance.now();
  await new Promise((done) => {
    const step = (now) => {
      frames.push(now - last);
      last = now;
      if (now - frames.start0 < durationMs) requestAnimationFrame(step); else done();
    };
    frames.start0 = performance.now();
    requestAnimationFrame(step);
  });
  const kept = frames.slice(2).sort((a, b) => a - b);
  const at = (q) => kept[Math.min(kept.length - 1, Math.floor(kept.length * q))];
  return {
    frames: kept.length,
    medianMs: +at(0.5).toFixed(2),
    p95Ms: +at(0.95).toFixed(2),
    worstMs: +kept[kept.length - 1].toFixed(2),
    over16_7: kept.filter((ms) => ms > 16.7).length,
    fps: +(1000 / at(0.5)).toFixed(1)
  };
})`;

async function main() {
  const probeOnly = process.argv.includes("--probe");
  const { chromium } = await loadPlaywright();
  const { server, port } = await serve(outputs);
  const url = `http://127.0.0.1:${port}/styleguide.html`;

  const browser = await chromium.launch({
    args: [
      // Without these a non-foreground Chromium throttles rAF and the whole
      // recording becomes a slideshow of a stage that never really ran.
      "--disable-background-timer-throttling",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--autoplay-policy=no-user-gesture-required"
    ]
  });

  const report = [];
  fs.mkdirSync(clipsDir, { recursive: true });

  for (const clip of CLIPS) {
    const context = await browser.newContext({
      viewport: PHONE,
      deviceScaleFactor: 2,
      recordVideo: probeOnly ? undefined : { dir: clipsDir, size: PHONE }
    });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "load" });
    // The stage measures itself when it is built, so give layout a real frame
    // before asking it to play.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));

    const info = await page.evaluate((fixture) => window.__SG_PLAY__(fixture), clip.fixture);
    const probe = await page.evaluate(`${PROBE}(${clip.ms})`);
    const beats = await page.evaluate(() => ({
      total: window.__SG_BEATS__.length,
      byType: window.__SG_BEATS__.reduce((all, beat) => {
        all[beat.type] = (all[beat.type] || 0) + 1;
        return all;
      }, {}),
      tiers: [...new Set(window.__SG_BEATS__.filter((b) => b.tier).map((b) => b.tier))],
      shakes: window.__SG_STAGE__.shakesSpent,
      countMismatches: window.__SG_COUNTS__.filter((entry) => (
        entry.header.player !== entry.live.player || entry.header.enemy !== entry.live.enemy ||
        entry.header.player !== entry.dom.player || entry.header.enemy !== entry.dom.enemy
      )).length
    }));

    const video = probeOnly ? null : page.video();
    await context.close();
    let bytes = 0;
    if (video) {
      const raw = await video.path();
      const target = path.join(clipsDir, `${clip.name}.webm`);
      fs.rmSync(target, { force: true });
      // Chromium writes VP8 at a default bitrate that is far more than an ink
      // drawing needs. Re-encode to the clip's own budget so four recordings
      // can live inside the shipped bundle instead of next to it.
      await transcode(raw, target, clip);
      fs.rmSync(raw, { force: true });
      bytes = fs.statSync(target).size;
    }
    report.push({ ...clip, tokens: info.tokens, probe, beats, bytes });
    console.log(
      `${clip.name.padEnd(15)} ${String(probe.fps).padStart(5)}fps median  `
      + `p95 ${String(probe.p95Ms).padStart(5)}ms  over-budget ${probe.over16_7}/${probe.frames}  `
      + `${probeOnly ? "" : `${(bytes / 1024).toFixed(0)}KB  `}`
      + `beats ${beats.total} ${JSON.stringify(beats.byType)} tiers=${beats.tiers.join("/")} `
      + `shakes=${beats.shakes} count-mismatches=${beats.countMismatches}`
    );
  }

  // Final acceptance still: halfway through the charge on the exact phone
  // viewport. This is early enough for the four travel speeds to be visible
  // and late enough for the cavalry to have reached the front.
  const stillContext = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const stillPage = await stillContext.newPage();
  await stillPage.goto(url, { waitUntil: "load" });
  await stillPage.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await stillPage.evaluate(() => window.__SG_PLAY__("field"));
  const stillAtMs = 4100;
  await stillPage.waitForTimeout(3100);
  const rangeVisible = await stillPage.evaluate(() => {
    const arc = document.querySelector(".stage-range-arc path");
    return Boolean(arc && getComputedStyle(arc).strokeDasharray !== "none");
  });
  await stillPage.waitForTimeout(stillAtMs - 3100);
  const positions = await stillPage.evaluate(() => window.__SG_STAGE__.unitPositions);
  const player = positions.filter((token) => token.side === "player");
  const median = (values) => {
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  };
  const groups = {
    cavalry: median(player.filter((token) => token.arm === "cavalry").map((token) => token.x)),
    militia: median(player.filter((token) => token.arm === "spear" && token.troopType === "militia").map((token) => token.x)),
    veteran: median(player.filter((token) => token.arm === "spear" && token.troopType === "veteran").map((token) => token.x)),
    archer: median(player.filter((token) => token.arm === "archer").map((token) => token.x))
  };
  const stillFile = path.join(root, "work", "fixtures", "unit-behavior-midcharge.png");
  await stillPage.screenshot({ path: stillFile });
  await stillContext.close();
  const staggered = groups.cavalry > Math.max(groups.militia, groups.veteran)
    && groups.archer < Math.min(groups.militia, groups.veteran);
  if (!staggered) throw new Error(`unit arrival tiers are not readable: ${JSON.stringify(groups)}`);
  if (!rangeVisible) throw new Error("first archer volley did not render its dashed range arc");
  report.push({
    name: "unit-behavior-midcharge",
    fixture: "field",
    atMs: stillAtMs,
    viewport: PHONE,
    groups,
    staggered,
    rangeVisible,
    screenshot: "work/fixtures/unit-behavior-midcharge.png"
  });
  console.log(
    `unit still      ${JSON.stringify(groups)} staggered=${staggered} range=${rangeVisible}`
  );

  // Facing acceptance still: the flank fixture deliberately places player
  // token 5 to the right of enemy token 1. The attacker must pivot left; the
  // defender is struck from behind, staggers forward, then pivots right.
  const facingContext = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 2 });
  const facingPage = await facingContext.newPage();
  await facingPage.goto(url, { waitUntil: "load" });
  await facingPage.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  await facingPage.evaluate(() => window.__SG_PLAY__("flank"));
  const facingAtMs = 9500;
  await facingPage.waitForTimeout(facingAtMs);
  const facingProof = await facingPage.evaluate(() => {
    const positions = window.__SG_STAGE__.unitPositions;
    const attacker = positions.find((token) => token.side === "player" && token.idx === 5);
    const target = positions.find((token) => token.side === "enemy" && token.idx === 1);
    const beats = window.__SG_BEATS__ || [];
    const toward = (from, to) => (to.x > from.x ? 1 : -1);
    const ordered = [attacker, target].slice().sort((a, b) => a.x - b.x);
    return {
      attacker,
      target,
      faceEachOther: attacker.facing === toward(attacker, target)
        && target.facing === toward(target, attacker),
      backToBack: ordered[0].facing === -1 && ordered[1].facing === 1,
      rearHits: beats.filter((beat) => beat.type === "rear_hit").length,
      turns: beats.filter((beat) => beat.type === "turn").length
    };
  });
  const facingFile = path.join(root, "work", "fixtures", "facing-midmelee.png");
  await facingPage.screenshot({ path: facingFile });
  await facingContext.close();
  if (!facingProof.faceEachOther || facingProof.backToBack) {
    throw new Error(`flanked fighters did not face each other: ${JSON.stringify(facingProof)}`);
  }
  if (facingProof.rearHits < 1 || facingProof.turns < 2) {
    throw new Error(`flank fixture missed rear-hit/turn beats: ${JSON.stringify(facingProof)}`);
  }
  report.push({
    name: "facing-midmelee",
    fixture: "flank",
    atMs: facingAtMs,
    viewport: PHONE,
    ...facingProof,
    screenshot: "work/fixtures/facing-midmelee.png"
  });
  console.log(
    `facing still    attacker=${facingProof.attacker.x.toFixed(1)}/${facingProof.attacker.facing} `
    + `target=${facingProof.target.x.toFixed(1)}/${facingProof.target.facing} `
    + `rear=${facingProof.rearHits} turns=${facingProof.turns}`
  );

  await browser.close();
  server.close();
  fs.writeFileSync(
    path.join(root, "work", "fixtures", "stage-recording-report.json"),
    `${JSON.stringify(report, null, 2)}\n`
  );
  console.log(`\nreport -> work/fixtures/stage-recording-report.json`);
  if (!probeOnly) {
    const total = fs.readdirSync(clipsDir)
      .reduce((sum, file) => sum + fs.statSync(path.join(clipsDir, file)).size, 0);
    console.log(`clips  -> outputs/clips (${(total / 1024).toFixed(0)}KB total)`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

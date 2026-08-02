import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUTPUTS = path.join(ROOT, "outputs");
const JS_DIR = path.join(OUTPUTS, "js");

class MemoryStorage {
  constructor() {
    this.values = new Map();
    this.writes = 0;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
    this.writes += 1;
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalState(value, { lifecycle = true } = {}) {
  const result = clone(value);
  delete result.lastSavedTick;
  if (result.player) delete result.player.prevPos;
  for (const lord of result.lords || []) delete lord.prevPos;
  for (const bandit of result.bandits || []) delete bandit.prevPos;
  if (!lifecycle && result.telemetry) {
    delete result.telemetry.sessionStart;
    delete result.telemetry.sessionEnd;
  }
  return result;
}

function flatten(value, prefix = "", target = new Map()) {
  if (value === null || typeof value !== "object") {
    target.set(prefix, value);
    return target;
  }
  for (const [key, child] of Object.entries(value)) {
    flatten(child, prefix ? `${prefix}.${key}` : key, target);
  }
  return target;
}

function findSemantic(object, patterns, predicate = () => true) {
  const entries = [...flatten(object).entries()];
  return entries.find(([key, value]) => patterns.some((pattern) => pattern.test(key)) && predicate(value));
}

function findContainer(object, patterns, prefix = "") {
  if (!object || typeof object !== "object") return null;
  for (const [key, value] of Object.entries(object)) {
    const current = prefix ? `${prefix}.${key}` : key;
    if (patterns.some((pattern) => pattern.test(current))) return [current, value];
    const nested = findContainer(value, patterns, current);
    if (nested) return nested;
  }
  return null;
}

function isIsoOrNull(value) {
  return value === null || isStrictIso(value);
}

function isStrictIso(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function sourceFiles() {
  if (!fs.existsSync(JS_DIR)) return [];
  return fs.readdirSync(JS_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(JS_DIR, name));
}

function shippedFiles() {
  if (!fs.existsSync(OUTPUTS)) return [];
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else files.push(absolute);
    }
  };
  visit(OUTPUTS);
  return files;
}

function shippedTextFiles() {
  return shippedFiles().filter((file) => /\.(?:js|mjs|html|css|json|webmanifest|svg|txt)$/i.test(file));
}

function shippedTextBundle() {
  return shippedTextFiles().map((file) => `\n/* ${path.relative(OUTPUTS, file)} */\n${fs.readFileSync(file, "utf8")}`).join("");
}

function sourceBundle() {
  return sourceFiles().map((file) => `\n/* ${path.basename(file)} */\n${fs.readFileSync(file, "utf8")}`).join("");
}

function configEntry(config, patterns) {
  return Object.entries(config).find(([key]) => patterns.some((pattern) => pattern.test(key)));
}

function requireConfig(config, label, patterns, expected) {
  const entry = configEntry(config, patterns);
  assert.ok(entry, `CONFIG must define ${label}`);
  if (expected !== undefined) assert.equal(entry[1], expected, `${entry[0]} must equal ${expected}`);
  return entry[1];
}

function firstFunction(modules, names) {
  for (const module of modules) {
    if (!module) continue;
    for (const name of names) {
      if (typeof module[name] === "function") return module[name];
    }
  }
  return null;
}

function requireFunction(modules, names, purpose) {
  const fn = firstFunction(modules, names);
  assert.ok(fn, `${purpose} requires one exported API: ${names.join(" / ")}`);
  return fn;
}

const moduleImportFailures = [];

async function importOptional(relativePath) {
  const file = path.join(OUTPUTS, relativePath);
  if (!fs.existsSync(file)) return null;
  try {
    return await import(`${pathToFileURL(file).href}?phase25=${Date.now()}`);
  } catch (error) {
    moduleImportFailures.push({ relativePath, message: error?.message || String(error) });
    return null;
  }
}

const stateModule = await importOptional("js/state.js");
const simModule = await importOptional("js/sim.js");
const battleModule = await importOptional("js/battle.js");
const aiModule = await importOptional("js/ai.js");
const dataModule = await importOptional("js/data.js");
const stringsModule = await importOptional("js/strings.js");
const rngModule = await importOptional("js/rng.js");
const actsModule = await importOptional("js/acts.js");
const onboardingModule = await importOptional("js/onboarding.js");
const telemetryModule = await importOptional("js/telemetry.js");
const demoModule = await importOptional("js/demo.js");
const livingModule = await importOptional("js/living.js");
const casualModule = await importOptional("js/casual.js");
const contractsModule = await importOptional("js/contracts.js");
const shareModule = await importOptional("js/share.js");
const autoplayModule = await importOptional("js/autoplay.js");
const optionalModules = [demoModule, livingModule, casualModule, actsModule, onboardingModule, telemetryModule, contractsModule, shareModule, autoplayModule];

const CONFIG = dataModule?.CONFIG || {};
const TROOP_TYPES = dataModule?.TROOP_TYPES || {};
const createInitialState = stateModule?.createInitialState;
const saveState = stateModule?.saveState;
const loadState = stateModule?.loadState;
const isValidState = stateModule?.isValidState;
const worldTick = simModule?.worldTick;
const autosaveState = stateModule?.autosaveState;

const tests = [];
const diagnostics = { autoplay: [], tuning: [] };

function test(name, fn) {
  tests.push({ name, fn });
}

function advance(state, ticks, storage = null) {
  let result = null;
  for (let index = 0; index < ticks; index += 1) {
    result = worldTick(state);
    if (!result?.advanced && state.demo?.modal === "roadEvent") {
      const chooseRoadEvent = firstFunction([casualModule, simModule], ["chooseRoadEvent", "applyRoadEventChoice"]);
      assert.ok(chooseRoadEvent, "deterministic continuation tests need the production road-event choice resolver");
      assert.equal(chooseRoadEvent(state, CONFIG.AUTOPLAY_ROAD_EVENT_CHOICE_INDEX ?? 0)?.ok, true);
      index -= 1;
      continue;
    }
    if (storage && autosaveState) autosaveState(state, result, storage);
  }
  return result;
}

function totalTroops(party) {
  return (party?.troops || []).reduce((sum, stack) => sum + stack.count, 0);
}

function setStack(party, type, count, xp = 0) {
  party.troops = [{ type, count, xp }];
}

function makeLegacyV1(seed = 0x00c0ffee) {
  const legacy = createInitialState(seed);
  legacy.saveVersion = 1;
  delete legacy.telemetry;
  delete legacy.onboarding;
  delete legacy.ending;
  delete legacy.contract;
  delete legacy.contracts;
  delete legacy.demo;
  delete legacy.activeSeconds;
  delete legacy.session;
  if (legacy.player) {
    legacy.player.act = 1;
    legacy.player.promises = [];
    delete legacy.player.promiseMarkers;
    delete legacy.player.peakTroops;
    delete legacy.player.peakGold;
  }
  for (const bandit of legacy.bandits || []) {
    delete bandit.elite;
    delete bandit.isElite;
    delete bandit.lootMultiplier;
  }
  return legacy;
}

function telemetryOf(state) {
  assert.ok(state.telemetry && typeof state.telemetry === "object", "state.telemetry must be an object");
  return state.telemetry;
}

function beginTelemetrySession(state, at = "2026-08-02T00:00:00.000Z") {
  const start = firstFunction([telemetryModule], ["startTelemetrySession", "beginTelemetrySession"]);
  if (start) start(state, at);
  return state;
}

function assertTelemetrySchema(state) {
  const telemetry = telemetryOf(state);
  const nonnegativeNumber = (value) => Number.isFinite(value) && value >= 0;
  const requiredNumbers = [
    ["total active seconds", [/total.*active.*seconds/i, /active.*seconds/i]],
    ["battles fought", [/battles?.*fought/i, /battle.*total/i]],
    ["battles won", [/battles?.*won/i, /battle.*wins?/i]],
    ["battles fled", [/battles?.*fled/i, /battle.*flee/i]],
    ["town entries", [/town.*entr/i]],
    ["recruit clicks", [/recruit.*click/i]],
    ["tooltip views", [/tooltip.*views?/i]],
    ["replay count", [/replay.*count/i]]
  ];
  for (const [label, patterns] of requiredNumbers) {
    const match = findSemantic(telemetry, patterns, nonnegativeNumber);
    assert.ok(match, `telemetry must contain numeric ${label}`);
  }

  const start = findSemantic(telemetry, [/session.*start/i], isStrictIso);
  const end = findSemantic(telemetry, [/session.*end/i], isIsoOrNull);
  assert.ok(start, "telemetry must contain an ISO sessionStart");
  assert.ok(end, "telemetry must contain nullable/ISO sessionEnd");
  assert.ok(findContainer(telemetry, [/promises?/i]), "telemetry must contain promise values/final actuals");
  assert.ok(findContainer(telemetry, [/act.*timestamps?/i, /acts?.*at/i]), "telemetry must contain act timestamps");
  const quit = findSemantic(telemetry, [/quit.*point/i], (value) => value === null || typeof value === "string");
  assert.ok(quit, "telemetry must contain nullable/string quit point");

  const promiseValues = findContainer(telemetry, [/promiseValues$/i])?.[1];
  const promiseActuals = findContainer(telemetry, [/promiseFinalActuals$/i, /promise.*actuals$/i])?.[1];
  if (promiseValues) {
    assert.ok(Object.hasOwn(promiseValues, "troops") && Object.hasOwn(promiseValues, "gold"), "promise telemetry needs troop and gold values");
  }
  if (promiseActuals) {
    assert.ok(Object.hasOwn(promiseActuals, "troops") && Object.hasOwn(promiseActuals, "gold"), "promise telemetry needs troop and gold final actuals");
  }
  const timestamps = findContainer(telemetry, [/actTimestamps$/i])?.[1];
  if (timestamps) {
    assert.ok(isStrictIso(timestamps.act1), "Act 1 timestamp must be strict ISO UTC");
    assert.ok(isIsoOrNull(timestamps.act2) && isIsoOrNull(timestamps.ending), "Act 2/ending timestamps must be nullable ISO values");
  }
  const tooltipViews = findContainer(telemetry, [/tooltipViews$/i])?.[1];
  if (tooltipViews) {
    for (const id of ["town", "lowGold", "act2"]) assert.ok(Number.isFinite(tooltipViews[id]) && tooltipViews[id] >= 0, `tooltipViews.${id} must be numeric`);
  }
  assert.ok(Array.isArray(telemetry.eventChoices), "telemetry must contain an event-card choice list");
}

function eliteBandits(state) {
  return (state.bandits || []).filter((bandit) => bandit.elite === true || bandit.isElite === true || bandit.kind === "elite");
}

function partyStrength(party) {
  return (party?.troops || []).reduce((sum, stack) => sum + (TROOP_TYPES[stack.type]?.atk || 0) * stack.count, 0);
}

function translatedValues(language) {
  return [...flatten(stringsModule.STRINGS[language]).values()].filter((value) => typeof value === "string");
}

function placeholders(value) {
  return [...String(value).matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
}

test("smoke: every production ES module imports cleanly", async () => {
  const pureModules = [
    "js/data.js", "js/rng.js", "js/strings.js", "js/telemetry.js", "js/demo.js",
    "js/state.js", "js/living.js", "js/ai.js", "js/battle.js", "js/sim.js",
    "js/contracts.js", "js/autoplay.js"
  ];
  for (const relativePath of pureModules) await importOptional(relativePath);
  assert.deepEqual(moduleImportFailures, [], `module import failures:\n${moduleImportFailures.map((entry) => `${entry.relativePath}: ${entry.message}`).join("\n")}`);
});

test("static: Phase 2.5 demo gates and timing constants", () => {
  assert.ok(dataModule, "data.js must import");
  assert.equal(dataModule.DEMO ?? CONFIG.DEMO, true, "DEMO must be literal true");
  requireConfig(CONFIG, "Act 2 renown gate", [/ACT.*(?:1|2).*RENOWN/i, /RENOWN.*ACT.*2/i], 50);
  requireConfig(CONFIG, "demo ending renown gate", [/DEMO.*END.*RENOWN/i, /END.*RENOWN/i], 100);
  requireConfig(CONFIG, "autoplay multiplier", [/AUTOPLAY.*(SPEED|MULTIPLIER)/i], 20);
  assert.equal(CONFIG.PROMISE_TROOPS_DEFAULT, 60, "troop-promise default must live in CONFIG");
  assert.equal(CONFIG.PROMISE_GOLD_DEFAULT, 500, "gold-promise default must live in CONFIG");
  requireConfig(CONFIG, "version", [/^(APP_|BUILD_)?VERSION$/i]);
  const maximumAct = configEntry(CONFIG, [/^DEMO_MAX_ACT$/i, /(?:^|_)MAX_ACT$/i]);
  assert.ok(maximumAct && maximumAct[1] === 2, "DEMO must explicitly cap progression at Act 2");
});

test("static: exact onboarding, tooltip, mirror, ending, and share copy", () => {
  assert.ok(stringsModule?.STRINGS?.zh, "strings.js must export STRINGS.zh");
  const values = translatedValues("zh");
  const exact = [
    "①拖动地图,你的队伍会前进",
    "②灰点是匪队——打赢拿钱和声望",
    "③金币每天在减少。去打猎吧",
    "多少兵力会让你觉得安全?",
    "在这里招兵",
    "军饷快发不出了",
    "酒馆里有雇佣合同",
    "试玩终",
    "你两次上调了'够了'。完整版会问你第三次。",
    "把结果发给 Ja",
    "再玩一局(新种子)",
    "已复制,粘贴给 Ja 就行",
    "声望 {renown}/100 → 试玩终点",
    "进攻"
  ];
  for (const text of exact) assert.ok(values.includes(text), `missing exact zh string: ${text}`);
  assert.ok(values.some((value) => value.includes("上一幕你说") && value.includes("你招到了") && value.includes("多少金币才够")), "Act 2 gold-promise modal copy is missing");
  assert.ok(values.some((value) => value.includes("你说") && /\{[^}]+\}/.test(value)), "mirror HUD/table needs parameterized 你说 copy");
  assert.ok(values.includes("我的《王冠》试玩结果:crown1.{payload}") || sourceBundle().includes("我的《王冠》试玩结果:crown1."), "share prefix must be exact");
});

test("static: Phase 2.5 translation parity and visible build version", () => {
  assert.ok(stringsModule?.STRINGS?.zh && stringsModule?.STRINGS?.en);
  const zh = flatten(stringsModule.STRINGS.zh);
  const en = flatten(stringsModule.STRINGS.en);
  assert.deepEqual([...zh.keys()], [...en.keys()], "zh/en string key topology must match exactly");
  for (const [key, value] of zh) {
    if (typeof value !== "string") continue;
    assert.ok(value.length > 0 && String(en.get(key) || "").length > 0, `${key} must be nonempty in both languages`);
    assert.deepEqual(placeholders(value), placeholders(en.get(key)), `${key} placeholder sets must match`);
  }
  const version = configEntry(CONFIG, [/^(APP_|BUILD_)?VERSION$/i])?.[1];
  assert.ok(typeof version === "string" && version.trim().length > 0, "build version must be a nonempty string");
  const index = fs.readFileSync(path.join(OUTPUTS, "index.html"), "utf8");
  const main = fs.readFileSync(path.join(JS_DIR, "main.js"), "utf8");
  assert.match(index, /version/i, "UI must include a visible version element");
  const sources = sourceBundle();
  assert.ok(
    main.includes("BUILD_VERSION") ||
      main.includes("APP_VERSION") ||
      /(?:version|build)[\s\S]{0,160}(?:textContent|innerText)[\s\S]{0,160}CONFIG\.(?:BUILD_VERSION|APP_VERSION|VERSION)|(?:textContent|innerText)[\s\S]{0,160}CONFIG\.(?:BUILD_VERSION|APP_VERSION|VERSION)/i.test(sources),
    "UI must populate the version from CONFIG"
  );
  if (telemetryModule?.buildPlaytestPayload && createInitialState) {
    const state = createInitialState(33);
    const payload = telemetryModule.buildPlaytestPayload(state);
    assert.equal(payload.build, version, "share telemetry must carry the exact visible build version");
  }
});

test("static: every emitted living-world event has zh/en copy", () => {
  const emitted = new Set();
  for (const file of sourceFiles().filter((candidate) => path.basename(candidate) !== "strings.js")) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/["'](log\.[A-Za-z0-9_]+)["']/g)) emitted.add(match[1]);
  }
  assert.ok(emitted.size > 0, "production modules must emit living-world events");
  const zh = flatten(stringsModule.STRINGS.zh);
  const en = flatten(stringsModule.STRINGS.en);
  const missingZh = [...emitted].filter((key) => !zh.has(key));
  const missingEn = [...emitted].filter((key) => !en.has(key));
  assert.deepEqual(missingZh, [], `visible event keys missing zh copy: ${missingZh.join(", ")}`);
  assert.deepEqual(missingEn, [], `visible event keys missing en copy: ${missingEn.join(", ")}`);
});

test("static: no forbidden technology or content leakage", () => {
  assert.deepEqual(Object.keys(TROOP_TYPES).sort(), ["bandit", "militia", "veteran"], "no new troop types are allowed");
  const source = shippedTextBundle();
  const forbidden = [
    ["cookies", /document\.cookie|cookieStore/i],
    ["alternate persistence", /sessionStorage|indexedDB/i],
    ["quests", /\bquests?\b/i],
    ["difficulty modes", /\bdifficult(?:y|ies)\b/i],
    ["sound/audio", /new\s+Audio\b|AudioContext|<audio\b/i],
    ["accounts/auth", /\b(?:login|logout|signIn|signUp|accountId|authentication)\b/i],
    ["third-party SDK", /\b(?:firebase|supabase|sentry|mixpanel|amplitude|gtag)\b/i],
    ["unseeded randomness", /Math\.random\s*\(/],
    ["network/backend APIs", /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/]
  ];
  for (const [label, pattern] of forbidden) assert.ok(!pattern.test(source), `${label} are forbidden`);
  for (const file of shippedTextFiles().filter((candidate) => /\.m?js$/i.test(candidate))) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      assert.ok(match[1].startsWith("."), `${path.basename(file)} has a non-relative dependency: ${match[1]}`);
    }
  }
  const demoState = createInitialState(CONFIG.SEED, { skipOnboarding: true });
  assert.equal(demoState.features.f2, false, "Acts 3–4 must remain disabled in a DEMO state");
  assert.equal(demoState.kingdom.founded, false, "the demo must not begin with full-version kingdom state active");
});

test("static: decode page, iOS/A2HS, GitHub Pages paths, and size", () => {
  const indexPath = path.join(OUTPUTS, "index.html");
  const decodePath = path.join(OUTPUTS, "decode.html");
  assert.ok(fs.existsSync(indexPath), "index.html is required");
  assert.ok(fs.existsSync(decodePath), "unlinked decode.html is required");
  const index = fs.readFileSync(indexPath, "utf8");
  const decode = fs.readFileSync(decodePath, "utf8");
  const linksToDecode = shippedTextFiles()
    .filter((file) => file !== decodePath && fs.readFileSync(file, "utf8").includes("decode.html"));
  assert.deepEqual(linksToDecode, [], `decode.html must remain unlinked; references found in ${linksToDecode.map((file) => path.relative(OUTPUTS, file)).join(", ")}`);
  assert.match(decode, /textarea|input/i, "decode.html needs pasted-code input");
  assert.match(decode, /table/i, "decode.html needs a readable telemetry table");
  assert.match(index, /viewport-fit=cover/i, "viewport must support iOS safe areas");
  assert.match(index, /name=["']apple-mobile-web-app-capable["'][^>]*content=["']yes["']|content=["']yes["'][^>]*name=["']apple-mobile-web-app-capable["']/i, "iOS A2HS capable meta must explicitly be yes");
  const manifestMatch = index.match(/<link[^>]*rel=["']manifest["'][^>]*href=["']([^"']+)["']|<link[^>]*href=["']([^"']+)["'][^>]*rel=["']manifest["']/i);
  assert.ok(manifestMatch, "A2HS web manifest link is required");
  const manifestHref = manifestMatch[1] || manifestMatch[2];
  assert.ok(!/^\/|^https?:/i.test(manifestHref), "manifest path must remain relative for GitHub Pages");
  const manifestPath = path.resolve(OUTPUTS, manifestHref.split(/[?#]/)[0]);
  assert.ok(fs.existsSync(manifestPath), `manifest target does not exist: ${manifestHref}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.ok(typeof manifest.name === "string" && manifest.name.trim(), "manifest needs a name");
  assert.equal(manifest.display, "standalone", "manifest display must be standalone");
  assert.ok(typeof manifest.start_url === "string" && !/^\/|^https?:/i.test(manifest.start_url), "manifest start_url must be repository-relative");
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length > 0, "manifest needs at least one A2HS icon");
  for (const icon of manifest.icons) {
    assert.ok(typeof icon.src === "string" && icon.src, "manifest icon needs src");
    if (!icon.src.startsWith("data:")) assert.ok(fs.existsSync(path.resolve(path.dirname(manifestPath), icon.src)), `manifest icon is missing: ${icon.src}`);
  }
  const css = fs.readFileSync(path.join(OUTPUTS, "css/ui.css"), "utf8");
  assert.match(css, /safe-area-inset/i, "CSS must account for iOS safe areas");
  for (const htmlFile of shippedFiles().filter((file) => file.endsWith(".html"))) {
    const html = fs.readFileSync(htmlFile, "utf8");
    for (const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
      const url = match[1];
      assert.ok(!/^https?:|^\/\//i.test(url), `external URL is forbidden: ${url}`);
      if (url.startsWith("#") || url.startsWith("data:")) continue;
      assert.ok(!url.startsWith("/"), `GitHub Pages asset path must be relative: ${url}`);
      const target = path.resolve(path.dirname(htmlFile), url.split(/[?#]/)[0]);
      assert.ok(fs.existsSync(target), `${path.relative(OUTPUTS, htmlFile)} references missing asset ${url}`);
    }
  }
  const totalBytes = shippedFiles().reduce((sum, file) => sum + fs.statSync(file).size, 0);
  assert.ok(totalBytes < 2_000_000, `total output is ${totalBytes} bytes; must stay below 2 MB`);
});

test("static/runtime: autoplay is URL-only and exactly 20x", () => {
  const autoplayFactor = firstFunction(
    [autoplayModule, ...optionalModules],
    ["autoplayMultiplier", "getAutoplayMultiplier", "getAutoplaySpeed"]
  );
  if (autoplayFactor) {
    assert.equal(autoplayFactor("?autoplay=1"), 20);
    for (const query of ["", "?autoplay=0", "?autoplay=true", "?speed=20", "?autoplay=1&speed=50"]) {
      assert.equal(autoplayFactor(query), query.startsWith("?autoplay=1") ? 20 : 1, `unexpected autoplay factor for ${query}`);
    }
  }
  const html = fs.readFileSync(path.join(OUTPUTS, "index.html"), "utf8");
  assert.ok(!/id=["'][^"']*(?:autoplay|speed)[^"']*["']/i.test(html), "autoplay/speed must not have visible controls");
  const main = fs.readFileSync(path.join(JS_DIR, "main.js"), "utf8");
  assert.match(main, /URLSearchParams/, "production boot must read autoplay from the URL");
  assert.match(main, /autoplay/, "production boot must wire the autoplay query flag");
  assert.match(main, /AUTOPLAY.*(?:SPEED|MULTIPLIER)|getAutoplay|autoplayMultiplier/, "production scheduler must consume the exact autoplay multiplier");
});

test("save: migrate a Phase 1 save and preserve core progress", () => {
  assert.equal(typeof createInitialState, "function");
  assert.equal(typeof loadState, "function");
  assert.ok(Number.isInteger(CONFIG.SAVE_VERSION) && CONFIG.SAVE_VERSION > 1, "Phase 2.5 must bump SAVE_VERSION above 1");
  const fixturePath = path.join(HERE, "fixtures/phase1-save.json");
  assert.ok(fs.existsSync(fixturePath), "checked-in raw Phase 1 fixture is required");
  const legacy = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  legacy.tick = 119;
  legacy.player.gold = 321;
  legacy.player.renown = 37;
  legacy.player.pos = { x: 777, y: 888 };
  legacy.settings.language = "en";
  if (rngModule?.nextFloat) rngModule.nextFloat(legacy.rng);
  const currentKeyStorage = new MemoryStorage();
  currentKeyStorage.setItem(CONFIG.SAVE_KEY, JSON.stringify(legacy));
  const migrated = loadState(currentKeyStorage);
  assert.ok(migrated, "loadState must migrate valid saveVersion 1 data");
  assert.equal(migrated.saveVersion, CONFIG.SAVE_VERSION);
  assert.equal(migrated.seed, legacy.seed);
  assert.equal(migrated.tick, 119);
  assert.equal(migrated.player.gold, 321);
  assert.equal(migrated.player.renown, 37);
  assert.deepEqual(migrated.player.pos, { x: 777, y: 888 });
  assert.equal(migrated.settings.language, "en");
  assert.deepEqual(migrated.rng, legacy.rng, "migration must preserve the RNG cursor");
  assert.deepEqual(migrated.towns.map((town) => ({ id: town.id, pos: town.pos, factionId: town.factionId })), legacy.towns.map((town) => ({ id: town.id, pos: town.pos, factionId: town.factionId })), "migration must preserve town identity, position, and owner");
  assert.deepEqual(migrated.lords.map((lord) => ({ id: lord.id, pos: lord.pos, moveTarget: lord.moveTarget, troops: lord.troops, gold: lord.gold })), legacy.lords.map((lord) => ({ id: lord.id, pos: lord.pos, moveTarget: lord.moveTarget, troops: lord.troops, gold: lord.gold })), "migration must preserve lord progress");
  assert.deepEqual(migrated.bandits.map((bandit) => bandit.id).sort(), legacy.bandits.map((bandit) => bandit.id).sort(), "migration must preserve bandit identities");
  assert.deepEqual(migrated.stats.days, legacy.stats.days);
  assert.deepEqual(migrated.battle, legacy.battle);
  assert.equal(eliteBandits(migrated).length, 1, "migration must deterministically repair exactly one elite");
  assert.equal(migrated.demo?.modal, "onboarding", "migrated users must receive the new first-launch onboarding once");
  beginTelemetrySession(migrated);
  assertTelemetrySchema(migrated);
  assert.ok(!isValidState || isValidState(migrated), "migrated state must validate");
  if (rngModule?.nextFloat) {
    const expectedRng = clone(legacy.rng);
    const actualRng = clone(migrated.rng);
    assert.equal(rngModule.nextFloat(actualRng), rngModule.nextFloat(expectedRng), "first post-migration RNG draw must continue exactly");
  }

  const migratedRoundTrip = new MemoryStorage();
  assert.notEqual(saveState(migrated, migratedRoundTrip), false, "migrated state must serialize under the current key");
  const migratedReloaded = loadState(migratedRoundTrip);
  assert.deepEqual(canonicalState(migratedReloaded), canonicalState(migrated), "migrated state must survive a second current-schema round-trip");

  if (CONFIG.SAVE_KEY !== "the-crown.phase1.world-state") {
    const historicalKeyOnly = new MemoryStorage();
    historicalKeyOnly.setItem("the-crown.phase1.world-state", JSON.stringify(legacy));
    const historical = loadState(historicalKeyOnly);
    assert.ok(historical, "loadState must probe the historical Phase 1 key when SAVE_KEY changes");
    assert.equal(historical.player.gold, 321);
    assert.equal(historical.rng.value, legacy.rng.value);
  }
});

test("save: current schema JSON round-trip is lossless", () => {
  const state = beginTelemetrySession(createInitialState(0));
  const storage = new MemoryStorage();
  state.paused = true;
  state.player.gold = 213;
  state.player.renown = 51;
  state.stats.peakGold = 213;
  state.telemetry.eventChoices.push({ eventId: "save-probe", choiceIndex: 1, day: 2, delta: { gold: 4 } });
  assert.ok(saveState(state, storage), "saveState should succeed");
  const raw = storage.getItem(CONFIG.SAVE_KEY);
  assert.doesNotThrow(() => JSON.parse(raw));
  const loaded = loadState(storage);
  assert.ok(loaded);
  assert.deepEqual(canonicalState(loaded), canonicalState(state));
  assertTelemetrySchema(loaded);
});

test("save/RNG: interrupted continuation equals uninterrupted simulation", () => {
  assert.equal(typeof worldTick, "function");
  const uninterrupted = createInitialState(424242, { skipOnboarding: true, startedAt: "2026-08-02T00:00:00.000Z" });
  const interrupted = createInitialState(424242, { skipOnboarding: true, startedAt: "2026-08-02T00:00:00.000Z" });
  uninterrupted.player.moveTarget = { x: 1500, y: 500 };
  interrupted.player.moveTarget = { x: 1500, y: 500 };
  advance(uninterrupted, 137);
  advance(interrupted, 137);
  assert.equal(uninterrupted.tick, 137, "continuity prelude must actually advance simulation");
  const storage = new MemoryStorage();
  assert.ok(saveState(interrupted, storage));
  const restored = loadState(storage);
  advance(uninterrupted, 240);
  advance(restored, 240);
  assert.deepEqual(canonicalState(restored, { lifecycle: false }), canonicalState(uninterrupted, { lifecycle: false }));
});

test("onboarding: three exact steps, troop promise bounds, and persistence", () => {
  const advanceOnboarding = requireFunction(
    [demoModule, onboardingModule, actsModule, simModule, stateModule],
    ["advanceOnboarding", "nextOnboardingStep"],
    "onboarding progression"
  );
  const setPromise = requireFunction(
    [demoModule, onboardingModule, actsModule, simModule, stateModule],
    ["setTroopPromise", "submitTroopPromise", "recordActOnePromise", "submitPromise", "setPromise"],
    "Act 1 troop promise"
  );
  const state = createInitialState(71);
  const beforeTick = state.tick;
  worldTick(state);
  assert.equal(state.tick, beforeTick, "simulation must not advance behind first-launch onboarding");
  for (let step = 1; step <= 3; step += 1) assert.notEqual(advanceOnboarding(state)?.advanced, false, `tap ${step} must advance exactly one onboarding screen`);
  assert.equal(state.demo?.modal, "troopPromise", "the third tap must open the troop promise, with no fourth tutorial line");
  const belowMinimum = clone(state);
  setPromise(belowMinimum, 9);
  let promise = (belowMinimum.player.promises || [])[0];
  assert.ok(!promise || promise.statedGoal >= 10, "troop promise must reject or clamp below 10");
  setPromise(state, 200);
  promise = state.player.promises[0];
  assert.equal(promise.statedGoal ?? promise.value, 200);
  const storage = new MemoryStorage();
  saveState(state, storage);
  const loaded = loadState(storage);
  const completed = findSemantic(loaded, [/onboarding.*(complete|done)/i], (value) => value === true);
  assert.ok(completed, "completed onboarding must remain completed after reload");
  assert.equal((loaded.player.promises[0].statedGoal ?? loaded.player.promises[0].value), 200);
});

test("onboarding: only three one-time persisted tooltips", () => {
  const markTooltip = firstFunction([demoModule, onboardingModule, telemetryModule, simModule, stateModule], ["markTooltipViewed", "recordTooltipView", "showTooltipOnce"]);
  const queueTooltip = firstFunction([demoModule, onboardingModule], ["queueTooltip"]);
  const consumeTooltip = firstFunction([demoModule, onboardingModule], ["consumeTooltip"]);
  assert.ok(markTooltip || (queueTooltip && consumeTooltip), "one-time tooltip persistence needs markTooltipViewed or queueTooltip+consumeTooltip exports");
  const state = createInitialState(72);
  if (state.demo) {
    state.demo.modal = null;
    state.demo.pauseReason = null;
    state.paused = false;
  }
  const tooltipIds = ["town", "lowGold", "act2"];
  for (const id of tooltipIds) {
    if (markTooltip) {
      const first = markTooltip(state, id);
      const second = markTooltip(state, id);
      assert.notEqual(first, false, `${id} tooltip should show once`);
      assert.ok(second === false || second?.shown === false, `${id} tooltip must not show twice`);
    } else {
      assert.equal(queueTooltip(state, id), true, `${id} tooltip should queue once`);
      assert.equal(consumeTooltip(state), id, `${id} tooltip should be consumed once`);
      assert.equal(queueTooltip(state, id), false, `${id} tooltip must not queue twice`);
      assert.equal(consumeTooltip(state), null, `${id} tooltip must not show twice`);
    }
  }
  const seen = findContainer(state, [/tooltip.*(seen|viewed)/i]);
  assert.ok(seen, "state must persist tooltip seen/viewed state");
  const storage = new MemoryStorage();
  saveState(state, storage);
  const loaded = loadState(storage);
  for (const id of tooltipIds) {
    const repeat = markTooltip ? markTooltip(loaded, id) : queueTooltip(loaded, id);
    assert.ok(repeat === false || repeat?.shown === false, `${id} tooltip must remain dismissed after reload`);
  }
});

test("onboarding: low-gold tooltip uses strict three-wage-day boundary", () => {
  const checkLowGold = requireFunction([demoModule, onboardingModule, simModule], ["checkLowGoldTooltip", "shouldShowLowGoldTooltip"], "low-gold tooltip threshold");
  const queueOrBoolean = (state) => {
    const result = checkLowGold(state);
    if (typeof demoModule?.consumeTooltip === "function") return demoModule.consumeTooltip(state) === "lowGold";
    return result === true || result?.shown === true;
  };
  const below = createInitialState(73);
  if (below.demo) {
    below.demo.modal = null;
    below.demo.pendingTooltips = [];
  }
  setStack(below.player, "militia", 5, 0);
  below.player.gold = 14;
  assert.equal(queueOrBoolean(below), true, "14 gold is below three days of 5g wages and must trigger");

  const boundary = createInitialState(74);
  if (boundary.demo) {
    boundary.demo.modal = null;
    boundary.demo.pendingTooltips = [];
  }
  setStack(boundary.player, "militia", 5, 0);
  boundary.player.gold = 15;
  assert.equal(queueOrBoolean(boundary), false, "exactly three wage days must not trigger the strict < threshold");
});

test("telemetry: full semantic schema and gameplay counters", () => {
  const state = beginTelemetrySession(createInitialState(81));
  assertTelemetrySchema(state);
  assert.ok(isStrictIso(state.telemetry.sessionStart), "fresh sessionStart must be strict ISO UTC");
  assert.equal(state.telemetry.sessionEnd, null);
  for (const key of ["totalActiveSeconds", "battlesFought", "battlesWon", "battlesFled", "townEntries", "recruitClicks", "replayCount"]) {
    assert.equal(state.telemetry[key], 0, `fresh telemetry.${key} must start at zero`);
  }
  assert.deepEqual(state.telemetry.promiseValues, { troops: null, gold: null });
  assert.deepEqual(state.telemetry.promiseFinalActuals, { troops: null, gold: null });
  assert.deepEqual(state.telemetry.tooltipViews, { town: 0, lowGold: 0, act2: 0 });
  assert.deepEqual(state.telemetry.eventChoices, []);
  if (state.demo) {
    state.demo.onboardingComplete = true;
    state.demo.modal = null;
    state.paused = false;
  }
  const before = clone(state.telemetry);
  const recruit = simModule?.recruitMilitia;
  assert.equal(typeof recruit, "function");
  recruit(state);
  const beforeClicks = findSemantic(before, [/recruit.*click/i], Number.isFinite)?.[1];
  const afterClicks = findSemantic(state.telemetry, [/recruit.*click/i], Number.isFinite)?.[1];
  assert.equal(afterClicks, beforeClicks + 1, "recruit click telemetry must increment on click");
  if (typeof demoModule?.trackTownEntry === "function") {
    const entriesBefore = state.telemetry.townEntries;
    demoModule.trackTownEntry(state, null);
    demoModule.trackTownEntry(state, CONFIG.START_TOWN_ID);
    demoModule.trackTownEntry(state, CONFIG.START_TOWN_ID);
    assert.equal(state.telemetry.townEntries, entriesBefore + 1, "town entries count transitions, not every tick spent in town");
  }
  const forced = {
    id: `bandit_${state.nextBanditId++}`,
    pos: clone(state.player.pos),
    prevPos: clone(state.player.pos),
    moveTarget: null,
    troops: [{ type: "bandit", count: 1, xp: 0 }],
    gold: 20,
    elite: false
  };
  state.bandits.push(forced);
  const foughtBefore = state.telemetry.battlesFought;
  const wonBefore = state.telemetry.battlesWon;
  battleModule.startBattle(state, forced);
  battleModule.skipBattle(state);
  assert.equal(state.telemetry.battlesFought, foughtBefore + 1, "battle start must increment battles fought exactly once");
  assert.equal(state.telemetry.battlesWon, wonBefore + 1, "victory must increment battles won exactly once");
  const main = fs.readFileSync(path.join(JS_DIR, "main.js"), "utf8");
  assert.match(main, /beforeunload/, "beforeunload listener is required");
  assert.match(main, /function\s+saveQuitPoint\s*\([^)]*\)\s*\{[\s\S]{0,500}recordQuitPoint\s*\([^)]*\)[\s\S]{0,300}(?:saveState|persist)\s*\(/, "quit helper must record the semantic quit point before saving state");
  assert.match(main, /addEventListener\s*\(\s*["']beforeunload["'][\s\S]{0,300}saveQuitPoint\s*\(/, "beforeunload must route through the record-then-save quit helper");
});

test("telemetry: production loss and flee paths update exact counters", () => {
  const loss = createInitialState(82, { skipOnboarding: true });
  if (loss.casual) loss.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT ?? 2;
  loss.player.troops = [{ type: "militia", count: 1, xp: 0 }];
  const crusher = {
    id: `bandit_${loss.nextBanditId++}`,
    pos: clone(loss.player.pos),
    prevPos: clone(loss.player.pos),
    moveTarget: null,
    troops: [{ type: "bandit", count: 100, xp: 0 }],
    gold: 0,
    lootValue: 0,
    lootMultiplier: 1,
    jackpot: false,
    elite: false,
    isElite: false,
    marker: { kind: "normal", sizeMultiplier: 1, palette: "gray" }
  };
  loss.bandits.push(crusher);
  battleModule.startBattle(loss, crusher);
  const lossResult = battleModule.skipBattle(loss);
  assert.equal(lossResult?.type, "defeat");
  assert.equal(loss.telemetry.battlesFought, 1);
  assert.equal(loss.telemetry.battlesWon, 0);
  assert.equal(loss.telemetry.battlesFled, 0);

  const flee = createInitialState(83, { skipOnboarding: true });
  const pursuer = flee.bandits.find((bandit) => !bandit.elite) || flee.bandits[0];
  pursuer.pos = clone(flee.player.pos);
  battleModule.startBattle(flee, pursuer);
  flee.rng = rngModule.createRng(1); // Standard first draw 0.627... < 0.7.
  const fleeResult = battleModule.attemptFlee(flee);
  assert.equal(fleeResult?.success, true);
  assert.equal(flee.telemetry.battlesFought, 1);
  assert.equal(flee.telemetry.battlesWon, 0);
  assert.equal(flee.telemetry.battlesFled, 1);
  assert.equal(flee.battle, null);
});

test("time/pause: strict freeze and active-time accounting", () => {
  const state = createInitialState(91);
  const recordActiveTime = requireFunction([telemetryModule, demoModule, simModule], ["recordActiveTime", "addActiveTime"], "active-time accounting");
  const activeBefore = findSemantic(telemetryOf(state), [/total.*active.*seconds/i, /active.*seconds/i], Number.isFinite);
  assert.ok(activeBefore);
  recordActiveTime(state, 1000);
  const activeAfter = findSemantic(telemetryOf(state), [/total.*active.*seconds/i, /active.*seconds/i], Number.isFinite);
  assert.equal(activeAfter[1] - activeBefore[1], 1, "1000 active milliseconds must add exactly one active second");
  state.paused = true;
  const frozen = clone(state);
  advance(state, 120);
  assert.equal(state.tick, frozen.tick, "paused ticks must not advance the simulation clock");
  assert.equal(state.telemetry.totalActiveSeconds, frozen.telemetry.totalActiveSeconds, "paused ticks must not add active time");
  assert.deepEqual(state.rng, frozen.rng, "paused ticks must not consume the seeded RNG, including lazy initialization");
  assert.deepEqual(state.player, frozen.player, "paused ticks must not move or mutate the player");
  assert.deepEqual(state.lords, frozen.lords, "paused ticks must not move or mutate lords");
  assert.deepEqual(state.bandits, frozen.bandits, "paused ticks must not move or mutate bandits");
  assert.deepEqual(state.eventLog, frozen.eventLog, "paused ticks must not append living-world events");
  assert.deepEqual(state.stats, frozen.stats, "paused ticks must not run wages, economy, or battle stats");
  state.paused = false;
  recordActiveTime(state, 500);
  const resumed = findSemantic(telemetryOf(state), [/total.*active.*seconds/i, /active.*seconds/i], Number.isFinite);
  assert.equal(resumed[1], activeAfter[1] + 0.5, "resume must add only newly active elapsed time without catch-up");
  const main = fs.readFileSync(path.join(JS_DIR, "main.js"), "utf8");
  const simSource = fs.readFileSync(path.join(JS_DIR, "sim.js"), "utf8");
  assert.ok(
    /recordActiveTime|addActiveTime/.test(main) ||
      (/worldTick\s*\(/.test(main) && /recordActiveTick\s*\([^)]+\)/.test(simSource) && /totalActiveSeconds/.test(simSource)),
    "the production tick path must record active time exactly once"
  );
  assert.ok(/visibilityState|document\.hidden/.test(main), "hidden/background time must be excluded from active time");
  assert.ok(/paused/.test(main) && /modal|isDemoModalOpen/.test(main), "pause and blocking modals must gate active-time recording");
});

test("economy: deterministic day-3 wage start and HUD rate", () => {
  const state = createInitialState(101, { skipOnboarding: true });
  state.player.gold = 100;
  state.player.troops = [
    { type: "militia", count: 5, xp: 0 },
    { type: "veteran", count: 2, xp: 0 }
  ];
  state.bandits.forEach((bandit) => {
    bandit.pos = { x: CONFIG.WORLD_SIZE - 20, y: 20 };
    bandit.moveTarget = null;
  });
  for (let day = 1; day <= 2; day += 1) {
    state.tick = day * CONFIG.TICKS_PER_DAY - 1;
    state.stats.days = day - 1;
    worldTick(state);
    assert.equal(state.player.gold, 100, `day ${day} must remain inside the wage grace period`);
    assert.equal(state.stats.wagesPaid, 0, `day ${day} must not record wages`);
  }
  state.tick = CONFIG.TICKS_PER_DAY * 3 - 1;
  state.stats.days = 2;
  worldTick(state);
  assert.equal(state.player.gold, 89, "day 3 wages must deduct 5×1 + 2×3 exactly");
  assert.equal(totalTroops(state.player), 7, "unpaid/desertion mechanics were not requested");
  worldTick(state);
  assert.equal(state.player.gold, 89, "wages must not deduct again outside a day boundary");

  const poor = createInitialState(102, { skipOnboarding: true });
  poor.player.gold = 5;
  poor.player.troops = [{ type: "militia", count: 5, xp: 0 }, { type: "veteran", count: 2, xp: 0 }];
  poor.tick = CONFIG.TICKS_PER_DAY * 3 - 1;
  poor.stats.days = 2;
  poor.bandits.forEach((bandit) => { bandit.pos = { x: CONFIG.WORLD_SIZE - 20, y: 20 }; });
  worldTick(poor);
  assert.equal(poor.player.gold, 0, "insufficient day-3 wages must clamp gold at zero without adding desertion");
  assert.equal(totalTroops(poor.player), 7);

  const paused = createInitialState(103, { skipOnboarding: true });
  paused.player.gold = 100;
  paused.tick = CONFIG.TICKS_PER_DAY * 3 - 1;
  paused.stats.days = 2;
  paused.paused = true;
  worldTick(paused);
  assert.equal(paused.tick, CONFIG.TICKS_PER_DAY * 3 - 1);
  assert.equal(paused.player.gold, 100, "paused time must never pay wages");

  for (const language of ["zh", "en"]) {
    const values = translatedValues(language);
    assert.ok(values.some((value) => /-\{[^}]+\}\/(?:day|天|日)/i.test(value)), `${language} HUD must show a parameterized -n/day wage rate`);
  }
  const css = fs.readFileSync(path.join(OUTPUTS, "css/ui.css"), "utf8");
  assert.doesNotMatch(css, /body\.act-two\s+\.wage-marker\s*\{[^}]*display\s*:\s*none/i, "Act 2 must keep the numeric wage drain visible in the HUD");
});

test("Phase 2 config: living-world cadence and balance constants", () => {
  requireConfig(CONFIG, "lord AI cadence", [/AI.*(REEVALUATE|EVALUATION).*TICKS/i], 20);
  assert.equal(CONFIG.TICKS_PER_DAY, 60, "one game-day must remain exactly 60 ticks");
  requireConfig(CONFIG, "diplomacy cadence", [/DIPLOMACY.*TICKS/i], 600);
  requireConfig(CONFIG, "relation drift", [/RELATION.*DRIFT/i], 5);
  requireConfig(CONFIG, "war relation threshold", [/WAR.*RELATION.*THRESHOLD/i], -50);
  requireConfig(CONFIG, "war declaration chance", [/(DECLARE|WAR).*(CHANCE|PROBABILITY)/i], 0.2);
  requireConfig(CONFIG, "peace minimum days", [/PEACE.*(MIN.*DAYS|DAYS)/i], 30);
  requireConfig(CONFIG, "peace chance", [/PEACE.*(CHANCE|PROBABILITY)/i], 0.5);
  requireConfig(CONFIG, "siege duration", [/SIEGE.*DAYS/i], 2);
  assert.equal(CONFIG.FIELD_TERRAIN, 1, "open-field terrain must remain 1");
  assert.equal(CONFIG.TOWN_DEFENDER_TERRAIN, 1.5, "town defenders must receive the authorized 1.5 terrain value");
  requireConfig(CONFIG, "recruit pool refill", [/RECRUIT.*(?:POOL.*)?(REFILL|GAIN|AMOUNT)/i], 5);
  requireConfig(CONFIG, "recruit pool refill cadence", [/RECRUIT.*(?:POOL.*)?(?:REGEN.*)?DAYS/i], 3);
  requireConfig(CONFIG, "recruit pool cap", [/RECRUIT.*POOL.*CAP/i], 20);
  requireConfig(CONFIG, "normal prosperity drift", [/PROSPERITY.*(PEACE|NORMAL|GAIN)/i, /PEACE.*PROSPERITY/i], 1);
  requireConfig(CONFIG, "besieged prosperity drift", [/^(?:TOWN_)?(?:SIEGE|BESIEGED)_PROSPERITY_(?:DELTA|DRIFT)$/i, /^PROSPERITY_(?:SIEGE|BESIEGED)_(?:DELTA|DRIFT)$/i], -2);
});

test("Phase 2 AI: deterministic state-machine priority matrix", () => {
  const evaluate = requireFunction(
    [livingModule, aiModule, simModule],
    ["evaluateLordAI", "reevaluateLordAI", "reevaluateLordAi", "chooseLordAiState"],
    "full Phase 2 lord AI state machine"
  );
  const decision = (state, lord) => {
    const result = evaluate(state, lord);
    return typeof result === "string" ? result : result?.aiState || lord.aiState;
  };
  const scenario = () => {
    const state = createInitialState(105);
    state.bandits = [];
    const lord = state.lords[0];
    const enemy = state.lords.find((candidate) => candidate.factionId !== lord.factionId);
    const ownTown = state.towns.find((town) => town.factionId === lord.factionId);
    const enemyTown = state.towns.find((town) => town.factionId === enemy.factionId);
    state.lords.filter((candidate) => candidate !== lord && candidate !== enemy).forEach((candidate) => {
      candidate.defeatedUntilTick = 999999;
    });
    return { state, lord, enemy, ownTown, enemyTown };
  };
  const setWar = ({ state, lord, enemy }) => {
    const ownFaction = state.factions.find((faction) => faction.id === lord.factionId);
    const enemyFaction = state.factions.find((faction) => faction.id === enemy.factionId);
    ownFaction.atWarWith = [enemyFaction.id];
    enemyFaction.atWarWith = [ownFaction.id];
  };

  {
    const current = scenario();
    setStack(current.lord, "militia", 1);
    current.lord.gold = 201;
    assert.equal(decision(current.state, current.lord), "recruit", "low troops + gold >200 has first priority");
  }

  {
    const current = scenario();
    setWar(current);
    setStack(current.lord, "militia", 30);
    current.lord.gold = 0;
    current.lord.personality = 0;
    current.lord.pos = clone(current.enemy.pos);
    setStack(current.enemy, "militia", 10);
    assert.equal(decision(current.state, current.lord), "attack", "strong nearby lord must attack above personality threshold");
  }

  {
    const current = scenario();
    setWar(current);
    setStack(current.lord, "militia", 5);
    current.lord.gold = 0;
    setStack(current.enemy, "militia", 20);
    current.lord.pos = clone(current.enemy.pos);
    assert.equal(decision(current.state, current.lord), "flee", "strength ratio below 0.7 must flee");
  }

  {
    const current = scenario();
    setStack(current.lord, "militia", 20);
    current.enemy.pos = clone(current.enemyTown.pos);
    current.enemy.defeatedUntilTick = 999999;
    current.ownTown.underSiege = true;
    current.ownTown.siegeAttackerId = current.enemy.id;
    current.ownTown.siege = {
      attackerLordId: current.enemy.id,
      attackerFactionId: current.enemy.factionId,
      startedTick: 0,
      progressTicks: 1
    };
    assert.equal(decision(current.state, current.lord), "defend", "own town under siege must trigger defend when higher-priority cases do not apply");
  }

  {
    const current = scenario();
    current.enemy.defeatedUntilTick = 999999;
    setStack(current.lord, "militia", Math.ceil(CONFIG.LORD_TROOP_CAP * 0.5));
    current.lord.gold = 0;
    assert.equal(decision(current.state, current.lord), "patrol", "default AI state must be patrol");
  }
});

test("Phase 2 economy: three-day pools, prosperity, lord recruitment", () => {
  const initialize = requireFunction([simModule, livingModule], ["initializeLivingWorld", "ensureLivingState"], "living-world initialization");
  const reevaluate = requireFunction([aiModule, simModule], ["reevaluateLordAi", "reevaluateLordAI", "evaluateLordAI"], "lord recruitment intent");
  const updateLord = requireFunction([aiModule, simModule], ["updateLordMovement"], "lord recruitment movement");
  const state = createInitialState(106, { skipOnboarding: true });
  initialize(state);
  state.living.aiInitialized = true;
  const attacker = state.lords.find((lord) => lord.factionId === "north") || state.lords[0];
  const besieged = state.towns.find((town) => town.factionId !== attacker.factionId);
  const calm = state.towns.find((town) => town !== besieged && town.factionId !== besieged.factionId) || state.towns[0];
  const defenderFaction = state.factions.find((faction) => faction.id === besieged.factionId);
  const attackerFaction = state.factions.find((faction) => faction.id === attacker.factionId);
  attackerFaction.atWarWith = [...new Set([...(attackerFaction.atWarWith || []), defenderFaction.id])];
  defenderFaction.atWarWith = [...new Set([...(defenderFaction.atWarWith || []), attackerFaction.id])];
  setStack(attacker, "militia", 20);
  attacker.gold = 1000;
  attacker.pos = clone(besieged.pos);
  attacker.prevPos = clone(besieged.pos);
  attacker.moveTarget = clone(besieged.pos);
  attacker.aiState = "attack";
  attacker.targetKind = "town";
  attacker.targetId = besieged.id;
  state.lords.filter((lord) => lord !== attacker).forEach((lord) => { lord.defeatedUntilTick = 999999; });
  state.bandits.forEach((bandit) => {
    bandit.pos = { x: CONFIG.WORLD_SIZE - 20, y: 20 };
    bandit.moveTarget = null;
  });
  calm.recruitPool = 18;
  calm.prosperity = 99;
  besieged.recruitPool = 10;
  besieged.prosperity = 50;
  state.stats.days = 2;
  state.tick = CONFIG.TICKS_PER_DAY - 1;
  const economyTick = worldTick(state);
  assert.equal(economyTick.dayAdvanced, true, "economy must execute through the production day boundary");
  assert.equal(calm.recruitPool, 20, "three-day recruit refill must cap at 20");
  assert.equal(besieged.recruitPool, 15, "three-day recruit refill must add exactly 5");
  assert.equal(calm.prosperity, 100, "peaceful prosperity must gain 1 and cap at 100");
  assert.equal(besieged.prosperity, 48, "besieged prosperity must lose exactly 2");

  const recruitState = createInitialState(0x106, { skipOnboarding: true });
  initialize(recruitState);
  const lord = recruitState.lords[0];
  const town = recruitState.towns.find((candidate) => candidate.factionId === lord.factionId);
  lord.pos = clone(town.pos);
  lord.prevPos = clone(town.pos);
  lord.gold = 300;
  setStack(lord, "militia", 1);
  town.recruitPool = 10;
  const poolBefore = town.recruitPool;
  const goldBefore = lord.gold;
  assert.equal(reevaluate(recruitState, lord), "recruit");
  updateLord(recruitState, lord, CONFIG.LORD_SPEED);
  assert.ok(totalTroops(lord) > 1, "recruiting lord must gain troops");
  assert.ok(town.recruitPool < poolBefore, "lord recruitment must consume town recruitPool");
  assert.ok(lord.gold < goldBefore, "lord recruitment must spend lord gold");
});

test("Phase 2 sieges: exactly two adjacent days capture and log truthfully", () => {
  const initialize = requireFunction([simModule, livingModule], ["initializeLivingWorld", "ensureLivingState"], "living-world initialization");
  const state = createInitialState(107, { skipOnboarding: true });
  initialize(state);
  state.living.aiInitialized = true;
  const attacker = state.lords[0];
  const town = state.towns.find((candidate) => candidate.factionId !== attacker.factionId);
  const oldOwner = town.factionId;
  const attackerFaction = state.factions.find((faction) => faction.id === attacker.factionId);
  const ownerFaction = state.factions.find((faction) => faction.id === oldOwner);
  attackerFaction.atWarWith = [...new Set([...(attackerFaction.atWarWith || []), oldOwner])];
  ownerFaction.atWarWith = [...new Set([...(ownerFaction.atWarWith || []), attacker.factionId])];
  town.garrison = [{ type: "militia", count: 5, xp: 0 }];
  const defendedGarrisonStrength = partyStrength({ troops: town.garrison })
    * CONFIG.SIEGE_STRENGTH_RATIO
    * CONFIG.TOWN_DEFENDER_TERRAIN;
  const requiredAttackers = Math.ceil(defendedGarrisonStrength / TROOP_TYPES.militia.atk);
  setStack(attacker, "militia", Math.max(requiredAttackers, Math.ceil(CONFIG.LORD_TROOP_CAP * 0.5)));
  attacker.gold = 1000;
  attacker.pos = clone(town.pos);
  attacker.prevPos = clone(town.pos);
  attacker.moveTarget = clone(town.pos);
  attacker.aiState = "attack";
  attacker.targetKind = "town";
  attacker.targetId = town.id;
  state.lords.filter((lord) => lord !== attacker).forEach((lord) => { lord.defeatedUntilTick = 999999; });
  state.bandits.forEach((bandit) => {
    bandit.pos = { x: CONFIG.WORLD_SIZE - 20, y: 20 };
    bandit.moveTarget = null;
  });
  const requiredTicks = CONFIG.SIEGE_REQUIRED_TICKS ?? CONFIG.SIEGE_REQUIRED_DAYS * CONFIG.TICKS_PER_DAY;
  for (let tick = 0; tick < requiredTicks - 1; tick += 1) worldTick(state);
  assert.equal(town.factionId, oldOwner, "capture must not occur before two complete adjacent game-days");
  worldTick(state);
  assert.equal(town.factionId, attacker.factionId, "the exact two-day threshold with the town's 1.5 defensive terrain must capture");
  const capture = state.eventLog.find((event) => /capture|townCaptured|siegeWon/i.test(event.key || ""));
  assert.ok(capture, "town capture must create an event-log entry");
  assert.ok(Object.values(capture.parameters || {}).includes(town.id), "capture event must identify the town that actually changed owner");
});

test("Phase 2 diplomacy/death: deterministic wars and lord defection", () => {
  const initialize = requireFunction([simModule, livingModule], ["initializeLivingWorld", "ensureLivingState"], "living-world initialization");
  const makeReady = (seed) => {
    const state = createInitialState(seed, { skipOnboarding: true });
    initialize(state);
    state.living.aiInitialized = true;
    state.tick = CONFIG.DIPLOMACY_INTERVAL_TICKS - 1;
    state.stats.days = 9;
    state.lords.forEach((lord) => { lord.defeatedUntilTick = 999999; });
    for (const faction of state.factions) {
      faction.relations ||= {};
      for (const other of state.factions) if (other.id !== faction.id) faction.relations[other.id] = -55;
    }
    return state;
  };
  const first = makeReady(108);
  const second = makeReady(108);
  worldTick(first);
  worldTick(second);
  assert.deepEqual(canonicalState(second, { lifecycle: false }), canonicalState(first, { lifecycle: false }), "diplomacy must replay from identical RNG state");
  for (const faction of first.factions) {
    for (const enemyId of faction.atWarWith) {
      const enemy = first.factions.find((candidate) => candidate.id === enemyId);
      assert.ok(enemy?.atWarWith.includes(faction.id), "war declarations must remain symmetric");
    }
  }

  const death = makeReady(109);
  const defeated = death.factions[0];
  const survivingIds = death.factions.slice(1).map((faction) => faction.id);
  death.towns.forEach((town) => {
    if (town.factionId === defeated.id) town.factionId = survivingIds[0];
  });
  worldTick(death);
  assert.equal(defeated.alive, false, "the 600-tick diplomacy step must eliminate a zero-town faction");
  assert.ok(death.lords.filter((lord) => lord.id.startsWith(`${defeated.id}_`)).every((lord) => survivingIds.includes(lord.factionId)), "zero-town faction lords must defect to surviving factions");
});

test("Phase 2 event log: bounded newest-first living-world evidence", () => {
  assert.equal(typeof stateModule?.addEvent, "function");
  const state = createInitialState(109);
  state.eventLog = [];
  stateModule.addEvent(state, "older", { ordinal: 1 });
  stateModule.addEvent(state, "newer", { ordinal: 2 });
  assert.equal(state.eventLog[0].key, "newer", "eventLog must keep newest entries first per state schema");
  for (let index = 0; index < CONFIG.EVENT_LOG_LIMIT + 10; index += 1) stateModule.addEvent(state, `event_${index}`);
  assert.equal(state.eventLog.length, CONFIG.EVENT_LOG_LIMIT, "eventLog must remain bounded");
  assert.equal(state.eventLog[0].key, `event_${CONFIG.EVENT_LOG_LIMIT + 9}`, "newest event must stay at index zero");
});

test("battle: exactly the third survivor win upgrades militia to veteran", () => {
  const winEasyBattle = (state) => {
    const bandit = {
      id: `bandit_${state.nextBanditId++}`,
      pos: clone(state.player.pos),
      prevPos: clone(state.player.pos),
      moveTarget: null,
      troops: [{ type: "bandit", count: 1, xp: 0 }],
      gold: 10,
      lootValue: 5,
      lootMultiplier: 1,
      jackpot: false,
      elite: false,
      isElite: false,
      marker: { kind: "normal", sizeMultiplier: 1, palette: "gray" }
    };
    state.bandits.push(bandit);
    battleModule.startBattle(state, bandit);
    const eventAt = state.eventLog.length;
    const result = battleModule.skipBattle(state);
    const newEvents = state.eventLog.slice(0, Math.max(0, state.eventLog.length - eventAt));
    const losses = newEvents.filter((event) => /battleRound/i.test(event.key || ""))
      .reduce((sum, event) => sum + (event.parameters?.playerLoss || 0), 0);
    assert.equal(result?.type, "victory");
    return losses;
  };

  const secondWin = createInitialState(110, { skipOnboarding: true });
  setStack(secondWin.player, "militia", 10, 1);
  winEasyBattle(secondWin);
  assert.equal(secondWin.player.troops.find((stack) => stack.type === "veteran")?.count || 0, 0, "second win must not upgrade early");
  assert.equal(secondWin.player.troops.find((stack) => stack.type === "militia")?.xp, 2, "second win must leave militia at two wins");

  const thirdWin = createInitialState(111, { skipOnboarding: true });
  setStack(thirdWin.player, "militia", 10, 2);
  thirdWin.player.gold = 0;
  const losses = winEasyBattle(thirdWin);
  const survivors = 10 - losses;
  const veteranCount = thirdWin.player.troops.find((stack) => stack.type === "veteran")?.count || 0;
  assert.equal(veteranCount, survivors, "every surviving qualifying militia must upgrade on win three");
  assert.equal(totalTroops(thirdWin.player), survivors, "upgrade must not resurrect casualties or create troops");
  assert.ok(thirdWin.player.troops.every((stack) => Object.hasOwn(TROOP_TYPES, stack.type)), "upgrade may only use existing troop types");
});

test("bandits/loot: one persistent elite, seeded randomized loot, 10% jackpot", () => {
  const state = createInitialState(121);
  assert.equal(eliteBandits(state).length, 1, "exactly one ELITE must be alive after initialization");
  const elite = eliteBandits(state)[0];
  const ratio = partyStrength(elite) / Math.max(1, partyStrength(state.player));
  assert.ok(ratio >= 1.5 && ratio <= 2, `ELITE strength ratio ${ratio.toFixed(3)} must be in [1.5, 2] at spawn`);
  assert.equal(elite.lootMultiplier, 3, "ELITE must explicitly carry a 3x loot multiplier");
  requireConfig(CONFIG, "jackpot chance", [/JACKPOT.*CHANCE/i], 0.1);
  requireConfig(CONFIG, "jackpot minimum", [/JACKPOT.*MIN/i], 200);

  const exportedRollLoot = firstFunction([livingModule, battleModule, simModule, stateModule], ["rollLoot", "calculateLoot", "generateLoot"]);
  const spawnScaled = firstFunction([livingModule, stateModule], ["spawnScaledBandit"]);
  assert.ok(exportedRollLoot || spawnScaled, "seeded loot needs an exported roll helper or production spawnScaledBandit");
  const rollLoot = (sample) => {
    if (exportedRollLoot) return exportedRollLoot(sample, { elite: false, troops: [{ type: "bandit", count: 2, xp: 0 }] });
    sample.bandits = [];
    const bandit = spawnScaled(sample, { elite: false, townId: CONFIG.START_TOWN_ID });
    return { amount: bandit.lootValue, jackpot: bandit.jackpot };
  };
  const sequence = (seed) => {
    const sample = createInitialState(seed);
    return Array.from({ length: 300 }, () => rollLoot(sample));
  };
  const first = sequence(122);
  const second = sequence(122);
  assert.deepEqual(second, first, "loot sequence must replay from the same seed");
  assert.ok(new Set(first.map((entry) => typeof entry === "number" ? entry : entry.amount)).size > 1, "normal loot must be randomized");
  const jackpotEntries = first.filter((entry) => typeof entry === "object" ? entry.jackpot : entry >= 200);
  const jackpots = jackpotEntries.length;
  const rate = jackpots / first.length;
  assert.ok(rate >= 0.07 && rate <= 0.13, `seeded jackpot rate ${(rate * 100).toFixed(1)}% must approximate exact 10% threshold`);
  assert.ok(jackpotEntries.every((entry) => (typeof entry === "number" ? entry : entry.amount) >= 200), "every jackpot must pay at least 200 gold");

  state.player.troops = [{ type: "veteran", count: 200, xp: 0 }];
  if (state.casual) state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT ?? 2;
  elite.pos = clone(state.player.pos);
  elite.prevPos = clone(state.player.pos);
  battleModule.startBattle(state, elite);
  // startBattle exercises production rescaling first; then make the already-started
  // encounter safely winnable without changing the replacement path under test.
  elite.troops = [{ type: "bandit", count: 1, xp: 0 }];
  state.battle.banditStart = 1;
  const eliteResult = battleModule.skipBattle(state);
  assert.equal(eliteResult?.type, "victory", "production battle path must defeat the test ELITE");
  assert.equal(eliteBandits(state).length, 1, "production ELITE defeat flow must replace it immediately so exactly one remains alive");
  assert.ok(eliteResult.loot >= (elite.lootValue ?? elite.gold ?? 0) * CONFIG.LOOT_SHARE, "ELITE production payout must include its explicit 3x loot value");
  assert.match(fs.readFileSync(path.join(JS_DIR, "map.js"), "utf8"), /elite/i, "map renderer must visibly distinguish the larger dark ELITE marker");
});

test("acts/mirror: exact thresholds, promises, permanent overshoot, DEMO ending", () => {
  const checkActs = requireFunction(
    [demoModule, actsModule, simModule, stateModule],
    ["checkActProgression", "updateActProgression", "evaluateActProgression", "advanceActIfNeeded"],
    "Act 1/2/end progression"
  );
  const setPromise = requireFunction(
    [demoModule, actsModule, onboardingModule, simModule],
    ["setPromise", "setTroopPromise", "submitTroopPromise", "recordPromise", "submitPromise"],
    "mirror promise recording"
  );
  const state = createInitialState(131);
  if (state.demo) state.demo.modal = "troopPromise";
  setPromise(state, 60, "troops");
  const updateOvershoots = firstFunction([demoModule, actsModule], ["updatePromiseOvershoots", "updatePromiseMarkers"]);
  assert.ok(updateOvershoots, "promise boundary checks need the production overshoot updater");
  state.player.troops = [{ type: "militia", count: 60, xp: 0 }];
  updateOvershoots(state);
  const troopPromise = state.player.promises.find((promise) => promise.act === 1);
  assert.equal(troopPromise.exceeded, false, "equal to the stated promise must not count as exceeded");
  state.player.troops = [{ type: "militia", count: 61, xp: 0 }];
  updateOvershoots(state);
  assert.equal(troopPromise.exceeded, true, "the first value above the promise must mark it exceeded");
  state.player.troops = [{ type: "militia", count: 97, xp: 0 }];
  state.player.renown = 49;
  checkActs(state);
  assert.equal(state.player.act, 1);
  state.player.renown = 50;
  checkActs(state);
  assert.equal(state.player.act, 2, "renown 50 must enter Act 2 exactly once");
  const actOne = state.player.promises.find((promise) => promise.act === 1) || state.player.promises[0];
  assert.equal(actOne.actualAtActEnd ?? actOne.actual, 97, "Act 1 must capture final actual troop count");
  const capturedOnce = actOne.actualAtActEnd ?? actOne.actual;
  const act2Timestamp = state.telemetry?.actTimestamps?.act2;
  checkActs(state, "2099-01-01T00:00:00.000Z");
  assert.equal(actOne.actualAtActEnd ?? actOne.actual, capturedOnce, "repeated progression checks must not overwrite Act 1 actual");
  assert.equal(state.telemetry?.actTimestamps?.act2, act2Timestamp, "Act 2 timestamp must be write-once");
  setPromise(state, 500, "gold");
  assert.equal(actOne.exceeded, true, "Act 1 overshoot marker must remain set through Act 2 promise submission");
  setStack(state.player, "militia", 1, 0);
  checkActs(state);
  assert.equal(actOne.exceeded, true, "overshoot marker must stay set after troop losses");
  const save = new MemoryStorage();
  saveState(state, save);
  const reloaded = loadState(save);
  assert.equal(reloaded.player.promises.find((promise) => promise.act === 1).exceeded, true, "permanent overshoot must survive reload");
  state.player.renown = 99;
  checkActs(state);
  assert.ok(!state.ending?.complete && !state.demo?.ended && state.demoComplete !== true, "renown 99 must not end the demo");
  state.player.renown = 100;
  checkActs(state);
  assert.ok(state.ending?.complete || state.ending?.visible || state.demo?.ended || state.demoComplete === true, "renown 100 must open the demo ending");
  assert.equal(state.player.act, 2, "DEMO must never enter Act 3");
  const actTwo = state.player.promises.find((promise) => promise.act === 2);
  assert.equal(actTwo.actualAtActEnd, state.player.gold, "ending must capture the final Act 2 gold actual");
  const endingTick = state.demo?.endingTick;
  state.player.renown = 9999;
  checkActs(state, "2099-01-02T00:00:00.000Z");
  assert.equal(state.player.act, 2);
  assert.equal(state.demo?.endingTick, endingTick, "ending transition must be idempotent");
});

test("contracts: Act 2 tavern offers and payouts are deterministic", () => {
  const getOffer = requireFunction(
    [contractsModule, livingModule, simModule, actsModule],
    ["getContractOffer", "generateContractOffer", "createContractOffer", "getTavernContract"],
    "Act 2 tavern contract offers"
  );
  const accept = requireFunction(
    [contractsModule, livingModule, simModule, actsModule],
    ["acceptContract", "takeContract", "acceptMercenaryContract"],
    "Act 2 contract acceptance"
  );
  const first = createInitialState(141);
  const second = createInitialState(141);
  for (const state of [first, second]) {
    if (state.demo) {
      state.demo.onboardingComplete = true;
      state.demo.modal = null;
      state.paused = false;
    }
  }
  first.player.act = 1;
  assert.ok(!getOffer(first), "contracts must remain unavailable in Act 1");
  first.player.act = 2;
  second.player.act = 2;
  first.player.pos = { x: 1000, y: 1000 };
  assert.ok(!getOffer(first), "Act 2 contracts must only be offered inside a town/tavern");
  const startTown = first.towns.find((town) => town.id === CONFIG.START_TOWN_ID) || first.towns[0];
  first.player.pos = clone(startTown.pos);
  second.player.pos = clone(startTown.pos);
  const offerA = getOffer(first);
  const offerB = getOffer(second);
  assert.ok(offerA, "Act 2 town/tavern must provide a contract offer");
  assert.deepEqual(offerB, offerA, "same seed must produce the same contract offer");
  const accepted = accept(first, offerA);
  assert.notEqual(accepted, false, "valid Act 2 contract must be accepted");
  assert.ok(first.player.contract || first.contract || first.contracts?.active, "active contract must be stored in state");
  const activeContract = first.player.contract || first.contract || first.contracts?.active;
  const contractBefore = clone(activeContract);
  const pay = activeContract.payPerBattle ?? CONFIG.MERCENARY_PAY_PER_BATTLE;
  assert.ok(Number.isFinite(pay) && pay > 0, "contract must state a positive deterministic pay per battle");
  const bandit = {
    id: `bandit_${first.nextBanditId++}`,
    pos: clone(first.player.pos),
    prevPos: clone(first.player.pos),
    moveTarget: null,
    troops: [{ type: "bandit", count: 1, xp: 0 }],
    gold: 0,
    lootValue: 0,
    elite: false,
    lootMultiplier: 1
  };
  first.player.troops = [{ type: "veteran", count: 20, xp: 0 }];
  first.bandits.push(bandit);
  const goldBefore = first.player.gold;
  battleModule.startBattle(first, bandit);
  const result = battleModule.skipBattle(first);
  assert.equal(result?.type, "victory");
  assert.equal(result.contractPay, pay, "battle result must expose the exact contract payment");
  assert.equal(first.player.gold - goldBefore, pay + (result.loot || 0), "an eligible contract battle must add the contract payment exactly once on top of normal loot");
  const contractAfter = first.player.contract || first.contract || first.contracts?.active;
  assert.equal(contractAfter.battlesWon, (contractBefore.battlesWon || 0) + 1, "contract battle counter must increment once");
  assert.equal(contractAfter.goldEarned, (contractBefore.goldEarned || 0) + pay, "contract earnings must increment by the exact payment");

  const storage = new MemoryStorage();
  saveState(first, storage);
  const loaded = loadState(storage);
  assert.ok(loaded, "active contract state must survive save/load");
  assert.deepEqual(loaded.player.contract || loaded.contract || loaded.contracts?.active, contractAfter, "contract round-trip must be lossless");
});

test("ending/share: crown1 base64 codec round-trips compact Unicode telemetry", () => {
  const encode = requireFunction(
    [shareModule, actsModule, telemetryModule],
    ["encodeCrownCode", "encodeShare", "encodeShareText", "createShareText"],
    "crown1 share encoding"
  );
  const decode = requireFunction(
    [shareModule, actsModule, telemetryModule],
    ["decodeShare", "decodeShareText", "parseShareText", "decodeCrownCode"],
    "crown1 share decoding"
  );
  const payload = {
    version: 1,
    seed: 0,
    promises: [{ act: 1, stated: 60, actual: 97 }, { act: 2, stated: 500, actual: 731 }],
    stats: { days: 42, battles: 18, wins: 15, peakTroops: 97, peakGold: 731 },
    telemetry: { activeSeconds: 1234.5, quitPoint: "试玩终", tooltipViews: 3, replayCount: 1 }
  };
  const code = encode(payload);
  assert.ok(code.startsWith("crown1."), "codec output must start with crown1.");
  assert.ok(code.length < 4096, `share code must stay compact; got ${code.length} characters`);
  const oracleJson = Buffer.from(code.slice("crown1.".length), "base64").toString("utf8");
  assert.deepEqual(JSON.parse(oracleJson), payload, "an independent Base64+JSON oracle must decode the payload");
  assert.deepEqual(decode(code), payload, "encode→decode must preserve compact JSON including Unicode");
  const state = beginTelemetrySession(createInitialState(0));
  state.telemetry = clone(payload.telemetry);
  const buildMessage = requireFunction([shareModule, telemetryModule], ["buildShareMessage", "createShareMessage"], "exact share message");
  const message = buildMessage(state, "zh");
  assert.ok(message.startsWith("我的《王冠》试玩结果:crown1."), "share message prefix must be exact");
  assert.deepEqual(decode(message), telemetryModule?.buildPlaytestPayload ? telemetryModule.buildPlaytestPayload(state) : decode(message), "decoder must accept the full pasted Chinese message");
  assert.throws(() => decode("crown1.not-valid-base64"), "invalid share codes must fail safely");
});

test("ending/share: navigator.share first, clipboard fallback, visible monospace code", async () => {
  const share = requireFunction([shareModule, telemetryModule], ["sharePlaytestResult", "shareResult"], "native share with clipboard fallback");
  const state = beginTelemetrySession(createInitialState(149));
  const shareCalls = [];
  const clipboardCalls = [];
  const nativeResult = await share(state, "zh", {
    navigator: {
      async share(payload) { shareCalls.push(payload); },
      clipboard: { async writeText(text) { clipboardCalls.push(text); } }
    }
  });
  assert.equal(shareCalls.length, 1, "navigator.share must be used when available");
  assert.equal(clipboardCalls.length, 0, "clipboard is a fallback, not a second side effect after successful native share");
  assert.equal(nativeResult.shared, true);

  const fallbackCalls = [];
  const fallbackResult = await share(state, "zh", {
    navigator: { clipboard: { async writeText(text) { fallbackCalls.push(text); } } }
  });
  assert.equal(fallbackCalls.length, 1, "clipboard must be used when navigator.share is unavailable");
  assert.ok(fallbackCalls[0].startsWith("我的《王冠》试玩结果:crown1."));
  assert.equal(fallbackResult.copied, true);

  const index = fs.readFileSync(path.join(OUTPUTS, "index.html"), "utf8");
  const css = fs.readFileSync(path.join(OUTPUTS, "css/ui.css"), "utf8");
  assert.match(index, /(?:result|share)[^"']*code|code[^"']*(?:result|share)/i, "ending must always include a visible result-code element");
  const codeRule = css.match(/(?:\.|#)(?:result|share)[\w-]*code[^,{]*\{([^}]*)\}/i)?.[1] || "";
  assert.match(codeRule, /(?:font-family|font)\s*:[^;]*(?:monospace|mono)/i, "result code must use a monospace treatment");
  const codeSize = Number(codeRule.match(/(?:font-size|font)\s*:\s*(\d+(?:\.\d+)?)px/i)?.[1]);
  assert.ok(Number.isFinite(codeSize) && codeSize <= 12, "result code must remain visibly small (<=12px)");
});

test("ending/replay: mirror schema, stats, session end, replay count, and new seed", () => {
  const buildEnding = requireFunction(
    [actsModule, shareModule, telemetryModule, stateModule],
    ["buildEndingSummary", "createEndingSummary", "finishDemo", "buildPlaytestPayload"],
    "ending summary"
  );
  const replay = requireFunction(
    [stateModule, demoModule, actsModule, autoplayModule],
    ["createReplayState", "startReplay", "replayWithNewSeed", "nextReplaySeed"],
    "new-seed replay"
  );
  const state = beginTelemetrySession(createInitialState(151));
  state.player.promises = [
    { act: 1, statedGoal: 60, actualAtActEnd: 97 },
    { act: 2, statedGoal: 500, actualAtActEnd: 731 }
  ];
  state.stats.days = 30;
  state.stats.battles = 20;
  state.player.renown = 100;
  if (typeof demoModule?.completeDemo === "function") demoModule.completeDemo(state, "2026-08-02T00:00:00.000Z");
  const summary = buildEnding(state);
  assert.ok(summary && typeof summary === "object");
  assert.ok(findContainer(summary, [/promises?|mirror/i]), "ending must contain both mirror rows");
  for (const metric of ["days", "battles", "win rate", "peak troops", "peak gold"]) {
    const pattern = new RegExp(metric.replace(" ", ".*"), "i");
    assert.ok(findSemantic(summary, [pattern], Number.isFinite), `ending must contain numeric ${metric}`);
  }
  const ended = findSemantic(telemetryOf(state), [/session.*end/i], (value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
  assert.ok(ended, "ending must stamp telemetry.sessionEnd");
  const mainSource = fs.readFileSync(path.join(JS_DIR, "main.js"), "utf8");
  assert.match(mainSource, /stampSeal\s*\(\s*ui\.text\s*\(\s*["']ending\.seal["']\s*\)/, "the renown-100 transition must invoke stampSeal with the demo-ending seal");
  const replayResult = replay(state);
  const next = typeof replayResult === "number" ? createInitialState(replayResult) : replayResult;
  assert.ok(next && next.seed !== state.seed, "replay must start with a new seed");
  if (typeof replayResult === "number") {
    const main = fs.readFileSync(path.join(JS_DIR, "main.js"), "utf8");
    assert.match(main, /replayCount/, "replay UI must carry incremented replayCount into the new-seed state");
  } else {
    const replayCount = findSemantic(telemetryOf(next), [/replay.*count/i], Number.isFinite);
    assert.ok(replayCount && replayCount[1] >= 1, "replay count must survive into the new run");
  }
});

test("autoplay: default seed meets first-battle, Act 2, and ending targets", () => {
  const runAutoplay = requireFunction(
    [autoplayModule, simModule],
    ["runAutoplay", "simulateAutoplay"],
    "deterministic greedy autoplay"
  );
  const result = runAutoplay(CONFIG.SEED, { multiplier: 20, maxActiveSeconds: 1800 });
  assert.ok(result && typeof result === "object");
  const metrics = {
    seed: CONFIG.SEED,
    firstBattleSeconds: result.firstBattleSeconds ?? result.firstBattleAt,
    act2Seconds: result.act2Seconds ?? result.act2At,
    endingSeconds: result.endingSeconds ?? result.endSeconds ?? result.endingAt,
    finalGold: result.state?.player?.gold,
    finalTroops: result.state ? totalTroops(result.state.player) : undefined,
    battles: result.state?.stats?.battles,
    finalRenown: result.state?.player?.renown,
    finalAct: result.state?.player?.act,
    ended: Boolean(result.state?.demo?.ended || result.state?.progression?.complete || result.state?.demoComplete)
  };
  diagnostics.autoplay.push(metrics);
  assert.ok(Number.isFinite(metrics.firstBattleSeconds) && metrics.firstBattleSeconds <= 90, `first battle took ${metrics.firstBattleSeconds}s; target <=90s`);
  assert.ok(Number.isFinite(metrics.act2Seconds), `autoplay never reached Act 2 within ${result.activeSeconds ?? 1800}s (renown ${metrics.finalRenown})`);
  assert.ok(Number.isFinite(metrics.endingSeconds), `autoplay never reached the ending within ${result.activeSeconds ?? 1800}s (renown ${metrics.finalRenown})`);
  assert.ok(metrics.firstBattleSeconds <= metrics.act2Seconds && metrics.act2Seconds <= metrics.endingSeconds, "autoplay milestones must be chronological");
  assert.ok(metrics.act2Seconds >= 600 && metrics.act2Seconds <= 720, `Act 2 took ${(metrics.act2Seconds / 60).toFixed(2)}m; target 10–12m`);
  assert.ok(metrics.endingSeconds >= 1200 && metrics.endingSeconds <= 1800, `ending took ${(metrics.endingSeconds / 60).toFixed(2)}m; target 20–30m`);
  assert.equal(result.state?.player?.act, 2, "autoplay must end in Act 2, never Act 3");
  assert.ok(result.state?.player?.renown >= 100, "autoplay ending must be caused by the 100-renown gate");
  assert.ok(result.state?.demo?.ended || result.state?.progression?.complete || result.state?.demoComplete, "autoplay final state must actually be in the ending");
  const active = findSemantic(result.state?.telemetry || {}, [/total.*active.*seconds/i, /active.*seconds/i, /activeTicks/i], Number.isFinite)?.[1];
  if (Number.isFinite(active)) {
    const activeSeconds = /Ticks/i.test(findSemantic(result.state.telemetry, [/activeTicks/i], Number.isFinite)?.[0] || "") ? active * CONFIG.LOGIC_MS / 1000 : active;
    assert.ok(Math.abs(activeSeconds - metrics.endingSeconds) <= 1, "reported autoplay timing must come from persisted active time, not fabricated milestones");
  }
});

test("autoplay diagnostics: deterministic multi-seed economy/performance sample", () => {
  const runAutoplay = requireFunction([autoplayModule, simModule], ["runAutoplay", "simulateAutoplay"], "autoplay diagnostics");
  const seeds = [1, 42, 2025, 0x00c0ffee, 0xdeadbeef];
  for (const seed of seeds) {
    const started = performance.now();
    const first = runAutoplay(seed, { multiplier: 20, maxActiveSeconds: 1800 });
    const elapsedMs = performance.now() - started;
    const second = runAutoplay(seed, { multiplier: 20, maxActiveSeconds: 1800 });
    assert.deepEqual(canonicalState(second.state, { lifecycle: false }), canonicalState(first.state, { lifecycle: false }), `seed ${seed} autoplay must replay exactly`);
    const row = {
      seed,
      firstBattleSeconds: first.firstBattleSeconds ?? first.firstBattleAt,
      act2Seconds: first.act2Seconds ?? first.act2At,
      endingSeconds: first.endingSeconds ?? first.endSeconds ?? first.endingAt,
      finalGold: first.state?.player?.gold,
      finalTroops: first.state ? totalTroops(first.state.player) : undefined,
      battles: first.state?.stats?.battles,
      eliteAlive: first.state ? eliteBandits(first.state).length : undefined,
      finalRenown: first.state?.player?.renown,
      finalAct: first.state?.player?.act,
      ended: Boolean(first.state?.demo?.ended || first.state?.progression?.complete || first.state?.demoComplete),
      wallMs: Number(elapsedMs.toFixed(2))
    };
    diagnostics.autoplay.push(row);
    assert.ok(elapsedMs < 1500, `seed ${seed} autoplay simulation took ${elapsedMs.toFixed(0)}ms; performance regression`);
  }
});

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function buildTuningAdvice() {
  const firstBattle = median(diagnostics.autoplay.map((row) => row.firstBattleSeconds));
  const act2 = median(diagnostics.autoplay.map((row) => row.act2Seconds));
  const ending = median(diagnostics.autoplay.map((row) => row.endingSeconds));
  const missingAct2 = diagnostics.autoplay.filter((row) => !Number.isFinite(row.act2Seconds));
  const missingEnding = diagnostics.autoplay.filter((row) => !Number.isFinite(row.endingSeconds));
  if (missingAct2.length) diagnostics.tuning.push(`${missingAct2.length}/${diagnostics.autoplay.length} autoplay samples never reached Act 2 by 30m; reduce Act 1 recovery/travel downtime or raise safe early renown throughput.`);
  if (missingEnding.length) diagnostics.tuning.push(`${missingEnding.length}/${diagnostics.autoplay.length} autoplay samples never reached the ending by 30m; raise post-Act2 target throughput or shorten AUTOPLAY_ACT2_RECOVERY_TICKS.`);
  if (firstBattle !== null && firstBattle > 90) diagnostics.tuning.push("First battle is late: reduce initial bandit distance or raise PLAYER_SPEED/ENCOUNTER_RADIUS; do not change combat formulas first.");
  if (act2 !== null && act2 < 600) diagnostics.tuning.push("Act 2 is early: reduce RENOWN_PER_ENEMY_CASUALTY or early normal-bandit counts/availability.");
  if (act2 !== null && act2 > 720) diagnostics.tuning.push("Act 2 is late: raise early bandit availability or RENOWN_PER_ENEMY_CASUALTY; check wage-induced recovery loops.");
  if (ending !== null && ending < 1200) diagnostics.tuning.push("Demo ending is early: reduce post-Act2 renown throughput before raising the 100-renown hard gate.");
  if (ending !== null && ending > 1800) diagnostics.tuning.push("Demo ending is late: increase post-Act2 target density/contract incentives or reduce travel downtime.");
  const poor = diagnostics.autoplay.filter((row) => Number.isFinite(row.finalGold) && row.finalGold === 0);
  if (poor.length) diagnostics.tuning.push(`${poor.length} autoplay samples ended at zero gold: lower wages or raise ordinary loot before increasing jackpot frequency.`);
  if (!diagnostics.tuning.length && diagnostics.autoplay.length) diagnostics.tuning.push("Timing/economy sample is inside the target bands; retain current CONFIG until browser playtest evidence says otherwise.");
}

let passed = 0;
const failures = [];
for (const entry of tests) {
  try {
    await entry.fn();
    passed += 1;
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failures.push({ name: entry.name, message: error?.message || String(error) });
    console.error(`FAIL ${entry.name}\n  ${error?.message || error}`);
  }
}

buildTuningAdvice();
console.log("\nPhase 2.5 acceptance summary");
console.log(JSON.stringify({
  passed,
  failed: failures.length,
  failures,
  autoplay: diagnostics.autoplay,
  tuning: diagnostics.tuning
}, null, 2));

if (failures.length) process.exitCode = 1;

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
  return value === null || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function sourceFiles() {
  if (!fs.existsSync(JS_DIR)) return [];
  return fs.readdirSync(JS_DIR)
    .filter((name) => name.endsWith(".js"))
    .map((name) => path.join(JS_DIR, name));
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

async function importOptional(relativePath) {
  const file = path.join(OUTPUTS, relativePath);
  if (!fs.existsSync(file)) return null;
  return import(`${pathToFileURL(file).href}?phase25=${Date.now()}`);
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
const contractsModule = await importOptional("js/contracts.js");
const shareModule = await importOptional("js/share.js");
const autoplayModule = await importOptional("js/autoplay.js");
const optionalModules = [demoModule, actsModule, onboardingModule, telemetryModule, contractsModule, shareModule, autoplayModule];

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

  const start = findSemantic(telemetry, [/session.*start/i], (value) => typeof value === "string" && Number.isFinite(Date.parse(value)));
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
    assert.ok(typeof timestamps.act1 === "string" && Number.isFinite(Date.parse(timestamps.act1)), "Act 1 timestamp must be ISO");
    assert.ok(isIsoOrNull(timestamps.act2) && isIsoOrNull(timestamps.ending), "Act 2/ending timestamps must be nullable ISO values");
  }
  const tooltipViews = findContainer(telemetry, [/tooltipViews$/i])?.[1];
  if (tooltipViews) {
    for (const id of ["town", "lowGold", "act2"]) assert.ok(Number.isFinite(tooltipViews[id]) && tooltipViews[id] >= 0, `tooltipViews.${id} must be numeric`);
  }
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

test("static: Phase 2.5 demo gates and timing constants", () => {
  assert.ok(dataModule, "data.js must import");
  assert.equal(dataModule.DEMO ?? CONFIG.DEMO, true, "DEMO must be literal true");
  requireConfig(CONFIG, "Act 2 renown gate", [/ACT.*(?:1|2).*RENOWN/i, /RENOWN.*ACT.*2/i], 50);
  requireConfig(CONFIG, "demo ending renown gate", [/DEMO.*END.*RENOWN/i, /END.*RENOWN/i], 100);
  requireConfig(CONFIG, "autoplay multiplier", [/AUTOPLAY.*(SPEED|MULTIPLIER)/i], 20);
  requireConfig(CONFIG, "version", [/^(APP_|BUILD_)?VERSION$/i]);
  const maximumAct = configEntry(CONFIG, [/MAX.*ACT/i, /DEMO.*ACT/i]);
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
    "再玩一局",
    "已复制,粘贴给 Ja 就行"
  ];
  for (const text of exact) assert.ok(values.includes(text), `missing exact zh string: ${text}`);
  assert.ok(values.some((value) => value.includes("上一幕你说") && value.includes("你招到了") && value.includes("多少金币才够")), "Act 2 gold-promise modal copy is missing");
  assert.ok(values.some((value) => value.includes("你说") && /\{[^}]+\}/.test(value)), "mirror HUD/table needs parameterized 你说 copy");
  assert.ok(values.includes("我的《王冠》试玩结果:crown1.{payload}") || sourceBundle().includes("我的《王冠》试玩结果:crown1."), "share prefix must be exact");
});

test("static: no forbidden technology or content leakage", () => {
  assert.deepEqual(Object.keys(TROOP_TYPES).sort(), ["bandit", "militia", "veteran"], "no new troop types are allowed");
  const source = sourceBundle();
  const forbidden = [
    ["cookies", /document\.cookie|cookieStore/i],
    ["alternate persistence", /sessionStorage|indexedDB/i],
    ["quests", /\bquests?\b/i],
    ["difficulty modes", /\bdifficult(?:y|ies)\b/i],
    ["sound/audio", /new\s+Audio\b|AudioContext|<audio\b/i],
    ["accounts/auth", /\b(?:login|logout|signIn|signUp|accountId|authentication)\b/i],
    ["third-party SDK", /\b(?:firebase|supabase|sentry|mixpanel|amplitude|gtag)\b/i]
  ];
  for (const [label, pattern] of forbidden) assert.ok(!pattern.test(source), `${label} are forbidden`);
  for (const file of sourceFiles()) {
    const content = fs.readFileSync(file, "utf8");
    for (const match of content.matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      assert.ok(match[1].startsWith("."), `${path.basename(file)} has a non-relative dependency: ${match[1]}`);
    }
  }
  const strings = stringsModule?.STRINGS ? JSON.stringify(stringsModule.STRINGS) : "";
  assert.ok(!/Act\s*[34]|第三幕|第四幕|Landed Lord|\bKing\b/i.test(strings), "Acts 3–4 content must not ship in DEMO");
});

test("static: decode page, iOS/A2HS, GitHub Pages paths, and size", () => {
  const indexPath = path.join(OUTPUTS, "index.html");
  const decodePath = path.join(OUTPUTS, "decode.html");
  assert.ok(fs.existsSync(indexPath), "index.html is required");
  assert.ok(fs.existsSync(decodePath), "unlinked decode.html is required");
  const index = fs.readFileSync(indexPath, "utf8");
  const decode = fs.readFileSync(decodePath, "utf8");
  assert.ok(!index.includes("decode.html"), "decode.html must remain unlinked");
  assert.match(decode, /textarea|input/i, "decode.html needs pasted-code input");
  assert.match(decode, /table/i, "decode.html needs a readable telemetry table");
  assert.match(index, /viewport-fit=cover/i, "viewport must support iOS safe areas");
  assert.match(index, /apple-mobile-web-app-capable/i, "iOS A2HS capable meta is required");
  assert.match(index, /rel=["']manifest["']/i, "A2HS web manifest link is required");
  const css = fs.readFileSync(path.join(OUTPUTS, "css/ui.css"), "utf8");
  assert.match(css, /safe-area-inset/i, "CSS must account for iOS safe areas");
  for (const match of index.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const url = match[1];
    assert.ok(!/^https?:|^\/\//i.test(url), `external URL is forbidden: ${url}`);
    if (!url.startsWith("#") && !url.startsWith("data:")) assert.ok(!url.startsWith("/"), `GitHub Pages asset path must be relative: ${url}`);
  }
  const totalBytes = fs.readdirSync(OUTPUTS, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .reduce((sum, entry) => sum + fs.statSync(path.join(entry.parentPath, entry.name)).size, 0);
  assert.ok(totalBytes < 2_000_000, `total output is ${totalBytes} bytes; must stay below 2 MB`);
});

test("static/runtime: autoplay is URL-only and exactly 20x", () => {
  const autoplayFactor = requireFunction(
    [autoplayModule, ...optionalModules],
    ["autoplayMultiplier", "getAutoplayMultiplier", "getAutoplaySpeed"],
    "URL-only autoplay parsing"
  );
  assert.equal(autoplayFactor("?autoplay=1"), 20);
  for (const query of ["", "?autoplay=0", "?autoplay=true", "?speed=20", "?autoplay=1&speed=50"]) {
    assert.equal(autoplayFactor(query), query.startsWith("?autoplay=1") ? 20 : 1, `unexpected autoplay factor for ${query}`);
  }
  const html = fs.readFileSync(path.join(OUTPUTS, "index.html"), "utf8");
  assert.ok(!/id=["'][^"']*(?:autoplay|speed)[^"']*["']/i.test(html), "autoplay/speed must not have visible controls");
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
  assertTelemetrySchema(migrated);
  assert.ok(!isValidState || isValidState(migrated), "migrated state must validate");

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
  const state = createInitialState(0);
  const storage = new MemoryStorage();
  state.paused = true;
  state.player.gold = 213;
  state.player.renown = 51;
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
  const uninterrupted = createInitialState(424242);
  const interrupted = createInitialState(424242);
  uninterrupted.player.moveTarget = { x: 1500, y: 500 };
  interrupted.player.moveTarget = { x: 1500, y: 500 };
  advance(uninterrupted, 137);
  advance(interrupted, 137);
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
    [onboardingModule, actsModule, simModule, stateModule],
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

test("telemetry: full semantic schema and gameplay counters", () => {
  const state = createInitialState(81);
  assertTelemetrySchema(state);
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
  assert.match(main, /beforeunload[\s\S]{0,500}recordQuitPoint[\s\S]{0,500}(?:saveState|persist)/, "beforeunload must record quit point before saving last state");
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
  assert.deepEqual(state, frozen, "pause must freeze simulation, active time, and RNG with no exceptions");
  state.paused = false;
  recordActiveTime(state, 500);
  const resumed = findSemantic(telemetryOf(state), [/total.*active.*seconds/i, /active.*seconds/i], Number.isFinite);
  assert.equal(resumed[1], activeAfter[1] + 0.5, "resume must add only newly active elapsed time without catch-up");
  const main = fs.readFileSync(path.join(JS_DIR, "main.js"), "utf8");
  assert.match(main, /recordActiveTime|addActiveTime/, "main loop must wire active-time recording");
  assert.ok(/visibilityState|document\.hidden/.test(main), "hidden/background time must be excluded from active time");
  assert.ok(/paused/.test(main) && /modal|isDemoModalOpen/.test(main), "pause and blocking modals must gate active-time recording");
});

test("economy: deterministic daily wages and HUD rate", () => {
  const state = createInitialState(101);
  state.player.gold = 100;
  state.player.troops = [
    { type: "militia", count: 5, xp: 0 },
    { type: "veteran", count: 2, xp: 0 }
  ];
  state.tick = CONFIG.TICKS_PER_DAY - 1;
  state.bandits.forEach((bandit) => {
    bandit.pos = { x: CONFIG.WORLD_SIZE - 20, y: 20 };
    bandit.moveTarget = null;
  });
  worldTick(state);
  assert.equal(state.player.gold, 89, "daily wages must deduct 5×1 + 2×3 exactly");
  assert.equal(totalTroops(state.player), 7, "unpaid/desertion mechanics were not requested");
  const values = translatedValues("zh");
  assert.ok(values.some((value) => /-\{[^}]+\}\/day|-\{[^}]+\}\/天/.test(value)), "HUD must show a parameterized -n/day wage rate");
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
  requireConfig(CONFIG, "recruit pool refill", [/RECRUIT.*POOL.*(REFILL|GAIN|AMOUNT)/i], 5);
  requireConfig(CONFIG, "recruit pool refill cadence", [/RECRUIT.*POOL.*DAYS/i], 3);
  requireConfig(CONFIG, "recruit pool cap", [/RECRUIT.*POOL.*CAP/i], 20);
  requireConfig(CONFIG, "normal prosperity drift", [/PROSPERITY.*(PEACE|NORMAL|GAIN)/i], 1);
  requireConfig(CONFIG, "besieged prosperity drift", [/PROSPERITY.*(SIEGE|BESIEGED|LOSS)/i], -2);
});

test("Phase 2 AI: deterministic state-machine priority matrix", () => {
  const evaluate = requireFunction(
    [aiModule, simModule],
    ["evaluateLordAI", "reevaluateLordAI", "chooseLordAiState"],
    "full Phase 2 lord AI state machine"
  );
  const decision = (state, lord) => {
    const result = evaluate(state, lord);
    return typeof result === "string" ? result : result?.aiState || lord.aiState;
  };
  const base = createInitialState(105);
  const lord = base.lords[0];
  const enemy = base.lords.find((candidate) => candidate.factionId !== lord.factionId);
  const ownTown = base.towns.find((town) => town.factionId === lord.factionId);
  const enemyTown = base.towns.find((town) => town.factionId === enemy.factionId);
  const ownFaction = base.factions.find((faction) => faction.id === lord.factionId);
  const enemyFaction = base.factions.find((faction) => faction.id === enemy.factionId);
  ownFaction.atWarWith = [enemyFaction.id];
  enemyFaction.atWarWith = [ownFaction.id];

  setStack(lord, "militia", 1);
  lord.gold = 201;
  assert.equal(decision(clone(base), clone(lord)), "recruit", "low troops + gold >200 has first priority");

  setStack(lord, "militia", 30);
  lord.gold = 0;
  lord.personality = 0;
  lord.pos = clone(enemy.pos);
  setStack(enemy, "militia", 10);
  assert.equal(decision(base, lord), "attack", "strong nearby lord must attack above personality threshold");

  setStack(lord, "militia", 5);
  setStack(enemy, "militia", 20);
  assert.equal(decision(base, lord), "flee", "strength ratio below 0.7 must flee");

  setStack(lord, "militia", 20);
  enemy.pos = clone(enemyTown.pos);
  ownTown.underSiege = true;
  ownTown.siegeAttackerId = enemy.id;
  assert.equal(decision(base, lord), "defend", "own town under siege must trigger defend when higher-priority cases do not apply");

  ownTown.underSiege = false;
  ownTown.siegeAttackerId = null;
  enemy.pos = clone(enemyTown.pos);
  assert.equal(decision(base, lord), "patrol", "default AI state must be patrol");
});

test("Phase 2 economy: three-day pools, prosperity, lord recruitment", () => {
  const economyStep = requireFunction(
    [simModule, stateModule, aiModule],
    ["economyStep", "runDailyEconomy", "advanceEconomyDay"],
    "Phase 2 daily economy"
  );
  const state = createInitialState(106);
  const calm = state.towns[0];
  const besieged = state.towns[1];
  calm.recruitPool = 18;
  calm.prosperity = 99;
  besieged.recruitPool = 10;
  besieged.prosperity = 50;
  besieged.underSiege = true;
  state.stats.days = 2;
  economyStep(state);
  assert.equal(calm.recruitPool, 20, "three-day recruit refill must cap at 20");
  assert.equal(besieged.recruitPool, 15, "three-day recruit refill must add exactly 5");
  assert.equal(calm.prosperity, 100, "peaceful prosperity must gain 1 and cap at 100");
  assert.equal(besieged.prosperity, 48, "besieged prosperity must lose exactly 2");

  const recruitLord = firstFunction([simModule, stateModule, aiModule], ["recruitLordAtTown", "lordRecruit"]);
  assert.ok(recruitLord, "Phase 2 must expose/test lord recruitment using town pool and lord gold");
  const lord = state.lords.find((candidate) => candidate.factionId === calm.factionId);
  lord.pos = clone(calm.pos);
  lord.gold = 300;
  setStack(lord, "militia", 1);
  const poolBefore = calm.recruitPool;
  const goldBefore = lord.gold;
  recruitLord(state, lord, calm);
  assert.ok(totalTroops(lord) > 1, "recruiting lord must gain troops");
  assert.ok(calm.recruitPool < poolBefore, "lord recruitment must consume town recruitPool");
  assert.ok(lord.gold < goldBefore, "lord recruitment must spend lord gold");
});

test("Phase 2 sieges: exactly two adjacent days capture and log truthfully", () => {
  const updateSieges = requireFunction(
    [simModule, aiModule],
    ["updateSieges", "advanceSieges", "processSieges"],
    "Phase 2 siege progression"
  );
  const state = createInitialState(107);
  const attacker = state.lords[0];
  const town = state.towns.find((candidate) => candidate.factionId !== attacker.factionId);
  const oldOwner = town.factionId;
  state.factions.find((faction) => faction.id === attacker.factionId).atWarWith = [oldOwner];
  state.factions.find((faction) => faction.id === oldOwner).atWarWith = [attacker.factionId];
  town.garrison = [{ type: "militia", count: 5, xp: 0 }];
  setStack(attacker, "militia", 11);
  attacker.pos = clone(town.pos);
  for (let day = 0; day < 1; day += 1) updateSieges(state);
  assert.equal(town.factionId, oldOwner, "one adjacent day must not capture a town");
  updateSieges(state);
  assert.equal(town.factionId, attacker.factionId, "two adjacent days at >=2x garrison strength must capture");
  const capture = state.eventLog.find((event) => /capture|townCaptured|siegeWon/i.test(event.key || ""));
  assert.ok(capture, "town capture must create an event-log entry");
  assert.ok(Object.values(capture.parameters || {}).includes(town.id), "capture event must identify the town that actually changed owner");
});

test("Phase 2 diplomacy/death: deterministic wars and lord defection", () => {
  const diplomacyStep = requireFunction(
    [simModule, aiModule],
    ["diplomacyStep", "runDiplomacy", "updateDiplomacy"],
    "Phase 2 diplomacy"
  );
  const makeReady = (seed) => {
    const state = createInitialState(seed);
    for (const faction of state.factions) {
      faction.relations ||= {};
      for (const other of state.factions) if (other.id !== faction.id) faction.relations[other.id] = -55;
    }
    return state;
  };
  const first = makeReady(108);
  const second = makeReady(108);
  diplomacyStep(first);
  diplomacyStep(second);
  assert.deepEqual(canonicalState(second, { lifecycle: false }), canonicalState(first, { lifecycle: false }), "diplomacy must replay from identical RNG state");
  for (const faction of first.factions) {
    for (const enemyId of faction.atWarWith) {
      const enemy = first.factions.find((candidate) => candidate.id === enemyId);
      assert.ok(enemy?.atWarWith.includes(faction.id), "war declarations must remain symmetric");
    }
  }

  const defeated = first.factions[0];
  const survivingIds = first.factions.slice(1).map((faction) => faction.id);
  first.towns.forEach((town) => {
    if (town.factionId === defeated.id) town.factionId = survivingIds[0];
  });
  diplomacyStep(first);
  assert.ok(first.lords.filter((lord) => lord.id.startsWith(`${defeated.id}_`)).every((lord) => survivingIds.includes(lord.factionId)), "zero-town faction lords must defect to surviving factions");
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

test("battle: third survivor win upgrades militia to veteran", () => {
  const state = createInitialState(111);
  setStack(state.player, "militia", 10, 2);
  state.player.gold = 0;
  const bandit = {
    id: `bandit_${state.nextBanditId++}`,
    pos: clone(state.player.pos),
    prevPos: clone(state.player.pos),
    moveTarget: null,
    troops: [{ type: "bandit", count: 1, xp: 0 }],
    gold: 10,
    elite: false
  };
  state.bandits.push(bandit);
  battleModule.startBattle(state, bandit);
  battleModule.skipBattle(state);
  const veteranCount = state.player.troops.find((stack) => stack.type === "veteran")?.count || 0;
  assert.ok(veteranCount > 0, "militia survivors with three wins must upgrade to veteran");
  assert.equal(totalTroops(state.player), 10, "upgrade must not create extra troops");
  assert.ok(state.player.troops.every((stack) => Object.hasOwn(TROOP_TYPES, stack.type)), "upgrade may only use existing troop types");
});

test("bandits/loot: one persistent elite, seeded randomized loot, 10% jackpot", () => {
  const state = createInitialState(121);
  assert.equal(eliteBandits(state).length, 1, "exactly one ELITE must be alive after initialization");
  const elite = eliteBandits(state)[0];
  const ratio = partyStrength(elite) / Math.max(1, partyStrength(state.player));
  assert.ok(ratio >= 1.5 && ratio <= 2, `ELITE strength ratio ${ratio.toFixed(3)} must be in [1.5, 2] at spawn`);
  assert.equal(elite.lootMultiplier ?? 3, 3, "ELITE loot multiplier must be 3x");

  const rollLoot = requireFunction(
    [battleModule, simModule, stateModule],
    ["rollLoot", "calculateLoot", "generateLoot"],
    "seeded randomized loot/jackpot testing"
  );
  const sequence = (seed) => {
    const sample = createInitialState(seed);
    return Array.from({ length: 300 }, () => rollLoot(sample, { elite: false, troops: [{ type: "bandit", count: 2, xp: 0 }] }));
  };
  const first = sequence(122);
  const second = sequence(122);
  assert.deepEqual(second, first, "loot sequence must replay from the same seed");
  assert.ok(new Set(first.map((entry) => typeof entry === "number" ? entry : entry.amount)).size > 1, "normal loot must be randomized");
  const jackpots = first.filter((entry) => typeof entry === "object" ? entry.jackpot : entry >= 200).length;
  const rate = jackpots / first.length;
  assert.ok(rate >= 0.07 && rate <= 0.13, `seeded jackpot rate ${(rate * 100).toFixed(1)}% must approximate exact 10% threshold`);

  const replaceElite = firstFunction([simModule, stateModule, battleModule], ["ensureEliteBandit", "spawnEliteBandit"]);
  assert.ok(replaceElite, "elite replacement must be an explicit deterministic production function");
  state.bandits = state.bandits.filter((bandit) => bandit !== elite);
  replaceElite(state);
  assert.equal(eliteBandits(state).length, 1, "ELITE must be replaced immediately when defeated/removed");
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
  state.player.troops = [{ type: "militia", count: 97, xp: 0 }];
  state.player.renown = 49;
  checkActs(state);
  assert.equal(state.player.act, 1);
  state.player.renown = 50;
  checkActs(state);
  assert.equal(state.player.act, 2, "renown 50 must enter Act 2 exactly once");
  const actOne = state.player.promises.find((promise) => promise.act === 1) || state.player.promises[0];
  assert.equal(actOne.actualAtActEnd ?? actOne.actual, 97, "Act 1 must capture final actual troop count");
  setPromise(state, 500, "gold");
  const marker = findSemantic(state.player, [/promise.*(exceeded|overshoot)/i], (value) => value === true);
  assert.ok(marker, "crossing the troop promise must set a permanent overshoot marker");
  setStack(state.player, "militia", 1, 0);
  checkActs(state);
  assert.ok(findSemantic(state.player, [/promise.*(exceeded|overshoot)/i], (value) => value === true), "overshoot marker must stay set after troop losses");
  state.player.renown = 99;
  checkActs(state);
  assert.ok(!state.ending?.complete && !state.demo?.ended && state.demoComplete !== true, "renown 99 must not end the demo");
  state.player.renown = 100;
  checkActs(state);
  assert.ok(state.ending?.complete || state.ending?.visible || state.demo?.ended || state.demoComplete === true, "renown 100 must open the demo ending");
  assert.equal(state.player.act, 2, "DEMO must never enter Act 3");
});

test("contracts: Act 2 tavern offers and payouts are deterministic", () => {
  const getOffer = requireFunction(
    [contractsModule, simModule, actsModule],
    ["getContractOffer", "generateContractOffer", "createContractOffer"],
    "Act 2 tavern contract offers"
  );
  const accept = requireFunction(
    [contractsModule, simModule, actsModule],
    ["acceptContract", "takeContract"],
    "Act 2 contract acceptance"
  );
  const first = createInitialState(141);
  const second = createInitialState(141);
  first.player.act = 1;
  assert.ok(!getOffer(first), "contracts must remain unavailable in Act 1");
  first.player.act = 2;
  second.player.act = 2;
  const offerA = getOffer(first);
  const offerB = getOffer(second);
  assert.ok(offerA, "Act 2 town/tavern must provide a contract offer");
  assert.deepEqual(offerB, offerA, "same seed must produce the same contract offer");
  const accepted = accept(first, offerA);
  assert.notEqual(accepted, false, "valid Act 2 contract must be accepted");
  assert.ok(first.player.contract || first.contract || first.contracts?.active, "active contract must be stored in state");
  const storage = new MemoryStorage();
  saveState(first, storage);
  assert.ok(loadState(storage), "active contract state must survive save/load");
});

test("ending/share: crown1 base64 codec round-trips compact Unicode telemetry", () => {
  const encode = requireFunction(
    [shareModule, actsModule, telemetryModule],
    ["encodeShare", "encodeShareText", "createShareText", "encodeCrownCode"],
    "crown1 share encoding"
  );
  const decode = requireFunction(
    [shareModule, actsModule, telemetryModule],
    ["decodeShare", "decodeShareText", "parseShareText", "decodeCrownCode"],
    "crown1 share decoding"
  );
  const payload = {
    version: CONFIG.VERSION,
    seed: 0,
    promises: [{ act: 1, stated: 60, actual: 97 }, { act: 2, stated: 500, actual: 731 }],
    stats: { days: 42, battles: 18, wins: 15, peakTroops: 97, peakGold: 731 },
    telemetry: { activeSeconds: 1234.5, quitPoint: "试玩终", tooltipViews: 3, replayCount: 1 }
  };
  const code = encode(payload);
  assert.ok(code.startsWith("crown1."), "codec output must start with crown1.");
  assert.ok(code.length < 4096, `share code must stay compact; got ${code.length} characters`);
  assert.deepEqual(decode(code), payload, "encode→decode must preserve compact JSON including Unicode");
  const state = createInitialState(0);
  state.telemetry = clone(payload.telemetry);
  const buildMessage = requireFunction([shareModule, telemetryModule], ["buildShareMessage", "createShareMessage"], "exact share message");
  const message = buildMessage(state, "zh");
  assert.ok(message.startsWith("我的《王冠》试玩结果:crown1."), "share message prefix must be exact");
  assert.deepEqual(decode(message), telemetryModule?.buildPlaytestPayload ? telemetryModule.buildPlaytestPayload(state) : decode(message), "decoder must accept the full pasted Chinese message");
  assert.throws(() => decode("crown1.not-valid-base64"), "invalid share codes must fail safely");
});

test("ending/replay: mirror schema, stats, session end, replay count, and new seed", () => {
  const buildEnding = requireFunction(
    [actsModule, shareModule, telemetryModule, stateModule],
    ["buildEndingSummary", "createEndingSummary", "finishDemo", "buildPlaytestPayload"],
    "ending summary"
  );
  const replay = requireFunction(
    [demoModule, actsModule, stateModule, autoplayModule],
    ["replayWithNewSeed", "startReplay", "createReplayState", "nextReplaySeed"],
    "new-seed replay"
  );
  const state = createInitialState(151);
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
    battles: result.state?.stats?.battles
  };
  diagnostics.autoplay.push(metrics);
  assert.ok(Number.isFinite(metrics.firstBattleSeconds) && metrics.firstBattleSeconds <= 90, `first battle took ${metrics.firstBattleSeconds}s; target <=90s`);
  assert.ok(metrics.act2Seconds >= 600 && metrics.act2Seconds <= 720, `Act 2 took ${(metrics.act2Seconds / 60).toFixed(2)}m; target 10–12m`);
  assert.ok(metrics.endingSeconds >= 1200 && metrics.endingSeconds <= 1800, `ending took ${(metrics.endingSeconds / 60).toFixed(2)}m; target 20–30m`);
  assert.equal(result.state?.player?.act, 2, "autoplay must end in Act 2, never Act 3");
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

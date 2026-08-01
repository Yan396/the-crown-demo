import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const OUTPUTS = path.join(ROOT, "outputs");
const JS_DIR = path.join(OUTPUTS, "js");

const exact = Object.freeze({
  opening: "边军解散,你带着最后 5 个弟兄流落河湾。传闻:乱世将至,王座虚悬。",
  wageGrace: "第3天起发军饷",
  eliteHint: "附近出现大股匪帮",
  verdicts: ["稳赢", "势均力敌", "打不过"]
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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

function filesIn(directory, suffix = ".js") {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(suffix))
    .map((name) => path.join(directory, name));
}

function read(relativePath) {
  return fs.readFileSync(path.join(OUTPUTS, relativePath), "utf8");
}

function sourceBundle() {
  return filesIn(JS_DIR).map((file) => `\n/* ${path.basename(file)} */\n${fs.readFileSync(file, "utf8")}`).join("");
}

const importFailures = [];
const modules = new Map();
const domModules = new Set(["main.js", "ui.js", "decode.js", "seal.js", "battlefield.js", "map.js"]);
for (const file of filesIn(JS_DIR)) {
  const name = path.basename(file);
  if (domModules.has(name)) continue;
  try {
    modules.set(name, await import(`${pathToFileURL(file).href}?casual=${Date.now()}`));
  } catch (error) {
    importFailures.push({ name, message: error?.message || String(error) });
  }
}

const data = modules.get("data.js") || {};
const stateModule = modules.get("state.js") || {};
const sim = modules.get("sim.js") || {};
const battle = modules.get("battle.js") || {};
const demo = modules.get("demo.js") || {};
const casual = modules.get("casual.js") || {};
const living = modules.get("living.js") || {};
const strings = modules.get("strings.js") || {};
const CONFIG = data.CONFIG || {};
const TROOP_TYPES = data.TROOP_TYPES || {};

function findConfig(patterns, expected) {
  const entry = Object.entries(CONFIG).find(([key]) => patterns.some((pattern) => pattern.test(key)));
  assert.ok(entry, `missing CONFIG value matching ${patterns.join(" / ")}`);
  if (expected !== undefined) assert.equal(entry[1], expected, `${entry[0]} must equal ${expected}`);
  return entry;
}

function findExport(names) {
  for (const mod of modules.values()) {
    for (const name of names) if (typeof mod[name] === "function") return mod[name];
  }
  return null;
}

function translation(language, key, parameters = {}) {
  if (typeof strings.translate === "function") return strings.translate(language, key, parameters);
  return flatten(strings.STRINGS?.[language] || {}).get(key) || "";
}

function translatedValues(language) {
  return [...flatten(strings.STRINGS?.[language] || {}).values()].filter((value) => typeof value === "string");
}

function resolveLocalized(record, language, preferred = ["prompt", "body", "description", "text", "copy", "story", "title"]) {
  if (!record || typeof record !== "object") return "";
  for (const field of preferred) {
    const value = record[field];
    if (typeof value === "string") {
      if (field.endsWith("Key") || /^[-\w]+\.[-\w.]+$/.test(value)) {
        const translated = translation(language, value);
        if (translated && translated !== value) return translated;
      }
      return value;
    }
    if (value && typeof value === "object" && typeof value[language] === "string") return value[language];
  }
  if (typeof record[language] === "string") return record[language];
  for (const [field, value] of Object.entries(record)) {
    if (!/Key$/i.test(field) || typeof value !== "string") continue;
    const translated = translation(language, value);
    if (translated && translated !== value) return translated;
  }
  return "";
}

function allLocalizedText(record, language) {
  const pieces = [];
  const visit = (value, key = "") => {
    if (typeof value === "string") {
      if (key === language) pieces.push(value);
      else if (/Key$/i.test(key)) {
        const translated = translation(language, value);
        if (translated && translated !== value) pieces.push(translated);
      }
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(record);
  const direct = resolveLocalized(record, language);
  if (direct) pieces.push(direct);
  return [...new Set(pieces)].join(" ");
}

function sentenceCount(text) {
  const normalized = String(text).trim();
  if (!normalized) return 0;
  const segments = normalized
    .split(/[。！？.!?]+/u)
    .map((part) => part.trim())
    .filter((part) => /[\p{L}\p{N}]/u.test(part));
  return Math.max(1, segments.length);
}

function eventChoices(event) {
  return event.choices || event.options || event.actions || [];
}

function effectsOf(choice) {
  return choice?.effects ?? choice?.effect ?? choice?.outcome ?? null;
}

function numericEffect(choice, pattern) {
  const effect = effectsOf(choice);
  return [...flatten(effect || {}).entries()].find(([key, value]) => pattern.test(key) && Number.isFinite(value));
}

function findEventDeck() {
  const candidates = [];
  for (const [moduleName, mod] of modules) {
    for (const [exportName, value] of Object.entries(mod)) {
      if (!Array.isArray(value)) continue;
      const score = value.reduce((count, entry) => count + (
        entry && typeof entry === "object" && eventChoices(entry).length === 2 ? 1 : 0
      ), 0);
      if (score) candidates.push({ moduleName, exportName, value, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score || b.value.length - a.value.length);
  return candidates[0] || null;
}

function partyStrength(party) {
  return (party?.troops || []).reduce((sum, stack) => (
    sum + (TROOP_TYPES[stack.type]?.atk || 0) * stack.count
  ), 0);
}

function totalTroops(party) {
  return (party?.troops || []).reduce((sum, stack) => sum + stack.count, 0);
}

function quietWorld(state) {
  state.paused = false;
  if (state.demo) {
    state.demo.modal = null;
    state.demo.pauseReason = null;
    state.demo.onboardingComplete = true;
  }
  state.player.moveTarget = null;
  state.player.fiefs = [];
  const roads = modules.get("roads.js") || {};
  if (typeof roads.buildRoads === "function" && typeof roads.isOnRoad === "function") {
    const network = roads.buildRoads(state.seed);
    outer: for (let y = 20; y < CONFIG.WORLD_SIZE; y += 120) {
      for (let x = 20; x < CONFIG.WORLD_SIZE; x += 120) {
        if (!roads.isOnRoad(network, x, y)) {
          state.player.pos = { x, y };
          state.player.prevPos = clone(state.player.pos);
          break outer;
        }
      }
    }
  }
  for (const bandit of state.bandits || []) {
    bandit.pos = { x: CONFIG.WORLD_SIZE - 10, y: 10 };
    bandit.prevPos = clone(bandit.pos);
    bandit.moveTarget = null;
  }
  for (const lord of state.lords || []) lord.defeatedUntilTick = Number.MAX_SAFE_INTEGER;
  return state;
}

function makeBandit(state, id, { count = 1, loot = 17 } = {}) {
  const bandit = {
    id,
    pos: clone(state.player.pos),
    prevPos: clone(state.player.pos),
    moveTarget: null,
    troops: [{ type: "bandit", count, xp: 0 }],
    gold: loot * 2,
    lootValue: loot,
    baseLootValue: loot,
    lootMultiplier: 1,
    jackpot: false,
    elite: false,
    isElite: false,
    marker: { kind: "normal", sizeMultiplier: 1, palette: "gray" }
  };
  state.bandits.push(bandit);
  return bandit;
}

function activateRoadEvent(state, eventId) {
  const active = {
    eventId,
    day: state.stats.days,
    factionId: state.factions[0]?.id || "north",
    resumePaused: false,
    resumePauseReason: null
  };
  state.demo.roadEvent = active;
  state.demo.activeRoadEvent = active;
  state.demo.modal = "roadEvent";
  state.demo.pauseReason = "roadEvent";
  state.paused = true;
  return active;
}

function semanticNumber(object, patterns) {
  return [...flatten(object || {}).entries()].find(([key, value]) => (
    patterns.some((pattern) => pattern.test(key)) && Number.isFinite(value)
  ));
}

function semanticFlag(object, patterns) {
  return [...flatten(object || {}).entries()].find(([key, value]) => (
    patterns.some((pattern) => pattern.test(key)) && typeof value === "boolean"
  ));
}

const tests = [];
const diagnostics = { assumptions: [], manual: [] };
function test(name, fn) {
  tests.push({ name, fn });
}

test("smoke: all non-DOM production modules import", () => {
  assert.deepEqual(importFailures, [], importFailures.map((failure) => `${failure.name}: ${failure.message}`).join("\n"));
  for (const required of ["data.js", "state.js", "sim.js", "battle.js", "strings.js"]) {
    assert.ok(modules.has(required), `${required} must import`);
  }
});

test("story: title/opening copy and one fiction line per mirror question", () => {
  const zhValues = translatedValues("zh");
  const enValues = translatedValues("en");
  assert.ok(zhValues.includes(exact.opening), `missing exact opening story: ${exact.opening}`);
  const openingKey = [...flatten(strings.STRINGS?.zh || {}).entries()].find(([, value]) => value === exact.opening)?.[0];
  assert.ok(openingKey, "opening story must have a stable translation key");
  assert.ok(String(flatten(strings.STRINGS?.en || {}).get(openingKey) || "").trim(), "opening story needs natural English copy at the same key");

  const index = read("index.html");
  assert.match(index, /(?:story|tagline|fiction|intro)/i, "title/opening screen needs a dedicated story/tagline element");
  const ui = read("js/ui.js");
  assert.ok(ui.includes(openingKey) || /(?:story|tagline|fiction|intro)/i.test(ui), "UI must put the story on the opening/title screen");

  const zhFlat = flatten(strings.STRINGS?.zh || {});
  const introEntries = [...zhFlat.entries()].filter(([key, value]) => (
    /(?:fiction|intro|story)/i.test(key) && /act\s*[12]|act[12]/i.test(key) && typeof value === "string"
  ));
  assert.equal(introEntries.length, 2, "exactly one fiction-line string is required for each of Acts 1 and 2");
  for (const [key, value] of introEntries) {
    assert.equal(sentenceCount(value), 1, `${key} must be exactly one fiction sentence`);
    assert.ok(String(flatten(strings.STRINGS?.en || {}).get(key) || "").trim(), `${key} needs English copy`);
  }
  assert.match(ui, /(?:fiction|intro|story)[\s\S]{0,600}(?:promiseQuestion|promise-question|question)/i, "fiction line must be populated before the mirror question");
  assert.ok(zhValues.includes("王冠"), "visible Chinese title must remain 王冠");
  assert.ok(enValues.some((value) => /crown/i.test(value)), "English title must remain translated");
});

test("events: exactly 20 bilingual, one-to-two sentence, binary-choice definitions", () => {
  const candidate = findEventDeck();
  assert.ok(candidate, "export a data-only 20-event deck from a production module");
  const deck = candidate.value;
  assert.equal(deck.length, 20, `${candidate.moduleName}:${candidate.exportName} must contain exactly 20 events`);
  assert.equal(new Set(deck.map((event) => event.id)).size, 20, "all casual-event ids must be unique");
  for (const event of deck) {
    assert.equal(typeof event.id, "string", "every event needs a string id");
    for (const language of ["zh", "en"]) {
      const copy = resolveLocalized(event, language);
      assert.ok(copy.trim(), `${event.id} needs ${language} narrative copy`);
      const sentences = sentenceCount(copy);
      assert.ok(sentences >= 1 && sentences <= 2, `${event.id}.${language} must be 1–2 sentences, got ${sentences}: ${copy}`);
    }
    const choices = eventChoices(event);
    assert.equal(choices.length, 2, `${event.id} must have exactly two buttons`);
    for (const [index, choice] of choices.entries()) {
      assert.ok(resolveLocalized(choice, "zh", ["label", "text", "copy", "title"]).trim(), `${event.id} choice ${index + 1} needs zh label`);
      assert.ok(resolveLocalized(choice, "en", ["label", "text", "copy", "title"]).trim(), `${event.id} choice ${index + 1} needs en label`);
      assert.ok(Object.hasOwn(choice, "effects") || Object.hasOwn(choice, "effect") || Object.hasOwn(choice, "outcome"), `${event.id} choice ${index + 1} needs declarative effects`);
      assert.ok(effectsOf(choice) && typeof effectsOf(choice) === "object", `${event.id} choice ${index + 1} effects must be data, not imperative code`);
    }
    const effectKeys = [...flatten(choices.map(effectsOf)).keys()].join(" ");
    assert.match(effectKeys, /gold|troop|renown|relation/i, `${event.id} must touch gold, troops, renown, or relation`);
  }
  diagnostics.eventDeck = `${candidate.moduleName}:${candidate.exportName}`;
});

test("events: six reusable topic glyphs and neutral equal-choice styling", () => {
  const deck = findEventDeck()?.value || [];
  const topics = [...new Set(deck.map((event) => event.topic))].sort();
  assert.equal(topics.length, 6, "the 20 cards must reuse exactly six topic glyph categories");
  assert.deepEqual(topics, [...(data.ROAD_EVENT_TOPICS || [])].sort(), "every exported road-event topic must be used");
  const index = read("index.html");
  for (const topic of topics) {
    assert.match(index, new RegExp(`id=["']road-event-glyph-${topic}["']`), `missing inline SVG symbol for ${topic}`);
  }
  assert.match(index, /id=["']road-event-glyph-use["']/, "event card needs one reusable SVG <use> target");
  assert.match(index, /id=["']road-event-choice-a["'][^>]*class=["']road-event-choice["']/, "choice A must use the neutral event-choice style");
  assert.match(index, /id=["']road-event-choice-b["'][^>]*class=["']road-event-choice["']/, "choice B must use the same neutral event-choice style");
  const css = read("css/ui.css");
  assert.match(css, /\.road-event-choice\s*\{/, "neutral event-choice CSS is required");
});

test("events: three specified examples preserve exact choices and effects", () => {
  const deck = findEventDeck()?.value || [];
  const text = (event) => allLocalizedText(event, "zh");
  const deserter = deck.find((event) => /逃兵/.test(text(event)) && /做饭/.test(text(event)));
  assert.ok(deserter, "event deck needs the 逃兵会做饭 event");
  const take = eventChoices(deserter).find((choice) => /收下/.test(allLocalizedText(choice, "zh")));
  const dismiss = eventChoices(deserter).find((choice) => /赶走/.test(allLocalizedText(choice, "zh")));
  assert.equal(numericEffect(take, /troop/i)?.[1], 1, "收下逃兵 must add exactly one troop");
  assert.equal(numericEffect(dismiss, /renown/i)?.[1], 2, "赶走逃兵 must add exactly two renown");
  assert.match(allLocalizedText(dismiss, "zh"), /军纪严明/, "赶走 outcome must say 军纪严明");

  const caravan = deck.find((event) => /商队/.test(text(event)) && /护送/.test(text(event)));
  assert.ok(caravan, "event deck needs the 商队护送 event");
  const escort = eventChoices(caravan).find((choice) => /接|护送/.test(allLocalizedText(choice, "zh")) && !/拒/.test(allLocalizedText(choice, "zh")));
  assert.equal(numericEffect(escort, /gold/i)?.[1], 40, "accepting the caravan escort must add exactly 40 gold");
  const escortEffects = [...flatten(effectsOf(escort) || {}).entries()];
  assert.ok(escortEffects.some(([key, value]) => /(?:bandit|battle|fight).*(?:lock|block|disable)|(?:lock|block|disable).*(?:bandit|battle|fight)/i.test(key) && Boolean(value)), "escort must block bandit fighting for the current day");

  const drink = deck.find((event) => /喝一顿/.test(text(event)) || (/酒/.test(text(event)) && /请/.test(text(event))));
  assert.ok(drink, "event deck needs the 喝一顿 event");
  const treat = eventChoices(drink).find((choice) => /请/.test(allLocalizedText(choice, "zh")) && !/不请/.test(allLocalizedText(choice, "zh")));
  const decline = eventChoices(drink).find((choice) => /不请|拒/.test(allLocalizedText(choice, "zh")));
  assert.equal(numericEffect(treat, /gold/i)?.[1], -15, "请客 must cost exactly 15 gold");
  const attack = numericEffect(treat, /attack|damage/i)?.[1];
  assert.ok(attack === 0.2 || attack === 1.2, "请客 must give exactly +20% on the next attack");
  assert.equal(numericEffect(decline, /desert|troop.*loss.*chance/i)?.[1], 0.05, "不请 must carry exactly a 5% desertion chance");
});

test("events: specified special effects execute through the seeded production resolver", () => {
  assert.equal(typeof casual.chooseRoadEvent, "function", "casual choice resolver must be exported");
  const deck = findEventDeck()?.value || [];
  const findByText = (pattern) => deck.find((event) => pattern.test(allLocalizedText(event, "zh")));
  const deserter = findByText(/逃兵.*做饭/s);
  const caravan = findByText(/商队.*护送/s);
  const drinks = findByText(/喝一顿|弟兄们想喝/s);
  assert.ok(deserter && caravan && drinks, "all three specified events must be present before runtime effects are tested");

  {
    const state = quietWorld(stateModule.createInitialState(0xe001, { skipOnboarding: true }));
    state.player.gold = 100;
    state.player.renown = 0;
    const troopsBefore = totalTroops(state.player);
    activateRoadEvent(state, deserter.id);
    const result = casual.chooseRoadEvent(state, 0);
    assert.equal(result.ok, true);
    assert.equal(totalTroops(state.player), troopsBefore + 1, "收下 must actually add one troop");
    assert.equal(state.player.gold, 100, "收下 must cost exactly zero gold");
    assert.equal(state.telemetry.eventChoices.length, 1, "event choices must be recorded in telemetry");
    assert.deepEqual(
      state.telemetry.eventChoices[0],
      { eventId: deserter.id, choiceIndex: 0, day: state.stats.days, delta: { troops: 1 } },
      "event telemetry must stay compact and preserve the chosen card, button, day, and applied delta"
    );
  }
  {
    const state = quietWorld(stateModule.createInitialState(0xe002, { skipOnboarding: true }));
    state.player.renown = 0;
    activateRoadEvent(state, deserter.id);
    const result = casual.chooseRoadEvent(state, 1);
    assert.equal(state.player.renown, 2, "赶走 must actually add two renown");
    assert.equal(result.choice?.result?.zh, "军纪严明。", "赶走 must return the exact outcome copy");
  }
  {
    const state = quietWorld(stateModule.createInitialState(0xe003, { skipOnboarding: true }));
    state.player.gold = 100;
    activateRoadEvent(state, caravan.id);
    const result = casual.chooseRoadEvent(state, 0);
    assert.equal(result.ok, true);
    assert.equal(state.player.gold, 140, "accepting the escort must actually add 40 gold");
    const blocked = semanticNumber(state, [/bandit.*battle.*blocked.*day/i]);
    assert.ok(blocked && blocked[1] === state.stats.days, "escort must persist the blocked game-day");
    const bandit = makeBandit(state, "escort_block_probe", { count: 1, loot: 0 });
    assert.equal(battle.startBattle(state, bandit)?.type, "blocked", "same-day bandit battle must be blocked through startBattle");
    state.stats.days += 1;
    assert.equal(battle.startBattle(state, bandit), null, "escort block must expire on the next game-day");
    assert.ok(state.battle, "next-day battle must start normally");
  }
  {
    const state = quietWorld(stateModule.createInitialState(0xe004, { skipOnboarding: true }));
    state.player.gold = 100;
    activateRoadEvent(state, drinks.id);
    const result = casual.chooseRoadEvent(state, 0);
    assert.equal(result.ok, true);
    assert.equal(state.player.gold, 85, "请客 must actually deduct 15 gold");
    assert.equal(semanticNumber(state, [/next.*battle.*attack.*mult/i])?.[1], 1.2, "请客 must arm exactly 1.2x for the next attack");
    const first = makeBandit(state, "drink_buff_probe_1", { count: 1, loot: 0 });
    battle.startBattle(state, first);
    assert.equal(state.battle?.playerAttackMultiplier, 1.2, "the next production battle must consume the 1.2x attack buff");
    state.battle = null;
    state.bandits = state.bandits.filter((entry) => entry !== first);
    const second = makeBandit(state, "drink_buff_probe_2", { count: 1, loot: 0 });
    battle.startBattle(state, second);
    assert.equal(state.battle?.playerAttackMultiplier, 1, "the +20% attack effect must apply once only");
  }

  const desertions = [];
  for (let sample = 1; sample <= 2000; sample += 1) {
    const seed = Math.imul(sample, 0x9e3779b9) >>> 0;
    const state = quietWorld(stateModule.createInitialState(seed, { skipOnboarding: true }));
    state.player.troops = [{ type: "militia", count: 5, xp: 0 }];
    activateRoadEvent(state, drinks.id);
    const result = casual.chooseRoadEvent(state, 1);
    desertions.push(result.applied?.deserterLost || 0);
    assert.ok(totalTroops(state.player) >= 1, "5% desertion may never remove the last troop");
  }
  const rate = desertions.filter((count) => count === 1).length / desertions.length;
  assert.ok(rate >= 0.035 && rate <= 0.065, `seeded 不请 desertion rate ${(rate * 100).toFixed(2)}% must evidence the exact 5% branch`);
  diagnostics.desertionRate = rate;
});

test("road events: exact daily 25% gate and at most one event per day", () => {
  findConfig([/ROAD.*EVENT.*(?:CHANCE|PROBABILITY)/i, /EVENT.*ROAD.*(?:CHANCE|PROBABILITY)/i], 0.25);
  findConfig([/^MAX_DAILY_EVENTS$/i, /(?:MAX|LIMIT).*EVENT.*(?:PER|EACH).*DAY/i, /EVENT.*(?:PER|EACH).*DAY.*(?:MAX|LIMIT)/i], 1);
  const source = sourceBundle();
  assert.match(source, /(?:isOnRoad|distanceToRoad|road)[\s\S]{0,1000}(?:EVENT|event)/, "daily event gate must check that the player is on a road");
  assert.match(source, /(?:lastEventDay|eventsToday|eventDay|dailyEvent)[\s\S]{0,1000}(?:MAX|LIMIT|<\s*1|>=\s*1)/i, "production must persist a per-day cap, not only rely on modal blocking");

  const process = findExport(["processDailyRoadEvent", "maybeTriggerRoadEvent", "rollDailyRoadEvent"]);
  const choose = findExport(["chooseRoadEvent", "resolveRoadEvent", "applyRoadEventChoice"]);
  assert.ok(process && choose, "road event roll/choice APIs must be exported for deterministic acceptance");
  const sequence = () => {
    const triggered = [];
    for (let sample = 1; sample <= 1000; sample += 1) {
      // Knuth-spaced seeds avoid measuring correlations between neighboring
      // initial world streams while remaining an exact, replayable sequence.
      const seed = Math.imul(sample, 0x9e3779b9) >>> 0;
      const state = quietWorld(stateModule.createInitialState(seed, { skipOnboarding: true }));
      state.stats.days = 1;
      const result = process(state, { onRoad: true });
      triggered.push(Boolean(result?.triggered));
      if (result?.triggered) {
        assert.equal(state.casual?.roadEventsToday, 1, "a triggered day must record exactly one road event");
        assert.equal(choose(state, 0)?.ok, true, "a road event must resolve through its production choice path");
      }
      const second = process(state, { onRoad: true });
      assert.equal(second?.triggered, false, "the same day may never trigger a second event");
      assert.ok(["alreadyRolled", "dailyLimit"].includes(second?.reason), `same-day second roll must be explicitly capped, got ${second?.reason}`);
    }
    return triggered;
  };
  const first = sequence();
  const second = sequence();
  assert.deepEqual(second, first, "the 25% road-event sequence must replay exactly from seeds");
  const rate = first.filter(Boolean).length / first.length;
  assert.ok(rate >= 0.22 && rate <= 0.28, `1000 seeded daily rolls yielded ${(rate * 100).toFixed(1)}%, expected deterministic evidence near 25%`);
  diagnostics.roadEventRate = rate;
});

test("wages: days 1–2 are free and day 3 charges once", () => {
  const startDay = Object.entries(CONFIG).find(([key, value]) => /WAGE.*(?:START|FIRST).*DAY/i.test(key) && value === 3);
  const graceDays = Object.entries(CONFIG).find(([key, value]) => /WAGE.*GRACE.*DAYS/i.test(key) && value === 2);
  assert.ok(startDay || graceDays, "CONFIG must define wage start day 3 or two grace days");
  assert.ok(translatedValues("zh").includes(exact.wageGrace), `HUD must contain exact copy: ${exact.wageGrace}`);

  assert.equal(typeof stateModule.createInitialState, "function");
  assert.equal(typeof sim.worldTick, "function");
  const state = quietWorld(stateModule.createInitialState(0xc451, { skipOnboarding: true }));
  state.player.gold = 100;
  state.player.troops = [{ type: "militia", count: 5, xp: 0 }];
  state.stats.wagesPaid = 0;
  for (let day = 1; day <= 3; day += 1) {
    state.tick = day * CONFIG.TICKS_PER_DAY - 1;
    state.stats.days = day - 1;
    const result = sim.worldTick(state);
    assert.equal(result.dayAdvanced, true, `day ${day} boundary must execute`);
    if (day <= 2) {
      assert.equal(state.player.gold, 100, `day ${day} must remain inside the wage grace period`);
      assert.equal(state.stats.wagesPaid, 0, `day ${day} must not record wages`);
    }
  }
  assert.equal(state.player.gold, 95, "day 3 must deduct exactly five militia wages once");
  assert.equal(state.stats.wagesPaid, 5, "day 3 must record the exact paid wage");
});

test("battle onboarding: first two encounters are 0.4–0.6 strength and 2x loot", () => {
  findConfig([/(?:FIRST|STARTER).*(?:BATTLE|ENCOUNTER).*(?:COUNT|BATTLES)/i], 2);
  findConfig([/(?:FIRST|STARTER).*(?:BATTLE|ENCOUNTER).*STRENGTH.*MIN/i], 0.4);
  findConfig([/(?:FIRST|STARTER).*(?:BATTLE|ENCOUNTER).*STRENGTH.*MAX/i], 0.6);
  findConfig([/(?:FIRST|STARTER).*(?:BATTLE|ENCOUNTER).*LOOT.*(?:MULTIPLIER|MULT|BONUS)/i], 2);
  assert.equal(typeof battle.startBattle, "function");
  assert.equal(typeof battle.skipBattle, "function");
  const state = quietWorld(stateModule.createInitialState(0xc452, { skipOnboarding: true }));
  state.player.troops = [{ type: "veteran", count: 10, xp: 0 }];
  state.stats.battles = 0;
  state.stats.wins = 0;
  for (let ordinal = 1; ordinal <= 2; ordinal += 1) {
    const bandit = makeBandit(
      state,
      `casual_starter_${ordinal}`,
      ordinal === 1 ? { count: 100, loot: CONFIG.LOOT_JACKPOT_MIN } : undefined
    );
    if (ordinal === 1) bandit.jackpot = true;
    battle.startBattle(state, bandit);
    if (ordinal === 1) {
      assert.ok(
        bandit.lootValue >= CONFIG.LOOT_JACKPOT_MIN,
        "starter-battle scaling must not reduce a jackpot below its 200-gold floor"
      );
    }
    const ratio = partyStrength(bandit) / partyStrength(state.player);
    assert.ok(ratio >= 0.4 - 1e-9 && ratio <= 0.6 + 0.061, `starter battle ${ordinal} ratio ${ratio.toFixed(3)} must be 0.4–0.6 (one-bandit quantization allowed)`);
    const profile = state.battle || bandit;
    const lootMultiplier = semanticNumber(profile, [/starter.*loot.*(?:mult|factor)/i, /loot.*(?:mult|factor)/i])?.[1];
    assert.equal(lootMultiplier, 2, `starter battle ${ordinal} must carry an explicit 2x loot multiplier`);
    bandit.troops = [{ type: "bandit", count: 1, xp: 0 }];
    state.battle.banditStart = 1;
    const result = battle.skipBattle(state);
    assert.equal(result?.type, "victory", `starter battle ${ordinal} must resolve through production`);
    const resultMultiplier = semanticNumber(result, [/loot.*(?:mult|factor)/i])?.[1];
    const baseLoot = semanticNumber(result, [/(?:base|raw).*loot/i])?.[1];
    assert.ok(resultMultiplier === 2 || (Number.isFinite(baseLoot) && result.loot === baseLoot * 2), `starter battle ${ordinal} result must prove its payout was doubled`);
  }
});

test("rubber band: two consecutive losses cap the next two encounters at 0.7x", () => {
  findConfig([/(?:LOSS|DEFEAT).*STREAK.*(?:THRESHOLD|TRIGGER|COUNT)/i], 2);
  findConfig([/(?:LOSS|DEFEAT).*(?:RUBBER|ASSIST|CAP).*STRENGTH|(?:LOSS|DEFEAT).*STRENGTH.*CAP|(?:LOSS|DEFEAT).*SPAWN.*MAX.*RATIO|(?:RUBBER|ASSIST).*STRENGTH.*CAP/i], 0.7);
  findConfig([/(?:LOSS|DEFEAT).*(?:RUBBER|ASSIST).*(?:BATTLES|USES|COUNT)/i, /(?:LOSS|DEFEAT).*SPAWN.*COUNT/i, /(?:RUBBER|ASSIST).*(?:BATTLES|USES|COUNT)/i], 2);
  const state = quietWorld(stateModule.createInitialState(0xc453, { skipOnboarding: true }));
  state.stats.battles = 2;
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  state.player.gold = 0;
  for (let loss = 1; loss <= 2; loss += 1) {
    state.player.troops = [{ type: "militia", count: 1, xp: 0 }];
    const bandit = makeBandit(state, `casual_loss_${loss}`, { count: 100, loot: 0 });
    battle.startBattle(state, bandit);
    const result = battle.skipBattle(state);
    assert.equal(result?.type, "defeat", `loss ${loss} must pass through the production defeat path`);
  }
  const granted = semanticNumber(state, [/(?:rubber|assist|loss).*(?:remaining|uses|battles)/i, /recovery.*(?:remaining|spawns?)/i]);
  assert.ok(granted && granted[1] === 2, "two consecutive losses must grant exactly two assisted encounters");
  state.player.troops = [{ type: "veteran", count: 10, xp: 0 }];
  assert.equal(typeof casual.applyCasualSpawnBalance, "function", "spawn balance helper must be exported");
  assert.match(`${read("js/living.js")}\n${read("js/sim.js")}`, /spawnScaledBandit[\s\S]{0,500}applyCasualSpawnBalance|applyCasualSpawnBalance[\s\S]{0,500}spawnScaledBandit/, "production bandit spawning must apply the casual balance helper");
  for (let use = 1; use <= 2; use += 1) {
    const bandit = makeBandit(state, `casual_rubber_${use}`, { count: 100, loot: 0 });
    if (use === 1) {
      bandit.jackpot = true;
      bandit.lootValue = CONFIG.LOOT_JACKPOT_MIN;
      bandit.gold = Math.ceil(bandit.lootValue / CONFIG.LOOT_SHARE);
    }
    casual.applyCasualSpawnBalance(state, bandit);
    if (use === 1) {
      assert.ok(
        bandit.lootValue >= CONFIG.LOOT_JACKPOT_MIN,
        "loss-recovery scaling must not reduce a jackpot below its 200-gold floor"
      );
    }
    const ratio = partyStrength(bandit) / partyStrength(state.player);
    assert.ok(ratio <= 0.7 + 0.061, `rubber encounter ${use} ratio ${ratio.toFixed(3)} exceeds 0.7x cap`);
    const remaining = semanticNumber(state, [/(?:rubber|assist|loss).*(?:remaining|uses|battles)/i, /recovery.*(?:remaining|spawns?)/i]);
    assert.ok(remaining && remaining[1] === 2 - use, `rubber use ${use} must consume exactly one charge`);
    state.bandits = state.bandits.filter((entry) => entry !== bandit);
  }
});

test("win streak: four wins arm one 1.4x encounter and exact hint", () => {
  findConfig([/WIN.*STREAK.*(?:THRESHOLD|TRIGGER|COUNT)/i], 4);
  findConfig([/WIN.*STREAK.*(?:STRENGTH|MULTIPLIER|MULT|SCALE)/i, /WIN.*STREAK.*BIG.*SPAWN.*RATIO/i], 1.4);
  const usesEntry = Object.entries(CONFIG).find(([key]) => /WIN.*STREAK.*(?:BATTLES|USES|COUNT)/i.test(key));
  if (usesEntry) assert.equal(usesEntry[1], 1, `${usesEntry[0]} must equal one`);
  assert.ok(translatedValues("zh").includes(exact.eliteHint), `missing exact hint: ${exact.eliteHint}`);

  const state = quietWorld(stateModule.createInitialState(0xc454, { skipOnboarding: true }));
  state.stats.battles = 2;
  state.stats.wins = 0;
  state.casual.openingBattlesPrepared = CONFIG.STARTER_BATTLE_COUNT;
  for (let win = 1; win <= 4; win += 1) {
    state.player.troops = [{ type: "veteran", count: 10, xp: 0 }];
    const bandit = makeBandit(state, `casual_win_${win}`, { count: 1, loot: 0 });
    battle.startBattle(state, bandit);
    bandit.troops = [{ type: "bandit", count: 1, xp: 0 }];
    state.battle.banditStart = 1;
    assert.equal(battle.skipBattle(state)?.type, "victory", `win ${win} must use the production win path`);
  }
  const armed = semanticNumber(state, [/win.*streak.*(?:remaining|uses|battles)|(?:challenge|surge).*(?:remaining|uses)/i]);
  const armedFlag = semanticFlag(state, [/large.*(?:spawn|pack).*pending|(?:challenge|surge).*pending/i]);
  assert.ok((armed && armed[1] === 1) || (armedFlag && armedFlag[1] === true), "four consecutive wins must arm exactly one challenge encounter");
  state.player.troops = [{ type: "veteran", count: 10, xp: 0 }];
  const challenge = makeBandit(state, "casual_win_challenge", { count: 1, loot: 0 });
  casual.applyCasualSpawnBalance(state, challenge);
  const ratio = partyStrength(challenge) / partyStrength(state.player);
  assert.ok(ratio >= 1.4 - 0.061 && ratio <= 1.4 + 0.061, `streak challenge ratio ${ratio.toFixed(3)} must be 1.4x (one-bandit quantization allowed)`);
  const remaining = semanticNumber(state, [/win.*streak.*(?:remaining|uses|battles)|(?:challenge|surge).*(?:remaining|uses)/i]);
  const remainingFlag = semanticFlag(state, [/large.*(?:spawn|pack).*pending|(?:challenge|surge).*pending/i]);
  assert.ok((remaining && remaining[1] === 0) || (remainingFlag && remainingFlag[1] === false), "the 1.4x challenge must be consumed exactly once at encounter start");
  const hintEvidence = [
    ...(state.demo?.pendingTooltips || []),
    ...(state.eventLog || []).flatMap((entry) => [entry.key, ...Object.values(entry.parameters || {})])
  ].join(" ");
  assert.match(hintEvidence, /(?:elite|big|large|streak|challenge|大股匪帮)/i, "production state must queue the large-bandit hint when the one-shot challenge appears");
});

test("power verdict: exactly three words with CONFIG-owned ordered thresholds", () => {
  for (const label of exact.verdicts) assert.ok(translatedValues("zh").includes(label), `missing exact power verdict: ${label}`);
  const thresholdEntries = Object.entries(CONFIG).filter(([key, value]) => (
    /(?:POWER|STRENGTH|ENCOUNTER).*(?:VERDICT|JUDG|EASY|EVEN|HARD|WIN|LOSE|OUTMATCHED).*(?:THRESHOLD|RATIO|MIN|MAX)|(?:VERDICT|JUDG).*(?:THRESHOLD|RATIO|MIN|MAX)/i.test(key) && Number.isFinite(value)
  ));
  assert.ok(thresholdEntries.length >= 2, "CONFIG must own both power-verdict thresholds");
  const unique = [...new Set(thresholdEntries.map(([, value]) => value))].sort((a, b) => a - b);
  assert.ok(unique.length >= 2 && unique[0] < unique.at(-1), "power-verdict thresholds must be ordered and distinct");
  const source = sourceBundle();
  assert.match(source, /CONFIG\.[A-Z0-9_]*(?:POWER|STRENGTH|ENCOUNTER)[A-Z0-9_]*(?:THRESHOLD|RATIO|MIN|MAX)|CONFIG\.[A-Z0-9_]*(?:VERDICT|JUDG)[A-Z0-9_]*(?:THRESHOLD|RATIO|MIN|MAX)/, "verdict implementation must read thresholds from CONFIG");
  const ui = read("js/ui.js");
  assert.match(ui, /function\s+(?:battle|power|strength|encounter)Verdict\s*\(/i, "UI needs one centralized verdict classifier");
  assert.match(ui, /ratio\s*>=\s*CONFIG\.[A-Z0-9_]+[\s\S]{0,250}ratio\s*<=\s*CONFIG\.[A-Z0-9_]+[\s\S]{0,250}(?:verdictEven|势均力敌)/, "classifier must use CONFIG upper/lower boundaries with the even verdict between them");
});

test("UI structure: default log ticker, Act 1 contract hiding, title triple-tap diagnostics", () => {
  const index = read("index.html");
  const ui = read("js/ui.js");
  const css = read("css/ui.css");
  const main = read("js/main.js");
  const combined = `${ui}\n${main}`;
  const tickerLimit = Object.entries(CONFIG).find(([key, value]) => /(?:VISIBLE|DEFAULT|TICKER).*LOG.*(?:ENTRIES|COUNT|LIMIT)|LOG.*TICKER.*(?:ENTRIES|COUNT|LIMIT)/i.test(key) && value === 1);
  const collapsedTicker = /reportExpanded\s*=\s*false/.test(ui) && /#report:not\(\[data-expanded=["']?true["']?\]\)\s+#battle-log\s+li:not\(:first-child\)\s*\{[^}]*display\s*:\s*none/is.test(css);
  assert.ok(tickerLimit || /eventLog\.slice\(0,\s*1\)/.test(ui) || collapsedTicker, "event log must default to a one-entry ticker");
  assert.match(index, /battle-log[^>]*(?:aria-live|ticker)|(?:aria-live|ticker)[^>]*battle-log/i, "log ticker needs an identifiable live/ticker surface");
  assert.match(css, /(?:battle-log|ticker)[^{]*\{[^}]*(?:white-space\s*:\s*nowrap|text-overflow\s*:\s*ellipsis|overflow\s*:\s*hidden)/is, "default ticker must remain a single compact line");

  assert.match(ui, /tavern\.hidden\s*=\s*state\.player\.act\s*<\s*2/, "Act 1 must hide the tavern contract button, not merely disable it");
  assert.match(combined, /(?:brandTitle|brand-title|title)[\s\S]{0,300}addEventListener\(["'](?:click|pointerup)["']/, "title must own the privacy triple-tap listener");
  assert.match(combined, /(?:===|>=|<)\s*3|3\s*(?:===|<=|>)/, "diagnostics listener must trigger on exactly three taps");
  assert.match(css, /#seed-label[\s\S]{0,120}\.version-label\s*\{[^}]*display\s*:\s*none/is, "seed and version must be hidden by default");
  assert.match(css, /diagnostics-visible[^,{]*#seed-label[\s\S]{0,120}diagnostics-visible[^,{]*\.version-label\s*\{[^}]*display\s*:\s*block/is, "the third title tap must reveal seed and version through diagnostics-visible");
  const mirrorHidingRule = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, selector, body]) => (
    /display\s*:\s*none/.test(body) && selector.split(",").some((part) => {
      const candidate = part.trim();
      return /body\.(?:battle-active|victory-fx-active|settings-open|diagnostics-visible)/.test(candidate) &&
        (/#stats$/.test(candidate) || /\.promise-marker(?:\.exceeded)?$/.test(candidate));
    })
  ));
  assert.equal(mirrorHidingRule, undefined, "no active gameplay state may hide the permanent exceeded mirror line or its parent");
});

test("juice: 100ms pressed state, meaningful motion, and reduced-motion safety", () => {
  const css = read("css/ui.css");
  const activeRules = [...css.matchAll(/([^{}]*:(?:active|focus-visible)[^{}]*)\{([^}]*)\}/gis)];
  const hundredMsPress = activeRules.some(([, selector, body]) => (
    /button|choice|action/i.test(selector) && /100ms|0\.1s/.test(`${selector}{${body}}`) && /transform|translate|scale|box-shadow/.test(body)
  )) || /(?:button|choice|action)[^{]*\{[^}]*transition[^;}]*(?:100ms|0\.1s)[^}]*\}[\s\S]{0,1200}(?:button|choice|action)[^{]*:active/is.test(css);
  assert.ok(hundredMsPress, "interactive buttons need a visible 100ms pressed-state transition");
  const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
  assert.ok(keyframes.length >= 3, "casual juice needs at least three meaningful CSS animations (seal/counter/card or equivalent)");
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/i, "all juice must preserve reduced-motion safety");
});

test("number density: hard six-token budget is encoded and statically guarded", () => {
  findConfig([/(?:MAX|LIMIT).*VISIBLE.*NUMBER|VISIBLE.*NUMBER.*(?:MAX|LIMIT)|NUMBER.*DENSITY.*(?:MAX|LIMIT|BUDGET)/i], 6);
  const index = read("index.html");
  assert.ok((index.match(/id=["'][^"']*(?:gold|troop|renown|day|wage|seed|version)[^"']*["']/gi) || []).length > 0, "numeric HUD needs stable audit targets");
  const source = `${sourceBundle()}\n${read("css/ui.css")}`;
  assert.match(source, /(?:MAX_VISIBLE_NUMBERS|VISIBLE_NUMBER_(?:LIMIT|BUDGET)|NUMBER_DENSITY)/, "production must name the six-number budget for regression audits");
  diagnostics.manual.push("Browser: count visible /\\d+/g tokens (continuous digit run = 1) on title, opening, promise, map, encounter, town, event-card, and ending states; exclude hidden/aria-hidden/display:none/visibility:hidden; every state must be <=6.");
});

test("cold start: deterministic first battle <=90s and first casual event <=180s", () => {
  const run = findExport(["simulateAutoplay", "runAutoplay"]);
  assert.ok(run, "deterministic autoplay runner is required");
  const first = run(CONFIG.SEED, { multiplier: 20, maxActiveSeconds: 1800 });
  const second = run(CONFIG.SEED, { multiplier: 20, maxActiveSeconds: 1800 });
  assert.equal(first.firstBattleSeconds, second.firstBattleSeconds, "cold-start first battle timing must replay exactly from the seed");
  assert.ok(Number.isFinite(first.firstBattleSeconds) && first.firstBattleSeconds <= 90, `cold-start first battle took ${first.firstBattleSeconds}s; target <=90s`);
  const firstStateEvent = semanticNumber(first.state, [/(?:first).*(?:casual|road).*event.*(?:seconds|tick)/i]);
  const secondStateEvent = semanticNumber(second.state, [/(?:first).*(?:casual|road).*event.*(?:seconds|tick)/i]);
  const firstDirectEvent = first.firstEventSeconds ?? first.firstCasualEventSeconds ?? first.roadEventSeconds;
  const secondDirectEvent = second.firstEventSeconds ?? second.firstCasualEventSeconds ?? second.roadEventSeconds;
  const firstEvent = firstDirectEvent ?? firstStateEvent?.[1];
  const secondEvent = secondDirectEvent ?? secondStateEvent?.[1];
  assert.ok(Number.isFinite(firstEvent), "autoplay diagnostics must expose the first casual-event time");
  const eventSeconds = firstDirectEvent !== undefined
    ? firstEvent
    : /tick/i.test(firstStateEvent?.[0] || "") ? firstEvent * CONFIG.LOGIC_MS / 1000 : firstEvent;
  const replaySeconds = secondDirectEvent !== undefined
    ? secondEvent
    : /tick/i.test(secondStateEvent?.[0] || "") ? secondEvent * CONFIG.LOGIC_MS / 1000 : secondEvent;
  assert.equal(replaySeconds, eventSeconds, "first casual-event time must replay exactly from the seed");
  assert.ok(eventSeconds <= 180, `cold-start first casual event took ${eventSeconds}s; target <=180s`);
  diagnostics.coldStart = { firstBattleSeconds: first.firstBattleSeconds, firstEventSeconds: eventSeconds };
});

test("autoplay: ending remains reachable when logs and tooltips are presentation-only", () => {
  assert.equal(typeof sim.initializeLivingWorld, "function");
  assert.equal(typeof sim.setAutoplay, "function");
  assert.equal(typeof demo.advanceOnboarding, "function");
  assert.equal(typeof demo.submitPromise, "function");
  assert.equal(typeof demo.advanceActIfNeeded, "function");
  const state = stateModule.createInitialState(CONFIG.SEED, { startedAt: new Date(0).toISOString() });
  sim.initializeLivingWorld(state);
  sim.setAutoplay(state, true);
  state.demo.tooltipsSeen = { town: true, lowGold: true, act2: true, elite: true };
  state.demo.pendingTooltips = [];
  const resolveModal = () => {
    if (state.demo.modal === "onboarding") return demo.advanceOnboarding(state);
    if (state.demo.modal === "troopPromise") return demo.submitPromise(state, CONFIG.AUTOPLAY_TROOP_PROMISE, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    if (state.demo.modal === "act2Transition") return demo.beginAct2Promise(state);
    if (state.demo.modal === "goldPromise") return demo.submitPromise(state, CONFIG.AUTOPLAY_GOLD_PROMISE, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    if (state.demo.modal === "roadEvent") return casual.chooseRoadEvent(state, CONFIG.AUTOPLAY_ROAD_EVENT_CHOICE_INDEX);
    return null;
  };
  while (resolveModal()) {
    state.eventLog.length = 0;
    state.demo.pendingTooltips.length = 0;
  }
  let safety = Math.ceil(1800 / (CONFIG.LOGIC_MS / 1000)) + 10;
  while (!state.demo.ended && safety > 0) {
    const result = sim.worldTick(state);
    if (result.advanced) demo.advanceActIfNeeded(state, new Date(state.tick * CONFIG.LOGIC_MS).toISOString());
    while (resolveModal()) {
      // Modal choices consume no active simulation time.
    }
    // Delete all accumulated presentation state after every production tick.
    state.eventLog.length = 0;
    state.demo.pendingTooltips.length = 0;
    safety -= 1;
  }
  assert.ok(state.demo.ended, "autoplay must still reach the ending while log history and tooltip queues are continuously erased");
  assert.equal(state.eventLog.length, 0, "test precondition: no event-log history may survive");
  assert.equal(state.demo.pendingTooltips.length, 0, "test precondition: no tooltip queue may survive");
  assert.ok(state.player.renown >= CONFIG.DEMO_END_RENOWN, "suppressed presentation must not alter progression");
  assert.ok(state.telemetry.totalActiveSeconds <= 1800, "suppressed presentation must finish inside the demo time cap");
  const simSource = read("js/sim.js");
  assert.ok(!/(?:tooltip|renderEventLog|battleLog)[\s\S]{0,120}(?:return|break|continue)/i.test(simSource), "simulation progression must not branch on tooltip/log rendering state");
});

let passed = 0;
const failures = [];
for (const current of tests) {
  try {
    await current.fn();
    passed += 1;
    console.log(`PASS ${current.name}`);
  } catch (error) {
    failures.push({ name: current.name, message: error?.stack || String(error) });
    console.error(`FAIL ${current.name}`);
    console.error(error?.stack || error);
  }
}

const summary = {
  passed,
  failed: failures.length,
  failures: failures.map(({ name, message }) => ({ name, message: String(message).split("\n")[0] })),
  diagnostics
};
console.log("\nCasual Player Pass summary");
console.log(JSON.stringify(summary, null, 2));
if (failures.length) process.exitCode = 1;

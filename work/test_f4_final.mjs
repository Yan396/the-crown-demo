import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { lieutenantResistance, startBattle } from "../outputs/js/battle.js";
import { buildChronicleEntries } from "../outputs/js/chronicle.js";
import { getRoadEventDefinitions } from "../outputs/js/casual.js";
import { CONFIG, F4_LIEUTENANT_EVENTS, LIEUTENANT_ROSTER } from "../outputs/js/data.js";
import { LIEUTENANT_PORTRAIT_IDS, lieutenantPortrait } from "../outputs/js/portraits.js";
import { hireLieutenant, processDailyEconomy, simulateAutoplay } from "../outputs/js/sim.js";
import { createStorageAdapter } from "../outputs/js/storage.js";
import {
  createInitialState,
  getLieutenants,
  hasLieutenant,
  isValidState,
  loadState,
  saveState
} from "../outputs/js/state.js";

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const fresh = (seed = 44) => {
  const state = createInitialState(seed, {
    skipOnboarding: true,
    v11: true,
    fullVersion: true,
    f2: true,
    f3: true,
    f4: true
  });
  state.player.act = 2;
  state.paused = false;
  state.demo.modal = null;
  state.player.gold = 2000;
  const town = state.towns.find((entry) => entry.id === CONFIG.START_TOWN_ID);
  state.player.pos = { ...town.pos };
  return state;
};

test("three profiles expose one CONFIG passive each and only two party slots", () => {
  assert.deepEqual(LIEUTENANT_ROSTER.map((entry) => entry.id), ["chen_mang", "shen_wen", "jia_duojin"]);
  assert.equal(new Set(LIEUTENANT_ROSTER.map((entry) => entry.passive)).size, 3);
  const state = fresh();
  assert.equal(hireLieutenant(state, "chen_mang").ok, true);
  assert.equal(hireLieutenant(state, "shen_wen").ok, true);
  assert.equal(hireLieutenant(state, "jia_duojin").reason, "occupied");
  assert.equal(getLieutenants(state).length, CONFIG.F4_LIEUTENANT_SLOTS);
  assert.equal(state.player.lieutenant, state.player.lieutenants[0]);
});

test("attack, defense, and income passives affect their existing levers", () => {
  const attackState = fresh(51);
  hireLieutenant(attackState, "chen_mang");
  const enemy = attackState.bandits.find((entry) => !entry.elite) || attackState.bandits[0];
  startBattle(attackState, enemy);
  assert.equal(attackState.battle.playerAttackMultiplier, 1 + CONFIG.F4_CHEN_ATTACK_BONUS);

  const defenseState = fresh(52);
  hireLieutenant(defenseState, "shen_wen");
  assert.equal(lieutenantResistance(defenseState), 1 + CONFIG.F4_SHEN_DEFENSE_BONUS);

  const incomeState = fresh(53);
  hireLieutenant(incomeState, "jia_duojin");
  const fief = incomeState.towns[0];
  incomeState.player.fiefs = [fief.id];
  fief.prosperity = 100;
  incomeState.stats.days = 3;
  const economy = processDailyEconomy(incomeState);
  const base = Math.floor(fief.prosperity * CONFIG.PLAYER_TOWN_TAX_RATE);
  assert.equal(economy.fiefTax, base + Math.floor(base * CONFIG.F4_JIA_INCOME_BONUS));
});

test("each active lieutenant contributes exactly three personal cards", () => {
  assert.equal(F4_LIEUTENANT_EVENTS.length, 9);
  LIEUTENANT_ROSTER.forEach((profile) => {
    assert.equal(F4_LIEUTENANT_EVENTS.filter((event) => event.id.startsWith(`${profile.id}_`)).length, 3);
  });
  const state = fresh();
  hireLieutenant(state, "shen_wen");
  hireLieutenant(state, "jia_duojin");
  const ids = getRoadEventDefinitions(state).map((event) => event.id);
  assert.equal(ids.length, 26);
  assert.equal(ids.some((id) => id.startsWith("chen_mang_")), false);
});

test("three consecutive unpaid days remove both lieutenants and enter the chronicle", () => {
  const state = fresh();
  hireLieutenant(state, "chen_mang");
  hireLieutenant(state, "shen_wen");
  state.player.gold = 0;
  state.stats.days = 3;
  for (let day = 0; day < CONFIG.F4_LIEUTENANT_UNPAID_LEAVE_DAYS; day += 1) {
    processDailyEconomy(state);
  }
  assert.equal(getLieutenants(state).length, 0);
  assert.equal(state.telemetry.lieutenants.unpaidLeaves, 2);
  const lines = buildChronicleEntries(state.telemetry, "zh", { full: true });
  assert.ok(lines.some((entry) => entry.type === "lieutenantLeft"));
});

test("old singular lieutenant saves migrate to the two-slot roster without a version bump", () => {
  const legacy = fresh();
  delete legacy.player.lieutenants;
  legacy.player.lieutenant = { id: "chen_mang", hiredAtTick: 10 };
  legacy.features.f4 = false;
  const storage = { value: null, setItem(_key, value) { this.value = value; }, getItem() { return this.value; } };
  assert.equal(saveState(legacy, storage), true);
  const loaded = loadState(storage, { v11: true, fullVersion: true, f2: true, f3: true, f4: true });
  assert.equal(isValidState(loaded), true);
  assert.equal(hasLieutenant(loaded, "chen_mang"), true);
  assert.equal(loaded.player.lieutenants[0].unpaidDays, 0);
});

test("all three portraits are inline seal-frame SVG with cinnabar hooks", () => {
  assert.deepEqual(LIEUTENANT_PORTRAIT_IDS, LIEUTENANT_ROSTER.map((entry) => entry.id));
  LIEUTENANT_PORTRAIT_IDS.forEach((id) => {
    const svg = lieutenantPortrait(id);
    assert.match(svg, /^<svg/);
    assert.match(svg, /portrait-accent/);
    assert.match(svg, /data-lieutenant=/);
  });
});

test("desktop storage adapter hydrates and serializes the existing synchronous save interface", async () => {
  const values = new Map([[CONFIG.V11_SAVE_KEY, "old-save"]]);
  const calls = [];
  const adapter = await createStorageAdapter({
    keys: [CONFIG.V11_SAVE_KEY],
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (command === "load_state") return values.get(args.key) || null;
      if (command === "save_state") values.set(args.key, args.value);
      if (command === "remove_state") values.delete(args.key);
      return null;
    }
  });
  assert.equal(adapter.getItem(CONFIG.V11_SAVE_KEY), "old-save");
  adapter.setItem(CONFIG.V11_SAVE_KEY, "new-save");
  await adapter.flush();
  assert.equal(values.get(CONFIG.V11_SAVE_KEY), "new-save");
  assert.deepEqual(calls.map((entry) => entry.command), ["load_state", "save_state"]);
});

test("Tauri shell defines local file commands, fullscreen, and macOS/Windows bundle matrix", () => {
  const rust = readFileSync(new URL("../desktop/src-tauri/src/main.rs", import.meta.url), "utf8");
  const config = JSON.parse(readFileSync(new URL("../desktop/src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  const workflow = readFileSync(new URL("../.github/workflows/desktop-build.yml", import.meta.url), "utf8");
  ["load_state", "save_state", "remove_state", "set_fullscreen"].forEach((command) => {
    assert.match(rust, new RegExp(`fn ${command}\\b`));
  });
  assert.equal(config.build.frontendDist, "../../outputs");
  assert.equal(config.app.withGlobalTauri, true);
  assert.match(workflow, /macos-latest/);
  assert.match(workflow, /windows-latest/);
  assert.match(workflow, /--bundles \$\{\{ matrix\.bundle \}\}/);
});

test("store kit contains exact positioning, six shot briefs, capsule, and 30-second cut list", () => {
  const copy = readFileSync(new URL("../store/STORE_COPY.md", import.meta.url), "utf8");
  const shots = readFileSync(new URL("../store/SCREENSHOTS.md", import.meta.url), "utf8");
  const capsule = readFileSync(new URL("../store/CAPSULE_BRIEF.md", import.meta.url), "utf8");
  const trailer = readFileSync(new URL("../store/TRAILER_30S.md", import.meta.url), "utf8");
  assert.match(copy, /一个会问你“多少才够”的骑砍式沙盘/);
  assert.match(copy, /A sandbox strategy game that keeps asking how much is enough\./);
  assert.equal((shots.match(/`0[1-6]-[^`]+\.jpg`/g) || []).length, 6);
  assert.match(capsule, /帥/);
  assert.match(trailer, /00:28–00:30/);
  assert.match(trailer, /no motion graphics/i);
  const screenshotDirectory = new URL("../store/screenshots/", import.meta.url);
  const screenshotFiles = readdirSync(screenshotDirectory).filter((name) => /\.jpg$/.test(name)).sort();
  assert.deepEqual(screenshotFiles, [
    "01-formation-pick.jpg",
    "02-melee-peak.jpg",
    "03-fief-siege.jpg",
    "04-mirror-hud.jpg",
    "05-ending-mirror.jpg",
    "06-map-at-war.jpg"
  ]);
  screenshotFiles.forEach((name) => {
    const bytes = readFileSync(new URL(name, screenshotDirectory));
    assert.ok(bytes.length > 10_000, `${name} must be a real gameplay capture`);
    assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff]);
  });
});

test("paid desktop UI suppresses result-code telemetry while web demo path remains intact", () => {
  const uiSource = readFileSync(new URL("../outputs/js/ui.js", import.meta.url), "utf8");
  const mainSource = readFileSync(new URL("../outputs/js/main.js", import.meta.url), "utf8");
  assert.match(uiSource, /refs\.shareResult\.hidden = desktopRuntime/);
  assert.match(uiSource, /desktopRuntime \? "" : buildResultCode\(state\)/);
  assert.match(mainSource, /if \(desktopRuntime\) return;/);
  assert.match(mainSource, /sharePlaytestResult\(state/);
});

test("Pages release publishes full at root and the free demo at /demo/", () => {
  const workflow = readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
  const builder = readFileSync(new URL("./build_pages.mjs", import.meta.url), "utf8");
  assert.match(workflow, /node work\/build_pages\.mjs/);
  assert.match(workflow, /path: \.pages-dist/);
  assert.match(builder, /selectVariant\("full"\)/);
  assert.match(builder, /selectVariant\("demo"\)/);
  assert.match(builder, /path\.join\(destination, "demo"\)/);
});

test("F4 autoplay hires the roster and completes the inherited 2.5–4 hour arc", () => {
  const result = simulateAutoplay(CONFIG.SEED, {
    fullVersion: true,
    phase2: true,
    phase3: true,
    phase4: true,
    endingChoice: "stop",
    maxActiveSeconds: CONFIG.AUTOPLAY_F2_HARD_LIMIT_SECONDS
  });
  assert.equal(result.state.demo.ended, true);
  assert.equal(result.endingPath, "stop");
  assert.ok(result.edictSeconds >= CONFIG.AUTOPLAY_F2_MIN_ACTIVE_SECONDS);
  assert.ok(result.edictSeconds <= CONFIG.AUTOPLAY_F2_MAX_ACTIVE_SECONDS);
  assert.equal(result.battleScriptsChecked, result.state.stats.battles);
  assert.ok(result.state.telemetry.lieutenants.hireCount >= CONFIG.F4_LIEUTENANT_SLOTS);
});

let failed = 0;
for (const entry of tests) {
  try {
    await entry.fn();
    console.log(`PASS ${entry.name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${entry.name}`);
    console.error(error?.stack || error);
  }
}
console.log(`\nF4 final: ${tests.length - failed}/${tests.length} green`);
process.exit(failed ? 1 : 0);

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { CrownAudio } from "../outputs/js/audio.js";
import { advanceOnboarding, recordRetreatDecision, resetRetreatDecision } from "../outputs/js/demo.js";
import { createInitialState, loadState, saveState } from "../outputs/js/state.js";
import { recordHelpCardOpen } from "../outputs/js/telemetry.js";

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
}

class FakeParam {
  constructor() { this.value = 0; }
  setValueAtTime(value) { this.value = value; }
  linearRampToValueAtTime(value) { this.value = value; }
  exponentialRampToValueAtTime(value) { this.value = value; }
}

class FakeNode {
  constructor() {
    this.connected = false;
    this.disconnected = false;
    this.started = false;
    this.stopped = false;
    this.gain = new FakeParam();
    this.frequency = new FakeParam();
  }
  connect() { this.connected = true; return this; }
  disconnect() { this.disconnected = true; }
  start() { this.started = true; }
  stop() { this.stopped = true; }
}

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 1;
    this.sampleRate = 1000;
    this.destination = new FakeNode();
    this.sources = [];
  }
  createGain() { return new FakeNode(); }
  createOscillator() { const node = new FakeNode(); this.sources.push(node); return node; }
  createBufferSource() { const node = new FakeNode(); this.sources.push(node); return node; }
  createBiquadFilter() { return new FakeNode(); }
  createBuffer(_channels, frames) {
    const values = new Float32Array(frames);
    return { getChannelData: () => values };
  }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  resume() { this.state = "running"; return Promise.resolve(); }
}

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory()
      ? listFiles(new URL(`${entry.name}/`, directory))
      : [new URL(entry.name, directory)]
  ));
}

test("rules are available before Start and from a persistent HUD chip", () => {
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../outputs/css/ui.css", import.meta.url), "utf8");
  const strings = readFileSync(new URL("../outputs/js/strings.js", import.meta.url), "utf8");
  for (const id of ["help-button", "title-start", "title-rules", "help-card"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /id="title-start"[\s\S]{0,180}id="title-rules"/);
  for (const line of ["目标", "怎么打", "钱怎么来怎么没", "声望是什么"]) {
    assert.match(strings, new RegExp(line));
  }
  assert.match(css, /\.help-card\s*\{[\s\S]*?overflow:\s*hidden/);
});

test("title requires Start, then every one of the three tips requires a tap", () => {
  const state = createInitialState(1001);
  assert.equal(state.demo.onboardingStep, -1);
  assert.equal(state.demo.modal, "onboarding");
  assert.equal(advanceOnboarding(state).step, 0);
  assert.equal(advanceOnboarding(state).step, 1);
  assert.equal(advanceOnboarding(state).step, 2);
  assert.equal(advanceOnboarding(state).promise, "troops");
  assert.equal(state.demo.modal, "troopPromise");
  assert.doesNotMatch(advanceOnboarding.toString(), /setTimeout|setInterval/);
});

test("help-card telemetry records every open and its source", () => {
  const state = createInitialState(1002, { skipOnboarding: true, startedAt: new Date(0).toISOString() });
  recordHelpCardOpen(state, "title");
  recordHelpCardOpen(state, "hud");
  assert.deepEqual(state.telemetry.helpCardOpens.map((entry) => entry.source), ["title", "hud"]);
  assert.equal(recordHelpCardOpen(state, "unknown"), null);
});

test("two consecutive retreats repeat the verdict reference; attacking resets the streak", () => {
  const state = createInitialState(1003, { skipOnboarding: true });
  assert.equal(recordRetreatDecision(state).showVerdictReminder, false);
  assert.equal(recordRetreatDecision(state).showVerdictReminder, true);
  assert.equal(state.telemetry.tooltipViews.verdict, 1);
  recordRetreatDecision(state);
  assert.equal(resetRetreatDecision(state), true);
  assert.equal(state.demo.retreatStreak, 0);
  assert.equal(recordRetreatDecision(state).showVerdictReminder, false);
});

test("sound defaults on and persists in the existing settings record", () => {
  const storage = new MemoryStorage();
  const state = createInitialState(1004, { skipOnboarding: true });
  assert.equal(state.settings.soundEnabled, true);
  state.settings.soundEnabled = false;
  assert.equal(saveState(state, storage), true);
  const loaded = loadState(storage);
  assert.equal(loaded.settings.soundEnabled, false);
});

test("Web Audio is lazy, synthesized, and battle voices are disposable", () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  try {
    const audio = new CrownAudio();
    audio.setEnabled(true);
    assert.equal(audio.context, null, "preference setup must not create AudioContext");
    audio.unlock();
    assert.ok(audio.context instanceof FakeAudioContext);
    audio.charge();
    audio.hit({ kill: true, dmgShown: 12, beat: 1 });
    audio.rout();
    assert.ok(audio.battleVoices.size >= 3);
    const sources = audio.context.sources.slice();
    audio.disposeBattle();
    assert.equal(audio.battleVoices.size, 0);
    assert.ok(sources.some((source) => source.stopped && source.disconnected));
  } finally {
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
});

test("battle audio follows the existing event callbacks and ships no audio assets", () => {
  const stage = readFileSync(new URL("../outputs/js/battle-stage.js", import.meta.url), "utf8");
  const audio = readFileSync(new URL("../outputs/js/audio.js", import.meta.url), "utf8");
  // Every battle cue now goes through the single presentation beat hook, so a
  // visual beat and the sound on it can never drift onto different clocks --
  // and the host `audio` adapter can no longer double-fire alongside it, which
  // it did when performStrike called both audio?.hit?.() and crownAudio.hit().
  assert.match(stage, /function emitBeat\(payload\)/, "the one clock must exist");
  const strike = stage.slice(stage.indexOf("function performStrike"), stage.indexOf("function reel"));
  assert.match(strike, /emitBeat\(\{\s*\n?\s*type: "strike"/);
  assert.match(stage, /performRout\(event\)[\s\S]{0,100}emitBeat\(\{ type: "rout"/);
  assert.match(stage, /setPhase\("charge"\)[\s\S]{0,100}emitBeat\(\{ type: "charge" \}\)/);
  assert.match(stage, /dispose\(\)[\s\S]*?audio\?\.disposeBattle\?\.\(\)/);
  // The adapter is still called, but only for cues the hook does not already
  // own. That exclusion list is what makes double-firing impossible.
  assert.match(stage, /!\["strike", "arrow", "charge", "rout"\]\.includes\(beat\.type\)/);
  assert.doesNotMatch(audio, /Math\.random|fetch\s*\(|new\s+Audio\b/);
  const assets = listFiles(new URL("../outputs/", import.meta.url))
    .map((url) => url.pathname)
    .filter((name) => /\.(?:mp3|wav|ogg|m4a|aac)$/i.test(name));
  assert.deepEqual(assets, []);
});

/*
 * Adaptive music gate.
 *
 * Everything here runs against a FakeAudioContext, so it asserts the SCHEDULE
 * -- what is written into the audio clock and when -- rather than a waveform.
 * The permanent contracts: five scenes, equal-power crossfades, mute and
 * visibility both stop scheduling, heavy cues duck, dispose leaks neither an
 * oscillator nor a timer, and the whole thing still ships zero assets, opens
 * zero connections and draws zero unseeded randomness.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, statSync } from "node:fs";

import { CONFIG_MUSIC, CrownAudio, MUSIC_SCENES } from "../outputs/js/audio.js";

const audioSource = readFileSync(new URL("../outputs/js/audio.js", import.meta.url), "utf8");
const styleguideSource = readFileSync(new URL("../outputs/js/audio-styleguide.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../outputs/js/main.js", import.meta.url), "utf8");

/* ---- fake graph --------------------------------------------------------- */

class FakeParam {
  constructor(value = 0) {
    this.value = value;
    this.events = [];
  }
  setValueAtTime(value, time) { this.events.push({ kind: "set", value, time }); this.value = value; return this; }
  linearRampToValueAtTime(value, time) { this.events.push({ kind: "linear", value, time }); this.value = value; return this; }
  exponentialRampToValueAtTime(value, time) { this.events.push({ kind: "exp", value, time }); this.value = value; return this; }
  cancelScheduledValues(time) { this.events.push({ kind: "cancel", time }); return this; }
}

class FakeNode {
  constructor(kind, context) {
    this.kind = kind;
    this.context = context;
    this.connections = [];
    this.disconnected = false;
    this.started = false;
    this.stopped = false;
    this.startedAt = null;
    this.stoppedAt = null;
    this.gain = new FakeParam(1);
    this.frequency = new FakeParam(440);
    this.threshold = new FakeParam(0);
    this.knee = new FakeParam(0);
    this.ratio = new FakeParam(1);
    this.attack = new FakeParam(0);
    this.release = new FakeParam(0);
  }
  connect(target) { this.connections.push(target); return target; }
  disconnect() { this.disconnected = true; this.connections = []; }
  start(at) { this.started = true; this.startedAt = at ?? this.context.currentTime; }
  stop(at) { this.stopped = true; this.stoppedAt = at ?? this.context.currentTime; }
}

class FakeAudioContext {
  constructor() {
    this.state = "running";
    this.currentTime = 1;
    this.sampleRate = 8000;
    this.destination = new FakeNode("destination", this);
    this.nodes = [];
    this.sources = [];
    this.buffers = 0;
  }
  make(kind) { const node = new FakeNode(kind, this); this.nodes.push(node); return node; }
  createGain() { return this.make("gain"); }
  createBiquadFilter() { return this.make("filter"); }
  createDynamicsCompressor() { return this.make("compressor"); }
  createOscillator() { const node = this.make("oscillator"); this.sources.push(node); return node; }
  createBufferSource() { const node = this.make("bufferSource"); this.sources.push(node); return node; }
  createBuffer(_channels, frames) {
    this.buffers += 1;
    const values = new Float32Array(frames);
    return { getChannelData: () => values };
  }
  suspend() { this.state = "suspended"; return Promise.resolve(); }
  resume() { this.state = "running"; return Promise.resolve(); }
  advance(seconds) { this.currentTime += seconds; }
}

function withAudio(run) {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  const audio = new CrownAudio();
  try {
    audio.unlock();
    return run(audio, audio.context);
  } finally {
    audio.dispose();
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
}

// Notes written into the clock for a scene, ignoring the ones already there.
function scheduledSince(audio, mark) {
  return audio.musicTrace.slice(mark);
}

/* ---- the five scenes ---------------------------------------------------- */

test("there are exactly five music scenes and every one of them schedules", () => {
  assert.deepEqual(MUSIC_SCENES, ["title", "map-road", "town", "battle", "ending"]);
  withAudio((audio, context) => {
    for (const scene of MUSIC_SCENES) {
      const mark = audio.musicTrace.length;
      audio.setMusicScene(scene);
      assert.equal(audio.getMusicScene(), scene);
      const written = scheduledSince(audio, mark).filter((entry) => entry.scene === scene);
      assert.ok(written.length > 0, `${scene} scheduled nothing`);
      assert.ok(
        written.every((entry) => entry.at >= context.currentTime),
        `${scene} scheduled a note in the past`
      );
      // Advance past the crossfade so the next scene starts from one live bed.
      context.advance(4);
      audio.pumpMusic();
    }
  });
});

test("each scene has its own tempo/mode/root -- they are not one loop retuned", () => {
  const signatures = MUSIC_SCENES.map((id) => {
    const scene = CONFIG_MUSIC.SCENES[id];
    return `${scene.root}/${scene.scale}/${scene.bpm}/${scene.beats}`;
  });
  assert.equal(new Set(signatures).size, MUSIC_SCENES.length);
  for (const id of MUSIC_SCENES) {
    const { fadeIn, fadeOut } = CONFIG_MUSIC.SCENES[id];
    assert.ok(fadeIn >= 1.5 && fadeIn <= 3, `${id} fade-in out of the 1.5-3s band`);
    assert.ok(fadeOut >= 1.5 && fadeOut <= 3, `${id} fade-out out of the 1.5-3s band`);
  }
});

test("the score breathes: phrases carry rests, not a note on every beat", () => {
  withAudio((audio) => {
    audio.setMusicScene("map-road");
    const instance = audio.musicActive[0];
    let silent = 0;
    for (let phrase = 0; phrase < 20; phrase += 1) {
      const mark = audio.musicTrace.length;
      audio.schedulePhrase(instance);
      // A phrase carrying only its bed (and the optional fifth) is a rest.
      const plucked = scheduledSince(audio, mark).filter((entry) => entry.kind === "tone").length;
      if (plucked === 0) silent += 1;
    }
    assert.ok(silent >= 3, `only ${silent}/20 road phrases left space`);
    assert.ok(silent <= 14, "the road cannot be silent nearly all the time");
  });
});

test("music is deterministic and never touches the gameplay RNG", () => {
  const play = () => withAudio((audio) => {
    audio.setMusicScene("map-road");
    const instance = audio.musicActive[0];
    for (let phrase = 0; phrase < 12; phrase += 1) audio.schedulePhrase(instance);
    return audio.musicTrace.map((entry) => `${entry.kind}:${entry.frequency.toFixed(3)}`).join("|");
  });
  assert.equal(play(), play(), "the same scene must schedule the same notes");
  // Its own stream, in its own file: audio.js imports nothing, so it cannot
  // reach state.rng, the road stream or the art stream even by accident.
  assert.doesNotMatch(audioSource, /^\s*import\s/m, "audio.js must stay dependency-free");
  assert.doesNotMatch(audioSource, /nextFloat|nextUint32|createRng/);
  assert.match(audioSource, /function musicRandom\(seed\)/);
});

/* ---- crossfade ---------------------------------------------------------- */

test("a scene change crossfades with equal power and never cuts the outgoing scene", () => {
  withAudio((audio, context) => {
    audio.setMusicScene("map-road");
    const outgoing = audio.musicActive[0];
    context.advance(2);
    audio.pumpMusic();
    audio.setMusicScene("battle");

    assert.equal(audio.musicActive.length, 2, "both scenes must overlap");
    const incoming = audio.musicActive.find((entry) => entry.sceneId === "battle");
    assert.ok(outgoing.stopping, "the outgoing scene must be fading");
    assert.equal(incoming.stopping, false);

    // The change lands on the outgoing scene's beat grid: no dropped bar.
    const beat = 60 / outgoing.scene.bpm;
    const offset = (incoming.startedAt - outgoing.startedAt) / beat;
    assert.ok(Math.abs(offset - Math.round(offset)) < 1e-6, "transition did not land on a beat");
    assert.equal(incoming.phraseIndex > 0, true, "the incoming scene must start scheduling");

    const rising = incoming.input.gain.events.filter((event) => event.kind === "linear");
    // The outgoing bus carries its own fade-IN too; its fade-out is the tail.
    const allFalling = outgoing.input.gain.events.filter((event) => event.kind === "linear");
    const falling = allFalling.slice(-CONFIG_MUSIC.FADE_STEPS);
    assert.equal(rising.length, CONFIG_MUSIC.FADE_STEPS);
    assert.equal(allFalling.length, CONFIG_MUSIC.FADE_STEPS * 2);
    assert.equal(rising.at(-1).value, 1);
    assert.equal(falling.at(-1).value, 0);

    // Equal power: at every step the two curves' powers sum to ~1, which is
    // exactly what a linear crossfade fails to do (it dips in the middle).
    for (let step = 0; step < CONFIG_MUSIC.FADE_STEPS; step += 1) {
      const power = rising[step].value ** 2 + falling[step].value ** 2;
      assert.ok(Math.abs(power - 1) < 1e-9, `power dipped to ${power} at step ${step}`);
    }
    // No zero-jump on either side: the fade starts from where the gain was.
    assert.equal(incoming.input.gain.events[0].kind, "cancel");
    assert.ok(falling.every((event) => event.value <= 1 && event.value >= 0));

    // The outgoing scene keeps writing notes through its own fade.
    const mark = audio.musicTrace.length;
    audio.pumpMusic();
    assert.ok(
      scheduledSince(audio, mark).some((entry) => entry.scene === "map-road") ||
      outgoing.nextPhraseAt >= outgoing.endsAt,
      "the outgoing scene was cut mid-phrase"
    );

    // ...and it is reaped once the fade is over. Nothing accumulates.
    context.advance(CONFIG_MUSIC.SCENES["map-road"].fadeOut + 0.2);
    audio.pumpMusic();
    assert.equal(audio.musicActive.length, 1);
    assert.equal(audio.musicActive[0].sceneId, "battle");
    assert.ok(outgoing.input.disconnected);
  });
});

test("asking for the scene already playing is a no-op, not a restart", () => {
  withAudio((audio) => {
    audio.setMusicScene("town");
    const instance = audio.musicActive[0];
    audio.setMusicScene("town");
    assert.equal(audio.musicActive.length, 1);
    assert.equal(audio.musicActive[0], instance);
  });
});

test("stepping in and out of a town does not stack two copies of the road", () => {
  withAudio((audio, context) => {
    audio.setMusicScene("map-road");
    const road = audio.musicActive[0];
    context.advance(3);
    audio.pumpMusic();
    audio.setMusicScene("town");
    context.advance(0.4);
    audio.setMusicScene("map-road");   // straight back out again

    const roads = audio.musicActive.filter((instance) => instance.sceneId === "map-road");
    assert.equal(roads.length, 1, "the road was started a second time");
    assert.equal(roads[0], road, "the fading road should have been brought back, not replaced");
    assert.equal(road.stopping, false);
    assert.equal(road.endsAt, Infinity);
    const rising = road.input.gain.events.filter((event) => event.kind === "linear").slice(-CONFIG_MUSIC.FADE_STEPS);
    assert.equal(rising.at(-1).value, 1, "the revived scene must return to full");
  });
});

test("scene changes crossfade, they do not pile up", () => {
  withAudio((audio, context) => {
    for (const scene of ["title", "map-road", "town", "battle", "ending", "town", "battle"]) {
      audio.setMusicScene(scene);
      context.advance(0.2);
      audio.pumpMusic();
      assert.ok(
        audio.musicActive.length <= CONFIG_MUSIC.MAX_ACTIVE_INSTANCES,
        `${audio.musicActive.length} scenes overlapping at ${scene}`
      );
    }
    assert.equal(audio.musicActive.filter((instance) => !instance.stopping).length, 1);
  });
});

/* ---- mute, visibility --------------------------------------------------- */

test("mute fades out, stops scheduling, and resumes on a phrase boundary", () => {
  withAudio((audio, context) => {
    audio.setMusicScene("map-road");
    const instance = audio.musicActive[0];
    audio.setEnabled(false);
    assert.equal(instance.stopping, true, "mute must fade, not cut");
    const falling = instance.input.gain.events.filter((event) => event.kind === "linear");
    assert.equal(falling.at(-1).value, 0);

    const mark = audio.musicTrace.length;
    context.advance(5);
    audio.pumpMusic();
    assert.equal(scheduledSince(audio, mark).length, 0, "a muted score must schedule nothing");

    audio.disposeMusic({ keepScene: true });
    assert.equal(audio.getMusicScene(), "map-road", "the scene is remembered while muted");

    audio.setEnabled(true);
    const resumed = audio.musicActive[0];
    assert.ok(resumed, "unmuting must bring the scene back");
    assert.equal(resumed.phraseIndex > 0, true);
    assert.equal(resumed.startedAt >= context.currentTime, true, "resume must not replay the past");
    assert.ok(resumed.startedAt <= context.currentTime + 0.5, "resume enters at the next phrase, not later");
  });
});

test("hiding the page pauses the score; coming back does not catch up", () => {
  withAudio((audio, context) => {
    audio.setMusicScene("battle");
    const before = audio.musicActive[0];
    audio.setPageHidden(true);
    assert.equal(before.stopping, true);
    const mark = audio.musicTrace.length;
    context.advance(30);
    audio.pumpMusic();
    assert.equal(scheduledSince(audio, mark).length, 0, "a hidden page must schedule nothing");

    audio.disposeMusic({ keepScene: true });
    audio.setPageHidden(false);
    const after = audio.musicActive[0];
    assert.ok(after, "returning must restart the scene");
    assert.equal(after.phraseIndex <= CONFIG_MUSIC.MAX_PHRASES_PER_PUMP, true, "no backlog was flushed");
    assert.ok(
      after.nextPhraseAt > context.currentTime,
      "the 30 hidden seconds must not be replayed"
    );
  });
});

/* ---- ducking ------------------------------------------------------------ */

test("heavy cues duck the music and let it back up; the SFX bus is untouched", () => {
  withAudio((audio, context) => {
    audio.setMusicScene("battle");
    const duck = audio.musicDuck.gain;

    audio.hit({ kill: true, dmgShown: 18 });
    let ramps = duck.events.filter((event) => event.kind === "linear");
    const floor = ramps.at(-2).value;
    assert.ok(floor < 1 && floor > 0.05, `duck floor ${floor} is not a duck`);
    assert.equal(ramps.at(-1).value, 1, "the music must come back up");
    assert.ok(
      ramps.at(-1).time > ramps.at(-2).time,
      "release must be later than attack"
    );
    assert.equal(audio.musicDuckFloor, floor);

    const heavy = floor;
    context.advance(1);
    audio.hit({ kill: false, dmgShown: 3 });
    ramps = duck.events.filter((event) => event.kind === "linear");
    assert.ok(ramps.at(-2).value > heavy, "an ordinary strike must duck less than a kill");

    for (const cue of ["charge", "cavalry", "seal", "rout"]) {
      context.advance(1);
      const mark = duck.events.length;
      audio[cue]();
      assert.ok(duck.events.length > mark, `${cue} did not duck the music`);
    }
    assert.equal(audio.sfxBus.gain.events.length, 0, "ducking must never touch the SFX bus");
  });
});

test("the mix puts music well under the SFX and ends in a limiter", () => {
  assert.ok(
    CONFIG_MUSIC.MUSIC_BUS_GAIN <= CONFIG_MUSIC.SFX_BUS_GAIN * 0.25,
    "music must be obviously quieter than the cues it sits under"
  );
  withAudio((audio, context) => {
    assert.equal(audio.musicBus.connections[0], audio.musicDuck);
    assert.equal(audio.musicDuck.connections[0], audio.master);
    assert.equal(audio.sfxBus.connections[0], audio.master);
    assert.equal(audio.master.connections[0], audio.limiter);
    assert.equal(audio.limiter.connections[0], context.destination);
    assert.equal(audio.limiter.threshold.value, CONFIG_MUSIC.LIMITER.threshold);
    assert.equal(audio.musicBus.gain.value, CONFIG_MUSIC.MUSIC_BUS_GAIN);
    // Every music voice lands on the music bus, never straight on the master.
    audio.setMusicScene("town");
    const bus = audio.musicActive[0].input;
    assert.equal(bus.connections[0], audio.musicBus);
  });
});

/* ---- lifecycle ---------------------------------------------------------- */

test("nothing is created before the first gesture", () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  try {
    const audio = new CrownAudio();
    audio.setMusicScene("title");
    assert.equal(audio.context, null, "a scene request must not open an AudioContext");
    assert.equal(audio.musicActive.length, 0);
    assert.equal(audio.musicTimer, null);
    // ...and the gesture picks the pending scene up.
    audio.unlock();
    assert.equal(audio.musicActive[0]?.sceneId, "title");
    audio.dispose();
  } finally {
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
});

test("dispose leaks no oscillator and no timer, and a battle can reopen after it", () => {
  const previous = globalThis.AudioContext;
  globalThis.AudioContext = FakeAudioContext;
  try {
    const audio = new CrownAudio();
    audio.unlock();
    audio.setMusicScene("battle");
    audio.charge();
    audio.hit({ kill: true, dmgShown: 9 });
    assert.ok(audio.musicVoices.size > 0);
    assert.ok(audio.battleVoices.size > 0);
    assert.ok(audio.musicTimer !== null, "the scheduler timer must be running");
    const sources = audio.context.sources.slice();

    audio.dispose();
    assert.equal(audio.musicVoices.size, 0);
    assert.equal(audio.battleVoices.size, 0);
    assert.equal(audio.musicActive.length, 0);
    assert.equal(audio.musicTimer, null);
    assert.equal(audio.musicStopTimer, null);
    assert.equal(audio.muteTimer, null);
    assert.ok(sources.every((source) => source.stopped), "a source survived dispose");

    // Reopening is clean: the second battle must not inherit the first's nodes.
    audio.setMusicScene("battle");
    assert.equal(audio.musicActive.length, 1);
    assert.ok(audio.musicVoices.size > 0);
    audio.dispose();
    assert.equal(audio.musicVoices.size, 0);
  } finally {
    if (previous === undefined) delete globalThis.AudioContext;
    else globalThis.AudioContext = previous;
  }
});

test("disposing the battle stage does not stop the music", () => {
  withAudio((audio) => {
    audio.setMusicScene("battle");
    audio.rout();
    const playing = audio.musicVoices.size;
    audio.disposeBattle();
    assert.equal(audio.battleVoices.size, 0);
    assert.equal(audio.musicVoices.size, playing, "battle teardown must not touch music voices");
    assert.equal(audio.musicActive.length, 1);
  });
});

/* ---- wiring, and the standing zero-asset contract ------------------------ */

test("the game drives the scene from its existing lifecycle -- and stays silent in autoplay", () => {
  assert.match(mainSource, /function musicSceneFor\(\)/);
  for (const scene of MUSIC_SCENES) {
    assert.match(mainSource, new RegExp(`"${scene}"`), `main.js never selects ${scene}`);
  }
  assert.match(
    mainSource,
    /if \(!autoplayEnabled && !audioStyleguideEnabled\) crownAudio\.setMusicScene\(musicSceneFor\(\)\);/,
    "autoplay and the styleguide must both bypass the game's scene selection"
  );
  assert.match(mainSource, /crownAudio\.setPageHidden\(document\.visibilityState === "hidden"\)/);
  // Silent bot: not even the victory seal may open a context in a 20x run.
  assert.match(
    mainSource,
    /crownAudio\.setEnabled\(state\.settings\.soundEnabled && !autoplayEnabled\);/
  );
  // One switch, no new player setting.
  assert.equal(/crownAudio\.setEnabled\(/.test(mainSource), true);
  assert.doesNotMatch(mainSource, /musicEnabled|musicVolume|settings\.music/);
  assert.doesNotMatch(audioSource, /settings\.music|musicVolume/);
});

test("the styleguide is developer-only and costs a normal URL nothing", () => {
  assert.match(mainSource, /const audioStyleguideEnabled = query\.get\("audioStyleguide"\) === "1";/);
  assert.match(mainSource, /if \(audioStyleguideEnabled\) \{\s*\n\s*const \{ mountAudioStyleguide \} = await import\("\.\/audio-styleguide\.js"\);/);
  const html = readFileSync(new URL("../outputs/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /audioStyleguide|audio-styleguide/, "the styleguide must have no UI entry point");
  assert.doesNotMatch(styleguideSource, /Math\.random|fetch\s*\(|XMLHttpRequest|WebSocket/);
  for (const scene of MUSIC_SCENES) assert.match(styleguideSource, new RegExp(`"${scene}"`));
});

test("music ships no files, opens no connections and draws no unseeded randomness", () => {
  assert.doesNotMatch(audioSource, /Math\.random|fetch\s*\(|XMLHttpRequest|WebSocket|new\s+Audio\b/);
  assert.doesNotMatch(audioSource, /\.(?:mp3|wav|ogg|m4a|aac|flac)\b/);
  assert.doesNotMatch(audioSource, /SAVE_KEY|SAVE_VERSION|localStorage/, "audio must not reach the save");
  assert.doesNotMatch(audioSource, /from "\.\/data\.js"/, "timbre must never come from gameplay CONFIG");
  assert.match(audioSource, /createOscillator|createBuffer/);

  const root = new URL("../outputs/", import.meta.url);
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) walk(new URL(`${entry.name}/`, directory));
      else files.push(new URL(entry.name, directory));
    }
  };
  walk(root);
  assert.deepEqual(
    files.map((url) => url.pathname).filter((name) => /\.(?:mp3|wav|ogg|m4a|aac|flac|mid|midi)$/i.test(name)),
    []
  );
  const bytes = files.reduce((sum, url) => sum + statSync(url).size, 0);
  assert.ok(bytes <= 2 * 1024 * 1024, `outputs grew to ${(bytes / 1024 / 1024).toFixed(2)}MB`);
});

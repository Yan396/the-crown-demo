/*
 * Developer-only audio styleguide, reachable ONLY via ?audioStyleguide=1.
 *
 * There is deliberately no entry point in the game UI and main.js only imports
 * this module when that flag is present, so a normal URL never downloads it,
 * never mounts it and never has its music scene taken over.
 *
 * It drives the shipped CrownAudio -- it does not reimplement any of it.
 */
const SCENE_LABELS = [
  ["title", "题名 title"],
  ["map-road", "行路 map-road"],
  ["town", "城中 town"],
  ["battle", "接战 battle"],
  ["ending", "收束 ending"]
];

/*
 * The continuous tour: 98 seconds, long enough to actually hear the theme
 * declaimed on the title, walked as a variant on the road, and recovered at
 * the ending -- plus every transition worth hearing back to back.
 */
const TOUR = [
  ["title", 20],
  ["map-road", 22],
  ["town", 14],
  ["battle", 14],
  ["map-road", 8],
  ["ending", 20]
];
const TOUR_SECONDS = TOUR.reduce((sum, [, seconds]) => sum + seconds, 0);

// 古琴/琵琶, 箫/持续音, 战鼓/梆子 -- soloed one at a time.
const SECTIONS = [
  ["guqin", "古琴 guqin"],
  ["xiao", "箫 xiao"],
  ["drum", "鼓 drum"]
];

const CUES = [
  ["tap", () => ["tap"]],
  ["strike", () => ["hit", { kill: false, dmgShown: 6 }]],
  ["kill", () => ["hit", { kill: true, dmgShown: 18 }]],
  ["arrow", () => ["arrow"]],
  ["cavalry", () => ["cavalry"]],
  ["charge", () => ["charge"]],
  ["seal", () => ["seal"]],
  ["rout", () => ["rout"]]
];

export function mountAudioStyleguide(host, audio) {
  const panel = document.createElement("div");
  panel.id = "audio-styleguide";
  panel.setAttribute("role", "group");
  panel.setAttribute("aria-label", "audio styleguide");
  panel.style.cssText = [
    "position:fixed", "right:10px", "bottom:10px", "z-index:9999",
    "max-width:min(320px,92vw)", "padding:10px 12px",
    "background:rgba(244,240,230,0.96)", "border:1px solid rgba(28,26,24,0.5)",
    "border-radius:4px", "font:12px/1.5 ui-monospace,monospace", "color:#1c1a18",
    "box-shadow:0 6px 18px rgba(28,26,24,0.22)"
  ].join(";");

  const readout = document.createElement("div");
  readout.style.cssText = "margin-bottom:8px;white-space:pre-line";

  const row = (label) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px";
    const tag = document.createElement("b");
    tag.textContent = label;
    tag.style.cssText = "flex:0 0 100%;font-weight:600;opacity:0.65";
    wrap.append(tag);
    return wrap;
  };

  const button = (label, onClick) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.style.cssText = [
      "font:inherit", "padding:3px 7px", "cursor:pointer",
      "background:#f8f5ee", "border:1px solid rgba(28,26,24,0.45)", "border-radius:3px"
    ].join(";");
    element.addEventListener("click", () => {
      audio.unlock();
      onClick();
      refresh();
    });
    return element;
  };

  let tourTimer = null;
  function stopTour() {
    if (tourTimer !== null) clearTimeout(tourTimer);
    tourTimer = null;
  }

  function runTour(step = 0) {
    stopTour();
    if (step >= TOUR.length) {
      refresh();
      return;
    }
    const [scene, seconds] = TOUR[step];
    audio.setMusicScene(scene);
    refresh();
    tourTimer = setTimeout(() => runTour(step + 1), seconds * 1000);
  }

  const scenes = row("scenes");
  SCENE_LABELS.forEach(([id, label]) => scenes.append(button(label, () => audio.setMusicScene(id))));

  const transport = row(`transport (tour ${TOUR_SECONDS}s)`);
  transport.append(
    button("转场巡览 tour", () => runTour(0)),
    button("停 stop", () => { stopTour(); audio.setMusicScene(null); }),
    button("静音 mute", () => { stopTour(); audio.setEnabled(!audio.isEnabled()); }),
    button("隐藏 hidden", () => audio.setPageHidden(!audio.musicHidden))
  );

  // Section soloing: the only place the section mix is ever written.
  const parts = row("声部 solo");
  SECTIONS.forEach(([id, label]) => parts.append(button(label, () => audio.soloSection(id))));
  parts.append(button("合奏 all", () => audio.soloSection(null)));

  const cues = row("sfx over music (ducking)");
  CUES.forEach(([label, make]) => cues.append(button(label, () => {
    const [method, argument] = make();
    audio[method](argument);
  })));

  panel.append(readout, scenes, transport, parts, cues);
  host.append(panel);

  function refresh() {
    const trace = audio.musicTrace.slice(-3).map((entry) => (
      `${entry.kind} ${Math.round(entry.frequency)}Hz`
    )).join(" · ");
    readout.textContent = [
      `scene: ${audio.getMusicScene() || "—"}${tourTimer !== null ? " (tour)" : ""}`,
      `sound: ${audio.isEnabled() ? "on" : "muted"}  hidden: ${audio.musicHidden ? "yes" : "no"}`,
      `voices: ${audio.musicVoices.size} music / ${audio.battleVoices.size} battle`,
      `声部: ${SECTIONS.map(([id]) => `${id} ${audio.sectionGains[id]}`).join("  ")}`,
      trace ? `last: ${trace}` : "last: —"
    ].join("\n");
  }

  const poll = setInterval(refresh, 500);
  refresh();

  return {
    element: panel,
    dispose() {
      stopTour();
      clearInterval(poll);
      panel.remove();
    }
  };
}

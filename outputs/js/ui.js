import { stampSeal } from "./seal.js";
import { CONFIG, ROAD_EVENTS } from "./data.js";
import { buildChronicleEntries } from "./chronicle.js";
import { actTroopCap, getDailyWage } from "./demo.js";
import {
  activeTown,
  getFaction,
  getLord,
  getPartyStrength,
  getTown,
  getTroopCount
} from "./state.js";
import { buildResultCode } from "./telemetry.js";
import { lordName, translate } from "./strings.js";

const reducedMotion = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };
const numberBudgetDiagnostics = new URLSearchParams(window.location.search).get("qa") === "1";

function motionOff() {
  return reducedMotion.matches;
}

function element(id) {
  return document.getElementById(id);
}

export function countVisibleNumberTokens(root = globalThis.document?.body) {
  if (!root || typeof globalThis.getComputedStyle !== "function") return 0;
  const nodes = [root, ...root.querySelectorAll("*")];
  const viewportWidth = globalThis.innerWidth || globalThis.document?.documentElement?.clientWidth || 0;
  const viewportHeight = globalThis.innerHeight || globalThis.document?.documentElement?.clientHeight || 0;
  let count = 0;
  for (const node of nodes) {
    if (node.matches?.("script, style, [aria-hidden='true'], [data-number-budget-exempt]")) continue;
    if (node.closest?.("[data-number-budget-exempt]") && !node.matches?.("[data-number-budget-exempt]")) continue;
    const style = getComputedStyle(node);
    if (node.hidden || style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) continue;
    if (node !== root && typeof node.getClientRects === "function") {
      const rects = [...node.getClientRects()];
      if (!rects.some((rect) => rect.right > 0 && rect.bottom > 0 && rect.left < viewportWidth && rect.top < viewportHeight)) continue;
    }
    for (const child of node.childNodes) {
      if (child.nodeType !== Node.TEXT_NODE) continue;
      count += child.textContent.match(/\d+(?:[.,]\d+)*/g)?.length || 0;
    }
  }
  return count;
}

export function createUi(callbacks) {
  const refs = {
    canvas: element("map"),
    app: element("app-overlay"),
    brandTitle: element("brand-title"),
    brandSubtitle: element("brand-subtitle"),
    stats: element("stats"),
    goldLabel: element("gold-label"),
    gold: element("gold-value"),
    goldPromise: element("gold-promise"),
    wage: element("wage-label"),
    troopLabel: element("troop-label"),
    troops: element("troop-value"),
    troopPromise: element("troop-promise"),
    renownLabel: element("renown-label"),
    renown: element("renown-value"),
    dayLabel: element("day-label"),
    day: element("day-value"),
    pause: element("pause-button"),
    settingsButton: element("settings-button"),
    hint: element("hint"),
    hintText: element("hint-text"),
    legend: element("legend"),
    legendText: element("legend-text"),
    seed: element("seed-label"),
    report: element("report"),
    reportToggle: element("report-toggle"),
    reportTitle: element("report-title"),
    battleComparison: element("battle-comparison"),
    encounterVerdict: element("encounter-verdict"),
    playerStrengthBar: element("player-strength-bar"),
    enemyStrengthBar: element("enemy-strength-bar"),
    playerStrengthValue: element("player-strength-value"),
    enemyStrengthValue: element("enemy-strength-value"),
    skipBattle: element("skip-battle"),
    retreatBattle: element("retreat-battle"),
    battleLog: element("battle-log"),
    ticker: element("ticker"),
    tickerSeal: element("ticker-seal"),
    tickerText: element("ticker-text"),
    townSheet: element("town-sheet"),
    townKicker: element("town-kicker"),
    townName: element("town-name"),
    townFaction: element("town-faction"),
    recruit: element("recruit-button"),
    recruitLabel: element("recruit-label"),
    recruitCost: element("recruit-cost"),
    tavern: element("tavern-button"),
    tavernLabel: element("tavern-label"),
    tavernDetail: element("tavern-detail"),
    settingsScrim: element("settings-scrim"),
    settingsSheet: element("settings-sheet"),
    settingsTitle: element("settings-title"),
    settingsClose: element("settings-close"),
    languageLabel: element("language-label"),
    languageZh: element("language-zh"),
    languageEn: element("language-en"),
    autosaveTitle: element("autosave-title"),
    autosaveStatus: element("autosave-status"),
    renownGate: element("renown-gate"),
    renownGateFill: element("renown-gate-fill"),
    renownGateLabel: element("renown-gate-label"),
    onboarding: element("onboarding"),
    onboardingSeal: element("onboarding-seal"),
    onboardingTitle: element("onboarding-title"),
    onboardingStep: element("onboarding-step"),
    onboardingStory: element("onboarding-story"),
    onboardingLine: element("onboarding-line"),
    onboardingTap: element("onboarding-tap"),
    titleNewSeed: element("title-new-seed"),
    titleDiagnostics: element("title-diagnostics"),
    promiseModal: element("promise-modal"),
    promiseCard: document.querySelector(".promise-card"),
    promiseKicker: element("promise-kicker"),
    promiseContext: element("promise-context"),
    promiseQuestion: element("promise-question"),
    promiseValue: element("promise-value"),
    promiseSlider: element("promise-slider"),
    promiseMin: element("promise-min"),
    promiseMax: element("promise-max"),
    promiseConfirm: element("promise-confirm"),
    contextTooltip: element("context-tooltip"),
    roadEventModal: element("road-event-modal"),
    roadEventKicker: element("road-event-kicker"),
    roadEventGlyphUse: element("road-event-glyph-use"),
    roadEventText: element("road-event-text"),
    roadEventChoiceA: element("road-event-choice-a"),
    roadEventChoiceB: element("road-event-choice-b"),
    ending: element("demo-ending"),
    endingSeal: element("ending-seal"),
    mirrorTitle: element("mirror-title"),
    mirrorTable: element("mirror-table"),
    endingChronicleTitle: element("ending-chronicle-title"),
    endingChronicle: element("ending-chronicle"),
    endingStatsTitle: element("ending-stats-title"),
    endingStats: element("ending-stats"),
    endingLine: element("ending-line"),
    shareResult: element("share-result"),
    replay: element("replay-button"),
    resultCode: element("result-code"),
    version: element("version-label"),
    fxLayer: element("fx-layer"),
    toast: element("toast"),
    description: document.querySelector('meta[name="description"]')
  };

  const counterValues = new WeakMap();
  let currentState = null;
  let settingsOpen = false;
  let saveAvailable = true;
  let toastTimer = null;
  let activeToast = null;
  let tooltipTimer = null;
  let promiseMode = null;
  let numberBudgetFrame = 0;
  let victoryFxTimer = 0;
  let reportExpanded = false;
  let diagnosticsVisible = false;
  let titleTapCount = 0;
  let lastTitleTapAt = 0;
  let lastRenown = null;
  let progressGlowTimer = null;

  function language() {
    return currentState?.settings.language || "zh";
  }

  function t(key, parameters) {
    return translate(language(), key, parameters);
  }

  function setCounter(node, value) {
    const text = String(value);
    if (node.textContent === text) return;
    const had = counterValues.has(node);
    node.textContent = text;
    counterValues.set(node, value);
    if (!had || motionOff()) return;
    node.classList.remove("ticking");
    void node.offsetWidth;
    node.classList.add("ticking");
  }

  function translatedFaction(id) {
    const faction = currentState ? getFaction(currentState, id) : null;
    return faction ? t(faction.nameKey) : id;
  }

  function translatedLord(id) {
    const lord = currentState ? getLord(currentState, id) : null;
    if (lord) return lordName(language(), lord.nameIndex);
    if (/^bandit_\d+$/.test(String(id))) return t("log.banditParty");
    return id;
  }

  function resolveParameters(parameters = {}) {
    const resolved = { ...parameters };
    if (parameters.townId && currentState) {
      const town = getTown(currentState, parameters.townId);
      if (town) resolved.town = t(town.nameKey);
    }
    const factionMappings = [
      ["factionId", "faction"],
      ["firstFactionId", "first"],
      ["secondFactionId", "second"],
      ["attackerFactionId", "attackerFaction"]
    ];
    factionMappings.forEach(([source, target]) => {
      if (parameters[source]) resolved[target] = translatedFaction(parameters[source]);
    });
    const lordMappings = [
      ["lordId", "lord"],
      ["winnerId", "winner"],
      ["loserId", "loser"],
      ["attackerLordId", "attackerLord"]
    ];
    lordMappings.forEach(([source, target]) => {
      if (parameters[source]) resolved[target] = translatedLord(parameters[source]);
    });
    return resolved;
  }

  function compactEventText(copy) {
    const replacement = language() === "zh" ? "若干" : "some";
    const compact = copy
      .replace(/[+−-]?\d+(?:[.,]\d+)?%?/g, replacement)
      .replace(/\s+/g, " ")
      .trim();
    return language() === "zh" ? compact.replace(/\s*若干\s*/g, "若干") : compact;
  }

  // Only these carry a seal dot on the ticker. A dot on every line would make
  // the dot mean "line", not "this one matters".
  const SEALED_EVENTS = new Set([
    "log.warDeclared",
    "log.peaceDeclared",
    "log.townCaptured",
    "log.siegeStarted",
    "log.factionFallen"
  ]);

  let tickerKey = null;

  function renderTicker(entries) {
    const newest = entries[0] || null;
    refs.ticker.hidden = !newest;
    if (!newest) {
      tickerKey = null;
      return;
    }
    const text = compactEventText(t(newest.key, resolveParameters(newest.parameters)));
    const identity = `${newest.key}:${text}`;
    refs.tickerSeal.hidden = !SEALED_EVENTS.has(newest.key);
    if (identity === tickerKey) return;
    tickerKey = identity;
    refs.tickerText.textContent = text;
    // Newest slides in from the right, once. Not a looping marquee.
    refs.ticker.classList.remove("arriving");
    void refs.ticker.offsetWidth;
    if (!motionOff()) refs.ticker.classList.add("arriving");
  }

  function renderEventLog() {
    refs.battleLog.replaceChildren();
    const entries = currentState.eventLog.slice(0, CONFIG.VISIBLE_LOG_ENTRIES);
    if (!entries.length) {
      const quiet = document.createElement("li");
      quiet.textContent = t("report.quiet");
      refs.battleLog.appendChild(quiet);
    }
    entries.forEach((entry) => {
      const item = document.createElement("li");
      const copy = t(entry.key, resolveParameters(entry.parameters));
      item.textContent = compactEventText(copy);
      if (entry.tone) item.className = entry.tone;
      refs.battleLog.appendChild(item);
    });
    renderTicker(entries);
    refs.report.dataset.expanded = String(reportExpanded);
    refs.reportToggle.setAttribute("aria-expanded", String(reportExpanded));
  }

  function localizedRoadCopy(value) {
    if (typeof value === "string") return value;
    return value?.[language()] || value?.zh || value?.en || "";
  }

  function syncRoadEvent(state) {
    const active = state.demo?.activeRoadEvent || state.demo?.roadEvent || null;
    const visible = state.demo?.modal === "roadEvent" && Boolean(active);
    refs.roadEventModal.hidden = !visible;
    if (!visible) return;
    const eventId = typeof active === "string" ? active : (active.eventId || active.id);
    const definition = ROAD_EVENTS.find((entry) => entry.id === eventId);
    if (!definition) {
      refs.roadEventModal.hidden = true;
      return;
    }
    refs.roadEventGlyphUse.setAttribute("href", `#road-event-glyph-${definition.topic}`);
    refs.roadEventText.textContent = localizedRoadCopy(definition.text);
    refs.roadEventChoiceA.textContent = localizedRoadCopy(definition.choices[0]?.label);
    refs.roadEventChoiceB.textContent = localizedRoadCopy(definition.choices[1]?.label);
  }

  function syncRenownGate(state) {
    const renown = Math.max(0, state.player.renown);
    const gate = state.player.act >= 2 ? CONFIG.DEMO_END_RENOWN : CONFIG.ACT2_RENOWN;
    const key = state.player.act >= 2 ? "hud.renownGateAct2" : "hud.renownGateAct1";
    refs.renownGate.hidden = state.demo.ended;
    refs.renownGateFill.style.width = `${Math.min(100, (renown / gate) * 100)}%`;
    refs.renownGateLabel.textContent = t(key, { renown: Math.min(renown, gate) });
    if (lastRenown !== null && renown > lastRenown && !motionOff()) {
      refs.renownGateFill.classList.remove("growing");
      void refs.renownGateFill.offsetWidth;
      refs.renownGateFill.classList.add("growing");
      if (progressGlowTimer) clearTimeout(progressGlowTimer);
      progressGlowTimer = setTimeout(() => refs.renownGateFill.classList.remove("growing"), 560);
    }
    lastRenown = renown;
  }

  function battleVerdict(state) {
    const bandit = state.battle
      ? state.bandits.find((entry) => entry.id === state.battle.banditId)
      : null;
    if (!bandit) return null;
    const playerStrength = getPartyStrength(state.player);
    const enemyStrength = getPartyStrength(bandit);
    const ratio = playerStrength / Math.max(1, enemyStrength);
    const key = ratio >= CONFIG.ENCOUNTER_SURE_WIN_RATIO
      ? "report.verdictSureWin"
      : ratio <= CONFIG.ENCOUNTER_OUTMATCHED_RATIO
        ? "report.verdictOutmatched"
        : "report.verdictEven";
    return { key, playerStrength, enemyStrength };
  }

  function syncBattleComparison(state) {
    const comparison = battleVerdict(state);
    refs.battleComparison.hidden = !comparison;
    document.body.classList.toggle("battle-active", Boolean(comparison));
    if (!comparison) return;
    refs.encounterVerdict.textContent = t(comparison.key);
    refs.playerStrengthValue.textContent = String(comparison.playerStrength);
    refs.enemyStrengthValue.textContent = String(comparison.enemyStrength);
    const maximum = Math.max(1, comparison.playerStrength, comparison.enemyStrength);
    refs.playerStrengthBar.style.width = `${Math.max(8, comparison.playerStrength / maximum * 100)}%`;
    refs.enemyStrengthBar.style.width = `${Math.max(8, comparison.enemyStrength / maximum * 100)}%`;
  }

  function syncPromiseMarker(node, promise, actual, key) {
    node.hidden = !promise;
    node.classList.toggle("exceeded", Boolean(promise?.exceeded));
    if (!promise) return;
    node.textContent = promise.exceeded
      ? t(key, { actual, goal: promise.statedGoal })
      : t("hud.promiseCompact", { goal: promise.statedGoal });
  }

  function syncMirrorHud(state) {
    const troopPromise = state.player.promises.find((entry) => entry.act === 1);
    const goldPromise = state.player.promises.find((entry) => entry.act === 2);
    syncPromiseMarker(refs.troopPromise, troopPromise, getTroopCount(state.player), "hud.troopOvershoot");
    syncPromiseMarker(refs.goldPromise, goldPromise, state.player.gold, "hud.goldOvershoot");
    document.body.classList.toggle("has-troop-overshoot", Boolean(troopPromise?.exceeded));
    document.body.classList.toggle("has-gold-overshoot", Boolean(goldPromise?.exceeded));
    document.body.classList.toggle("has-gold-promise", Boolean(goldPromise));
  }

  function syncStaticStrings() {
    const htmlLanguage = language() === "en" ? "en" : "zh-CN";
    document.documentElement.lang = htmlLanguage;
    document.title = t("page.title");
    refs.description.content = t("page.description");
    refs.canvas.setAttribute("aria-label", t("aria.map"));
    refs.app.setAttribute("aria-label", t("aria.app"));
    refs.stats.setAttribute("aria-label", t("aria.stats"));
    refs.legend.setAttribute("aria-label", t("aria.legend"));
    refs.report.setAttribute("aria-label", t("aria.report"));
    refs.reportToggle.setAttribute("aria-label", t("aria.toggleReport"));
    refs.townSheet.setAttribute("aria-label", t("aria.town"));
    refs.settingsSheet.setAttribute("aria-label", t("aria.settings"));
    refs.settingsScrim.setAttribute("aria-label", t("aria.closeSettings"));
    refs.onboarding.setAttribute("aria-label", t("aria.onboarding"));
    refs.promiseCard.setAttribute("aria-label", t("aria.promise"));
    refs.roadEventModal.setAttribute("aria-label", t("aria.roadEvent"));
    refs.contextTooltip.setAttribute("aria-label", t("aria.tooltip"));
    refs.ending.setAttribute("aria-label", t("aria.ending"));
    refs.brandTitle.textContent = t("brand.title");
    refs.brandSubtitle.textContent = t("brand.subtitle");
    refs.goldLabel.textContent = t("hud.gold");
    refs.troopLabel.textContent = t("hud.troops");
    refs.renownLabel.textContent = t("hud.renown");
    refs.dayLabel.textContent = t("hud.day");
    refs.settingsButton.setAttribute("aria-label", t("aria.openSettings"));
    refs.legendText.replaceChildren(...t("legend.items")
      .split(/\u3000+|\s{2,}/)
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const row = document.createElement("b");
        row.className = "legend-item";
        row.textContent = part;
        return row;
      }));
    refs.skipBattle.textContent = t("report.skip");
    refs.retreatBattle.textContent = t("report.retreat");
    refs.retreatBattle.setAttribute("aria-label", t("aria.retreat"));
    refs.townKicker.textContent = t("townPanel.entered");
    refs.recruitLabel.textContent = t("townPanel.recruit");
    refs.tavernLabel.textContent = t("townPanel.tavern");
    refs.tavern.setAttribute("aria-label", t("aria.tavern"));
    refs.settingsTitle.textContent = t("settings.title");
    refs.settingsClose.setAttribute("aria-label", t("aria.closeSettings"));
    refs.languageLabel.textContent = t("settings.language");
    refs.languageZh.textContent = t("settings.chinese");
    refs.languageEn.textContent = t("settings.english");
    refs.autosaveTitle.textContent = t("settings.autosave");
    refs.onboardingSeal.textContent = t("onboarding.seal");
    refs.onboardingTitle.textContent = t("onboarding.title");
    refs.onboardingTap.textContent = t("onboarding.tap");
    refs.titleNewSeed.textContent = t("onboarding.newSeed");
    refs.titleNewSeed.setAttribute("aria-label", t("aria.newSeed"));
    refs.promiseConfirm.textContent = t("promise.confirm");
    refs.roadEventKicker.textContent = t("roadEvent.kicker");
    refs.endingSeal.textContent = t("ending.seal");
    refs.mirrorTitle.textContent = t("ending.mirrorTitle");
    refs.endingChronicleTitle.textContent = t("ending.chronicleTitle");
    refs.endingStatsTitle.textContent = t("ending.statsTitle");
    refs.endingLine.textContent = t("ending.line");
    refs.shareResult.textContent = t("ending.share");
    refs.shareResult.setAttribute("aria-label", t("aria.share"));
    refs.replay.textContent = t("ending.replay");
    refs.replay.setAttribute("aria-label", t("aria.replay"));
    refs.version.textContent = CONFIG.BUILD_VERSION;
    refs.titleDiagnostics.textContent = `${t("legend.seed", { seed: currentState.seed })} · ${CONFIG.BUILD_VERSION}`;
    if (activeToast) refs.toast.textContent = t(activeToast.key, resolveParameters(activeToast.parameters));
  }

  function syncOnboarding(state) {
    const visible = state.demo.modal === "onboarding";
    refs.onboarding.hidden = !visible;
    if (!visible) return;
    const current = state.demo.onboardingStep + 1;
    refs.onboardingStep.textContent = t("onboarding.step", { current });
    refs.onboardingStory.hidden = current !== 1;
    refs.onboardingStory.textContent = current === 1 ? t("story.opening") : "";
    refs.onboardingLine.textContent = t(`onboarding.step${current}`);
  }

  function configurePromiseModal(state) {
    const mode = state.demo.modal;
    const visible = mode === "troopPromise" || mode === "goldPromise";
    refs.promiseModal.hidden = !visible;
    if (!visible) {
      promiseMode = null;
      return;
    }
    const troops = mode === "troopPromise";
    refs.promiseKicker.textContent = t(troops ? "promise.act1Kicker" : "promise.act2Kicker");
    const actOne = state.player.promises.find((entry) => entry.act === 1);
    refs.promiseQuestion.textContent = troops
      ? t("promise.troopsQuestion")
      : t("promise.goldQuestion", {
        said: actOne?.statedGoal ?? 0,
        actual: actOne?.actualAtActEnd ?? getTroopCount(state.player)
      });
    refs.promiseContext.hidden = false;
    refs.promiseContext.textContent = t(troops ? "promise.act1Fiction" : "promise.act2Fiction");
    if (promiseMode !== mode) {
      promiseMode = mode;
      const minimum = troops ? CONFIG.PROMISE_TROOPS_MIN : CONFIG.PROMISE_GOLD_MIN;
      const maximum = troops ? CONFIG.PROMISE_TROOPS_MAX : CONFIG.PROMISE_GOLD_MAX;
      const step = troops ? CONFIG.PROMISE_TROOPS_STEP : CONFIG.PROMISE_GOLD_STEP;
      const fallback = troops ? CONFIG.PROMISE_TROOPS_DEFAULT : CONFIG.PROMISE_GOLD_DEFAULT;
      refs.promiseSlider.min = String(minimum);
      refs.promiseSlider.max = String(maximum);
      refs.promiseSlider.step = String(step);
      refs.promiseSlider.value = String(fallback);
      refs.promiseMin.textContent = String(minimum);
      refs.promiseMax.textContent = String(maximum);
      refs.promiseValue.textContent = String(fallback);
    }
  }

  function appendEndingStat(label, value) {
    const wrapper = document.createElement("div");
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    wrapper.className = "ending-stat";
    term.textContent = label;
    description.textContent = value;
    wrapper.append(term, description);
    refs.endingStats.appendChild(wrapper);
  }

  let endingStamped = false;

  function renderEnding(state) {
    const visible = Boolean(state.demo.ended);
    refs.ending.hidden = !visible;
    document.body.classList.toggle("demo-ended", visible);
    if (!visible) {
      endingStamped = false;
      return;
    }
    // The ending is one of the seal's specified moments. Fire it once per
    // ending, not once per render pass.
    if (!endingStamped) {
      endingStamped = true;
      stampSeal(t("ending.seal"));
    }
    refs.mirrorTable.replaceChildren();
    state.player.promises.slice(0, 2).forEach((promise) => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      const said = document.createElement("strong");
      const did = document.createElement("strong");
      const actual = promise.actualAtActEnd ?? (promise.kind === "gold" ? state.player.gold : getTroopCount(state.player));
      row.className = "mirror-row";
      if (actual > promise.statedGoal) row.classList.add("overshot");
      label.textContent = t(promise.kind === "gold" ? "ending.gold" : "ending.troops");
      said.textContent = t("ending.said", { value: promise.statedGoal });
      did.textContent = t("ending.did", { value: actual });
      row.append(label, said, did);
      refs.mirrorTable.appendChild(row);
    });
    refs.endingChronicle.replaceChildren();
    for (const entry of buildChronicleEntries(state.telemetry, language())) {
      const item = document.createElement("li");
      item.dataset.eventType = entry.type;
      item.textContent = entry.text;
      refs.endingChronicle.appendChild(item);
    }
    const battles = state.stats.battles || 0;
    const winRate = battles ? Math.round((state.stats.wins || 0) / battles * 100) : 0;
    refs.endingStats.replaceChildren();
    appendEndingStat(t("ending.days"), String(state.stats.days));
    appendEndingStat(t("ending.battles"), String(battles));
    appendEndingStat(t("ending.winRate"), `${winRate}%`);
    appendEndingStat(t("ending.peakTroops"), String(state.stats.peakTroops || 0));
    appendEndingStat(t("ending.peakGold"), String(state.stats.peakGold || 0));
    refs.resultCode.textContent = buildResultCode(state);
  }

  function sync(state, runtime = {}) {
    currentState = state;
    if (typeof runtime.saveAvailable === "boolean") saveAvailable = runtime.saveAvailable;
    syncStaticStrings();

    setCounter(refs.gold, state.player.gold);
    setCounter(refs.troops, getTroopCount(state.player));
    setCounter(refs.renown, state.player.renown);
    setCounter(refs.day, state.stats.days + 1);
    refs.wage.textContent = state.stats.days < CONFIG.WAGE_GRACE_DAYS
      ? t("hud.wageGrace", { day: CONFIG.WAGE_GRACE_DAYS })
      : t("hud.wages", { wage: getDailyWage(state.player) });
    refs.seed.textContent = t("legend.seed", { seed: state.seed });
    syncRenownGate(state);
    syncMirrorHud(state);

    refs.pause.classList.toggle("is-paused", Boolean(state.paused));
    refs.pause.setAttribute("aria-label", state.paused ? t("aria.resume") : t("aria.pause"));
    refs.hint.classList.toggle("battle", Boolean(state.battle) && !state.paused);
    refs.hint.classList.toggle("paused", state.paused);
    refs.hint.hidden = !state.battle && state.demo.pauseReason !== "user";
    refs.hintText.textContent = state.paused
      ? t("hint.paused")
      : state.battle
        ? t("hint.battle", { seconds: CONFIG.BATTLE_ROUND_TICKS * CONFIG.LOGIC_MS / 1000 })
        : t("hint.move");

    refs.reportTitle.textContent = state.battle ? t("report.battle") : t("report.march");
    refs.skipBattle.hidden = !state.battle || state.paused;
    refs.retreatBattle.hidden = !state.battle || state.paused;
    renderEventLog();
    syncBattleComparison(state);

    const town = !state.paused && !state.battle && !settingsOpen && !state.demo.modal ? activeTown(state) : null;
    refs.townSheet.hidden = !town;
    document.body.classList.toggle("town-open", Boolean(town));
    if (town) {
      const faction = getFaction(state, town.factionId);
      const cap = actTroopCap(state);
      const capped = getTroopCount(state.player) >= cap;
      refs.townName.textContent = t(town.nameKey);
      refs.townFaction.textContent = t("townPanel.territory", { faction: t(faction.nameKey) });
      refs.recruit.disabled = capped || state.player.gold < CONFIG.RECRUIT_COST || town.recruitPool <= 0;
      refs.recruitCost.textContent = capped
        ? t("townPanel.recruitCapped", { cap })
        : t("townPanel.recruitCost", { cost: CONFIG.RECRUIT_COST });
      refs.tavern.hidden = state.player.act < 2;
      if (state.player.act >= 2) {
        const activeContract = state.player.contract;
        refs.tavernDetail.textContent = activeContract
          ? t("townPanel.contractActive", {
            faction: translatedFaction(activeContract.factionId),
            reward: activeContract.reward
          })
          : t("townPanel.contractOffer", {
            faction: t(faction.nameKey),
            reward: CONFIG.MERCENARY_PAY_PER_BATTLE
          });
      }
    }

    refs.settingsSheet.hidden = !settingsOpen;
    refs.settingsScrim.hidden = !settingsOpen;
    document.body.classList.toggle("settings-open", settingsOpen);
    document.body.classList.toggle("act-two", state.player.act >= 2);
    document.body.classList.toggle("paused", state.paused);
    document.body.classList.toggle("demo-modal-open", Boolean(state.demo.modal) && !state.demo.ended);
    refs.languageZh.setAttribute("aria-pressed", String(language() === "zh"));
    refs.languageEn.setAttribute("aria-pressed", String(language() === "en"));
    refs.autosaveStatus.textContent = saveAvailable
      ? t("settings.autosaveOn", { day: Math.floor(Math.max(0, state.lastSavedTick) / CONFIG.TICKS_PER_DAY) + 1 })
      : t("settings.autosaveUnavailable");
    syncOnboarding(state);
    configurePromiseModal(state);
    syncRoadEvent(state);
    renderEnding(state);
    updateNumberBudget();
  }

  function updateNumberBudget() {
    if (!numberBudgetDiagnostics && !diagnosticsVisible) return;
    if (numberBudgetFrame) cancelAnimationFrame(numberBudgetFrame);
    numberBudgetFrame = requestAnimationFrame(() => {
      document.documentElement.dataset.crownVisibleNumbers = String(countVisibleNumberTokens());
      numberBudgetFrame = requestAnimationFrame(() => {
        numberBudgetFrame = 0;
        document.documentElement.dataset.crownVisibleNumbers = String(countVisibleNumberTokens());
      });
    });
  }

  function setSettingsOpen(nextOpen) {
    if (currentState?.demo.modal) return;
    settingsOpen = Boolean(nextOpen);
    if (currentState) sync(currentState, { saveAvailable });
  }

  function showToast(key, parameters = {}) {
    if (!currentState) return;
    activeToast = { key, parameters };
    refs.toast.textContent = t(key, resolveParameters(parameters));
    refs.toast.classList.add("show");
    updateNumberBudget();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      refs.toast.classList.remove("show");
      refs.toast.textContent = "";
      activeToast = null;
      updateNumberBudget();
    }, 1600);
  }

  function showRoadEventResult(copy) {
    if (!currentState) return;
    const message = localizedRoadCopy(copy);
    if (!message) return;
    activeToast = null;
    refs.toast.textContent = message;
    refs.toast.classList.add("show");
    updateNumberBudget();
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      refs.toast.classList.remove("show");
      refs.toast.textContent = "";
      updateNumberBudget();
    }, 1800);
  }

  function showContextTooltip(id) {
    if (!id) return;
    refs.contextTooltip.textContent = t(`tooltip.${id}`);
    refs.contextTooltip.hidden = false;
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => { refs.contextTooltip.hidden = true; }, 3200);
  }

  function toggleDiagnosticsFromTitle(event) {
    event.stopPropagation();
    const now = performance.now();
    const windowMs = CONFIG.TITLE_TRIPLE_TAP_WINDOW_MS ?? 650;
    titleTapCount = now - lastTitleTapAt <= windowMs ? titleTapCount + 1 : 1;
    lastTitleTapAt = now;
    if (titleTapCount < 3) return;
    titleTapCount = 0;
    diagnosticsVisible = !diagnosticsVisible;
    document.body.classList.toggle("diagnostics-visible", diagnosticsVisible);
    updateNumberBudget();
  }

  function removeFx(node, delay = 900) {
    window.setTimeout(() => {
      node.remove();
      updateNumberBudget();
    }, delay);
  }

  function playVictoryFx(loot, renown) {
    document.body.classList.add("victory-fx-active");
    if (victoryFxTimer) clearTimeout(victoryFxTimer);
    victoryFxTimer = setTimeout(() => {
      victoryFxTimer = 0;
      document.body.classList.remove("victory-fx-active");
      updateNumberBudget();
    }, 1700);
    updateNumberBudget();
    if (motionOff()) return;
    const target = refs.gold.getBoundingClientRect();
    const fromX = window.innerWidth * 0.5;
    const fromY = window.innerHeight * 0.58;
    const toX = target.left + target.width * 0.5;
    const toY = target.top + target.height * 0.5;
    const coinCount = Math.max(4, Math.min(8, Math.ceil(Math.max(1, loot) / 35)));
    for (let index = 0; index < coinCount; index += 1) {
      const coin = document.createElement("span");
      coin.className = "fx-coin";
      coin.textContent = "贝";
      coin.style.setProperty("--from-x", `${fromX + (index - coinCount / 2) * 10}px`);
      coin.style.setProperty("--from-y", `${fromY + (index % 2) * 8}px`);
      coin.style.setProperty("--to-x", `${toX}px`);
      coin.style.setProperty("--to-y", `${toY}px`);
      coin.style.animationDelay = `${index * 34}ms`;
      refs.fxLayer.appendChild(coin);
      removeFx(coin, 950 + index * 34);
    }
    if (renown > 0) {
      const gain = document.createElement("span");
      gain.className = "fx-renown";
      gain.textContent = t("fx.renown", { renown });
      gain.style.setProperty("--from-x", `${Math.max(20, fromX - 50)}px`);
      gain.style.setProperty("--from-y", `${fromY - 30}px`);
      refs.fxLayer.appendChild(gain);
      removeFx(gain, 900);
    }
    updateNumberBudget();
  }

  function playRecruitFx(from, to) {
    if (motionOff() || !from || !to) return;
    const start = Math.hypot(to.x - from.x, to.y - from.y) < 18
      ? { x: from.x - 52, y: from.y + 22 }
      : from;
    for (let index = 0; index < 3; index += 1) {
      const token = document.createElement("span");
      token.className = "fx-recruit";
      token.textContent = "卒";
      token.style.setProperty("--from-x", `${start.x - index * 14}px`);
      token.style.setProperty("--from-y", `${start.y + (index % 2) * 5}px`);
      token.style.setProperty("--to-x", `${to.x}px`);
      token.style.setProperty("--to-y", `${to.y}px`);
      token.style.animationDelay = `${index * 45}ms`;
      refs.fxLayer.appendChild(token);
      removeFx(token, 760 + index * 45);
    }
  }

  refs.pause.addEventListener("click", () => callbacks.onTogglePause());
  refs.settingsButton.addEventListener("click", () => setSettingsOpen(true));
  refs.settingsClose.addEventListener("click", () => setSettingsOpen(false));
  refs.settingsScrim.addEventListener("click", () => setSettingsOpen(false));
  refs.reportToggle.addEventListener("click", () => {
    reportExpanded = !reportExpanded;
    if (currentState) renderEventLog();
  });
  // Tapping the ticker opens the dispatch drawer it summarises.
  refs.ticker.addEventListener("click", () => {
    reportExpanded = true;
    if (currentState) renderEventLog();
  });
  refs.languageZh.addEventListener("click", () => callbacks.onLanguageChange("zh"));
  refs.languageEn.addEventListener("click", () => callbacks.onLanguageChange("en"));
  refs.recruit.addEventListener("click", () => callbacks.onRecruit());
  refs.tavern.addEventListener("click", () => callbacks.onAcceptContract());
  refs.skipBattle.addEventListener("click", () => callbacks.onSkipBattle());
  refs.retreatBattle.addEventListener("click", () => callbacks.onRetreat());
  refs.onboarding.addEventListener("click", () => callbacks.onAdvanceOnboarding());
  refs.onboardingTitle.addEventListener("click", toggleDiagnosticsFromTitle);
  refs.brandTitle.addEventListener("click", toggleDiagnosticsFromTitle);
  refs.titleNewSeed.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onNewSeed(false);
  });
  refs.promiseSlider.addEventListener("input", () => {
    refs.promiseValue.textContent = refs.promiseSlider.value;
  });
  refs.promiseConfirm.addEventListener("click", () => callbacks.onSubmitPromise(Number(refs.promiseSlider.value)));
  refs.contextTooltip.addEventListener("click", () => { refs.contextTooltip.hidden = true; });
  refs.roadEventChoiceA.addEventListener("click", () => callbacks.onRoadEventChoice(0));
  refs.roadEventChoiceB.addEventListener("click", () => callbacks.onRoadEventChoice(1));
  refs.shareResult.addEventListener("click", () => callbacks.onShare());
  refs.replay.addEventListener("click", () => callbacks.onNewSeed(true));
  refs.ending.addEventListener("scroll", updateNumberBudget, { passive: true });
  window.addEventListener("resize", updateNumberBudget, { passive: true });
  document.fonts?.ready?.then(updateNumberBudget);

  [
    refs.pause,
    refs.settingsButton,
    refs.settingsClose,
    refs.reportToggle,
    refs.languageZh,
    refs.languageEn,
    refs.recruit,
    refs.tavern,
    refs.skipBattle,
    refs.retreatBattle,
    refs.titleNewSeed,
    refs.promiseSlider,
    refs.promiseConfirm,
    refs.contextTooltip,
    refs.roadEventChoiceA,
    refs.roadEventChoiceB,
    refs.shareResult,
    refs.replay
  ].forEach((control) => control.addEventListener("pointerdown", (event) => event.stopPropagation()));

  return {
    text: t,
    sync,
    showToast,
    showRoadEventResult,
    showContextTooltip,
    playVictoryFx,
    playRecruitFx,
    isSettingsOpen: () => settingsOpen,
    closeSettings: () => setSettingsOpen(false)
  };
}

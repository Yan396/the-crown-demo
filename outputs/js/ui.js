import { CONFIG } from "./data.js";
import { actTroopCap, getDailyWage } from "./demo.js";
import { activeTown, getFaction, getLord, getTown, getTroopCount } from "./state.js";
import { buildResultCode } from "./telemetry.js";
import { lordName, translate } from "./strings.js";

const reducedMotion = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

function motionOff() {
  return reducedMotion.matches;
}

function element(id) {
  return document.getElementById(id);
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
    reportTitle: element("report-title"),
    skipBattle: element("skip-battle"),
    retreatBattle: element("retreat-battle"),
    battleLog: element("battle-log"),
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
    onboardingLine: element("onboarding-line"),
    onboardingTap: element("onboarding-tap"),
    titleNewSeed: element("title-new-seed"),
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
    ending: element("demo-ending"),
    endingSeal: element("ending-seal"),
    mirrorTitle: element("mirror-title"),
    mirrorTable: element("mirror-table"),
    endingStatsTitle: element("ending-stats-title"),
    endingStats: element("ending-stats"),
    endingLine: element("ending-line"),
    shareResult: element("share-result"),
    replay: element("replay-button"),
    resultCode: element("result-code"),
    version: element("version-label"),
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
    return lord ? lordName(language(), lord.nameIndex) : id;
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

  function renderEventLog() {
    refs.battleLog.replaceChildren();
    currentState.eventLog.slice(0, CONFIG.VISIBLE_LOG_ENTRIES).forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = t(entry.key, resolveParameters(entry.parameters));
      if (entry.tone) item.className = entry.tone;
      refs.battleLog.appendChild(item);
    });
  }

  function syncRenownGate(state) {
    const renown = Math.max(0, state.player.renown);
    const gate = state.player.act >= 2 ? CONFIG.DEMO_END_RENOWN : CONFIG.ACT2_RENOWN;
    const key = state.player.act >= 2 ? "hud.renownGateAct2" : "hud.renownGateAct1";
    refs.renownGate.hidden = state.demo.ended;
    refs.renownGateFill.style.width = `${Math.min(100, (renown / gate) * 100)}%`;
    refs.renownGateLabel.textContent = t(key, { renown: Math.min(renown, gate) });
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
    refs.townSheet.setAttribute("aria-label", t("aria.town"));
    refs.settingsSheet.setAttribute("aria-label", t("aria.settings"));
    refs.settingsScrim.setAttribute("aria-label", t("aria.closeSettings"));
    refs.onboarding.setAttribute("aria-label", t("aria.onboarding"));
    refs.promiseCard.setAttribute("aria-label", t("aria.promise"));
    refs.contextTooltip.setAttribute("aria-label", t("aria.tooltip"));
    refs.ending.setAttribute("aria-label", t("aria.ending"));
    refs.brandTitle.textContent = t("brand.title");
    refs.brandSubtitle.textContent = t("brand.subtitle");
    refs.goldLabel.textContent = t("hud.gold");
    refs.troopLabel.textContent = t("hud.troops");
    refs.renownLabel.textContent = t("hud.renown");
    refs.dayLabel.textContent = t("hud.day");
    refs.settingsButton.setAttribute("aria-label", t("aria.openSettings"));
    refs.legendText.textContent = t("legend.items");
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
    refs.endingSeal.textContent = t("ending.seal");
    refs.mirrorTitle.textContent = t("ending.mirrorTitle");
    refs.endingStatsTitle.textContent = t("ending.statsTitle");
    refs.endingLine.textContent = t("ending.line");
    refs.shareResult.textContent = t("ending.share");
    refs.shareResult.setAttribute("aria-label", t("aria.share"));
    refs.replay.textContent = t("ending.replay");
    refs.replay.setAttribute("aria-label", t("aria.replay"));
    refs.version.textContent = CONFIG.BUILD_VERSION;
    if (activeToast) refs.toast.textContent = t(activeToast.key, resolveParameters(activeToast.parameters));
  }

  function syncOnboarding(state) {
    const visible = state.demo.modal === "onboarding";
    refs.onboarding.hidden = !visible;
    if (!visible) return;
    const current = state.demo.onboardingStep + 1;
    refs.onboardingStep.textContent = t("onboarding.step", { current });
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
    refs.promiseContext.hidden = true;
    if (promiseMode !== mode) {
      promiseMode = mode;
      const minimum = troops ? CONFIG.PROMISE_TROOPS_MIN : CONFIG.PROMISE_GOLD_MIN;
      const maximum = troops ? CONFIG.PROMISE_TROOPS_MAX : CONFIG.PROMISE_GOLD_MAX;
      const step = troops ? CONFIG.PROMISE_TROOPS_STEP : CONFIG.PROMISE_GOLD_STEP;
      const fallback = troops ? (CONFIG.PROMISE_TROOPS_DEFAULT ?? 60) : (CONFIG.PROMISE_GOLD_DEFAULT ?? 500);
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

  function renderEnding(state) {
    const visible = Boolean(state.demo.ended);
    refs.ending.hidden = !visible;
    document.body.classList.toggle("demo-ended", visible);
    if (!visible) return;
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
    refs.wage.textContent = t("hud.wages", { wage: getDailyWage(state.player) });
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
    document.body.classList.toggle("paused", state.paused);
    document.body.classList.toggle("demo-modal-open", Boolean(state.demo.modal) && !state.demo.ended);
    refs.languageZh.setAttribute("aria-pressed", String(language() === "zh"));
    refs.languageEn.setAttribute("aria-pressed", String(language() === "en"));
    refs.autosaveStatus.textContent = saveAvailable
      ? t("settings.autosaveOn", { day: Math.floor(Math.max(0, state.lastSavedTick) / CONFIG.TICKS_PER_DAY) + 1 })
      : t("settings.autosaveUnavailable");
    syncOnboarding(state);
    configurePromiseModal(state);
    renderEnding(state);
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
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      refs.toast.classList.remove("show");
      refs.toast.textContent = "";
      activeToast = null;
    }, 1600);
  }

  function showContextTooltip(id) {
    if (!id) return;
    refs.contextTooltip.textContent = t(`tooltip.${id}`);
    refs.contextTooltip.hidden = false;
    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => { refs.contextTooltip.hidden = true; }, 3200);
  }

  refs.pause.addEventListener("click", () => callbacks.onTogglePause());
  refs.settingsButton.addEventListener("click", () => setSettingsOpen(true));
  refs.settingsClose.addEventListener("click", () => setSettingsOpen(false));
  refs.settingsScrim.addEventListener("click", () => setSettingsOpen(false));
  refs.languageZh.addEventListener("click", () => callbacks.onLanguageChange("zh"));
  refs.languageEn.addEventListener("click", () => callbacks.onLanguageChange("en"));
  refs.recruit.addEventListener("click", () => callbacks.onRecruit());
  refs.tavern.addEventListener("click", () => callbacks.onAcceptContract());
  refs.skipBattle.addEventListener("click", () => callbacks.onSkipBattle());
  refs.retreatBattle.addEventListener("click", () => callbacks.onRetreat());
  refs.onboarding.addEventListener("click", () => callbacks.onAdvanceOnboarding());
  refs.titleNewSeed.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onNewSeed(false);
  });
  refs.promiseSlider.addEventListener("input", () => {
    refs.promiseValue.textContent = refs.promiseSlider.value;
  });
  refs.promiseConfirm.addEventListener("click", () => callbacks.onSubmitPromise(Number(refs.promiseSlider.value)));
  refs.contextTooltip.addEventListener("click", () => { refs.contextTooltip.hidden = true; });
  refs.shareResult.addEventListener("click", () => callbacks.onShare());
  refs.replay.addEventListener("click", () => callbacks.onNewSeed(true));

  [
    refs.pause,
    refs.settingsButton,
    refs.settingsClose,
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
    refs.shareResult,
    refs.replay
  ].forEach((control) => control.addEventListener("pointerdown", (event) => event.stopPropagation()));

  return {
    text: t,
    sync,
    showToast,
    showContextTooltip,
    isSettingsOpen: () => settingsOpen,
    closeSettings: () => setSettingsOpen(false)
  };
}

import { CONFIG } from "./data.js";
import { activeTown, getFaction, getTown, getTroopCount } from "./state.js";
import { translate } from "./strings.js";

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
    troopLabel: element("troop-label"),
    troops: element("troop-value"),
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
    battleLog: element("battle-log"),
    townSheet: element("town-sheet"),
    townKicker: element("town-kicker"),
    townName: element("town-name"),
    townFaction: element("town-faction"),
    recruit: element("recruit-button"),
    recruitLabel: element("recruit-label"),
    recruitCost: element("recruit-cost"),
    settingsScrim: element("settings-scrim"),
    settingsSheet: element("settings-sheet"),
    settingsTitle: element("settings-title"),
    settingsClose: element("settings-close"),
    languageLabel: element("language-label"),
    languageZh: element("language-zh"),
    languageEn: element("language-en"),
    autosaveTitle: element("autosave-title"),
    autosaveStatus: element("autosave-status"),
    toast: element("toast"),
    description: document.querySelector('meta[name="description"]')
  };

  let currentState = null;
  let settingsOpen = false;
  let saveAvailable = true;
  let toastTimer = null;
  let activeToast = null;

  function language() {
    return currentState?.settings.language || "zh";
  }

  function t(key, parameters) {
    return translate(language(), key, parameters);
  }

  function resolveParameters(parameters = {}) {
    const resolved = { ...parameters };
    if (parameters.townId && currentState) {
      const town = getTown(currentState, parameters.townId);
      if (town) resolved.town = t(town.nameKey);
    }
    return resolved;
  }

  function renderEventLog() {
    refs.battleLog.replaceChildren();
    currentState.eventLog.slice(-CONFIG.VISIBLE_LOG_ENTRIES).forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = t(entry.key, resolveParameters(entry.parameters));
      if (entry.tone) item.className = entry.tone;
      refs.battleLog.appendChild(item);
    });
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
    refs.brandTitle.textContent = t("brand.title");
    refs.brandSubtitle.textContent = t("brand.subtitle");
    refs.goldLabel.textContent = t("hud.gold");
    refs.troopLabel.textContent = t("hud.troops");
    refs.renownLabel.textContent = t("hud.renown");
    refs.dayLabel.textContent = t("hud.day");
    refs.settingsButton.textContent = t("hud.settingsGlyph");
    refs.settingsButton.setAttribute("aria-label", t("aria.openSettings"));
    refs.legendText.textContent = t("legend.items");
    refs.skipBattle.textContent = t("report.skip");
    refs.townKicker.textContent = t("townPanel.entered");
    refs.recruitLabel.textContent = t("townPanel.recruit");
    refs.recruitCost.textContent = t("townPanel.recruitCost", { cost: CONFIG.RECRUIT_COST });
    refs.settingsTitle.textContent = t("settings.title");
    refs.settingsClose.textContent = t("settings.closeGlyph");
    refs.settingsClose.setAttribute("aria-label", t("aria.closeSettings"));
    refs.languageLabel.textContent = t("settings.language");
    refs.languageZh.textContent = t("settings.chinese");
    refs.languageEn.textContent = t("settings.english");
    refs.autosaveTitle.textContent = t("settings.autosave");
    if (activeToast) {
      refs.toast.textContent = t(activeToast.key, resolveParameters(activeToast.parameters));
    }
  }

  function sync(state, runtime = {}) {
    currentState = state;
    if (typeof runtime.saveAvailable === "boolean") saveAvailable = runtime.saveAvailable;
    syncStaticStrings();

    refs.gold.textContent = String(state.player.gold);
    refs.troops.textContent = String(getTroopCount(state.player));
    refs.renown.textContent = String(state.player.renown);
    refs.day.textContent = String(state.stats.days + 1);
    refs.seed.textContent = t("legend.seed", { seed: state.seed });

    refs.pause.textContent = state.paused ? t("hud.resumeGlyph") : t("hud.pauseGlyph");
    refs.pause.setAttribute("aria-label", state.paused ? t("aria.resume") : t("aria.pause"));
    refs.hint.classList.toggle("battle", Boolean(state.battle) && !state.paused);
    refs.hint.classList.toggle("paused", state.paused);
    refs.hintText.textContent = state.paused
      ? t("hint.paused")
      : state.battle
        ? t("hint.battle", { seconds: CONFIG.BATTLE_ROUND_TICKS * CONFIG.LOGIC_MS / 1000 })
        : t("hint.move");

    refs.reportTitle.textContent = state.battle ? t("report.battle") : t("report.march");
    refs.skipBattle.hidden = !state.battle || state.paused;
    renderEventLog();

    const town = !state.paused && !state.battle && !settingsOpen ? activeTown(state) : null;
    refs.townSheet.hidden = !town;
    document.body.classList.toggle("town-open", Boolean(town));
    if (town) {
      const faction = getFaction(state, town.factionId);
      refs.townName.textContent = t(town.nameKey);
      refs.townFaction.textContent = t("townPanel.territory", { faction: t(faction.nameKey) });
      refs.recruit.disabled = state.player.gold < CONFIG.RECRUIT_COST;
    }

    refs.settingsSheet.hidden = !settingsOpen;
    refs.settingsScrim.hidden = !settingsOpen;
    document.body.classList.toggle("settings-open", settingsOpen);
    document.body.classList.toggle("paused", state.paused);
    refs.languageZh.setAttribute("aria-pressed", String(language() === "zh"));
    refs.languageEn.setAttribute("aria-pressed", String(language() === "en"));
    refs.autosaveStatus.textContent = saveAvailable
      ? t("settings.autosaveOn", { day: Math.floor(Math.max(0, state.lastSavedTick) / CONFIG.TICKS_PER_DAY) + 1 })
      : t("settings.autosaveUnavailable");
  }

  function setSettingsOpen(nextOpen) {
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
    }, 1300);
  }

  refs.pause.addEventListener("click", () => callbacks.onTogglePause());
  refs.settingsButton.addEventListener("click", () => setSettingsOpen(true));
  refs.settingsClose.addEventListener("click", () => setSettingsOpen(false));
  refs.settingsScrim.addEventListener("click", () => setSettingsOpen(false));
  refs.languageZh.addEventListener("click", () => callbacks.onLanguageChange("zh"));
  refs.languageEn.addEventListener("click", () => callbacks.onLanguageChange("en"));
  refs.recruit.addEventListener("click", () => callbacks.onRecruit());
  refs.skipBattle.addEventListener("click", () => callbacks.onSkipBattle());

  [
    refs.pause,
    refs.settingsButton,
    refs.settingsClose,
    refs.languageZh,
    refs.languageEn,
    refs.recruit,
    refs.skipBattle
  ].forEach((button) => button.addEventListener("pointerdown", (event) => event.stopPropagation()));

  return {
    sync,
    showToast,
    isSettingsOpen: () => settingsOpen,
    closeSettings: () => setSettingsOpen(false)
  };
}

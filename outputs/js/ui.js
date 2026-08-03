import { stampSeal } from "./seal.js";
import { getBattleEnemy } from "./battle.js";
import { CONFIG, CONFIG_V11, F4_LIEUTENANT_EVENTS, LIEUTENANT_ROSTER, ROAD_EVENTS } from "./data.js";
import { buildChronicleEntries } from "./chronicle.js";
import { lieutenantPortrait } from "./portraits.js";
import { actTroopCap, getDailyWage } from "./demo.js";
import { fiefGarrisonWage, getTavernContracts, townRecruitPrice } from "./sim.js";
import {
  activeTown,
  getFaction,
  getLieutenants,
  getLord,
  getPartyStrength,
  getTown,
  getTroopCount,
  isV11State
} from "./state.js";
import { buildResultCode } from "./telemetry.js";
import { lordName, translate } from "./strings.js";
import { isDesktopRuntime } from "./storage.js";

const reducedMotion = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };
const numberBudgetDiagnostics = new URLSearchParams(window.location.search).get("qa") === "1";
const ALL_ROAD_EVENTS = [...ROAD_EVENTS, ...F4_LIEUTENANT_EVENTS];
const desktopRuntime = isDesktopRuntime();

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
    fiefStat: element("fief-stat"),
    fiefLabel: element("fief-label"),
    fiefs: element("fief-value"),
    fiefPromise: element("fief-promise"),
    renownLabel: element("renown-label"),
    renown: element("renown-value"),
    dayLabel: element("day-label"),
    day: element("day-value"),
    helpButton: element("help-button"),
    soundButton: element("sound-button"),
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
    recruitArcher: element("recruit-archer-button"),
    recruitArcherLabel: element("recruit-archer-label"),
    recruitArcherCost: element("recruit-archer-cost"),
    recruitCavalry: element("recruit-cavalry-button"),
    recruitCavalryLabel: element("recruit-cavalry-label"),
    recruitCavalryCost: element("recruit-cavalry-cost"),
    veteran: element("veteran-button"),
    veteranLabel: element("veteran-label"),
    veteranCost: element("veteran-cost"),
    battleBuff: element("battle-buff-button"),
    battleBuffLabel: element("battle-buff-label"),
    battleBuffCost: element("battle-buff-cost"),
    tavern: element("tavern-button"),
    tavernLabel: element("tavern-label"),
    tavernDetail: element("tavern-detail"),
    fiefGarrison: element("fief-garrison"),
    garrisonTitle: element("garrison-title"),
    garrisonCounts: element("garrison-counts"),
    garrisonSlider: element("garrison-slider"),
    settingsScrim: element("settings-scrim"),
    settingsSheet: element("settings-sheet"),
    settingsTitle: element("settings-title"),
    settingsClose: element("settings-close"),
    languageLabel: element("language-label"),
    languageZh: element("language-zh"),
    languageEn: element("language-en"),
    soundLabel: element("sound-label"),
    soundToggle: element("sound-toggle"),
    autosaveTitle: element("autosave-title"),
    autosaveStatus: element("autosave-status"),
    helpCard: element("help-card"),
    helpTitle: element("help-title"),
    helpClose: element("help-close"),
    helpGoalLabel: element("help-goal-label"),
    helpGoal: element("help-goal"),
    helpFightLabel: element("help-fight-label"),
    helpFight: element("help-fight"),
    helpMoneyLabel: element("help-money-label"),
    helpMoney: element("help-money"),
    helpRenownLabel: element("help-renown-label"),
    helpRenown: element("help-renown"),
    renownGate: element("renown-gate"),
    renownGateFill: element("renown-gate-fill"),
    renownGateLabel: element("renown-gate-label"),
    lieutenantChip: element("lieutenant-chip"),
    onboarding: element("onboarding"),
    onboardingSeal: element("onboarding-seal"),
    onboardingTitle: element("onboarding-title"),
    onboardingStep: element("onboarding-step"),
    onboardingStory: element("onboarding-story"),
    onboardingLine: element("onboarding-line"),
    onboardingTap: element("onboarding-tap"),
    onboardingCopy: document.querySelector(".onboarding-copy"),
    titleStart: element("title-start"),
    titleRules: element("title-rules"),
    titleNewSeed: element("title-new-seed"),
    titleDiagnostics: element("title-diagnostics"),
    originModal: element("origin-modal"),
    originKicker: element("origin-kicker"),
    originTitle: element("origin-title"),
    originFiction: element("origin-fiction"),
    originButtons: [...document.querySelectorAll("[data-origin]")],
    originHunterTitle: element("origin-hunter-title"),
    originHunterDetail: element("origin-hunter-detail"),
    originBorderTitle: element("origin-border-title"),
    originBorderDetail: element("origin-border-detail"),
    originWandererTitle: element("origin-wanderer-title"),
    originWandererDetail: element("origin-wanderer-detail"),
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
    fiefPromiseOptions: element("fief-promise-options"),
    fiefPromiseButtons: [...document.querySelectorAll("[data-fief-promise]")],
    fiefPromiseAll: element("fief-promise-all"),
    contextTooltip: element("context-tooltip"),
    roadEventModal: element("road-event-modal"),
    roadEventKicker: element("road-event-kicker"),
    roadEventGlyphUse: element("road-event-glyph-use"),
    roadEventGlyph: element("road-event-glyph"),
    roadEventLieutenant: element("road-event-lieutenant"),
    roadEventText: element("road-event-text"),
    roadEventChoiceA: element("road-event-choice-a"),
    roadEventChoiceB: element("road-event-choice-b"),
    formationModal: element("formation-modal"),
    formationKicker: element("formation-kicker"),
    formationScout: element("formation-scout"),
    formationWedge: element("formation-wedge"),
    formationLine: element("formation-line"),
    formationCircle: element("formation-circle"),
    battleCommandModal: element("battle-command-modal"),
    battleCommandKicker: element("battle-command-kicker"),
    battleCommandCopy: element("battle-command-copy"),
    battleCommandButtons: [...document.querySelectorAll("[data-battle-command]")],
    fiefThreatModal: element("fief-threat-modal"),
    fiefThreatKicker: element("fief-threat-kicker"),
    fiefThreatTitle: element("fief-threat-title"),
    fiefThreatDetail: element("fief-threat-detail"),
    fiefThreatDismiss: element("fief-threat-dismiss"),
    kingdomModal: element("kingdom-modal"),
    kingdomSeal: element("kingdom-seal"),
    kingdomKicker: element("kingdom-kicker"),
    kingdomTitle: element("kingdom-title"),
    kingdomCopy: element("kingdom-copy"),
    foundingActions: element("founding-actions"),
    foundingAccept: element("founding-accept"),
    foundingDecline: element("founding-decline"),
    foundingSealContinue: element("founding-seal-continue"),
    edictActions: element("edict-actions"),
    edictContinue: element("edict-continue"),
    edictStop: element("edict-stop"),
    contractModal: element("contract-modal"),
    contractKicker: element("contract-kicker"),
    contractTitle: element("contract-title"),
    contractEscort: element("contract-offer-escort"),
    contractEscortTitle: element("contract-escort-title"),
    contractEscortDetail: element("contract-escort-detail"),
    contractRisky: element("contract-offer-risky"),
    contractRiskyTitle: element("contract-risky-title"),
    contractRiskyDetail: element("contract-risky-detail"),
    contractWar: element("contract-offer-war"),
    contractWarTitle: element("contract-war-title"),
    contractWarDetail: element("contract-war-detail"),
    contractReinforce: element("contract-offer-reinforce"),
    contractReinforceTitle: element("contract-reinforce-title"),
    contractReinforceDetail: element("contract-reinforce-detail"),
    contractPatrol: element("contract-offer-patrol"),
    contractPatrolTitle: element("contract-patrol-title"),
    contractPatrolDetail: element("contract-patrol-detail"),
    lieutenantOffer: element("lieutenant-offer"),
    lieutenantOfferTitle: element("lieutenant-offer-title"),
    lieutenantOfferDetail: element("lieutenant-offer-detail"),
    lieutenantOfferShen: element("lieutenant-offer-shen"),
    lieutenantOfferShenTitle: element("lieutenant-offer-shen-title"),
    lieutenantOfferShenDetail: element("lieutenant-offer-shen-detail"),
    lieutenantOfferJia: element("lieutenant-offer-jia"),
    lieutenantOfferJiaTitle: element("lieutenant-offer-jia-title"),
    lieutenantOfferJiaDetail: element("lieutenant-offer-jia-detail"),
    lieutenantOffers: [...document.querySelectorAll("[data-lieutenant-id]")],
    contractClose: element("contract-close"),
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
  let helpOpen = false;
  let contractsOpen = false;
  let saveAvailable = true;
  let toastTimer = null;
  let activeToast = null;
  let tooltipTimer = null;
  let promiseMode = null;
  let fiefPromiseValue = CONFIG.PROMISE_FIEFS_DEFAULT;
  let numberBudgetFrame = 0;
  let victoryFxTimer = 0;
  let roadEventFxTimer = 0;
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

  function translatedTown(id) {
    const town = currentState ? getTown(currentState, id) : null;
    return town ? t(town.nameKey) : id;
  }

  function translatedLord(id) {
    const lord = currentState ? getLord(currentState, id) : null;
    if (lord) return lordName(language(), lord.nameIndex);
    if (/^bandit_\d+$/.test(String(id))) return t("log.banditParty");
    return id;
  }

  function resolveParameters(parameters = {}) {
    const resolved = { ...parameters };
    if (parameters.choiceLabel) resolved.choice = localizedRoadCopy(parameters.choiceLabel);
    if (parameters.effectsApplied) {
      resolved.effects = formatRoadEventEffects(parameters.effectsApplied);
    }
    if (parameters.playerFormation) {
      resolved.playerFormation = t(`formation.${parameters.playerFormation}`);
    }
    if (parameters.enemyFormation) {
      resolved.enemyFormation = t(`formation.${parameters.enemyFormation}`);
    }
    if (parameters.lieutenantId) {
      resolved.lieutenant = t(`lieutenant.${parameters.lieutenantId}Name`);
    }
    if (parameters.townId && currentState) {
      const town = getTown(currentState, parameters.townId);
      if (town) resolved.town = t(town.nameKey);
    }
    const factionMappings = [
      ["factionId", "faction"],
      ["targetFactionId", "target"],
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
      item.textContent = entry.key === "log.roadEventResolved"
        ? copy
        : compactEventText(copy);
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

  function signedEffect(value) {
    const number = Number(value) || 0;
    return number > 0 ? `+${number}` : String(number);
  }

  function formatRoadEventEffects(effects = {}) {
    const parts = [];
    for (const key of ["gold", "renown", "troops", "relation"]) {
      const value = Number(effects[key]) || 0;
      if (value) parts.push(t(`roadEvent.${key}Delta`, { value: signedEffect(value) }));
    }
    if (Number.isInteger(effects.banditBattlesBlockedDay)) {
      parts.push(t("roadEvent.battlesBlocked"));
    }
    if (Number(effects.nextBattleAttackMultiplier) > 1) {
      parts.push(t("roadEvent.attackBonus", {
        value: Math.round((Number(effects.nextBattleAttackMultiplier) - 1) * 100)
      }));
    }
    if (Number(effects.desertionChance) > 0 && !Number(effects.deserterLost)) {
      parts.push(t("roadEvent.noDeserter"));
    }
    if (!parts.length) parts.push(t("roadEvent.noChange"));
    const separator = language() === "zh" ? "，" : ", ";
    return `${separator}${parts.join(separator)}`;
  }

  function formatRoadEventResult(result) {
    if (!result?.choice) return localizedRoadCopy(result);
    const choice = localizedRoadCopy(result.choice.label);
    const applied = result.effectsApplied || result.applied?.effectsApplied || result.delta || {};
    const summary = `${choice}${formatRoadEventEffects(applied)}`;
    const outcome = localizedRoadCopy(result.choice.result);
    return outcome ? `${summary}。${outcome}` : summary;
  }

  function syncRoadEvent(state) {
    const active = state.demo?.activeRoadEvent || state.demo?.roadEvent || null;
    const visible = state.demo?.modal === "roadEvent" && Boolean(active);
    refs.roadEventModal.hidden = !visible;
    if (!visible) return;
    const eventId = typeof active === "string" ? active : (active.eventId || active.id);
    const definition = ALL_ROAD_EVENTS.find((entry) => entry.id === eventId);
    if (!definition) {
      refs.roadEventModal.hidden = true;
      return;
    }
    const owner = LIEUTENANT_ROSTER.find((profile) => eventId.startsWith(`${profile.id}_`));
    refs.roadEventGlyph.hidden = Boolean(owner);
    refs.roadEventLieutenant.hidden = !owner;
    refs.roadEventLieutenant.innerHTML = owner ? lieutenantPortrait(owner.id, "event") : "";
    refs.roadEventGlyphUse.setAttribute("href", `#road-event-glyph-${definition.topic}`);
    refs.roadEventText.textContent = localizedRoadCopy(definition.text);
    refs.roadEventChoiceA.textContent = localizedRoadCopy(definition.choices[0]?.label);
    refs.roadEventChoiceB.textContent = localizedRoadCopy(definition.choices[1]?.label);
  }

  function syncFormationModal(state) {
    const formations = state.battle?.formations;
    const visible = Boolean(
      state.demo?.modal === "formation" &&
      formations?.eligible &&
      !formations.resolved
    );
    refs.formationModal.hidden = !visible;
    if (!visible) return;
    refs.formationScout.textContent = t("formation.scout", {
      shape: t(`formation.report.${formations.reportedEnemy || "line"}`)
    });
  }

  function syncBattleCommandModal(state) {
    refs.battleCommandModal.hidden = !Boolean(
      state.features?.f3 &&
      state.demo?.modal === "battleCommand" &&
      state.battle?.commands &&
      !state.battle.commands.resolved
    );
  }

  function contractSummary(contract) {
    if (!contract?.active) return "";
    if (contract.type === "escort") {
      return t("contracts.activeEscort", { days: contract.daysRemaining });
    }
    if (contract.type === "war") {
      return t("contracts.activeWar", {
        faction: translatedFaction(contract.factionId),
        target: translatedFaction(contract.targetFactionId)
      });
    }
    if (contract.type === "reinforce") {
      return t("contracts.activeReinforce", {
        town: translatedTown(contract.targetTownId),
        target: contract.targetGarrison
      });
    }
    if (contract.type === "patrol") {
      return t("contracts.activePatrol", { town: translatedTown(contract.targetTownId) });
    }
    return t("contracts.activeRisky");
  }

  function syncContractModal(state, town) {
    const activeContract = state.player.contract?.active === true;
    const hired = getLieutenants(state);
    const slots = state.features?.f4 ? CONFIG.F4_LIEUTENANT_SLOTS : 1;
    const lieutenantAvailable = isV11State(state) && hired.length < slots;
    const visible = Boolean(
      contractsOpen &&
      town &&
      state.player.act >= 2 &&
      (!activeContract || lieutenantAvailable)
    );
    refs.contractModal.hidden = !visible;
    document.body.classList.toggle("contract-open", visible);
    if (!visible) return;
    const offers = activeContract ? [] : (getTavernContracts(state, town.id) || []);
    const escort = offers.find((offer) => offer.type === "escort");
    const risky = offers.find((offer) => offer.type === "risky");
    const war = offers.find((offer) => offer.type === "war");
    const reinforce = offers.find((offer) => offer.type === "reinforce");
    const patrol = offers.find((offer) => offer.type === "patrol");
    refs.contractEscort.hidden = !escort;
    refs.contractRisky.hidden = !risky;
    refs.contractWar.hidden = !war;
    refs.contractReinforce.hidden = !reinforce;
    refs.contractPatrol.hidden = !patrol;
    refs.lieutenantOffers.forEach((button) => {
      const id = button.dataset.lieutenantId;
      const f4Only = id !== "chen_mang";
      const available = lieutenantAvailable && (!f4Only || state.features?.f4) && !hired.some((entry) => entry.id === id);
      button.hidden = !available;
      button.disabled = state.player.gold < (state.features?.f4 ? CONFIG.F4_LIEUTENANT_COST : CONFIG.V11_LIEUTENANT_COST);
    });
    const cost = state.features?.f4 ? CONFIG.F4_LIEUTENANT_COST : CONFIG.V11_LIEUTENANT_COST;
    refs.lieutenantOfferDetail.textContent = t("lieutenant.chenDetail", {
      cost,
      bonus: Math.round(CONFIG_V11.LIEUTENANT_ATTACK_BONUS * 100)
    });
    refs.lieutenantOfferShenDetail.textContent = t("lieutenant.shenDetail", {
      cost,
      bonus: Math.round(CONFIG.F4_SHEN_DEFENSE_BONUS * 100)
    });
    refs.lieutenantOfferJiaDetail.textContent = t("lieutenant.jiaDetail", {
      cost,
      bonus: Math.round(CONFIG.F4_JIA_INCOME_BONUS * 100)
    });
    if (escort) {
      refs.contractEscort.dataset.contractId = escort.id;
      refs.contractEscortDetail.textContent = t("contracts.escortDetail", {
        reward: escort.reward,
        days: escort.days
      });
    }
    if (risky) {
      refs.contractRisky.dataset.contractId = risky.id;
      refs.contractRiskyDetail.textContent = t("contracts.riskyDetail", {
        reward: risky.reward,
        ratio: risky.enemyStrengthMultiplier,
        penalty: risky.failureRenown
      });
    }
    if (war) {
      refs.contractWar.dataset.contractId = war.id;
      refs.contractWarTitle.textContent = t("contracts.warTitle", {
        faction: translatedFaction(war.factionId)
      });
      refs.contractWarDetail.textContent = t("contracts.warDetail", {
        reward: war.reward,
        renown: war.renownReward,
        target: translatedFaction(war.targetFactionId),
        penalty: war.relationPenalty
      });
    }
    if (reinforce) {
      refs.contractReinforce.dataset.contractId = reinforce.id;
      refs.contractReinforceDetail.textContent = t("contracts.reinforceDetail", {
        town: translatedTown(reinforce.targetTownId),
        target: reinforce.targetGarrison,
        reward: reinforce.reward
      });
    }
    if (patrol) {
      refs.contractPatrol.dataset.contractId = patrol.id;
      refs.contractPatrolDetail.textContent = t("contracts.patrolDetail", {
        town: translatedTown(patrol.targetTownId),
        reward: patrol.reward
      });
    }
  }

  function syncRenownGate(state) {
    const renown = Math.max(0, state.player.renown);
    const gate = state.player.act < 2
      ? CONFIG.ACT2_RENOWN
      : state.player.act < 3
        ? (CONFIG.DEMO ? CONFIG.DEMO_END_RENOWN : CONFIG.ACT3_RENOWN)
        : state.kingdom?.founded
          ? state.kingdom.nextDecisionDay
          : CONFIG.ACT4_RENOWN;
    const key = state.player.act < 2
      ? "hud.renownGateAct1"
      : state.player.act < 3
        ? (CONFIG.DEMO ? "hud.renownGateAct2" : "hud.renownGateFief")
        : state.kingdom?.founded
          ? "hud.kingDaysGate"
          : "hud.renownGateKingdom";
    const value = state.kingdom?.founded ? state.kingdom.kingDays : renown;
    refs.renownGate.hidden = state.demo.ended;
    refs.renownGateFill.style.width = `${Math.min(100, (value / gate) * 100)}%`;
    refs.renownGateLabel.textContent = t(key, {
      renown: Math.min(renown, CONFIG.ACT4_RENOWN),
      towns: state.player.fiefs.length,
      day: state.kingdom?.kingDays || 0,
      target: gate
    });
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
    const bandit = getBattleEnemy(state);
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
    const fiefPromise = state.player.promises.find((entry) => entry.act === 3);
    syncPromiseMarker(refs.troopPromise, troopPromise, getTroopCount(state.player), "hud.troopOvershoot");
    syncPromiseMarker(refs.goldPromise, goldPromise, state.player.gold, "hud.goldOvershoot");
    syncPromiseMarker(refs.fiefPromise, fiefPromise, state.player.fiefs.length, "hud.fiefOvershoot");
    document.body.classList.toggle("has-troop-overshoot", Boolean(troopPromise?.exceeded));
    document.body.classList.toggle("has-gold-overshoot", Boolean(goldPromise?.exceeded));
    document.body.classList.toggle("has-gold-promise", Boolean(goldPromise));
    document.body.classList.toggle("has-fief", state.player.act >= 3 || state.player.fiefs.length > 0);
  }

  function syncStaticStrings() {
    const buildLabel = isV11State(currentState)
      ? `${CONFIG.BUILD_VERSION} · ${CONFIG.V11_BUILD_LABEL}`
      : CONFIG.BUILD_VERSION;
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
    refs.contractModal.setAttribute("aria-label", t("aria.contracts"));
    refs.formationModal.setAttribute("aria-label", t("aria.formation"));
    refs.fiefThreatModal.setAttribute("aria-label", t("aria.fiefThreat"));
    refs.contractClose.setAttribute("aria-label", t("aria.closeContracts"));
    refs.settingsSheet.setAttribute("aria-label", t("aria.settings"));
    refs.helpCard.setAttribute("aria-label", t("aria.openHelp"));
    refs.settingsScrim.setAttribute("aria-label", t("aria.closeSettings"));
    refs.onboarding.setAttribute("aria-label", t("aria.onboarding"));
    refs.originModal.setAttribute("aria-label", t("aria.origin"));
    refs.kingdomModal.setAttribute("aria-label", t("aria.kingdom"));
    refs.promiseCard.setAttribute("aria-label", t("aria.promise"));
    refs.roadEventModal.setAttribute("aria-label", t("aria.roadEvent"));
    refs.contextTooltip.setAttribute("aria-label", t("aria.tooltip"));
    refs.ending.setAttribute("aria-label", t("aria.ending"));
    refs.brandTitle.textContent = t("brand.title");
    refs.brandSubtitle.textContent = t(CONFIG.DEMO ? "brand.subtitle" : "brand.subtitleFull");
    refs.goldLabel.textContent = t("hud.gold");
    refs.troopLabel.textContent = t("hud.troops");
    refs.fiefLabel.textContent = t("hud.fiefs");
    refs.renownLabel.textContent = t("hud.renown");
    refs.dayLabel.textContent = t("hud.day");
    refs.settingsButton.setAttribute("aria-label", t("aria.openSettings"));
    refs.helpButton.setAttribute("aria-label", t("aria.openHelp"));
    refs.soundButton.setAttribute("aria-label", t("aria.toggleSound"));
    refs.helpClose.setAttribute("aria-label", t("aria.closeHelp"));
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
    refs.recruitArcherLabel.textContent = t("townPanel.recruitArcher");
    refs.recruitCavalryLabel.textContent = t("townPanel.recruitCavalry");
    refs.veteranLabel.textContent = t("townPanel.replenish");
    refs.battleBuffLabel.textContent = t("townPanel.battleBuff");
    refs.tavernLabel.textContent = t("townPanel.tavern");
    refs.tavern.setAttribute("aria-label", t("aria.tavern"));
    refs.contractKicker.textContent = t("contracts.kicker");
    refs.contractTitle.textContent = t("contracts.title");
    refs.contractEscortTitle.textContent = t("contracts.escortTitle");
    refs.contractRiskyTitle.textContent = t("contracts.riskyTitle");
    refs.contractReinforceTitle.textContent = t("contracts.reinforceTitle");
    refs.contractPatrolTitle.textContent = t("contracts.patrolTitle");
    refs.contractClose.textContent = t("contracts.close");
    refs.lieutenantOfferTitle.innerHTML = `${lieutenantPortrait("chen_mang", "offer")}<span>${t("lieutenant.chenName")}</span>`;
    refs.lieutenantOfferShenTitle.innerHTML = `${lieutenantPortrait("shen_wen", "offer")}<span>${t("lieutenant.shenName")}</span>`;
    refs.lieutenantOfferJiaTitle.innerHTML = `${lieutenantPortrait("jia_duojin", "offer")}<span>${t("lieutenant.jiaName")}</span>`;
    refs.formationKicker.textContent = t("formation.kicker");
    refs.formationWedge.textContent = t("formation.wedge");
    refs.formationLine.textContent = t("formation.line");
    refs.formationCircle.textContent = t("formation.circle");
    refs.battleCommandKicker.textContent = t("battleCommand.kicker");
    refs.battleCommandCopy.textContent = t("battleCommand.copy");
    refs.battleCommandButtons.forEach((button) => {
      button.textContent = t(`battleCommand.${button.dataset.battleCommand}`);
    });
    refs.settingsTitle.textContent = t("settings.title");
    refs.settingsClose.setAttribute("aria-label", t("aria.closeSettings"));
    refs.languageLabel.textContent = t("settings.language");
    refs.languageZh.textContent = t("settings.chinese");
    refs.languageEn.textContent = t("settings.english");
    refs.soundLabel.textContent = t("settings.sound");
    refs.autosaveTitle.textContent = t("settings.autosave");
    refs.helpTitle.textContent = t("help.title");
    refs.helpGoalLabel.textContent = t("help.goalLabel");
    refs.helpGoal.textContent = t(CONFIG.DEMO ? "help.goalDemo" : "help.goalFull");
    refs.helpFightLabel.textContent = t("help.fightLabel");
    refs.helpFight.textContent = t("help.fight");
    refs.helpMoneyLabel.textContent = t("help.moneyLabel");
    refs.helpMoney.textContent = t("help.money");
    refs.helpRenownLabel.textContent = t("help.renownLabel");
    refs.helpRenown.textContent = t(CONFIG.DEMO ? "help.renownDemo" : "help.renownFull");
    refs.onboardingSeal.textContent = t("onboarding.seal");
    refs.onboardingTitle.textContent = t("onboarding.title");
    refs.onboardingTap.textContent = t("onboarding.tap");
    refs.titleStart.textContent = t("onboarding.start");
    refs.titleRules.textContent = t("onboarding.rules");
    refs.titleNewSeed.textContent = t("onboarding.newSeed");
    refs.titleNewSeed.setAttribute("aria-label", t("aria.newSeed"));
    refs.originKicker.textContent = t("origin.kicker");
    refs.originTitle.textContent = t("origin.title");
    refs.originFiction.textContent = t("origin.fiction");
    refs.originHunterTitle.textContent = t("origin.hunterTitle");
    refs.originHunterDetail.textContent = t("origin.hunterDetail");
    refs.originBorderTitle.textContent = t("origin.borderTitle");
    refs.originBorderDetail.textContent = t("origin.borderDetail");
    refs.originWandererTitle.textContent = t("origin.wandererTitle");
    refs.originWandererDetail.textContent = t("origin.wandererDetail");
    refs.foundingAccept.textContent = t("kingdom.found");
    refs.foundingDecline.textContent = t("kingdom.notYet");
    refs.foundingSealContinue.textContent = t("kingdom.sealContinue");
    refs.edictContinue.textContent = t("kingdom.continueConquest");
    refs.edictStop.textContent = t("kingdom.stopHere");
    refs.promiseConfirm.textContent = t("promise.confirm");
    refs.fiefPromiseAll.textContent = t("promise.allFiefs");
    refs.garrisonTitle.textContent = t("fief.garrisonTitle");
    refs.fiefThreatKicker.textContent = t("fief.messengerKicker");
    refs.fiefThreatDismiss.textContent = t("fief.messengerDismiss");
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
    if (isV11State(currentState)) refs.version.textContent = buildLabel;
    refs.titleDiagnostics.textContent = `${t("legend.seed", { seed: currentState.seed })} · ${buildLabel}`;
    if (activeToast) refs.toast.textContent = t(activeToast.key, resolveParameters(activeToast.parameters));
  }

  function syncOnboarding(state) {
    const visible = state.demo.modal === "onboarding";
    refs.onboarding.hidden = !visible;
    if (!visible) return;
    const title = state.demo.onboardingStep < 0;
    const current = state.demo.onboardingStep + 1;
    refs.onboardingStep.hidden = title;
    refs.onboardingStep.textContent = title ? "" : t("onboarding.step", { current });
    refs.onboardingStory.hidden = !title;
    refs.onboardingStory.textContent = title ? t("story.opening") : "";
    refs.onboardingLine.hidden = title;
    refs.onboardingLine.textContent = title ? "" : t(`onboarding.step${current}`);
    refs.onboardingTap.hidden = title;
    refs.titleStart.hidden = !title;
    refs.titleRules.hidden = !title;
    refs.titleNewSeed.hidden = !title;
    refs.titleDiagnostics.hidden = !title;
  }

  function syncOrigin(state) {
    refs.originModal.hidden = state.demo.modal !== "origin";
  }

  function syncKingdomModal(state) {
    const mode = state.demo.modal;
    const visible = ["founding", "foundingSeal", "kingdomEdict"].includes(mode);
    refs.kingdomModal.hidden = !visible;
    if (!visible) return;
    const seal = mode === "foundingSeal";
    const edict = mode === "kingdomEdict";
    refs.kingdomSeal.hidden = !seal;
    refs.kingdomSeal.textContent = seal ? t("kingdom.seal") : "";
    refs.foundingActions.hidden = mode !== "founding";
    refs.foundingSealContinue.hidden = !seal;
    refs.edictActions.hidden = !edict;
    refs.kingdomKicker.textContent = t(edict ? "kingdom.edictKicker" : "kingdom.foundingKicker");
    refs.kingdomTitle.textContent = t(seal
      ? "kingdom.foundedTitle"
      : edict
        ? "kingdom.edictTitle"
        : "kingdom.foundingTitle");
    refs.kingdomCopy.textContent = t(seal
      ? "kingdom.foundedCopy"
      : edict
        ? "kingdom.edictCopy"
        : "kingdom.foundingCopy", {
          renown: state.player.renown,
          towns: state.player.fiefs.length,
          days: CONFIG.KINGDOM_DECISION_INTERVAL_DAYS
        });
  }

  function configurePromiseModal(state) {
    const mode = state.demo.modal;
    const visible = mode === "troopPromise" || mode === "goldPromise" || mode === "fiefPromise";
    refs.promiseModal.hidden = !visible;
    if (!visible) {
      promiseMode = null;
      return;
    }
    const troops = mode === "troopPromise";
    const fiefs = mode === "fiefPromise";
    refs.promiseKicker.textContent = t(troops
      ? "promise.act1Kicker"
      : fiefs
        ? "promise.fiefKicker"
        : "promise.act2Kicker");
    const actOne = state.player.promises.find((entry) => entry.act === 1);
    refs.promiseContext.hidden = false;
    const troopPromise = state.player.promises.find((entry) => entry.act === 1);
    const goldPromise = state.player.promises.find((entry) => entry.act === 2);
    refs.promiseContext.textContent = fiefs
      ? t("promise.fiefFiction", {
        troopsSaid: troopPromise?.statedGoal ?? 0,
        troopsDid: troopPromise?.actualAtActEnd ?? getTroopCount(state.player),
        goldSaid: goldPromise?.statedGoal ?? 0,
        goldDid: goldPromise?.actualAtActEnd ?? state.player.gold
      })
      : t(troops ? "promise.act1Fiction" : "promise.act2Fiction");
    refs.promiseQuestion.textContent = troops
      ? t("promise.troopsQuestion")
      : fiefs
        ? t("promise.fiefQuestion")
        : t("promise.goldQuestion", {
        said: actOne?.statedGoal ?? 0,
        actual: actOne?.actualAtActEnd ?? getTroopCount(state.player)
      });
    refs.promiseValue.hidden = fiefs;
    refs.promiseSlider.hidden = fiefs;
    refs.promiseMin.parentElement.hidden = fiefs;
    refs.fiefPromiseOptions.hidden = !fiefs;
    if (promiseMode !== mode) {
      promiseMode = mode;
      if (fiefs) {
        fiefPromiseValue = CONFIG.PROMISE_FIEFS_DEFAULT;
        refs.fiefPromiseButtons.forEach((button) => {
          button.setAttribute("aria-pressed", String(button.dataset.fiefPromise === String(fiefPromiseValue)));
        });
      }
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

  function syncFiefThreat(state) {
    const threat = state.demo?.fiefThreat || null;
    const visible = state.demo?.modal === "fiefThreat" && Boolean(threat);
    refs.fiefThreatModal.hidden = !visible;
    if (!visible) return;
    const town = getTown(state, threat.townId);
    const townName = town ? t(town.nameKey) : "";
    refs.fiefThreatTitle.textContent = t("fief.messengerTitle", { town: townName });
    refs.fiefThreatDetail.textContent = t("fief.messengerDetail", {
      town: townName,
      garrison: threat.garrison,
      enemy: threat.enemy
    });
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
    const fullEnding = state.ending?.mode === "full";
    state.player.promises.slice(0, fullEnding ? 3 : 2).forEach((promise) => {
      const row = document.createElement("div");
      const label = document.createElement("span");
      const said = document.createElement("strong");
      const did = document.createElement("strong");
      const actual = promise.actualAtActEnd ?? (promise.kind === "gold"
        ? state.player.gold
        : promise.kind === "fiefs"
          ? state.player.fiefs.length
          : getTroopCount(state.player));
      row.className = "mirror-row";
      if (actual > promise.statedGoal) row.classList.add("overshot");
      label.textContent = t(promise.kind === "gold"
        ? "ending.gold"
        : promise.kind === "fiefs"
          ? "ending.fiefs"
          : "ending.troops");
      said.textContent = t("ending.said", { value: promise.statedGoal });
      did.textContent = t("ending.did", { value: actual });
      row.append(label, said, did);
      refs.mirrorTable.appendChild(row);
    });
    refs.endingChronicle.replaceChildren();
    const chronicle = fullEnding
      ? buildChronicleEntries(state.telemetry, language(), { full: true })
      : buildChronicleEntries(state.telemetry, language());
    state.telemetry.endingChronicle = chronicle.map((entry) => ({ ...entry }));
    for (const entry of chronicle) {
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
    if (fullEnding) {
      const comparisons = state.player.promises.slice(0, 3).map((promise) => {
        const actual = Number(promise.actualAtActEnd);
        const goal = Number(promise.statedGoal);
        return Number.isFinite(actual) && Number.isFinite(goal) ? Math.sign(actual - goal) : 0;
      });
      const over = comparisons.filter((value) => value > 0).length;
      const under = comparisons.filter((value) => value < 0).length;
      refs.endingLine.textContent = t(over === 3
        ? "ending.lineAllOvershot"
        : under === 3
          ? "ending.lineAllHeld"
          : "ending.lineMixed");
      refs.endingSeal.textContent = t("ending.fullSeal");
    }
    refs.shareResult.hidden = desktopRuntime;
    refs.resultCode.hidden = desktopRuntime;
    refs.resultCode.textContent = desktopRuntime ? "" : buildResultCode(state);
  }

  function sync(state, runtime = {}) {
    currentState = state;
    if (typeof runtime.saveAvailable === "boolean") saveAvailable = runtime.saveAvailable;
    syncStaticStrings();

    setCounter(refs.gold, state.player.gold);
    setCounter(refs.troops, getTroopCount(state.player));
    refs.fiefStat.hidden = state.player.act < 3 && state.player.fiefs.length === 0;
    setCounter(refs.fiefs, state.player.fiefs.length);
    setCounter(refs.renown, state.player.renown);
    setCounter(refs.day, state.stats.days + 1);
    refs.wage.textContent = state.stats.days < CONFIG.WAGE_GRACE_DAYS
      ? t("hud.wageGrace", { day: CONFIG.WAGE_GRACE_DAYS })
      : t("hud.wages", { wage: getDailyWage(state.player) + fiefGarrisonWage(state) });
    const activeLieutenants = getLieutenants(state);
    refs.lieutenantChip.hidden = !(isV11State(state) && activeLieutenants.length);
    refs.lieutenantChip.innerHTML = activeLieutenants.map((entry) => (
      `<span class="lieutenant-chip-entry">${lieutenantPortrait(entry.id, "hud")}<b>${t(`lieutenant.${entry.id}Short`)}</b></span>`
    )).join("");
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

    const town = !state.paused && !state.battle && !settingsOpen && !state.demo.modal
      ? activeTown(state)
      : null;
    if (
      !town ||
      state.player.act < 2 ||
      (state.player.contract?.active && (
        !isV11State(state) ||
        getLieutenants(state).length >= (state.features?.f4 ? CONFIG.F4_LIEUTENANT_SLOTS : 1)
      ))
    ) contractsOpen = false;
    refs.townSheet.hidden = !town || contractsOpen;
    document.body.classList.toggle("town-open", Boolean(town) && !contractsOpen);
    if (town) {
      const faction = getFaction(state, town.factionId);
      const cap = actTroopCap(state);
      const troops = getTroopCount(state.player);
      const capped = troops >= cap;
      const militiaPrice = townRecruitPrice(state, town, CONFIG.RECRUIT_COST);
      const veteranPrice = townRecruitPrice(state, town, CONFIG.VETERAN_REPLENISH_COST);
      const priceStatus = [];
      if (militiaPrice.hostile) {
        priceStatus.push(t("townPanel.territoryHostile", {
          percent: Math.round((CONFIG.HOSTILE_TOWN_RECRUIT_PRICE_MULTIPLIER - 1) * 100)
        }));
      }
      if (militiaPrice.warZone) {
        priceStatus.push(t("townPanel.territoryWar", {
          percent: Math.round((CONFIG.WAR_ZONE_RECRUIT_PRICE_MULTIPLIER - 1) * 100)
        }));
      }
      refs.townName.textContent = t(town.nameKey);
      refs.townFaction.textContent = [
        t("townPanel.territory", { faction: t(faction.nameKey) }),
        ...priceStatus
      ].join(" · ");
      const recruitsEmpty = (
        town.recruitPool <= 0 && troops >= CONFIG.PLAYER_RECOVERY_RECRUIT_FLOOR
      );
      refs.recruit.disabled = capped || state.player.gold < militiaPrice.cost || recruitsEmpty;
      refs.recruitCost.textContent = capped
        ? t("townPanel.recruitCapped", { cap })
        : recruitsEmpty
          ? t("townPanel.recruitEmpty")
          : t("townPanel.recruitCost", { cost: militiaPrice.cost });
      const f3 = state.features?.f3 === true;
      const syncArmRecruit = (button, costNode, arm) => {
        button.hidden = !f3;
        if (!f3) return;
        const empty = (town.recruitPools?.[arm] || 0) <= 0
          && troops >= CONFIG.PLAYER_RECOVERY_RECRUIT_FLOOR;
        button.disabled = capped || state.player.gold < militiaPrice.cost || empty;
        costNode.textContent = capped
          ? t("townPanel.recruitCapped", { cap })
          : empty
            ? t("townPanel.recruitEmpty")
            : t("townPanel.armRecruitCost", {
              count: town.recruitPools?.[arm] || 0,
              cost: militiaPrice.cost
            });
      };
      syncArmRecruit(refs.recruitArcher, refs.recruitArcherCost, "archer");
      syncArmRecruit(refs.recruitCavalry, refs.recruitCavalryCost, "cavalry");
      if (f3) {
        const empty = (town.recruitPools?.spear || 0) <= 0
          && troops >= CONFIG.PLAYER_RECOVERY_RECRUIT_FLOOR;
        refs.recruit.disabled = capped || state.player.gold < militiaPrice.cost || empty;
        refs.recruitCost.textContent = capped
          ? t("townPanel.recruitCapped", { cap })
          : empty
            ? t("townPanel.recruitEmpty")
            : t("townPanel.armRecruitCost", {
              count: town.recruitPools?.spear || 0,
              cost: militiaPrice.cost
            });
      }
      const veteranAvailable = state.player.troops.some((stack) => stack.type === "veteran" && stack.count > 0);
      refs.veteran.hidden = state.player.act < 2;
      refs.veteran.disabled = capped || !veteranAvailable || town.recruitPool <= 0 || state.player.gold < veteranPrice.cost;
      refs.veteranCost.textContent = capped
        ? t("townPanel.recruitCapped", { cap })
        : !veteranAvailable
          ? t("townPanel.replenishUnavailable")
          : town.recruitPool <= 0
            ? t("townPanel.recruitEmpty")
            : t("townPanel.replenishCost", { cost: veteranPrice.cost });
      const buffActive = state.casual?.nextBattleAttackMultiplier > 1;
      refs.battleBuff.hidden = state.player.act < 2;
      refs.battleBuff.disabled = buffActive || state.player.gold < CONFIG.TAVERN_ATTACK_BUFF_COST;
      refs.battleBuffCost.textContent = buffActive
        ? t("townPanel.battleBuffActive")
        : t("townPanel.battleBuffCost", {
          cost: CONFIG.TAVERN_ATTACK_BUFF_COST,
          bonus: Math.round(CONFIG.TAVERN_ATTACK_BUFF_BONUS * 100)
        });
      refs.tavern.hidden = state.player.act < 2;
      if (state.player.act >= 2) {
        const activeContract = state.player.contract?.active ? state.player.contract : null;
        refs.tavern.disabled = Boolean(
          activeContract && (
            !isV11State(state) ||
            getLieutenants(state).length >= (state.features?.f4 ? CONFIG.F4_LIEUTENANT_SLOTS : 1)
          )
        );
        refs.tavernDetail.textContent = activeContract
          ? t("townPanel.contractActive", {
            contract: contractSummary(activeContract)
          })
          : t("townPanel.contractOffer");
      }
      const heldFief = state.player.fiefs.includes(town.id);
      refs.fiefGarrison.hidden = !heldFief;
      if (heldFief) {
        const garrison = town.garrison.reduce((sum, stack) => sum + stack.count, 0);
        const total = troops + garrison;
        refs.garrisonSlider.max = String(Math.max(0, total - CONFIG.FIEF_MIN_FIELD_TROOPS));
        refs.garrisonSlider.value = String(garrison);
        refs.garrisonCounts.textContent = t("fief.garrisonCounts", {
          field: troops,
          garrison
        });
      }
    }
    syncContractModal(state, town);

    refs.settingsSheet.hidden = !settingsOpen;
    refs.settingsScrim.hidden = !settingsOpen;
    refs.helpCard.hidden = !helpOpen;
    document.body.classList.toggle("settings-open", settingsOpen);
    document.body.classList.toggle("help-open", helpOpen);
    document.body.classList.toggle("act-two", state.player.act >= 2);
    document.body.classList.toggle("paused", state.paused);
    document.body.classList.toggle("demo-modal-open", Boolean(state.demo.modal) && !state.demo.ended);
    refs.languageZh.setAttribute("aria-pressed", String(language() === "zh"));
    refs.languageEn.setAttribute("aria-pressed", String(language() === "en"));
    const soundEnabled = state.settings.soundEnabled !== false;
    refs.soundButton.textContent = soundEnabled ? "声" : "静";
    refs.soundButton.setAttribute("aria-pressed", String(soundEnabled));
    refs.soundToggle.textContent = t(soundEnabled ? "settings.soundOn" : "settings.soundOff");
    refs.soundToggle.setAttribute("aria-pressed", String(soundEnabled));
    refs.autosaveStatus.textContent = saveAvailable
      ? t("settings.autosaveOn", { day: Math.floor(Math.max(0, state.lastSavedTick) / CONFIG.TICKS_PER_DAY) + 1 })
      : t("settings.autosaveUnavailable");
    syncOnboarding(state);
    syncOrigin(state);
    syncKingdomModal(state);
    configurePromiseModal(state);
    syncFiefThreat(state);
    syncRoadEvent(state);
    syncFormationModal(state);
    syncBattleCommandModal(state);
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

  function setHelpOpen(nextOpen, source = "hud") {
    const opening = Boolean(nextOpen);
    if (opening === helpOpen) return;
    helpOpen = opening;
    if (opening) {
      settingsOpen = false;
      callbacks.onHelpOpen(source);
    } else {
      callbacks.onHelpClose();
    }
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

  function showRoadEventResult(result) {
    if (!currentState) return;
    const message = formatRoadEventResult(result);
    if (!message) return;
    playRoadEventFx(result?.effectsApplied || result?.applied?.effectsApplied || result?.delta);
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

  function playRoadEventFx(effects = {}) {
    const targets = {
      gold: refs.gold,
      troops: refs.troops,
      renown: refs.renown,
      relation: refs.renown
    };
    const entries = Object.entries(targets)
      .map(([key, target]) => ({ key, target, value: Number(effects[key]) || 0 }))
      .filter((entry) => entry.value !== 0);
    if (!entries.length || motionOff()) return;

    document.body.classList.add("road-event-fx-active");
    if (roadEventFxTimer) clearTimeout(roadEventFxTimer);
    roadEventFxTimer = window.setTimeout(() => {
      roadEventFxTimer = 0;
      document.body.classList.remove("road-event-fx-active");
      updateNumberBudget();
    }, 1500);

    entries.forEach(({ key, target, value }, index) => {
      window.setTimeout(() => {
        const bounds = target.getBoundingClientRect();
        const gain = document.createElement("span");
        gain.className = "fx-renown fx-event-delta";
        gain.dataset.effectType = key;
        gain.textContent = t(`roadEvent.${key}Delta`, { value: signedEffect(value) });
        gain.style.color = value > 0 ? "var(--green-ink)" : "var(--cinnabar-deep)";
        gain.style.setProperty("--from-x", `${bounds.left + bounds.width * 0.5 - 18}px`);
        gain.style.setProperty("--from-y", `${bounds.bottom + 6}px`);
        refs.fxLayer.appendChild(gain);
        removeFx(gain, 900);
        updateNumberBudget();
      }, index * 360);
    });
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

  refs.helpButton.addEventListener("click", () => setHelpOpen(true, "hud"));
  refs.soundButton.addEventListener("click", () => callbacks.onSoundChange(currentState?.settings.soundEnabled === false));
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
  refs.soundToggle.addEventListener("click", () => callbacks.onSoundChange(currentState?.settings.soundEnabled === false));
  refs.helpClose.addEventListener("click", () => setHelpOpen(false));
  refs.recruit.addEventListener("click", () => callbacks.onRecruit("spear"));
  refs.recruitArcher.addEventListener("click", () => callbacks.onRecruit("archer"));
  refs.recruitCavalry.addEventListener("click", () => callbacks.onRecruit("cavalry"));
  refs.veteran.addEventListener("click", () => callbacks.onReplenishVeteran());
  refs.battleBuff.addEventListener("click", () => callbacks.onBuyBattleBuff());
  refs.tavern.addEventListener("click", () => {
    contractsOpen = true;
    if (currentState) sync(currentState, { saveAvailable });
  });
  const selectContract = (button) => {
    const contractId = button.dataset.contractId;
    if (!contractId) return;
    contractsOpen = false;
    callbacks.onSelectContract(contractId);
  };
  refs.contractEscort.addEventListener("click", () => selectContract(refs.contractEscort));
  refs.contractRisky.addEventListener("click", () => selectContract(refs.contractRisky));
  refs.contractWar.addEventListener("click", () => selectContract(refs.contractWar));
  refs.contractReinforce.addEventListener("click", () => selectContract(refs.contractReinforce));
  refs.contractPatrol.addEventListener("click", () => selectContract(refs.contractPatrol));
  refs.lieutenantOffers.forEach((button) => button.addEventListener("click", () => {
    contractsOpen = false;
    callbacks.onHireLieutenant(button.dataset.lieutenantId);
  }));
  refs.contractClose.addEventListener("click", () => {
    contractsOpen = false;
    if (currentState) sync(currentState, { saveAvailable });
  });
  refs.skipBattle.addEventListener("click", () => callbacks.onSkipBattle());
  refs.retreatBattle.addEventListener("click", () => callbacks.onRetreat());
  refs.onboardingCopy.addEventListener("click", () => {
    if ((currentState?.demo.onboardingStep ?? -1) >= 0) callbacks.onAdvanceOnboarding();
  });
  refs.originButtons.forEach((button) => {
    button.addEventListener("click", () => callbacks.onSelectOrigin(button.dataset.origin));
  });
  refs.onboardingTitle.addEventListener("click", toggleDiagnosticsFromTitle);
  refs.brandTitle.addEventListener("click", toggleDiagnosticsFromTitle);
  refs.titleStart.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onAdvanceOnboarding();
  });
  refs.titleRules.addEventListener("click", (event) => {
    event.stopPropagation();
    setHelpOpen(true, "title");
  });
  refs.titleNewSeed.addEventListener("click", (event) => {
    event.stopPropagation();
    callbacks.onNewSeed(false);
  });
  refs.promiseSlider.addEventListener("input", () => {
    refs.promiseValue.textContent = refs.promiseSlider.value;
  });
  refs.fiefPromiseButtons.forEach((button) => {
    button.addEventListener("click", () => {
      fiefPromiseValue = button.dataset.fiefPromise === "all"
        ? "all"
        : Number(button.dataset.fiefPromise);
      refs.fiefPromiseButtons.forEach((candidate) => {
        candidate.setAttribute("aria-pressed", String(candidate === button));
      });
    });
  });
  refs.promiseConfirm.addEventListener("click", () => callbacks.onSubmitPromise(
    promiseMode === "fiefPromise" ? fiefPromiseValue : Number(refs.promiseSlider.value)
  ));
  refs.garrisonSlider.addEventListener("input", () => {
    const town = currentState ? activeTown(currentState) : null;
    if (!town) return;
    const total = getTroopCount(currentState.player) + town.garrison.reduce((sum, stack) => sum + stack.count, 0);
    const garrison = Number(refs.garrisonSlider.value) || 0;
    refs.garrisonCounts.textContent = t("fief.garrisonCounts", {
      field: total - garrison,
      garrison
    });
  });
  refs.garrisonSlider.addEventListener("change", () => {
    const town = currentState ? activeTown(currentState) : null;
    if (town) callbacks.onSetGarrison(town.id, Number(refs.garrisonSlider.value));
  });
  refs.fiefThreatDismiss.addEventListener("click", () => callbacks.onDismissFiefThreat());
  refs.foundingAccept.addEventListener("click", () => callbacks.onFoundKingdom());
  refs.foundingDecline.addEventListener("click", () => callbacks.onDeclineFounding());
  refs.foundingSealContinue.addEventListener("click", () => callbacks.onDismissFoundingSeal());
  refs.edictContinue.addEventListener("click", () => callbacks.onKingdomEdict("continue"));
  refs.edictStop.addEventListener("click", () => callbacks.onKingdomEdict("stop"));
  refs.contextTooltip.addEventListener("click", () => { refs.contextTooltip.hidden = true; });
  refs.roadEventChoiceA.addEventListener("click", () => callbacks.onRoadEventChoice(0));
  refs.roadEventChoiceB.addEventListener("click", () => callbacks.onRoadEventChoice(1));
  [refs.formationWedge, refs.formationLine, refs.formationCircle].forEach((button) => {
    button.addEventListener("click", () => callbacks.onChooseFormation(button.dataset.formation));
  });
  refs.battleCommandButtons.forEach((button) => {
    button.addEventListener("click", () => callbacks.onChooseBattleCommand(button.dataset.battleCommand));
  });
  refs.shareResult.addEventListener("click", () => callbacks.onShare());
  refs.replay.addEventListener("click", () => callbacks.onNewSeed(true));
  refs.ending.addEventListener("scroll", updateNumberBudget, { passive: true });
  window.addEventListener("resize", updateNumberBudget, { passive: true });
  document.fonts?.ready?.then(updateNumberBudget);

  [
    refs.helpButton,
    refs.soundButton,
    refs.pause,
    refs.settingsButton,
    refs.settingsClose,
    refs.reportToggle,
    refs.languageZh,
    refs.languageEn,
    refs.soundToggle,
    refs.helpClose,
    refs.recruit,
    refs.veteran,
    refs.battleBuff,
    refs.tavern,
    refs.contractEscort,
    refs.contractRisky,
    refs.contractWar,
    refs.contractReinforce,
    refs.contractPatrol,
    ...refs.lieutenantOffers,
    refs.contractClose,
    refs.skipBattle,
    refs.retreatBattle,
    refs.titleStart,
    refs.titleRules,
    refs.titleNewSeed,
    ...refs.originButtons,
    refs.promiseSlider,
    refs.promiseConfirm,
    ...refs.fiefPromiseButtons,
    refs.garrisonSlider,
    refs.fiefThreatDismiss,
    refs.foundingAccept,
    refs.foundingDecline,
    refs.foundingSealContinue,
    refs.edictContinue,
    refs.edictStop,
    refs.contextTooltip,
    refs.roadEventChoiceA,
    refs.roadEventChoiceB,
    refs.formationWedge,
    refs.formationLine,
    refs.formationCircle,
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
    isHelpOpen: () => helpOpen,
    closeSettings: () => setSettingsOpen(false)
  };
}

import { FACTION_DATA, TOWN_DATA } from "./data.js";
import { translate } from "./strings.js";

const PRIORITY = Object.freeze({
  firstWin: 100,
  troopsCrossing: 95,
  firstContract: 90,
  goldCrossing: 85,
  fiefGranted: 84,
  fiefThreat: 83,
  fiefLost: 98,
  fiefRecaptured: 97,
  origin: 48,
  fiefExpanded: 82,
  founded: 99,
  coalition: 78,
  rebellion: 96,
  edictContinue: 88,
  edictStop: 100,
  lieutenantHired: 76,
  lieutenantLeft: 94,
  biggestBattle: 80,
  act3: 75,
  act2: 70,
  ending: 60,
  start: 50
});

function localizedName(language, group, id, fallback) {
  if (!id) return fallback;
  const collection = group === "towns" ? TOWN_DATA : FACTION_DATA;
  const key = collection.find((entry) => entry.id === id)?.nameKey;
  if (!key) return fallback;
  const value = translate(language, key);
  return value === key ? fallback : value;
}

function candidate(type, value) {
  return value && typeof value === "object" ? { type, ...value } : null;
}

function lineFor(language, entry) {
  const t = (key, parameters = {}) => translate(language, key, parameters);
  const day = Math.max(1, Math.floor(Number(entry.day) || 1));
  switch (entry.type) {
    case "firstWin":
      return t("ending.chronicleFirstWin", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "firstContract":
      return t("ending.chronicleFirstContract", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace")),
        faction: localizedName(language, "factions", entry.factionId, t("ending.chronicleUnknownFaction"))
      });
    case "troopsCrossing":
      return t("ending.chronicleTroopsCrossing", { day, goal: entry.statedGoal });
    case "goldCrossing":
      return t("ending.chronicleGoldCrossing", { day, goal: entry.statedGoal });
    case "fiefGranted":
      return t("ending.chronicleFiefGranted", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "fiefThreat":
      return t("ending.chronicleFiefThreat", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "fiefLost":
      return t("ending.chronicleFiefLost", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "fiefRecaptured":
      return t("ending.chronicleFiefRecaptured", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "origin":
      return t("ending.chronicleOrigin", {
        day,
        origin: t(`origin.${entry.originId || "wanderer"}Title`)
      });
    case "fiefExpanded":
      return t("ending.chronicleFiefExpanded", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "founded":
      return t("ending.chronicleFounded", { day });
    case "coalition":
      return t("ending.chronicleCoalition", {
        day,
        wave: Math.max(1, Math.floor(Number(entry.wave) || 1)),
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "rebellion":
      return t("ending.chronicleRebellion", {
        day,
        town: localizedName(language, "towns", entry.townId, t("ending.chronicleUnknownPlace"))
      });
    case "edictContinue":
      return t("ending.chronicleEdictContinue", { day });
    case "edictStop":
      return t("ending.chronicleEdictStop", { day });
    case "lieutenantHired":
      return t("ending.chronicleLieutenantHired", {
        day,
        lieutenant: t(`lieutenant.${entry.lieutenantId || "chen_mang"}Name`)
      });
    case "lieutenantLeft":
      return t("ending.chronicleLieutenantLeft", {
        day,
        lieutenant: t(`lieutenant.${entry.lieutenantId || "chen_mang"}Name`)
      });
    case "biggestBattle":
      return t("ending.chronicleBiggestBattle", {
        day,
        player: Math.max(0, Math.floor(Number(entry.playerStart) || 0)),
        enemy: Math.max(0, Math.floor(Number(entry.enemyStart) || 0))
      });
    case "act2":
      return t("ending.chronicleAct2", { day });
    case "act3":
      return t("ending.chronicleFiefAct", { day });
    case "ending":
      return t("ending.chronicleEnding", { day });
    case "start":
      return t("ending.chronicleStart", { day });
    default:
      return "";
  }
}

export function buildChronicleEntries(telemetry, language = "zh", options = {}) {
  const chronicle = telemetry?.chronicle || {};
  const crossings = telemetry?.promiseCrossings || {};
  const candidates = [
    candidate("firstWin", chronicle.firstWin),
    candidate("firstContract", chronicle.firstContract),
    candidate("troopsCrossing", crossings.troops),
    candidate("goldCrossing", crossings.gold),
    candidate("fiefGranted", chronicle.fiefGranted),
    candidate("fiefThreat", chronicle.fiefThreat),
    candidate("fiefLost", chronicle.fiefLost),
    candidate("fiefRecaptured", chronicle.fiefRecaptured),
    candidate("biggestBattle", chronicle.biggestBattle),
    candidate("act2", chronicle.act2),
    candidate("act3", chronicle.act3),
    candidate("ending", chronicle.ending),
    telemetry?.actTimestamps?.act1 ? candidate("start", { tick: 0, day: 1 }) : null,
    ...(options.full && Array.isArray(telemetry?.chronicleEvents)
      ? telemetry.chronicleEvents
        .filter((entry) => Object.hasOwn(PRIORITY, entry.kind))
        .map((entry) => candidate(entry.kind, entry))
      : [])
  ].filter(Boolean);

  const limit = options.full ? 12 : 5;

  const selected = candidates
    .slice()
    .sort((first, second) => (
      PRIORITY[second.type] - PRIORITY[first.type] ||
      (Number(first.tick) || 0) - (Number(second.tick) || 0) ||
      first.type.localeCompare(second.type)
    ))
    .slice(0, limit)
    .sort((first, second) => (
      (Number(first.tick) || 0) - (Number(second.tick) || 0) ||
      PRIORITY[second.type] - PRIORITY[first.type] ||
      first.type.localeCompare(second.type)
    ));

  return selected.map((entry) => ({
    type: entry.type,
    tick: Math.max(0, Math.floor(Number(entry.tick) || 0)),
    day: Math.max(1, Math.floor(Number(entry.day) || 1)),
    text: lineFor(language, entry)
  })).filter((entry) => entry.text);
}

export function buildChronicleLines(telemetry, language = "zh", options = {}) {
  return buildChronicleEntries(telemetry, language, options).map((entry) => entry.text);
}

import { CONFIG } from "./data.js";
import { translate } from "./strings.js";

const CODE_PREFIX = "crown1.";

function nowIso() {
  return new Date().toISOString();
}

export function createTelemetry(options = {}) {
  const startedAt = options.startedAt || null;
  return {
    sessionStart: startedAt,
    sessionEnd: null,
    totalActiveSeconds: 0,
    battlesFought: 0,
    battlesWon: 0,
    battlesFled: 0,
    townEntries: 0,
    recruitClicks: 0,
    eventChoices: [],
    promiseValues: { troops: null, gold: null },
    promiseFinalActuals: { troops: null, gold: null },
    promiseCrossings: { troops: null, gold: null },
    chronicle: {
      firstWin: null,
      firstContract: null,
      biggestBattle: null,
      act2: null,
      ending: null
    },
    actTimestamps: { act1: startedAt, act2: null, ending: null },
    quitPoint: null,
    tooltipViews: { town: 0, lowGold: 0, act2: 0 },
    replayCount: Math.max(0, Number(options.replayCount) || 0)
  };
}

export function startTelemetrySession(state, startedAt = nowIso()) {
  if (!state?.telemetry) return null;
  state.telemetry.sessionStart ||= startedAt;
  state.telemetry.actTimestamps.act1 ||= state.telemetry.sessionStart;
  return state.telemetry.sessionStart;
}

export function normalizeTelemetry(value, options = {}) {
  const fallback = createTelemetry(options);
  if (!value || typeof value !== "object") return fallback;
  const normalized = {
    ...fallback,
    ...value,
    eventChoices: Array.isArray(value.eventChoices)
      ? value.eventChoices.slice(-CONFIG.ROAD_EVENT_HISTORY_LIMIT)
      : [],
    promiseValues: { ...fallback.promiseValues, ...(value.promiseValues || {}) },
    promiseFinalActuals: { ...fallback.promiseFinalActuals, ...(value.promiseFinalActuals || {}) },
    promiseCrossings: { ...fallback.promiseCrossings, ...(value.promiseCrossings || {}) },
    chronicle: { ...fallback.chronicle, ...(value.chronicle || {}) },
    actTimestamps: { ...fallback.actTimestamps, ...(value.actTimestamps || {}) },
    tooltipViews: { ...fallback.tooltipViews, ...(value.tooltipViews || {}) }
  };
  [
    "totalActiveSeconds",
    "battlesFought",
    "battlesWon",
    "battlesFled",
    "townEntries",
    "recruitClicks",
    "replayCount"
  ].forEach((key) => {
    normalized[key] = Math.max(0, Number(normalized[key]) || 0);
  });
  return normalized;
}

function telemetryMoment(state, tick = state?.tick) {
  const normalizedTick = Math.max(0, Math.floor(Number(tick) || 0));
  const currentTick = Math.max(0, Math.floor(Number(state?.tick) || 0));
  const activeSeconds = normalizedTick === currentTick
    ? Math.max(0, Number(state?.telemetry?.totalActiveSeconds) || 0)
    : normalizedTick * CONFIG.LOGIC_MS / 1000;
  const sessionStart = Date.parse(state?.telemetry?.sessionStart || "");
  return {
    tick: normalizedTick,
    day: Math.floor(normalizedTick / CONFIG.TICKS_PER_DAY) + 1,
    activeSeconds: Number(activeSeconds.toFixed(3)),
    at: Number.isFinite(sessionStart)
      ? new Date(sessionStart + activeSeconds * 1000).toISOString()
      : null
  };
}

function ensureNarrativeTelemetry(state) {
  if (!state?.telemetry) return null;
  state.telemetry.promiseCrossings = {
    troops: null,
    gold: null,
    ...(state.telemetry.promiseCrossings || {})
  };
  state.telemetry.chronicle = {
    firstWin: null,
    firstContract: null,
    biggestBattle: null,
    act2: null,
    ending: null,
    ...(state.telemetry.chronicle || {})
  };
  return state.telemetry;
}

export function recordPromiseCrossing(state, kind, details = {}) {
  const telemetry = ensureNarrativeTelemetry(state);
  if (!telemetry || !Object.hasOwn(telemetry.promiseCrossings, kind)) return null;
  if (telemetry.promiseCrossings[kind]) return telemetry.promiseCrossings[kind];
  const actual = details.actual === null || details.actual === undefined
    ? null
    : Number(details.actual);
  const statedGoal = details.statedGoal === null || details.statedGoal === undefined
    ? null
    : Number(details.statedGoal);
  const crossing = {
    ...telemetryMoment(state, details.tick),
    statedGoal: Number.isFinite(statedGoal) ? statedGoal : null,
    actual: Number.isFinite(actual) ? actual : null
  };
  telemetry.promiseCrossings[kind] = crossing;
  return crossing;
}

export function recordChronicleMilestone(state, kind, details = {}) {
  const telemetry = ensureNarrativeTelemetry(state);
  if (!telemetry || !Object.hasOwn(telemetry.chronicle, kind) || kind === "biggestBattle") return null;
  if (telemetry.chronicle[kind]) return telemetry.chronicle[kind];
  const entry = { ...telemetryMoment(state, details.tick), ...details };
  telemetry.chronicle[kind] = entry;
  return entry;
}

export function recordBiggestBattle(state, details = {}) {
  const telemetry = ensureNarrativeTelemetry(state);
  if (!telemetry) return null;
  const playerStart = Math.max(0, Math.floor(Number(details.playerStart) || 0));
  const enemyStart = Math.max(0, Math.floor(Number(details.enemyStart) || 0));
  const totalStart = playerStart + enemyStart;
  const previous = telemetry.chronicle.biggestBattle;
  if (previous && Number(previous.totalStart) >= totalStart) return previous;
  const entry = {
    ...telemetryMoment(state, details.tick),
    banditId: details.banditId || null,
    townId: details.townId || null,
    playerStart,
    enemyStart,
    totalStart,
    elite: Boolean(details.elite),
    outcome: null
  };
  telemetry.chronicle.biggestBattle = entry;
  return entry;
}

export function recordBattleOutcome(state, details = {}) {
  const telemetry = ensureNarrativeTelemetry(state);
  if (!telemetry) return null;
  const biggest = telemetry.chronicle.biggestBattle;
  const battleTick = Math.max(0, Math.floor(Number(details.tick) || 0));
  if (
    biggest &&
    biggest.tick === battleTick &&
    (!biggest.banditId || !details.banditId || biggest.banditId === details.banditId)
  ) {
    biggest.outcome = details.outcome || null;
  }
  if (details.outcome === "victory" && !telemetry.chronicle.firstWin) {
    telemetry.chronicle.firstWin = {
      ...telemetryMoment(state, battleTick),
      banditId: details.banditId || null,
      townId: details.townId || null,
      playerStart: Math.max(0, Math.floor(Number(details.playerStart) || 0)),
      enemyStart: Math.max(0, Math.floor(Number(details.enemyStart) || 0)),
      elite: Boolean(details.elite)
    };
  }
  return biggest;
}

export function recordActiveTime(state, elapsedMilliseconds) {
  if (!state?.telemetry || !Number.isFinite(elapsedMilliseconds) || elapsedMilliseconds <= 0) return;
  const next = state.telemetry.totalActiveSeconds + elapsedMilliseconds / 1000;
  state.telemetry.totalActiveSeconds = Number(next.toFixed(3));
}

export function recordQuitPoint(state, screen = "world") {
  if (!state?.telemetry) return null;
  state.telemetry.quitPoint = {
    at: nowIso(),
    act: state.player?.act || 1,
    tick: state.tick || 0,
    renown: state.player?.renown || 0,
    screen
  };
  return state.telemetry.quitPoint;
}

export function finalizeTelemetry(state, endedAt = nowIso()) {
  if (!state?.telemetry) return;
  state.telemetry.sessionEnd ||= endedAt;
  state.telemetry.actTimestamps.ending ||= endedAt;
  const troopPromise = state.player.promises.find((entry) => entry.act === 1);
  const goldPromise = state.player.promises.find((entry) => entry.act === 2);
  state.telemetry.promiseValues.troops = troopPromise?.statedGoal ?? null;
  state.telemetry.promiseValues.gold = goldPromise?.statedGoal ?? null;
  state.telemetry.promiseFinalActuals.troops = troopPromise?.actualAtActEnd ?? null;
  state.telemetry.promiseFinalActuals.gold = goldPromise?.actualAtActEnd ?? null;
  for (const promise of [troopPromise, goldPromise]) {
    if (!promise?.exceeded) continue;
    recordPromiseCrossing(state, promise.kind, {
      tick: promise.exceededAtTick,
      statedGoal: promise.statedGoal,
      actual: null
    });
  }
}

export function buildPlaytestPayload(state) {
  const battles = Math.max(0, Number(state.stats?.battles) || 0);
  const wins = Math.max(0, Number(state.stats?.wins) || 0);
  return {
    version: 1,
    build: CONFIG.BUILD_VERSION,
    seed: state.seed,
    telemetry: { ...state.telemetry },
    promises: state.player.promises.map((entry) => ({
      act: entry.act,
      kind: entry.kind,
      statedGoal: entry.statedGoal,
      actualAtActEnd: entry.actualAtActEnd,
      exceeded: Boolean(entry.exceeded),
      exceededAtTick: entry.exceededAtTick ?? null
    })),
    stats: {
      days: state.stats?.days || 0,
      battles,
      wins,
      winRate: battles ? Number((wins / battles).toFixed(4)) : 0,
      kills: state.stats?.kills || 0,
      goldEarned: state.stats?.goldEarned || 0,
      peakTroops: state.stats?.peakTroops || 0,
      peakGold: state.stats?.peakGold || 0
    }
  };
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToBytes(encoded) {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export function encodeCrownCode(payload) {
  const json = JSON.stringify(payload);
  return `${CODE_PREFIX}${bytesToBase64(new TextEncoder().encode(json))}`;
}

export function decodeCrownCode(input) {
  const text = String(input || "").trim();
  const prefixAt = text.indexOf(CODE_PREFIX);
  if (prefixAt < 0) throw new Error("code-prefix");
  const encoded = text.slice(prefixAt + CODE_PREFIX.length).split(/\s/)[0];
  if (!encoded) throw new Error("code-empty");
  const payload = JSON.parse(new TextDecoder().decode(base64ToBytes(encoded)));
  if (!payload || payload.version !== 1 || !payload.telemetry || !payload.stats) {
    throw new Error("code-schema");
  }
  return payload;
}

export function buildResultCode(state) {
  return encodeCrownCode(buildPlaytestPayload(state));
}

export function buildShareMessage(state, language = "zh") {
  const code = buildResultCode(state);
  return translate(language, "ending.shareMessage", { payload: code.slice(CODE_PREFIX.length) });
}

export function encodeShare(payload, language = "zh") {
  const code = encodeCrownCode(payload);
  return translate(language, "ending.shareMessage", { payload: code.slice(CODE_PREFIX.length) });
}

export function decodeShare(input) {
  return decodeCrownCode(input);
}

async function copyWithFallback(text, navigatorObject, documentObject) {
  if (navigatorObject?.clipboard?.writeText) {
    try {
      await navigatorObject.clipboard.writeText(text);
      return true;
    } catch {
      // Older iOS versions expose Clipboard but reject it outside HTTPS.
    }
  }
  if (!documentObject?.body || typeof documentObject.execCommand !== "function") return false;
  const textarea = documentObject.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  documentObject.body.appendChild(textarea);
  textarea.select();
  textarea.setSelectionRange(0, textarea.value.length);
  let copied = false;
  try {
    copied = documentObject.execCommand("copy");
  } catch {
    copied = false;
  }
  textarea.remove();
  return copied;
}

export async function sharePlaytestResult(state, language = "zh", environment = {}) {
  const navigatorObject = environment.navigator || globalThis.navigator;
  const documentObject = environment.document || globalThis.document;
  const message = buildShareMessage(state, language);
  let shared = false;
  let cancelled = false;
  if (typeof navigatorObject?.share === "function") {
    try {
      await navigatorObject.share({
        title: translate(language, "ending.shareTitle"),
        text: message
      });
      shared = true;
    } catch (error) {
      cancelled = error?.name === "AbortError";
    }
  }
  const copied = shared ? false : await copyWithFallback(message, navigatorObject, documentObject);
  return { message, copied, shared, cancelled };
}

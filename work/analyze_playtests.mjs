import { readFileSync } from "node:fs";

function decode(code) {
  const match = String(code).trim().match(/crown[12]\.([A-Za-z0-9+/=_-]+)/);
  if (!match) return null;
  const normalized = match[1].replace(/-/g, "+").replace(/_/g, "/");
  try {
    return JSON.parse(Buffer.from(normalized, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function counts(values) {
  const grouped = values.reduce((map, value) => {
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map());
  return Object.fromEntries(
    [...grouped].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0]))
  );
}

const source = process.argv[2] ? readFileSync(process.argv[2], "utf8") : readFileSync(0, "utf8");
const payloads = source.split(/\r?\n/).map(decode).filter(Boolean);
if (!payloads.length) {
  console.error("No valid crown1/crown2 codes found.");
  process.exitCode = 1;
} else {
  const telemetry = payloads.map((payload) => payload.telemetry || {});
  const numericDurations = telemetry
    .map((entry) => Number(entry.totalActiveSeconds))
    .filter(Number.isFinite);
  const promise = (kind) => payloads
    .map((payload) => payload.promises?.find((entry) => entry.kind === kind)?.statedGoal)
    .filter(Number.isFinite);
  const tooltipRate = (key) => Number((
    telemetry.filter((entry) => Number(entry.tooltipViews?.[key]) > 0).length / telemetry.length
  ).toFixed(3));
  const promiseSummary = (kind) => ({
    median: median(promise(kind)),
    values: counts(promise(kind).map(String))
  });

  console.log(JSON.stringify({
    sessions: payloads.length,
    quitPoints: counts(telemetry.map((entry) => (
      `${entry.quitPoint?.act || "?"}:${entry.quitPoint?.screen || "unknown"}`
    ))),
    sessionSeconds: {
      median: median(numericDurations),
      minimum: numericDurations.length ? Math.min(...numericDurations) : null,
      maximum: numericDurations.length ? Math.max(...numericDurations) : null
    },
    tooltipViewRate: {
      town: tooltipRate("town"),
      lowGold: tooltipRate("lowGold"),
      act2: tooltipRate("act2")
    },
    promises: {
      troops: promiseSummary("troops"),
      gold: promiseSummary("gold"),
      fiefs: promiseSummary("fiefs")
    }
  }, null, 2));
}


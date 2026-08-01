import { decodeCrownCode } from "./telemetry.js";
import { translate } from "./strings.js";

const language = "zh";
const t = (key, parameters) => translate(language, key, parameters);
const refs = {
  seal: document.getElementById("decode-seal"),
  title: document.getElementById("decode-title"),
  description: document.getElementById("decode-description"),
  form: document.getElementById("decode-form"),
  input: document.getElementById("decode-input"),
  button: document.getElementById("decode-button"),
  error: document.getElementById("decode-error"),
  output: document.getElementById("decode-output"),
  runHeading: document.getElementById("run-heading"),
  telemetryHeading: document.getElementById("telemetry-heading"),
  statsHeading: document.getElementById("stats-heading"),
  runTable: document.getElementById("run-table"),
  telemetryTable: document.getElementById("telemetry-table"),
  statsTable: document.getElementById("stats-table")
};

document.documentElement.lang = "zh-CN";
document.title = t("decode.title");
document.querySelector('meta[name="description"]').content = t("decode.description");
refs.title.textContent = t("decode.title");
refs.seal.textContent = t("decode.seal");
refs.description.textContent = t("decode.description");
refs.input.placeholder = t("decode.placeholder");
refs.button.textContent = t("decode.button");
refs.runHeading.textContent = t("decode.sectionRun");
refs.telemetryHeading.textContent = t("decode.sectionTelemetry");
refs.statsHeading.textContent = t("decode.sectionStats");

function appendRow(table, key, value) {
  const row = document.createElement("tr");
  const heading = document.createElement("th");
  const cell = document.createElement("td");
  heading.scope = "row";
  heading.textContent = key;
  cell.textContent = value === null ? "—" : typeof value === "object" ? JSON.stringify(value) : String(value);
  row.append(heading, cell);
  table.appendChild(row);
}

function flatten(value, prefix = "", rows = []) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    rows.push([prefix, value]);
    return rows;
  }
  Object.entries(value).forEach(([key, entry]) => flatten(entry, prefix ? `${prefix}.${key}` : key, rows));
  return rows;
}

function renderPayload(payload) {
  refs.runTable.replaceChildren();
  refs.telemetryTable.replaceChildren();
  refs.statsTable.replaceChildren();
  appendRow(refs.runTable, "version", payload.version);
  appendRow(refs.runTable, "build", payload.build);
  appendRow(refs.runTable, "seed", payload.seed);
  appendRow(refs.runTable, "promises", payload.promises);
  flatten(payload.telemetry).forEach(([key, value]) => appendRow(refs.telemetryTable, key, value));
  flatten(payload.stats).forEach(([key, value]) => appendRow(refs.statsTable, key, value));
  refs.error.hidden = true;
  refs.output.hidden = false;
}

refs.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = refs.input.value.trim();
  if (!code) {
    refs.error.textContent = t("decode.empty");
    refs.error.hidden = false;
    refs.output.hidden = true;
    return;
  }
  try {
    renderPayload(decodeCrownCode(code));
  } catch {
    refs.error.textContent = t("decode.invalid");
    refs.error.hidden = false;
    refs.output.hidden = true;
  }
});

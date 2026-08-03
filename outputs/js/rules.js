/*
 * The rules card. A reference sheet, not a tutorial.
 *
 * A real player finished a whole run and said she never understood the rules.
 * Onboarding exists, but it goes past once and is gone. This is the opposite:
 * always reachable, one screen, no flow, no progress, nothing to dismiss
 * before playing. It explains only what the player can already act on.
 *
 * Mirror discipline holds here too: it states how the game works. It never
 * tells the player what to do or judges what they did.
 */
import { play, isMuted, setMuted, unlock } from "./audio.js";

const SECTIONS = ["march", "arms", "battle", "mirror", "builds"];

let root = null;
let chip = null;

function card(translate) {
  const rows = SECTIONS.map((key) => (
    `<section class="rules-row">` +
    `<h3>${translate(`rules.${key}Title`)}</h3>` +
    `<p>${translate(`rules.${key}Body`)}</p>` +
    `</section>`
  )).join("");
  return (
    `<div class="rules-sheet" role="dialog" aria-modal="true" aria-label="${translate("rules.title")}">` +
    `<header class="rules-head"><b>${translate("rules.title")}</b>` +
    `<button type="button" class="rules-close" aria-label="${translate("rules.close")}">×</button></header>` +
    rows +
    `<footer class="rules-foot"><button type="button" class="rules-mute"></button></footer>` +
    `</div>`
  );
}

function syncMute(translate) {
  const button = root?.querySelector(".rules-mute");
  if (!button) return;
  button.textContent = translate(isMuted() ? "rules.soundOff" : "rules.soundOn");
  button.setAttribute("aria-pressed", isMuted() ? "true" : "false");
}

export function isOpen() {
  return Boolean(root && !root.hidden);
}

export function openRules(translate) {
  if (!root) return;
  root.hidden = false;
  root.classList.add("is-open");
  syncMute(translate);
  play("card");
}

export function closeRules() {
  if (!root) return;
  root.hidden = true;
  root.classList.remove("is-open");
}

/**
 * @param {(key: string) => string} translate
 * @param {{ label?: string }} [options]
 */
export function mountRules(translate, options = {}) {
  if (typeof document === "undefined" || root) return root;

  chip = document.createElement("button");
  chip.type = "button";
  chip.id = "rules-chip";
  chip.className = "rules-chip";
  chip.textContent = "?";
  chip.setAttribute("aria-label", options.label || translate("rules.open"));

  root = document.createElement("div");
  root.id = "rules-layer";
  root.className = "rules-layer";
  root.hidden = true;
  root.innerHTML = card(translate);

  document.body.appendChild(chip);
  document.body.appendChild(root);

  // Every entry point is a user gesture, which is exactly where the browser
  // lets an AudioContext be created. Nothing is created before this.
  chip.addEventListener("click", () => { unlock(); openRules(translate); });
  root.addEventListener("click", (event) => {
    if (event.target === root || event.target.closest(".rules-close")) closeRules();
  });
  root.querySelector(".rules-mute").addEventListener("click", () => {
    unlock();
    setMuted(!isMuted());
    syncMute(translate);
    play("tap");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isOpen()) closeRules();
  });
  return root;
}

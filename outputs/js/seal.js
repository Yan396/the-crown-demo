/*
 * 朱印 — the signature mark.
 *
 * A square vermilion seal that stamps onto the screen with a scale-and-rotate
 * settle. Deliberately rationed: it fires on battle resolution only. Its other
 * specified uses (act transitions, town capture, war declaration, the two
 * endings) do not exist in this build yet, and spending the device on lesser
 * moments is exactly what would make it stop meaning anything.
 */

// Import-safe outside a browser; the suite smoke-imports every module in Node.
const reducedMotion = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

let host = null;

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.createElement("div");
  host.id = "seal-layer";
  host.setAttribute("aria-hidden", "true");
  document.body.appendChild(host);
  return host;
}

/**
 * @param {string} text 2-4 characters. Two sit side by side, four in a 2x2
 *   block, which is how a real seal of each length is cut.
 * @param {{ tone?: "default"|"loss", hold?: number }} [options]
 */
export function stampSeal(text, options = {}) {
  const characters = Array.from(String(text)).slice(0, 4);
  if (!characters.length) return;

  const layer = ensureHost();
  const seal = document.createElement("div");
  seal.className = "seal";
  if (characters.length > 2) seal.classList.add("seal-quad");
  if (options.tone === "loss") seal.classList.add("seal-loss");

  // The border is drawn, not a CSS box: a cut seal has an uneven rim.
  seal.innerHTML =
    '<svg class="seal-rim" viewBox="0 0 100 100" aria-hidden="true" focusable="false">' +
    '<rect x="3.5" y="3.5" width="93" height="93" rx="2"/>' +
    '<rect x="9" y="9" width="82" height="82" rx="1"/>' +
    '</svg>';

  const glyphs = document.createElement("div");
  glyphs.className = "seal-glyphs";
  characters.forEach((character) => {
    const cell = document.createElement("span");
    cell.textContent = character;
    glyphs.appendChild(cell);
  });
  seal.appendChild(glyphs);
  layer.appendChild(seal);

  const hold = options.hold ?? 1100;
  if (reducedMotion.matches) {
    // No stamp, no rotation: it simply appears and leaves.
    seal.classList.add("is-static");
    window.setTimeout(() => seal.remove(), hold);
    return;
  }

  seal.classList.add("is-stamping");
  window.setTimeout(() => {
    seal.classList.add("is-leaving");
    window.setTimeout(() => seal.remove(), 320);
  }, hold);
}

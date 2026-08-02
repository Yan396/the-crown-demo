const FRAME = '<rect x="3" y="3" width="58" height="58" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path class="portrait-accent" d="M7 8h13v3H7z"/>';

const DRAW = Object.freeze({
  chen_mang: '<path d="M23 23q9-9 18 0l4 28H19z"/><circle cx="32" cy="17" r="9"/><path d="M28 8q4-10 8 0l-2 3h-5z"/><path class="portrait-accent" d="M20 35q12 6 24 0v7q-12 6-24 0z"/><path d="m17 54 31-39 3 3-30 39z"/>',
  shen_wen: '<path d="M21 25q11-8 22 0l3 27H18z"/><circle cx="32" cy="18" r="9"/><path class="portrait-accent" d="M21 12q11-7 22 0l-2 5q-9-4-18 0z"/><path d="M16 33q16-8 32 0v16q-16 8-32 0z"/><path fill="var(--paper,#e8dcc3)" d="M23 37h18v9H23z"/>',
  jia_duojin: '<path d="M19 27q13-9 26 0l2 25H17z"/><circle cx="32" cy="18" r="11"/><path d="M22 12q10-10 20 0l-3 2q-7-5-14 0z"/><circle class="portrait-accent" cx="43" cy="42" r="8"/><rect x="40" y="39" width="6" height="6" fill="var(--paper,#e8dcc3)"/>'
});

export function lieutenantPortrait(id, className = "") {
  const drawing = DRAW[id];
  if (!drawing) return "";
  return `<svg class="lieutenant-portrait ${className}" data-lieutenant="${id}" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><g fill="currentColor">${FRAME}${drawing}</g></svg>`;
}

export const LIEUTENANT_PORTRAIT_IDS = Object.freeze(Object.keys(DRAW));

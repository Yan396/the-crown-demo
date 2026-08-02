import { CONFIG } from "./data.js";

const DEFAULT_KEYS = Object.freeze([
  CONFIG.SAVE_KEY,
  CONFIG.V11_SAVE_KEY,
  "the-crown.stage-hint-seen"
]);

function runtimeWindow(candidate) {
  return candidate || (typeof window === "undefined" ? null : window);
}

function isOwnTauriLocation(target) {
  const protocol = target?.location?.protocol;
  const hostname = target?.location?.hostname;
  return protocol === "tauri:" || hostname === "tauri.localhost";
}

export function desktopInvoke(candidate) {
  const target = runtimeWindow(candidate);
  // The Codex in-app browser and other embedders may themselves be Tauri apps.
  // Only trust the bridge when this document is served by our wrapper origin.
  if (!isOwnTauriLocation(target)) return null;
  const invoke = target?.__TAURI__?.core?.invoke || target?.__TAURI_INTERNALS__?.invoke;
  return typeof invoke === "function" ? invoke.bind(target.__TAURI__?.core || target.__TAURI_INTERNALS__) : null;
}

export function isDesktopRuntime(candidate) {
  return Boolean(desktopInvoke(candidate));
}

function browserStorage(candidate) {
  try {
    return runtimeWindow(candidate)?.localStorage || null;
  } catch {
    return null;
  }
}

/**
 * Hydrates Tauri's asynchronous file store once, then exposes the same small,
 * synchronous Storage surface already consumed by state.js. Writes are
 * serialized in the background; callers can await `flush()` in desktop tests.
 */
export async function createStorageAdapter(options = {}) {
  const target = runtimeWindow(options.windowObject);
  const invoke = options.invoke || desktopInvoke(target);
  if (!invoke) return browserStorage(target);

  const cache = new Map();
  const keys = [...new Set(options.keys || DEFAULT_KEYS)];
  await Promise.all(keys.map(async (key) => {
    try {
      const value = await invoke("load_state", { key });
      if (typeof value === "string") cache.set(key, value);
    } catch {
      // One corrupt or missing file must never prevent a new campaign.
    }
  }));

  let pending = Promise.resolve();
  let lastError = null;
  const enqueue = (command, args) => {
    pending = pending
      .catch(() => undefined)
      .then(() => invoke(command, args))
      .catch((error) => { lastError = error; });
  };

  return {
    getItem(key) {
      return cache.has(String(key)) ? cache.get(String(key)) : null;
    },
    setItem(key, value) {
      const normalizedKey = String(key);
      const normalizedValue = String(value);
      cache.set(normalizedKey, normalizedValue);
      enqueue("save_state", { key: normalizedKey, value: normalizedValue });
    },
    removeItem(key) {
      const normalizedKey = String(key);
      cache.delete(normalizedKey);
      enqueue("remove_state", { key: normalizedKey });
    },
    async flush() {
      await pending;
      if (lastError) throw lastError;
    }
  };
}

export async function setDesktopFullscreen(fullscreen, candidate) {
  const invoke = desktopInvoke(candidate);
  if (!invoke) return false;
  await invoke("set_fullscreen", { fullscreen: Boolean(fullscreen) });
  return true;
}

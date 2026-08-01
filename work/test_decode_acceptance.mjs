import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { test } from "node:test";
import { TextDecoder, TextEncoder } from "node:util";

const decodeHtmlUrl = new URL("../outputs/decode.html", import.meta.url);
const decodeModuleUrl = new URL("../outputs/js/decode.js", import.meta.url);
const html = await readFile(decodeHtmlUrl, "utf8");

const sideEffects = {
  fetch: [],
  xhr: [],
  webSocket: [],
  eventSource: [],
  beacon: [],
  resource: [],
  navigation: [],
  htmlWrites: [],
  scriptExecution: []
};

function record(kind, detail) {
  sideEffects[kind].push(String(detail ?? ""));
}

function externalResource(value) {
  return /^(?:https?:|\/\/|data:|javascript:)/i.test(String(value).trim());
}

class StubElement {
  constructor(tagName, ownerDocument, attributes = {}) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.children = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this._textContent = "";
    this._innerHTML = "";
    this.hidden = Boolean(attributes.hidden);
    this.id = attributes.id || "";
    this.value = "";
    this.placeholder = "";
    this.content = attributes.content || "";
    this.scope = "";
    this.style = {};
  }

  get textContent() {
    if (this.children.length) return this.children.map((child) => child.textContent ?? String(child)).join("");
    return this._textContent;
  }

  set textContent(value) {
    this._textContent = value == null ? "" : String(value);
    this._innerHTML = "";
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set innerHTML(value) {
    const htmlValue = String(value ?? "");
    this._innerHTML = htmlValue;
    this._textContent = "";
    this.children = [];
    record("htmlWrites", `${this.tagName}:${htmlValue}`);
    if (/<\s*script\b|\bon\w+\s*=|javascript:/i.test(htmlValue)) {
      record("scriptExecution", htmlValue);
    }
    for (const match of htmlValue.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      if (externalResource(match[1])) record("resource", match[1]);
    }
  }

  append(...nodes) {
    for (const node of nodes) {
      const child = typeof node === "string" ? new StubText(node) : node;
      child.parentNode = this;
      this.children.push(child);
    }
  }

  appendChild(node) {
    this.append(node);
    return node;
  }

  replaceChildren(...nodes) {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this._textContent = "";
    this._innerHTML = "";
    this.append(...nodes);
  }

  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }

  dispatchEvent(event) {
    event.target ??= this;
    event.currentTarget = this;
    for (const listener of this.listeners.get(event.type) || []) listener.call(this, event);
    return !event.defaultPrevented;
  }

  setAttribute(name, value) {
    const normalizedName = String(name).toLowerCase();
    const normalizedValue = String(value);
    this.attributes.set(normalizedName, normalizedValue);
    if ((normalizedName === "src" || normalizedName === "href") && externalResource(normalizedValue)) {
      record("resource", normalizedValue);
    }
  }

  insertAdjacentHTML(position, value) {
    record("htmlWrites", `${this.tagName}:${position}:${value}`);
    if (/<\s*script\b|\bon\w+\s*=|javascript:/i.test(String(value))) {
      record("scriptExecution", value);
    }
  }

  remove() {
    if (!this.parentNode) return;
    this.parentNode.children = this.parentNode.children.filter((child) => child !== this);
    this.parentNode = null;
  }

  select() {}

  setSelectionRange() {}
}

class StubText {
  constructor(value) {
    this.textContent = String(value);
    this.parentNode = null;
  }
}

class StubDocument {
  constructor(source) {
    this.title = "";
    this.createdTags = [];
    this.elements = new Map();
    this.documentElement = new StubElement("html", this);
    this.body = new StubElement("body", this);
    this.descriptionMeta = new StubElement("meta", this, { content: "" });

    for (const match of source.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*\bid="([^"]+)"[^>]*)>/gi)) {
      const [, tagName, rawAttributes, id] = match;
      this.elements.set(id, new StubElement(tagName, this, {
        id,
        hidden: /(?:^|\s)hidden(?:\s|>|$)/i.test(rawAttributes)
      }));
    }
  }

  getElementById(id) {
    return this.elements.get(id) || null;
  }

  querySelector(selector) {
    if (selector === 'meta[name="description"]') return this.descriptionMeta;
    return null;
  }

  createElement(tagName) {
    this.createdTags.push(String(tagName).toUpperCase());
    return new StubElement(tagName, this);
  }

  write(value) {
    record("htmlWrites", `document.write:${value}`);
    if (/<\s*script\b|\bon\w+\s*=|javascript:/i.test(String(value))) {
      record("scriptExecution", value);
    }
  }

  execCommand() {
    return false;
  }
}

const documentStub = new StubDocument(html);
const locationState = { href: "https://decoder.test/decode.html" };
const locationStub = {
  get href() {
    return locationState.href;
  },
  set href(value) {
    record("navigation", `href:${value}`);
    locationState.href = String(value);
  },
  assign(value) {
    record("navigation", `assign:${value}`);
    locationState.href = String(value);
  },
  replace(value) {
    record("navigation", `replace:${value}`);
    locationState.href = String(value);
  },
  reload() {
    record("navigation", "reload");
  }
};

const navigatorStub = {
  sendBeacon(url) {
    record("beacon", url);
    return true;
  }
};

const windowStub = {
  document: documentStub,
  navigator: navigatorStub,
  location: locationStub,
  open(url) {
    record("navigation", `open:${url}`);
    return null;
  }
};

function installGlobal(name, value) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: true,
    writable: true,
    value
  });
}

installGlobal("document", documentStub);
installGlobal("window", windowStub);
installGlobal("navigator", navigatorStub);
installGlobal("location", locationStub);
installGlobal("open", windowStub.open);
installGlobal("TextEncoder", globalThis.TextEncoder || TextEncoder);
installGlobal("TextDecoder", globalThis.TextDecoder || TextDecoder);
installGlobal("btoa", globalThis.btoa || ((value) => Buffer.from(value, "binary").toString("base64")));
installGlobal("atob", globalThis.atob || ((value) => Buffer.from(value, "base64").toString("binary")));
installGlobal("fetch", async (...args) => {
  record("fetch", args[0]);
  return { ok: true, status: 200, text: async () => "", json: async () => ({}) };
});
installGlobal("XMLHttpRequest", class SpyXMLHttpRequest {
  constructor() {
    record("xhr", "construct");
  }

  open(method, url) {
    record("xhr", `${method}:${url}`);
  }

  send() {
    record("xhr", "send");
  }
});
installGlobal("WebSocket", class SpyWebSocket {
  constructor(url) {
    record("webSocket", url);
  }
});
installGlobal("EventSource", class SpyEventSource {
  constructor(url) {
    record("eventSource", url);
  }
});
installGlobal("Image", class SpyImage {
  set src(value) {
    record("resource", value);
  }
});

await import(decodeModuleUrl.href);

const ids = [
  "decode-seal",
  "decode-title",
  "decode-description",
  "decode-form",
  "decode-input",
  "decode-button",
  "decode-error",
  "decode-output",
  "run-heading",
  "telemetry-heading",
  "stats-heading",
  "run-table",
  "telemetry-table",
  "stats-table"
];

const refs = Object.fromEntries(ids.map((id) => [id, documentStub.getElementById(id)]));

const payload = {
  version: 1,
  build: "phase2.5-demo-source",
  seed: 12648430,
  telemetry: {
    sessionStart: "2026-08-02T01:02:03.000Z",
    sessionEnd: null,
    totalActiveSeconds: 321.125,
    battlesFought: 7,
    battlesWon: 5,
    battlesFled: 1,
    townEntries: 4,
    recruitClicks: 9,
    promiseValues: { troops: 20, gold: 700 },
    promiseFinalActuals: { troops: 27, gold: 925 },
    actTimestamps: {
      act1: "2026-08-02T01:02:03.000Z",
      act2: "2026-08-02T01:12:03.000Z",
      ending: "2026-08-02T01:22:03.000Z"
    },
    quitPoint: {
      at: "2026-08-02T01:22:04.000Z",
      act: 2,
      tick: 654,
      renown: 100,
      screen: "ending"
    },
    tooltipViews: { town: 1, lowGold: 2, act2: 3 },
    replayCount: 0
  },
  promises: [
    { act: 1, kind: "troops", statedGoal: 20, actualAtActEnd: 27, exceeded: true },
    { act: 2, kind: "gold", statedGoal: 700, actualAtActEnd: 925, exceeded: true }
  ],
  stats: {
    days: 11,
    battles: 7,
    wins: 5,
    winRate: 0.7143,
    kills: 33,
    goldEarned: 1450,
    peakTroops: 27,
    peakGold: 925
  }
};

function independentCode(value) {
  return `crown1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64")}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clearResult() {
  refs["decode-input"].value = "";
  refs["decode-error"].textContent = "";
  refs["decode-error"].hidden = true;
  refs["decode-output"].hidden = true;
  refs["run-table"].replaceChildren();
  refs["telemetry-table"].replaceChildren();
  refs["stats-table"].replaceChildren();
}

function effectCounts() {
  return Object.fromEntries(Object.entries(sideEffects).map(([key, values]) => [key, values.length]));
}

function submit(value) {
  clearResult();
  refs["decode-input"].value = value;
  const before = effectCounts();
  const event = {
    type: "submit",
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    }
  };
  const shouldRunDefault = refs["decode-form"].dispatchEvent(event);
  if (shouldRunDefault) record("navigation", "implicit-form-submit");
  assert.equal(event.defaultPrevented, true, "form submission must prevent browser navigation");
  assert.deepEqual(effectCounts(), before, "decoding must not navigate, fetch, inject HTML, or load resources");
}

function rows(tableId) {
  return refs[tableId].children.map((row) => {
    assert.equal(row.tagName, "TR");
    assert.equal(row.children.length, 2);
    assert.equal(row.children[0].tagName, "TH");
    assert.equal(row.children[1].tagName, "TD");
    return [row.children[0].textContent, row.children[1].textContent];
  });
}

function expectSuccess() {
  assert.equal(refs["decode-error"].hidden, true);
  assert.equal(refs["decode-output"].hidden, false);
}

function expectInvalid() {
  assert.equal(refs["decode-error"].hidden, false);
  assert.equal(refs["decode-error"].textContent, "无法读取这段代码，请检查是否完整。");
  assert.equal(refs["decode-output"].hidden, true);
  assert.deepEqual(rows("run-table"), []);
  assert.deepEqual(rows("telemetry-table"), []);
  assert.deepEqual(rows("stats-table"), []);
}

test("decode.html exposes the local, inert decoder surface", () => {
  for (const id of ids) assert.ok(refs[id], `missing #${id}`);
  assert.match(html, /<script\s+type="module"\s+src="\.\/js\/decode\.js"><\/script>/);
  assert.doesNotMatch(html, /<form\b[^>]*\baction\s*=/i);
  assert.doesNotMatch(html, /\b(?:src|href|action)\s*=\s*["'](?:https?:|\/\/|data:|javascript:)/i);
  assert.equal(documentStub.documentElement.lang, "zh-CN");
  assert.equal(documentStub.title, "《王冠》试玩结果解码器");
  assert.equal(refs["decode-title"].textContent, "《王冠》试玩结果解码器");
  assert.equal(refs["decode-button"].textContent, "解码");
  assert.equal(refs["run-heading"].textContent, "试玩概况");
  assert.equal(refs["telemetry-heading"].textContent, "遥测明细");
  assert.equal(refs["stats-heading"].textContent, "结局统计");
});

test("full Chinese share message decodes into exact readable cells", () => {
  const message = `我的《王冠》试玩结果:${independentCode(payload)}`;
  submit(message);
  expectSuccess();

  assert.deepEqual(rows("run-table"), [
    ["version", "1"],
    ["build", "phase2.5-demo-source"],
    ["seed", "12648430"],
    ["promises", "[{\"act\":1,\"kind\":\"troops\",\"statedGoal\":20,\"actualAtActEnd\":27,\"exceeded\":true},{\"act\":2,\"kind\":\"gold\",\"statedGoal\":700,\"actualAtActEnd\":925,\"exceeded\":true}]" ]
  ]);
  assert.deepEqual(rows("telemetry-table"), [
    ["sessionStart", "2026-08-02T01:02:03.000Z"],
    ["sessionEnd", "—"],
    ["totalActiveSeconds", "321.125"],
    ["battlesFought", "7"],
    ["battlesWon", "5"],
    ["battlesFled", "1"],
    ["townEntries", "4"],
    ["recruitClicks", "9"],
    ["promiseValues.troops", "20"],
    ["promiseValues.gold", "700"],
    ["promiseFinalActuals.troops", "27"],
    ["promiseFinalActuals.gold", "925"],
    ["actTimestamps.act1", "2026-08-02T01:02:03.000Z"],
    ["actTimestamps.act2", "2026-08-02T01:12:03.000Z"],
    ["actTimestamps.ending", "2026-08-02T01:22:03.000Z"],
    ["quitPoint.at", "2026-08-02T01:22:04.000Z"],
    ["quitPoint.act", "2"],
    ["quitPoint.tick", "654"],
    ["quitPoint.renown", "100"],
    ["quitPoint.screen", "ending"],
    ["tooltipViews.town", "1"],
    ["tooltipViews.lowGold", "2"],
    ["tooltipViews.act2", "3"],
    ["replayCount", "0"]
  ]);
  assert.deepEqual(rows("stats-table"), [
    ["days", "11"],
    ["battles", "7"],
    ["wins", "5"],
    ["winRate", "0.7143"],
    ["kills", "33"],
    ["goldEarned", "1450"],
    ["peakTroops", "27"],
    ["peakGold", "925"]
  ]);
});

test("bare crown1 code decodes without surrounding share text", () => {
  const barePayload = clone(payload);
  barePayload.seed = 987654321;
  submit(independentCode(barePayload));
  expectSuccess();
  assert.equal(rows("run-table").find(([key]) => key === "seed")[1], "987654321");
});

test("malformed and incomplete codes show the Chinese error and no partial output", async (context) => {
  const malformedInputs = [
    "not-a-crown-code",
    "crown1.",
    "crown1.%%%not-base64%%%",
    `crown1.${Buffer.from("{not json", "utf8").toString("base64")}`,
    independentCode({ version: 2, telemetry: {}, stats: {} }),
    independentCode({ version: 1, telemetry: {} })
  ];

  for (const value of malformedInputs) {
    await context.test(value.slice(0, 42), () => {
      submit(value);
      expectInvalid();
    });
  }
});

test("empty input has its distinct Chinese validation message", () => {
  submit(" \n\t ");
  assert.equal(refs["decode-error"].hidden, false);
  assert.equal(refs["decode-error"].textContent, "请先粘贴试玩代码。");
  assert.equal(refs["decode-output"].hidden, true);
});

test("UTF-8 payload values survive Base64 decoding exactly", () => {
  const unicodePayload = {
    version: 1,
    build: "构建-β-🌏",
    seed: "种子-零号-𠮷",
    telemetry: {
      note: "将军说：“够了”\nثم تابع 🚩",
      place: { name: "北境 · Łódź · 東京" },
      nullable: null
    },
    promises: ["兵力二十", "金币七百 🪙"],
    stats: { epitaph: "王冠不是终点—停下才是。", wins: 0 }
  };

  submit(independentCode(unicodePayload));
  expectSuccess();
  assert.deepEqual(rows("run-table"), [
    ["version", "1"],
    ["build", "构建-β-🌏"],
    ["seed", "种子-零号-𠮷"],
    ["promises", "[\"兵力二十\",\"金币七百 🪙\"]"]
  ]);
  assert.deepEqual(rows("telemetry-table"), [
    ["note", "将军说：“够了”\nثم تابع 🚩"],
    ["place.name", "北境 · Łódź · 東京"],
    ["nullable", "—"]
  ]);
  assert.deepEqual(rows("stats-table"), [
    ["epitaph", "王冠不是终点—停下才是。"],
    ["wins", "0"]
  ]);
});

test("HTML and XSS-shaped payload content is rendered only as text", () => {
  const maliciousKey = '<svg onload="location=\'https://evil.invalid/nav\'">';
  const maliciousValue = '<a href="javascript:globalThis.__decodeXss=true">点我</a>';
  const maliciousPayload = {
    version: 1,
    build: '<img src="https://evil.invalid/pixel" onerror="fetch(\'https://evil.invalid/x\')">',
    seed: "</td><script>globalThis.__decodeXss=true</script>",
    telemetry: {
      [maliciousKey]: maliciousValue,
      html: '<iframe src="https://evil.invalid/frame"></iframe>'
    },
    promises: ["</script><script>location.href='https://evil.invalid/'</script>"],
    stats: { note: '<img src=x onerror="globalThis.__decodeXss=true">' }
  };
  const createdBefore = documentStub.createdTags.length;
  delete globalThis.__decodeXss;

  submit(`我的《王冠》试玩结果:${independentCode(maliciousPayload)}\nhttps://evil.invalid/trailing-link`);
  expectSuccess();

  assert.equal(rows("run-table").find(([key]) => key === "build")[1], maliciousPayload.build);
  assert.equal(rows("run-table").find(([key]) => key === "seed")[1], maliciousPayload.seed);
  assert.deepEqual(rows("telemetry-table"), [
    [maliciousKey, maliciousValue],
    ["html", maliciousPayload.telemetry.html]
  ]);
  assert.deepEqual(rows("stats-table"), [["note", maliciousPayload.stats.note]]);
  assert.equal(globalThis.__decodeXss, undefined);

  const createdForRender = documentStub.createdTags.slice(createdBefore);
  assert.ok(createdForRender.length > 0);
  assert.equal(createdForRender.every((tag) => tag === "TR" || tag === "TH" || tag === "TD"), true);
  assert.equal(createdForRender.some((tag) => ["SCRIPT", "IMG", "SVG", "IFRAME", "A"].includes(tag)), false);
});

test("decoder performs no network, resource, HTML-injection, or navigation side effects", () => {
  assert.deepEqual(sideEffects, {
    fetch: [],
    xhr: [],
    webSocket: [],
    eventSource: [],
    beacon: [],
    resource: [],
    navigation: [],
    htmlWrites: [],
    scriptExecution: []
  });
  assert.equal(locationState.href, "https://decoder.test/decode.html");
});

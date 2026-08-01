import { createBattlefield } from "./battlefield.js";
import { CONFIG, TOKENS, TOWN_DATA } from "./data.js";
import { buildRoads, distanceToRoad } from "./roads.js";
import { activeTown, clamp } from "./state.js";
import { lordName, translate } from "./strings.js";

/*
 * War Atlas map rendering.
 *
 * Everything here is presentation. It reads game state but never writes it, and
 * it never draws from `state.rng`: that stream is serialized into the save and
 * feeds bandit spawns, so consuming a single value from it here would silently
 * change the world. All procedural art uses its own stream seeded from
 * `state.seed`, which keeps the art deterministic without touching the sim.
 */

// Presentation-only constants. Deliberately NOT in CONFIG — nothing in
// sim/battle/ai reads them, so tuning any value here cannot move the balance.
const ART = Object.freeze({
  MOUNTAIN_CLUSTERS: 30,
  MOUNTAINS_PER_CLUSTER: 8,
  STAIN_COUNT: 54,
  RIVER_COUNT: 2,
  GRID_STEP: 100,
  TOWN_CLEARANCE: 150,
  GRAIN_TILE: 128,
  TRAIL_STEPS: 3,

  ROAD_CORRIDOR: 130
});

const PERF_MODE = new URLSearchParams(window.location.search).get("perf") === "1";

const reducedMotion = typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : { matches: false };

function motionOff() {
  return reducedMotion.matches;
}

function colorWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function factionInk(factionId) {
  if (factionId === "north") return TOKENS.factionNorth;
  if (factionId === "south") return TOKENS.factionSouth;
  if (factionId === "east") return TOKENS.factionEast;
  return TOKENS.inkFaint;
}

// Independent mulberry32 for art only. Never shares state.rng.
function artRandom(seed) {
  let value = (seed ^ 0x9e3779b9) >>> 0;
  return function nextRandom() {
    value = (value + 0x6d2b79f5) >>> 0;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

// Canvas has no native tapered stroke, so widths ramp segment by segment.
function taperedStroke(g, points, startWidth, endWidth, color, alpha) {
  if (points.length < 2) return;
  g.save();
  g.strokeStyle = colorWithAlpha(color, alpha);
  g.lineCap = "round";
  g.lineJoin = "round";
  const spans = points.length - 1;
  for (let index = 0; index < spans; index += 1) {
    const ratio = spans === 1 ? 0 : index / (spans - 1 || 1);
    g.lineWidth = Math.max(0.4, startWidth + (endWidth - startWidth) * ratio);
    g.beginPath();
    g.moveTo(points[index].x, points[index].y);
    g.lineTo(points[index + 1].x, points[index + 1].y);
    g.stroke();
  }
  g.restore();
}

function clearOfTowns(x, y, padding) {
  return TOWN_DATA.every((town) => Math.hypot(town.x - x, town.y - y) > padding);
}



function segmentsCross(a, b, c, d) {
  const side = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = side(a, b, c);
  const d2 = side(a, b, d);
  const d3 = side(c, d, a);
  const d4 = side(c, d, b);
  if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) {
    const t = d3 / (d3 - d4);
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }
  return null;
}


// Offscreen layers are optional so a context-less environment still runs.
function createLayerCanvas(width, height) {
  const layer = document.createElement("canvas");
  if (typeof layer.getContext !== "function") return null;
  layer.width = width;
  layer.height = height;
  const g = layer.getContext("2d");
  return g ? { layer, g } : null;
}

/* ---------------------------------------------------------------------------
 * World generation (all deterministic from state.seed)
 * ------------------------------------------------------------------------- */

function computeRivers(size, next) {
  const rivers = [];
  for (let river = 0; river < ART.RIVER_COUNT; river += 1) {
    const sideways = river % 2 === 1;
    const ax = sideways ? 0 : next(0.08, 0.4) * size;
    const ay = sideways ? next(0.15, 0.45) * size : 0;
    const bx = sideways ? size : next(0.5, 0.95) * size;
    const by = sideways ? next(0.6, 0.95) * size : size;

    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy) || 1;
    const nx = -dy / length;
    const ny = dx / length;
    const wander = next(90, 210);
    const phase = next(0, Math.PI * 2);
    const frequency = next(1.6, 3.4);

    const points = [];
    const steps = 30;
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps;
      // The sin(pi*t) envelope pins both ends to the sheet edge.
      const offset = Math.sin(phase + t * Math.PI * frequency) * wander * Math.sin(Math.PI * t);
      points.push({ x: ax + dx * t + nx * offset, y: ay + dy * t + ny * offset });
    }
    rivers.push(points);
  }
  return rivers;
}


function paintStains(g, size, next) {
  for (let index = 0; index < ART.STAIN_COUNT; index += 1) {
    const x = next(0, size);
    const y = next(0, size);
    const radius = next(size * 0.04, size * 0.19);
    // A few deep blotches beat many faint ones for an aged read.
    const depth = next(0, 1) > 0.72 ? next(0.3, 0.46) : next(0.1, 0.24);
    const gradient = g.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, colorWithAlpha(TOKENS.paperShadow, depth));
    gradient.addColorStop(0.62, colorWithAlpha(TOKENS.paperShadow, depth * 0.35));
    gradient.addColorStop(1, colorWithAlpha(TOKENS.paperShadow, 0));
    g.fillStyle = gradient;
    g.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

function paintGrid(g, size) {
  g.save();
  g.strokeStyle = colorWithAlpha(TOKENS.inkFaint, 0.08);
  g.lineWidth = 1;
  g.beginPath();
  for (let position = ART.GRID_STEP; position < size; position += ART.GRID_STEP) {
    g.moveTo(position, 0);
    g.lineTo(position, size);
    g.moveTo(0, position);
    g.lineTo(size, position);
  }
  g.stroke();
  g.restore();
}

function paintRivers(g, rivers) {
  rivers.forEach((points) => {
    // Three passes build a wash: broad and pale, then progressively tighter.
    taperedStroke(g, points, 9, 15, TOKENS.factionSouth, 0.1);
    taperedStroke(g, points, 5, 9, TOKENS.factionSouth, 0.14);
    taperedStroke(g, points, 1.6, 3.4, TOKENS.factionSouth, 0.24);
  });
}

function paintRoads(g, roads) {
  roads.forEach((road) => {
    const line = road.points;
    // Double ink line — the cartographic convention for a road.
    [-1.7, 1.7].forEach((offset) => {
      g.save();
      g.strokeStyle = colorWithAlpha(TOKENS.inkFaint, 0.2);
      g.lineWidth = 1.1;
      g.lineCap = "round";
      g.lineJoin = "round";
      g.beginPath();
      for (let index = 0; index < line.length; index += 1) {
        const previous = line[Math.max(0, index - 1)];
        const point = line[index];
        const dx = point.x - previous.x;
        const dy = point.y - previous.y;
        const length = Math.hypot(dx, dy) || 1;
        const x = point.x + (-dy / length) * offset;
        const y = point.y + (dx / length) * offset;
        if (index === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
      g.restore();
    });
  });
}

function paintBridges(g, roads, rivers) {
  const drawn = [];
  roads.forEach((road) => {
    rivers.forEach((river) => {
      for (let r = 0; r < road.points.length - 1; r += 1) {
        for (let v = 0; v < river.length - 1; v += 1) {
          const hit = segmentsCross(road.points[r], road.points[r + 1], river[v], river[v + 1]);
          if (!hit) continue;
          // One glyph per crossing: smoothed roads can cross a bend twice.
          if (drawn.some((mark) => Math.hypot(mark.x - hit.x, mark.y - hit.y) < 40)) continue;
          drawn.push(hit);

          const dx = road.points[r + 1].x - road.points[r].x;
          const dy = road.points[r + 1].y - road.points[r].y;
          const length = Math.hypot(dx, dy) || 1;
          const ux = dx / length;
          const uy = dy / length;
          const nx = -uy;
          const ny = ux;

          g.save();
          g.strokeStyle = colorWithAlpha(TOKENS.ink, 0.5);
          g.lineWidth = 1.7;
          g.lineCap = "round";
          [-7, 7].forEach((side) => {
            g.beginPath();
            g.moveTo(hit.x + nx * side - ux * 11, hit.y + ny * side - uy * 11);
            g.lineTo(hit.x + nx * side + ux * 11, hit.y + ny * side + uy * 11);
            g.stroke();
          });
          [-6, 0, 6].forEach((along) => {
            g.beginPath();
            g.moveTo(hit.x + ux * along - nx * 7, hit.y + uy * along - ny * 7);
            g.lineTo(hit.x + ux * along + nx * 7, hit.y + uy * along + ny * 7);
            g.stroke();
          });
          g.restore();
        }
      }
    });
  });
}

function paintMountain(g, x, y, width, height, next, alpha) {
  const peakX = x + next(-width * 0.16, width * 0.16);
  const peakY = y - height;
  const left = [
    { x: x - width, y },
    { x: x - width * 0.62, y: y - height * 0.3 },
    { x: x - width * 0.26, y: y - height * 0.74 },
    { x: peakX, y: peakY }
  ];
  const right = [
    { x: peakX, y: peakY },
    { x: x + width * 0.3, y: y - height * 0.68 },
    { x: x + width * 0.66, y: y - height * 0.26 },
    { x: x + width, y }
  ];

  // Fill the silhouette first so nearer peaks occlude farther ones instead of
  // showing through as a tangle of outlines.
  g.save();
  g.fillStyle = colorWithAlpha(TOKENS.paper, 0.5 + alpha);
  g.beginPath();
  g.moveTo(x - width, y);
  left.forEach((point) => g.lineTo(point.x, point.y));
  right.forEach((point) => g.lineTo(point.x, point.y));
  g.closePath();
  g.fill();
  g.fillStyle = colorWithAlpha(TOKENS.ink, alpha * 0.22);
  g.fill();
  g.restore();

  taperedStroke(g, left, width * 0.09, width * 0.03, TOKENS.ink, alpha + 0.08);
  taperedStroke(g, right, width * 0.03, width * 0.09, TOKENS.ink, alpha + 0.08);
  taperedStroke(g, [
    { x: peakX, y: peakY + height * 0.24 },
    { x: peakX + next(-width * 0.24, width * 0.24), y: y - height * 0.08 }
  ], width * 0.055, width * 0.02, TOKENS.ink, alpha * 0.75);
}

// Ranges, not scatter: each cluster runs along an axis and is drawn far-to-near
// so nearer peaks overlap. Road corridors are kept clear, which pushes the
// ranges into the gaps between roads and makes them read as passes and valleys.
function paintTerrain(g, size, next, roads) {
  const offRoad = (x, y) => roads.every((road) => distanceToRoad(road.points, x, y) > ART.ROAD_CORRIDOR);

  for (let cluster = 0; cluster < ART.MOUNTAIN_CLUSTERS; cluster += 1) {
    let cx = 0;
    let cy = 0;
    let placed = false;
    for (let attempt = 0; attempt < 20 && !placed; attempt += 1) {
      cx = next(60, size - 60);
      cy = next(60, size - 60);
      placed = clearOfTowns(cx, cy, ART.TOWN_CLEARANCE) && offRoad(cx, cy);
    }
    if (!placed) continue;

    const angle = next(0, Math.PI * 2);
    const runX = Math.cos(angle);
    const runY = Math.sin(angle) * 0.42;
    const reach = next(90, 240);
    const count = Math.round(next(4, ART.MOUNTAINS_PER_CLUSTER));
    const weight = next(0.7, 1.35);

    const peaks = [];
    for (let index = 0; index < count; index += 1) {
      const along = (index / Math.max(1, count - 1) - 0.5) * 2 * reach;
      const depth = next(-1, 1);
      peaks.push({
        x: cx + runX * along + next(-14, 14),
        y: cy + runY * along + depth * next(8, 26),
        depth,
        width: next(18, 40) * weight
      });
    }
    peaks.sort((a, b) => a.depth - b.depth);
    peaks.forEach((peak) => {
      if (!clearOfTowns(peak.x, peak.y, ART.TOWN_CLEARANCE * 0.7)) return;
      if (!offRoad(peak.x, peak.y)) return;
      const near = (peak.depth + 1) / 2;
      paintMountain(
        g,
        peak.x,
        peak.y,
        peak.width * (0.72 + near * 0.5),
        peak.width * next(0.72, 1.3),
        next,
        0.1 + near * 0.19
      );
    });
  }
}

function paintSheetEdge(g, size) {
  const inset = size * 0.16;
  [
    [0, 0, inset, 0],
    [size, 0, size - inset, 0],
    [0, 0, 0, inset],
    [0, size, 0, size - inset]
  ].forEach(([x0, y0, x1, y1]) => {
    const gradient = g.createLinearGradient(x0, y0, x1, y1);
    gradient.addColorStop(0, colorWithAlpha(TOKENS.paperShadow, 0.5));
    gradient.addColorStop(1, colorWithAlpha(TOKENS.paperShadow, 0));
    g.fillStyle = gradient;
    g.fillRect(0, 0, size, size);
  });

  g.save();
  g.strokeStyle = colorWithAlpha(TOKENS.ink, 0.4);
  g.lineWidth = 5;
  g.strokeRect(10, 10, size - 20, size - 20);
  g.strokeStyle = colorWithAlpha(TOKENS.ink, 0.26);
  g.lineWidth = 1.5;
  g.strokeRect(26, 26, size - 52, size - 52);
  g.restore();
}

/* ---------------------------------------------------------------------------
 * Renderer
 * ------------------------------------------------------------------------- */

export function createMapRenderer(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  let viewportWidth = 1;
  let viewportHeight = 1;
  let pixelRatio = 1;
  let camera = { x: 0, y: 0, zoom: CONFIG.ZOOM_MOBILE };

  let worldLayer = null;
  let worldLayerSeed = null;
  let screenLayer = null;
  let grainTile = null;

  // Trails live render-side, keyed by party id, so `state` keeps its exact
  // shape and the save format is untouched.
  const trails = new Map();
  let trailTick = -1;

  const battlefield = createBattlefield();

  const frameSamples = [];
  let perfLoggedAt = 0;

  function currentZoom() {
    return viewportWidth <= CONFIG.MOBILE_BREAKPOINT ? CONFIG.ZOOM_MOBILE : CONFIG.ZOOM_DESKTOP;
  }

  function updateCamera(focus) {
    const zoom = currentZoom();
    const worldViewWidth = viewportWidth / zoom;
    const worldViewHeight = viewportHeight / zoom;
    camera = {
      x: clamp(focus.x - worldViewWidth / 2, 0, Math.max(0, CONFIG.WORLD_SIZE - worldViewWidth)),
      y: clamp(focus.y - worldViewHeight / 2, 0, Math.max(0, CONFIG.WORLD_SIZE - worldViewHeight)),
      zoom
    };
  }

  function worldToScreen(position) {
    return {
      x: (position.x - camera.x) * camera.zoom,
      y: (position.y - camera.y) * camera.zoom
    };
  }

  function screenToWorld(x, y) {
    return {
      x: clamp(camera.x + x / camera.zoom, 0, CONFIG.WORLD_SIZE),
      y: clamp(camera.y + y / camera.zoom, 0, CONFIG.WORLD_SIZE)
    };
  }

  function interpolatedPosition(party, alpha) {
    return {
      x: party.prevPos.x + (party.pos.x - party.prevPos.x) * alpha,
      y: party.prevPos.y + (party.pos.y - party.prevPos.y) * alpha
    };
  }

  function buildWorldLayer(seed) {
    const size = CONFIG.WORLD_SIZE;
    worldLayerSeed = seed;
    const made = createLayerCanvas(size, size);
    if (!made) {
      worldLayer = null;
      return;
    }
    const { layer, g } = made;
    const roll = artRandom(seed);
    const next = (minimum, maximum) => minimum + (maximum - minimum) * roll();

    // Order matters: roads are computed before terrain so terrain can be masked
    // out of their corridors, and rivers are laid down before the bridges that
    // must sit on top of them.
    const rivers = computeRivers(size, next);
    // The SAME network the lords march along, so a drawn road and a walked
    // road are never two different lines.
    const roads = buildRoads(seed);

    g.fillStyle = TOKENS.paper;
    g.fillRect(0, 0, size, size);
    paintStains(g, size, next);
    paintGrid(g, size);
    paintRivers(g, rivers);
    paintRoads(g, roads);
    paintBridges(g, roads, rivers);
    paintTerrain(g, size, next, roads);
    paintSheetEdge(g, size);

    worldLayer = layer;
  }

  function buildGrainTile() {
    const made = createLayerCanvas(ART.GRAIN_TILE, ART.GRAIN_TILE);
    if (!made) return null;
    const { layer, g } = made;
    const image = g.createImageData(ART.GRAIN_TILE, ART.GRAIN_TILE);
    if (!image || !image.data) return null;
    const roll = artRandom(CONFIG.SEED ^ 0x5eed);
    const data = image.data;
    for (let index = 0; index < data.length; index += 4) {
      const noise = roll();
      const dark = noise < 0.5;
      data[index] = dark ? 43 : 232;
      data[index + 1] = dark ? 38 : 220;
      data[index + 2] = dark ? 32 : 195;
      data[index + 3] = Math.floor(Math.abs(noise - 0.5) * 2 * 18);
    }
    g.putImageData(image, 0, 0);
    return layer;
  }

  function buildScreenLayer() {
    const made = createLayerCanvas(
      Math.max(1, Math.floor(viewportWidth * pixelRatio)),
      Math.max(1, Math.floor(viewportHeight * pixelRatio))
    );
    if (!made) {
      screenLayer = null;
      return;
    }
    const { layer, g } = made;
    g.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    if (!grainTile) grainTile = buildGrainTile();
    if (grainTile) {
      g.fillStyle = g.createPattern(grainTile, "repeat");
      g.fillRect(0, 0, viewportWidth, viewportHeight);
    }

    const gradient = g.createRadialGradient(
      viewportWidth / 2, viewportHeight / 2, Math.min(viewportWidth, viewportHeight) * 0.32,
      viewportWidth / 2, viewportHeight / 2, Math.max(viewportWidth, viewportHeight) * 0.76
    );
    gradient.addColorStop(0, colorWithAlpha(TOKENS.ink, 0));
    gradient.addColorStop(1, colorWithAlpha(TOKENS.ink, 0.24));
    g.fillStyle = gradient;
    g.fillRect(0, 0, viewportWidth, viewportHeight);

    screenLayer = layer;
  }

  /* -- ambient ------------------------------------------------------------ */
  // The sheet warms and cools across the game day. Every colour is a token;
  // night is the specified deep indigo.
  const AMBIENT_KEYS = [
    { at: 0.0, color: TOKENS.cinnabar, alpha: 0.07 },
    { at: 0.32, color: TOKENS.paper, alpha: 0.0 },
    { at: 0.64, color: TOKENS.factionEast, alpha: 0.12 },
    { at: 0.86, color: TOKENS.factionSouth, alpha: 0.15 }
  ];

  function dayPhase(state) {
    return (state.tick % CONFIG.TICKS_PER_DAY) / CONFIG.TICKS_PER_DAY;
  }

  function nightAmount(state) {
    if (motionOff()) return 0;
    const phase = dayPhase(state);
    if (phase < 0.64) return 0;
    if (phase < 0.86) return (phase - 0.64) / 0.22;
    return 1;
  }

  function drawAmbient(state) {
    if (motionOff()) return;
    const phase = dayPhase(state);
    let from = AMBIENT_KEYS[AMBIENT_KEYS.length - 1];
    let to = AMBIENT_KEYS[0];
    for (let index = 0; index < AMBIENT_KEYS.length; index += 1) {
      const key = AMBIENT_KEYS[index];
      const nextKey = AMBIENT_KEYS[(index + 1) % AMBIENT_KEYS.length];
      const upper = nextKey.at > key.at ? nextKey.at : 1 + nextKey.at;
      const probe = phase < key.at ? phase + 1 : phase;
      if (probe >= key.at && probe < upper) {
        from = key;
        to = nextKey;
        break;
      }
    }
    const span = (to.at > from.at ? to.at : 1 + to.at) - from.at;
    const probe = phase < from.at ? phase + 1 : phase;
    const t = span <= 0 ? 0 : clamp((probe - from.at) / span, 0, 1);

    // Two stacked washes so the hue never passes through mud.
    context.fillStyle = colorWithAlpha(from.color, from.alpha * (1 - t));
    context.fillRect(0, 0, viewportWidth, viewportHeight);
    context.fillStyle = colorWithAlpha(to.color, to.alpha * t);
    context.fillRect(0, 0, viewportWidth, viewportHeight);
  }

  /* -- marks -------------------------------------------------------------- */

  // A closed path whose radius wobbles: reads as drawn by hand, not by arc().
  function inkCirclePath(cx, cy, radius, seed, wobble) {
    const roll = artRandom(seed);
    const steps = 44;
    context.beginPath();
    for (let index = 0; index <= steps; index += 1) {
      const angle = (index / steps) * Math.PI * 2;
      const jitter = 1 + (roll() - 0.5) * wobble;
      const x = cx + Math.cos(angle) * radius * jitter;
      const y = cy + Math.sin(angle) * radius * jitter;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
    context.closePath();
  }

  // Party names get a soft paper bloom rather than a chip: only towns are
  // important enough to earn a cartouche, and a field of white boxes reads as
  // UI stuck on top of the map instead of marks made on it.
  function inkLabel(cx, topY, text, font, alpha) {
    context.save();
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.shadowColor = colorWithAlpha(TOKENS.paper, 0.95);
    context.shadowBlur = 5;
    context.fillStyle = colorWithAlpha(TOKENS.paper, 0.95);
    context.fillText(text, cx, topY);
    context.fillText(text, cx, topY);
    context.fillText(text, cx, topY);
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.fillStyle = colorWithAlpha(TOKENS.ink, alpha);
    context.fillText(text, cx, topY);
    context.restore();
  }

  // Torn-edged paper cartouche, reserved for place names.
  function paperLabel(cx, topY, text, font, color) {
    context.save();
    context.font = font;
    context.textAlign = "center";
    context.textBaseline = "middle";
    const width = context.measureText(text).width + 14;
    const height = 19;
    const left = cx - width / 2;
    const right = cx + width / 2;
    const bottom = topY + height;
    const roll = artRandom(hashString(text));

    context.beginPath();
    context.moveTo(left, topY);
    context.lineTo(right, topY);
    for (let index = 1; index <= 3; index += 1) {
      context.lineTo(right + (roll() - 0.5) * 3.4, topY + (height / 3) * index);
    }
    context.lineTo(left, bottom);
    for (let index = 2; index >= 1; index -= 1) {
      context.lineTo(left + (roll() - 0.5) * 3.4, topY + (height / 3) * index);
    }
    context.closePath();

    context.fillStyle = colorWithAlpha(TOKENS.paper, 0.9);
    context.shadowColor = colorWithAlpha(TOKENS.ink, 0.28);
    context.shadowBlur = 4;
    context.shadowOffsetY = 1;
    context.fill();
    context.shadowColor = "transparent";
    context.shadowBlur = 0;
    context.shadowOffsetY = 0;

    context.fillStyle = color;
    context.fillText(text, cx, topY + height / 2 + 0.5);
    context.restore();
  }

  // Walled-city glyph: flanking towers, crenellated curtain wall, gate arch.
  function drawWalledCity(cx, cy, scale, alpha, night) {
    const base = cy + scale * 0.62;
    const wallTop = cy - scale * 0.06;
    const towerTop = cy - scale * 0.46;
    const towerWidth = scale * 0.3;
    const inner = scale * 0.68;
    const merlon = scale * 0.17;

    context.save();
    context.strokeStyle = colorWithAlpha(TOKENS.ink, alpha);
    context.lineWidth = Math.max(1.1, scale * 0.1);
    context.lineJoin = "round";
    context.lineCap = "round";

    context.beginPath();
    context.moveTo(cx - inner, base);
    context.lineTo(cx - inner, wallTop);
    const crenels = 4;
    const step = (inner * 2) / (crenels * 2 - 1);
    for (let index = 0; index < crenels * 2 - 1; index += 1) {
      const x0 = cx - inner + step * index;
      const y = index % 2 === 0 ? wallTop - merlon : wallTop;
      context.lineTo(x0, y);
      context.lineTo(x0 + step, y);
    }
    context.lineTo(cx + inner, wallTop);
    context.lineTo(cx + inner, base);
    context.stroke();

    [-1, 1].forEach((side) => {
      const tx = cx + side * (inner + towerWidth * 0.44);
      context.beginPath();
      context.moveTo(tx - towerWidth / 2, base);
      context.lineTo(tx - towerWidth / 2, towerTop);
      context.lineTo(tx + towerWidth / 2, towerTop);
      context.lineTo(tx + towerWidth / 2, base);
      context.stroke();
    });

    const gateWidth = scale * 0.26;
    const gateTop = base - scale * 0.42;
    context.beginPath();
    context.moveTo(cx - gateWidth, base);
    context.lineTo(cx - gateWidth, gateTop);
    context.quadraticCurveTo(cx, gateTop - gateWidth * 0.9, cx + gateWidth, gateTop);
    context.lineTo(cx + gateWidth, base);
    context.stroke();

    taperedStroke(context, [
      { x: cx - scale * 1.1, y: base },
      { x: cx + scale * 1.1, y: base }
    ], scale * 0.09, scale * 0.05, TOKENS.ink, alpha * 0.8);

    if (night > 0.02) {
      context.fillStyle = colorWithAlpha(TOKENS.paper, 0.55 + night * 0.4);
      [
        [cx - inner - towerWidth * 0.44, towerTop + scale * 0.16],
        [cx + inner + towerWidth * 0.44, towerTop + scale * 0.16],
        [cx, wallTop + scale * 0.2]
      ].forEach(([x, y]) => {
        context.beginPath();
        context.arc(x, y, Math.max(1, scale * 0.075), 0, Math.PI * 2);
        context.fill();
      });
    }
    context.restore();
  }

  function drawGround(state) {
    if (!worldLayer || worldLayerSeed !== state.seed) buildWorldLayer(state.seed);
    if (!screenLayer) buildScreenLayer();

    context.fillStyle = TOKENS.lacquer;
    context.fillRect(0, 0, viewportWidth, viewportHeight);

    // One blit for paper, stains, grid, rivers, roads, bridges and terrain.
    // Corner-to-corner so a viewport wider than the world still maps correctly.
    if (worldLayer) {
      const topLeft = worldToScreen({ x: 0, y: 0 });
      const bottomRight = worldToScreen({ x: CONFIG.WORLD_SIZE, y: CONFIG.WORLD_SIZE });
      context.drawImage(
        worldLayer,
        topLeft.x, topLeft.y,
        bottomRight.x - topLeft.x, bottomRight.y - topLeft.y
      );
    }
    drawAmbient(state);
  }

  function drawTown(state, town, isActive, language) {
    const position = worldToScreen(town.pos);
    const radius = CONFIG.TOWN_RADIUS * camera.zoom;
    if (
      position.x < -radius - 80 || position.x > viewportWidth + radius + 80 ||
      position.y < -radius - 80 || position.y > viewportHeight + radius + 80
    ) return;

    const ink = factionInk(town.factionId);
    const seed = hashString(town.id);
    const night = nightAmount(state);

    context.save();
    const wash = context.createRadialGradient(
      position.x, position.y, radius * 0.1,
      position.x, position.y, radius
    );
    wash.addColorStop(0, colorWithAlpha(TOKENS.paper, 0.72));
    wash.addColorStop(1, colorWithAlpha(TOKENS.paper, 0));
    context.fillStyle = wash;
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.fill();

    inkCirclePath(position.x, position.y, radius, seed, 0.05);
    context.strokeStyle = colorWithAlpha(ink, 0.62);
    context.lineWidth = 2.6;
    context.stroke();

    // Deliberately ink, not cinnabar: the accent belongs to the player seal and
    // the stamps. A second red ring on screen would spend it.
    if (isActive) {
      inkCirclePath(position.x, position.y, radius + 9, seed ^ 0x55, 0.07);
      context.strokeStyle = colorWithAlpha(TOKENS.ink, 0.55);
      context.lineWidth = 1.6;
      context.stroke();
    }

    drawWalledCity(position.x, position.y, radius * 0.44, 0.82, night);
    context.restore();

    paperLabel(
      position.x,
      position.y + radius + 7,
      translate(language, town.nameKey),
      `700 12px ${TOKENS.fontDisplay}`,
      colorWithAlpha(TOKENS.ink, 0.92)
    );
  }

  function updateTrails(state) {
    if (state.tick === trailTick) return;
    // A rewind means a fresh world: drop stale history rather than drawing a
    // trail between two unrelated positions.
    if (state.tick < trailTick) trails.clear();
    trailTick = state.tick;

    const live = new Set(["player"]);
    const push = (id, position) => {
      let history = trails.get(id);
      if (!history) {
        history = [];
        trails.set(id, history);
      }
      history.push({ x: position.x, y: position.y });
      if (history.length > ART.TRAIL_STEPS + 1) history.shift();
    };

    push("player", state.player.prevPos);
    state.lords.forEach((lord) => {
      live.add(lord.id);
      push(lord.id, lord.prevPos);
    });
    state.bandits.forEach((bandit) => {
      live.add(bandit.id);
      push(bandit.id, bandit.prevPos);
    });
    trails.forEach((_, id) => {
      if (!live.has(id)) trails.delete(id);
    });
  }

  function drawTrail(id, color) {
    if (motionOff()) return;
    const history = trails.get(id);
    if (!history || history.length < 2) return;
    for (let index = 0; index < history.length - 1; index += 1) {
      const point = worldToScreen(history[index]);
      const fade = (index + 1) / history.length;
      context.fillStyle = colorWithAlpha(color, 0.06 + fade * 0.16);
      context.beginPath();
      context.arc(point.x, point.y, 2.4 + fade * 1.4, 0, Math.PI * 2);
      context.fill();
    }
  }

  function drawLord(state, lord, alpha, language) {
    const position = worldToScreen(interpolatedPosition(lord, alpha));
    if (position.x < -30 || position.x > viewportWidth + 30 || position.y < -34 || position.y > viewportHeight + 30) return;
    const ink = factionInk(lord.factionId);

    drawTrail(lord.id, ink);

    context.save();
    taperedStroke(context, [
      { x: position.x, y: position.y + 5 },
      { x: position.x, y: position.y - 15 }
    ], 1.9, 1.2, TOKENS.ink, 0.8);

    context.beginPath();
    context.moveTo(position.x + 1, position.y - 15);
    context.quadraticCurveTo(position.x + 8, position.y - 14.5, position.x + 13, position.y - 11.5);
    context.quadraticCurveTo(position.x + 8, position.y - 9.5, position.x + 1, position.y - 7.5);
    context.closePath();
    context.fillStyle = colorWithAlpha(ink, 0.88);
    context.fill();
    context.strokeStyle = colorWithAlpha(TOKENS.ink, 0.45);
    context.lineWidth = 0.8;
    context.stroke();

    context.fillStyle = colorWithAlpha(TOKENS.ink, 0.55);
    context.beginPath();
    context.ellipse(position.x, position.y + 5, 4.6, 1.9, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();

    inkLabel(position.x, position.y + 9, lordName(language, lord.nameIndex), `600 11px ${TOKENS.fontDisplay}`, 0.72);
  }

  function drawBandit(state, bandit, alpha, language) {
    const position = worldToScreen(interpolatedPosition(bandit, alpha));
    if (position.x < -30 || position.x > viewportWidth + 30 || position.y < -30 || position.y > viewportHeight + 30) return;
    const count = bandit.troops.reduce((sum, stack) => sum + stack.count, 0);
    const engaged = state.battle?.banditId === bandit.id;
    const seed = hashString(bandit.id);
    const elite = Boolean(bandit.elite || bandit.kind === "elite");
    const markerScale = elite ? CONFIG.ELITE_MARKER_SIZE_MULTIPLIER : 1;

    drawTrail(bandit.id, TOKENS.ink);

    context.save();
    // A rough blot: overlapping offset discs rather than a clean circle.
    const roll = artRandom(seed);
    context.fillStyle = colorWithAlpha(TOKENS.ink, elite ? 0.98 : 0.82);
    for (let index = 0; index < (elite ? 6 : 4); index += 1) {
      const offsetX = (roll() - 0.5) * 5.5 * markerScale;
      const offsetY = (roll() - 0.5) * 5.5 * markerScale;
      context.beginPath();
      context.arc(position.x + offsetX, position.y + offsetY, (3.4 + roll() * 2.4) * markerScale, 0, Math.PI * 2);
      context.fill();
    }
    for (let index = 0; index < 3; index += 1) {
      context.fillStyle = colorWithAlpha(TOKENS.ink, 0.3 + roll() * 0.3);
      context.beginPath();
      context.arc(
        position.x + (roll() - 0.5) * 15 * markerScale,
        position.y + (roll() - 0.5) * 15 * markerScale,
        (0.7 + roll()) * markerScale,
        0,
        Math.PI * 2
      );
      context.fill();
    }

    if (elite) {
      inkCirclePath(position.x, position.y, 14 * markerScale, seed ^ 0xe11e, 0.18);
      context.strokeStyle = colorWithAlpha(TOKENS.ink, 0.72);
      context.lineWidth = 2.4;
      context.stroke();
    }

    if (engaged) {
      inkCirclePath(position.x, position.y, 15 * markerScale, seed ^ 0x9a, 0.12);
      context.strokeStyle = colorWithAlpha(TOKENS.cinnabar, 0.85);
      context.lineWidth = 2.2;
      context.stroke();
    }
    context.restore();

    inkLabel(
      position.x,
      position.y + 11,
      translate(language, elite ? "map.eliteBandit" : "map.bandit", { count }),
      `${elite ? 700 : 600} ${elite ? 12 : 11}px ${TOKENS.fontDisplay}`,
      elite ? 0.92 : 0.72
    );
  }

  function drawMoveTarget(state, alpha, now) {
    if (!state.player.moveTarget || state.battle || state.paused) return;
    const target = worldToScreen(state.player.moveTarget);
    const from = worldToScreen(interpolatedPosition(state.player, alpha));

    context.save();
    // A drawn march route, never a ruler line: bow the path perpendicular by a
    // fraction of its own length.
    const dx = target.x - from.x;
    const dy = target.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    const bow = Math.min(26, length * 0.11);
    const controlX = (from.x + target.x) / 2 + (-dy / length) * bow;
    const controlY = (from.y + target.y) / 2 + (dx / length) * bow;

    const gradient = context.createLinearGradient(from.x, from.y, target.x, target.y);
    gradient.addColorStop(0, colorWithAlpha(TOKENS.ink, 0.05));
    gradient.addColorStop(1, colorWithAlpha(TOKENS.ink, 0.42));
    context.strokeStyle = gradient;
    context.setLineDash([5, 6]);
    context.lineWidth = 1.4;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.quadraticCurveTo(controlX, controlY, target.x, target.y);
    context.stroke();
    context.setLineDash([]);

    const pulse = motionOff() ? 9 : 9 + Math.sin(now / 320) * 1.6;
    inkCirclePath(target.x, target.y, pulse, 0x7a1e, 0.14);
    context.strokeStyle = colorWithAlpha(TOKENS.ink, 0.55);
    context.lineWidth = 1.3;
    context.stroke();
    context.restore();
  }

  function drawPlayer(state, alpha, now, language) {
    const position = worldToScreen(interpolatedPosition(state.player, alpha));
    const breath = motionOff() ? 0 : (Math.sin(now / 620) * 0.5 + 0.5);
    const half = 10;

    drawTrail("player", TOKENS.cinnabar);

    context.save();
    if (breath > 0) {
      const halo = context.createRadialGradient(
        position.x, position.y, half,
        position.x, position.y, half + 10 + breath * 5
      );
      halo.addColorStop(0, colorWithAlpha(TOKENS.cinnabar, 0.16 + breath * 0.08));
      halo.addColorStop(1, colorWithAlpha(TOKENS.cinnabar, 0));
      context.fillStyle = halo;
      context.fillRect(position.x - 30, position.y - 30, 60, 60);
    }

    // The player seal uses a solid vermilion field with a paper-cut mark.
    context.fillStyle = TOKENS.cinnabar;
    context.fillRect(position.x - half, position.y - half, half * 2, half * 2);
    context.strokeStyle = colorWithAlpha(TOKENS.paper, 0.85);
    context.lineWidth = 1.1;
    context.strokeRect(position.x - half + 2.5, position.y - half + 2.5, half * 2 - 5, half * 2 - 5);

    context.fillStyle = TOKENS.paper;
    context.font = `700 12px ${TOKENS.fontDisplay}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(translate(language, "map.playerSeal"), position.x, position.y + 0.5);
    context.restore();
  }

  function recordFrameTime(milliseconds, now) {
    frameSamples.push(milliseconds);
    if (frameSamples.length > 120) frameSamples.shift();
    if (now - perfLoggedAt < 1000 || frameSamples.length < 30) return;
    perfLoggedAt = now;
    const sorted = frameSamples.slice().sort((a, b) => a - b);
    const mean = frameSamples.reduce((sum, value) => sum + value, 0) / frameSamples.length;
    window.__CROWN_PERF__ = {
      mean: Number(mean.toFixed(2)),
      p95: Number(sorted[Math.floor(sorted.length * 0.95)].toFixed(2)),
      worst: Number(sorted[sorted.length - 1].toFixed(2))
    };
  }

  function resize(focus) {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.DPR_CAP);
    canvas.width = Math.max(1, Math.floor(viewportWidth * pixelRatio));
    canvas.height = Math.max(1, Math.floor(viewportHeight * pixelRatio));
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    buildScreenLayer();
    updateCamera(focus);
  }

  function render(state, now, alpha, language) {
    const started = PERF_MODE ? performance.now() : 0;
    updateCamera(interpolatedPosition(state.player, alpha));
    updateTrails(state);

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    drawGround(state);
    const town = activeTown(state);
    state.towns.forEach((entry) => drawTown(state, entry, town?.id === entry.id, language));
    drawMoveTarget(state, alpha, now);
    state.lords.forEach((lord) => drawLord(state, lord, alpha, language));
    state.bandits.forEach((bandit) => drawBandit(state, bandit, alpha, language));
    drawPlayer(state, alpha, now, language);
    battlefield.draw(context, state, now, viewportWidth, viewportHeight, language, translate);

    // Grain and vignette last, so every element shares one sheet of paper.
    if (screenLayer) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(screenLayer, 0, 0);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    }

    if (PERF_MODE) recordFrameTime(performance.now() - started, now);
  }

  return { render, resize, screenToWorld };
}

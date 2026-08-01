import { CONFIG, TOKENS } from "./data.js";
import { activeTown, clamp, getFaction } from "./state.js";
import { lordName, translate } from "./strings.js";

function colorWithAlpha(hex, alpha) {
  const value = hex.replace("#", "");
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function createMapRenderer(canvas) {
  const context = canvas.getContext("2d", { alpha: false });
  let viewportWidth = 1;
  let viewportHeight = 1;
  let pixelRatio = 1;
  let camera = { x: 0, y: 0, zoom: CONFIG.ZOOM_MOBILE };

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

  function drawGround() {
    context.fillStyle = TOKENS.lacquer;
    context.fillRect(0, 0, viewportWidth, viewportHeight);

    const topLeft = worldToScreen({ x: 0, y: 0 });
    const bottomRight = worldToScreen({ x: CONFIG.WORLD_SIZE, y: CONFIG.WORLD_SIZE });
    context.fillStyle = TOKENS.paper;
    context.fillRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);

    const wash = context.createRadialGradient(
      viewportWidth * 0.42,
      viewportHeight * 0.38,
      20,
      viewportWidth * 0.5,
      viewportHeight * 0.5,
      Math.max(viewportWidth, viewportHeight) * 0.8
    );
    wash.addColorStop(0, colorWithAlpha(TOKENS.paperShadow, 0.08));
    wash.addColorStop(1, colorWithAlpha(TOKENS.ink, 0.13));
    context.fillStyle = wash;
    context.fillRect(0, 0, viewportWidth, viewportHeight);

    context.lineWidth = 1;
    context.strokeStyle = colorWithAlpha(TOKENS.ink, 0.06);
    context.beginPath();
    const gridSize = 100;
    const startX = Math.ceil(camera.x / gridSize) * gridSize;
    const endX = Math.min(CONFIG.WORLD_SIZE, camera.x + viewportWidth / camera.zoom);
    const startY = Math.ceil(camera.y / gridSize) * gridSize;
    const endY = Math.min(CONFIG.WORLD_SIZE, camera.y + viewportHeight / camera.zoom);
    for (let x = startX; x <= endX; x += gridSize) {
      const screenX = worldToScreen({ x, y: 0 }).x;
      context.moveTo(screenX, 0);
      context.lineTo(screenX, viewportHeight);
    }
    for (let y = startY; y <= endY; y += gridSize) {
      const screenY = worldToScreen({ x: 0, y }).y;
      context.moveTo(0, screenY);
      context.lineTo(viewportWidth, screenY);
    }
    context.stroke();

    context.strokeStyle = colorWithAlpha(TOKENS.ink, 0.32);
    context.lineWidth = 2;
    context.strokeRect(topLeft.x, topLeft.y, bottomRight.x - topLeft.x, bottomRight.y - topLeft.y);
  }

  function drawPatrolRoutes(state) {
    context.save();
    context.setLineDash([5, 8]);
    context.lineWidth = 1;
    state.factions.forEach((faction) => {
      const towns = state.towns.filter((town) => town.factionId === faction.id);
      const first = worldToScreen(towns[0].pos);
      const second = worldToScreen(towns[1].pos);
      context.strokeStyle = colorWithAlpha(faction.color, 0.36);
      context.beginPath();
      context.moveTo(first.x, first.y);
      context.lineTo(second.x, second.y);
      context.stroke();
    });
    context.restore();
  }

  function drawTown(state, town, isActive, language) {
    const position = worldToScreen(town.pos);
    const faction = getFaction(state, town.factionId);
    const radius = CONFIG.TOWN_RADIUS * camera.zoom;
    if (
      position.x < -radius - 80 || position.x > viewportWidth + radius + 80 ||
      position.y < -radius - 80 || position.y > viewportHeight + radius + 80
    ) return;

    context.save();
    if (isActive) {
      context.strokeStyle = colorWithAlpha(TOKENS.cinnabar, 0.65);
      context.lineWidth = 2;
      context.beginPath();
      context.arc(position.x, position.y, radius + 11, 0, Math.PI * 2);
      context.stroke();
    }

    context.fillStyle = TOKENS.lacquer;
    context.strokeStyle = faction.color;
    context.lineWidth = 5;
    context.beginPath();
    context.arc(position.x, position.y, radius, 0, Math.PI * 2);
    context.fill();
    context.stroke();

    context.fillStyle = TOKENS.paper;
    context.font = `${Math.max(19, radius * 0.72)}px ${TOKENS.fontDisplay}`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(translate(language, "map.castle"), position.x, position.y + 1);

    const name = translate(language, town.nameKey);
    context.font = `700 12px ${TOKENS.fontBody}`;
    context.textBaseline = "top";
    context.lineWidth = 4;
    context.strokeStyle = colorWithAlpha(TOKENS.paper, 0.92);
    context.strokeText(name, position.x, position.y + radius + 8);
    context.fillStyle = TOKENS.ink;
    context.fillText(name, position.x, position.y + radius + 8);
    context.restore();
  }

  function drawLord(state, lord, alpha, language) {
    const position = worldToScreen(interpolatedPosition(lord, alpha));
    if (position.x < -24 || position.x > viewportWidth + 24 || position.y < -24 || position.y > viewportHeight + 24) return;
    const faction = getFaction(state, lord.factionId);
    const size = 10;
    const name = lordName(language, lord.nameIndex);

    context.save();
    context.beginPath();
    context.moveTo(position.x, position.y - size);
    context.lineTo(position.x - size * 0.82, position.y + size * 0.72);
    context.lineTo(position.x + size * 0.82, position.y + size * 0.72);
    context.closePath();
    context.fillStyle = faction.color;
    context.fill();
    context.lineWidth = 1.5;
    context.strokeStyle = TOKENS.paper;
    context.stroke();

    context.font = `600 9px ${TOKENS.fontBody}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.lineWidth = 3;
    context.strokeStyle = colorWithAlpha(TOKENS.paper, 0.9);
    context.strokeText(name, position.x, position.y + 10);
    context.fillStyle = TOKENS.ink;
    context.fillText(name, position.x, position.y + 10);
    context.restore();
  }

  function drawBandit(state, bandit, alpha, language) {
    const position = worldToScreen(interpolatedPosition(bandit, alpha));
    if (position.x < -30 || position.x > viewportWidth + 30 || position.y < -30 || position.y > viewportHeight + 30) return;
    const count = bandit.troops.reduce((sum, stack) => sum + stack.count, 0);
    const label = translate(language, "map.bandit", { count });

    context.save();
    context.beginPath();
    context.arc(position.x, position.y, 8, 0, Math.PI * 2);
    context.fillStyle = TOKENS.inkFaint;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = state.battle?.banditId === bandit.id ? TOKENS.cinnabar : TOKENS.ink;
    context.stroke();

    context.font = `700 9px ${TOKENS.fontBody}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.lineWidth = 3;
    context.strokeStyle = colorWithAlpha(TOKENS.paper, 0.9);
    context.strokeText(label, position.x, position.y + 11);
    context.fillStyle = TOKENS.ink;
    context.fillText(label, position.x, position.y + 11);
    context.restore();
  }

  function drawMoveTarget(state, now) {
    if (!state.player.moveTarget || state.battle || state.paused) return;
    const position = worldToScreen(state.player.moveTarget);
    const pulse = 10 + Math.sin(now / 180) * 2;
    context.save();
    context.strokeStyle = colorWithAlpha(TOKENS.cinnabar, 0.78);
    context.lineWidth = 1.5;
    context.beginPath();
    context.arc(position.x, position.y, pulse, 0, Math.PI * 2);
    context.stroke();
    context.beginPath();
    context.moveTo(position.x - 4, position.y);
    context.lineTo(position.x + 4, position.y);
    context.moveTo(position.x, position.y - 4);
    context.lineTo(position.x, position.y + 4);
    context.stroke();
    context.restore();
  }

  function drawPlayer(state, alpha, language) {
    const position = worldToScreen(interpolatedPosition(state.player, alpha));
    const label = translate(language, "map.you");
    context.save();
    context.shadowColor = colorWithAlpha(TOKENS.ink, 0.35);
    context.shadowBlur = 12;
    context.fillStyle = TOKENS.paper;
    context.fillRect(position.x - 8, position.y - 8, 16, 16);
    context.shadowBlur = 0;
    context.strokeStyle = TOKENS.cinnabar;
    context.lineWidth = 2;
    context.strokeRect(position.x - 9, position.y - 9, 18, 18);

    context.font = `800 10px ${TOKENS.fontBody}`;
    context.textAlign = "center";
    context.textBaseline = "top";
    context.lineWidth = 3;
    context.strokeStyle = colorWithAlpha(TOKENS.paper, 0.94);
    context.strokeText(label, position.x, position.y + 13);
    context.fillStyle = TOKENS.ink;
    context.fillText(label, position.x, position.y + 13);
    context.restore();
  }

  function resize(focus) {
    viewportWidth = window.innerWidth;
    viewportHeight = window.innerHeight;
    pixelRatio = Math.min(window.devicePixelRatio || 1, CONFIG.DPR_CAP);
    canvas.width = Math.max(1, Math.floor(viewportWidth * pixelRatio));
    canvas.height = Math.max(1, Math.floor(viewportHeight * pixelRatio));
    canvas.style.width = `${viewportWidth}px`;
    canvas.style.height = `${viewportHeight}px`;
    updateCamera(focus);
  }

  function render(state, now, alpha, language) {
    const playerPosition = interpolatedPosition(state.player, alpha);
    updateCamera(playerPosition);
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, viewportWidth, viewportHeight);
    drawGround();
    drawPatrolRoutes(state);
    const town = activeTown(state);
    state.towns.forEach((entry) => drawTown(state, entry, town?.id === entry.id, language));
    drawMoveTarget(state, now);
    state.lords.forEach((lord) => drawLord(state, lord, alpha, language));
    state.bandits.forEach((bandit) => drawBandit(state, bandit, alpha, language));
    drawPlayer(state, alpha, language);
  }

  return { render, resize, screenToWorld };
}

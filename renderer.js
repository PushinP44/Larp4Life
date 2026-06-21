/**
 * renderer.js — Single-viewport Canvas renderer for Ecosystem X
 *
 * Architecture Law 1 (Rule 01): ONE canvas, no separate screens.
 * Environmental change = tile re-tint. No canvas swaps. No DOM screens.
 *
 * Rule 03: render() is READ-ONLY. It MUTATES NOTHING in state.
 *
 * Layers (drawn in order):
 *   1. Tile grid      — colour lerps by stressor L × ecosystem_health
 *   2. Node sprites   — size/opacity ∝ population/K_max; extinct = silhouette
 *   3. DAG edges      — ONLY edge.revealed===true, prey→predator, animated pulse
 *   4. Field Agent    — player position indicator
 *   5. HUD bar        — day, timer, health meter, tier, resources, scanner
 *
 * Exports:
 *   setupDPICanvas(canvas)       — call once on init; handles devicePixelRatio
 *   render(state, ctx, timestamp)— call every rAF frame; reads state, draws, returns nothing
 */

// ─────────────────────────────────────────────────────────────────────────────
// Colour helpers (from game-dev-patterns.md)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * hexToRgb(hex) → { r, g, b }
 * @param {string} hex  e.g. '#1a9e6b'
 */
function hexToRgb(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/**
 * lerpColor(colorA, colorB, t) → CSS rgb() string
 * t=0 → colorA, t=1 → colorB. Both args: hex strings or rgb() strings.
 * @param {string} colorA
 * @param {string} colorB
 * @param {number} t  clamped to [0,1] internally
 */
export function lerpColor(colorA, colorB, t) {
  t = Math.max(0, Math.min(1, t));
  const a = hexToRgb(colorA);
  const b = hexToRgb(colorB);
  const r    = Math.round(a.r + (b.r - a.r) * t);
  const g    = Math.round(a.g + (b.g - a.g) * t);
  const blue = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${blue})`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Design tokens (mirror CSS variables — canvas can't read CSS vars directly)
// Source of truth is style.css; keep these in sync if you change style.css.
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  BG_DARK:       '#101820',
  TILE_HEALTHY:  '#1a9e6b',
  TILE_TOXIC:    '#5c4a1e',
  ACCENT:        '#f0a500',
  TEXT_LIGHT:    '#f5f0e8',
  DANGER:        '#c0392b',
  EDGE:          '#7fd1ff',

  // Tile type base tints (before health/stressor lerp)
  TILE_WATER:  '#1a4e6b',
  TILE_MARSH:  '#2a6b3a',
  TILE_LAND:   '#4a5a3a',
  TILE_SOURCE: '#6b3a1a',

  // Node kind fill colours
  NODE_PRODUCER: '#26c97a',
  NODE_CONSUMER: '#5bc4e8',
  NODE_PREDATOR: '#e8a84a',
  NODE_STRESSOR: '#c04020',
  NODE_EXTINCT:  '#404040',

  // HUD
  HUD_BG:       'rgba(10,14,20,0.88)',
  HUD_HEIGHT:   48,
  HUD_BORDER:   'rgba(240,165,0,0.3)',
};

// Tier colour map for the HUD health bar
const TIER_COLORS = {
  Toxic:      '#c0392b',
  Degraded:   '#f0a500',
  Recovering: '#4ccea0',
  Pristine:   '#1a9e6b',
};

// ─────────────────────────────────────────────────────────────────────────────
// DPI / HiDPI scaling
// ─────────────────────────────────────────────────────────────────────────────

/**
 * setupDPICanvas(canvas) → CanvasRenderingContext2D
 *
 * Sets canvas pixel dimensions to css-size × devicePixelRatio so the canvas
 * looks sharp on retina displays.  Call once on init; call again on resize.
 * Returns the 2D context pre-scaled by dpr.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {CanvasRenderingContext2D}
 */
export function setupDPICanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width  = Math.round(rect.width  * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tile layout helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getTileMetrics(state, canvas) → { tileW, tileH, offsetX, offsetY }
 *
 * Computes pixel size of each tile so the full grid fits the canvas width,
 * leaving HUD_HEIGHT pixels at the top for the HUD bar.
 */
function getTileMetrics(state, canvas) {
  const { w, h } = state.world.grid;
  const cssW = canvas.getBoundingClientRect().width  || canvas.width;
  const cssH = canvas.getBoundingClientRect().height || canvas.height;
  const availH = cssH - C.HUD_HEIGHT;
  const tileW = Math.floor(cssW / w);
  const tileH = Math.floor(availH / h);
  const offsetX = Math.floor((cssW - tileW * w) / 2);
  const offsetY = C.HUD_HEIGHT;
  return { tileW, tileH, offsetX, offsetY };
}

/**
 * tilePx(tileId, state, metrics) → { x, y, w, h }  (pixel rect of a tile)
 *
 * Uses tile.x / tile.y stored in state.world.tiles.
 * Falls back to parsing 't_<x>_<y>' if tile object lacks x/y.
 */
function tilePx(tileId, state, metrics) {
  const tile = state.world.tiles[tileId];
  let tx, ty;
  if (tile && tile.x !== undefined) {
    tx = tile.x; ty = tile.y;
  } else {
    // parse 't_<col>_<row>'
    const parts = tileId.split('_');
    tx = parseInt(parts[1], 10);
    ty = parseInt(parts[2], 10);
  }
  return {
    x: metrics.offsetX + tx * metrics.tileW,
    y: metrics.offsetY + ty * metrics.tileH,
    w: metrics.tileW,
    h: metrics.tileH,
  };
}

/**
 * nodeCentre(nodeId, state, metrics) → { cx, cy }
 */
function nodeCentre(nodeId, state, metrics) {
  const n = state.world.nodes[nodeId];
  if (!n) return null;
  const r = tilePx(n.tileId, state, metrics);
  return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1 — Tile grid
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tile base colour by type.
 */
function tileBaseColor(type) {
  switch (type) {
    case 'water':  return C.TILE_WATER;
    case 'marsh':  return C.TILE_MARSH;
    case 'land':   return C.TILE_LAND;
    case 'source': return C.TILE_SOURCE;
    default:       return C.TILE_LAND;
  }
}

/**
 * drawTileGrid(state, ctx, metrics)
 *
 * Each tile colour:
 *   1. Start from base colour for tile type.
 *   2. Lerp toward TILE_TOXIC based on stressor L / 100
 *      (more polluted → more brown/desaturated).
 *   3. Lerp the result toward TILE_HEALTHY based on ecosystem_health / 100
 *      (globally healthier biome → tiles appear more vibrant overall).
 */
function drawTileGrid(state, ctx, metrics) {
  /* AI_INTEGRATION_STUB: Miora/MPS — replace flat color fill with
     ctx.drawImage(sprites[tile.type], ...) for generated tile sprites */
  const H = state.meta.ecosystem_health;       // 0–100

  // Fix (3): clamp health darkening so tiles never fade below a visible floor.
  // Without this, low-H ambient tiles (stressor=0) converge toward BG_DARK and
  // the map looks empty.  We reserve only 40% of the lerp range for darkening
  // (healthFloor=0.25 means the darkest the global health modifier can push a
  // tile is 25% of the way toward TILE_HEALTHY — i.e. tiles keep 75% of their
  // base colour even at H=0).  The remaining modulation still gives clear
  // visual feedback that the biome is sick without making it invisible.
  const healthFrac = 0.25 + 0.20 * Math.max(0, Math.min(1, H / 100));
  // healthFrac range: H=0 → 0.25 (floor), H=100 → 0.45 (ceiling)
  // This keeps every tile visibly coloured while still distinguishing tiers.

  for (const [tileId, tile] of Object.entries(state.world.tiles)) {
    const { x, y, w, h } = tilePx(tileId, state, metrics);
    const L = tile.stressor ?? 0;              // 0–100
    const stressFrac = Math.max(0, Math.min(1, L / 100));

    // Step 1: base → toxic lerp (stressor effect on this tile's own pollution)
    const base  = tileBaseColor(tile.type ?? 'land');
    const step1 = lerpColor(base, C.TILE_TOXIC, stressFrac * 0.75);

    // Step 2: lerp toward TILE_HEALTHY with the floor-clamped health fraction
    // so healthy biomes are more vibrant and sick biomes are desaturated but
    // still readable as continuous terrain (not black holes).
    const step2 = lerpColor(step1, C.TILE_HEALTHY, healthFrac);

    ctx.fillStyle = step2;
    ctx.fillRect(x, y, w, h);

    // Subtle grid lines
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);

    // Protected tile indicator (dashed border)
    if (tile.protected) {
      ctx.strokeStyle = C.ACCENT;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
      ctx.setLineDash([]);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2 — Node sprites
// ─────────────────────────────────────────────────────────────────────────────

/**
 * nodeColor(kind) → hex
 */
function nodeColor(kind) {
  switch (kind) {
    case 'producer': return C.NODE_PRODUCER;
    case 'consumer': return C.NODE_CONSUMER;
    case 'predator': return C.NODE_PREDATOR;
    case 'stressor': return C.NODE_STRESSOR;
    default:         return C.TEXT_LIGHT;
  }
}

/**
 * drawNodes(state, ctx, metrics)
 *
 * Each biological node is drawn as a circle on its tile:
 *   radius  = base * sqrt(P / K_max)   — size ∝ relative population
 *   opacity = lerp(0.2, 1.0, P/K_max) — fades as population falls
 *   extinct = filled grey silhouette at 0.25 opacity, strikethrough
 *
 * Keystone nodes get an accent ring.
 * Stressor nodes draw as a pulsing hazard symbol (◆ diamond).
 */
function drawNodes(state, ctx, metrics, timestamp) {
  /* AI_INTEGRATION_STUB: Miora/MPS — replace shapes with
     ctx.drawImage(nodeSprites[node.id], ...) for generated species art */
  const BASE_R = Math.min(metrics.tileW, metrics.tileH) * 0.32;

  for (const node of Object.values(state.world.nodes)) {
    const centre = nodeCentre(node.id, state, metrics);
    if (!centre) continue;
    const { cx, cy } = centre;

    // ── Stressor node: pulsing red diamond ──────────────────────────────────
    if (node.kind === 'stressor') {
      const pulse = 0.7 + 0.3 * Math.sin(timestamp / 600);
      const size  = BASE_R * 0.7 * pulse;
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.fillStyle   = C.NODE_STRESSOR;
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-size / 2, -size / 2, size, size);
      ctx.restore();

      // "!" warning label
      ctx.fillStyle = C.TEXT_LIGHT;
      ctx.font      = `bold ${Math.round(BASE_R * 0.7)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = 0.9;
      ctx.fillText('!', cx, cy);
      ctx.globalAlpha = 1;
      continue;
    }

    // ── Extinct node: faded grey silhouette ─────────────────────────────────
    if (node.status === 'extinct') {
      ctx.save();
      ctx.globalAlpha = 0.25;
      ctx.fillStyle   = C.NODE_EXTINCT;
      ctx.beginPath();
      ctx.arc(cx, cy, BASE_R * 0.55, 0, Math.PI * 2);
      ctx.fill();
      // X mark
      ctx.strokeStyle = '#888';
      ctx.lineWidth   = 1.5;
      const d = BASE_R * 0.3;
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
      ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
      ctx.stroke();
      ctx.restore();
      continue;
    }

    // ── Living node ─────────────────────────────────────────────────────────
    const relPop  = node.K_max > 0
      ? Math.max(0, Math.min(1, node.population / node.K_max))
      : 0;
    const radius  = BASE_R * (0.35 + 0.65 * Math.sqrt(relPop));
    const opacity = 0.25 + 0.75 * relPop;
    const color   = nodeColor(node.kind);

    ctx.save();
    ctx.globalAlpha = opacity;

    // Fill circle
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // Keystone ring
    if (node.keystone) {
      ctx.globalAlpha = Math.min(1, opacity + 0.2);
      ctx.strokeStyle = C.ACCENT;
      ctx.lineWidth   = 1.8;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Endangered pulse glow
    if (node.status === 'endangered') {
      const glow = 0.4 + 0.6 * Math.abs(Math.sin(timestamp / 400));
      ctx.globalAlpha = glow * 0.6;
      ctx.strokeStyle = C.DANGER;
      ctx.lineWidth   = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, radius + 6, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // Node name label (only for discovered nodes or when population > 0)
    if (node.discovered || node.population > 0) {
      ctx.save();
      ctx.globalAlpha = Math.max(0.4, opacity);
      ctx.fillStyle   = C.TEXT_LIGHT;
      ctx.font        = `${Math.max(8, Math.round(metrics.tileH * 0.16))}px monospace`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'top';
      // Truncate long names
      const label = node.name.length > 12 ? node.name.slice(0, 11) + '…' : node.name;
      ctx.fillText(label, cx, cy + radius + 3);
      ctx.restore();
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3 — DAG edge overlay (only revealed edges)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * drawEdges(state, ctx, metrics, timestamp)
 *
 * Draws ONLY edges where edge.revealed === true.
 * Direction: prey (from) → predator (to), with an animated pulse dot.
 * Unrevealed edges are completely invisible — this is the deduction mechanic.
 */
function drawEdges(state, ctx, metrics, timestamp) {
  const PULSE_SPEED = 1800; // ms for one full traversal

  for (const edge of state.world.edges) {
    if (!edge.revealed) continue; // ← hard rule: never draw unrevealed

    const fromC = nodeCentre(edge.from, state, metrics);
    const toC   = nodeCentre(edge.to,   state, metrics);
    if (!fromC || !toC) continue;

    const { cx: x1, cy: y1 } = fromC;
    const { cx: x2, cy: y2 } = toC;
    const dx = x2 - x1;
    const dy = y2 - y1;

    // ── Static edge line ────────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = C.EDGE;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = 0.65;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.setLineDash([]);

    // ── Arrow head at target (predator side) ────────────────────────────────
    const angle  = Math.atan2(dy, dx);
    const alen   = 8;
    const awidth = 0.45;
    ctx.globalAlpha = 0.8;
    ctx.fillStyle   = C.EDGE;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(
      x2 - alen * Math.cos(angle - awidth),
      y2 - alen * Math.sin(angle - awidth)
    );
    ctx.lineTo(
      x2 - alen * Math.cos(angle + awidth),
      y2 - alen * Math.sin(angle + awidth)
    );
    ctx.closePath();
    ctx.fill();

    // ── Animated pulse dot travelling prey→predator ─────────────────────────
    const t = ((timestamp % PULSE_SPEED) / PULSE_SPEED); // 0..1 along the edge
    const px = x1 + dx * t;
    const py = y1 + dy * t;
    ctx.globalAlpha = 0.9;
    ctx.fillStyle   = '#fff';
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 4 — Field Agent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * drawAgent(state, ctx, metrics, timestamp)
 *
 * Draws the player as a bright ◎ crosshair indicator on their tile.
 */
function drawAgent(state, ctx, metrics, timestamp) {
  const { tile_x: tx, tile_y: ty } = state.player;
  const x = metrics.offsetX + tx * metrics.tileW;
  const y = metrics.offsetY + ty * metrics.tileH;
  const w = metrics.tileW;
  const h = metrics.tileH;
  const cx = x + w / 2;
  const cy = y + h / 2;

  // Highlight the current tile
  const pulse = 0.3 + 0.2 * Math.sin(timestamp / 500);
  ctx.save();
  ctx.fillStyle   = `rgba(240, 165, 0, ${pulse})`;
  ctx.fillRect(x + 2, y + 2, w - 4, h - 4);
  ctx.restore();

  // Outer ring
  ctx.save();
  ctx.strokeStyle = C.ACCENT;
  ctx.lineWidth   = 2;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(cx, cy, Math.min(w, h) * 0.36, 0, Math.PI * 2);
  ctx.stroke();

  // Inner dot
  ctx.fillStyle   = C.ACCENT;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fill();

  // Cross-hairs
  const cr = Math.min(w, h) * 0.42;
  const ci = Math.min(w, h) * 0.18;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.7;
  [[cx - cr, cy, cx - ci, cy],
   [cx + ci, cy, cx + cr, cy],
   [cx, cy - cr, cx, cy - ci],
   [cx, cy + ci, cx, cy + cr]].forEach(([ax, ay, bx, by]) => {
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  });

  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 5 — HUD bar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * drawHUD(state, ctx, canvasW)
 *
 * Top bar layout (left → right):
 *   [DAY n] [TIMER ⏱ n] [Health bar ████░░░░ H% TIER] [Resources ¤ n] [Scanner ⚡ n]
 */
function drawHUD(state, ctx, canvasW) {
  const H_BAR = C.HUD_HEIGHT;
  const PAD   = 14;
  const FONT  = '12px monospace';
  const FONT_LG = 'bold 13px monospace';

  // Background bar
  ctx.fillStyle = C.HUD_BG;
  ctx.fillRect(0, 0, canvasW, H_BAR);
  ctx.strokeStyle = C.HUD_BORDER;
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(0, H_BAR - 0.5);
  ctx.lineTo(canvasW, H_BAR - 0.5);
  ctx.stroke();

  const { day_count, collapse_timer, ecosystem_health, market_tier } = state.meta;
  const { resources, scanner_charges } = state.player;
  const cy = H_BAR / 2;

  let curX = PAD;

  // ── DAY counter ───────────────────────────────────────────────────────────
  ctx.fillStyle   = C.TEXT_LIGHT;
  ctx.font        = FONT;
  ctx.textBaseline = 'middle';
  ctx.textAlign   = 'left';
  ctx.fillText('DAY', curX, cy - 5);
  ctx.font        = FONT_LG;
  ctx.fillStyle   = C.ACCENT;
  ctx.fillText(String(day_count), curX, cy + 6);
  curX += 42;

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(curX, 8);
  ctx.lineTo(curX, H_BAR - 8);
  ctx.stroke();
  curX += 10;

  // ── Collapse timer ────────────────────────────────────────────────────────
  const timerColor = collapse_timer <= 5 ? C.DANGER
                   : collapse_timer <= 10 ? '#e8a84a'
                   : C.TEXT_LIGHT;
  ctx.font = FONT;
  ctx.fillStyle = timerColor;
  ctx.fillText('COLLAPSE', curX, cy - 5);
  ctx.font = FONT_LG;
  ctx.fillStyle = timerColor;
  ctx.fillText(`T-${collapse_timer}`, curX, cy + 6);
  curX += 62;

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(curX, 8); ctx.lineTo(curX, H_BAR - 8);
  ctx.stroke();
  curX += 10;

  // ── Ecosystem health bar ──────────────────────────────────────────────────
  const METER_W = 130;
  const METER_H = 10;
  const mx      = curX;
  const my      = cy - METER_H / 2 - 2;

  // Label + value
  ctx.font = FONT;
  ctx.fillStyle = C.TEXT_LIGHT;
  ctx.textAlign = 'left';
  ctx.fillText('HEALTH', mx, my - 2);

  // Bar track
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.roundRect(mx, my + 10, METER_W, METER_H, 3);
  ctx.fill();

  // Bar fill — colour by tier
  const hFrac = Math.max(0, Math.min(1, ecosystem_health / 100));
  ctx.fillStyle = TIER_COLORS[market_tier] || C.TILE_HEALTHY;
  ctx.beginPath();
  ctx.roundRect(mx, my + 10, Math.round(METER_W * hFrac), METER_H, 3);
  ctx.fill();

  // Percentage + tier label to the right of the bar
  ctx.font      = 'bold 11px monospace';
  ctx.fillStyle = TIER_COLORS[market_tier] || C.TEXT_LIGHT;
  ctx.textAlign = 'left';
  ctx.fillText(`${Math.round(ecosystem_health)}%`, mx + METER_W + 6, cy - 3);
  ctx.font      = '10px monospace';
  ctx.fillStyle = C.TEXT_LIGHT;
  ctx.globalAlpha = 0.7;
  ctx.fillText(market_tier.toUpperCase(), mx + METER_W + 6, cy + 8);
  ctx.globalAlpha = 1;

  curX += METER_W + 60;

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.lineWidth   = 1;
  ctx.beginPath();
  ctx.moveTo(curX, 8); ctx.lineTo(curX, H_BAR - 8);
  ctx.stroke();
  curX += 10;

  // ── Resources ─────────────────────────────────────────────────────────────
  ctx.font      = FONT;
  ctx.fillStyle = C.TEXT_LIGHT;
  ctx.textAlign = 'left';
  ctx.fillText('RES', curX, cy - 5);
  ctx.font      = FONT_LG;
  ctx.fillStyle = C.ACCENT;
  ctx.fillText(`¤${resources}`, curX, cy + 6);
  curX += 64;

  // Separator
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.moveTo(curX, 8); ctx.lineTo(curX, H_BAR - 8);
  ctx.stroke();
  curX += 10;

  // ── Scanner charges ───────────────────────────────────────────────────────
  ctx.font      = FONT;
  ctx.fillStyle = C.TEXT_LIGHT;
  ctx.textAlign = 'left';
  ctx.fillText('SCAN', curX, cy - 5);
  ctx.font      = FONT_LG;
  ctx.fillStyle = scanner_charges > 0 ? C.EDGE : C.DANGER;
  ctx.fillText(`⚡${scanner_charges}`, curX, cy + 6);
  curX += 58;

  // ── Streak indicator (left-aligned, right after SCAN — avoids overlapping it) ──
  // Win/lose status is shown on the dedicated card overlay, so we no longer draw a
  // redundant HUD banner here (it used to overlap the right-aligned SCAN indicator).
  const streak = state.meta.health_streak ?? 0;
  if (streak > 0 && !state.flags.win && !state.flags.lose) {
    ctx.font      = FONT;
    ctx.fillStyle = C.TILE_HEALTHY;
    ctx.textAlign = 'left';
    ctx.globalAlpha = 0.85;
    ctx.fillText(`streak ${streak}/3`, curX, cy + 4);
    ctx.globalAlpha = 1;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main render function (exported)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * render(state, ctx, timestamp)
 *
 * Called every requestAnimationFrame tick from main.js.
 * READS state only — mutates nothing.
 *
 * @param {object} state      — GameState singleton (or any compatible object)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} [timestamp=0]  — rAF timestamp (ms); drives pulse animations
 */
export function render(state, ctx, timestamp = 0) {
  const canvas = ctx.canvas;
  // CSS layout dimensions (logical pixels, not physical)
  const rect   = canvas.getBoundingClientRect();
  const cssW   = rect.width  || canvas.width;
  const cssH   = rect.height || canvas.height;

  // ── Clear ─────────────────────────────────────────────────────────────────
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.fillStyle = C.BG_DARK;
  ctx.fillRect(0, 0, cssW, cssH);

  // Guard: need a populated world to draw
  if (!state?.world?.tiles || !state?.world?.nodes) {
    ctx.fillStyle = C.TEXT_LIGHT;
    ctx.font      = '14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('Initialising world…', cssW / 2, cssH / 2);
    return;
  }

  const metrics = getTileMetrics(state, canvas);

  // ── Layer 1: Tile grid ────────────────────────────────────────────────────
  drawTileGrid(state, ctx, metrics);

  // ── Layer 2: Node sprites ─────────────────────────────────────────────────
  drawNodes(state, ctx, metrics, timestamp);

  // ── Layer 3: Revealed DAG edges ───────────────────────────────────────────
  drawEdges(state, ctx, metrics, timestamp);

  // ── Layer 4: Field Agent ──────────────────────────────────────────────────
  drawAgent(state, ctx, metrics, timestamp);

  // ── Layer 5: HUD bar ──────────────────────────────────────────────────────
  drawHUD(state, ctx, cssW);
}

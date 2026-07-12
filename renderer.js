/**
 * renderer.js — Single-viewport Canvas renderer for Ecosystem X
 *
 * Architecture Law 1 (Rule 01): ONE canvas, no separate screens.
 * Environmental change = tile re-tint. No canvas swaps. No DOM screens.
 *
 * Rule 03: render() is READ-ONLY. It MUTATES NOTHING in state.
 *
 * Layers (drawn in order):
 *   1.  Tile grid      — noise-typed sprites; global biome filter (health→vibrancy);
 *                        per-tile mirror; toxic crossfade; water shimmer; shoreline foam
 *   1.5 Props          — deterministic scatter (trees/reeds/lilypads/…); biome filter
 *   2.  Node sprites   — drawImage when loaded, else circle fallback; idle bob + shadow
 *   3.  DAG edges      — ONLY edge.revealed===true, prey→predator, animated pulse
 *   4.  Field Agent    — player.png spritesheet (4 dirs × 4 frames), eased pixel pos,
 *                        walk-frame counter; agent.png / crosshair as two fallbacks
 *   4.5 Scan ripples   — expanding rings on 'ecosystemx:scan' event
 *   4.6 Atmosphere     — health-reactive drifting particles; cinematic vignette
 *   5.  HUD bar        — day, timer, gradient health bar, resources, scanner + streak
 *
 * Exports:
 *   setupDPICanvas(canvas)        — call once on init; handles devicePixelRatio
 *   lerpColor(a, b, t)            — used by external modules
 *   render(state, ctx, timestamp) — call every rAF frame; reads state, draws, returns nothing
 *   pingCleanEffect(tx, ty)       — trigger one-shot green burst on tile (tx, ty)
 *   flashCanvas(durationMs)       — trigger a brief full-canvas white flash (tier-up)
 */

import { getSprite } from './ai_content.js';

// ─────────────────────────────────────────────────────────────────────────────
// Deterministic value-noise helpers  (no Math.random — Rule 01 / Law 2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * hash3(seed, x, y) → float in [0, 1)
 *
 * Stateless integer hash that mixes seed + tile coordinates.
 * Uses the same mulberry32 step formula to stay consistent with prng.js,
 * but is called on-the-fly so no PRNG state is stored in the renderer.
 */
function hash3(seed, x, y) {
  // Fold coordinates into a single 32-bit integer, then run two mulberry steps.
  let a = (seed ^ (x * 0x9E3779B9) ^ (y * 0x6C62272E)) >>> 0;
  a = (a + 0x6D2B79F5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * smoothValueNoise(seed, x, y) → float in [0, 1)
 *
 * Bilinear-interpolated value noise on a 4×4 lattice so adjacent tiles
 * blend smoothly into coherent water / marsh / land regions.
 */
function smoothValueNoise(seed, x, y) {
  // Lattice cell
  const ix = Math.floor(x / 4);
  const iy = Math.floor(y / 4);
  const fx = (x / 4) - ix;   // 0..1 within cell
  const fy = (y / 4) - iy;

  // Corner values
  const v00 = hash3(seed, ix,     iy    );
  const v10 = hash3(seed, ix + 1, iy    );
  const v01 = hash3(seed, ix,     iy + 1);
  const v11 = hash3(seed, ix + 1, iy + 1);

  // Smooth step (quintic)
  const ux = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const uy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);

  return v00 * (1 - ux) * (1 - uy)
       + v10 *      ux  * (1 - uy)
       + v01 * (1 - ux) *      uy
       + v11 *      ux  *      uy;
}

/**
 * tileTypeFromNoise(seed, tx, ty) → 'water' | 'marsh' | 'land'
 *
 * Two-octave noise for richer clustering.  Thresholds tuned so that
 * roughly 25% water / 35% marsh / 40% land on a typical 8×8 grid.
 * 'source' tiles are reserved for the stressor node and set by the
 * generator — we never override those.
 */
function tileTypeFromNoise(seed, tx, ty) {
  const n1 = smoothValueNoise(seed,       tx,     ty    );
  const n2 = smoothValueNoise(seed + 137, tx * 2, ty * 2);
  const n  = n1 * 0.7 + n2 * 0.3;
  if (n < 0.28)  return 'water';
  if (n < 0.55)  return 'marsh';
  return 'land';
}

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
 * _biomeFilter(H) → CSS filter string
 *
 * Maps ecosystem_health (0–100) to a dramatic visual shift:
 *   H=0   → very desaturated (15%), dark (70%), warm-brown sepia cast
 *   H=50  → mid-point (65% sat, 90% brightness)
 *   H=100 → fully saturated (130%), bright (110%), slight cool hue boost
 *
 * Applied as a ctx.filter before drawing any tile, giving the whole biome
 * a coherent sick→lush arc that players immediately notice.
 */
function _biomeFilter(H) {
  const t = Math.max(0, Math.min(1, H / 100));

  // Saturation: 15% at H=0 → 100% at H~60 → 130% at H=100
  const sat = Math.round(15 + 115 * t);

  // Brightness: 68% at H=0 → 100% at H~65 → 110% at H=100
  const bri = Math.round(68 + 42 * t);

  // Sepia: heavy at low health (muddy wetland), none at high health
  const sep = Math.round(Math.max(0, (1 - t * 2)) * 55); // 55% → 0% over bottom half

  // Hue-rotate: slight warm shift (+10°) when sick, slight cool (-6°) when pristine
  const hue = Math.round(10 - 16 * t); // +10 at H=0, -6 at H=100

  return `saturate(${sat}%) brightness(${bri}%) sepia(${sep}%) hue-rotate(${hue}deg)`;
}

/**
 * drawTileGrid(state, ctx, metrics)
 *
 * Visual design:
 *   (A) GLOBAL vibrancy: ctx.filter driven by ecosystem_health creates a
 *       dramatic sick (desaturated, dim, sepia) → lush (saturated, bright)
 *       arc across the entire biome.
 *   (B) PER-TILE type: deterministic value-noise field (seeded from
 *       meta.seed, no Math.random) clusters water/marsh/land into coherent
 *       geographic regions instead of a checkerboard.
 *       'source' tiles from the generator are never overridden.
 *   (C) TOXIC crossfade: per-tile stressor level drives the pollution
 *       sprite on top of the healthy sprite (keeps Rule 01 fallback).
 */
function drawTileGrid(state, ctx, metrics, timestamp = 0) {
  const H    = _easeHealth(state.meta.ecosystem_health);   // 0–100, eased for smooth transitions
  const seed = state.meta.seed ?? 12345;

  // Flat-colour fallback health fraction (used only when sprites are absent)
  const healthFrac = 0.25 + 0.20 * Math.max(0, Math.min(1, H / 100));

  // ── (A) Set global biome filter for all tiles ────────────────────────────
  // We apply filter once on ctx.save() scope wrapping the whole tile layer.
  // Grid lines and protected borders are drawn OUTSIDE this filter scope
  // so they always remain crisp and readable.
  ctx.save();
  ctx.filter = _biomeFilter(H);

  for (const [tileId, tile] of Object.entries(state.world.tiles)) {
    const { x, y, w, h } = tilePx(tileId, state, metrics);
    const L = tile.stressor ?? 0;              // 0–100
    const stressFrac = Math.max(0, Math.min(1, L / 100));

    // ── (B) Noise-based tile type (never override 'source') ──────────────
    let tx, ty;
    if (tile.x !== undefined) {
      tx = tile.x; ty = tile.y;
    } else {
      const parts = tileId.split('_');
      tx = parseInt(parts[1], 10);
      ty = parseInt(parts[2], 10);
    }
    const type = tile.type === 'source'
      ? 'source'
      : tileTypeFromNoise(seed, tx, ty);

    // ── Biome-aware tile key ─────────────────────────────────────────────
    // On coral_reef, map wetland types to reef equivalents before the lookup.
    // Wetland worlds: tileKey === type (byte-identical to previous behaviour).
    // Reef worlds: each type maps to a reef-specific art name; if the PNG is
    // absent the existing procedural flat-colour fallback fires — we do NOT fall
    // back to the wetland sprites (mixing grass art into a reef would look wrong).
    let tileKey = type;
    if (state.meta.biome_template === 'coral_reef') {
      switch (type) {
        case 'water':  tileKey = 'reefwater'; break;
        case 'marsh':  tileKey = 'sand';      break;
        case 'land':   tileKey = 'reef';      break;
        case 'source': tileKey = 'sediment';  break;
        // unknown future types: fall through to tileKey === type
      }
    }
    const spriteHealthy = getSprite(`tile_${tileKey}`);
    const spriteToxic   = getSprite(`tile_${tileKey}_toxic`);

    if (spriteHealthy) {
      // ── Sprite path ──────────────────────────────────────────────────
      // Deterministic per-tile mirror (4 orientations) breaks the visible
      // "stamped texture" repetition. Same orientation for healthy + toxic so
      // they align. +1px overdraw hides hairline seams between adjacent tiles.
      const o  = (hash3(seed, tx + 17, ty + 31) * 4) | 0; // 0..3
      const fx = (o & 1) ? -1 : 1;
      const fy = (o & 2) ? -1 : 1;

      // Round the corners of marsh/water tiles that border a DIFFERENT type, over
      // a dirt base — turns blocky rectangular terrain boundaries into organic
      // curves (grass-patch-on-soil / lake-with-banks), no transition tileset needed.
      const rounded = (type === 'marsh' || type === 'water');
      ctx.save();
      if (rounded) {
        const dirt = getSprite('tile_land');
        if (dirt) ctx.drawImage(dirt, x - 0.5, y - 0.5, w + 1, h + 1); // base shows at rounded corners
        const R = Math.min(w, h) * 0.5;
        const same = (dx, dy) => {
          const nt = typeAtTile(state, seed, tx + dx, ty + dy);
          return (nt === null ? type : nt) === type; // off-grid = same → don't round map border
        };
        const rTL = (!same(0, -1) && !same(-1, 0)) ? R : 0;
        const rTR = (!same(0, -1) && !same(1, 0)) ? R : 0;
        const rBR = (!same(0, 1) && !same(1, 0)) ? R : 0;
        const rBL = (!same(0, 1) && !same(-1, 0)) ? R : 0;
        if (rTL || rTR || rBR || rBL) {
          ctx.beginPath();
          ctx.roundRect(x, y, w, h, [rTL, rTR, rBR, rBL]);
          ctx.clip();
        }
      }
      ctx.translate(x + w / 2, y + h / 2);
      ctx.scale(fx, fy);
      ctx.globalAlpha = 1;
      ctx.drawImage(spriteHealthy, -w / 2 - 0.5, -h / 2 - 0.5, w + 1, h + 1);
      if (spriteToxic && stressFrac > 0) {
        ctx.globalAlpha = stressFrac * 0.85;
        ctx.drawImage(spriteToxic, -w / 2 - 0.5, -h / 2 - 0.5, w + 1, h + 1);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
    } else {
      // ── Flat-colour fallback ─────────────────────────────────────────
      const base  = tileBaseColor(type);
      const step1 = lerpColor(base, C.TILE_TOXIC, stressFrac * 0.75);
      const step2 = lerpColor(step1, C.TILE_HEALTHY, healthFrac);
      ctx.fillStyle = step2;
      ctx.fillRect(x, y, w, h);
    }

    // Animated water shimmer (time-based, deterministic — no Math.random)
    if (type === 'water') drawWaterShimmer(ctx, x, y, w, h, tx, ty, timestamp);
  }

  // ── Restore normal filter before drawing grid lines / borders ───────────
  ctx.restore();

  // ── Shoreline foam + banks where water meets land (organic lakes) ───────────
  drawShorelines(state, ctx, metrics, seed, timestamp);

  // ── Protected-zone borders only (no ambient grid — keeps the biome organic) ──
  for (const [tileId, tile] of Object.entries(state.world.tiles)) {
    if (!tile.protected) continue;
    const { x, y, w, h } = tilePx(tileId, state, metrics);
    ctx.strokeStyle = C.ACCENT;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    ctx.setLineDash([]);
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
 * _spriteKeyForNode(node) → { healthy: string, extinct: string|null }
 *
 * Maps node.id to its sprite names.
 * Convention: node ids are 'n_seagrass', 'n_shrimp', 'n_heron', 'n_runoff'.
 * Strip the 'n_' prefix to get the sprite suffix.
 *
 * Special case — kind === 'invasive': sprite is resolved from node.name so
 * each biome's invasive gets distinct art without changing its node id:
 *   'Mozambique Tilapia' → 'sprite_tilapia'
 *   'Lionfish'           → 'sprite_lionfish'
 *   (unknown)            → generic 'sprite_${suffix}' (forward-compat fallback)
 * Invasive nodes have no dedicated extinct variant — healthy key is reused for
 * any fallback rendering; the renderer already handles a missing extinct gracefully.
 */
function _spriteKeyForNode(node) {
  if (node.kind === 'invasive') {
    let healthyKey;
    switch (node.name) {
      case 'Mozambique Tilapia': healthyKey = 'sprite_tilapia';  break;
      case 'Lionfish':           healthyKey = 'sprite_lionfish'; break;
      default: {
        const suffix = node.id.replace(/^n_/, '');
        healthyKey = `sprite_${suffix}`;
      }
    }
    return { healthy: healthyKey, extinct: `${healthyKey}_extinct` };
  }
  const suffix = node.id.replace(/^n_/, '');
  return {
    healthy: `sprite_${suffix}`,
    extinct: `sprite_${suffix}_extinct`,
  };
}

/**
 * drawNodes(state, ctx, metrics, timestamp)
 *
 * Proximity fog-of-species logic (UNDISCOVERED non-stressor nodes only):
 *   dist > TERRITORY_RADIUS  → completely hidden (nothing drawn)
 *   dist ≤ TERRITORY_RADIUS  → faded ghost with an animated bouncing "!" above
 *   discovered               → full render with labels (unchanged)
 *
 * Distance metric: Chebyshev (max of |Δx|, |Δy|) in tiles, so diagonals count.
 * This function is READ-ONLY (Rule 03 — no state writes).
 *
 * When sprite loaded (getSprite returns non-null):
 *   - extinct:  draws the _extinct variant (or fades base if no extinct sprite)
 *   - living:   draws sprite scaled by population/K_max; keystone + endangered
 *               rings drawn on top via canvas primitives
 *
 * Fallback (sprite not loaded): original circle / diamond shapes.
 */
function drawNodes(state, ctx, metrics, timestamp) {
  const BASE_R = Math.min(metrics.tileW, metrics.tileH) * 0.32;
  const SPRITE_BASE = Math.min(metrics.tileW, metrics.tileH) * 0.72; // max sprite draw size

  const px = state.player.tile_x;
  const py = state.player.tile_y;

  for (const node of Object.values(state.world.nodes)) {
    const centre = nodeCentre(node.id, state, metrics);
    if (!centre) continue;
    const { cx, cy } = centre;

    // ── Stressor node: sprite_runoff or pulsing red diamond ─────────────────
    if (node.kind === 'stressor') {
      const runoffSprite = getSprite('sprite_runoff');
      const pulse = 0.7 + 0.3 * Math.sin(timestamp / 600);
      const size  = SPRITE_BASE * 0.55 * pulse;
      if (runoffSprite) {
        ctx.save();
        ctx.globalAlpha = 0.88 * pulse;
        ctx.drawImage(runoffSprite, cx - size / 2, cy - size / 2, size, size);
        ctx.restore();
      } else {
        // Fallback: pulsing diamond
        const ds = BASE_R * 0.7 * pulse;
        ctx.save();
        ctx.globalAlpha = 0.85;
        ctx.fillStyle   = C.NODE_STRESSOR;
        ctx.translate(cx, cy);
        ctx.rotate(Math.PI / 4);
        ctx.fillRect(-ds / 2, -ds / 2, ds, ds);
        ctx.restore();
        ctx.fillStyle    = C.TEXT_LIGHT;
        ctx.font         = `bold ${Math.round(BASE_R * 0.7)}px monospace`;
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha  = 0.9;
        ctx.fillText('!', cx, cy);
        ctx.globalAlpha  = 1;
      }
      continue;
    }

    // ── Proximity fog-of-species for UNDISCOVERED non-stressor nodes ─────────
    if (!node.discovered) {
      // Chebyshev distance from player to this node's tile
      const tile = state.world.tiles[node.tileId];
      let ntx, nty;
      if (tile && tile.x !== undefined) { ntx = tile.x; nty = tile.y; }
      else { const p = node.tileId.split('_'); ntx = +p[1]; nty = +p[2]; }
      const dist = Math.max(Math.abs(ntx - px), Math.abs(nty - py));

      if (dist > TERRITORY_RADIUS) continue; // completely hidden — draw nothing

      // ── Within territory: draw faded ghost + bouncing "!" ────────────────
      const { healthy } = _spriteKeyForNode(node);
      const sprite = getSprite(healthy);
      const ghostSize = SPRITE_BASE * 0.55;
      ctx.save();
      ctx.globalAlpha = 0.18 + 0.07 * Math.sin(timestamp / 900 + cx);
      ctx.filter = 'grayscale(80%) brightness(0.7)';
      if (sprite) {
        ctx.drawImage(sprite, cx - ghostSize / 2, cy - ghostSize / 2, ghostSize, ghostSize);
      } else {
        ctx.fillStyle = nodeColor(node.kind);
        ctx.beginPath();
        ctx.arc(cx, cy, BASE_R * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Prominent bouncing "!" alert badge above the ghost — high-contrast pin
      const bangBob = Math.sin(timestamp / 360 + cx * 0.05) * 6;
      const rBadge  = Math.max(12, metrics.tileH * 0.30);
      const bangY   = cy - ghostSize * 0.7 - rBadge - 4 + bangBob;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.beginPath(); ctx.arc(cx, bangY + 3, rBadge, 0, Math.PI * 2); ctx.fill();
      // little pointer tail toward the species
      ctx.beginPath();
      ctx.moveTo(cx - rBadge * 0.4, bangY + rBadge * 0.6);
      ctx.lineTo(cx + rBadge * 0.4, bangY + rBadge * 0.6);
      ctx.lineTo(cx, bangY + rBadge * 1.4);
      ctx.closePath();
      ctx.fillStyle = C.ACCENT; ctx.fill();
      // gold badge + white ring
      ctx.fillStyle = C.ACCENT;
      ctx.beginPath(); ctx.arc(cx, bangY, rBadge, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = Math.max(2, rBadge * 0.14);
      ctx.strokeStyle = '#fff';
      ctx.beginPath(); ctx.arc(cx, bangY, rBadge, 0, Math.PI * 2); ctx.stroke();
      // dark exclamation
      ctx.fillStyle = '#1a1208';
      ctx.font = `bold ${Math.round(rBadge * 1.5)}px monospace`;
      ctx.fillText('!', cx, bangY + 1);
      ctx.restore();

      continue; // skip the normal drawing below
    }

    // ── Extinct node ─────────────────────────────────────────────────────────
    if (node.status === 'extinct') {
      const { extinct, healthy } = _spriteKeyForNode(node);
      const extSprite  = getSprite(extinct);
      const baseSprite = getSprite(healthy);
      const size       = SPRITE_BASE * 0.62;
      if (extSprite) {
        ctx.save();
        ctx.globalAlpha = 0.30;
        ctx.drawImage(extSprite, cx - size / 2, cy - size / 2, size, size);
        ctx.restore();
      } else if (baseSprite) {
        // Faded base as fallback extinct visual
        ctx.save();
        ctx.globalAlpha = 0.20;
        ctx.filter = 'grayscale(100%)';
        ctx.drawImage(baseSprite, cx - size / 2, cy - size / 2, size, size);
        ctx.filter = 'none';
        ctx.restore();
      } else {
        // Shape fallback
        ctx.save();
        ctx.globalAlpha = 0.25;
        ctx.fillStyle   = C.NODE_EXTINCT;
        ctx.beginPath();
        ctx.arc(cx, cy, BASE_R * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#888';
        ctx.lineWidth   = 1.5;
        const d = BASE_R * 0.3;
        ctx.beginPath();
        ctx.moveTo(cx - d, cy - d); ctx.lineTo(cx + d, cy + d);
        ctx.moveTo(cx + d, cy - d); ctx.lineTo(cx - d, cy + d);
        ctx.stroke();
        ctx.restore();
      }
      continue;
    }

    // ── Living node ──────────────────────────────────────────────────────────
    const relPop  = node.K_max > 0
      ? Math.max(0, Math.min(1, node.population / node.K_max))
      : 0;
    const opacity = 0.25 + 0.75 * relPop;
    const { healthy } = _spriteKeyForNode(node);
    const sprite  = getSprite(healthy);

    // Discovery scale-pop: 1.35 → 1.0 over ~400ms the first time a node is drawn discovered.
    const pop = _popScale(node.id, timestamp);

    if (sprite) {
      // Scale sprite by population (min 40% size, max 100%), then apply pop scale
      const scaledSize = SPRITE_BASE * (0.40 + 0.60 * Math.sqrt(relPop)) * pop;
      // Soft ground shadow lifts the sprite off the tile (depth)
      ctx.save();
      ctx.globalAlpha = opacity * 0.35;
      ctx.fillStyle   = '#000';
      ctx.beginPath();
      ctx.ellipse(cx, cy + scaledSize * 0.34, scaledSize * 0.30, scaledSize * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      // Gentle idle bob so living species feel alive (shadow stays grounded)
      const bob = Math.sin(timestamp / 700 + cx * 0.05 + cy * 0.03) * scaledSize * 0.05;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.drawImage(sprite,
        cx - scaledSize / 2, cy - scaledSize / 2 + bob,
        scaledSize, scaledSize);

      // Keystone accent ring on top of sprite
      if (node.keystone) {
        ctx.globalAlpha = Math.min(1, opacity + 0.25);
        ctx.strokeStyle = C.ACCENT;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, scaledSize / 2 + 4, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Endangered pulse glow
      if (node.status === 'endangered') {
        const glow = 0.4 + 0.6 * Math.abs(Math.sin(timestamp / 400));
        ctx.globalAlpha = glow * 0.65;
        ctx.strokeStyle = C.DANGER;
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, scaledSize / 2 + 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // ── Shape fallback ─────────────────────────────────────────────────
      const radius = BASE_R * (0.35 + 0.65 * Math.sqrt(relPop)) * pop;
      const color  = nodeColor(node.kind);
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.fill();
      if (node.keystone) {
        ctx.globalAlpha = Math.min(1, opacity + 0.2);
        ctx.strokeStyle = C.ACCENT;
        ctx.lineWidth   = 1.8;
        ctx.beginPath();
        ctx.arc(cx, cy, radius + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
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
    }

    // Node name label (only for discovered nodes — undiscovered hit 'continue' above)
    if (node.discovered) {
      const labelY = sprite
        ? cy + (SPRITE_BASE * (0.40 + 0.60 * Math.sqrt(relPop))) / 2 + 3
        : cy + BASE_R * (0.35 + 0.65 * Math.sqrt(relPop)) + 3;
      ctx.save();
      ctx.globalAlpha  = Math.max(0.4, opacity);
      ctx.fillStyle    = C.TEXT_LIGHT;
      ctx.font         = `${Math.max(8, Math.round(metrics.tileH * 0.16))}px monospace`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'top';
      const label = node.name.length > 12 ? node.name.slice(0, 11) + '…' : node.name;
      ctx.fillText(label, cx, labelY);
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
 * Primary path — player.png spritesheet (COLS=4 frames × ROWS=4 directions):
 *   • Renderer-local pixel position eases toward the player's tile centre each
 *     frame (snaps on large jumps / new game). Rule 03: no GameState writes.
 *   • Walk frame advances at PLAYER_WALK_FPS (8 fps) while the avatar is still
 *     moving; held at frame 0 when idle.
 *   • Sprite is drawn BOTTOM-ANCHORED on the eased position, scaled 1.4× a tile,
 *     with a soft elliptical ground shadow beneath it.
 *   • Tile highlight and "L nn" stressor readout always drawn (both paths).
 *
 * Fallback — if player.png is absent but agent.png is loaded, uses agent.png
 * (centred, as before). If neither is loaded, falls back to the crosshair.
 */
function drawAgent(state, ctx, metrics, timestamp) {
  const { tile_x: tx, tile_y: ty, facing = 'down' } = state.player;
  const tileX  = metrics.offsetX + tx * metrics.tileW;
  const tileY  = metrics.offsetY + ty * metrics.tileH;
  const tileW  = metrics.tileW;
  const tileH  = metrics.tileH;

  // Target pixel centre of the player's tile
  const targetX = tileX + tileW / 2;
  const targetY = tileY + tileH / 2;

  // ── Ease pixel position (renderer-local, NOT GameState) ──────────────────
  if (_agentPixel === null || Math.hypot(targetX - _agentPixel.x, targetY - _agentPixel.y) > tileW * 3) {
    // Snap on first frame or after a large teleport (new game / seed change)
    _agentPixel = { x: targetX, y: targetY };
  } else {
    // α = 0.22 per frame @60 fps → residual after 13 frames (~220 ms) < 2 px,
    // so the avatar arrives at the next tile just as the hold-to-walk step fires,
    // producing continuous gliding motion rather than snap-then-wait.
    _agentPixel.x += (targetX - _agentPixel.x) * 0.22;
    _agentPixel.y += (targetY - _agentPixel.y) * 0.22;
  }
  const { x: easedX, y: easedY } = _agentPixel;

  // Is the avatar still in motion? (threshold: 0.5px)
  const moving = Math.hypot(targetX - easedX, targetY - easedY) > 0.5;

  // ── Advance walk frame at PLAYER_WALK_FPS while moving ───────────────────
  if (moving) {
    const dt = Math.min(100, timestamp - _agentLastTs); // cap at 100ms to avoid jumps
    if (dt > 0) {
      // Accumulate fractional frame advance; integer part ticks _agentFrame
      const advance = dt / 1000 * PLAYER_WALK_FPS;
      _agentFrame = (_agentFrame + advance) % PLAYER_COLS;
    }
  } else {
    _agentFrame = 0; // idle → rest pose (frame 0)
  }
  _agentLastTs = timestamp;

  // ── Tile highlight (always, under the avatar) ────────────────────────────
  const pulse = 0.3 + 0.2 * Math.sin(timestamp / 500);
  ctx.save();
  ctx.fillStyle = `rgba(240, 165, 0, ${pulse})`;
  ctx.fillRect(tileX + 2, tileY + 2, tileW - 4, tileH - 4);
  ctx.restore();

  // ── Draw avatar ──────────────────────────────────────────────────────────
  const playerSheet = getSprite('player');
  const agentSprite = getSprite('agent');

  if (playerSheet) {
    // ── Spritesheet path ─────────────────────────────────────────────────
    const frameW  = playerSheet.naturalWidth  / PLAYER_COLS;
    const frameH  = playerSheet.naturalHeight / PLAYER_ROWS;
    const row     = _facingRow(facing);
    const col     = Math.floor(_agentFrame) % PLAYER_COLS;

    // Draw size: 1.4× tile, bottom-anchored on eased position
    const drawH   = tileH * 1.4;
    const drawW   = drawH * (frameW / frameH);  // preserve sprite aspect ratio
    const drawTop = easedY + tileH / 2 - drawH; // bottom anchor = tile bottom

    // Soft elliptical ground shadow
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle   = '#000';
    ctx.beginPath();
    ctx.ellipse(easedX, drawTop + drawH - drawH * 0.04,
                drawW * 0.28, drawH * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // Sprite frame
    ctx.save();
    ctx.globalAlpha = 0.97;
    ctx.drawImage(
      playerSheet,
      col * frameW, row * frameH, frameW, frameH,  // source rect
      easedX - drawW / 2, drawTop, drawW, drawH     // dest rect
    );
    ctx.restore();

  } else if (agentSprite) {
    // ── Legacy agent.png fallback (centred) ──────────────────────────────
    const size = Math.min(tileW, tileH) * 0.78;
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.drawImage(agentSprite, easedX - size / 2, easedY - size / 2, size, size);
    ctx.restore();

  } else {
    // ── Crosshair fallback ─────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = C.ACCENT;
    ctx.lineWidth   = 2;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(easedX, easedY, Math.min(tileW, tileH) * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle   = C.ACCENT;
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(easedX, easedY, 3, 0, Math.PI * 2);
    ctx.fill();
    const cr = Math.min(tileW, tileH) * 0.42;
    const ci = Math.min(tileW, tileH) * 0.18;
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.7;
    [[easedX - cr, easedY, easedX - ci, easedY],
     [easedX + ci, easedY, easedX + cr, easedY],
     [easedX, easedY - cr, easedX, easedY - ci],
     [easedX, easedY + ci, easedX, easedY + cr]].forEach(([ax, ay, bx, by]) => {
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    });
    ctx.restore();
  }

  // ── UX: current tile's stressor readout (bioremediation targeting aid) ───
  const curTile = state.world.tiles[`t_${tx}_${ty}`]
    || Object.values(state.world.tiles).find(t => t.x === tx && t.y === ty);
  if (curTile) {
    const L     = Math.round(curTile.stressor ?? 0);
    const col   = L > 60 ? C.DANGER : L > 30 ? C.ACCENT : '#4ccea0';
    const label = `L ${L}`;
    ctx.save();
    ctx.font         = 'bold 11px monospace';
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    const labelW = ctx.measureText(label).width + 14;
    const labelY = tileY - 9;
    ctx.fillStyle = 'rgba(10,14,20,0.88)';
    ctx.fillRect(targetX - labelW / 2, labelY - 8, labelW, 16);
    ctx.fillStyle = col;
    ctx.fillRect(targetX - labelW / 2, labelY - 8, 3, 16);
    ctx.fillText(label, targetX, labelY);
    ctx.restore();
  }
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

  // Health-leaf glyph (ui_pack index 4) or text label
  const uiPackH = getSprite('ui_pack');
  const HGLYPH  = 20;
  if (uiPackH) {
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.drawImage(uiPackH, 4 * 128, 0, 128, 128, mx, cy - HGLYPH / 2, HGLYPH, HGLYPH);
    ctx.restore();
    ctx.font      = FONT;
    ctx.fillStyle = C.TEXT_LIGHT;
    ctx.textAlign = 'left';
    ctx.fillText('HEALTH', mx + HGLYPH + 3, my - 2);
  } else {
    ctx.font = FONT;
    ctx.fillStyle = C.TEXT_LIGHT;
    ctx.textAlign = 'left';
    ctx.fillText('HEALTH', mx, my - 2);
  }

  // Bar track
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.beginPath();
  ctx.roundRect(mx, my + 10, METER_W, METER_H, 3);
  ctx.fill();

  // Bar fill — gradient by tier, eased for a smooth animated fill
  const hVal  = _dispHealth == null ? ecosystem_health : _dispHealth;
  const hFrac = Math.max(0, Math.min(1, hVal / 100));
  const fillW = Math.round(METER_W * hFrac);
  const tierCol = TIER_COLORS[market_tier] || C.TILE_HEALTHY;
  if (fillW > 0) {
    const g = ctx.createLinearGradient(mx, my + 10, mx, my + 10 + METER_H);
    g.addColorStop(0, lerpColor(tierCol, '#ffffff', 0.4));
    g.addColorStop(1, tierCol);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.roundRect(mx, my + 10, fillW, METER_H, 3);
    ctx.fill();
    // glossy top highlight
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.roundRect(mx, my + 10, fillW, METER_H * 0.42, 3);
    ctx.fill();
    ctx.restore();
  }

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
  const uiPack = getSprite('ui_pack');
  // UI_PACK glyph order: [0]scanner [1]scan-pulse [2]link [3]coin [4]health-leaf
  const GLYPH_SIZE = 22;
  if (uiPack) {
    // Scanner icon glyph (index 0)
    ctx.save();
    ctx.globalAlpha = scanner_charges > 0 ? 0.9 : 0.4;
    ctx.drawImage(uiPack, 0, 0, 128, 128, curX, cy - GLYPH_SIZE / 2, GLYPH_SIZE, GLYPH_SIZE);
    ctx.restore();
    curX += GLYPH_SIZE + 3;
  } else {
    ctx.font      = FONT;
    ctx.fillStyle = C.TEXT_LIGHT;
    ctx.textAlign = 'left';
    ctx.fillText('SCAN', curX, cy - 5);
    curX += 32;
  }
  ctx.font      = FONT_LG;
  ctx.fillStyle = scanner_charges > 0 ? C.EDGE : C.DANGER;
  ctx.textAlign = 'left';
  ctx.fillText(`${scanner_charges}`, curX, cy + 4);
  curX += 26;

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

// drawVignette — subtle radial edge-darkening for depth + cinematic framing.
// Drawn over the world layers, under the HUD. Pure cosmetic; reads nothing.
function drawVignette(ctx, w, h) {
  const grad = ctx.createRadialGradient(
    w / 2, h / 2 + C.HUD_HEIGHT / 2, Math.min(w, h) * 0.38,
    w / 2, h / 2, Math.max(w, h) * 0.72
  );
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(8,12,16,0.55)');
  ctx.save();
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Living-biome helpers (eased health, water shimmer, atmosphere particles)
// All time-based & deterministic — NO Math.random (Rule 01).
// ─────────────────────────────────────────────────────────────────────────────

let _dispHealth = null; // render-only eased health for smooth visual transitions

/**
 * _easeHealth(target) — eases a displayed health toward the real ecosystem_health
 * each frame so the global vibrancy filter transitions smoothly instead of snapping
 * on a day-step. Snaps on big jumps (new game). Render-only; mutates no state.
 */
function _easeHealth(target) {
  if (_dispHealth === null || Math.abs(target - _dispHealth) > 40) _dispHealth = target;
  else _dispHealth += (target - _dispHealth) * 0.05;
  return _dispHealth;
}

/**
 * drawWaterShimmer — animated caustic highlights on a water tile (additive, low alpha).
 */
function drawWaterShimmer(ctx, x, y, w, h, tx, ty, timestamp) {
  const t = timestamp / 1000;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.strokeStyle = 'rgba(170,220,255,0.6)';
  ctx.lineWidth = Math.max(1, w * 0.03);
  for (let k = 0; k < 2; k++) {
    const phase = t * 12 + tx * 11 + ty * 7 + k * h * 0.55;
    const yy = y + (((phase % h) + h) % h);
    ctx.globalAlpha = 0.10 + 0.08 * Math.sin(t * 1.6 + tx + ty + k);
    ctx.beginPath();
    ctx.moveTo(x, yy);
    ctx.quadraticCurveTo(x + w / 2, yy - h * 0.06, x + w, yy);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * drawAtmosphere — drifting motes that reflect ecosystem health: warm pollen /
 * fireflies rising when healthy, sickly grey haze drifting when toxic. Cosmetic,
 * deterministic motion (index + time, no Math.random).
 */
function drawAtmosphere(ctx, state, metrics, timestamp, cssW, cssH) {
  const H = _dispHealth == null ? state.meta.ecosystem_health : _dispHealth;
  const healthy = Math.max(0, Math.min(1, H / 100));
  const N = 46;
  const t = timestamp / 1000;
  const top = C.HUD_HEIGHT;
  const fieldH = Math.max(1, cssH - top);
  ctx.save();
  for (let i = 0; i < N; i++) {
    const bx = ((i * 67) % 100) / 100;
    const by = ((i * 131) % 100) / 100;
    const spd = 0.4 + (i % 6) * 0.12;
    let px, py, r, col, a;
    if (healthy >= 0.5) {
      px = bx * cssW + Math.sin(t * 0.4 + i) * 14;
      py = top + ((((by * fieldH - t * spd * 16) % fieldH) + fieldH) % fieldH);
      r = 1 + (i % 3) * 0.6;
      col = `rgb(${180 + (i % 40)},${205 + (i % 45)},${120 + (i % 60)})`;
      a = (0.10 + 0.16 * healthy) * (0.6 + 0.4 * Math.sin(t * 2 + i));
    } else {
      px = (((bx * cssW + t * spd * 20) % cssW) + cssW) % cssW;
      py = top + by * fieldH + Math.sin(t * 0.5 + i) * 8;
      r = 1.5 + (i % 4) * 0.9;
      col = 'rgb(120,110,92)';
      a = 0.05 + 0.10 * (1 - healthy);
    }
    ctx.globalAlpha = Math.max(0, Math.min(0.45, a));
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * typeAtTile — resolves the rendered type of a grid cell the same way drawTileGrid
 * does (source tiles fixed, others from the noise field). Returns null off-grid.
 */
function typeAtTile(state, seed, tx, ty) {
  const t = state.world.tiles[`t_${tx}_${ty}`]
    || Object.values(state.world.tiles).find(o => o.x === tx && o.y === ty);
  if (!t) return null;
  return t.type === 'source' ? 'source' : tileTypeFromNoise(seed, tx, ty);
}

/**
 * _foamEdge — draws a sandy bank + animated foam + light shallows along one edge
 * of a water tile (dir: 'top'|'bottom'|'left'|'right'). Drawn unfiltered so foam
 * stays bright. This is what turns rectangular water blobs into banked lakes.
 */
function _foamEdge(ctx, x, y, w, h, dir, t, ph) {
  const band = Math.max(3, w * 0.16);
  const sand = 'rgba(120,102,74,0.5)';
  const foam = `rgba(232,248,255,${0.38 + 0.22 * Math.sin(t * 3 + ph)})`;
  ctx.save();
  if (dir === 'top') {
    ctx.fillStyle = sand; ctx.fillRect(x, y - band * 0.45, w, band * 0.45);
    const g = ctx.createLinearGradient(0, y, 0, y + band);
    g.addColorStop(0, 'rgba(196,232,248,0.45)'); g.addColorStop(1, 'rgba(196,232,248,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, band);
    ctx.fillStyle = foam; ctx.fillRect(x, y - 1, w, 2);
  } else if (dir === 'bottom') {
    ctx.fillStyle = sand; ctx.fillRect(x, y + h, w, band * 0.45);
    const g = ctx.createLinearGradient(0, y + h, 0, y + h - band);
    g.addColorStop(0, 'rgba(196,232,248,0.45)'); g.addColorStop(1, 'rgba(196,232,248,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y + h - band, w, band);
    ctx.fillStyle = foam; ctx.fillRect(x, y + h - 1, w, 2);
  } else if (dir === 'left') {
    ctx.fillStyle = sand; ctx.fillRect(x - band * 0.45, y, band * 0.45, h);
    const g = ctx.createLinearGradient(x, 0, x + band, 0);
    g.addColorStop(0, 'rgba(196,232,248,0.45)'); g.addColorStop(1, 'rgba(196,232,248,0)');
    ctx.fillStyle = g; ctx.fillRect(x, y, band, h);
    ctx.fillStyle = foam; ctx.fillRect(x - 1, y, 2, h);
  } else {
    ctx.fillStyle = sand; ctx.fillRect(x + w, y, band * 0.45, h);
    const g = ctx.createLinearGradient(x + w, 0, x + w - band, 0);
    g.addColorStop(0, 'rgba(196,232,248,0.45)'); g.addColorStop(1, 'rgba(196,232,248,0)');
    ctx.fillStyle = g; ctx.fillRect(x + w - band, y, band, h);
    ctx.fillStyle = foam; ctx.fillRect(x + w - 1, y, 2, h);
  }
  ctx.restore();
}

/**
 * drawShorelines — for every water tile, draw foam/banks on each edge that borders
 * a non-water cell, so water bodies read as organic lakes with shores.
 */
function drawShorelines(state, ctx, metrics, seed, timestamp) {
  const t = timestamp / 1000;
  const dirs = [[0, -1, 'top'], [0, 1, 'bottom'], [-1, 0, 'left'], [1, 0, 'right']];
  for (const [tileId, tile] of Object.entries(state.world.tiles)) {
    let tx, ty;
    if (tile.x !== undefined) { tx = tile.x; ty = tile.y; }
    else { const p = tileId.split('_'); tx = +p[1]; ty = +p[2]; }
    const type = tile.type === 'source' ? 'source' : tileTypeFromNoise(seed, tx, ty);
    if (type !== 'water') continue;
    const { x, y, w, h } = tilePx(tileId, state, metrics);

    // Clip the foam to the SAME rounded corners the water fill uses, so the
    // water border curves with the tile instead of staying square.
    const R = Math.min(w, h) * 0.5;
    const sameWater = (dx, dy) => {
      const nt = typeAtTile(state, seed, tx + dx, ty + dy);
      return (nt === null ? 'water' : nt) === 'water';
    };
    const radii = [
      (!sameWater(0, -1) && !sameWater(-1, 0)) ? R : 0, // TL
      (!sameWater(0, -1) && !sameWater(1, 0))  ? R : 0, // TR
      (!sameWater(0, 1)  && !sameWater(1, 0))  ? R : 0, // BR
      (!sameWater(0, 1)  && !sameWater(-1, 0)) ? R : 0, // BL
    ];

    ctx.save();
    if (radii.some(r => r > 0)) {
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, radii);
      ctx.clip();
    }
    for (const [dx, dy, dir] of dirs) {
      const nt = typeAtTile(state, seed, tx + dx, ty + dy);
      if (!nt || nt === 'water') continue; // only at water↔land boundaries
      _foamEdge(ctx, x, y, w, h, dir, t, tx + ty);
    }
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Proximity discovery constants (renderer uses these for the fog-of-species UI)
// ─────────────────────────────────────────────────────────────────────────────
/** Species hidden beyond this tile-distance from the player (Chebyshev). */
export const TERRITORY_RADIUS = 3;
/** Auto-discover a species when the player enters this tile-distance. */
export const DISCOVER_RADIUS  = 1.4;

// ─────────────────────────────────────────────────────────────────────────────
// Player spritesheet constants
// Sheet layout: COLS=4 walk frames × ROWS=4 directions.
// Row order is exposed as constants so it's trivial to flip if the asset ships
// with a different row order (just edit these four lines).
// ─────────────────────────────────────────────────────────────────────────────
const PLAYER_COLS        = 4;   // walk-animation frames per direction row
const PLAYER_ROWS        = 4;   // one row per facing direction
const PLAYER_ROW_DOWN    = 0;
const PLAYER_ROW_LEFT    = 1;
const PLAYER_ROW_RIGHT   = 2;
const PLAYER_ROW_UP      = 3;
const PLAYER_WALK_FPS    = 8;   // walk-frame advances 8 times per second

/** _facingRow(facing) → spritesheet row index */
function _facingRow(facing) {
  switch (facing) {
    case 'up':    return PLAYER_ROW_UP;
    case 'left':  return PLAYER_ROW_LEFT;
    case 'right': return PLAYER_ROW_RIGHT;
    default:      return PLAYER_ROW_DOWN;  // 'down' + fallback
  }
}

// Renderer-local animation state — NOT part of GameState (Rule 03).
// _agentPixel: eased pixel position (x, y) of the player avatar.
// _agentFrame: current walk-animation column index (0..PLAYER_COLS-1).
// _agentLastTs: previous timestamp, used to advance frame at PLAYER_WALK_FPS.
let _agentPixel  = null;   // { x, y } in CSS pixels; null = not yet initialised
let _agentFrame  = 0;      // 0..PLAYER_COLS-1
let _agentLastTs = 0;

// ─────────────────────────────────────────────────────────────────────────────
// Discovery scale-pop — renderer-local map of nodeId → timestamp when first
// discovered. drawNodes reads this to apply a 1.35→1.0 scale over ~400ms.
// No GameState writes (Rule 03).
// ─────────────────────────────────────────────────────────────────────────────
const _discoveredAt = new Map(); // nodeId → performance.now() at discovery

/** Called by main.js immediately after a node is discovered. */
export function markNodeDiscovered(nodeId) {
  if (!_discoveredAt.has(nodeId)) {
    _discoveredAt.set(nodeId, performance.now());
  }
}

/** Scale factor for the discovery pop (1.35 → 1.0 over POP_MS). Read-only. */
const _POP_MS = 400;
function _popScale(nodeId, timestamp) {
  const t0 = _discoveredAt.get(nodeId);
  if (t0 === undefined) return 1;
  const age = timestamp - t0;
  if (age >= _POP_MS) return 1;
  const frac = age / _POP_MS;
  // Ease out cubic: starts at 1.35, arrives at 1.0
  const ease = 1 - (1 - frac) * (1 - frac) * (1 - frac);
  return 1.35 - 0.35 * ease;
}

// ─────────────────────────────────────────────────────────────────────────────
// Clean-burst effect — one-shot green expanding ring + rising sparkle dots
// on a tile after successful bioremediation. Renderer-local registry only.
// ─────────────────────────────────────────────────────────────────────────────
const _cleanBursts = [];
const _CLEAN_MS = 600;

/**
 * pingCleanEffect(tx, ty) — register a one-shot "clean burst" on tile (tx, ty).
 * Called by main.js after a successful bioremediation intervention.
 * Deterministic sparkle scatter uses tx/ty + index, NO Math.random (Rule 01).
 *
 * @param {number} tx  tile x coord
 * @param {number} ty  tile y coord
 */
export function pingCleanEffect(tx, ty) {
  _cleanBursts.push({ tx, ty, t0: performance.now() });
  if (_cleanBursts.length > 8) _cleanBursts.shift();
}

function drawCleanBursts(ctx, metrics, timestamp) {
  for (let i = _cleanBursts.length - 1; i >= 0; i--) {
    const b   = _cleanBursts[i];
    const age = timestamp - b.t0;
    if (age < 0 || age > _CLEAN_MS) { _cleanBursts.splice(i, 1); continue; }
    const frac = age / _CLEAN_MS;
    const cx   = metrics.offsetX + b.tx * metrics.tileW + metrics.tileW / 2;
    const cy   = metrics.offsetY + b.ty * metrics.tileH + metrics.tileH / 2;
    const maxR = Math.max(metrics.tileW, metrics.tileH) * 1.1;

    ctx.save();

    // ── Green expanding ring ──────────────────────────────────────────────
    const ringAlpha = (1 - frac) * 0.72;
    ctx.globalAlpha = ringAlpha;
    ctx.strokeStyle = '#4ccea0';
    ctx.lineWidth   = 3 * (1 - frac) + 1;
    ctx.beginPath();
    ctx.arc(cx, cy, frac * maxR, 0, Math.PI * 2);
    ctx.stroke();
    // Second ring offset by 120ms
    if (frac > 0.2) {
      const f2 = (frac - 0.2) / 0.8;
      ctx.globalAlpha = (1 - f2) * 0.45;
      ctx.lineWidth   = 2 * (1 - f2) + 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, f2 * maxR * 0.75, 0, Math.PI * 2);
      ctx.stroke();
    }

    // ── Rising sparkle dots (deterministic scatter — tx/ty + index, no Math.random) ──
    const N_SPARKS = 6;
    for (let k = 0; k < N_SPARKS; k++) {
      // Deterministic angle and speed per sparkle via hash3-style formula
      const angleBase = (k / N_SPARKS) * Math.PI * 2 + (b.tx * 0.37 + b.ty * 0.53 + k * 1.13);
      const speedR    = 0.45 + ((k * 7 + b.tx * 3 + b.ty * 5) % 10) / 10 * 0.4; // 0.45–0.85
      const r         = frac * maxR * speedR;
      const riseY     = -frac * metrics.tileH * 0.55; // rise upward over time
      const sx        = cx + Math.cos(angleBase) * r;
      const sy        = cy + Math.sin(angleBase) * r * 0.35 + riseY; // compressed vertically
      const dotR      = Math.max(1.5, metrics.tileW * 0.055) * (1 - frac);
      const dotAlpha  = (1 - frac) * 0.85;
      ctx.globalAlpha = dotAlpha;
      ctx.fillStyle   = k % 2 === 0 ? '#4ccea0' : '#b8ffd8';
      ctx.beginPath();
      ctx.arc(sx, sy, dotR, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas flash — full-canvas white overlay that fades for a tier-up moment.
// Renderer-local; no GameState writes (Rule 03).
// ─────────────────────────────────────────────────────────────────────────────
let _flashUntil = 0;   // performance.now() timestamp when flash should have fully faded
let _flashMs    = 300; // duration of each flash

/**
 * flashCanvas(durationMs) — trigger a brief full-canvas white flash.
 * Called by main.js on tier-up. Renderer draws a fading white overlay.
 * @param {number} [durationMs=300]
 */
export function flashCanvas(durationMs = 300) {
  _flashMs    = durationMs;
  _flashUntil = performance.now() + durationMs;
}

// ─────────────────────────────────────────────────────────────────────────────
// Guided-tile highlight — captain's coach pulsing outline
// Set by main.js when the coach wants the player to walk to a specific tile.
// Cleared (null) when the player is on that tile or the cause is resolved.
// ─────────────────────────────────────────────────────────────────────────────
let _guidedTileId = null;

/**
 * setGuidedTile(tileId) — register a tile to receive a pulsing guide outline.
 * Pass null to clear.
 * @param {string|null} tileId
 */
export function setGuidedTile(tileId) {
  _guidedTileId = tileId ?? null;
}

function drawGuidedTile(state, ctx, metrics, timestamp) {
  if (!_guidedTileId) return;
  const tile = state.world?.tiles?.[_guidedTileId];
  if (!tile) return;
  const { x, y, w, h } = tilePx(_guidedTileId, state, metrics);
  const pulse = 0.55 + 0.45 * Math.sin(timestamp / 320); // 0.1 → 1.0, ~2 Hz
  ctx.save();
  ctx.strokeStyle = `rgba(240, 165, 0, ${pulse})`;
  ctx.lineWidth   = 2.5;
  ctx.setLineDash([5, 3]);
  ctx.shadowColor  = 'rgba(240, 165, 0, 0.6)';
  ctx.shadowBlur   = 8;
  ctx.strokeRect(x + 2, y + 2, w - 4, h - 4);
  ctx.setLineDash([]);
  ctx.restore();
}

function drawCanvasFlash(ctx, cssW, cssH, timestamp) {
  if (timestamp >= _flashUntil) return;
  const age   = _flashMs - (_flashUntil - timestamp);
  const frac  = Math.max(0, Math.min(1, age / _flashMs)); // 0 → 1
  const alpha = (1 - frac) * 0.55; // fade from 0.55 → 0
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle   = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan-ripple effect — expanding rings when a tile is successfully scanned.
// Self-contained: listens for the 'ecosystemx:scan' event (input.js dispatches it).
// ─────────────────────────────────────────────────────────────────────────────
const _ripples = [];
const _RIPPLE_MS = 750;
if (typeof window !== 'undefined') {
  window.addEventListener('ecosystemx:scan', (e) => {
    if (e.detail && e.detail.discovered) {
      _ripples.push({ tx: e.detail.tx, ty: e.detail.ty, t0: performance.now() });
      if (_ripples.length > 12) _ripples.shift();
    }
  });
}

function drawScanRipples(ctx, metrics, timestamp) {
  for (let i = _ripples.length - 1; i >= 0; i--) {
    const rp = _ripples[i];
    const age = timestamp - rp.t0;
    if (age < 0 || age > _RIPPLE_MS) { _ripples.splice(i, 1); continue; }
    const cx = metrics.offsetX + rp.tx * metrics.tileW + metrics.tileW / 2;
    const cy = metrics.offsetY + rp.ty * metrics.tileH + metrics.tileH / 2;
    const maxR = Math.max(metrics.tileW, metrics.tileH) * 1.15;
    ctx.save();
    for (let k = 0; k < 2; k++) {
      const pp = (age / _RIPPLE_MS) - k * 0.18;
      if (pp <= 0) continue;
      ctx.globalAlpha = (1 - pp) * 0.6;
      ctx.strokeStyle = C.EDGE;
      ctx.lineWidth = 2.5 * (1 - pp) + 0.5;
      ctx.beginPath();
      ctx.arc(cx, cy, pp * maxR, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Decorative prop scatter — deterministic (seed hash, no Math.random), cached.
// Trees/bushes/grass on land, reeds/lilypads near & in water, rocks + flowers as
// accents. Skips node tiles + the stressor source. Drawn through the biome filter
// so props desaturate with the wetland's health.
// ─────────────────────────────────────────────────────────────────────────────
// ── Biome-keyed prop-name table ───────────────────────────────────────────────
// Each slot maps to the sprite name used in that biome.  The wetland column is
// the original hardcoded literal — byte-identical to the previous behaviour.
// For unknown biomes the wetland set is used as the default.
// Rule 01: if a reef prop sprite is absent, drawProps skips it (spr === null →
// continue).  We do NOT fall back to the wetland sprite — an empty reef is
// correct until art lands.
const _PROP_NAMES = {
  coastal_wetland: {
    water:  'prop_lilypad',
    reed:   'prop_reeds',
    tree:   'prop_tree',
    bush:   'prop_bush',
    grass:  'prop_grass',
    flower: 'prop_flowers',
    rock:   'prop_rock',
    stump:  'prop_stump',
  },
  coral_reef: {
    water:  'prop_anemone',
    reed:   'prop_kelp',
    tree:   'prop_coral',
    bush:   'prop_coralhead',
    grass:  'prop_algae',
    flower: 'prop_starfish',
    rock:   'prop_rock',    // shared — rocks exist on reefs
    stump:  'prop_shell',
  },
};

// Cache is keyed by BOTH seed and biome so that switching biomes on the same
// seed never returns stale props (Fix: previously keyed on seed only).
let _propCache = { seed: null, biome: null, items: null };

function _propItems(state, seed) {
  const biome = state.meta.biome_template ?? 'coastal_wetland';
  if (_propCache.seed === seed && _propCache.biome === biome && _propCache.items) return _propCache.items;

  // Resolve the active prop-name set (default to wetland for unknown biomes)
  const P = _PROP_NAMES[biome] ?? _PROP_NAMES.coastal_wetland;

  const items = [];
  const nodeTiles = new Set(Object.values(state.world.nodes).map(n => n.tileId));
  for (const [tileId, tile] of Object.entries(state.world.tiles)) {
    if (nodeTiles.has(tileId)) continue;
    let tx, ty;
    if (tile.x !== undefined) { tx = tile.x; ty = tile.y; }
    else { const p = tileId.split('_'); tx = +p[1]; ty = +p[2]; }
    const type = tile.type === 'source' ? 'source' : tileTypeFromNoise(seed, tx, ty);
    if (type === 'source') continue;

    const a  = hash3(seed, tx * 3 + 1, ty * 5 + 2);
    const b  = hash3(seed, tx * 7 + 9, ty * 11 + 4);
    const ox = hash3(seed, tx * 13 + 5, ty * 17 + 6) - 0.5;
    const oy = hash3(seed, tx * 19 + 7, ty * 23 + 8) - 0.5;

    // Selection logic is BYTE-IDENTICAL to before — only the resolved names
    // come from the active biome set instead of hardcoded literals.
    let prop = null, sizeFrac = 0.6, sway = false;
    if (type === 'water') {
      if (a < 0.22) { prop = P.water;  sizeFrac = 0.70; }
    } else {
      const nearWater =
        typeAtTile(state, seed, tx + 1, ty) === 'water' || typeAtTile(state, seed, tx - 1, ty) === 'water' ||
        typeAtTile(state, seed, tx, ty + 1) === 'water' || typeAtTile(state, seed, tx, ty - 1) === 'water';
      if (nearWater && a < 0.50) { prop = P.reed;   sizeFrac = 0.78; sway = true; }
      else if (a < 0.46) {
        if      (b < 0.12) { prop = P.tree;   sizeFrac = 1.15; }
        else if (b < 0.34) { prop = P.bush;   sizeFrac = 0.72; }
        else if (b < 0.66) { prop = P.grass;  sizeFrac = 0.50; sway = true; }
        else if (b < 0.82) { prop = P.flower; sizeFrac = 0.50; }
        else if (b < 0.93) { prop = P.rock;   sizeFrac = 0.62; }
        else               { prop = P.stump;  sizeFrac = 0.66; }
      }
    }
    if (prop) items.push({
      tileId, prop,
      sizeFrac: sizeFrac * (0.80 + 0.40 * (oy + 0.5)),   // wider scale variety
      ox, oy, sway,
      flip:  hash3(seed, tx * 29 + 3, ty * 31 + 5) < 0.5, // ~half mirrored
      alpha: 0.82 + 0.18 * hash3(seed, tx * 37 + 1, ty * 41 + 2), // subtle brightness variance
    });
  }
  _propCache = { seed, biome, items };
  return items;
}

function drawProps(state, ctx, metrics, timestamp) {
  const seed = state.meta.seed ?? 12345;
  const H = _dispHealth == null ? state.meta.ecosystem_health : _dispHealth;
  const items = _propItems(state, seed);
  ctx.save();
  ctx.filter = _biomeFilter(H);
  for (const it of items) {
    const spr = getSprite(it.prop);
    if (!spr) continue;
    const { x, y, w, h } = tilePx(it.tileId, state, metrics);
    const size = Math.min(w, h) * it.sizeFrac;
    const px = x + w / 2 + it.ox * w * 0.25;
    const bottomY = y + h - 1 + it.oy * h * 0.08;
    const bob = it.sway ? Math.sin(timestamp / 600 + x * 0.05 + y * 0.03) * size * 0.04 : 0;
    ctx.save();
    ctx.globalAlpha = it.alpha;
    ctx.translate(px, bottomY - size / 2 + bob);
    if (it.flip) ctx.scale(-1, 1);
    ctx.drawImage(spr, -size / 2, -size / 2, size, size);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * render(state, ctx, timestamp)
 *
 * Called every requestAnimationFrame tick from main.js.
 * READ-ONLY — mutates nothing in GameState (Rule 03).
 * Renderer-private display vars (_dispHealth, _ripples, _propCache) are NOT GameState.
 *
 * @param {object} state       — GameState singleton (or compatible object)
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} [timestamp=0] — rAF timestamp (ms); drives all animations
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
  drawTileGrid(state, ctx, metrics, timestamp);

  // ── Layer 1.5: Decorative props (under nodes/agent) ─────────────────────────
  drawProps(state, ctx, metrics, timestamp);

  // ── Layer 1.6: Guided-tile coach outline (above props, below sprites) ────────
  drawGuidedTile(state, ctx, metrics, timestamp);

  // ── Layer 2: Node sprites ─────────────────────────────────────────────────
  drawNodes(state, ctx, metrics, timestamp);

  // ── Layer 3: Revealed DAG edges ───────────────────────────────────────────
  drawEdges(state, ctx, metrics, timestamp);

  // ── Layer 4: Field Agent ──────────────────────────────────────────────────
  drawAgent(state, ctx, metrics, timestamp);

  // ── Scan ripples (transient feedback on a successful scan) ──────────────────
  drawScanRipples(ctx, metrics, timestamp);

  // ── Clean bursts (bioremediation tile juice) ──────────────────────────────
  drawCleanBursts(ctx, metrics, timestamp);

  // ── Atmosphere: drifting health-reactive particles + cinematic vignette ────
  drawAtmosphere(ctx, state, metrics, timestamp, cssW, cssH);
  drawVignette(ctx, cssW, cssH);

  // ── Tier-up canvas flash (drawn above vignette, below HUD) ───────────────
  drawCanvasFlash(ctx, cssW, cssH, timestamp);

  // ── Layer 5: HUD bar ──────────────────────────────────────────────────────
  drawHUD(state, ctx, cssW);
}

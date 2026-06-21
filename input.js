/**
 * input.js — Keyboard + mouse/touch input for Ecosystem X
 *
 * Responsibilities:
 *   1. Arrow keys / WASD / touch-drag  → move player tile_x / tile_y
 *   2. Canvas click  → tile hit-test → if a node is on that tile, scan it
 *      (deduct scanner_charges; mark node.discovered; reveal its edges)
 *   3. 'E' key → scan current tile (same as clicking the player's tile)
 *   4. Export `initInput(canvas, state, getMetrics)` — called once from main.js
 *      after the render loop starts.
 *
 * Rule 01 / Law 1: never touches the canvas layout; only reads tile metrics.
 * Rule 03: all state writes done here must end with state.save().
 */

import GameState from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
// Scan a tile — discover any node on it, reveal its edges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * scanTile(tx, ty, state) → { discovered: nodeId|null, edgesRevealed: number }
 *
 * If there is an un-discovered node on tile (tx, ty) AND player has scanner charges:
 *   • node.discovered = true
 *   • push nodeId to notebook.discovered_nodes
 *   • reveal all edges connecting that node (both directions)
 *   • deduct 1 scanner_charge
 *   • state.save()
 *
 * Returns a result object so callers can show feedback.
 */
export function scanTile(tx, ty, state) {
  if (state.flags.win || state.flags.lose) return { discovered: null, edgesRevealed: 0 };

  // Find a node on this tile
  const node = Object.values(state.world.nodes).find(
    n => {
      const tile = state.world.tiles[n.tileId];
      if (!tile) return false;
      const tileX = tile.x !== undefined ? tile.x : parseInt(n.tileId.split('_')[1], 10);
      const tileY = tile.y !== undefined ? tile.y : parseInt(n.tileId.split('_')[2], 10);
      return tileX === tx && tileY === ty;
    }
  );

  if (!node) return { discovered: null, edgesRevealed: 0 };
  if (node.discovered) return { discovered: node.id, edgesRevealed: 0, alreadyScanned: true };
  if (state.player.scanner_charges <= 0) return { discovered: null, edgesRevealed: 0, noCharges: true };

  // ── Mark node discovered ──────────────────────────────────────────────────
  node.discovered = true;
  if (!state.notebook.discovered_nodes.includes(node.id)) {
    state.notebook.discovered_nodes.push(node.id);
  }

  // ── Reveal edges connected to this node ──────────────────────────────────
  let edgesRevealed = 0;
  for (const edge of state.world.edges) {
    if (edge.from === node.id || edge.to === node.id) {
      // Only reveal if the OTHER end has also been discovered OR is stressor
      const otherId = edge.from === node.id ? edge.to : edge.from;
      const other   = state.world.nodes[otherId];
      if (!edge.revealed && other && (other.discovered || other.kind === 'stressor')) {
        edge.revealed = true;
        const key = `${edge.from}->${edge.to}`;
        if (!state.notebook.revealed_edges.includes(key)) {
          state.notebook.revealed_edges.push(key);
        }
        edgesRevealed++;
      }
    }
  }

  // ── Also: if THIS node is a stressor, reveal edges from stressor → any discovered node ──
  if (node.kind === 'stressor') {
    for (const edge of state.world.edges) {
      if (edge.from === node.id && !edge.revealed) {
        const target = state.world.nodes[edge.to];
        if (target && target.discovered) {
          edge.revealed = true;
          const key = `${edge.from}->${edge.to}`;
          if (!state.notebook.revealed_edges.includes(key)) {
            state.notebook.revealed_edges.push(key);
          }
          edgesRevealed++;
        }
      }
    }
  }

  // ── Check if any newly discovered node closes a previously partial edge ──
  for (const edge of state.world.edges) {
    if (edge.revealed) continue;
    const fromNode = state.world.nodes[edge.from];
    const toNode   = state.world.nodes[edge.to];
    if (fromNode?.discovered && toNode?.discovered) {
      edge.revealed = true;
      const key = `${edge.from}->${edge.to}`;
      if (!state.notebook.revealed_edges.includes(key)) {
        state.notebook.revealed_edges.push(key);
        edgesRevealed++;
      }
    }
  }

  // ── Deduct charge ─────────────────────────────────────────────────────────
  state.player.scanner_charges = Math.max(0, state.player.scanner_charges - 1);

  state.save();
  return { discovered: node.id, edgesRevealed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Hit-test: canvas pixel → tile coords
// ─────────────────────────────────────────────────────────────────────────────

/**
 * pixelToTile(px, py, metrics, grid) → { tx, ty } | null
 */
function pixelToTile(px, py, metrics, grid) {
  const tx = Math.floor((px - metrics.offsetX) / metrics.tileW);
  const ty = Math.floor((py - metrics.offsetY) / metrics.tileH);
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return null;
  return { tx, ty };
}

// ─────────────────────────────────────────────────────────────────────────────
// Move player — clamped to grid bounds
// ─────────────────────────────────────────────────────────────────────────────

/**
 * movePlayer(dx, dy, state) — moves the player by (dx, dy) tiles.
 */
export function movePlayer(dx, dy, state) {
  if (state.flags.win || state.flags.lose) return;
  const { w, h } = state.world.grid;
  state.player.tile_x = Math.max(0, Math.min(w - 1, state.player.tile_x + dx));
  state.player.tile_y = Math.max(0, Math.min(h - 1, state.player.tile_y + dy));
  state.save();
}

// ─────────────────────────────────────────────────────────────────────────────
// initInput — wire all listeners to the canvas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * initInput(canvas, state, getMetrics)
 *
 * @param {HTMLCanvasElement} canvas
 * @param {object}            state      — GameState singleton
 * @param {()=>object}        getMetrics — returns current tile metrics
 *   (must be a function because metrics change on resize)
 *
 * Returns a disposer function that removes all listeners.
 */
export function initInput(canvas, state, getMetrics) {

  // ── Keyboard ───────────────────────────────────────────────────────────────
  function onKeyDown(e) {
    // Ignore key events when typing in an input field
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.key) {
      case 'ArrowUp':    case 'w': case 'W':
        e.preventDefault(); movePlayer(0, -1, state); break;
      case 'ArrowDown':  case 's': case 'S':
        e.preventDefault(); movePlayer(0,  1, state); break;
      case 'ArrowLeft':  case 'a': case 'A':
        e.preventDefault(); movePlayer(-1, 0, state); break;
      case 'ArrowRight': case 'd': case 'D':
        e.preventDefault(); movePlayer( 1, 0, state); break;

      case 'e': case 'E':
        // Scan current tile
        e.preventDefault();
        triggerScan(state.player.tile_x, state.player.tile_y, state);
        break;

      default: break;
    }
  }

  // ── Canvas click → tile hit-test ───────────────────────────────────────────
  function onCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const py   = e.clientY - rect.top;

    const metrics = getMetrics();
    if (!metrics) return;

    const hit = pixelToTile(px, py, metrics, state.world.grid);
    if (!hit) return;

    // Move player to clicked tile first
    state.player.tile_x = hit.tx;
    state.player.tile_y = hit.ty;

    // Then attempt scan of that tile
    triggerScan(hit.tx, hit.ty, state);
    state.save(); // save the player move even if scan had no effect
  }

  // ── Touch support (mobile) ────────────────────────────────────────────────
  let touchStartX = 0, touchStartY = 0;

  function onTouchStart(e) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }

  function onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    const SWIPE_THRESHOLD = 30;

    if (Math.abs(dx) < SWIPE_THRESHOLD && Math.abs(dy) < SWIPE_THRESHOLD) {
      // Tap — treat like a click
      const rect = canvas.getBoundingClientRect();
      const px   = e.changedTouches[0].clientX - rect.left;
      const py   = e.changedTouches[0].clientY - rect.top;
      const metrics = getMetrics();
      if (!metrics) return;
      const hit = pixelToTile(px, py, metrics, state.world.grid);
      if (!hit) return;
      state.player.tile_x = hit.tx;
      state.player.tile_y = hit.ty;
      triggerScan(hit.tx, hit.ty, state);
      state.save();
      return;
    }

    // Swipe → move
    if (Math.abs(dx) > Math.abs(dy)) {
      movePlayer(dx > 0 ? 1 : -1, 0, state);
    } else {
      movePlayer(0, dy > 0 ? 1 : -1, state);
    }
  }

  // ── Register ──────────────────────────────────────────────────────────────
  document.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('click',      onCanvasClick);
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });

  // Disposer
  return function dispose() {
    document.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('click',      onCanvasClick);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchend',   onTouchEnd);
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// triggerScan — shared logic for key-E and click-scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * triggerScan(tx, ty, state)
 * Performs scanTile and fires a custom DOM event so main.js can show feedback.
 */
export function triggerScan(tx, ty, state) {
  const result = scanTile(tx, ty, state);
  // Dispatch so main.js / UI can react (show toast, update notebook, etc.)
  window.dispatchEvent(new CustomEvent('ecosystemx:scan', { detail: { tx, ty, ...result } }));
  return result;
}

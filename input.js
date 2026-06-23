/**
 * input.js — Keyboard + mouse/touch input for Ecosystem X
 *
 * Responsibilities:
 *   1. Arrow keys / WASD / touch-drag  → move player tile_x / tile_y
 *   2. Canvas click  → tile hit-test → MOVE player only (no scan on click;
 *      proximity walking auto-discovers species via main.js game loop)
 *   3. Export `initInput(canvas, state, getMetrics)` — called once from main.js
 *      after the render loop starts.
 *
 * Discovery model: species are auto-discovered when the player walks within
 *   DISCOVER_RADIUS tiles (Chebyshev). scanner_charges is a soft "distance
 *   scouted" counter — it decrements on each discovery but never blocks
 *   (species are always discoverable by proximity walking).
 *
 * Rule 01 / Law 1: never touches the canvas layout; only reads tile metrics.
 * Rule 03: all state writes done here must end with state.save().
 */

import GameState from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
// Hold-to-walk — smooth movement driven by the rAF loop (tickMovement), not
// by browser key-repeat. This eliminates the initial-delay hitch and the
// warp caused by rapid OS repeat events.
//
// _heldDirs: Set of currently-held directions ('up'|'down'|'left'|'right').
//   keydown → add; keyup → remove; window blur → clear (focus-loss guard).
// _lastStepMs: timestamp of the most recent auto-step (performance.now()).
// MOVE_INTERVAL_MS: minimum ms between auto-steps (220 ≈ 4.5 tiles/sec).
// _walkTarget: {x, y} tile the agent is auto-walking toward (click/tap-to-move).
//   null when inactive. Keyboard input cancels it; arrival clears it.
//
// tickMovement(state) — called every rAF frame from main.js tick():
//   1) keyboard held-dirs win → clear _walkTarget, do existing step.
//   2) else auto-walk one tile toward _walkTarget per MOVE_INTERVAL_MS.
// ─────────────────────────────────────────────────────────────────────────────
const _heldDirs   = new Set();
let   _lastStepMs = 0;
let   _walkTarget = null; // {x, y} tile — click/tap auto-walk destination
export const MOVE_INTERVAL_MS = 220; // ms between auto-steps ≈ 4.5 tiles/sec

/** Map key string → canonical direction label */
function _keyToDir(key) {
  switch (key) {
    case 'ArrowUp':    case 'w': case 'W': return 'up';
    case 'ArrowDown':  case 's': case 'S': return 'down';
    case 'ArrowLeft':  case 'a': case 'A': return 'left';
    case 'ArrowRight': case 'd': case 'D': return 'right';
    default: return null;
  }
}

/** Map direction label → (dx, dy) delta */
function _dirToDelta(dir) {
  switch (dir) {
    case 'up':    return [  0, -1 ];
    case 'down':  return [  0,  1 ];
    case 'left':  return [ -1,  0 ];
    case 'right': return [  1,  0 ];
    default:      return [  0,  0 ];
  }
}

/**
 * tickMovement(state) — call every rAF frame BEFORE render().
 *
 * Priority:
 *   1) If any direction key is held → keyboard wins: clear _walkTarget and
 *      step once per MOVE_INTERVAL_MS (existing behaviour).
 *   2) Else if _walkTarget is set → auto-walk one tile toward it per interval.
 *      Picks the axis with the larger remaining distance (tie → x axis).
 *      Clears _walkTarget on arrival.
 */
export function tickMovement(state) {
  if (state.flags.win || state.flags.lose) return;
  const now = performance.now();

  // ── 1. Keyboard held-dirs win ────────────────────────────────────────────
  if (_heldDirs.size > 0) {
    _walkTarget = null; // keyboard cancels auto-walk
    if (now - _lastStepMs < MOVE_INTERVAL_MS) return;
    let dir = null;
    for (const d of _heldDirs) dir = d; // last insertion = most recent
    if (!dir) return;
    const [dx, dy] = _dirToDelta(dir);
    _lastStepMs = now;
    movePlayer(dx, dy, state);
    return;
  }

  // ── 2. Auto-walk toward _walkTarget ──────────────────────────────────────
  if (!_walkTarget) return;

  const { tile_x, tile_y } = state.player;

  // Arrived?
  if (tile_x === _walkTarget.x && tile_y === _walkTarget.y) {
    _walkTarget = null;
    return;
  }

  if (now - _lastStepMs < MOVE_INTERVAL_MS) return;

  // Pick axis with larger remaining distance (tie → x)
  const remX = Math.abs(_walkTarget.x - tile_x);
  const remY = Math.abs(_walkTarget.y - tile_y);
  let dx = 0, dy = 0;
  if (remX >= remY && remX > 0) {
    dx = _walkTarget.x > tile_x ? 1 : -1;
  } else {
    dy = _walkTarget.y > tile_y ? 1 : -1;
  }

  _lastStepMs = now;
  movePlayer(dx, dy, state);
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan a tile — discover any node on it, reveal its edges
// ─────────────────────────────────────────────────────────────────────────────

/**
 * scanTile(tx, ty, state) → { discovered: nodeId|null, edgesRevealed: number }
 *
 * Discovers the node on tile (tx, ty) if not yet discovered (proximity model):
 *   • node.discovered = true
 *   • push nodeId to notebook.discovered_nodes
 *   • reveal all edges connecting that node (both directions)
 *   • decrement scanner_charges as a soft "scouted" counter (never blocks)
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
  // NOTE: no charges-block — scanner_charges is a soft counter only (proximity model)

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

  // ── Soft-decrement scanner_charges (tracking counter — never blocks discovery) ──
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
 *
 * Sets state.player.facing from the move direction BEFORE clamping so the
 * renderer always knows which way the agent is looking, even at grid edges.
 *   dy < 0 → 'up'    dy > 0 → 'down'
 *   dx < 0 → 'left'  dx > 0 → 'right'
 * Diagonal moves (touch swipe rounding) prefer the larger axis.
 */
export function movePlayer(dx, dy, state) {
  if (state.flags.win || state.flags.lose) return;

  // Determine facing — prefer the dominant axis on diagonal input
  if (Math.abs(dy) >= Math.abs(dx)) {
    if (dy < 0) state.player.facing = 'up';
    else if (dy > 0) state.player.facing = 'down';
  } else {
    if (dx < 0) state.player.facing = 'left';
    else if (dx > 0) state.player.facing = 'right';
  }

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

    const dir = _keyToDir(e.key);
    if (dir) {
      e.preventDefault();
      _walkTarget = null; // key press cancels click/tap auto-walk
      // Add to held-set so tickMovement() drives continuous walking.
      _heldDirs.add(dir);
      // Take ONE immediate step on the initial press (no repeat check needed —
      // we ignore e.repeat entirely; the held-set handles cadence instead).
      if (!e.repeat) {
        const [dx, dy] = _dirToDelta(dir);
        // Pre-arm _lastStepMs so the next auto-step waits a full interval.
        _lastStepMs = performance.now();
        movePlayer(dx, dy, state);
      }
      return;
    }
    // E-key scan removed — discovery is now proximity-based (walk near a species)
  }

  function onKeyUp(e) {
    const dir = _keyToDir(e.key);
    if (dir) _heldDirs.delete(dir);
  }

  function onBlur() {
    // Focus lost (alt-tab, overlay open, etc.) — release all held directions
    // and cancel auto-walk so the agent doesn't keep walking when focus returns.
    _heldDirs.clear();
    _walkTarget = null;
  }

  // ── Canvas click → set auto-walk target (tile-by-tile walk, not warp) ────
  // Discovery happens automatically when the player walks within DISCOVER_RADIUS.
  function onCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const px   = e.clientX - rect.left;
    const py   = e.clientY - rect.top;

    const metrics = getMetrics();
    if (!metrics) return;

    const hit = pixelToTile(px, py, metrics, state.world.grid);
    if (!hit) return;

    // Clamp to grid bounds (pixelToTile already returns null if OOB, but be safe)
    const tx = Math.max(0, Math.min(state.world.grid.w - 1, hit.tx));
    const ty = Math.max(0, Math.min(state.world.grid.h - 1, hit.ty));

    // Already standing here — cancel any pending walk
    if (tx === state.player.tile_x && ty === state.player.tile_y) {
      _walkTarget = null;
      return;
    }

    // Set walk target; tickMovement() will step toward it each frame
    _walkTarget = { x: tx, y: ty };
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
      // Tap — set auto-walk target (tile-by-tile walk, not warp)
      const rect = canvas.getBoundingClientRect();
      const tpx  = e.changedTouches[0].clientX - rect.left;
      const tpy  = e.changedTouches[0].clientY - rect.top;
      const metrics = getMetrics();
      if (!metrics) return;
      const hit = pixelToTile(tpx, tpy, metrics, state.world.grid);
      if (!hit) return;
      const tx = Math.max(0, Math.min(state.world.grid.w - 1, hit.tx));
      const ty = Math.max(0, Math.min(state.world.grid.h - 1, hit.ty));
      if (tx === state.player.tile_x && ty === state.player.tile_y) {
        _walkTarget = null;
        return;
      }
      _walkTarget = { x: tx, y: ty };
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
  document.addEventListener('keyup',   onKeyUp);
  window.addEventListener('blur',      onBlur);
  canvas.addEventListener('click',      onCanvasClick);
  canvas.addEventListener('touchstart', onTouchStart, { passive: true });
  canvas.addEventListener('touchend',   onTouchEnd,   { passive: true });

  // Disposer
  return function dispose() {
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup',   onKeyUp);
    window.removeEventListener('blur',      onBlur);
    canvas.removeEventListener('click',      onCanvasClick);
    canvas.removeEventListener('touchstart', onTouchStart);
    canvas.removeEventListener('touchend',   onTouchEnd);
    _heldDirs.clear();
    _walkTarget = null;
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

/**
 * main.js — Entry point for Ecosystem X: The Last Balance
 *
 * Responsibilities:
 *   1. Bootstrap GameState (load from localStorage or generate a fresh world).
 *   2. Set up the canvas with DPI scaling; re-scale on window resize.
 *   3. Run the requestAnimationFrame render loop.
 *   4. Wire event delegation on #overlay for ALL panel actions.
 *   5. Show start card on first load; win/lose cards on game end.
 *   6. Handle scan feedback toasts, daily step, vendor, notebook panels.
 *
 * Rule 01 / Law 1: ONE canvas (#game). This file never hides the canvas.
 * Rule 01 / Law 2: World generation uses seeded PRNG via generator.js.
 * Rule 03: main.js orchestrates — direct state mutation only for UI-level
 *          ops not owned by another module.
 */

import GameState            from './state.js';
import { generateWorld }    from './generator.js';
import { render, setupDPICanvas } from './renderer.js';
import { runDailyStep, computeHealth } from './ecosystem.js';
import { initInput, triggerScan }    from './input.js';
import { buildNotebookHTML }  from './notebook.js';
import { buildVendorHTML, applyIntervention } from './vendor.js';
import { updateTier }         from './hysteria.js';
import { getFieldReportFragment } from './ai_content.js';

// ─────────────────────────────────────────────────────────────────────────────
// Canvas setup
// ─────────────────────────────────────────────────────────────────────────────
const canvas  = document.getElementById('game');
const overlay = document.getElementById('overlay');

/** @type {CanvasRenderingContext2D} */
let ctx = setupDPICanvas(canvas);

// Current tile metrics (updated each frame, exposed for input.js hit-testing)
let _currentMetrics = null;
function getMetrics() { return _currentMetrics; }

// Re-scale on window resize
window.addEventListener('resize', () => {
  ctx = setupDPICanvas(canvas);
});

// Give the canvas keyboard focus
canvas.setAttribute('tabindex', '0');
canvas.focus();

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap
// ─────────────────────────────────────────────────────────────────────────────

async function loadBiomeTemplate() {
  const resp = await fetch('./data/biomes.json');
  if (!resp.ok) throw new Error(`Failed to load biomes.json: ${resp.status}`);
  return resp.json();
}

async function bootstrap() {
  GameState.load();

  const hasWorld = GameState.world &&
                   Object.keys(GameState.world.tiles  || {}).length > 0 &&
                   Object.keys(GameState.world.nodes || {}).length > 0;

  if (!hasWorld) {
    showStartCard();
  } else {
    startGame();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Overlay helpers
// ─────────────────────────────────────────────────────────────────────────────

function showOverlay(html) {
  overlay.innerHTML = html;
  overlay.hidden = false;
}

function hideOverlay() {
  overlay.hidden = true;
  overlay.innerHTML = '';
  canvas.focus();
}

// ─────────────────────────────────────────────────────────────────────────────
// Toast notification (scan feedback, error messages)
// ─────────────────────────────────────────────────────────────────────────────

let _toastTimer = null;

function showToast(message, type = 'info', durationMs = 2800) {
  let toast = document.getElementById('eco-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'eco-toast';
    document.getElementById('game-container').appendChild(toast);
  }
  toast.textContent = message;
  toast.className   = `eco-toast eco-toast-${type} eco-toast-show`;

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.remove('eco-toast-show');
  }, durationMs);
}

// ─────────────────────────────────────────────────────────────────────────────
// Start card
// ─────────────────────────────────────────────────────────────────────────────

function showStartCard() {
  const defaultSeed = Math.floor(Date.now() % 9999) + 1;
  showOverlay(`
    <div class="panel card" role="document">
      <h1>Ecosystem X</h1>
      <h2 style="font-size:1em;opacity:0.7;margin-top:-10px;">The Last Balance</h2>
      <p>A coastal wetland is collapsing.<br>
         Scan species, reveal the food web,<br>
         find the stressor — restore the balance.</p>
      <div class="start-controls">
        <p style="opacity:0.6;font-size:0.85em;margin-bottom:4px;">
          Seed: <input id="seed-input" type="number" min="1" max="999999"
                 value="${defaultSeed}"
                 style="width:80px;background:#1a2530;border:1px solid #f0a500;
                        color:#f5f0e8;padding:2px 6px;font-family:monospace;
                        border-radius:3px;">
          &nbsp;<span style="opacity:0.5">(same seed = same world)</span>
        </p>
        <button class="btn" data-action="newgame"
          style="font-size:1em;padding:10px 28px;margin-top:8px;">
          Begin Field Assignment
        </button>
      </div>
      <div class="start-hints">
        <p style="opacity:0.5;font-size:0.8em;margin-top:16px;">
          🖱 Click tiles to move &amp; scan &nbsp;|&nbsp;
          ⌨ Arrow keys / WASD to move &nbsp;|&nbsp;
          E to scan current tile
        </p>
      </div>
    </div>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Win / Lose cards
// ─────────────────────────────────────────────────────────────────────────────

function showWinCard() {
  const report = getFieldReportFragment(GameState);
  showOverlay(`
    <div class="panel card win-card" role="document">
      <h1 style="color:#1a9e6b;">✦ BIOME RESTORED ✦</h1>
      <p>The coastal wetland has reached <strong>Pristine</strong> health<br>
         and held stable for 3 consecutive days.</p>
      <pre class="field-report">${report}</pre>
      <button class="btn" data-action="newgame"
        style="margin-top:16px;">Play Again</button>
    </div>
  `);
}

function showLoseCard() {
  const report = getFieldReportFragment(GameState);
  showOverlay(`
    <div class="panel card lose-card" role="document">
      <h1 style="color:#c0392b;">✖ COLLAPSE</h1>
      <p>${GameState.meta.collapse_timer <= 0
          ? 'The collapse timer expired. The biome is gone.'
          : 'A keystone species went extinct. The food web collapsed.'}</p>
      <pre class="field-report">${report}</pre>
      <button class="btn" data-action="newgame"
        style="margin-top:16px;">Try Again</button>
    </div>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily step feedback overlay (results panel shown briefly after endday)
// ─────────────────────────────────────────────────────────────────────────────

function showDayResultBanner(prevHealth, newHealth, dayCount) {
  const delta = newHealth - prevHealth;
  const sign  = delta >= 0 ? '+' : '';
  const color = delta >= 0 ? '#4ccea0' : '#c0392b';
  showToast(
    `Day ${dayCount}: Health ${Math.round(prevHealth)}% → ${Math.round(newHealth)}% (${sign}${Math.round(delta)}%)`,
    delta >= 0 ? 'success' : 'warning',
    3500
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// New game generation
// ─────────────────────────────────────────────────────────────────────────────

async function newGame(seed) {
  showOverlay(`<div class="panel card"><h1>Generating World…</h1><p>Seed: ${seed}</p></div>`);
  await new Promise(r => setTimeout(r, 50));

  try {
    const biomes   = await loadBiomeTemplate();
    const template = biomes['coastal_wetland'];
    GameState.reset();
    generateWorld(template, seed, GameState);

    // Fix (2): compute true Day-1 health immediately after world generation
    // so HUD shows real starting values before any step is advanced.
    GameState.meta.ecosystem_health = computeHealth(GameState);
    updateTier(GameState); // sets market_tier + price_factor, calls save()

    hideOverlay();
    startGame();
  } catch (err) {
    showOverlay(`
      <div class="panel card">
        <h1 style="color:var(--danger)">Generation Failed</h1>
        <p>${err.message}</p>
        <button class="btn" data-action="retry">Retry</button>
      </div>
    `);
    console.error('[main.js] World generation error:', err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// startGame — wires input + render loop after world is ready
// ─────────────────────────────────────────────────────────────────────────────

let _inputDispose = null;

function startGame() {
  // Wire input system
  if (_inputDispose) _inputDispose();
  _inputDispose = initInput(canvas, GameState, getMetrics);

  startRenderLoop();

  // Show scan hint on first load
  if (GameState.notebook.discovered_nodes.length === 0) {
    setTimeout(() => showToast('Click a tile or press E to scan species', 'info', 4000), 600);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan event handler
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('ecosystemx:scan', (e) => {
  const { discovered, edgesRevealed, alreadyScanned, noCharges } = e.detail;

  if (noCharges) {
    showToast('No scanner charges! Advance the day to continue.', 'warning');
    return;
  }
  if (!discovered) {
    showToast('No species on this tile.', 'info', 1800);
    return;
  }
  if (alreadyScanned) {
    const node = GameState.world.nodes[discovered];
    showToast(`${node?.name ?? discovered} — already in notebook.`, 'info', 1800);
    return;
  }

  const node = GameState.world.nodes[discovered];
  const msg  = edgesRevealed > 0
    ? `🔬 Scanned: ${node.name} (+${edgesRevealed} link${edgesRevealed > 1 ? 's' : ''} revealed!)`
    : `🔬 Scanned: ${node.name}`;
  showToast(msg, 'success');

  // Check if win/lose triggered by this action
  checkEndCondition();
});

// ─────────────────────────────────────────────────────────────────────────────
// Check win/lose and show appropriate card
// ─────────────────────────────────────────────────────────────────────────────

function checkEndCondition() {
  if (GameState.flags.win && overlay.hidden) {
    setTimeout(showWinCard, 500);
  } else if (GameState.flags.lose && overlay.hidden) {
    setTimeout(showLoseCard, 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Event delegation — ALL overlay + HUD actions
// ─────────────────────────────────────────────────────────────────────────────

overlay.addEventListener('click', async (e) => {
  const btn    = e.target.closest('[data-action]');
  const action = btn?.dataset?.action;
  if (!action) return;

  switch (action) {

    // ── Start / Retry ─────────────────────────────────────────────────────
    case 'newgame': {
      const seedInput = document.getElementById('seed-input');
      const seed = Math.max(1, parseInt(seedInput?.value || '1', 10));
      await newGame(seed);
      break;
    }
    case 'retry': {
      showStartCard();
      break;
    }
    case 'close': {
      hideOverlay();
      break;
    }

    // ── Notebook ──────────────────────────────────────────────────────────
    case 'open-notebook': {
      showOverlay(buildNotebookHTML(GameState));
      break;
    }

    // ── Vendor / Intervention store ───────────────────────────────────────
    case 'open-vendor': {
      showOverlay(buildVendorHTML(GameState));
      break;
    }

    // ── Buy intervention ──────────────────────────────────────────────────
    case 'buy': {
      const type   = btn.dataset.intervention;
      const result = applyIntervention(type, GameState);
      if (result.ok) {
        // Refresh vendor panel with updated state
        showOverlay(buildVendorHTML(GameState));
        // Show result dialogue as a toast
        showToast(result.message.split('\n')[0], 'success', 4000);
      } else {
        showToast(result.message, 'warning');
      }
      checkEndCondition();
      break;
    }

    // ── Advance Day ───────────────────────────────────────────────────────
    case 'endday': {
      if (GameState.flags.win || GameState.flags.lose) {
        hideOverlay();
        break;
      }
      const prevHealth = GameState.meta.ecosystem_health;
      hideOverlay();

      // Run simulation step (hysteria updateTier is called inside via stub;
      // we also call updateTier explicitly for price factor sync)
      runDailyStep(GameState);
      updateTier(GameState);

      const newDay    = GameState.meta.day_count;
      const newHealth = GameState.meta.ecosystem_health;
      showDayResultBanner(prevHealth, newHealth, newDay);

      // Check for game-over conditions
      setTimeout(checkEndCondition, 400);

      // Refresh scanner charges hint if depleted
      if (GameState.player.scanner_charges === 0) {
        setTimeout(() => showToast('⚡ Scanner recharged! 5 new charges.', 'success', 2500), 800);
        // Recharge scanner each day (quality of life)
        GameState.player.scanner_charges = 5;
        GameState.save();
      }
      break;
    }

    default:
      break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HUD button clicks (canvas-level actions bar at bottom)
// Keyboard shortcuts for panels (no canvas overlap needed)
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

  switch (e.key) {
    case 'n': case 'N':
      e.preventDefault();
      if (overlay.hidden) showOverlay(buildNotebookHTML(GameState));
      else hideOverlay();
      break;
    case 'v': case 'V':
      e.preventDefault();
      if (overlay.hidden) showOverlay(buildVendorHTML(GameState));
      else hideOverlay();
      break;
    case ' ':
      e.preventDefault();
      if (overlay.hidden) {
        // Space = end day (quick play)
        if (!GameState.flags.win && !GameState.flags.lose) {
          const prevHealth = GameState.meta.ecosystem_health;
          runDailyStep(GameState);
          updateTier(GameState);
          showDayResultBanner(prevHealth, GameState.meta.ecosystem_health, GameState.meta.day_count);
          if (GameState.player.scanner_charges === 0) {
            GameState.player.scanner_charges = 5;
            GameState.save();
            setTimeout(() => showToast('⚡ Scanner recharged!', 'success', 2000), 500);
          }
          setTimeout(checkEndCondition, 400);
        }
      }
      break;
    case 'Escape':
      if (!overlay.hidden) hideOverlay();
      break;
    default: break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Render loop (patched to capture metrics for input hit-testing)
// ─────────────────────────────────────────────────────────────────────────────

let rafId      = null;
let loopRunning = false;

function startRenderLoop() {
  if (loopRunning) return;
  loopRunning = true;

  function tick(timestamp) {
    if (!loopRunning) return;
    // Capture metrics snapshot for input.js hit-testing
    if (GameState.world?.grid) {
      const rect  = canvas.getBoundingClientRect();
      const { w, h } = GameState.world.grid;
      const cssW  = rect.width;
      const cssH  = rect.height;
      const HUD_H = 48;
      const tileW = Math.floor(cssW / w);
      const tileH = Math.floor((cssH - HUD_H) / h);
      _currentMetrics = {
        tileW, tileH,
        offsetX: Math.floor((cssW - tileW * w) / 2),
        offsetY: HUD_H,
      };
    }
    render(GameState, ctx, timestamp);
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);
}

export function stopRenderLoop() {
  loopRunning = false;
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopRenderLoop();
  } else {
    if (Object.keys(GameState.world?.tiles || {}).length > 0) {
      loopRunning = false;
      startRenderLoop();
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Go
// ─────────────────────────────────────────────────────────────────────────────
bootstrap().catch(err => {
  console.error('[main.js] bootstrap failed:', err);
});

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
import {
  render, setupDPICanvas, DISCOVER_RADIUS,
  markNodeDiscovered, pingCleanEffect, flashCanvas, setGuidedTile,
} from './renderer.js';
import { runDailyStep, computeHealth } from './ecosystem.js';
import { initInput, triggerScan, scanTile, tickMovement } from './input.js';
import { buildNotebookHTML, getTopRecommendation }  from './notebook.js';
import { escapeHTML, escapeAttr } from './safehtml.js';
import { buildVendorHTML, applyIntervention } from './vendor.js';
import { updateTier, loadDialogue, getPricedCost } from './hysteria.js';
import {
  loadAIContent, getFieldReportFragment, computeRunGrade,
  getAICodexEntry,
  initArtLayers,
  initAudio, setHealthAudio, playWinSting,
  playDiscoverChime, playInterveneChime, playTierUp,
} from './ai_content.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// Audio unlock — must happen inside a user-gesture handler (browser autoplay)
// ─────────────────────────────────────────────────────────────────────────────
let _audioUnlocked = false;

async function _unlockAudio() {
  if (_audioUnlocked) return;
  _audioUnlocked = true;
  await initAudio();
  // Set initial ambient immediately after init
  setHealthAudio(GameState.meta.ecosystem_health ?? 50);
}

async function bootstrap() {
  // Fire-and-forget image preload — renderer degrades gracefully until loaded.
  initArtLayers();

  // Load AI content JSON files before first render so Day-1 codex/dialogue/
  // report all use the richer generated text.  Both calls are fire-and-forget
  // safe: on any fetch error they log a warning and the game proceeds on the
  // inline fallbacks (Rule 01 — offline capability must never break).
  await Promise.allSettled([
    loadAIContent(),
    loadDialogue(),
  ]);

  GameState.load();

  const hasWorld = GameState.world &&
                   Object.keys(GameState.world.tiles  || {}).length > 0 &&
                   Object.keys(GameState.world.nodes || {}).length > 0;

  if (!hasWorld) {
    // Show intro sequence only on the very first load of this session.
    // New Seed / Retry flows bypass bootstrap() entirely (they call newGame directly),
    // so _introShown is never reset by those paths — matching Rule 03.
    if (_introShown) {
      showStartCard();
    } else {
      showIntroSequence();
    }
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
// Intro sequence — 4 narrative panels, keyart backdrop, shown once per session
// Rule 01: fully offline; no live LLM. Rule 03: module-level flag, no state mut.
// ─────────────────────────────────────────────────────────────────────────────

/** True after the intro has been seen or skipped in this browser session. */
let _introShown = false;

const _INTRO_PANELS = [
  {
    counter: '1 / 3',
    text: `An ecosystem is <strong>collapsing</strong>.<br>
           Every species is a node in a hidden food web.`,
    bg: 'assets/images/intro_1.png',
  },
  {
    counter: '2 / 3',
    text: `<strong>Walk</strong> (WASD / arrows / click) to find wildlife.<br>
           A <strong>❗</strong> means one is near — scan it to reveal the web.`,
    bg: 'assets/images/intro_2.png',
  },
  {
    counter: '3 / 3',
    text: `Read the <strong>diagnosis</strong>, apply the right fix,<br>
           restore <strong>Health to Pristine</strong> before the timer runs out.`,
    isFinal: true,
    bg: 'assets/images/intro_3.png',
  },
];

/**
 * _introPanelHTML(index) — builds the HTML for one intro panel.
 * CSS classes only (no inline styles except --keyart-url CSS variable).
 * Each panel uses its own bg image; falls back to --bg-dark if missing (Rule 01).
 */
function _introPanelHTML(index) {
  const panel     = _INTRO_PANELS[index];
  const nextLabel = panel.isFinal ? 'Begin →' : 'Next →';
  const bgUrl     = panel.bg ? `url('${panel.bg}')` : 'none';
  return `
    <div class="intro-panel" style="--keyart-url: ${bgUrl}">
      <div class="intro-content">
        <div class="intro-counter">${panel.counter}</div>
        <p class="intro-text">${panel.text}</p>
        <div class="intro-btn-row">
          <button class="intro-skip" data-action="intro-skip">Skip</button>
          <button class="intro-next" data-action="intro-next"
                  data-panel="${index}">${nextLabel}</button>
        </div>
      </div>
    </div>
  `;
}

/**
 * showIntroSequence() — renders P1 into #overlay.
 * Subsequent panels advance via the overlay event-delegation (data-action="intro-next").
 * Skipping or completing the sequence calls showStartCard().
 */
function showIntroSequence() {
  _introShown = true;
  showOverlay(_introPanelHTML(0));
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
// Captain's Orders — persistent coach HUD bar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeNextGuidance(state) → { icon, text, action? }
 *
 * Priority order (spec §2 a–f):
 *  a. run over
 *  b. undiscovered species inside territory
 *  c. nothing diagnosable yet
 *  d. top recommendation known → walk / intervene / save up
 *  e. treating + health rising, no pending cause
 *  f. health ≥ 75 — hold pristine
 */
function computeNextGuidance(state) {
  if (!state?.world?.tiles) return null;

  // a. Run over
  if (state.flags?.win) {
    return {
      icon: '✦',
      text: 'Biome restored! Well done.',
      action: { label: 'New Mission →', do: 'new-seed' },
    };
  }
  if (state.flags?.lose) {
    return {
      icon: '✖',
      text: 'The biome collapsed. Try again.',
      action: { label: 'Retry →', do: 'new-seed' },
    };
  }

  // b. Undiscovered species inside player territory (show ❗ hunt hint)
  const px = state.player.tile_x;
  const py = state.player.tile_y;
  const undiscovered = Object.values(state.world.nodes).filter(n => {
    if (n.kind === 'stressor' || n.discovered) return false;
    const tile = state.world.tiles[n.tileId];
    let ntx, nty;
    if (tile && tile.x !== undefined) { ntx = tile.x; nty = tile.y; }
    else { const p = n.tileId.split('_'); ntx = +p[1]; nty = +p[2]; }
    const dist = Math.max(Math.abs(ntx - px), Math.abs(nty - py));
    return dist <= 5; // within a loose territory radius
  });
  if (undiscovered.length > 0) {
    return {
      icon: '🔍',
      text: 'Walk to the ❗ and scan the wildlife.',
    };
  }

  // c. Nothing diagnosable scanned yet
  const rec = getTopRecommendation(state);
  const totalSpecies = Object.values(state.world.nodes).filter(n => n.kind !== 'stressor').length;
  const discovered   = state.notebook.discovered_nodes.filter(
    id => state.world.nodes[id]?.kind !== 'stressor'
  ).length;
  if (!rec && discovered < totalSpecies) {
    const biomeName = state.meta.biome_name ?? 'ecosystem';
    return {
      icon: '🧭',
      text: `Explore and scan to find what's harming the ${biomeName}.`,
    };
  }

  // d. A cause is known
  if (rec) {
    const resources = state.player.resources;
    const canAfford = resources >= rec.cost;
    // Check if player is on the target tile
    const onTarget = rec.targetTileId &&
      rec.targetTileId === `t_${px}_${py}`;

    if (canAfford && onTarget) {
      // Player is in position and can afford — offer the one-tap button
      const toolLabels = {
        bioremediation: 'Bioremediate',
        rebalancing:    'Rebalance',
        stabilization:  'Stabilize',
      };
      const label = toolLabels[rec.toolType] ?? rec.toolType;
      return {
        icon: '⚡',
        text: `${rec.cause} detected. Act now!`,
        action: {
          label: `⚡ ${label} here (¤${rec.cost})`,
          do: 'guided-intervene',
          toolType: rec.toolType,
        },
      };
    } else if (canAfford) {
      // Can afford but not on the right tile — guide them there
      return {
        icon: '📍',
        text: `Go to the glowing tile, then act.`,
        // No button — movement is the player's job
      };
    } else {
      // Cannot afford
      return {
        icon: '⏳',
        text: `Need ¤${rec.cost} (have ¤${resources}). Advance a day to gather resources.`,
        action: { label: 'Advance Day', do: 'endday' },
      };
    }
  }

  // e. No pending cause but health is moving
  const health = state.meta.ecosystem_health ?? 0;
  if (health < 75) {
    return {
      icon: '📈',
      text: 'Recovering — Advance the Day.',
      action: { label: 'Advance Day', do: 'endday' },
    };
  }

  // f. Pristine hold
  const daysToWin = Math.max(0, 3 - (state.meta.health_streak ?? 0));
  return {
    icon: '🏁',
    text: `Hold Pristine — ${daysToWin} day${daysToWin !== 1 ? 's' : ''} to win.`,
    action: { label: 'Advance Day', do: 'endday' },
  };
}

/**
 * renderCaptainBar(state) — create/update the #captain-bar DOM element.
 * Called every render tick. Never replaces the canvas (Law 1).
 */
function renderCaptainBar(state) {
  const container = document.getElementById('game-container');
  if (!container) return;

  let bar = document.getElementById('captain-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'captain-bar';
    container.appendChild(bar);
  }

  // Don't render while a modal overlay (win card, start card, etc.) is visible
  if (!overlay.hidden) {
    bar.hidden = true;
    setGuidedTile(null);
    return;
  }
  // Don't render if world isn't ready
  if (!state?.world?.tiles) {
    bar.hidden = true;
    return;
  }

  const guidance = computeNextGuidance(state);
  if (!guidance) {
    bar.hidden = true;
    setGuidedTile(null);
    return;
  }

  // Update guided tile highlight in the canvas
  const rec = getTopRecommendation(state);
  if (rec && guidance.icon === '📍') {
    setGuidedTile(rec.targetTileId ?? null);
  } else {
    setGuidedTile(null);
  }

  const btnHTML = guidance.action
    ? `<button class="coach-btn" data-coach-action="${escapeAttr(guidance.action.do)}"
         data-tool-type="${escapeAttr(guidance.action.toolType ?? '')}"
       >${escapeHTML(guidance.action.label)}</button>`
    : '';

  bar.innerHTML = `
    <span class="coach-icon">${guidance.icon}</span>
    <span class="coach-text">${escapeHTML(guidance.text)}</span>
    ${btnHTML}
  `;
  bar.hidden = false;
}

// ── Captain's bar click delegation ─────────────────────────────────────────
document.addEventListener('click', async (e) => {
  const btn    = e.target.closest('[data-coach-action]');
  const action = btn?.dataset?.coachAction;
  if (!action) return;

  switch (action) {

    case 'guided-intervene': {
      _unlockAudio();
      const toolType = btn.dataset.toolType;
      if (!toolType) break;
      const result = applyIntervention(toolType, GameState);
      if (result.ok) {
        if (result.warned) {
          showToast(result.message.split('\n').filter(Boolean).pop(), 'warning', 5200);
        } else {
          showToast(result.message.split('\n')[0], 'success', 4000);
        }
        if (toolType === 'bioremediation') {
          playInterveneChime();
          pingCleanEffect(GameState.player.tile_x, GameState.player.tile_y);
        }
      } else {
        showToast(result.message, 'warning');
      }
      checkEndCondition();
      break;
    }

    case 'endday': {
      if (GameState.flags.win || GameState.flags.lose) break;
      _unlockAudio();
      const prevHealth = GameState.meta.ecosystem_health;
      const prevTier   = GameState.meta.market_tier;
      runDailyStep(GameState);
      updateTier(GameState);
      const newDay    = GameState.meta.day_count;
      const newHealth = GameState.meta.ecosystem_health;
      const newTier   = GameState.meta.market_tier;
      showDayResultBanner(prevHealth, newHealth, newDay);
      setHealthAudio(newHealth);
      const _TIER_ORDER_C = { Toxic: 0, Degraded: 1, Recovering: 2, Pristine: 3 };
      if ((_TIER_ORDER_C[newTier] ?? 0) > (_TIER_ORDER_C[prevTier] ?? 0)) {
        playTierUp();
        flashCanvas(300);
        setTimeout(() => showToast(`🌿 Ecosystem improved: ${prevTier} → ${newTier}`, 'success', 3000), 120);
      }
      if (GameState.flags.win) playWinSting();
      if (GameState.player.scanner_charges === 0) {
        GameState.player.scanner_charges = 5;
        GameState.save();
        setTimeout(() => showToast('⚡ Scanner recharged — 5 new scouting charges.', 'success', 2500), 800);
      }
      setTimeout(checkEndCondition, 400);
      break;
    }

    case 'new-seed': {
      _unlockAudio();
      const freshSeed = Math.max(1, Date.now() % 999999 || 1);
      await newGame(freshSeed, GameState.meta.biome_template);
      break;
    }

    default: break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Start card
// ─────────────────────────────────────────────────────────────────────────────

function showStartCard() {
  const defaultSeed = Math.floor(Date.now() % 9999) + 1;
  const biomeBtn = (key, label) =>
    `<button class="start-biome-btn${_selectedBiome === key ? ' selected' : ''}" data-action="pick-biome" data-biome="${key}">${label}</button>`;
  showOverlay(`
    <div class="start-card-outer" style="--keyart-url: url('assets/images/keyart.png')"
         role="document">
      <div class="start-card-inner">
        <div class="start-biome-row">
          ${biomeBtn('coastal_wetland', '🌿 Coastal Wetland')}
          ${biomeBtn('coral_reef', '🐠 Coral Reef')}
        </div>
        <div class="start-seed-row">
          <label for="seed-input">Seed</label>
          <input id="seed-input" type="number" min="1" max="999999" value="${defaultSeed}">
        </div>
        <button class="start-begin-btn" data-action="newgame">Begin</button>
        <p class="start-controls-hint">Move: WASD / arrows / click · Walk near wildlife to scan it</p>
      </div>
    </div>
  `);
}

// ─────────────────────────────────────────────────────────────────────────────
// Win / Lose cards
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the CSS color and background for a run grade badge. */
function _gradeBadgeStyle(grade) {
  // S/A = gold  · B/C = green  · D = amber  · E/F = red
  switch (grade) {
    case 'S': return 'background:#f0c040;color:#1a1208;';
    case 'A': return 'background:#f0a500;color:#1a1208;';
    case 'B': return 'background:#1a9e6b;color:#fff;';
    case 'C': return 'background:#2ecc71;color:#1a2a1a;';
    case 'D': return 'background:#e67e22;color:#fff;';
    case 'E': return 'background:#c0392b;color:#fff;';
    case 'F': return 'background:#7b0e0e;color:#fff;';
    default:  return 'background:#555;color:#fff;';
  }
}

function showWinCard() {
  const { grade, line } = computeRunGrade(GameState);
  const report          = getFieldReportFragment(GameState);
  const badgeStyle      = _gradeBadgeStyle(grade);
  const currentSeed     = GameState.meta.seed;
  showOverlay(`
    <div class="panel card win-card" role="document">
      <h1 style="color:#1a9e6b;">✦ BIOME RESTORED ✦</h1>
      <p>The ${escapeHTML(GameState.meta.biome_name ?? 'ecosystem')} reached <strong>Pristine</strong> health, held for 3 days.</p>

      <div style="display:flex;align-items:center;gap:14px;margin:14px 0 6px;">
        <span style="
          ${badgeStyle}
          font-size:2.8em;font-weight:900;width:1.5em;height:1.5em;
          display:flex;align-items:center;justify-content:center;
          border-radius:10px;flex-shrink:0;line-height:1;
          box-shadow:0 2px 10px rgba(0,0,0,0.45);
        ">${escapeHTML(grade)}</span>
        <span style="font-size:0.95em;opacity:0.9;font-style:italic;">${escapeHTML(line)}</span>
      </div>

      <pre class="field-report">${escapeHTML(report)}</pre>

      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
        <button class="btn" data-action="new-seed"
          style="flex:1;min-width:130px;font-size:0.95em;">
          New Seed →
        </button>
        <button class="btn" data-action="retry-seed" data-seed="${escapeAttr(currentSeed)}"
          style="flex:1;min-width:130px;font-size:0.95em;background:transparent;
                 border:1px solid var(--accent);color:var(--accent);">
          Retry Seed ${escapeHTML(currentSeed)}
        </button>
      </div>
    </div>
  `);
}

function showLoseCard() {
  const { grade, line } = computeRunGrade(GameState);
  const report          = getFieldReportFragment(GameState);
  const badgeStyle      = _gradeBadgeStyle(grade);
  const currentSeed     = GameState.meta.seed;
  showOverlay(`
    <div class="panel card lose-card" role="document">
      <h1 style="color:#c0392b;">✖ COLLAPSE</h1>
      <p>${GameState.meta.collapse_timer <= 0
          ? 'The collapse timer expired. The biome is gone.'
          : 'A keystone species went extinct. The food web collapsed.'}</p>

      <div style="display:flex;align-items:center;gap:14px;margin:14px 0 6px;">
        <span style="
          ${badgeStyle}
          font-size:2.8em;font-weight:900;width:1.5em;height:1.5em;
          display:flex;align-items:center;justify-content:center;
          border-radius:10px;flex-shrink:0;line-height:1;
          box-shadow:0 2px 10px rgba(0,0,0,0.45);
        ">${escapeHTML(grade)}</span>
        <span style="font-size:0.95em;opacity:0.9;font-style:italic;">${escapeHTML(line)}</span>
      </div>

      <pre class="field-report">${escapeHTML(report)}</pre>

      <div style="display:flex;gap:10px;margin-top:16px;flex-wrap:wrap;">
        <button class="btn" data-action="retry-seed" data-seed="${escapeAttr(currentSeed)}"
          style="flex:1;min-width:130px;font-size:0.95em;">
          Retry Seed ${escapeHTML(currentSeed)}
        </button>
        <button class="btn" data-action="new-seed"
          style="flex:1;min-width:130px;font-size:0.95em;background:transparent;
                 border:1px solid var(--accent);color:var(--accent);">
          New Seed →
        </button>
      </div>
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

/** Currently-selected biome for the next new game (set on the start card). */
let _selectedBiome = 'coastal_wetland';

async function newGame(seed, biomeKey = _selectedBiome) {
  showOverlay(`<div class="panel card"><h1>Generating World…</h1><p>Seed: ${escapeHTML(seed)}</p></div>`);
  await new Promise(r => setTimeout(r, 50));

  try {
    const biomes   = await loadBiomeTemplate();
    const template = biomes[biomeKey] ?? biomes['coastal_wetland'];
    GameState.reset();
    GameState.meta.biome_template = biomeKey;
    GameState.meta.biome_name     = template.displayName ?? 'ecosystem';
    GameState.meta.collapse_timer = template.collapseTimer ?? 45;  // per-biome clock
    _proximityDiscovered.clear(); // reset session discovery tracker for new world
    generateWorld(template, seed, GameState);

    // Fix (2): compute true Day-1 health immediately after world generation
    // so HUD shows real starting values before any step is advanced.
    GameState.meta.ecosystem_health = computeHealth(GameState);
    updateTier(GameState); // sets market_tier + price_factor, calls save()

    // Set initial ambient (audio may not be ready yet — setHealthAudio no-ops safely)
    setHealthAudio(GameState.meta.ecosystem_health);

    hideOverlay();
    startGame();
  } catch (err) {
    showOverlay(`
      <div class="panel card">
        <h1 style="color:var(--danger)">Generation Failed</h1>
        <p>${escapeHTML(err.message)}</p>
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

  // Show proximity-discovery hint on first load
  if (GameState.notebook.discovered_nodes.length === 0) {
    setTimeout(() => showToast('Walk near species to discover them automatically!', 'info', 4000), 600);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan event handler
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener('ecosystemx:scan', (e) => {
  const { discovered, edgesRevealed, alreadyScanned } = e.detail;

  // alreadyScanned fires if triggerScan is called on a node already in the notebook
  // (shouldn't happen with the _proximityDiscovered guard, but safety net).
  if (!discovered || alreadyScanned) return;

  const node = GameState.world.nodes[discovered];

  // ── B: Discovery juice ────────────────────────────────────────────────────
  // 1. Scale-pop: tell renderer this node just became discovered
  markNodeDiscovered(discovered);

  // 2. Chime
  playDiscoverChime();

  // 3. Enriched toast: species name + first sentence from codex entry
  const codexEntry = getAICodexEntry(discovered);
  let toastMsg = `🔬 ${node.name}`;
  if (edgesRevealed > 0) {
    toastMsg += ` (+${edgesRevealed} link${edgesRevealed > 1 ? 's' : ''} revealed!)`;
  }
  if (codexEntry) {
    // First sentence only (split on ". " or ".\n", keep it short in the toast)
    const firstSentence = codexEntry.trim().split(/\.\s+/)[0].trim();
    if (firstSentence.length > 0 && firstSentence.length <= 120) {
      toastMsg += `\n${firstSentence}.`;
    }
  }
  showToast(toastMsg, 'success', 3800);

  // Check if win/lose triggered by this discovery
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

    // ── Intro sequence navigation ─────────────────────────────────────────
    case 'intro-next': {
      const currentPanel = parseInt(btn.dataset.panel ?? '0', 10);
      const nextIndex    = currentPanel + 1;
      if (nextIndex < _INTRO_PANELS.length) {
        showOverlay(_introPanelHTML(nextIndex));
      } else {
        // Last panel "Begin →" → go to start card
        showStartCard();
      }
      break;
    }

    case 'intro-skip': {
      showStartCard();
      break;
    }

    // ── Start card: pick a biome (re-render to update the highlight) ───────
    case 'pick-biome': {
      _selectedBiome = btn.dataset.biome === 'coral_reef' ? 'coral_reef' : 'coastal_wetland';
      showStartCard();
      break;
    }

    // ── Start / Retry ─────────────────────────────────────────────────────
    case 'newgame': {
      // First user gesture — unlock audio context (browser autoplay policy)
      _unlockAudio();
      const seedInput = document.getElementById('seed-input');
      const seed = Math.max(1, parseInt(seedInput?.value || '1', 10));
      await newGame(seed, _selectedBiome);
      break;
    }

    // ── Win/lose card: brand-new run with a fresh seed (same biome) ────────
    case 'new-seed': {
      _unlockAudio();
      // UI input — Date.now() used ONLY to pick the seed, not in sim/generation
      const freshSeed = Math.max(1, Date.now() % 999999 || 1);
      await newGame(freshSeed, GameState.meta.biome_template);
      break;
    }

    // ── Win/lose card: replay the exact same world (same biome) ────────────
    case 'retry-seed': {
      _unlockAudio();
      // seed stored in data-seed attribute, set when the card was rendered
      const replaySeed = Math.max(1, parseInt(btn.dataset.seed || '1', 10));
      await newGame(replaySeed, GameState.meta.biome_template);
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
        // Show result as a toast — surface the wrong-tool warning prominently
        if (result.warned) {
          showToast(result.message.split('\n').filter(Boolean).pop(), 'warning', 5200);
        } else {
          showToast(result.message.split('\n')[0], 'success', 4000);
        }

        // ── C: Intervention juice (bioremediation only) ────────────────
        if (type === 'bioremediation') {
          playInterveneChime();
          // Ping the clean-burst effect on the player's current tile
          pingCleanEffect(GameState.player.tile_x, GameState.player.tile_y);
        }
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
      const prevTier   = GameState.meta.market_tier;
      hideOverlay();

      // Run simulation step (hysteria updateTier is called inside via stub;
      // we also call updateTier explicitly for price factor sync)
      runDailyStep(GameState);
      updateTier(GameState);

      const newDay    = GameState.meta.day_count;
      const newHealth = GameState.meta.ecosystem_health;
      const newTier   = GameState.meta.market_tier;
      showDayResultBanner(prevHealth, newHealth, newDay);

      // Crossfade ambient audio to match new health tier
      setHealthAudio(newHealth);

      // ── D: Tier-up juice ──────────────────────────────────────────────
      // Fire when the market tier moved strictly UP (Toxic<Degraded<Recovering<Pristine)
      const _TIER_ORDER = { Toxic: 0, Degraded: 1, Recovering: 2, Pristine: 3 };
      if ((_TIER_ORDER[newTier] ?? 0) > (_TIER_ORDER[prevTier] ?? 0)) {
        playTierUp();
        flashCanvas(300);
        setTimeout(() => showToast(`🌿 Ecosystem improved: ${prevTier} → ${newTier}`, 'success', 3000), 120);
      }

      // Win sting (fires once when win flag first becomes true)
      if (GameState.flags.win) playWinSting();

      // Check for game-over conditions
      setTimeout(checkEndCondition, 400);

      // Recharge scanner each day (soft discovery counter reset)
      if (GameState.player.scanner_charges === 0) {
        GameState.player.scanner_charges = 5;
        GameState.save();
        setTimeout(() => showToast('⚡ Scanner recharged — 5 new scouting charges.', 'success', 2500), 800);
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
          const _TIER_ORDER_SP = { Toxic: 0, Degraded: 1, Recovering: 2, Pristine: 3 };
          const prevHealth = GameState.meta.ecosystem_health;
          const prevTierSp = GameState.meta.market_tier;
          runDailyStep(GameState);
          updateTier(GameState);
          const newTierSp = GameState.meta.market_tier;
          showDayResultBanner(prevHealth, GameState.meta.ecosystem_health, GameState.meta.day_count);
          setHealthAudio(GameState.meta.ecosystem_health);
          // ── D: Tier-up juice (spacebar path) ──────────────────────────
          if ((_TIER_ORDER_SP[newTierSp] ?? 0) > (_TIER_ORDER_SP[prevTierSp] ?? 0)) {
            playTierUp();
            flashCanvas(300);
            setTimeout(() => showToast(`🌿 Ecosystem improved: ${prevTierSp} → ${newTierSp}`, 'success', 3000), 120);
          }
          if (GameState.flags.win) playWinSting();
          if (GameState.player.scanner_charges === 0) {
            GameState.player.scanner_charges = 5;
            GameState.save();
            setTimeout(() => showToast('⚡ Scanner recharged — 5 new scouting charges.', 'success', 2000), 500);
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

// ─────────────────────────────────────────────────────────────────────────────
// Proximity discovery — tracks which nodes have been auto-discovered this
// session so we never fire triggerScan twice for the same node.
// Cleared on newGame (via GameState.reset()).
// ─────────────────────────────────────────────────────────────────────────────
const _proximityDiscovered = new Set();

/**
 * _checkProximityDiscovery(state)
 *
 * Called every frame from tick(). For every UNDISCOVERED non-stressor node
 * within DISCOVER_RADIUS tiles (Chebyshev) of the player, fires triggerScan
 * so the node gets marked discovered, pushed to the notebook, and its edges
 * revealed.  The _proximityDiscovered Set guards against double-firing.
 */
function _checkProximityDiscovery(state) {
  if (!state.world?.nodes || state.flags.win || state.flags.lose) return;
  const px = state.player.tile_x;
  const py = state.player.tile_y;

  for (const node of Object.values(state.world.nodes)) {
    if (node.kind === 'stressor') continue;          // stressor never auto-discovered
    if (node.discovered) continue;                    // already in notebook
    if (_proximityDiscovered.has(node.id)) continue; // already fired this session

    // Resolve node tile coordinates
    const tile = state.world.tiles[node.tileId];
    let ntx, nty;
    if (tile && tile.x !== undefined) { ntx = tile.x; nty = tile.y; }
    else { const p = node.tileId.split('_'); ntx = +p[1]; nty = +p[2]; }

    const dist = Math.max(Math.abs(ntx - px), Math.abs(nty - py));
    if (dist > DISCOVER_RADIUS) continue;

    // Mark as fired BEFORE triggerScan so re-entrant calls can't double-fire
    _proximityDiscovered.add(node.id);
    triggerScan(ntx, nty, state);
  }
}

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

    // ── Hold-to-walk: step player if a direction key is held ─────────────────
    tickMovement(GameState);

    // ── Proximity-based species discovery ────────────────────────────────────
    _checkProximityDiscovery(GameState);

    render(GameState, ctx, timestamp);
    renderCaptainBar(GameState);
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

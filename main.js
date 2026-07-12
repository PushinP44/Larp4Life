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
  markNodeDiscovered, pingCleanEffect, flashCanvas,
} from './renderer.js';
import { runDailyStep, computeHealth } from './ecosystem.js';
import {
  initInput, triggerScan, scanTile, tickMovement,
  pressDir, releaseDir, releaseAllDirs,
} from './input.js';
import { SCANNER_CHARGES } from './balance.js';
import { buildNotebookHTML }  from './notebook.js';
import { escapeHTML, escapeAttr } from './safehtml.js';
import { buildVendorHTML, applyIntervention } from './vendor.js';
import { updateTier, loadDialogue } from './hysteria.js';
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

// ── Boot loader control (instant first-paint feedback / graceful boot errors) ──
function hideBootLoader() {
  const el = document.getElementById('boot-loader');
  if (el) el.remove();
}

function showBootError(message) {
  const el  = document.getElementById('boot-loader');
  const msg = document.getElementById('boot-message');
  if (el) el.classList.add('boot-error');
  const spinner = el?.querySelector('.boot-spinner');
  if (spinner) spinner.remove();
  if (msg) {
    msg.textContent = message;
  } else if (el) {
    el.textContent = message;
  }
}

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

  // World + content are ready — remove the boot loader so the game shows.
  hideBootLoader();

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
// Shared actions — one implementation for keyboard, overlay buttons AND the
// on-screen touch controls (keeps behaviour identical across every input path).
// ─────────────────────────────────────────────────────────────────────────────

function toggleNotebook() {
  if (overlay.hidden) showOverlay(buildNotebookHTML(GameState));
  else hideOverlay();
}

function toggleVendor() {
  if (overlay.hidden) showOverlay(buildVendorHTML(GameState));
  else hideOverlay();
}

const _TIER_ORDER = { Toxic: 0, Degraded: 1, Recovering: 2, Pristine: 3 };

/**
 * advanceDay() — run one simulation step and play all the resulting feedback
 * (day banner, ambient crossfade, tier-up juice, win sting, scanner recharge,
 * win/lose check). Safe to call from a panel, a key, or a touch button.
 */
function advanceDay() {
  if (GameState.flags.win || GameState.flags.lose) {
    hideOverlay();
    return;
  }
  const prevHealth = GameState.meta.ecosystem_health;
  const prevTier   = GameState.meta.market_tier;

  if (!overlay.hidden) hideOverlay();

  runDailyStep(GameState);
  updateTier(GameState); // sync price factor to the new tier

  const newHealth = GameState.meta.ecosystem_health;
  const newTier   = GameState.meta.market_tier;
  showDayResultBanner(prevHealth, newHealth, GameState.meta.day_count);

  // Crossfade ambient audio to match new health tier
  setHealthAudio(newHealth);

  // Tier-up juice — only when the market tier moved strictly UP
  if ((_TIER_ORDER[newTier] ?? 0) > (_TIER_ORDER[prevTier] ?? 0)) {
    playTierUp();
    flashCanvas(300);
    setTimeout(() => showToast(`🌿 Ecosystem improved: ${prevTier} → ${newTier}`, 'success', 3000), 120);
  }

  if (GameState.flags.win) playWinSting();

  // Recharge scanner when depleted
  if (GameState.player.scanner_charges === 0) {
    GameState.player.scanner_charges = SCANNER_CHARGES;
    GameState.save();
    setTimeout(() => showToast(`⚡ Scanner recharged — ${SCANNER_CHARGES} new scouting charges.`, 'success', 2500), 800);
  }

  setTimeout(checkEndCondition, 400);
}

// ─────────────────────────────────────────────────────────────────────────────
// Intro sequence — 4 narrative panels, keyart backdrop, shown once per session
// Rule 01: fully offline; no live LLM. Rule 03: module-level flag, no state mut.
// ─────────────────────────────────────────────────────────────────────────────

/** True after the intro has been seen or skipped in this browser session. */
let _introShown = false;

const _INTRO_PANELS = [
  {
    counter: '1 / 4',
    text: `A coastal wetland is <strong>collapsing</strong>.<br>
           Algae chokes the seagrass, the fish vanish,<br>
           the storks abandon their nests.`,
  },
  {
    counter: '2 / 4',
    text: `Nature is a <strong>network</strong> — every species a node<br>
           in a hidden food web.<br>
           Pull one thread and the whole web unravels.`,
  },
  {
    counter: '3 / 4',
    text: `You are a <strong>Field Agent</strong>.<br>
           Walk the wetland (<strong>WASD / arrows</strong>, or click) to find species —<br>
           a <strong>❗</strong> marks one nearby. Discovering them reveals the food web.`,
  },
  {
    counter: '4 / 4',
    text: `Trace the web to the <strong>ROOT pollution source</strong>.<br>
           Bioremediate the right tiles to restore<br>
           Ecosystem Health to <strong>Pristine</strong> — before the collapse timer hits zero.`,
    isFinal: true,
  },
];

/**
 * _introPanelHTML(index) — builds the HTML for one intro panel.
 * CSS classes only (no inline styles except --keyart-url CSS variable).
 */
function _introPanelHTML(index) {
  const panel     = _INTRO_PANELS[index];
  const nextLabel = panel.isFinal ? 'Begin →' : 'Next →';
  return `
    <div class="intro-panel" style="--keyart-url: url('assets/images/keyart.png')">
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
// Start card
// ─────────────────────────────────────────────────────────────────────────────

function showStartCard() {
  const defaultSeed = Math.floor(Date.now() % 9999) + 1;
  showOverlay(`
    <div class="start-card-outer" style="--keyart-url: url('assets/images/keyart.png')"
         role="document">
      <div class="start-card-inner">
        <div class="start-seed-row">
          <label for="seed-input">Seed</label>
          <input id="seed-input" type="number" min="1" max="999999"
                 value="${defaultSeed}">
          <span class="seed-hint">(same seed = same world)</span>
        </div>
        <button class="start-begin-btn" data-action="newgame">
          Begin Field Assignment
        </button>
        <p class="start-controls-hint">
          🖱 Click tile to move &nbsp;·&nbsp;
          ⌨ WASD / arrows &nbsp;·&nbsp;
          Walk near species to discover
        </p>
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
      <p>The coastal wetland has reached <strong>Pristine</strong> health<br>
         and held stable for 3 consecutive days.</p>

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

async function newGame(seed) {
  showOverlay(`<div class="panel card"><h1>Generating World…</h1><p>Seed: ${escapeHTML(seed)}</p></div>`);
  await new Promise(r => setTimeout(r, 50));

  try {
    const biomes   = await loadBiomeTemplate();
    const template = biomes['coastal_wetland'];
    GameState.reset();
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

    // ── Start / Retry ─────────────────────────────────────────────────────
    case 'newgame': {
      // First user gesture — unlock audio context (browser autoplay policy)
      _unlockAudio();
      const seedInput = document.getElementById('seed-input');
      const seed = Math.max(1, parseInt(seedInput?.value || '1', 10));
      await newGame(seed);
      break;
    }

    // ── Win/lose card: brand-new run with a fresh seed ─────────────────────
    case 'new-seed': {
      _unlockAudio();
      // UI input — Date.now() used ONLY to pick the seed, not in sim/generation
      const freshSeed = Math.max(1, Date.now() % 999999 || 1);
      await newGame(freshSeed);
      break;
    }

    // ── Win/lose card: replay the exact same world ─────────────────────────
    case 'retry-seed': {
      _unlockAudio();
      // seed stored in data-seed attribute, set when the card was rendered
      const replaySeed = Math.max(1, parseInt(btn.dataset.seed || '1', 10));
      await newGame(replaySeed);
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
      advanceDay();
      break;
    }

    default:
      break;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// On-screen touch controls (mobile / no-keyboard). Reuse the same actions as
// keyboard + overlay. Movement uses press/release so hold-to-walk works.
// ─────────────────────────────────────────────────────────────────────────────
(function wireTouchControls() {
  const tc = document.getElementById('touch-controls');
  if (!tc) return;

  // Reveal on touch / coarse-pointer / narrow screens.
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const narrow = window.matchMedia('(max-width: 820px)').matches;
  if (coarse || narrow) tc.hidden = false;

  // D-pad: hold-to-walk via press/release. pointer events cover touch + mouse.
  tc.querySelectorAll('[data-dir]').forEach((btn) => {
    const dir = btn.dataset.dir;
    const press = (e) => { e.preventDefault(); pressDir(dir); };
    const release = () => releaseDir(dir);
    btn.addEventListener('pointerdown', press);
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointerleave', release);
    btn.addEventListener('pointercancel', release);
    // Keyboard access (Enter/Space on a focused D-pad button = one step)
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { pressDir(dir); }
    });
    btn.addEventListener('keyup', release);
  });

  // Action buttons
  tc.querySelectorAll('[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => {
      releaseAllDirs();
      switch (btn.dataset.action) {
        case 'open-notebook': _unlockAudio(); toggleNotebook(); break;
        case 'open-vendor':   _unlockAudio(); toggleVendor();   break;
        case 'endday':        _unlockAudio(); advanceDay();     break;
        default: break;
      }
    });
  });
})();

// ─────────────────────────────────────────────────────────────────────────────
// HUD button clicks (canvas-level actions bar at bottom)
// Keyboard shortcuts for panels (no canvas overlap needed)
// ─────────────────────────────────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  // Touch-control buttons handle their own keys — don't double-fire here.
  if (e.target.closest && e.target.closest('#touch-controls')) return;

  switch (e.key) {
    case 'n': case 'N':
      e.preventDefault();
      toggleNotebook();
      break;
    case 'v': case 'V':
      e.preventDefault();
      toggleVendor();
      break;
    case ' ':
      e.preventDefault();
      // Space = end day (quick play) — only from the game view, not over a panel
      if (overlay.hidden) advanceDay();
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
  showBootError('Could not start the game. Please refresh the page to try again.');
});

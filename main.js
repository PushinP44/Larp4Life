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
import {
  initInput, triggerScan, scanTile, tickMovement,
  pressDir, releaseDir, releaseAllDirs,
} from './input.js';
import { SCANNER_CHARGES, COLLAPSE_TIMER, START_RESOURCES, DAILY_INCOME, MODIFIERS } from './balance.js';
import { pickModifier } from './generator.js';
import { buildNotebookHTML, getTopRecommendation }  from './notebook.js';
import { escapeHTML, escapeAttr } from './safehtml.js';
import { buildVendorHTML, applyIntervention } from './vendor.js';
import { updateTier, loadDialogue, getPricedCost } from './hysteria.js';
import { MISSIONS, CampaignState, buildCampaignHTML } from './campaign.js';
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

  CampaignState.load();
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

/** _stepOneDay() — the raw simulation step, no feedback. Shared by advanceDay
 *  (single turn) and advanceUntilEvent (batch). Keeps one step code path. */
function _stepOneDay() {
  runDailyStep(GameState);
  updateTier(GameState); // sync price factor to the new tier
}

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
  const prevHealth    = GameState.meta.ecosystem_health;
  const prevTier      = GameState.meta.market_tier;
  const prevResources = GameState.player.resources;

  if (!overlay.hidden) hideOverlay();

  _stepOneDay();

  const newHealth = GameState.meta.ecosystem_health;
  const newTier   = GameState.meta.market_tier;
  showDayResultBanner(prevHealth, newHealth, GameState.meta.day_count,
    GameState.player.resources - prevResources, GameState.meta.collapse_timer);

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
// advanceUntilEvent() — pacing (#2a): batch-run days so the player isn't
// click-spamming "End Day" to save up. Stops at the first meaningful change:
//   • win / lose
//   • the top recommended fix becomes affordable (was not, now is)
//   • the health TIER changes
//   • a species becomes endangered or goes extinct
// Then plays ONE summary + says why it stopped. No balance constants change.
// ─────────────────────────────────────────────────────────────────────────────
const _MAX_BATCH_DAYS = 30; // safety cap so a stalled run can't loop forever

/** Snapshot of the signals we watch, so we can detect a change after a step. */
function _eventSnapshot() {
  const rec = getTopRecommendation(GameState);
  const affordable = rec ? GameState.player.resources >= rec.cost : false;
  const statuses = {};
  for (const n of Object.values(GameState.world.nodes)) statuses[n.id] = n.status;
  return { tier: GameState.meta.market_tier, affordable, statuses };
}

/** Returns a human reason string if `now` differs meaningfully from `before`, else null. */
function _eventReason(before, now) {
  if (GameState.flags.win)  return 'the biome is restored';
  if (GameState.flags.lose) return 'the biome collapsed';
  if (!before.affordable && now.affordable) return 'you can now afford the recommended fix';
  if (before.tier !== now.tier) return `the ecosystem is now ${now.tier}`;
  for (const id of Object.keys(now.statuses)) {
    const was = before.statuses[id], is = now.statuses[id];
    if (was === is) continue;
    if (is === 'extinct')    return `${GameState.world.nodes[id]?.name ?? 'a species'} went extinct`;
    if (is === 'endangered') return `${GameState.world.nodes[id]?.name ?? 'a species'} became endangered`;
  }
  return null;
}

function advanceUntilEvent() {
  if (GameState.flags.win || GameState.flags.lose) { hideOverlay(); return; }
  if (!overlay.hidden) hideOverlay();

  const startHealth    = GameState.meta.ecosystem_health;
  const startResources = GameState.player.resources;
  const prevTier       = GameState.meta.market_tier;
  const before = _eventSnapshot();

  let days = 0;
  let reason = null;
  while (days < _MAX_BATCH_DAYS) {
    _stepOneDay();
    days++;
    reason = _eventReason(before, _eventSnapshot());
    if (reason) break;
    if (GameState.flags.win || GameState.flags.lose) break;
  }
  if (!reason) reason = `advanced ${days} day${days !== 1 ? 's' : ''}`;

  const newHealth = GameState.meta.ecosystem_health;
  const newTier   = GameState.meta.market_tier;

  // One summary banner covering the whole batch.
  const dH   = Math.round(newHealth - startHealth);
  const dRes = GameState.player.resources - startResources;
  showToast(
    `⏩ ${days} day${days !== 1 ? 's' : ''} → Day ${GameState.meta.day_count}  ·  ` +
    `Health ${Math.round(startHealth)}→${Math.round(newHealth)}% (${dH >= 0 ? '+' : ''}${dH}%)  ·  ` +
    `${dRes >= 0 ? '+' : ''}¤${dRes}  ·  T-${GameState.meta.collapse_timer}\nStopped: ${reason}.`,
    newHealth >= startHealth ? 'success' : 'warning', 5000);

  setHealthAudio(newHealth);
  if ((_TIER_ORDER[newTier] ?? 0) > (_TIER_ORDER[prevTier] ?? 0)) { playTierUp(); flashCanvas(300); }
  if (GameState.flags.win) playWinSting();

  if (GameState.player.scanner_charges === 0) {
    GameState.player.scanner_charges = SCANNER_CHARGES;
    GameState.save();
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
      // Cannot afford — offer to skip straight to when you can (no click-grind).
      return {
        icon: '⏳',
        text: `Need ¤${rec.cost} (have ¤${resources}). Skip ahead to earn it.`,
        action: { label: '⏩ Skip to afford', do: 'advance-until' },
      };
    }
  }

  // e. No pending cause but health is moving — fast-forward to the next change.
  const health = state.meta.ecosystem_health ?? 0;
  if (health < 75) {
    return {
      icon: '📈',
      text: 'Recovering — fast-forward to the next change.',
      action: { label: '⏩ Fast-forward', do: 'advance-until' },
    };
  }

  // f. Pristine hold — the final days matter, so step one at a time.
  const daysToWin = Math.max(0, 3 - (state.meta.health_streak ?? 0));
  return {
    icon: '🏁',
    text: `Hold Pristine — ${daysToWin} day${daysToWin !== 1 ? 's' : ''} to win.`,
    action: { label: '▸ End Day', do: 'endday' },
  };
}

/**
 * renderCaptainBar(state) — create/update the #captain-bar DOM element.
 * Called every render tick. Never replaces the canvas (Law 1).
 */
/** Signature of the last content written to the coach bar — lets us skip the
 *  innerHTML rebuild when nothing changed (see renderCaptainBar). */
let _lastCoachSig = null;

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

  // Only rebuild the bar's DOM when the CONTENT changes. renderCaptainBar runs
  // every animation frame; rewriting innerHTML each frame recreates the button
  // between the user's mousedown and mouseup, so the click never fires (the bar
  // was effectively unclickable). Gate the rebuild on a content signature.
  const sig = [guidance.icon, guidance.text,
    guidance.action?.do ?? '', guidance.action?.label ?? '',
    guidance.action?.toolType ?? ''].join('\u001f');
  if (sig !== _lastCoachSig) {
    bar.innerHTML = `
      <span class="coach-icon">${guidance.icon}</span>
      <span class="coach-text">${escapeHTML(guidance.text)}</span>
      ${btnHTML}
    `;
    _lastCoachSig = sig;
  }
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
      _unlockAudio();
      advanceDay();
      break;
    }

    case 'advance-until': {
      _unlockAudio();
      advanceUntilEvent();
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

function showStartCard(previewSeed) {
  const defaultSeed = previewSeed ?? Math.floor(Date.now() % 9999) + 1;
  const mod = pickModifier(defaultSeed);
  const modIsNone = mod.id === 'none';
  const modLabel = escapeHTML(mod.label);
  const modDesc  = escapeHTML(mod.description);
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
          <input id="seed-input" type="number" min="1" max="999999" value="${defaultSeed}"
                 data-action="preview-modifier">
        </div>
        <div class="start-modifier-preview" id="modifier-preview"
             style="margin:6px 0 10px;padding:6px 10px;border-radius:6px;
                    background:${modIsNone ? 'rgba(255,255,255,0.05)' : 'rgba(240,165,0,0.12)'};
                    border:1px solid ${modIsNone ? 'rgba(255,255,255,0.08)' : 'rgba(240,165,0,0.35)'};
                    font-size:0.82em;line-height:1.5;text-align:left;">
          <span style="font-weight:700;color:${modIsNone ? '#aaa' : '#f0a500'};">
            ${modIsNone ? 'Scenario: Standard' : `Scenario: ${modLabel}`}
          </span>
          ${modIsNone ? '' : `<br><span style="opacity:0.75;">${modDesc}</span>`}
        </div>
        <div class="start-btn-row">
          <button class="start-begin-btn" data-action="newgame">Free Play</button>
          <button class="start-campaign-btn" data-action="open-campaign">Campaign ▸</button>
        </div>
        <p class="start-controls-hint">Move: WASD / arrows / click · Walk near wildlife to scan it<br>Space: end a day · F: fast-forward to the next change · N: notes · V: store</p>
      </div>
    </div>
  `);

  // Live-update modifier preview as the user changes the seed input.
  const seedEl = document.getElementById('seed-input');
  if (seedEl) {
    seedEl.addEventListener('input', () => {
      const s = Math.max(1, parseInt(seedEl.value || '1', 10));
      const m = pickModifier(s);
      const previewEl = document.getElementById('modifier-preview');
      if (!previewEl) return;
      const isNone = m.id === 'none';
      previewEl.style.background = isNone
        ? 'rgba(255,255,255,0.05)' : 'rgba(240,165,0,0.12)';
      previewEl.style.borderColor = isNone
        ? 'rgba(255,255,255,0.08)' : 'rgba(240,165,0,0.35)';
      previewEl.innerHTML =
        `<span style="font-weight:700;color:${isNone ? '#aaa' : '#f0a500'};">
           ${isNone ? 'Scenario: Standard' : `Scenario: ${escapeHTML(m.label)}`}
         </span>` +
        (isNone ? '' : `<br><span style="opacity:0.75;">${escapeHTML(m.description)}</span>`);
    });
  }
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

/** True after the first day-advance explainer has been shown this session. */
let _dayAdvanceExplained = false;

function showDayResultBanner(prevHealth, newHealth, dayCount, resourceDelta = 0, newTimer = null) {
  const delta = newHealth - prevHealth;
  const sign  = delta >= 0 ? '+' : '';
  // Teach what a day actually does: species react (health moves), you earn
  // resources, and the collapse timer ticks down.
  const parts = [
    `Day ${dayCount}`,
    `Health ${Math.round(prevHealth)}→${Math.round(newHealth)}% (${sign}${Math.round(delta)}%)`,
  ];
  if (resourceDelta) parts.push(`${resourceDelta >= 0 ? '+' : ''}¤${resourceDelta}`);
  if (newTimer !== null) parts.push(`T-${newTimer}`);
  let msg = parts.join('  ·  ');

  let duration = 3500;
  if (!_dayAdvanceExplained) {
    _dayAdvanceExplained = true;
    msg += `\nEnding a day lets species react, pays you ¤ to spend, and ticks the collapse timer. Spend ¤ on the right fix.`;
    duration = 6500;
  }
  showToast(msg, delta >= 0 ? 'success' : 'warning', duration);
}

// ─────────────────────────────────────────────────────────────────────────────
// New game generation
// ─────────────────────────────────────────────────────────────────────────────

/** Currently-selected biome for the next new game (set on the start card). */
let _selectedBiome = 'coastal_wetland';

/**
 * The mission that is currently being played, or null for a free run.
 * Set by the campaign-play action; checked by checkEndCondition to award completion.
 * @type {{ id: string, title: string } | null}
 */
let _activeMission = null;

async function newGame(seed, biomeKey = _selectedBiome) {
  showOverlay(`<div class="panel card"><h1>Generating World…</h1><p>Seed: ${escapeHTML(seed)}</p></div>`);
  await new Promise(r => setTimeout(r, 50));

  try {
    const biomes   = await loadBiomeTemplate();
    const template = biomes[biomeKey] ?? biomes['coastal_wetland'];
    GameState.reset();
    GameState.meta.biome_template = biomeKey;
    GameState.meta.biome_name     = template.displayName ?? 'ecosystem';
    GameState.meta.collapse_timer = template.collapseTimer ?? COLLAPSE_TIMER;  // per-biome clock
    _proximityDiscovered.clear(); // reset session discovery tracker for new world
    generateWorld(template, seed, GameState);

    // Apply scenario modifier economy multipliers.
    // pickModifier uses the same seed → same modifier as generator.js.
    const mod = pickModifier(seed);
    GameState.player.resources     = Math.round(START_RESOURCES * mod.startResMult);
    // Store effective daily income for ecosystem.js to read each tick.
    GameState.meta.daily_income    = Math.round(DAILY_INCOME    * mod.dailyIncomeMult);
    // Trade-off modifiers grant extra days to offset their economy penalty.
    GameState.meta.collapse_timer += (mod.collapseTimerBonus ?? 0);

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
    // Award campaign mission completion before showing the win card.
    if (_activeMission) {
      CampaignState.complete(_activeMission.id);
      _activeMission = null;
    }
    setTimeout(showWinCard, 500);
  } else if (GameState.flags.lose && overlay.hidden) {
    // Loss: keep _activeMission so the player can retry and try again.
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
      // Free-play run — no active mission.
      _activeMission = null;
      // First user gesture — unlock audio context (browser autoplay policy)
      _unlockAudio();
      const seedInput = document.getElementById('seed-input');
      const seed = Math.max(1, parseInt(seedInput?.value || '1', 10));
      await newGame(seed, _selectedBiome);
      break;
    }

    // ── Win/lose card: brand-new run with a fresh seed (same biome) ────────
    case 'new-seed': {
      _activeMission = null;
      _unlockAudio();
      // UI input — Date.now() used ONLY to pick the seed, not in sim/generation
      const freshSeed = Math.max(1, Date.now() % 999999 || 1);
      await newGame(freshSeed, GameState.meta.biome_template);
      break;
    }

    // ── Win/lose card: replay the exact same world (same biome) ────────────
    case 'retry-seed': {
      // Keep _activeMission: retry-seed replays the SAME seed, so if this was a
      // lost campaign mission, retrying and winning should still credit it.
      // (It's already null for free-play runs and after a win, so no false credit.)
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

    // ── Campaign panel ────────────────────────────────────────────────────
    case 'open-campaign': {
      showOverlay(buildCampaignHTML());
      break;
    }

    case 'campaign-select': {
      // Highlight a different mission in the campaign panel (no navigation away).
      const missionId = btn.dataset.missionId;
      if (missionId) showOverlay(buildCampaignHTML(missionId));
      break;
    }

    case 'campaign-play': {
      _unlockAudio();
      const mId    = btn.dataset.missionId;
      const mBiome = btn.dataset.biome;
      const mSeed  = Math.max(1, parseInt(btn.dataset.seed || '1', 10));
      const mDef   = MISSIONS.find(m => m.id === mId);
      if (!mDef) { showStartCard(); break; }
      _activeMission = { id: mDef.id, title: mDef.title };
      _selectedBiome = mBiome === 'coral_reef' ? 'coral_reef' : 'coastal_wetland';
      await newGame(mSeed, _selectedBiome);
      break;
    }

    case 'campaign-close': {
      // Return to the start card from the campaign panel.
      showStartCard();
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
    case 'f': case 'F':
      e.preventDefault();
      // F = fast-forward: batch-advance until something meaningful changes
      if (overlay.hidden) advanceUntilEvent();
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
  showBootError('Could not start the game. Please refresh the page to try again.');
});

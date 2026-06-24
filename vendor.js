/**
 * vendor.js — Intervention Store panel for Ecosystem X
 *
 * Interventions (Rule 02-F verbatim):
 *   Bioremediation  base ¤60  → reduce stressor L on the PLAYER'S CURRENT TILE by 50
 *                                (deductive core: player must navigate to the right tile)
 *   Rebalancing     base ¤45  → reintroduce a native species (P→20% K_max) if any node
 *                                has L<20 AND P<20; OR cull an invasive (no keystone with
 *                                P>K_max*0.8) to cut its pop by 45%
 *   Stabilization   base ¤120 → PROTECT the player's current tile (tile.protected=true,
 *                                stressor growth frozen) AND raise its effective K by
 *                                capping its stressor at 20 for the next step calculation
 *
 * Prices are multiplied by state.vendor.price_factor (set by hysteria.js).
 *
 * Rule 01 / Law 2: No Math.random() — all effects are deterministic.
 * Rule 03: every purchase ends with state.save().
 * Rule 04: NO scope creep — stabilization does NOT extend collapse_timer.
 *
 * Exports:
 *   buildVendorHTML(state)  → HTML string (injected by main.js into #overlay)
 *   applyIntervention(type, state) → { ok, message, cost }
 */

import { getPricedCost, getVendorDialogue, TIER_COLORS } from './hysteria.js';
import { getInterventionDialogue, INTERVENTION_DESCRIPTIONS } from './ai_content.js';

// ─────────────────────────────────────────────────────────────────────────────
// applyIntervention — state mutation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * applyIntervention(type, state) → { ok: bool, message: string, cost: number }
 *
 * @param {'bioremediation'|'rebalancing'|'stabilization'} type
 * @param {object} state — GameState
 */
export function applyIntervention(type, state) {
  if (state.flags.win || state.flags.lose) {
    return { ok: false, message: 'The run is over. No interventions can be applied.', cost: 0 };
  }

  const cost = getPricedCost(type, state);

  if (state.player.resources < cost) {
    return { ok: false, message: `Not enough resources. Need ¤${cost}, have ¤${state.player.resources}.`, cost };
  }

  // ── Deduct resources ──────────────────────────────────────────────────────
  state.player.resources -= cost;

  // ── Apply effect (Rule 02-F) ──────────────────────────────────────────────
  let effectMessage = '';

  switch (type) {

    // ── Bioremediation: reduce stressor on PLAYER'S CURRENT TILE ─────────────
    // Rule 02-F: player must NAVIGATE to the polluted tile — this is the
    // deductive core of the game.  Auto-targeting the highest tile is a
    // scope-creep shortcut and removes the spatial deduction challenge.
    case 'bioremediation': {
      const tileId = `t_${state.player.tile_x}_${state.player.tile_y}`;
      const tile   = state.world.tiles[tileId];
      if (!tile) {
        // Tile not yet in world map (shouldn't happen after fix 3, but guard it)
        return { ok: false, message: 'No tile at your current position.', cost: 0 };
      }
      const before = tile.stressor ?? 0;
      tile.stressor = Math.max(0, before - 50); // re-tuned 40→50 for humane margin
      effectMessage = `Tile (${state.player.tile_x},${state.player.tile_y}): stressor ${Math.round(before)} → ${Math.round(tile.stressor)}.`;
      break;
    }

    // ── Rebalancing: reintroduce native OR cull invasive (Rule 02-F) ──────────
    // Priority 1: find any biological node whose tile stressor < 20 AND whose
    //   population is critically low (P < 20% K_max) — reintroduce to 20% K_max.
    // Priority 2: if no candidate for reintroduction, find a non-keystone node
    //   with P > 80% K_max (over-abundant / invasive-like) and cull by 30%.
    case 'rebalancing': {
      // Sort nodes by id for determinism (Rule 01 / Law 2)
      const bioNodes = Object.values(state.world.nodes)
        .filter(n => n.kind !== 'stressor' && n.status !== 'extinct')
        .sort((a, b) => a.id < b.id ? -1 : 1);

      // Candidate for reintroduction: stressor L < 20 AND P < 20% of K_max
      const reintroTarget = bioNodes.find(n => {
        const tileL = state.world.tiles[n.tileId]?.stressor ?? 100;
        return tileL < 20 && n.K_max > 0 && n.population < 0.20 * n.K_max;
      });

      if (reintroTarget) {
        const before = reintroTarget.population;
        reintroTarget.population = Math.round(0.20 * reintroTarget.K_max);
        reintroTarget.extinction_counter = 0; // halt extinction clock
        if (reintroTarget.status !== 'stable') reintroTarget.status = 'stable';
        effectMessage = `${reintroTarget.name}: population reintroduced ${before} → ${reintroTarget.population} (native habitat clear).`;
      } else {
        // No low-pop native to restore — cull the most over-abundant non-keystone
        const cullTarget = bioNodes
          .filter(n => !n.keystone && n.K_max > 0 && n.population > 0.80 * n.K_max)
          .sort((a, b) =>
            (b.population / b.K_max) - (a.population / a.K_max)
          )[0];

        if (cullTarget) {
          const before = cullTarget.population;
          cullTarget.population = Math.max(0, Math.round(before * 0.55)); // cull 45%
          effectMessage = `${cullTarget.name}: invasive culled ${before} → ${cullTarget.population} (−45%).`;
        } else {
          // Neither condition applies — refund and report
          state.player.resources += cost;
          return { ok: false, message: 'No species qualifies for reintroduction or culling right now.', cost: 0 };
        }
      }
      break;
    }

    // ── Stabilization: protect player's current tile (Rule 02-F) ─────────────
    // Marks the tile protected=true (rendered with dashed accent border).
    // Also caps the tile's stressor at 20 so K_i(L) calculation uses at most
    // L=20 for nodes on this tile for the next daily step — effectively raising
    // their productive carrying capacity without touching collapse_timer.
    // Rule 04 guard: do NOT add days to collapse_timer (balance hole).
    case 'stabilization': {
      const tileId = `t_${state.player.tile_x}_${state.player.tile_y}`;
      const tile   = state.world.tiles[tileId];
      if (!tile) {
        return { ok: false, message: 'No tile at your current position.', cost: 0 };
      }
      if (tile.protected) {
        // Already protected — refund
        state.player.resources += cost;
        return { ok: false, message: 'This tile is already stabilized.', cost: 0 };
      }
      tile.protected = true;
      // Cap stressor at 20 to raise effective K (Rule 02-F stabilization effect)
      tile.stressor = Math.min(tile.stressor ?? 0, 20);
      effectMessage = `Tile (${state.player.tile_x},${state.player.tile_y}) stabilized. Effective stressor capped at 20.`;
      break;
    }

    default:
      return { ok: false, message: `Unknown intervention type: ${type}`, cost: 0 };
  }

  state.save();

  const tier      = state.meta.market_tier;
  const flavour   = getInterventionDialogue(type, tier);
  const message   = `${flavour}\n\n${effectMessage}`;

  return { ok: true, message, cost };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildVendorHTML — panel HTML builder
// ─────────────────────────────────────────────────────────────────────────────

/**
 * buildVendorHTML(state) → string
 *
 * @param {object} state — GameState
 * @returns {string} HTML
 */
export function buildVendorHTML(state) {
  const tier       = state.meta.market_tier;
  const tierColor  = TIER_COLORS[tier] ?? '#aaa';
  const dialogue   = getVendorDialogue(tier, state.meta.day_count);
  const resources  = state.player.resources;

  const itemsHTML = state.vendor.available.map(type => {
    const desc   = INTERVENTION_DESCRIPTIONS[type];
    const cost   = getPricedCost(type, state);
    const canBuy = resources >= cost;
    const btnCls = canBuy ? 'btn' : 'btn btn-disabled';

    return `
      <div class="vendor-item${canBuy ? '' : ' vendor-item-disabled'}">
        <div class="vendor-item-header">
          <span class="vendor-icon">${desc.icon}</span>
          <strong class="vendor-name">${desc.name}</strong>
          <span class="vendor-cost ${canBuy ? 'cost-ok' : 'cost-low'}">¤${cost}</span>
        </div>
        <p class="vendor-effect">${desc.effect}</p>
        <p class="vendor-detail">${desc.detail}</p>
        <button class="${btnCls}" data-action="buy" data-intervention="${type}"
          ${canBuy ? '' : 'disabled aria-disabled="true"'}>
          ${canBuy ? `Buy (¤${cost})` : `Need ¤${cost}`}
        </button>
      </div>
    `;
  }).join('');

  return `
    <div class="panel vendor-panel" role="document" aria-label="Intervention Store">
      <div class="vendor-header">
        <h2>🛒 Field Supply Depot</h2>
        <button class="btn btn-sm" data-action="close" aria-label="Close store">✕</button>
      </div>

      <div class="vendor-tier-bar">
        <span>Market Tier:</span>
        <span class="tier-badge" style="color:${tierColor};border-color:${tierColor}40;">${tier.toUpperCase()}</span>
        <span class="vendor-resources">Your resources: <strong>¤${resources}</strong></span>
      </div>

      <div class="vendor-npc-line">
        <span class="npc-icon">🧑‍🌾</span>
        <em>"${dialogue}"</em>
      </div>

      <div class="vendor-items">
        ${itemsHTML}
      </div>

      <div class="vendor-footer">
        <button class="btn btn-secondary" data-action="open-notebook">📓 Field Notebook</button>
        <button class="btn btn-secondary" data-action="endday">⏭ Advance Day</button>
      </div>
    </div>
  `;
}

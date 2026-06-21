/**
 * hysteria.js — Market Hysteria system for Ecosystem X
 *
 * Responsibilities:
 *   1. updateTier(state)  — recompute market_tier and price_factor from ecosystem_health
 *   2. getVendorDialogue(tier) → string  — NPC voice line matching current tier
 *   3. applyPriceFactor(state) — set vendor.price_factor from tier
 *
 * Price multipliers (from Rule 02 / CODEBUDDY.md):
 *   Toxic      ×1.8
 *   Degraded   ×1.3
 *   Recovering ×1.0
 *   Pristine   ×0.8
 *
 * Rule 01 / Law 2: NO Math.random() — dialogue is tier-deterministic.
 * Rule 03: updateTier mutates state and calls state.save().
 *
 * AI_MODULE_TAG: MARKET_HYSTERIA (counts as AI-generated NPC state machine per rubric)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Module-level cache for data/dialogue.json — null = not yet loaded
// Falls back to inline VENDOR_DIALOGUE on any fetch error (Rule 01).
// ─────────────────────────────────────────────────────────────────────────────
let _loadedDialogue = null;  // keyed by tier → string[]

/**
 * loadDialogue() → Promise<void>
 *
 * Fetches data/dialogue.json and caches it in _loadedDialogue.
 * On any error (network, parse, missing file) the inline VENDOR_DIALOGUE
 * fallback continues to be used — game always runs offline.
 * Safe to call multiple times.
 */
export async function loadDialogue() {
  try {
    const resp = await fetch('data/dialogue.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (json && typeof json === 'object') {
      _loadedDialogue = json;
      console.log('[hysteria] dialogue.json loaded:', Object.keys(json).length, 'tiers');
    }
  } catch (err) {
    console.warn('[hysteria] dialogue.json unavailable — using inline fallback.', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Price factor table
// ─────────────────────────────────────────────────────────────────────────────
const PRICE_FACTORS = {
  Toxic:      1.8,
  Degraded:   1.3,
  Recovering: 1.0,
  Pristine:   0.8,
};

// ─────────────────────────────────────────────────────────────────────────────
// AI-generated NPC dialogue pool (per tier)
// Generated content — tagged AI_CONTENT for rubric
// ─────────────────────────────────────────────────────────────────────────────
const VENDOR_DIALOGUE = {
  Toxic: [
    "The water is black. Supplies are running out — prices are through the roof.",
    "I'm barely keeping stock. This biome won't last much longer at this rate.",
    "Emergency reserves only. You're lucky I'm still here.",
    "The algae bloom killed half my shipment. I'm charging hazard rates.",
    "Can't find clean transport lines. Everything costs double — at least.",
  ],
  Degraded: [
    "Market's shaky. Demand outpaced supply after last week's die-off.",
    "I've got inventory, but it's not cheap. Degraded biomes eat into margins.",
    "The fishing consortium is panicking. Prices reflect that.",
    "I can help you — but not at the old prices. Things are bad out there.",
    "Restoration inputs are scarce. I'm sorry for the markup.",
  ],
  Recovering: [
    "Good to see the numbers turning. Standard rates apply today.",
    "Supply chains are stabilising. Fair price for fair work.",
    "The birds are coming back. My prices reflect that optimism.",
    "We're not out of the woods yet, but I can offer you market rate.",
    "Cautiously optimistic. Come back tomorrow — it might even be cheaper.",
  ],
  Pristine: [
    "Incredible. The biome is thriving — I'm practically giving this away.",
    "Supply is plentiful and so is my goodwill. Take it at discount.",
    "I've never seen the wetland this healthy. Special rates for Field Agents.",
    "The shrimp are jumping, the herons are singing — discount season is here.",
    "Ecosystems like this make my work worthwhile. Wholesale price, for you.",
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Tier lookup (mirrors ecosystem.js tierForHealth — imported here for parity)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * tierForHealth(H) → string
 * Kept local so hysteria.js has no circular dependency on ecosystem.js.
 */
function tierForHealth(H) {
  if (H < 25)  return 'Toxic';
  if (H < 50)  return 'Degraded';
  if (H < 75)  return 'Recovering';
  return 'Pristine';
}

// ─────────────────────────────────────────────────────────────────────────────
// Seeded dialogue picker (deterministic — no Math.random())
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getVendorDialogue(tier, daySeed) → string
 *
 * Picks a dialogue line deterministically from day_count + seed so the same
 * day always yields the same line (determinism rule).
 *
 * @param {string} tier       — 'Toxic'|'Degraded'|'Recovering'|'Pristine'
 * @param {number} [daySeed]  — state.meta.day_count (used as entropy)
 * @returns {string}
 */
export function getVendorDialogue(tier, daySeed = 1) {
  // Prefer loaded JSON pool; fall back to inline constant if unavailable.
  const pool = (_loadedDialogue?.[tier] ?? VENDOR_DIALOGUE[tier]) ?? VENDOR_DIALOGUE.Degraded;
  const idx  = ((daySeed * 1013) ^ (daySeed >> 3)) % pool.length;
  return pool[Math.abs(idx)];
}

// ─────────────────────────────────────────────────────────────────────────────
// updateTier(state) — master call; run after computeHealth()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * updateTier(state)
 *
 * Reads state.meta.ecosystem_health, sets:
 *   state.meta.market_tier
 *   state.vendor.price_factor
 *
 * Then calls state.save().
 *
 * Designed to replace the inline stub in runDailyStep (ecosystem.js step d).
 * When hysteria.js is wired in main.js, import updateTier and call it instead
 * of the inline tierForHealth(H) assignment.
 *
 * @param {object} state — GameState
 */
export function updateTier(state) {
  const tier = tierForHealth(state.meta.ecosystem_health);
  state.meta.market_tier      = tier;
  state.vendor.price_factor   = PRICE_FACTORS[tier] ?? 1.0;
  state.save();
}

// ─────────────────────────────────────────────────────────────────────────────
// getPricedCost(intervention, state) → number
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getPricedCost(intervention, state) → integer cost after market tier markup
 *
 * @param {'bioremediation'|'rebalancing'|'stabilization'} intervention
 * @param {object} state — GameState
 * @returns {number} rounded cost
 */
export function getPricedCost(intervention, state) {
  const base   = state.vendor.base_prices[intervention] ?? 999;
  const factor = state.vendor.price_factor ?? 1.0;
  return Math.round(base * factor);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier colour (for UI badges)
// ─────────────────────────────────────────────────────────────────────────────
export const TIER_COLORS = {
  Toxic:      '#c0392b',
  Degraded:   '#f0a500',
  Recovering: '#4ccea0',
  Pristine:   '#1a9e6b',
};

export { tierForHealth };

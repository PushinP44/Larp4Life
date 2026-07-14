/**
 * balance.js — SINGLE SOURCE OF TRUTH for every gameplay tuning constant.
 *
 * Why this file exists
 * --------------------
 * Before this file, the same numbers were hand-copied across ecosystem.js,
 * validator.js, state.js, generator.js and tools/balance-harness.js — each with
 * a comment saying "must mirror the others". That is a silent-drift trap: change
 * one, forget another, and the harness happily "verifies" a build the player
 * never actually runs. Every module now imports its constants from here, so
 * there is exactly one place to retune and the harness always tests the shipped
 * numbers.
 *
 * NOTE for the balance harness: the harness deliberately RE-IMPLEMENTS the daily
 * step as an independent oracle of the simulation *logic*. It still imports its
 * *constants* from here — the numbers must match the game; only the step code is
 * independent. See tools/balance-harness.js.
 *
 * These values are harness-verified (see README "Balance" section). Re-run
 * `npm test` after touching anything in this file.
 *
 * Rule 01 / Law 2: pure data, no Math.random, no side effects — safe to import
 * from both the browser modules and Node (package.json has "type":"module").
 */

// ── Core simulation (Rule 02, Eq2 + Eq3) ─────────────────────────────────────
/** θ — food at ≥θ of pristine capacity fully sustains a consumer. */
export const FOOD_SUFFICIENCY = 0.4;
/** Fraction of population lost per day when food → 0 (bottom-up cascade rate). */
export const STARVE_RATE = 0.18;
/** ±fraction stability clamp on the net daily population change per node. */
export const MAX_DELTA_FRAC = 0.35;
/** Coefficient on mean stressor load in the Ecosystem Health penalty (Eq3). */
export const STRESSOR_PENALTY_COEFF = 0.10;

// ── Typed-stressor knobs ─────────────────────────────────────────────────────
/** L added to each orthogonal neighbour per day by a runoff source. */
export const RUNOFF_SPREAD = 4;
/** Default daily population drain applied by an overharvest stressor. */
export const HARVEST_DRAIN = 6;
/** Fraction of an invasive population removed by one Rebalancing cull. */
export const CULL_FRAC = 0.45;
/** Max stressor level a Stabilized/protected tile can hold. */
export const PROTECT_CAP = 20;
/** L reduction applied by one Bioremediation on the player's tile. */
export const BIOREM_AMOUNT = 50;

// ── Trade-off #2 — invasive is also the keystone predator's backup food ──────
/** Prey relative abundance below which the predator is at risk when over-culling. */
export const TRADEOFF_PREY_SAFE = 0.45;
/** Invasive relative abundance below which its backup-food role is gone. */
export const INVASIVE_STARVE_FLOOR = 0.20;
/** Predator population lost per day when over-culled while prey is scarce. */
export const HERON_STARVE_PENALTY = 6;

// ── Escalation #4 — unaddressed runoff accelerates (bounded), reverses on clean ─
/** +intensity per day the runoff source stays uncleaned. */
export const RUNOFF_ESCALATION_RATE = 0.06;
/** Escalation cap — spread up to ×(1+max) at full escalation. */
export const RUNOFF_ESCALATION_MAX = 0.80;
/** Intensity recovered per day once the source is cleaned. */
export const RUNOFF_ESCALATION_DECAY = 0.15;

// ── Economy ──────────────────────────────────────────────────────────────────
/** Resources credited to the player each day. */
export const DAILY_INCOME = 65;
/** Resources the player starts a run with. */
export const START_RESOURCES = 100;
/** Scanner charges granted at start and on each daily recharge. */
export const SCANNER_CHARGES = 5;
/** Collapse timer (days) — uniform across all worlds (re-tune §1). */
export const COLLAPSE_TIMER = 45;

// ── Intervention base costs (pre-hysteria; multiplied by vendor price_factor) ─
export const COST_BIOREMEDIATION = 60;
export const COST_REBALANCING = 45;   // cull slot
export const COST_STABILIZATION = 120; // protect slot

/** Convenience map — vendor uses these as its default base_prices. */
export const BASE_PRICES = {
  bioremediation: COST_BIOREMEDIATION,
  rebalancing:    COST_REBALANCING,
  stabilization:  COST_STABILIZATION,
};

// ── Win / lose / extinction (Rule 02-D / 02-E) ───────────────────────────────
/** Ecosystem Health required to be in the Pristine tier / to win. */
export const WIN_HEALTH = 75;
/** Consecutive Pristine days required to win. */
export const WIN_STREAK_DAYS = 3;
/** Consecutive days at P==0 before a node is permanently extinct. */
export const EXTINCTION_DAYS = 3;

// ── Health tiers (Market Hysteria thresholds) ────────────────────────────────
/** Upper bounds (exclusive) for each health tier. */
export const TIER_TOXIC_MAX = 25;
export const TIER_DEGRADED_MAX = 50;
export const TIER_RECOVERING_MAX = 75;

/** Vendor price multiplier per health tier (deterministic Market Hysteria). */
export const PRICE_FACTOR = {
  Toxic:      1.8,
  Degraded:   1.3,
  Recovering: 1.0,
  Pristine:   0.8,
};

// ── Scenario modifiers ────────────────────────────────────────────────────
// Multipliers only — no new tuning constants, no Math.random.
// The active modifier is selected deterministically from the seed inside
// generator.js (seed % MODIFIERS.length), so the same seed always yields
// the same world + modifier. base-seed worlds (modifier index 0, "none")
// are byte-identical to pre-modifier runs.
//
// Field semantics:
//   kMaxMult        — multiplied onto every producer/consumer/predator K_max
//                     AFTER the normal jittered value is drawn (applied in
//                     generator.js, no balance.js value duplicated).
//   startResMult    — multiplied onto START_RESOURCES for the run.
//   dailyIncomeMult — multiplied onto DAILY_INCOME for the run.
//   doubleInvasive  — if true, force the invasive stressor into the pool
//                     regardless of the seed's normal stressor selection.
//   tightBudget     — informational flag; effects implemented via the two
//                     income/resource multipliers above.
//
// To keep all harness gates green, modifier tuning is self-contained here.
// Never weaken a gate — only tighten modifier numbers until it passes.
export const MODIFIERS = [
  {
    id:               'none',
    label:            'Standard',
    description:      'No twist — baseline run.',
    kMaxMult:         1.00,
    startResMult:     1.00,
    dailyIncomeMult:  1.00,
    doubleInvasive:   false,
    tightBudget:      false,
  },
  {
    id:               'drought',
    label:            'Drought',
    description:      'Prolonged dry spell — producer carrying capacity is reduced.',
    kMaxMult:         0.65,
    startResMult:     1.00,
    dailyIncomeMult:  1.00,
    doubleInvasive:   false,
    tightBudget:      false,
  },
  {
    id:               'double_invasive',
    label:            'Double Invasion',
    description:      'A second invasive pressure has established itself alongside the first.',
    kMaxMult:         1.00,
    startResMult:     1.00,
    dailyIncomeMult:  1.00,
    doubleInvasive:   true,
    tightBudget:      false,
  },
  {
    id:               'tight_budget',
    label:            'Tight Budget',
    description:      'Conservation funding was cut — fewer resources to start and per day, but a little more time to cope.',
    // ECONOMY-ONLY (kMaxMult 1.00): does NOT touch world generation, so the world
    // is byte-identical to 'none' for a given seed. That makes the only failure
    // mode timer_expired, which the timer bonus fixes MONOTONICALLY (more days
    // never creates a new loss — unlike a kMax change, which reshuffles worlds and
    // just relocates the razor-thin seed). Verified 100% win-rate to 3000 seeds.
    kMaxMult:         1.00,
    startResMult:     0.80,
    dailyIncomeMult:  0.85,
    collapseTimerBonus: 8,
    doubleInvasive:   false,
    tightBudget:      true,
  },
  {
    id:               'drought_and_budget',   // id kept for save-compat; now a pure-austerity twist
    label:            'Austerity',
    description:      'Deep funding cuts — far fewer resources, offset by extra time to adapt.',
    // Also ECONOMY-ONLY (see tight_budget note) — harsher cut, larger time offset.
    // No kMax change, so no world reshuffle and no whack-a-mole tail seed.
    kMaxMult:         1.00,
    startResMult:     0.75,
    dailyIncomeMult:  0.85,
    collapseTimerBonus: 18,
    doubleInvasive:   false,
    tightBudget:      true,
  },
];

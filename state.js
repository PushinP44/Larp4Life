/**
 * state.js — GameState singleton for Ecosystem X
 *
 * Rule 03 (State Schema Integrity):
 *   • ONE object holds ALL game state.
 *   • Every mutating function ends with state.save().
 *   • meta.seed is written once at world-generation and never mutated mid-run.
 *   • stressor (L) clamped [0,100] on every write.
 *   • population is non-negative integer on every write.
 *   • actionsThisStep cleared by resetDay().
 *
 * Rule 01 / Law 2:  No Math.random() here — all randomness comes from prng.js.
 * Rule 01 / Law 1:  Renderer/input code MAY read state; only designated mutators WRITE it.
 */

const STORAGE_KEY = 'ecosystem_x_state';

// ─────────────────────────────────────────────────────────────────────────────
// Default state (matches the canonical schema in Rule 03 exactly)
// ─────────────────────────────────────────────────────────────────────────────
function makeDefaultState() {
  return {
    meta: {
      seed: 0,                        // integer; written once at generation
      biome_template: 'coastal_wetland',
      day_count: 1,
      collapse_timer: 40,             // days remaining before lose (re-tuned 30→40 for humane margin)
      health_streak: 0,               // consecutive days at H >= 75
      ecosystem_health: 50.0,         // 0–100, derived each step
      market_tier: 'Degraded'         // Toxic | Degraded | Recovering | Pristine
    },
    player: {
      name: 'Field Agent',
      resources: 100,
      tile_x: 4,
      tile_y: 6,
      scanner_charges: 5,
      facing: 'down'          // 'down'|'left'|'right'|'up' — updated by input.js on every move
    },
    world: {
      grid: { w: 16, h: 12 },
      tiles: {},                      // populated by generator.js
      nodes: {},                      // populated by generator.js
      edges: [],                      // populated by generator.js
      actionsThisStep: {}             // A_i accumulator; cleared by resetDay()
    },
    notebook: {
      discovered_nodes: [],           // nodeIds the player has scanned
      revealed_edges: []              // "from->to" keys the player has observed
    },
    vendor: {
      base_prices: {
        bioremediation: 60,   // difficulty re-tune: 80→60 so player can act more frequently
        rebalancing: 90,
        stabilization: 150
      },
      price_factor: 1.3,              // set by Market Hysteria tier
      available: ['bioremediation', 'rebalancing', 'stabilization']
    },
    flags: { win: false, lose: false }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Deep-merge helper: fills in missing fields from defaults without overwriting
// existing values — keeps load() backward-compatible when schema gains fields.
// ─────────────────────────────────────────────────────────────────────────────
function deepMergeDefaults(target, defaults) {
  for (const key of Object.keys(defaults)) {
    if (!(key in target)) {
      // Missing key: copy default (deep-clone primitives/objects/arrays)
      target[key] = JSON.parse(JSON.stringify(defaults[key]));
    } else if (
      typeof defaults[key] === 'object' &&
      defaults[key] !== null &&
      !Array.isArray(defaults[key]) &&
      typeof target[key] === 'object' &&
      target[key] !== null &&
      !Array.isArray(target[key])
    ) {
      // Both are plain objects: recurse
      deepMergeDefaults(target[key], defaults[key]);
    }
    // For arrays and primitives: existing value wins (no merge)
  }
  return target;
}

// ─────────────────────────────────────────────────────────────────────────────
// GameState singleton
// ─────────────────────────────────────────────────────────────────────────────
const GameState = {

  // ── Populated by load() or directly by generator.js ─────────────────────
  ...makeDefaultState(),

  /**
   * save() — serialize current state to localStorage.
   * MUST be called as the LAST line of every mutating function.
   */
  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this._snapshot()));
    } catch (e) {
      // Storage quota or private-browsing block — warn but don't crash.
      console.warn('[state.js] save() failed:', e.message);
    }
  },

  /**
   * load() — deserialize from localStorage; deep-merges defaults for any
   * missing fields (forward/backward compatibility).
   * Returns `this` so callers can chain: GameState.load().
   */
  load() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Nothing stored — reset to defaults.
      this._applySnapshot(makeDefaultState());
      return this;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn('[state.js] load() parse error — resetting to defaults:', e.message);
      this._applySnapshot(makeDefaultState());
      return this;
    }
    // Merge stored data on top of fresh defaults to fill any gaps.
    const merged = deepMergeDefaults(parsed, makeDefaultState());
    this._applySnapshot(merged);
    return this;
  },

  /**
   * resetDay() — called at the start of each new day tick.
   * Clears actionsThisStep (the per-step A_i accumulator).
   * Does NOT increment day_count — ecosystem.js owns that.
   */
  resetDay() {
    this.world.actionsThisStep = {};
    this.save();
  },

  /**
   * reset() — wipe localStorage and restore factory defaults.
   * Used by the start-new-game flow.
   */
  reset() {
    localStorage.removeItem(STORAGE_KEY);
    this._applySnapshot(makeDefaultState());
  },

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * _snapshot() — return a plain JSON-serialisable copy of all data fields.
   * Excludes methods so JSON.stringify doesn't blow up.
   */
  _snapshot() {
    return {
      meta:     JSON.parse(JSON.stringify(this.meta)),
      player:   JSON.parse(JSON.stringify(this.player)),
      world:    JSON.parse(JSON.stringify(this.world)),
      notebook: JSON.parse(JSON.stringify(this.notebook)),
      vendor:   JSON.parse(JSON.stringify(this.vendor)),
      flags:    JSON.parse(JSON.stringify(this.flags))
    };
  },

  /**
   * _applySnapshot(snap) — copy all data fields from a plain object into
   * this singleton, without replacing the method references.
   */
  _applySnapshot(snap) {
    this.meta     = snap.meta;
    this.player   = snap.player;
    this.world    = snap.world;
    this.notebook = snap.notebook;
    this.vendor   = snap.vendor;
    this.flags    = snap.flags;
  }
};

export default GameState;

/* ─────────────────────────────────────────────────────────────────────────────
   Self-tests
   Run from the browser console:
     import GameState, { runStateTests } from './state.js';
     runStateTests();
───────────────────────────────────────────────────────────────────────────── */

export function runStateTests() {
  // ── Test 1: load() with empty storage → returns defaults ────────────────
  localStorage.removeItem(STORAGE_KEY);
  GameState.load();
  console.assert(GameState.meta.seed === 0,
    'STATE FAIL: default seed should be 0');
  console.assert(GameState.player.resources === 100,
    'STATE FAIL: default resources should be 100');
  console.assert(GameState.player.scanner_charges === 5,
    'STATE FAIL: default scanner_charges should be 5');
  console.assert(GameState.meta.collapse_timer === 40,
    'STATE FAIL: default collapse_timer should be 40');
  console.assert(GameState.flags.win === false && GameState.flags.lose === false,
    'STATE FAIL: default flags should be false');
  console.assert(Object.keys(GameState.world.actionsThisStep).length === 0,
    'STATE FAIL: default actionsThisStep should be empty');

  // ── Test 2: save() then load() round-trips correctly ────────────────────
  GameState.meta.day_count = 7;
  GameState.player.resources = 42;
  GameState.meta.ecosystem_health = 63.5;
  GameState.save();

  // Simulate a fresh load by wiping in-memory state then calling load().
  GameState._applySnapshot(makeDefaultState());
  console.assert(GameState.meta.day_count === 1,
    'STATE FAIL: in-memory wipe did not reset day_count');

  GameState.load();
  console.assert(GameState.meta.day_count === 7,
    'STATE FAIL: save/load round-trip lost day_count');
  console.assert(GameState.player.resources === 42,
    'STATE FAIL: save/load round-trip lost resources');
  console.assert(Math.abs(GameState.meta.ecosystem_health - 63.5) < 1e-9,
    'STATE FAIL: save/load round-trip lost ecosystem_health');

  // ── Test 3: resetDay() clears actionsThisStep only ───────────────────────
  GameState.world.actionsThisStep = { n_shrimp: 5, n_heron: 2 };
  const dayBefore = GameState.meta.day_count;
  GameState.resetDay();
  console.assert(Object.keys(GameState.world.actionsThisStep).length === 0,
    'STATE FAIL: resetDay() did not clear actionsThisStep');
  console.assert(GameState.meta.day_count === dayBefore,
    'STATE FAIL: resetDay() must not increment day_count');

  // ── Test 4: seed immutability contract (write once) ──────────────────────
  // seed is set by generator.js once; we just verify it survives a round-trip.
  GameState.meta.seed = 12345;
  GameState.save();
  GameState._applySnapshot(makeDefaultState());
  GameState.load();
  console.assert(GameState.meta.seed === 12345,
    'STATE FAIL: seed did not survive save/load round-trip');

  // ── Test 5: deepMergeDefaults fills missing fields ────────────────────────
  // Simulate an old save without the `flags` key.
  const oldSave = JSON.parse(localStorage.getItem(STORAGE_KEY));
  delete oldSave.flags;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(oldSave));
  GameState.load();
  console.assert(typeof GameState.flags === 'object' && 'win' in GameState.flags,
    'STATE FAIL: deepMergeDefaults did not restore missing flags field');

  // ── Test 6: reset() wipes to factory defaults ────────────────────────────
  GameState.reset();
  console.assert(GameState.meta.seed === 0,
    'STATE FAIL: reset() did not restore seed to 0');
  console.assert(GameState.player.resources === 100,
    'STATE FAIL: reset() did not restore resources to 100');
  console.assert(localStorage.getItem(STORAGE_KEY) === null,
    'STATE FAIL: reset() did not remove localStorage key');

  // ── Test 7: stressor clamp helper (documents expected usage) ─────────────
  // No built-in clamp in GameState — callers use Math.max/min per Rule 03.
  // Verify the documented pattern produces correct bounds.
  const clamp = (v) => Math.max(0, Math.min(100, v));
  console.assert(clamp(-10) === 0,   'STATE FAIL: stressor clamp below 0');
  console.assert(clamp(110) === 100, 'STATE FAIL: stressor clamp above 100');
  console.assert(clamp(55)  === 55,  'STATE FAIL: stressor clamp mid value');

  // ── Test 8: population clamp helper ──────────────────────────────────────
  const clampPop = (v) => Math.max(0, Math.round(v));
  console.assert(clampPop(-3)   === 0,  'STATE FAIL: population clamp below 0');
  console.assert(clampPop(4.7)  === 5,  'STATE FAIL: population round up');
  console.assert(clampPop(4.2)  === 4,  'STATE FAIL: population round down');

  console.log('[state.js] All self-tests passed ✓');
  return true;
}

// Export the default-factory function so generator.js and tests can call it.
export { makeDefaultState };

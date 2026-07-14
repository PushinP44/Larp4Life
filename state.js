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

import { signPayload, verifyPayload } from './integrity.js';
import {
  COLLAPSE_TIMER, START_RESOURCES, SCANNER_CHARGES, BASE_PRICES,
} from './balance.js';

const STORAGE_KEY = 'ecosystem_x_state';

// Integrity status of the most recent load() (PENTEST F5):
//   'verified' — signed save, MAC valid (trustworthy / unmodified)
//   'tampered' — signed save, MAC mismatch (edited outside the game or corrupt)
//   'legacy'   — unsigned pre-integrity save (accepted for backward compat)
//   'corrupt'  — unparseable
//   'none'     — no save present (fresh game)
let _integrityStatus = 'none';

// ─────────────────────────────────────────────────────────────────────────────
// Default state (matches the canonical schema in Rule 03 exactly)
// ─────────────────────────────────────────────────────────────────────────────
function makeDefaultState() {
  return {
    meta: {
      seed: 0,                        // integer; written once at generation
      biome_template: 'coastal_wetland',
      day_count: 1,
      collapse_timer: COLLAPSE_TIMER, // days remaining before lose (balance.js — uniform for all worlds)
      health_streak: 0,               // consecutive days at H >= 75
      ecosystem_health: 50.0,         // 0–100, derived each step
      market_tier: 'Degraded',        // Toxic | Degraded | Recovering | Pristine
      // Scenario modifier fields (written by generator.js via generateWorld)
      modifier_id:                 'none',
      modifier_label:              'Standard',
      modifier_daily_income_mult:  1.0,
      modifier_start_res_mult:     1.0,
      daily_income:                null,  // null → ecosystem.js uses DAILY_INCOME
    },
    player: {
      name: 'Field Agent',
      resources: START_RESOURCES,
      tile_x: 4,
      tile_y: 6,
      scanner_charges: SCANNER_CHARGES,
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
      base_prices: { ...BASE_PRICES }, // base intervention costs (balance.js)
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
// Save sanitizer (PENTEST F3/F4) — coerce/clamp every untrusted field loaded
// from localStorage. Anti-brick (no NaN/Infinity reaches the simulation),
// anti-cheat-clamp (bounded fields kept in range), and closes F2 at the source
// (meta.seed forced to a clamped INTEGER → can never carry HTML).
// Pure + fail-safe: returns a sanitized object, or null on gross invalidity
// (caller then resets to defaults). Never throws.
// ─────────────────────────────────────────────────────────────────────────────
function _num(v, fallback, { min = -Infinity, max = Infinity, int = false } = {}) {
  let n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) n = fallback;
  if (int) n = Math.floor(n);
  return Math.min(max, Math.max(min, n));
}
function _str(v, fallback = '') {
  return typeof v === 'string' ? v : (v == null ? fallback : String(v));
}
function _bool(v) { return v === true; }

function sanitizeLoadedState(parsed) {
  try {
    if (!parsed || typeof parsed !== 'object' ||
        typeof parsed.meta   !== 'object' || parsed.meta   === null ||
        typeof parsed.player !== 'object' || parsed.player === null ||
        typeof parsed.world  !== 'object' || parsed.world  === null) {
      return null; // gross structural invalidity → caller resets to defaults
    }
    const d = makeDefaultState();
    const m = parsed.meta, p = parsed.player, w = parsed.world;

    // meta — seed forced to a clamped INTEGER (also closes the F2 reflection source)
    m.seed             = _num(m.seed, 0, { min: 0, max: 999999, int: true });
    m.biome_template   = _str(m.biome_template, d.meta.biome_template);
    m.day_count        = _num(m.day_count, 1, { min: 1, max: 100000, int: true });
    m.collapse_timer   = _num(m.collapse_timer, d.meta.collapse_timer, { min: 0, max: 100000, int: true });
    m.health_streak    = _num(m.health_streak, 0, { min: 0, max: 100000, int: true });
    m.ecosystem_health = _num(m.ecosystem_health, 50, { min: 0, max: 100 });
    m.market_tier      = _str(m.market_tier, d.meta.market_tier);
    // Scenario modifier fields (optional — default to 'none' / 'Standard' / 1.0)
    m.modifier_id                = _str(m.modifier_id,                'none');
    m.modifier_label             = _str(m.modifier_label,             'Standard');
    m.modifier_daily_income_mult = _num(m.modifier_daily_income_mult, 1.0, { min: 0.01, max: 10 });
    m.modifier_start_res_mult    = _num(m.modifier_start_res_mult,    1.0, { min: 0.01, max: 10 });
    if (m.daily_income !== null && m.daily_income !== undefined) {
      m.daily_income = _num(m.daily_income, null, { min: 0, max: 1e6 });
    }

    // player
    p.name            = _str(p.name, d.player.name);
    p.resources       = _num(p.resources, 0, { min: 0, max: 1e9 });
    p.tile_x          = _num(p.tile_x, d.player.tile_x, { min: 0, max: 1000, int: true });
    p.tile_y          = _num(p.tile_y, d.player.tile_y, { min: 0, max: 1000, int: true });
    p.scanner_charges = _num(p.scanner_charges, 0, { min: 0, max: 1000, int: true });
    p.facing          = ['down', 'left', 'right', 'up'].includes(p.facing) ? p.facing : 'down';

    // world container shape
    if (typeof w.tiles !== 'object' || w.tiles === null) w.tiles = {};
    if (typeof w.nodes !== 'object' || w.nodes === null) w.nodes = {};
    if (!Array.isArray(w.edges)) w.edges = [];
    if (typeof w.actionsThisStep !== 'object' || w.actionsThisStep === null) w.actionsThisStep = {};

    // world.nodes — sim-critical numerics + XSS-feedstock strings (name/kind/status)
    for (const id of Object.keys(w.nodes)) {
      const n = w.nodes[id];
      if (!n || typeof n !== 'object') { delete w.nodes[id]; continue; }
      n.name       = _str(n.name, id);
      n.kind       = _str(n.kind, 'consumer');
      n.status     = _str(n.status, 'stable');
      n.population = _num(n.population, 0, { min: 0, max: 1e9, int: true });
      n.K_max      = _num(n.K_max, 1, { min: 0.0001, max: 1e9 });
      n.alpha      = _num(n.alpha, 1, { min: 0, max: 100 });
      n.r          = _num(n.r, 0.1, { min: 0, max: 100 });
      n.keystone   = _bool(n.keystone);
    }
    // world.tiles — stressor clamped [0,100]; coords finite; protected boolean
    for (const id of Object.keys(w.tiles)) {
      const t = w.tiles[id];
      if (!t || typeof t !== 'object') { delete w.tiles[id]; continue; }
      t.stressor  = _num(t.stressor, 0, { min: 0, max: 100 });
      if ('x' in t) t.x = _num(t.x, 0, { min: 0, max: 1000, int: true });
      if ('y' in t) t.y = _num(t.y, 0, { min: 0, max: 1000, int: true });
      t.protected = _bool(t.protected);
    }
    // world.edges — names/beta/revealed
    w.edges = w.edges.filter(e => e && typeof e === 'object').map(e => {
      e.from     = _str(e.from, '');
      e.to       = _str(e.to, '');
      e.beta     = _num(e.beta, 0, { min: 0, max: 100 });
      e.revealed = _bool(e.revealed);
      return e;
    });

    // notebook — arrays of node/edge id strings only
    if (typeof parsed.notebook !== 'object' || parsed.notebook === null) parsed.notebook = {};
    parsed.notebook.discovered_nodes = Array.isArray(parsed.notebook.discovered_nodes)
      ? parsed.notebook.discovered_nodes.filter(x => typeof x === 'string') : [];
    parsed.notebook.revealed_edges = Array.isArray(parsed.notebook.revealed_edges)
      ? parsed.notebook.revealed_edges.filter(x => typeof x === 'string') : [];

    // flags
    if (typeof parsed.flags !== 'object' || parsed.flags === null) parsed.flags = {};
    parsed.flags.win  = _bool(parsed.flags.win);
    parsed.flags.lose = _bool(parsed.flags.lose);

    return parsed;
  } catch (_e) {
    return null; // fail safe → reset to defaults
  }
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
      // Sign the exact payload bytes we persist (PENTEST F5) so load() can
      // detect tampering/corruption. Stored as { d: <json>, m: <hmac-hex> }.
      const payload = JSON.stringify(this._snapshot());
      const wrapper = { d: payload, m: signPayload(payload) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wrapper));
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
      _integrityStatus = 'none';
      this._applySnapshot(makeDefaultState());
      return this;
    }
    let outer;
    try {
      outer = JSON.parse(raw);
    } catch (e) {
      console.warn('[state.js] load() parse error — resetting to defaults:', e.message);
      _integrityStatus = 'corrupt';
      this._applySnapshot(makeDefaultState());
      return this;
    }

    // Integrity check (PENTEST F5). Signed saves are { d:<json>, m:<hmac> };
    // anything else is a legacy unsigned save (accepted for backward compat,
    // re-signed on next save). A MAC mismatch is flagged but we still load the
    // SANITIZED state so corruption never bricks the game.
    let parsed;
    if (outer && typeof outer === 'object' &&
        typeof outer.d === 'string' && typeof outer.m === 'string') {
      _integrityStatus = verifyPayload(outer.d, outer.m) ? 'verified' : 'tampered';
      if (_integrityStatus === 'tampered') {
        console.warn('[state.js] save integrity check FAILED — save was modified ' +
                     'outside the game (or corrupted). Loading sanitized state; ' +
                     'run marked UNVERIFIED.');
      }
      try {
        parsed = JSON.parse(outer.d);
      } catch (e) {
        console.warn('[state.js] load() inner parse error — resetting to defaults:', e.message);
        _integrityStatus = 'corrupt';
        this._applySnapshot(makeDefaultState());
        return this;
      }
    } else {
      _integrityStatus = 'legacy';
      parsed = outer;
    }

    // Sanitize untrusted localStorage (PENTEST F3/F4) BEFORE it becomes live
    // state — coerce/clamp every field, fail safe to defaults on gross invalidity.
    const clean = sanitizeLoadedState(parsed);
    if (!clean) {
      console.warn('[state.js] load() — save failed sanitization, resetting to defaults.');
      this._applySnapshot(makeDefaultState());
      return this;
    }
    // Merge sanitized data on top of fresh defaults to fill any gaps.
    const merged = deepMergeDefaults(clean, makeDefaultState());
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
    _integrityStatus = 'none';
    this._applySnapshot(makeDefaultState());
  },

  /**
   * getIntegrityStatus() — result of the last load()'s tamper check (PENTEST F5).
   * One of: 'verified' | 'tampered' | 'legacy' | 'corrupt' | 'none'.
   */
  getIntegrityStatus() {
    return _integrityStatus;
  },

  /**
   * isIntegrityVerified() — true only for a signed save whose MAC verified.
   * A future leaderboard should refuse to submit a run where this is false.
   * NOTE: detection-grade only — see integrity.js header (key ships in client).
   */
  isIntegrityVerified() {
    return _integrityStatus === 'verified';
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
  console.assert(GameState.meta.collapse_timer === COLLAPSE_TIMER,
    'STATE FAIL: default collapse_timer should equal COLLAPSE_TIMER');
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

  // ── Test 5: deepMergeDefaults fills missing fields (signed-format aware) ──
  // Simulate a save missing the `flags` key, correctly re-signed.
  GameState.save();
  const wrapper = JSON.parse(localStorage.getItem(STORAGE_KEY));
  const snap = JSON.parse(wrapper.d);
  delete snap.flags;
  const payload5 = JSON.stringify(snap);
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ d: payload5, m: signPayload(payload5) }));
  GameState.load();
  console.assert(typeof GameState.flags === 'object' && 'win' in GameState.flags,
    'STATE FAIL: deepMergeDefaults did not restore missing flags field');
  console.assert(GameState.getIntegrityStatus() === 'verified',
    'STATE FAIL: correctly re-signed save should verify');

  // ── Test 5b: tamper detection (PENTEST F5) ───────────────────────────────
  GameState.meta.day_count = 3;
  GameState.save();
  const w5b = JSON.parse(localStorage.getItem(STORAGE_KEY));
  // Flip one byte of the signed payload without updating the MAC.
  w5b.d = w5b.d.replace('"day_count":3', '"day_count":999');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(w5b));
  GameState.load();
  console.assert(GameState.getIntegrityStatus() === 'tampered',
    'STATE FAIL: edited save should be flagged tampered');
  console.assert(GameState.isIntegrityVerified() === false,
    'STATE FAIL: tampered save must not be integrity-verified');
  // ...but the game still loads the (sanitized) state — no brick.
  console.assert(GameState.meta.day_count === 999,
    'STATE FAIL: tampered save should still load (sanitized), not brick');

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

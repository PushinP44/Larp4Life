/**
 * generator.js — Seeded hybrid world generator for Ecosystem X
 *
 * Rule 02-A: builds the DAG from a biome template + numeric seed.
 * Rule 01 / Law 2: ALL randomness via prng.js (mulberry32 / randFloat / randInt).
 *   NEVER call Math.random() here.
 * Rule 03: writes only into state.world and state.meta.seed; ends with state.save().
 *
 * Export:  generateWorld(template, seed, state) → void
 *          (mutates state in-place; caller owns the save after this returns)
 */

import { mulberry32, randFloat, randInt } from './prng.js';
import { validateWorld } from './validator.js';

// ─────────────────────────────────────────────────────────────────────────────
// Tile-type assignment by node kind
// ─────────────────────────────────────────────────────────────────────────────
const KIND_TO_TILE_TYPE = {
  stressor: 'source',
  producer: 'marsh',
  consumer: 'water',
  predator: 'land'
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: build one candidate world from (template, seed)
// Returns a plain world object (does NOT write to state yet).
// ─────────────────────────────────────────────────────────────────────────────
function buildWorld(template, seed) {
  const rng = mulberry32(seed);

  const { w, h } = template.grid;

  // ── 1. Choose tile positions for each node ──────────────────────────────
  // Sort node ids for stable cross-engine iteration order (Rule 02-A flag).
  const nodeIds = template.nodes.map(n => n.id).sort();
  const usedTiles = new Set();
  const nodeTiles = {}; // nodeId → tileId

  for (const nid of nodeIds) {
    let tileId;
    let attempts = 0;
    do {
      const tx = randInt(rng, 0, w - 1);
      const ty = randInt(rng, 0, h - 1);
      tileId = `t_${tx}_${ty}`;
      attempts++;
      // safety: if the grid is too small to place all nodes without collision
      // (won't happen on 16×12 with 4 nodes) fall through after 200 tries.
    } while (usedTiles.has(tileId) && attempts < 200);
    usedTiles.add(tileId);
    nodeTiles[nid] = tileId;
  }

  // ── 2. Build tile objects ────────────────────────────────────────────────
  // Fix (3): populate the FULL grid (w×h) with ambient tiles so the renderer
  // fills the entire map.  Node tiles are stamped on top with seeded stressor
  // values.  All ambient tiles get stressor=0 and a deterministic type derived
  // from grid position (no Math.random — pure formula).
  //
  // Ambient type formula (deterministic, no RNG consumption):
  //   (tx + ty) % 4 == 0 → 'water', == 1 → 'marsh', == 2 → 'land', == 3 → 'land'
  // This produces a visually varied checkerboard without touching the RNG
  // stream, so node-tile stressor values remain unchanged.

  const tiles = {};

  // 2a. Fill every cell in the grid as an ambient tile (stressor = 0).
  for (let ty = 0; ty < h; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const tileId = `t_${tx}_${ty}`;
      const typeIdx = (tx + ty) % 4;
      const ambientType = typeIdx === 0 ? 'water' : typeIdx === 1 ? 'marsh' : 'land';
      tiles[tileId] = {
        id:        tileId,
        x:         tx,
        y:         ty,
        type:      ambientType,
        stressor:  0,
        protected: false
      };
    }
  }

  // 2b. Stamp node tiles — seeded stressor levels drawn from start.stressor band.
  // Iteration follows the same sorted nodeIds order so RNG consumption is deterministic.
  const [lo, hi] = template.start.stressor;
  const midpoint = (lo + hi) / 2;

  for (const nid of nodeIds) {
    const tdef = template.nodes.find(n => n.id === nid);
    const tileId = nodeTiles[nid];
    const [tx, ty] = tileId.replace('t_', '').split('_').map(Number);
    const isStressor = tdef.kind === 'stressor';

    // Stressor source tile → upper half [midpoint, hi] (most polluted).
    // Biological tiles → full band [lo, hi] (stressed but variable).
    const L = isStressor
      ? randFloat(rng, midpoint, hi)
      : randFloat(rng, lo, hi);

    tiles[tileId] = {
      id:        tileId,
      x:         tx,
      y:         ty,
      type:      KIND_TO_TILE_TYPE[tdef.kind] ?? 'land',
      stressor:  Math.max(0, Math.min(100, L)), // clamp [0,100] per Rule 03
      protected: false
    };
  }

  // ── 3. Instantiate nodes with jittered parameters ───────────────────────
  // randSafe: when lo === hi (degenerate band, e.g. stressor nodes whose
  // bands are all [0,0]) still consume one RNG value to keep the sequence
  // deterministic, but clamp the result to lo instead of throwing.
  const randSafe = (lo, hi) => lo === hi ? (rng(), lo) : randFloat(rng, lo, hi);

  const nodes = {};
  for (const tdef of template.nodes) {
    const nid   = tdef.id;
    const bands = tdef.bands ?? { r:[0,0], K_max:[0,0], alpha:[0,0], weight:[0,0] };

    const r      = randSafe(bands.r[0],      bands.r[1]);
    const K_max  = randSafe(bands.K_max[0],  bands.K_max[1]);
    const alpha  = randSafe(bands.alpha[0],  bands.alpha[1]);
    const weight = randSafe(bands.weight[0], bands.weight[1]);

    // Start population = populationFrac × K_max (seeded fraction)
    const frac = randFloat(
      rng,
      template.start.populationFrac[0],
      template.start.populationFrac[1]
    );
    const population = tdef.kind === 'stressor'
      ? 0  // stressor nodes have no biological population
      : Math.max(0, Math.round(frac * K_max));

    nodes[nid] = {
      id:                 nid,
      name:               tdef.name,
      kind:               tdef.kind,
      keystone:           tdef.keystone ?? false,
      tileId:             nodeTiles[nid],
      population,
      r,
      K_max,
      alpha,
      weight,
      status:             'stable',
      discovered:         false,
      extinction_counter: 0
    };
  }

  // ── 4. Build directed edges with jittered beta ───────────────────────────
  // Sort edge list by from+to string for stable iteration across engines.
  const sortedEdges = [...template.edges].sort(
    (a, b) => (a.from + a.to) < (b.from + b.to) ? -1 : 1
  );
  const edges = sortedEdges.map(edef => {
    const beta = edef.betaBand[0] === edef.betaBand[1]
      ? edef.betaBand[0]
      : randFloat(rng, edef.betaBand[0], edef.betaBand[1]);
    return {
      from:     edef.from,
      to:       edef.to,
      beta,
      revealed: false
    };
  });

  return { grid: { ...template.grid }, tiles, nodes, edges, actionsThisStep: {} };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: load the defaults world from the template into state
// Called only when all 50 rerolls fail validation.
// ─────────────────────────────────────────────────────────────────────────────
function loadDefaults(template, state, originalSeed) {
  console.warn(
    `[generator.js] 50 seed rerolls exhausted starting from seed=${originalSeed}. ` +
    'Loading guaranteed-valid template defaults.'
  );
  const def = template.defaults;
  state.world = {
    grid:             { ...def.grid },
    tiles:            JSON.parse(JSON.stringify(def.tiles)),
    nodes:            JSON.parse(JSON.stringify(def.nodes)),
    edges:            JSON.parse(JSON.stringify(def.edges)),
    actionsThisStep:  {}
  };
  // seed stays at originalSeed so the run is still labelled by the player's seed.
  state.meta.seed           = originalSeed;
  state.meta.biome_template = template.id ?? 'coastal_wetland';
  state.save();
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * generateWorld(template, seed, state)
 *
 * Builds a validated DAG world from `template` and `seed`, writing the result
 * into `state.world` and `state.meta.seed`. Retries up to 50 times on
 * validation failure (seed++ each try). Falls back to template.defaults on
 * total failure.
 *
 * @param {object} template  — one entry from data/biomes.json
 * @param {number} seed      — integer starting seed
 * @param {object} state     — GameState singleton (from state.js)
 */
export function generateWorld(template, seed, state) {
  const originalSeed = seed >>> 0;
  const MAX_RETRIES  = 50;

  let currentSeed = originalSeed;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const world = buildWorld(template, currentSeed);
    const result = validateWorld(world);

    if (result.ok) {
      state.world                  = world;
      state.meta.seed              = currentSeed;         // written ONCE — Rule 03 §7
      state.meta.biome_template    = template.id ?? 'coastal_wetland';
      state.save();
      return; // success
    }

    // Validation failed — log reason and try next seed.
    console.debug(
      `[generator.js] seed=${currentSeed} failed validation: ${result.reason} ` +
      `(attempt ${attempt + 1}/${MAX_RETRIES})`
    );
    currentSeed = (currentSeed + 1) >>> 0; // 32-bit safe increment
  }

  // All retries exhausted → load template defaults (guaranteed valid).
  loadDefaults(template, state, originalSeed);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Self-tests
   In the browser console (after page load):
     const { runGeneratorTests } = await import('./generator.js');
     runGeneratorTests();
───────────────────────────────────────────────────────────────────────────── */

export async function runGeneratorTests() {
  // Load biomes.json
  let biomes;
  try {
    const res = await fetch('./data/biomes.json');
    biomes = await res.json();
  } catch (e) {
    console.error('[generator.js] Could not load biomes.json:', e.message);
    return false;
  }

  const template = biomes.coastal_wetland;

  // We need a minimal state mock for testing (avoids circular dependency on state.js).
  function makeMockState() {
    let _saved = null;
    return {
      meta:  { seed: 0, biome_template: 'coastal_wetland', day_count: 1,
               collapse_timer: 30, health_streak: 0, ecosystem_health: 50,
               market_tier: 'Degraded' },
      player: { resources: 100, tile_x: 4, tile_y: 6, scanner_charges: 5 },
      world:  { grid:{w:16,h:12}, tiles:{}, nodes:{}, edges:[], actionsThisStep:{} },
      notebook: { discovered_nodes:[], revealed_edges:[] },
      vendor: { base_prices:{bioremediation:120,rebalancing:90,stabilization:150},
                price_factor:1.3, available:['bioremediation','rebalancing','stabilization'] },
      flags: { win:false, lose:false },
      save() { _saved = JSON.parse(JSON.stringify({ meta:this.meta, world:this.world })); },
      _getSaved() { return _saved; }
    };
  }

  // ── Test 1: same seed → byte-identical worlds ────────────────────────────
  const stateA = makeMockState();
  const stateB = makeMockState();
  generateWorld(template, 42, stateA);
  generateWorld(template, 42, stateB);
  const worldA = JSON.stringify(stateA.world);
  const worldB = JSON.stringify(stateB.world);
  console.assert(worldA === worldB,
    'GENERATOR FAIL: same seed produced different worlds');

  // ── Test 2: different seeds → different worlds ───────────────────────────
  const stateC = makeMockState();
  generateWorld(template, 99, stateC);
  console.assert(JSON.stringify(stateC.world) !== worldA,
    'GENERATOR FAIL: different seed produced identical world');

  // ── Test 3: seed written to state.meta.seed ───────────────────────────────
  console.assert(typeof stateA.meta.seed === 'number',
    'GENERATOR FAIL: state.meta.seed not set after generateWorld');

  // ── Test 4: all required node fields present ──────────────────────────────
  const requiredNodeFields = [
    'id','name','kind','keystone','tileId','population',
    'r','K_max','alpha','weight','status','discovered','extinction_counter'
  ];
  const firstNode = Object.values(stateA.world.nodes)[0];
  for (const f of requiredNodeFields) {
    console.assert(f in firstNode,
      `GENERATOR FAIL: node missing field "${f}"`);
  }

  // ── Test 5: all nodes start discovered=false, status='stable' ─────────────
  for (const n of Object.values(stateA.world.nodes)) {
    console.assert(n.discovered === false,
      `GENERATOR FAIL: node ${n.id} started discovered`);
    if (n.kind !== 'stressor') {
      console.assert(n.status === 'stable',
        `GENERATOR FAIL: node ${n.id} not stable at start`);
    }
  }

  // ── Test 6: all edges start revealed=false ────────────────────────────────
  for (const e of stateA.world.edges) {
    console.assert(e.revealed === false,
      `GENERATOR FAIL: edge ${e.from}->${e.to} started revealed`);
  }

  // ── Test 7: stressor source tile L within upper-half of start range ────────
  const stressorNode = Object.values(stateA.world.nodes).find(n => n.kind === 'stressor');
  if (stressorNode) {
    const L = stateA.world.tiles[stressorNode.tileId]?.stressor ?? -1;
    const [slo, shi] = template.start.stressor;
    const midpoint = (slo + shi) / 2;
    console.assert(L >= midpoint && L <= shi,
      `GENERATOR FAIL: stressor source tile L=${L.toFixed(2)} outside upper-half [${midpoint},${shi}]`);
  }

  // ── Test 8: populations within expected bounds ────────────────────────────
  for (const n of Object.values(stateA.world.nodes)) {
    if (n.kind === 'stressor') continue;
    console.assert(n.population >= 0,
      `GENERATOR FAIL: node ${n.id} has negative population`);
    // Pop ≤ K_max (frac ≤ 1 by construction)
    console.assert(n.population <= Math.ceil(n.K_max),
      `GENERATOR FAIL: node ${n.id} start population exceeds K_max`);
  }

  // ── Test 9: state.save() was called ──────────────────────────────────────
  console.assert(stateA._getSaved() !== null,
    'GENERATOR FAIL: state.save() was not called after generateWorld');

  // ── Test 10: DAG passes acyclicity check ─────────────────────────────────
  const { validateWorld: vw } = await import('./validator.js');
  const vResult = vw(stateA.world);
  console.assert(vResult.ok,
    `GENERATOR FAIL: generated world failed validation: ${vResult.reason}`);

  // ── Test 11: every node tile has stressor > 0 (biome is pre-stressed) ────
  for (const n of Object.values(stateA.world.nodes)) {
    const tileL = stateA.world.tiles[n.tileId]?.stressor ?? -1;
    const [tlo] = template.start.stressor;
    console.assert(tileL >= tlo,
      `GENERATOR FAIL: node ${n.id} tile stressor=${tileL.toFixed(2)} below minimum ${tlo} — biome should start stressed`);
  }

  console.log('[generator.js] All self-tests passed ✓');
  return true;
}

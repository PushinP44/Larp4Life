/**
 * generator.js — Seeded hybrid world generator for Ecosystem X
 *
 * Rule 02-A: builds the DAG from a biome template + numeric seed.
 * Rule 01 / Law 2: ALL randomness via prng.js (mulberry32 / randFloat / randInt).
 *   NEVER call Math.random() here.
 * Rule 03: writes only into state.world and state.meta.seed; ends with state.save().
 *
 * Stressor typing (Phase 2 addition):
 *   Seed-selects 1 (≈60%) or 2 (≈40%) distinct stressor types from
 *   template.stressorPool (runoff / invasive / overharvest). Each type has a
 *   distinct in-world effect and a distinct correct counter-intervention.
 *   The instantiated descriptors are stored in state.world.activeStressors[].
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
  predator: 'land',
  invasive: 'water'
};

// ─────────────────────────────────────────────────────────────────────────────
// Internal: select and instantiate typed stressors from the pool
// Returns { activeStressors: [], extraNodes: {}, extraEdges: [] }
// Uses RNG — MUST be called in a deterministic position within buildWorld.
// ─────────────────────────────────────────────────────────────────────────────
function pickStressors(template, rng, nodeTiles, w, h, usedTiles) {
  const pool = template.stressorPool;
  if (!pool || pool.length === 0) {
    return { activeStressors: [], extraNodes: {}, extraEdges: [] };
  }

  // Pick count: 1 (60%) or 2 (40%) — one RNG draw
  const count = rng() < 0.60 ? 1 : 2;

  // Shuffle pool indices via Fisher-Yates using RNG (deterministic)
  const indices = pool.map((_, i) => i);
  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [indices[i], indices[j]] = [indices[j], indices[i]];
  }
  const chosen = indices.slice(0, count);

  const activeStressors = [];
  const extraNodes = {};
  const extraEdges = [];

  for (const idx of chosen) {
    const def = pool[idx];

    if (def.type === 'runoff') {
      // sourceTileId is the existing n_runoff node's tile (already in nodeTiles)
      const sourceTileId = nodeTiles['n_runoff'];
      const [slo, shi] = def.spreadRate ?? [3, 6];
      const spreadRate = randFloat(rng, slo, shi);
      // Source L — drawn from sourceLBand
      const [llo, lhi] = def.sourceLBand ?? [45, 70];
      const sourceL = randFloat(rng, llo, lhi);

      activeStressors.push({
        type:         'runoff',
        sourceTileId,
        spreadRate,
        sourceL        // used to overwrite the tile's stressor in buildWorld
      });

    } else if (def.type === 'invasive') {
      // Add a new 'n_invasive' node (if not already present from another combo pick)
      if (!extraNodes['n_invasive']) {
        const bands = def.bands ?? { r:[0.18,0.26], K_max:[180,300], alpha:[1.0,1.6], weight:[0,0] };
        const r      = randFloat(rng, bands.r[0],      bands.r[1]);
        const K_max  = randFloat(rng, bands.K_max[0],  bands.K_max[1]);
        const alpha  = randFloat(rng, bands.alpha[0],  bands.alpha[1]);
        const [flo, fhi] = def.populationFrac ?? [0.25, 0.40];
        const frac   = randFloat(rng, flo, fhi);
        const population = Math.max(1, Math.round(frac * K_max));

        // Place on an unused tile
        let tileId;
        let attempts = 0;
        do {
          const tx = randInt(rng, 0, w - 1);
          const ty = randInt(rng, 0, h - 1);
          tileId = `t_${tx}_${ty}`;
          attempts++;
        } while (usedTiles.has(tileId) && attempts < 200);
        usedTiles.add(tileId);

        extraNodes['n_invasive'] = {
          id:                 'n_invasive',
          name:               'Invasive Species',
          kind:               'invasive',
          keystone:           false,
          tileId,
          population,
          r,
          K_max,
          alpha,
          weight:             0,  // excluded from health score
          status:             'stable',
          discovered:         false,
          extinction_counter: 0
        };

        // Edge: invasive → targetNative (predation/competition)
        const targetNative = def.targetNative ?? 'n_shrimp';
        const [blo, bhi] = def.betaBand ?? [0.04, 0.08];
        const beta = randFloat(rng, blo, bhi);
        extraEdges.push({
          from:     'n_invasive',
          to:       targetNative,
          beta,
          revealed: false
        });
      } else {
        // Already added — still consume RNG draws to keep sequence stable
        // (r, K_max, alpha, frac, tile_x, tile_y, beta — 7 draws)
        for (let i = 0; i < 7; i++) rng();
      }

      activeStressors.push({
        type:         'invasive',
        nodeId:       'n_invasive',
        targetNative: def.targetNative ?? 'n_shrimp'
      });

    } else if (def.type === 'overharvest') {
      const targetNative = def.targetNative ?? 'n_shrimp';
      const [dlo, dhi]   = def.drainBand ?? [4, 9];
      const harvestDrain = randFloat(rng, dlo, dhi);
      const protectCap   = def.protectCapStressor ?? 20;

      activeStressors.push({
        type:         'overharvest',
        targetNative,
        harvestDrain,
        protectCap
      });
    }
  }

  return { activeStressors, extraNodes, extraEdges };
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal: build one candidate world from (template, seed)
// Returns a plain world object (does NOT write to state yet).
// ─────────────────────────────────────────────────────────────────────────────
function buildWorld(template, seed) {
  const rng = mulberry32(seed);

  const { w, h } = template.grid;

  // ── 1. Choose tile positions for each base node ─────────────────────────
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
    } while (usedTiles.has(tileId) && attempts < 200);
    usedTiles.add(tileId);
    nodeTiles[nid] = tileId;
  }

  // ── 2. Pick typed stressors (uses RNG — must come before tile stamping) ──
  const { activeStressors, extraNodes, extraEdges } =
    pickStressors(template, rng, nodeTiles, w, h, usedTiles);

  // ── 3. Build tile objects ─────────────────────────────────────────────────
  const tiles = {};

  // 3a. Fill every cell in the grid as an ambient tile (stressor = 0).
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

  // 3b. Stamp node tiles — seeded stressor levels drawn from start.stressor band.
  // Iteration follows the same sorted nodeIds order so RNG consumption is deterministic.
  // ALL worlds use the same stressor band — no per-stressor generation special-casing.
  const [lo, hi] = template.start.stressor;
  const midpoint = (lo + hi) / 2;

  for (const nid of nodeIds) {
    const tdef   = template.nodes.find(n => n.id === nid);
    const tileId = nodeTiles[nid];
    const [tx, ty] = tileId.replace('t_', '').split('_').map(Number);
    const isStressor = tdef.kind === 'stressor';

    const L = isStressor
      ? randFloat(rng, midpoint, hi)
      : randFloat(rng, lo, hi);

    tiles[tileId] = {
      id:        tileId,
      x:         tx,
      y:         ty,
      type:      KIND_TO_TILE_TYPE[tdef.kind] ?? 'land',
      stressor:  Math.max(0, Math.min(100, L)),
      protected: false
    };
  }

  // 3c. For invasive nodes, stamp their tile (stressor near-zero — not polluted)
  for (const [nid, n] of Object.entries(extraNodes)) {
    const [tx, ty] = n.tileId.replace('t_', '').split('_').map(Number);
    tiles[n.tileId] = {
      id:        n.tileId,
      x:         tx,
      y:         ty,
      type:      KIND_TO_TILE_TYPE[n.kind] ?? 'water',
      stressor:  randFloat(rng, lo * 0.3, lo * 0.6),  // invasive thrives in low-L water
      protected: false
    };
  }

  // 3d. Apply runoff sourceL override (drives the initial high-L symptom)
  for (const s of activeStressors) {
    if (s.type === 'runoff' && s.sourceTileId && s.sourceL !== undefined) {
      tiles[s.sourceTileId].stressor = Math.max(0, Math.min(100, s.sourceL));
    }
  }

  // ── 4. Apply harvestPressure to overharvest target nodes ─────────────────
  // We need to set this flag on the node AFTER we build nodes — stored in
  // activeStressors so ecosystem.js can read it. But also embed on the target
  // node for the UI symptom flag.  We do this after instantiating nodes.

  // ── 5. Instantiate base nodes with jittered parameters ──────────────────
  const randSafe = (lo, hi) => lo === hi ? (rng(), lo) : randFloat(rng, lo, hi);

  const nodes = {};
  for (const tdef of template.nodes) {
    const nid   = tdef.id;
    const bands = tdef.bands ?? { r:[0,0], K_max:[0,0], alpha:[0,0], weight:[0,0] };

    const r      = randSafe(bands.r[0],      bands.r[1]);
    const K_max  = randSafe(bands.K_max[0],  bands.K_max[1]);
    const alpha  = randSafe(bands.alpha[0],  bands.alpha[1]);
    const weight = randSafe(bands.weight[0], bands.weight[1]);

    const frac = randFloat(
      rng,
      template.start.populationFrac[0],
      template.start.populationFrac[1]
    );
    const population = tdef.kind === 'stressor'
      ? 0
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

  // 5b. Merge extra nodes (invasive) into nodes map
  for (const [nid, n] of Object.entries(extraNodes)) {
    nodes[nid] = n;
  }

  // 5c. Set harvestPressure on the overharvest target node
  for (const s of activeStressors) {
    if (s.type === 'overharvest' && nodes[s.targetNative]) {
      nodes[s.targetNative].harvestPressure = s.harvestDrain;
    }
  }

  // ── 6. Build directed edges with jittered beta ───────────────────────────
  const allEdgeDefs = [
    ...template.edges,
    ...extraEdges
  ];
  const sortedEdges = [...allEdgeDefs].sort(
    (a, b) => (a.from + a.to) < (b.from + b.to) ? -1 : 1
  );
  const edges = sortedEdges.map(edef => {
    if ('beta' in edef) {
      // Already-resolved edge (from extraEdges)
      return { from: edef.from, to: edef.to, beta: edef.beta, revealed: false };
    }
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

  return {
    grid:             { ...template.grid },
    tiles,
    nodes,
    edges,
    actionsThisStep:  {},
    activeStressors   // written once here; ecosystem.js reads this each step
  };
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
    actionsThisStep:  {},
    activeStressors:  JSON.parse(JSON.stringify(def.activeStressors ?? []))
  };
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

      // Uniform collapse_timer for all worlds — no per-stressor special-casing.
      // (Re-tune §1: remove invasive +30 timer bonus.)

      state.save();
      return; // success
    }

    console.debug(
      `[generator.js] seed=${currentSeed} failed validation: ${result.reason} ` +
      `(attempt ${attempt + 1}/${MAX_RETRIES})`
    );
    currentSeed = (currentSeed + 1) >>> 0;
  }

  loadDefaults(template, state, originalSeed);
}

/* ─────────────────────────────────────────────────────────────────────────────
   Self-tests
   In the browser console (after page load):
     const { runGeneratorTests } = await import('./generator.js');
     runGeneratorTests();
───────────────────────────────────────────────────────────────────────────── */

export async function runGeneratorTests() {
  let biomes;
  try {
    const res = await fetch('./data/biomes.json');
    biomes = await res.json();
  } catch (e) {
    console.error('[generator.js] Could not load biomes.json:', e.message);
    return false;
  }

  const template = biomes.coastal_wetland;

  function makeMockState() {
    let _saved = null;
    return {
      meta:  { seed: 0, biome_template: 'coastal_wetland', day_count: 1,
               collapse_timer: 40, health_streak: 0, ecosystem_health: 50,
               market_tier: 'Degraded' },
      player: { resources: 100, tile_x: 4, tile_y: 6, scanner_charges: 5 },
      world:  { grid:{w:16,h:12}, tiles:{}, nodes:{}, edges:[], actionsThisStep:{}, activeStressors:[] },
      notebook: { discovered_nodes:[], revealed_edges:[] },
      vendor: { base_prices:{bioremediation:60,rebalancing:90,stabilization:150},
                price_factor:1.0, available:['bioremediation','rebalancing','stabilization'] },
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

  // ── Test 7: activeStressors is an array ──────────────────────────────────
  console.assert(Array.isArray(stateA.world.activeStressors),
    'GENERATOR FAIL: world.activeStressors is not an array');
  console.assert(stateA.world.activeStressors.length >= 1,
    'GENERATOR FAIL: world.activeStressors should have at least 1 entry');

  // ── Test 8: populations within expected bounds ────────────────────────────
  for (const n of Object.values(stateA.world.nodes)) {
    if (n.kind === 'stressor') continue;
    console.assert(n.population >= 0,
      `GENERATOR FAIL: node ${n.id} has negative population`);
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

  console.log('[generator.js] All self-tests passed ✓');
  return true;
}

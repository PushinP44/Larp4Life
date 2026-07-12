/**
 * validator.js — DAG validation for Ecosystem X
 *
 * Rule 02-A: every generated world must pass BOTH checks before it is
 * accepted. generator.js calls this and rerolls on failure.
 *
 * Checks:
 *   1. ACYCLIC  — Kahn's topological sort must consume all nodes.
 *   2. SOLVABLE — greedy auto-player simulation: DIAGNOSE activeStressors
 *                 and apply the MATCHING counter each day when affordable:
 *                   • runoff:      bioremediate the highest-L tile (source priority)
 *                   • invasive:    cull the invasive node
 *                   • overharvest: protect the harvested species' tile
 *                 Win iff H≥75 sustained 3 days with no keystone extinct.
 *
 * Export: validateWorld(world) → { ok: boolean, reason: string }
 *
 * Rule: sort node keys before iterating — stable across JS engines.
 */

import { runDailyStep } from './ecosystem.js';
import {
  COST_BIOREMEDIATION, BIOREM_AMOUNT, COST_REBALANCING, COST_STABILIZATION,
  PROTECT_CAP, START_RESOURCES, COLLAPSE_TIMER,
  CULL_FRAC, TRADEOFF_PREY_SAFE,
} from './balance.js';

// Balance knobs — sourced from balance.js (single source of truth). Local aliases
// keep this module's solvability-sim wording (cull/protect) readable.
const BIOREMEDIATION_COST = COST_BIOREMEDIATION;
const BIOREM_L_REDUCTION  = BIOREM_AMOUNT;
const CULL_COST           = COST_REBALANCING;   // rebalancing slot price
const PROTECT_COST        = COST_STABILIZATION; // stabilization slot price

/**
 * validateWorld(world, opts?) → { ok, reason }
 * opts.collapseTimer — per-biome day budget for the solvability sim
 * (biomes.json `collapseTimer`; defaults to balance.js COLLAPSE_TIMER).
 */
export function validateWorld(world, opts = {}) {
  const acyclic = checkAcyclic(world);
  if (!acyclic.ok) return acyclic;

  const solvable = checkSolvable(world, opts.collapseTimer ?? COLLAPSE_TIMER);
  if (!solvable.ok) return solvable;

  return { ok: true, reason: 'acyclic and solvable' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Kahn's topological sort
// ─────────────────────────────────────────────────────────────────────────────

function checkAcyclic(world) {
  const nodeIds = Object.keys(world.nodes).sort();
  const edges   = world.edges;

  const inDegree = {};
  const outgoing = {};

  for (const id of nodeIds) {
    inDegree[id] = 0;
    outgoing[id] = [];
  }

  for (const e of edges) {
    if (!(e.from in inDegree) || !(e.to in inDegree)) {
      return {
        ok: false,
        reason: `edge ${e.from}->${e.to} references unknown node`
      };
    }
    outgoing[e.from].push(e.to);
    inDegree[e.to]++;
  }

  const queue   = nodeIds.filter(id => inDegree[id] === 0).sort();
  let processed = 0;

  while (queue.length > 0) {
    const current = queue.shift();
    processed++;
    const successors = [...outgoing[current]].sort();
    for (const next of successors) {
      inDegree[next]--;
      if (inDegree[next] === 0) {
        let i = 0;
        while (i < queue.length && queue[i] < next) i++;
        queue.splice(i, 0, next);
      }
    }
  }

  if (processed !== nodeIds.length) {
    const remaining = nodeIds.filter(id => inDegree[id] > 0);
    return {
      ok:     false,
      reason: `cycle detected — nodes still in-degree > 0: [${remaining.join(', ')}]`
    };
  }

  return { ok: true, reason: 'acyclic' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Solvability — typed greedy auto-player
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkSolvable(world) → { ok, reason }
 *
 * Diagnoses the active stressors and applies the MATCHING counter each day.
 * Trying the wrong tool (e.g. bioremediate on an invasive world) still works
 * mechanically but the correct path is always prioritised by the greedy player.
 *
 * Strategy per stressor type (per §4 spec):
 *   runoff:      bioremediate the highest-L tile (ALL tiles; source first if tied)
 *   invasive:    cull the invasive node when resources ≥ CULL_COST
 *   overharvest: protect the harvested species' tile when resources ≥ PROTECT_COST
 *                (after protecting, spend remainder on bioremediation to reduce L penalty)
 *
 * When 2 stressors are active the greedy player addresses BOTH each day.
 */
function checkSolvable(world, collapseTimer = COLLAPSE_TIMER) {
  // Per-biome collapse_timer (wetland 45, reef 52) — no per-stressor special-casing.
  const effectiveTimer = collapseTimer;

  const mockState = {
    meta: {
      seed:             0,
      biome_template:   'validation',
      day_count:        1,
      collapse_timer:   effectiveTimer,
      health_streak:    0,
      ecosystem_health: 50,
      market_tier:      'Degraded'
    },
    player: {
      resources:       START_RESOURCES,
      tile_x:          0,
      tile_y:          0,
      scanner_charges: 5
    },
    world:    JSON.parse(JSON.stringify(world)),
    notebook: { discovered_nodes: [], revealed_edges: [] },
    vendor: {
      base_prices:  {
        bioremediation: BIOREMEDIATION_COST,
        rebalancing:    CULL_COST,
        stabilization:  PROTECT_COST
      },
      price_factor: 1.0,
      available:    ['bioremediation', 'rebalancing', 'stabilization']
    },
    flags: { win: false, lose: false },
    save()     { /* no-op */ },
    resetDay() { this.world.actionsThisStep = {}; }
  };

  const activeStressors = world.activeStressors ?? [];
  const hasRunoff      = activeStressors.some(s => s.type === 'runoff');
  const invasiveDef    = activeStressors.find(s => s.type === 'invasive');
  const harvestDef     = activeStressors.find(s => s.type === 'overharvest');

  const maxDays = effectiveTimer;

  for (let day = 0; day < maxDays; day++) {
    const res = mockState.player.resources;

    // ── 1. Overharvest: protect the target tile first (highest priority — stops drain) ─
    if (harvestDef && res >= PROTECT_COST) {
      const targetNode = mockState.world.nodes[harvestDef.targetNative];
      if (targetNode) {
        const tile = mockState.world.tiles[targetNode.tileId];
        if (tile && !tile.protected) {
          tile.protected = true;
          tile.stressor  = Math.min(tile.stressor ?? 0, PROTECT_CAP);
          mockState.player.resources -= PROTECT_COST;
        }
      }
    }

    // ── 2. Invasive: cull the invasive node — TRADE-OFF-AWARE (#2) ─────────────
    //     The invasive is also the keystone predator's food; don't cull toward
    //     zero while the primary prey is scarce (would starve the keystone).
    if (invasiveDef && mockState.player.resources >= CULL_COST) {
      const inv  = mockState.world.nodes[invasiveDef.nodeId];
      const prey = mockState.world.nodes[invasiveDef.targetNative];
      const preyRel = prey && prey.K_max > 0 ? prey.population / prey.K_max : 1;
      // Restore the habitat first: only cull once the prey is healthy (trade-off #2).
      const safeToCull = preyRel >= TRADEOFF_PREY_SAFE;
      if (inv && inv.status !== 'extinct' && inv.population > 0 && safeToCull) {
        const removal = Math.ceil(inv.population * CULL_FRAC);
        inv.population = Math.max(0, inv.population - removal);
        mockState.player.resources -= CULL_COST;
      }
    }

    // ── 3. Runoff: bioremediate the highest-L tile (source-tile priority) ──────
    //     Also run this as a fallback even in invasive/overharvest worlds to reduce
    //     the stressor-load penalty from the n_runoff tile.
    if (mockState.player.resources >= BIOREMEDIATION_COST) {
      let bestTileId = null;
      let bestL      = -Infinity;

      // Prioritise source tiles from runoff stressor definitions
      if (hasRunoff) {
        for (const s of activeStressors) {
          if (s.type !== 'runoff') continue;
          const tile = mockState.world.tiles[s.sourceTileId];
          if (tile && tile.stressor > bestL) {
            bestL      = tile.stressor;
            bestTileId = s.sourceTileId;
          }
        }
      }

      // Fallback: highest-L tile among ALL node tiles
      for (const n of Object.values(mockState.world.nodes)) {
        const tile = mockState.world.tiles[n.tileId];
        if (tile && tile.stressor > bestL) {
          bestL      = tile.stressor;
          bestTileId = n.tileId;
        }
      }

      if (bestTileId !== null && bestL > 0) {
        mockState.world.tiles[bestTileId].stressor = Math.max(
          0,
          mockState.world.tiles[bestTileId].stressor - BIOREM_L_REDUCTION
        );
        mockState.player.resources -= BIOREMEDIATION_COST;
      }
    }

    // ── 4. Reintroduce crashed natives (rebalancing slot, ¤CULL_COST) ─────────
    // Models the vendor's rebalancing→reintroduction path. Boosts a native that
    // has been devastated (P < 15% K_max) and whose tile is now relatively clean.
    if (mockState.player.resources >= CULL_COST) {
      const bioNodes = Object.values(mockState.world.nodes)
        .filter(n => n.kind !== 'stressor' && n.kind !== 'invasive' && n.status !== 'extinct')
        .sort((a, b) => (a.population / a.K_max) - (b.population / b.K_max));
      const reintroTarget = bioNodes.find(n => {
        const tileL = mockState.world.tiles[n.tileId]?.stressor ?? 100;
        return n.K_max > 0 && n.population < 0.15 * n.K_max && tileL < 40;
      });
      if (reintroTarget) {
        reintroTarget.population = Math.round(0.20 * reintroTarget.K_max);
        reintroTarget.extinction_counter = 0;
        if (reintroTarget.status !== 'stable') reintroTarget.status = 'stable';
        mockState.player.resources -= CULL_COST;
      }
    }

    // ── Daily sim tick ─────────────────────────────────────────────────────────
    runDailyStep(mockState);

    if (mockState.flags.win) {
      return { ok: true, reason: `solvable: greedy auto-player won on day ${mockState.meta.day_count}` };
    }
    if (mockState.flags.lose) {
      const anyExtinct = Object.values(mockState.world.nodes)
        .some(n => n.keystone && n.status === 'extinct');
      const reason = anyExtinct
        ? `unsolvable: keystone extinction by day ${mockState.meta.day_count}`
        : `unsolvable: collapse timer expired (H=${mockState.meta.ecosystem_health.toFixed(1)}, streak=${mockState.meta.health_streak})`;
      return { ok: false, reason };
    }
  }

  return {
    ok: false,
    reason: `unsolvable: greedy auto-player did not reach win within ${maxDays} days ` +
            `(H=${mockState.meta.ecosystem_health.toFixed(1)}, streak=${mockState.meta.health_streak})`
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
   Self-tests
   In the browser console:
     const { runValidatorTests } = await import('./validator.js');
     runValidatorTests();
───────────────────────────────────────────────────────────────────────────── */

export function runValidatorTests() {
  function makeWorld(nodeIds, edgePairs) {
    const nodes = {};
    for (const id of nodeIds) {
      nodes[id] = { id, kind: 'producer', keystone: false, population: 100,
                    tileId: 't_0_0', r: 0.1, K_max: 100, alpha: 1, weight: 1,
                    status: 'stable', discovered: false, extinction_counter: 0 };
    }
    const edges = edgePairs.map(([from, to]) => ({ from, to, beta: 0.03, revealed: false }));
    const tiles = { 't_0_0': { id:'t_0_0', x:0, y:0, type:'marsh', stressor:10, protected:false } };
    return { grid:{w:16,h:12}, tiles, nodes, edges, actionsThisStep:{}, activeStressors:[] };
  }

  // ── Test 1: simple chain → acyclic ──────────────────────────────────────
  const r1 = validateWorld(makeWorld(['n_a','n_b','n_c'],[['n_a','n_b'],['n_b','n_c']]));
  console.assert(r1.ok, `VALIDATOR FAIL: simple chain; got: ${r1.reason}`);

  // ── Test 2: direct cycle → detected ──────────────────────────────────────
  const r2 = validateWorld(makeWorld(['n_x','n_y'],[['n_x','n_y'],['n_y','n_x']]));
  console.assert(!r2.ok, 'VALIDATOR FAIL: direct cycle should fail');
  console.assert(r2.reason.includes('cycle'), `VALIDATOR FAIL: reason should mention cycle; got: ${r2.reason}`);

  // ── Test 3: self-loop → detected ─────────────────────────────────────────
  console.assert(!validateWorld(makeWorld(['n_s'],[['n_s','n_s']])).ok, 'VALIDATOR FAIL: self-loop');

  // ── Test 4: 3-node cycle → detected ─────────────────────────────────────
  console.assert(!validateWorld(makeWorld(['n_1','n_2','n_3'],[['n_1','n_2'],['n_2','n_3'],['n_3','n_1']])).ok,
    'VALIDATOR FAIL: 3-node cycle');

  // ── Test 5: disconnected graph → acyclic ─────────────────────────────────
  console.assert(validateWorld(makeWorld(['n_p','n_q','n_r'],[])).ok,
    'VALIDATOR FAIL: disconnected acyclic should pass');

  // ── Test 6: single node → acyclic ────────────────────────────────────────
  console.assert(validateWorld(makeWorld(['n_only'],[])).ok, 'VALIDATOR FAIL: single node');

  // ── Test 7: diamond DAG → acyclic ────────────────────────────────────────
  console.assert(validateWorld(makeWorld(
    ['n_A','n_B','n_C','n_D'],
    [['n_A','n_B'],['n_A','n_C'],['n_B','n_D'],['n_C','n_D']]
  )).ok, 'VALIDATOR FAIL: diamond DAG');

  // ── Test 8: coastal_wetland topology → acyclic ───────────────────────────
  console.assert(validateWorld(makeWorld(
    ['n_runoff','n_seagrass','n_shrimp','n_heron'],
    [['n_runoff','n_seagrass'],['n_seagrass','n_shrimp'],['n_shrimp','n_heron']]
  )).ok, 'VALIDATOR FAIL: coastal_wetland chain');

  // ── Test 9: edge to unknown node → fails gracefully ──────────────────────
  console.assert(!validateWorld(makeWorld(['n_a','n_b'],[['n_a','n_z']])).ok,
    'VALIDATOR FAIL: unknown node edge');

  // ── Test 10: identical worlds → identical results ────────────────────────
  const w10a = makeWorld(['n_a','n_b','n_c'],[['n_a','n_b'],['n_b','n_c']]);
  const w10b = makeWorld(['n_a','n_b','n_c'],[['n_a','n_b'],['n_b','n_c']]);
  const r10a = validateWorld(w10a), r10b = validateWorld(w10b);
  console.assert(r10a.ok === r10b.ok && r10a.reason === r10b.reason,
    'VALIDATOR FAIL: identical worlds produced different results');

  // ── Test 11: clearly-winnable coastal_wetland world → solvable ───────────
  {
    const winnableWorld = {
      grid:{w:16,h:12},
      tiles: {
        t_runoff:   { id:'t_runoff',   stressor:5,  protected:false },
        t_seagrass: { id:'t_seagrass', stressor:5,  protected:false },
        t_shrimp:   { id:'t_shrimp',   stressor:5,  protected:false },
        t_heron:    { id:'t_heron',    stressor:5,  protected:false }
      },
      nodes: {
        n_runoff:  { id:'n_runoff',  kind:'stressor',  keystone:false, tileId:'t_runoff',
                     population:0,   r:0,    K_max:0,   alpha:0, weight:0,
                     status:'stable', extinction_counter:0 },
        n_seagrass:{ id:'n_seagrass',kind:'producer',  keystone:true,  tileId:'t_seagrass',
                     population:400, r:0.15, K_max:500, alpha:0.85, weight:2.5,
                     status:'stable', extinction_counter:0 },
        n_shrimp:  { id:'n_shrimp',  kind:'consumer',  keystone:false, tileId:'t_shrimp',
                     population:260, r:0.13, K_max:325, alpha:1.5, weight:1.25,
                     status:'stable', extinction_counter:0 },
        n_heron:   { id:'n_heron',   kind:'predator',  keystone:true,  tileId:'t_heron',
                     population:72,  r:0.07, K_max:90,  alpha:2.3, weight:3.5,
                     status:'stable', extinction_counter:0 }
      },
      edges: [
        { from:'n_runoff',   to:'n_seagrass', beta:0,     revealed:false },
        { from:'n_seagrass', to:'n_shrimp',   beta:0.035, revealed:false },
        { from:'n_shrimp',   to:'n_heron',    beta:0.045, revealed:false }
      ],
      actionsThisStep: {},
      activeStressors: [{ type:'runoff', sourceTileId:'t_runoff', spreadRate:4, sourceL:5 }]
    };
    const r11 = validateWorld(winnableWorld);
    console.assert(r11.ok,
      `VALIDATOR FAIL T11: clearly-winnable world should be solvable; got: ${r11.reason}`);
  }

  console.log('[validator.js] All self-tests passed ✓');
  return true;
}

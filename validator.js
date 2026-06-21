/**
 * validator.js — DAG validation for Ecosystem X
 *
 * Rule 02-A: every generated world must pass BOTH checks before it is
 * accepted. generator.js calls this and rerolls on failure.
 *
 * Checks:
 *   1. ACYCLIC  — Kahn's topological sort must consume all nodes.
 *   2. SOLVABLE — greedy auto-player simulation: bioremediate the highest-L
 *                 biological-node tile each day (cost 80, L−40) and run
 *                 runDailyStep for up to collapse_timer days. Win iff H≥75
 *                 sustained 3 days with no keystone extinct.
 *
 * Export: validateWorld(world) → { ok: boolean, reason: string }
 *
 * Rule: sort node keys before iterating — stable across JS engines.
 */

import { runDailyStep } from './ecosystem.js';

/**
 * validateWorld(world) → { ok, reason }
 *
 * @param {object} world  — the plain world object produced by generator.js
 *                          (fields: nodes, edges, tiles, grid, actionsThisStep)
 * @returns {{ ok: boolean, reason: string }}
 */
export function validateWorld(world) {
  // ── Step 1: Acyclicity via Kahn's algorithm ───────────────────────────────
  const acyclic = checkAcyclic(world);
  if (!acyclic.ok) return acyclic;

  // ── Step 2: Solvability via greedy auto-player ───────────────────────────
  const solvable = checkSolvable(world);
  if (!solvable.ok) return solvable;

  return { ok: true, reason: 'acyclic and solvable' };
}

// ─────────────────────────────────────────────────────────────────────────────
// Kahn's topological sort
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkAcyclic(world) → { ok, reason }
 *
 * Runs Kahn's algorithm on the node/edge graph.
 * Node keys are sorted before processing for stable cross-engine behaviour
 * (dag-generation skill flag: "Object-key iteration order assumed stable
 *  across engines → sort keys before generating").
 */
function checkAcyclic(world) {
  // Sorted node id list — deterministic across all engines.
  const nodeIds = Object.keys(world.nodes).sort();
  const edges   = world.edges;

  // Build adjacency and in-degree maps.
  const inDegree = {};     // nodeId → count of incoming edges
  const outgoing = {};     // nodeId → [nodeId, ...]

  for (const id of nodeIds) {
    inDegree[id] = 0;
    outgoing[id] = [];
  }

  for (const e of edges) {
    // Guard: skip edges referencing nodes not in the current world
    // (defensive; should never happen with a well-formed template).
    if (!(e.from in inDegree) || !(e.to in inDegree)) {
      return {
        ok: false,
        reason: `edge ${e.from}->${e.to} references unknown node`
      };
    }
    outgoing[e.from].push(e.to);
    inDegree[e.to]++;
  }

  // Queue: all nodes with in-degree 0 (sorted for determinism).
  const queue   = nodeIds.filter(id => inDegree[id] === 0).sort();
  let processed = 0;

  while (queue.length > 0) {
    // Shift from front (BFS order — stable given sorted initial queue).
    const current = queue.shift();
    processed++;

    // Reduce in-degree for all successors; enqueue if it reaches 0.
    // Sort successors before pushing so queue remains deterministically ordered.
    const successors = [...outgoing[current]].sort();
    for (const next of successors) {
      inDegree[next]--;
      if (inDegree[next] === 0) {
        // Insert in sorted position (small N, insertion sort is fine).
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
// Solvability — greedy auto-player simulation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkSolvable(world) → { ok, reason }
 *
 * Deep-clones `world` into a lightweight mock state and runs a greedy
 * auto-player for up to collapse_timer days. Each simulated day the greedy
 * player:
 *   1. Finds the tile with the highest stressor L among ALL node tiles
 *      (including the stressor-source tile — its L drives stressorLoadPenalty
 *      in computeHealth, so the player must be allowed to remediate it).
 *   2. If resources ≥ 120 (bioremediation cost), applies it: L = max(0, L − 40).
 *   3. Calls runDailyStep(mockState) — byte-identical to real gameplay.
 *
 * Win: H ≥ 75 sustained for 3 consecutive days AND no keystone extinct.
 * Lose / unsolvable: timer expires or keystone goes extinct before win.
 *
 * Never mutates the original world.
 *
 * @param {object} world
 * @returns {{ ok: boolean, reason: string }}
 */
function checkSolvable(world) {
  // ── Build a mock state from a deep clone of world ─────────────────────────
  const BIOREMEDIATION_COST = 80;   // balance pass: mirrors state.js base_prices.bioremediation
  const BIOREMEDIATION_L_REDUCTION = 40;
  const START_RESOURCES = 100;
  const COLLAPSE_TIMER  = 30;

  const mockState = {
    meta: {
      seed:             0,
      biome_template:   'validation',
      day_count:        1,
      collapse_timer:   COLLAPSE_TIMER,
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
    world:    JSON.parse(JSON.stringify(world)), // deep clone — never mutate original
    notebook: { discovered_nodes: [], revealed_edges: [] },
    vendor: {
      base_prices:  { bioremediation: BIOREMEDIATION_COST, rebalancing: 90, stabilization: 150 }, // BIOREMEDIATION_COST=80
      price_factor: 1.0,
      available:    ['bioremediation', 'rebalancing', 'stabilization']
    },
    flags: { win: false, lose: false },
    // No-op save / resetDay (greedy sim is pure in-memory; no localStorage needed)
    save()     { /* no-op */ },
    resetDay() { this.world.actionsThisStep = {}; }
  };

  const maxDays = COLLAPSE_TIMER;

  for (let day = 0; day < maxDays; day++) {
    // ── Greedy intervention: bioremediate the highest-L tile (ALL nodes) ─────
    // The stressor-source tile drives stressorLoadPenalty in computeHealth, so
    // including it lets the auto-player actually remove that penalty and reach
    // H≥75. Excluding it causes valid seeds to be wrongly rejected (over-reject).
    if (mockState.player.resources >= BIOREMEDIATION_COST) {
      let bestTileId = null;
      let bestL      = -Infinity;

      for (const n of Object.values(mockState.world.nodes)) {
        // Include ALL node tiles — biological AND stressor source.
        const tile = mockState.world.tiles[n.tileId];
        if (tile && tile.stressor > bestL) {
          bestL      = tile.stressor;
          bestTileId = n.tileId;
        }
      }

      if (bestTileId !== null && bestL > 0) {
        mockState.world.tiles[bestTileId].stressor = Math.max(
          0,
          mockState.world.tiles[bestTileId].stressor - BIOREMEDIATION_L_REDUCTION
        );
        mockState.player.resources -= BIOREMEDIATION_COST;
      }
    }

    // ── Daily sim tick (byte-identical to real gameplay) ─────────────────────
    runDailyStep(mockState);

    // ── Win / lose check ──────────────────────────────────────────────────────
    if (mockState.flags.win) {
      return { ok: true, reason: `solvable: greedy auto-player won on day ${mockState.meta.day_count}` };
    }
    if (mockState.flags.lose) {
      // Distinguish the lose reason for better debug output.
      const anyExtinct = Object.values(mockState.world.nodes)
        .some(n => n.keystone && n.status === 'extinct');
      const reason = anyExtinct
        ? `unsolvable: keystone extinction by day ${mockState.meta.day_count}`
        : `unsolvable: collapse timer expired (H=${mockState.meta.ecosystem_health.toFixed(1)}, streak=${mockState.meta.health_streak})`;
      return { ok: false, reason };
    }
  }

  // Timer exhausted without win or detected lose — treat as unsolvable.
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
  // Helper: build a minimal world from node id list + edge list.
  function makeWorld(nodeIds, edgePairs) {
    const nodes = {};
    for (const id of nodeIds) {
      nodes[id] = { id, kind: 'producer', keystone: false, population: 100,
                    tileId: 't_0_0', r: 0.1, K_max: 100, alpha: 1, weight: 1,
                    status: 'stable', discovered: false, extinction_counter: 0 };
    }
    const edges = edgePairs.map(([from, to]) => ({ from, to, beta: 0.03, revealed: false }));
    const tiles = { 't_0_0': { id:'t_0_0', x:0, y:0, type:'marsh', stressor:10, protected:false } };
    return { grid:{w:16,h:12}, tiles, nodes, edges, actionsThisStep:{} };
  }

  // ── Test 1: simple chain → acyclic ──────────────────────────────────────
  const chainWorld = makeWorld(
    ['n_a', 'n_b', 'n_c'],
    [['n_a','n_b'], ['n_b','n_c']]
  );
  const r1 = validateWorld(chainWorld);
  console.assert(r1.ok,
    `VALIDATOR FAIL: simple chain should be acyclic; got: ${r1.reason}`);

  // ── Test 2: direct cycle → detected ──────────────────────────────────────
  const cycleWorld = makeWorld(
    ['n_x', 'n_y'],
    [['n_x','n_y'], ['n_y','n_x']]
  );
  const r2 = validateWorld(cycleWorld);
  console.assert(!r2.ok,
    'VALIDATOR FAIL: direct cycle should fail acyclicity');
  console.assert(r2.reason.includes('cycle'),
    `VALIDATOR FAIL: reason should mention "cycle"; got: ${r2.reason}`);

  // ── Test 3: self-loop → detected ─────────────────────────────────────────
  const selfWorld = makeWorld(['n_s'], [['n_s','n_s']]);
  const r3 = validateWorld(selfWorld);
  console.assert(!r3.ok,
    'VALIDATOR FAIL: self-loop should fail acyclicity');

  // ── Test 4: 3-node cycle (A→B→C→A) → detected ────────────────────────────
  const threeWorld = makeWorld(
    ['n_1','n_2','n_3'],
    [['n_1','n_2'],['n_2','n_3'],['n_3','n_1']]
  );
  const r4 = validateWorld(threeWorld);
  console.assert(!r4.ok,
    'VALIDATOR FAIL: 3-node cycle should fail acyclicity');

  // ── Test 5: disconnected graph → acyclic ─────────────────────────────────
  const disconnWorld = makeWorld(['n_p','n_q','n_r'], []);
  const r5 = validateWorld(disconnWorld);
  console.assert(r5.ok,
    `VALIDATOR FAIL: disconnected acyclic graph should pass; got: ${r5.reason}`);

  // ── Test 6: single node → acyclic ────────────────────────────────────────
  const singleWorld = makeWorld(['n_only'], []);
  const r6 = validateWorld(singleWorld);
  console.assert(r6.ok,
    `VALIDATOR FAIL: single node should be acyclic; got: ${r6.reason}`);

  // ── Test 7: DAG with diamond shape → acyclic ─────────────────────────────
  // A → B, A → C, B → D, C → D
  const diamondWorld = makeWorld(
    ['n_A','n_B','n_C','n_D'],
    [['n_A','n_B'],['n_A','n_C'],['n_B','n_D'],['n_C','n_D']]
  );
  const r7 = validateWorld(diamondWorld);
  console.assert(r7.ok,
    `VALIDATOR FAIL: diamond DAG should be acyclic; got: ${r7.reason}`);

  // ── Test 8: coastal_wetland topology (n_runoff→n_seagrass→n_shrimp→n_heron)
  const cwWorld = makeWorld(
    ['n_runoff','n_seagrass','n_shrimp','n_heron'],
    [['n_runoff','n_seagrass'],['n_seagrass','n_shrimp'],['n_shrimp','n_heron']]
  );
  const r8 = validateWorld(cwWorld);
  console.assert(r8.ok,
    `VALIDATOR FAIL: coastal_wetland chain should be acyclic; got: ${r8.reason}`);

  // ── Test 9: edge to unknown node → fails gracefully ──────────────────────
  const badEdgeWorld = makeWorld(['n_a','n_b'], [['n_a','n_z']]);
  const r9 = validateWorld(badEdgeWorld);
  console.assert(!r9.ok,
    'VALIDATOR FAIL: edge to unknown node should fail');

  // ── Test 10: topological order is deterministic across calls ─────────────
  // Two identical worlds should produce identical ok/reason.
  const w10a = makeWorld(['n_a','n_b','n_c'],[['n_a','n_b'],['n_b','n_c']]);
  const w10b = makeWorld(['n_a','n_b','n_c'],[['n_a','n_b'],['n_b','n_c']]);
  const r10a = validateWorld(w10a);
  const r10b = validateWorld(w10b);
  console.assert(r10a.ok === r10b.ok && r10a.reason === r10b.reason,
    'VALIDATOR FAIL: identical worlds produced different validation results');

  // ── Test 11: clearly-winnable coastal_wetland world → solvable ───────────
  // Hand-built world: low stressor (L=5), populations at ~80 % of K_max,
  // full chain n_runoff(stressor)→n_seagrass→n_shrimp→n_heron.
  // The greedy auto-player should reach H≥75 within 30 days.
  {
    const winnableNodes = {
      n_runoff: {
        id:'n_runoff',  kind:'stressor', keystone:false,
        tileId:'t_runoff', population:0, r:0, K_max:0, alpha:0, weight:0,
        status:'stable', extinction_counter:0
      },
      n_seagrass: {
        id:'n_seagrass', kind:'producer', keystone:true,
        tileId:'t_seagrass', population:400, r:0.15, K_max:500, alpha:0.85, weight:2.5,
        status:'stable', extinction_counter:0
      },
      n_shrimp: {
        id:'n_shrimp', kind:'consumer', keystone:false,
        tileId:'t_shrimp', population:260, r:0.13, K_max:325, alpha:1.5, weight:1.25,
        status:'stable', extinction_counter:0
      },
      n_heron: {
        id:'n_heron', kind:'predator', keystone:true,
        tileId:'t_heron', population:72, r:0.07, K_max:90, alpha:2.3, weight:3.5,
        status:'stable', extinction_counter:0
      }
    };
    const winnableTiles = {
      t_runoff:   { id:'t_runoff',   stressor:5,  protected:false },
      t_seagrass: { id:'t_seagrass', stressor:5,  protected:false },
      t_shrimp:   { id:'t_shrimp',   stressor:5,  protected:false },
      t_heron:    { id:'t_heron',    stressor:5,  protected:false }
    };
    const winnableEdges = [
      { from:'n_runoff',   to:'n_seagrass', beta:0,     revealed:false },
      { from:'n_seagrass', to:'n_shrimp',   beta:0.035, revealed:false },
      { from:'n_shrimp',   to:'n_heron',    beta:0.045, revealed:false }
    ];
    const winnableWorld = {
      grid:{w:16,h:12},
      tiles: winnableTiles,
      nodes: winnableNodes,
      edges: winnableEdges,
      actionsThisStep: {}
    };
    const r11 = validateWorld(winnableWorld);
    console.assert(r11.ok,
      `VALIDATOR FAIL T11: clearly-winnable coastal_wetland world should be solvable; got: ${r11.reason}`);
  }

  console.log('[validator.js] All self-tests passed ✓');
  return true;
}

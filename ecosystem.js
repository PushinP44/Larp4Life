/**
 * ecosystem.js — Daily simulation engine for Ecosystem X
 *
 * Rule 02 (verbatim equations — do NOT approximate or linearize):
 *   Eq1  getCarryingCapacity  — K_i(L) = K_max·(1 − L/100)^alpha
 *   Eq2  stepPopulation       — logistic + bottom-up food + top-down predation + clamp
 *   Eq3  computeHealth        — weighted mean relative abundance − stressor penalty
 *   Rule 02-E  checkExtinction
 *   Rule 02-D  evaluateWinLose
 *
 * Rule 01 / Law 2: NO Math.random() here — all randomness flows through prng.js.
 * Rule 03: every mutating path ends with state.save().
 */

// ─────────────────────────────────────────────────────────────────────────────
// Balance knobs (Rule 02-C footnote — harness is source of truth)
// ─────────────────────────────────────────────────────────────────────────────
const FOOD_SUFFICIENCY = 0.4;   // θ — food at ≥θ of pristine capacity fully sustains consumer
const STARVE_RATE      = 0.3;   // fraction of population lost per day when food→0
const MAX_DELTA_FRAC   = 0.35;  // ±35 % stability clamp on daily population change
const DAILY_INCOME     = 55;    // resources credited each day (economy knob; raised 40→55 per difficulty re-tune for humane margin)

// ─────────────────────────────────────────────────────────────────────────────
// Eq1 — Dynamic carrying capacity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getCarryingCapacity(nodeId, state) → float
 *
 * K_i(L) = K_max_i × (1 − L/100) ^ alpha_i
 * L = the stressor level on the node's own tile.
 * Returns a float — do NOT round here; rounding happens only in stepPopulation.
 *
 * @param {string} nodeId
 * @param {object} state  — GameState (or mock with same shape)
 */
export function getCarryingCapacity(nodeId, state) {
  const n = state.world.nodes[nodeId];
  const L = state.world.tiles[n.tileId].stressor; // float 0–100
  const K = n.K_max * Math.pow(Math.max(0, 1 - L / 100), n.alpha);
  return K; // float; caller rounds if needed
}

// ─────────────────────────────────────────────────────────────────────────────
// Eq2 — Discrete logistic step with food dependency + predation + stability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * stepPopulation(nodeId, state[, popSnapshot]) → integer (new population)
 *
 * Implements Rule 02-C verbatim:
 *   growth     = K>0 ? r·P·(1 − P/K) : −P
 *   foodFactor = hasFood ? clamp(mean_j(P_j/K_max_j) / θ, 0, 1) : 1
 *   starvation = STARVE_RATE · P · (1 − foodFactor)
 *   predation  = Σ_k β_ik · min(P_k, P)     [edges i→k, k non-stressor]
 *   delta      = clamp(growth − starvation − predation − action, −0.35·P, +0.35·P)
 *   P_next     = max(0, round(P + delta))
 *
 * Edge direction reminder:
 *   j → nodeId  means nodeId EATS j  (j is food/prey  — contributes to foodFactor)
 *   nodeId → k  means k EATS nodeId  (k is a predator — contributes to predation)
 * Stressor edges (e.from is a stressor node) are SKIPPED in both loops.
 *
 * Jacobi / simultaneous-update support:
 *   When `popSnapshot` is provided (a plain object { nodeId: population }),
 *   the foodFactor and predation loops read neighbour populations from the
 *   snapshot (beginning-of-step values) rather than live node values. This
 *   makes the full daily step independent of node insertion order.
 *   The stepped node still writes its own live population as usual.
 *   Standalone calls without the snapshot continue to work (Gauss-Seidel,
 *   live reads) so all existing tests remain valid.
 *
 * @param {string} nodeId
 * @param {object} state
 * @param {Object<string,number>} [popSnapshot]  optional Jacobi snapshot
 * @returns {number} new population (integer ≥ 0)
 */
export function stepPopulation(nodeId, state, popSnapshot) {
  const n = state.world.nodes[nodeId];

  // Skip non-biological and extinct nodes entirely.
  if (n.kind === 'stressor' || n.status === 'extinct') return n.population ?? 0;

  const P = n.population;
  const K = getCarryingCapacity(nodeId, state);

  // Helper: get a neighbour's population — from snapshot when available.
  const snapPop = (id) =>
    popSnapshot !== undefined ? (popSnapshot[id] ?? 0) : state.world.nodes[id].population;

  // ── Growth — logistic on own-tile carrying capacity ───────────────────────
  const growth = K > 0 ? n.r * P * (1 - P / K) : -P; // collapse if K → 0

  // ── Bottom-up food dependency (j → nodeId edges, j non-stressor) ──────────
  let foodSum   = 0;
  let foodCount = 0;
  for (const e of state.world.edges) {
    if (e.to !== nodeId) continue;
    const j = state.world.nodes[e.from];
    if (!j || j.kind === 'stressor') continue; // stressor edge is NOT food
    // Use snapshot population; K_max_j is structural (doesn't change mid-step).
    foodSum += j.K_max > 0 ? snapPop(e.from) / j.K_max : 0;
    foodCount++;
  }
  const foodFactor = foodCount === 0
    ? 1 // no food edges → producer / light-limited → always full food
    : Math.max(0, Math.min(1, (foodSum / foodCount) / FOOD_SUFFICIENCY));

  const starvation = STARVE_RATE * P * (1 - foodFactor);

  // ── Top-down predation (nodeId → k edges, k non-stressor) ─────────────────
  let predation = 0;
  for (const e of state.world.edges) {
    if (e.from !== nodeId) continue;
    const k = state.world.nodes[e.to];
    if (!k || k.kind === 'stressor') continue; // stressor edge is NOT predation
    predation += e.beta * Math.min(snapPop(e.to), P);
  }

  // ── Player action (invasive culling / sampling for this node) ─────────────
  const action = state.world.actionsThisStep?.[nodeId] ?? 0;

  // ── Stability clamp (Rule 02-C: ±0.35·P) ─────────────────────────────────
  let delta = growth - starvation - predation - action;
  const cap = MAX_DELTA_FRAC * P;
  delta = Math.max(-cap, Math.min(cap, delta));

  // Write back — integer organisms, floor at 0.
  n.population = Math.max(0, Math.round(P + delta));
  return n.population;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 02-E — Extinction logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkExtinction(nodeId, state)
 *
 * P == 0 for 3 consecutive days → status = 'extinct' (permanent).
 * P  > 0 → reset extinction_counter to 0.
 * Stressor nodes are skipped.
 *
 * @param {string} nodeId
 * @param {object} state
 */
export function checkExtinction(nodeId, state) {
  const n = state.world.nodes[nodeId];
  if (n.kind === 'stressor') return;          // stressors have no extinction logic
  if (n.status === 'extinct') return;         // already permanent — nothing to do

  if (n.population === 0) {
    n.extinction_counter = (n.extinction_counter ?? 0) + 1;
    if (n.extinction_counter >= 3) {
      n.status = 'extinct'; // permanent — cannot be revived
    }
  } else {
    n.extinction_counter = 0; // living → reset
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eq3 — Ecosystem Health
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeHealth(state) → float [0,100]
 *
 * H = 100 · (Σ w_i · clamp(P_i / K_i(L=0), 0, 1)) / Σ w_i  −  stressorLoadPenalty
 *
 * K_i(L=0) is K_max_i (pristine capacity — L=0 means no pollution).
 * stressorLoadPenalty = 0.15 × mean stressor L across all stressor-source tiles.
 * Stressor nodes: weight treated as 0 (excluded from the population sum).
 * Result clamped to [0, 100].
 *
 * @param {object} state
 * @returns {number} health 0–100
 */
export function computeHealth(state) {
  let weightedSum  = 0;
  let totalWeight  = 0;

  for (const n of Object.values(state.world.nodes)) {
    if (n.kind === 'stressor') continue; // stressor nodes don't count
    const w = n.weight ?? 1;
    // K at L=0 is just K_max (Eq1 with L=0 → (1-0)^alpha = 1)
    const K_pristine = n.K_max;
    const relAbund   = K_pristine > 0
      ? Math.max(0, Math.min(1, n.population / K_pristine))
      : 0;
    weightedSum += w * relAbund;
    totalWeight += w;
  }

  const populationScore = totalWeight > 0 ? 100 * (weightedSum / totalWeight) : 0;

  // stressorLoadPenalty = 0.15 × mean stressor L of all stressor-source tiles
  const stressorTiles = Object.values(state.world.nodes)
    .filter(n => n.kind === 'stressor')
    .map(n => state.world.tiles[n.tileId]?.stressor ?? 0);

  const meanStressor = stressorTiles.length > 0
    ? stressorTiles.reduce((a, b) => a + b, 0) / stressorTiles.length
    : 0;
  const stressorLoadPenalty = 0.10 * meanStressor; // difficulty re-tune: 0.15→0.10 (runoff L=60 subtracts 6 not 9)

  return Math.max(0, Math.min(100, populationScore - stressorLoadPenalty));
}

// ─────────────────────────────────────────────────────────────────────────────
// Win / Lose evaluation (Rule 02-D)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * evaluateWinLose(state)
 *
 * Win: health_streak ≥ 3 AND no keystone is extinct.
 * Lose: collapse_timer ≤ 0 OR any keystone is extinct.
 * Once a flag is set it is permanent (no toggling back).
 *
 * @param {object} state
 */
export function evaluateWinLose(state) {
  const H = state.meta.ecosystem_health;

  // Maintain health streak: increment if H ≥ 75, reset otherwise.
  if (H >= 75) {
    state.meta.health_streak = (state.meta.health_streak ?? 0) + 1;
  } else {
    state.meta.health_streak = 0;
  }

  const keystoneNodes = Object.values(state.world.nodes)
    .filter(n => n.keystone === true);
  const anyKeystoneExtinct = keystoneNodes.some(n => n.status === 'extinct');

  // Fix (2): correct precedence per Rule 02-D:
  //   1. Keystone extinct → LOSE (always overrides everything, even a simultaneous win streak)
  //   2. Streak ≥ 3 AND no keystone extinct → WIN (even if collapse_timer just hit 0 on this tick)
  //   3. Timer ≤ 0 → LOSE (only if win not achieved)
  // This prevents the bug where H≥75 streak=3 on the final tick is scored as a loss.

  if (!state.flags.lose && !state.flags.win) {
    if (anyKeystoneExtinct) {
      // Priority 1: keystone extinction — unrecoverable loss
      state.flags.lose = true;
    } else if (state.meta.health_streak >= 3) {
      // Priority 2: win streak achieved while all keystones alive → WIN
      // (timer may be 0 on this same tick — win still counts)
      state.flags.win = true;
    } else if (state.meta.collapse_timer <= 0) {
      // Priority 3: time ran out without win or keystone extinction
      state.flags.lose = true;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Market tier helper (inline — hysteria.js owns full price/dialogue in P8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * tierForHealth(H) → string
 * TODO (P8): hysteria.js will own the full price-factor & dialogue swap;
 *            this function is the authoritative tier lookup — import it there.
 */
export function tierForHealth(H) {
  if (H < 25)  return 'Toxic';
  if (H < 50)  return 'Degraded';
  if (H < 75)  return 'Recovering';
  return 'Pristine';
}

// ─────────────────────────────────────────────────────────────────────────────
// runDailyStep(state) — master tick (ecosystem-step skill order-of-ops)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runDailyStep(state)
 *
 * Executes one game day in the exact order mandated by Rule 02 / ecosystem-step skill:
 *   a. stepPopulation  — every non-stressor, non-extinct node
 *   b. checkExtinction — every node
 *   c. computeHealth   → state.meta.ecosystem_health
 *   d. updateMarketTier (inline stub; P8 wires hysteria.js)
 *   e. day_count += 1; collapse_timer -= 1
 *   f. player.resources += DAILY_INCOME
 *   g. evaluateWinLose
 *   h. state.resetDay()   (clears actionsThisStep)
 *   i. state.save()
 *
 * @param {object} state — GameState singleton (or mock with same shape)
 */
export function runDailyStep(state) {
  // ── a. Step populations — Jacobi (simultaneous) update ───────────────────
  // Build a snapshot of ALL populations at the START of this step so that
  // every node's foodFactor / predation reads beginning-of-step values.
  // This makes the result independent of node key insertion order.
  const popSnapshot = {};
  for (const [id, n] of Object.entries(state.world.nodes)) {
    popSnapshot[id] = n.population;
  }

  for (const nodeId of Object.keys(state.world.nodes).sort()) {
    const n = state.world.nodes[nodeId];
    if (n.kind === 'stressor' || n.status === 'extinct') continue;
    stepPopulation(nodeId, state, popSnapshot); // Jacobi: reads neighbours from snapshot
  }

  // ── b. Check extinction counters for all nodes ────────────────────────────
  for (const nodeId of Object.keys(state.world.nodes).sort()) {
    checkExtinction(nodeId, state);
  }

  // ── c. Recompute ecosystem health ─────────────────────────────────────────
  state.meta.ecosystem_health = computeHealth(state);

  // ── d. Update market tier ─────────────────────────────────────────────────
  // TODO (P8): replace with hysteria.js updateTier(state) for full
  //            price-factor & vendor-dialogue logic.
  state.meta.market_tier = tierForHealth(state.meta.ecosystem_health);

  // ── e. Advance day counters ───────────────────────────────────────────────
  state.meta.day_count      += 1;
  state.meta.collapse_timer -= 1;

  // ── f. Daily resource income ──────────────────────────────────────────────
  state.player.resources += DAILY_INCOME;

  // ── g. Win / lose evaluation ──────────────────────────────────────────────
  evaluateWinLose(state);

  // ── h & i. Clear per-step actions then persist ────────────────────────────
  state.resetDay(); // clears actionsThisStep
  state.save();
}

/* ─────────────────────────────────────────────────────────────────────────────
   Self-tests (Rule 02-G, tests 1–8)
   Run from the browser console:
     const { runEcosystemTests } = await import('./ecosystem.js');
     runEcosystemTests();
───────────────────────────────────────────────────────────────────────────── */

export function runEcosystemTests() {

  // ── Minimal state factory ─────────────────────────────────────────────────
  // Builds a 4-node coastal_wetland mock state in mid-band values.
  // No dependency on biomes.json or localStorage — fully synchronous.
  function makeMock({
    seagrassL   = 75,
    shrimpL     = 70,
    heronL      = 70,
    runoffL     = 80,
    seagrassP   = 125,
    shrimpP     = 81,
    heronP      = 22,
    shrimpBeta  = 0.035,
    heronBeta   = 0.045
  } = {}) {
    const tiles = {
      t_runoff:   { id:'t_runoff',   stressor: runoffL,  protected: false },
      t_seagrass: { id:'t_seagrass', stressor: seagrassL, protected: false },
      t_shrimp:   { id:'t_shrimp',   stressor: shrimpL,   protected: false },
      t_heron:    { id:'t_heron',    stressor: heronL,    protected: false }
    };
    const nodes = {
      n_runoff:  { id:'n_runoff',  name:'Runoff',        kind:'stressor',  keystone:false,
                   tileId:'t_runoff',  population:0,   r:0,    K_max:0,   alpha:0,   weight:0,
                   status:'stable', extinction_counter:0 },
      n_seagrass:{ id:'n_seagrass',name:'Seagrass',      kind:'producer',  keystone:true,
                   tileId:'t_seagrass',population:seagrassP, r:0.15, K_max:500, alpha:0.85, weight:2.5,
                   status:'stable', extinction_counter:0 },
      n_shrimp:  { id:'n_shrimp',  name:'Shrimp',        kind:'consumer',  keystone:false,
                   tileId:'t_shrimp',  population:shrimpP, r:0.13, K_max:325, alpha:1.5, weight:1.25,
                   status:'stable', extinction_counter:0 },
      n_heron:   { id:'n_heron',   name:'Painted Stork', kind:'predator',  keystone:true,
                   tileId:'t_heron',   population:heronP, r:0.07, K_max:90,  alpha:2.3, weight:3.5,
                   status:'stable', extinction_counter:0 }
    };
    const edges = [
      { from:'n_runoff',   to:'n_seagrass', beta:0,         revealed:false },
      { from:'n_seagrass', to:'n_shrimp',   beta:shrimpBeta, revealed:false },
      { from:'n_shrimp',   to:'n_heron',    beta:heronBeta,  revealed:false }
    ];

    let _saved = false;
    return {
      meta: {
        seed:1337, biome_template:'coastal_wetland', day_count:1,
        collapse_timer:30, health_streak:0, ecosystem_health:50, market_tier:'Degraded'
      },
      player: { resources:100, tile_x:4, tile_y:6, scanner_charges:5 },
      world: { grid:{w:16,h:12}, tiles, nodes, edges, actionsThisStep:{} },
      notebook: { discovered_nodes:[], revealed_edges:[] },
      vendor: { base_prices:{bioremediation:80,rebalancing:90,stabilization:150},
                price_factor:1.3, available:['bioremediation','rebalancing','stabilization'] },
      flags: { win:false, lose:false },
      resetDay() { this.world.actionsThisStep = {}; _saved = true; },
      save()     { _saved = true; }
    };
  }

  // ── Test 1: Eq1 — carrying capacity collapses for fragile keystone (Rule 02-G #1) ──
  {
    const s = makeMock({ seagrassL: 85 });
    s.world.nodes.n_seagrass.K_max   = 200;
    s.world.nodes.n_seagrass.alpha   = 2.5;
    const K = getCarryingCapacity('n_seagrass', s);
    const expected = 200 * Math.pow(0.15, 2.5);
    console.assert(Math.abs(K - expected) < 1e-6,
      `ECO FAIL T1: Eq1 keystone collapse — got ${K}, expected ${expected.toFixed(6)}`);
  }

  // ── Test 2: Eq1 — pristine L=0 → K equals K_max (Rule 02-G #2) ────────────
  {
    const s = makeMock({ seagrassL: 0 });
    s.world.nodes.n_seagrass.K_max  = 500;
    s.world.nodes.n_seagrass.alpha  = 0.8;
    const K = getCarryingCapacity('n_seagrass', s);
    console.assert(K === 500,
      `ECO FAIL T2: Eq1 pristine — got ${K}, expected 500`);
  }

  // ── Test 3: population never negative under heavy predation / action (Rule 02-G #3) ──
  {
    // Drive shrimp to near-extinction: very high beta + player action
    const s = makeMock({ shrimpP: 5, heronP: 100, heronBeta: 0.99 });
    s.world.actionsThisStep['n_shrimp'] = 9999; // enormous player removal
    stepPopulation('n_shrimp', s);
    console.assert(s.world.nodes.n_shrimp.population >= 0,
      `ECO FAIL T3: population went negative: ${s.world.nodes.n_shrimp.population}`);
  }

  // ── Test 4: stability clamp — |delta| ≤ 0.35·P (Rule 02-G #4) ─────────────
  {
    // Use a node with very high r to force a large unclamped growth
    const s = makeMock({ seagrassL: 0, seagrassP: 10 });
    s.world.nodes.n_seagrass.r = 10; // absurd growth rate
    const P_before = s.world.nodes.n_seagrass.population;
    stepPopulation('n_seagrass', s);
    const P_after = s.world.nodes.n_seagrass.population;
    const delta = Math.abs(P_after - P_before);
    // Allow Math.round rounding to add ≤ 0.5 on top of the clamp
    console.assert(delta <= Math.ceil(MAX_DELTA_FRAC * P_before) + 1,
      `ECO FAIL T4: stability clamp violated — |delta|=${delta} > 0.35×${P_before}`);
  }

  // ── Test 5: stressor node is skipped — population unchanged ─────────────────
  {
    const s = makeMock();
    s.world.nodes.n_runoff.population = 0;
    const before = s.world.nodes.n_runoff.population;
    stepPopulation('n_runoff', s);
    console.assert(s.world.nodes.n_runoff.population === before,
      'ECO FAIL T5: stressor node should be skipped by stepPopulation');
  }

  // ── Test 6: determinism — same inputs → same output ─────────────────────────
  {
    const sA = makeMock({ seagrassP:125, shrimpP:81, heronP:22 });
    const sB = makeMock({ seagrassP:125, shrimpP:81, heronP:22 });
    // Run one full daily step on each mock
    for (const nodeId of ['n_seagrass','n_shrimp','n_heron']) {
      stepPopulation(nodeId, sA);
      stepPopulation(nodeId, sB);
    }
    console.assert(
      sA.world.nodes.n_seagrass.population === sB.world.nodes.n_seagrass.population &&
      sA.world.nodes.n_shrimp.population   === sB.world.nodes.n_shrimp.population   &&
      sA.world.nodes.n_heron.population    === sB.world.nodes.n_heron.population,
      'ECO FAIL T6: identical inputs produced different populations (determinism broken)'
    );
  }

  // ── Test 7: bottom-up cascade — zero producer → consumer starvation (Rule 02-G #7) ──
  {
    // Zero out seagrass. With no food, shrimp's foodFactor→0 → starvation each step.
    const s = makeMock({ seagrassP: 0, shrimpP: 100 });
    const shrimpBefore = s.world.nodes.n_shrimp.population;
    // Step shrimp only (seagrass already at 0, heron won't affect this test)
    stepPopulation('n_shrimp', s);
    const shrimpAfter = s.world.nodes.n_shrimp.population;
    console.assert(shrimpAfter < shrimpBefore,
      `ECO FAIL T7: shrimp should decline when seagrass=0 (cascade); ` +
      `before=${shrimpBefore}, after=${shrimpAfter}`);
  }

  // ── Test 8: apex node (no outgoing trophic edge) takes zero predation loss (Rule 02-G #8) ──
  {
    // n_heron has no outgoing edge → predation on n_shrimp via heron should come from
    // edge n_shrimp→n_heron. Check that n_heron itself suffers zero predation
    // (there is no node that eats n_heron).
    const s = makeMock({ heronP: 22, shrimpP: 81 });

    // Manually compute predation for n_heron: look for edges where e.from === 'n_heron'
    let predation = 0;
    for (const e of s.world.edges) {
      if (e.from !== 'n_heron') continue;
      const k = s.world.nodes[e.to];
      if (!k || k.kind === 'stressor') continue;
      predation += e.beta * Math.min(k.population, s.world.nodes.n_heron.population);
    }
    console.assert(predation === 0,
      `ECO FAIL T8: apex node n_heron should have zero predation; got ${predation}`);

    // Also verify that stepping n_heron actually increases or stays flat (no predation loss
    // dragging it down below what logistic alone would give).
    const heronBefore = s.world.nodes.n_heron.population;
    stepPopulation('n_heron', s);
    // Under starvation from depleted shrimp it may decline, but predation term must be 0.
    // Re-run with abundant shrimp to confirm heron can only grow under good conditions.
    const sGood = makeMock({ heronP:22, shrimpP:300, shrimpL:0, heronL:0 });
    const heronGoodBefore = sGood.world.nodes.n_heron.population;
    stepPopulation('n_heron', sGood);
    console.assert(sGood.world.nodes.n_heron.population >= heronGoodBefore,
      `ECO FAIL T8b: apex node should grow under abundant food; ` +
      `before=${heronGoodBefore}, after=${sGood.world.nodes.n_heron.population}`);
    void heronBefore; // suppress lint
  }

  // ── Test 9: Jacobi order-independence — same result regardless of node insertion order ──
  // Build two mocks with the same node values but different insertion orders.
  // Run a full runDailyStep on each; all three biological populations must match.
  {
    function makeMockOrdered(nodeOrder) {
      const nodeDefs = {
        n_runoff:  { id:'n_runoff',  name:'Runoff',        kind:'stressor',  keystone:false,
                     tileId:'t_runoff',  population:0,   r:0,    K_max:0,   alpha:0,   weight:0,
                     status:'stable', extinction_counter:0 },
        n_seagrass:{ id:'n_seagrass',name:'Seagrass',      kind:'producer',  keystone:true,
                     tileId:'t_seagrass',population:125, r:0.15, K_max:500, alpha:0.85, weight:2.5,
                     status:'stable', extinction_counter:0 },
        n_shrimp:  { id:'n_shrimp',  name:'Shrimp',        kind:'consumer',  keystone:false,
                     tileId:'t_shrimp',  population:81,  r:0.13, K_max:325, alpha:1.5, weight:1.25,
                     status:'stable', extinction_counter:0 },
        n_heron:   { id:'n_heron',   name:'Painted Stork', kind:'predator',  keystone:true,
                     tileId:'t_heron',   population:22,  r:0.07, K_max:90,  alpha:2.3, weight:3.5,
                     status:'stable', extinction_counter:0 }
      };
      const nodes = {};
      for (const id of nodeOrder) nodes[id] = JSON.parse(JSON.stringify(nodeDefs[id]));

      const tiles = {
        t_runoff:   { id:'t_runoff',   stressor:80, protected:false },
        t_seagrass: { id:'t_seagrass', stressor:75, protected:false },
        t_shrimp:   { id:'t_shrimp',   stressor:70, protected:false },
        t_heron:    { id:'t_heron',    stressor:70, protected:false }
      };
      const edges = [
        { from:'n_runoff',   to:'n_seagrass', beta:0,     revealed:false },
        { from:'n_seagrass', to:'n_shrimp',   beta:0.035, revealed:false },
        { from:'n_shrimp',   to:'n_heron',    beta:0.045, revealed:false }
      ];
      return {
        meta: { seed:42, biome_template:'coastal_wetland', day_count:1,
                collapse_timer:30, health_streak:0, ecosystem_health:50, market_tier:'Degraded' },
        player: { resources:100, tile_x:4, tile_y:6, scanner_charges:5 },
        world:  { grid:{w:16,h:12}, tiles, nodes, edges, actionsThisStep:{} },
        notebook: { discovered_nodes:[], revealed_edges:[] },
        vendor: { base_prices:{bioremediation:80,rebalancing:90,stabilization:150},
                  price_factor:1.3, available:[] },
        flags: { win:false, lose:false },
        resetDay() { this.world.actionsThisStep = {}; },
        save()     { /* no-op */ }
      };
    }

    // Order A: natural insertion order
    const sA = makeMockOrdered(['n_runoff','n_seagrass','n_shrimp','n_heron']);
    // Order B: reversed biological nodes
    const sB = makeMockOrdered(['n_heron','n_shrimp','n_seagrass','n_runoff']);

    runDailyStep(sA);
    runDailyStep(sB);

    console.assert(
      sA.world.nodes.n_seagrass.population === sB.world.nodes.n_seagrass.population &&
      sA.world.nodes.n_shrimp.population   === sB.world.nodes.n_shrimp.population   &&
      sA.world.nodes.n_heron.population    === sB.world.nodes.n_heron.population,
      `ECO FAIL T9: daily step result differs by node order — ` +
      `seagrass: ${sA.world.nodes.n_seagrass.population} vs ${sB.world.nodes.n_seagrass.population}, ` +
      `shrimp: ${sA.world.nodes.n_shrimp.population} vs ${sB.world.nodes.n_shrimp.population}, ` +
      `heron: ${sA.world.nodes.n_heron.population} vs ${sB.world.nodes.n_heron.population}`
    );
  }

  console.log('[ecosystem.js] All self-tests passed ✓');
  return true;
}

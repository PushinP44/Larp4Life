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
 * Typed stressor pre-step (Phase 2):
 *   Before the population step, runDailyStep processes state.world.activeStressors:
 *     • runoff:      propagate L to orthogonal neighbours (if source L ≥ 10)
 *     • overharvest: subtract harvestDrain from target population (unless protected)
 *     • invasive:    no pre-step (handled by normal Eq2 edges)
 *
 * Intervention mutators (Rule 03: validate → mutate → clamp → save):
 *   applyBioremediation(tileId, state)   — L -= BIOREM_AMOUNT (clamp 0)
 *   applyCull(nodeId, state)             — population -= CULL_FRAC × P
 *   applyProtect(tileId, state)          — tile.protected=true, L ≤ PROTECT_CAP
 *
 * Rule 01 / Law 2: NO Math.random() here — all randomness flows through prng.js.
 * Rule 03: every mutating path ends with state.save().
 */

// ─────────────────────────────────────────────────────────────────────────────
// Balance knobs — imported from balance.js (single source of truth). Re-exported
// so existing `import { RUNOFF_SPREAD, … } from './ecosystem.js'` call sites keep
// working. Retune in balance.js, then run `npm test`.
// ─────────────────────────────────────────────────────────────────────────────
import {
  FOOD_SUFFICIENCY, STARVE_RATE, MAX_DELTA_FRAC, DAILY_INCOME, COLLAPSE_TIMER,
  STRESSOR_PENALTY_COEFF,
  RUNOFF_SPREAD, HARVEST_DRAIN, CULL_FRAC, PROTECT_CAP, BIOREM_AMOUNT,
  TRADEOFF_PREY_SAFE, INVASIVE_STARVE_FLOOR, HERON_STARVE_PENALTY,
  RUNOFF_ESCALATION_RATE, RUNOFF_ESCALATION_MAX, RUNOFF_ESCALATION_DECAY,
} from './balance.js';

export {
  RUNOFF_SPREAD, HARVEST_DRAIN, CULL_FRAC, PROTECT_CAP, BIOREM_AMOUNT,
  TRADEOFF_PREY_SAFE, INVASIVE_STARVE_FLOOR, HERON_STARVE_PENALTY,
};

// Trade-off (#2): the invasive (Mozambique Tilapia) is also the keystone predator's
// food. Culling it to near-zero while the predator's PRIMARY prey is still scarce
// deprives the predator — it loses condition each day until the prey recovers.
// Winning line: restore the habitat (raise prey) FIRST, then finish the cull.
// Escalation (#4): unaddressed runoff pollution ACCELERATES over time (bounded),
// and reverses once the source is bioremediated. Rewards fast root-cause action;
// punishes dawdling. Tile-L based → no population-clamp interaction.
// Both sets of knobs live in balance.js.

// ─────────────────────────────────────────────────────────────────────────────
// Eq1 — Dynamic carrying capacity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getCarryingCapacity(nodeId, state) → float
 *
 * K_i(L) = K_max_i × (1 − L/100) ^ alpha_i
 * L = the stressor level on the node's own tile.
 * Returns a float — do NOT round here; rounding happens only in stepPopulation.
 */
export function getCarryingCapacity(nodeId, state) {
  const n = state.world.nodes[nodeId];
  const L = state.world.tiles[n.tileId].stressor; // float 0–100
  const K = n.K_max * Math.pow(Math.max(0, 1 - L / 100), n.alpha);
  return K;
}

// ─────────────────────────────────────────────────────────────────────────────
// Eq2 — Discrete logistic step with food dependency + predation + stability
// ─────────────────────────────────────────────────────────────────────────────

/**
 * stepPopulation(nodeId, state[, popSnapshot]) → integer (new population)
 *
 * Implements Rule 02-C verbatim.
 * Invasive nodes are treated exactly like biological nodes for this step
 * (their suppression effect on native prey is carried through the edge β).
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
  const growth = K > 0 ? n.r * P * (1 - P / K) : -P;

  // ── Bottom-up food dependency (j → nodeId edges, j non-stressor) ──────────
  let foodSum   = 0;
  let foodCount = 0;
  for (const e of state.world.edges) {
    if (e.to !== nodeId) continue;
    const j = state.world.nodes[e.from];
    if (!j || j.kind === 'stressor') continue;
    foodSum += j.K_max > 0 ? snapPop(e.from) / j.K_max : 0;
    foodCount++;
  }
  const foodFactor = foodCount === 0
    ? 1
    : Math.max(0, Math.min(1, (foodSum / foodCount) / FOOD_SUFFICIENCY));

  const starvation = STARVE_RATE * P * (1 - foodFactor);

  // ── Top-down predation (nodeId → k edges, k non-stressor) ─────────────────
  let predation = 0;
  for (const e of state.world.edges) {
    if (e.from !== nodeId) continue;
    const k = state.world.nodes[e.to];
    if (!k || k.kind === 'stressor') continue;
    predation += e.beta * Math.min(snapPop(e.to), P);
  }

  // ── Player action (invasive culling / sampling for this node) ─────────────
  const action = state.world.actionsThisStep?.[nodeId] ?? 0;

  // ── Stability clamp (Rule 02-C: ±0.35·P) ─────────────────────────────────
  let delta = growth - starvation - predation - action;
  const cap = MAX_DELTA_FRAC * P;
  delta = Math.max(-cap, Math.min(cap, delta));

  n.population = Math.max(0, Math.round(P + delta));
  return n.population;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rule 02-E — Extinction logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * checkExtinction(nodeId, state)
 * P == 0 for 3 consecutive days → status = 'extinct' (permanent).
 */
export function checkExtinction(nodeId, state) {
  const n = state.world.nodes[nodeId];
  if (n.kind === 'stressor') return;
  if (n.status === 'extinct') return;

  if (n.population === 0) {
    n.extinction_counter = (n.extinction_counter ?? 0) + 1;
    if (n.extinction_counter >= 3) {
      n.status = 'extinct';
    }
  } else {
    n.extinction_counter = 0;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Eq3 — Ecosystem Health
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeHealth(state) → float [0,100]
 *
 * H = 100 · (Σ w_i · clamp(P_i / K_i(L=0), 0, 1)) / Σ w_i  −  stressorLoadPenalty
 * Invasive nodes (weight=0) do not contribute to the health score.
 */
export function computeHealth(state) {
  let weightedSum  = 0;
  let totalWeight  = 0;

  for (const n of Object.values(state.world.nodes)) {
    // Exclude stressor nodes AND invasive nodes (weight=0 already handles invasive,
    // but skip explicitly so they can never inflate the score either)
    if (n.kind === 'stressor' || n.kind === 'invasive') continue;
    const w = n.weight ?? 1;
    const K_pristine = n.K_max;
    const relAbund   = K_pristine > 0
      ? Math.max(0, Math.min(1, n.population / K_pristine))
      : 0;
    weightedSum += w * relAbund;
    totalWeight += w;
  }

  const populationScore = totalWeight > 0 ? 100 * (weightedSum / totalWeight) : 0;

  // stressorLoadPenalty = STRESSOR_PENALTY_COEFF × mean stressor L across all
  // stressor-source tiles (only n_runoff-type stressor tiles contribute — not invasive)
  const stressorTiles = Object.values(state.world.nodes)
    .filter(n => n.kind === 'stressor')
    .map(n => state.world.tiles[n.tileId]?.stressor ?? 0);

  const meanStressor = stressorTiles.length > 0
    ? stressorTiles.reduce((a, b) => a + b, 0) / stressorTiles.length
    : 0;
  const stressorLoadPenalty = STRESSOR_PENALTY_COEFF * meanStressor;

  // Invasive health impact comes from ecological suppression of natives (β),
  // not a flat artificial penalty. Penalty set to 0 — let β do the work.
  let invasivePenalty = 0;
  // (Re-tune §3: removed flat invasive penalty; β = [0.025,0.050] drives real suppression)

  // Overharvest: adds a fixed small penalty proportional to drain / target K_max
  let harvestPenalty = 0;
  for (const s of (state.world.activeStressors ?? [])) {
    if (s.type === 'overharvest') {
      const target = state.world.nodes[s.targetNative];
      if (target && target.K_max > 0) {
        const drain = s.harvestDrain ?? HARVEST_DRAIN;
        const tile  = state.world.tiles[target.tileId];
        if (!tile?.protected) {
          harvestPenalty += 3 * (drain / target.K_max) * 100;
        }
      }
    }
  }

  return Math.max(0, Math.min(100,
    populationScore - stressorLoadPenalty - invasivePenalty - harvestPenalty
  ));
}

// ─────────────────────────────────────────────────────────────────────────────
// Win / Lose evaluation (Rule 02-D)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * evaluateWinLose(state)
 *
 * Win: health_streak ≥ 3 AND no keystone is extinct.
 * Lose: collapse_timer ≤ 0 OR any keystone is extinct.
 */
export function evaluateWinLose(state) {
  const H = state.meta.ecosystem_health;

  if (H >= 75) {
    state.meta.health_streak = (state.meta.health_streak ?? 0) + 1;
  } else {
    state.meta.health_streak = 0;
  }

  const keystoneNodes = Object.values(state.world.nodes)
    .filter(n => n.keystone === true);
  const anyKeystoneExtinct = keystoneNodes.some(n => n.status === 'extinct');

  if (!state.flags.lose && !state.flags.win) {
    if (anyKeystoneExtinct) {
      state.flags.lose = true;
    } else if (state.meta.health_streak >= 3) {
      state.flags.win = true;
    } else if (state.meta.collapse_timer <= 0) {
      state.flags.lose = true;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Market tier helper
// ─────────────────────────────────────────────────────────────────────────────

export function tierForHealth(H) {
  if (H < 25)  return 'Toxic';
  if (H < 50)  return 'Degraded';
  if (H < 75)  return 'Recovering';
  return 'Pristine';
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed-stressor pre-step processing
// Called at the START of runDailyStep, before the population step.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * processStressors(state)
 *
 * Processes state.world.activeStressors before the population simulation:
 *
 *   runoff:      If the source tile's L ≥ 10, add RUNOFF_SPREAD to each
 *                orthogonal (N/E/S/W) neighbour tile's stressor, clamped [0,100].
 *                (Cleaning the source tile to L<10 stops propagation — root fix.)
 *
 *   overharvest: Subtract harvestDrain from the target species' population
 *                (floor 0), UNLESS that species' tile is protected.
 *                (Uses stressor.harvestDrain or the global HARVEST_DRAIN knob.)
 *
 *   invasive:    No pre-step needed — the invasive node's edge to its target
 *                is handled by the normal Eq2 predation loop each day.
 *
 * Does NOT call state.save() — runDailyStep owns the save at the end of
 * the full tick (Rule 03).
 */
function processStressors(state) {
  const { tiles, nodes, grid } = state.world;
  const { w, h } = grid;

  for (const s of (state.world.activeStressors ?? [])) {

    if (s.type === 'runoff') {
      const sourceTile = tiles[s.sourceTileId];
      if (!sourceTile) continue;
      const sourceL = sourceTile.stressor ?? 0;

      // Escalation (#4): unaddressed pollution accelerates; cleaning the source reverses it.
      if (!Number.isFinite(s.escalation)) s.escalation = 0;
      if (sourceL >= 10) {
        s.escalation = Math.min(RUNOFF_ESCALATION_MAX, s.escalation + RUNOFF_ESCALATION_RATE);
      } else {
        s.escalation = Math.max(0, s.escalation - RUNOFF_ESCALATION_DECAY);
        continue; // source cleaned — propagation stopped
      }

      const spread = (s.spreadRate ?? RUNOFF_SPREAD) * (1 + s.escalation);

      // Parse tile coordinates from tileId "t_X_Y"
      const parts = s.sourceTileId.replace('t_', '').split('_').map(Number);
      const sx = parts[0];
      const sy = parts[1];

      // Orthogonal neighbours
      const neighbours = [
        [sx,     sy - 1],
        [sx,     sy + 1],
        [sx - 1, sy    ],
        [sx + 1, sy    ]
      ];
      for (const [nx, ny] of neighbours) {
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const nTileId = `t_${nx}_${ny}`;
        const nTile   = tiles[nTileId];
        if (!nTile) continue;
        nTile.stressor = Math.max(0, Math.min(100, (nTile.stressor ?? 0) + spread));
      }

    } else if (s.type === 'overharvest') {
      const targetNode = nodes[s.targetNative];
      if (!targetNode || targetNode.status === 'extinct') continue;

      const targetTile = tiles[targetNode.tileId];
      if (targetTile?.protected) continue; // protect() zeroes the drain

      const drain = s.harvestDrain ?? HARVEST_DRAIN;
      targetNode.population = Math.max(0, targetNode.population - drain);
      // Note: no stability clamp here — this is an external removal BEFORE Eq2,
      // modelling continuous extraction. The Eq2 clamp operates on the remaining pop.

    } else if (s.type === 'invasive') {
      // Suppression of the prey is carried by the Eq2 edge. Here we model the
      // TRADE-OFF (#2): the predator feeds on the invasive too. If the player has
      // culled the invasive to near-zero while the predator's primary prey is
      // still scarce, the predator loses its backup food and starves.
      const inv  = nodes[s.nodeId];
      const prey = nodes[s.targetNative];
      const predator = Object.values(nodes).find(n => n.kind === 'predator' && n.status !== 'extinct');
      if (inv && prey && predator) {
        const invRel  = inv.K_max  > 0 ? inv.population  / inv.K_max  : 0;
        const preyRel = prey.K_max > 0 ? prey.population / prey.K_max : 1;
        if (invRel < INVASIVE_STARVE_FLOOR && preyRel < TRADEOFF_PREY_SAFE) {
          // Apply as a clamped action term (Eq2 subtracts it, bounded by ±0.35·P)
          // so the trade-off respects the stability envelope — no clamp-bypass.
          if (!state.world.actionsThisStep) state.world.actionsThisStep = {};
          state.world.actionsThisStep[predator.id] =
            (state.world.actionsThisStep[predator.id] ?? 0) + HERON_STARVE_PENALTY;
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Intervention mutators (Rule 03: validate → mutate → clamp → save)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * applyBioremediation(tileId, state) → { ok, message }
 *
 * Counter for 'runoff' stressor.
 * Reduces stressor L on `tileId` by BIOREM_AMOUNT (clamp 0).
 * If L drops below 10 on the SOURCE tile, propagation stops.
 *
 * WRONG counter note: if called on a non-runoff world the resources are still
 * spent and L is reduced (but there's no runoff propagation to stop, so it
 * has little effect). This is the intended wrong-tool penalty.
 *
 * NOTE: vendor.js's applyIntervention('bioremediation') already handles the
 * player-facing version (on the player's current tile). This function is the
 * pure mutator used by the harness / auto-player.
 */
export function applyBioremediation(tileId, state) {
  const tile = state.world.tiles[tileId];
  if (!tile) return { ok: false, message: `No tile: ${tileId}` };
  const before = tile.stressor ?? 0;
  tile.stressor = Math.max(0, before - BIOREM_AMOUNT);
  state.save();
  return { ok: true, message: `Bioremediation: ${tileId} L ${Math.round(before)} → ${Math.round(tile.stressor)}` };
}

/**
 * applyCull(nodeId, state) → { ok, message }
 *
 * Counter for 'invasive' stressor.
 * One-step population spike: removes CULL_FRAC × current population from nodeId.
 * Repeat applications drive the invasive down.
 *
 * Wrong-counter note: if called on a native node, it still removes CULL_FRAC
 * of that native's population — a painful wrong-tool penalty with no benefit.
 */
export function applyCull(nodeId, state) {
  const n = state.world.nodes[nodeId];
  if (!n) return { ok: false, message: `No node: ${nodeId}` };
  if (n.status === 'extinct') return { ok: false, message: `${nodeId} already extinct.` };
  const before = n.population;
  const removal = Math.ceil(before * CULL_FRAC);
  n.population = Math.max(0, before - removal);
  state.save();
  return { ok: true, message: `Cull ${nodeId}: ${before} → ${n.population} (−${removal})` };
}

/**
 * applyProtect(tileId, state) → { ok, message }
 *
 * Counter for 'overharvest' stressor.
 * Sets tile.protected = true, which zeroes the harvest drain for species on
 * that tile. Also caps the tile's L at PROTECT_CAP (matches vendor.js stabilization).
 *
 * Wrong-counter note: protects the tile from harvest drain, but if the stressor
 * is runoff the tile protection does nothing about L propagation from the source.
 */
export function applyProtect(tileId, state) {
  const tile = state.world.tiles[tileId];
  if (!tile) return { ok: false, message: `No tile: ${tileId}` };
  if (tile.protected) return { ok: false, message: `${tileId} already protected.` };
  tile.protected = true;
  tile.stressor  = Math.min(tile.stressor ?? 0, PROTECT_CAP);
  state.save();
  return { ok: true, message: `Protected tile ${tileId} (L capped at ${PROTECT_CAP}).` };
}

// ─────────────────────────────────────────────────────────────────────────────
// runDailyStep(state) — master tick
// ─────────────────────────────────────────────────────────────────────────────

/**
 * runDailyStep(state)
 *
 * Order-of-operations (updated for typed stressors):
 *   PRE-0. processStressors — runoff propagation, overharvest drain (before Eq2
 *          so stressor-driven symptoms cascade into the same day's population step)
 *   a. stepPopulation  — every non-stressor, non-extinct node (Jacobi)
 *   b. checkExtinction — every node
 *   c. computeHealth   → state.meta.ecosystem_health
 *   d. updateMarketTier
 *   e. day_count += 1; collapse_timer -= 1
 *   f. player.resources += DAILY_INCOME
 *   g. evaluateWinLose
 *   h. state.resetDay() + state.save()
 */
export function runDailyStep(state) {
  // ── PRE-0. Record start-of-day population for UI trend arrows (▲/▼). ───────
  // Derived/recorded only — does not affect the simulation math or determinism.
  for (const n of Object.values(state.world.nodes)) {
    n.prev_population = n.population;
  }

  // ── PRE-0. Typed stressor effects (before population step) ────────────────
  processStressors(state);

  // ── a. Step populations — Jacobi (simultaneous) update ───────────────────
  const popSnapshot = {};
  for (const [id, n] of Object.entries(state.world.nodes)) {
    popSnapshot[id] = n.population;
  }

  for (const nodeId of Object.keys(state.world.nodes).sort()) {
    const n = state.world.nodes[nodeId];
    if (n.kind === 'stressor' || n.status === 'extinct') continue;
    stepPopulation(nodeId, state, popSnapshot);
  }

  // ── b. Check extinction counters for all nodes ────────────────────────────
  for (const nodeId of Object.keys(state.world.nodes).sort()) {
    checkExtinction(nodeId, state);
  }

  // ── c. Recompute ecosystem health ─────────────────────────────────────────
  state.meta.ecosystem_health = computeHealth(state);

  // ── d. Update market tier ─────────────────────────────────────────────────
  state.meta.market_tier = tierForHealth(state.meta.ecosystem_health);

  // ── e. Advance day counters ───────────────────────────────────────────────
  state.meta.day_count      += 1;
  state.meta.collapse_timer -= 1;

  // ── f. Daily resource income ──────────────────────────────────────────────
  // Use modifier-adjusted income if set (state.meta.daily_income), else default.
  state.player.resources += (state.meta.daily_income ?? DAILY_INCOME);

  // ── g. Win / lose evaluation ──────────────────────────────────────────────
  evaluateWinLose(state);

  // ── h. Clear per-step actions then persist ────────────────────────────────
  state.resetDay();
  state.save();
}

/* ─────────────────────────────────────────────────────────────────────────────
   Self-tests (Rule 02-G)
   Run from the browser console:
     const { runEcosystemTests } = await import('./ecosystem.js');
     runEcosystemTests();
───────────────────────────────────────────────────────────────────────────── */

export function runEcosystemTests() {

  function makeMock({
    seagrassL   = 75,
    shrimpL     = 70,
    heronL      = 70,
    runoffL     = 80,
    seagrassP   = 125,
    shrimpP     = 81,
    heronP      = 22,
    shrimpBeta  = 0.035,
    heronBeta   = 0.045,
    activeStressors = []
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
        collapse_timer:COLLAPSE_TIMER, health_streak:0, ecosystem_health:50, market_tier:'Degraded'
      },
      player: { resources:100, tile_x:4, tile_y:6, scanner_charges:5 },
      world: { grid:{w:16,h:12}, tiles, nodes, edges, actionsThisStep:{}, activeStressors },
      notebook: { discovered_nodes:[], revealed_edges:[] },
      vendor: { base_prices:{bioremediation:60,rebalancing:45,stabilization:120},
                price_factor:1.0, available:['bioremediation','rebalancing','stabilization'] },
      flags: { win:false, lose:false },
      resetDay() { this.world.actionsThisStep = {}; _saved = true; },
      save()     { _saved = true; }
    };
  }

  // ── Test 1: Eq1 — carrying capacity collapses for fragile keystone ──────────
  {
    const s = makeMock({ seagrassL: 85 });
    s.world.nodes.n_seagrass.K_max   = 200;
    s.world.nodes.n_seagrass.alpha   = 2.5;
    const K = getCarryingCapacity('n_seagrass', s);
    const expected = 200 * Math.pow(0.15, 2.5);
    console.assert(Math.abs(K - expected) < 1e-6,
      `ECO FAIL T1: Eq1 keystone collapse — got ${K}, expected ${expected.toFixed(6)}`);
  }

  // ── Test 2: Eq1 — pristine L=0 → K equals K_max ───────────────────────────
  {
    const s = makeMock({ seagrassL: 0 });
    s.world.nodes.n_seagrass.K_max  = 500;
    s.world.nodes.n_seagrass.alpha  = 0.8;
    const K = getCarryingCapacity('n_seagrass', s);
    console.assert(K === 500,
      `ECO FAIL T2: Eq1 pristine — got ${K}, expected 500`);
  }

  // ── Test 3: population never negative under heavy predation / action ────────
  {
    const s = makeMock({ shrimpP: 5, heronP: 100, heronBeta: 0.99 });
    s.world.actionsThisStep['n_shrimp'] = 9999;
    stepPopulation('n_shrimp', s);
    console.assert(s.world.nodes.n_shrimp.population >= 0,
      `ECO FAIL T3: population went negative: ${s.world.nodes.n_shrimp.population}`);
  }

  // ── Test 4: stability clamp — |delta| ≤ 0.35·P ─────────────────────────────
  {
    const s = makeMock({ seagrassL: 0, seagrassP: 10 });
    s.world.nodes.n_seagrass.r = 10;
    const P_before = s.world.nodes.n_seagrass.population;
    stepPopulation('n_seagrass', s);
    const P_after = s.world.nodes.n_seagrass.population;
    const delta = Math.abs(P_after - P_before);
    console.assert(delta <= Math.ceil(MAX_DELTA_FRAC * P_before) + 1,
      `ECO FAIL T4: stability clamp violated — |delta|=${delta} > 0.35×${P_before}`);
  }

  // ── Test 5: stressor node is skipped ──────────────────────────────────────
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

  // ── Test 7: bottom-up cascade — zero producer → consumer starvation ─────────
  {
    const s = makeMock({ seagrassP: 0, shrimpP: 100 });
    const shrimpBefore = s.world.nodes.n_shrimp.population;
    stepPopulation('n_shrimp', s);
    const shrimpAfter = s.world.nodes.n_shrimp.population;
    console.assert(shrimpAfter < shrimpBefore,
      `ECO FAIL T7: shrimp should decline when seagrass=0 (cascade); ` +
      `before=${shrimpBefore}, after=${shrimpAfter}`);
  }

  // ── Test 8: apex node takes zero predation loss ──────────────────────────────
  {
    const s = makeMock({ heronP: 22, shrimpP: 81 });
    let predation = 0;
    for (const e of s.world.edges) {
      if (e.from !== 'n_heron') continue;
      const k = s.world.nodes[e.to];
      if (!k || k.kind === 'stressor') continue;
      predation += e.beta * Math.min(k.population, s.world.nodes.n_heron.population);
    }
    console.assert(predation === 0,
      `ECO FAIL T8: apex node n_heron should have zero predation; got ${predation}`);
    const sGood = makeMock({ heronP:22, shrimpP:300, shrimpL:0, heronL:0 });
    const heronGoodBefore = sGood.world.nodes.n_heron.population;
    stepPopulation('n_heron', sGood);
    console.assert(sGood.world.nodes.n_heron.population >= heronGoodBefore,
      `ECO FAIL T8b: apex node should grow under abundant food`);
  }

  // ── Test 9: Jacobi order-independence ───────────────────────────────────────
  {
    function makeMockOrdered(nodeOrder) {
      const nodeDefs = {
        n_runoff:  { id:'n_runoff',  kind:'stressor',  keystone:false,
                     tileId:'t_runoff',  population:0,   r:0,    K_max:0,   alpha:0,   weight:0,
                     status:'stable', extinction_counter:0, name:'Runoff' },
        n_seagrass:{ id:'n_seagrass',kind:'producer',  keystone:true,
                     tileId:'t_seagrass',population:125, r:0.15, K_max:500, alpha:0.85, weight:2.5,
                     status:'stable', extinction_counter:0, name:'Seagrass' },
        n_shrimp:  { id:'n_shrimp',  kind:'consumer',  keystone:false,
                     tileId:'t_shrimp',  population:81,  r:0.13, K_max:325, alpha:1.5, weight:1.25,
                     status:'stable', extinction_counter:0, name:'Shrimp' },
        n_heron:   { id:'n_heron',   kind:'predator',  keystone:true,
                     tileId:'t_heron',   population:22,  r:0.07, K_max:90,  alpha:2.3, weight:3.5,
                     status:'stable', extinction_counter:0, name:'Painted Stork' }
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
                collapse_timer:COLLAPSE_TIMER, health_streak:0, ecosystem_health:50, market_tier:'Degraded' },
        player: { resources:100, tile_x:4, tile_y:6, scanner_charges:5 },
        world:  { grid:{w:16,h:12}, tiles, nodes, edges, actionsThisStep:{}, activeStressors:[] },
        notebook: { discovered_nodes:[], revealed_edges:[] },
        vendor: { base_prices:{bioremediation:60,rebalancing:45,stabilization:120},
                  price_factor:1.0, available:[] },
        flags: { win:false, lose:false },
        resetDay() { this.world.actionsThisStep = {}; },
        save()     { /* no-op */ }
      };
    }

    const sA = makeMockOrdered(['n_runoff','n_seagrass','n_shrimp','n_heron']);
    const sB = makeMockOrdered(['n_heron','n_shrimp','n_seagrass','n_runoff']);
    runDailyStep(sA);
    runDailyStep(sB);
    console.assert(
      sA.world.nodes.n_seagrass.population === sB.world.nodes.n_seagrass.population &&
      sA.world.nodes.n_shrimp.population   === sB.world.nodes.n_shrimp.population   &&
      sA.world.nodes.n_heron.population    === sB.world.nodes.n_heron.population,
      `ECO FAIL T9: daily step result differs by node order`
    );
  }

  // ── Test 10: runoff propagation — L spreads to neighbours ───────────────────
  {
    const s = makeMock({
      activeStressors: [{ type:'runoff', sourceTileId:'t_runoff', spreadRate: RUNOFF_SPREAD }]
    });
    // Place a tile adjacent to t_runoff (which maps to 't_runoff' alias — not a real grid tile)
    // Use grid tiles instead: source t_2_2, neighbour t_2_3
    s.world.tiles['t_2_2'] = { id:'t_2_2', x:2, y:2, stressor:50, protected:false };
    s.world.tiles['t_2_3'] = { id:'t_2_3', x:2, y:3, stressor:10, protected:false };
    s.world.activeStressors = [{ type:'runoff', sourceTileId:'t_2_2', spreadRate: RUNOFF_SPREAD }];
    const beforeL = s.world.tiles['t_2_3'].stressor;
    processStressors(s);
    const afterL  = s.world.tiles['t_2_3'].stressor;
    console.assert(afterL > beforeL,
      `ECO FAIL T10: runoff should spread L to neighbours; before=${beforeL}, after=${afterL}`);
  }

  // ── Test 11: overharvest drain — target loses population unless protected ────
  {
    const s = makeMock({
      shrimpP: 100,
      activeStressors: [{ type:'overharvest', targetNative:'n_shrimp', harvestDrain: 8 }]
    });
    const before = s.world.nodes.n_shrimp.population;
    processStressors(s);
    console.assert(s.world.nodes.n_shrimp.population < before,
      `ECO FAIL T11: overharvest should drain shrimp population`);

    // Protected tile should block drain
    s.world.nodes.n_shrimp.population = before;
    s.world.tiles['t_shrimp'].protected = true;
    processStressors(s);
    console.assert(s.world.nodes.n_shrimp.population === before,
      `ECO FAIL T11b: protected tile should block overharvest drain`);
  }

  // ── Test 12: applyCull removes CULL_FRAC of population ──────────────────────
  {
    const s = makeMock({ shrimpP: 100 });
    s.world.nodes.n_invasive = { id:'n_invasive', kind:'invasive', keystone:false,
      tileId:'t_shrimp', population:200, r:0.2, K_max:300, alpha:1.2, weight:0,
      status:'stable', extinction_counter:0, name:'Invasive' };
    const before = s.world.nodes.n_invasive.population;
    applyCull('n_invasive', s);
    const after = s.world.nodes.n_invasive.population;
    console.assert(after < before,
      `ECO FAIL T12: cull should reduce invasive population; before=${before}, after=${after}`);
    const removal = before - after;
    console.assert(removal >= Math.floor(CULL_FRAC * before) - 1 &&
                   removal <= Math.ceil(CULL_FRAC * before) + 1,
      `ECO FAIL T12b: cull removal ${removal} outside expected range`);
  }

  console.log('[ecosystem.js] All self-tests passed ✓');
  return true;
}

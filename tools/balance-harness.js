/**
 * tools/balance-harness.js — Phase 2 exit gate for Ecosystem X (Typed Stressors)
 *
 * Node-run, pure logic. No DOM, no rendering, no localStorage.
 * Run with:  node tools/balance-harness.js [--seeds N] [--start S]
 *
 * What it does:
 *   For seeds START .. START+N-1 (default 1..1000):
 *     1. generateWorld(coastal_wetland, seed, mockState)
 *        — records first-seed-valid, rerolls, fallback-to-defaults.
 *     2. Runs a TYPED greedy auto-player (OPTIMAL) that DIAGNOSES activeStressors
 *        and applies the MATCHING counter each day:
 *          • runoff:      bioremediate highest-L tile (source priority)
 *          • invasive:    cull the invasive node
 *          • overharvest: protect the harvested species' tile
 *        Records per-seed: won? day-to-win, stressor combo, any keystone
 *        extinction, NaN/Infinity, |delta|>0.35·P violation.
 *     3. Runs a HANDICAPPED auto-player (§5) — same logic EXCEPT:
 *          (a) DIAGNOSIS_LAG = 3: no useful counter for first 3 days
 *          (b) Every 4th would-be intervention → WRONG-TOOL action instead
 *              (resources spent, no useful effect)
 *     4. Asserts:
 *          • Optimal win-rate = 100%, deterministic, 0 NaN, 0 |Δ|>0.35·P
 *          • Optimal median days 0.30–0.65 × timer per combo
 *          • Handicapped win-rate ≥ 80% overall, ≥ 70% per combo
 *          • No combo's median > 1.6× another's
 *
 * Uniform collapse_timer = 45 for ALL worlds (re-tune §1).
 */

import { fileURLToPath }  from 'url';
import { readFileSync }   from 'fs';
import path               from 'path';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

import { generateWorld }  from '../generator.js';
import { runDailyStep }   from '../ecosystem.js';
import {
  MAX_DELTA_FRAC, COST_BIOREMEDIATION, BIOREM_AMOUNT,
  COST_REBALANCING, COST_STABILIZATION, PROTECT_CAP,
  COLLAPSE_TIMER, DAILY_INCOME, START_RESOURCES, SCANNER_CHARGES,
  CULL_FRAC, TRADEOFF_PREY_SAFE,
} from '../balance.js';

const biomes   = JSON.parse(readFileSync(path.join(projectRoot, 'data/biomes.json'), 'utf8'));
const _biomeArgIdx = process.argv.indexOf('--biome');
const BIOME    = _biomeArgIdx !== -1 && process.argv[_biomeArgIdx + 1] ? process.argv[_biomeArgIdx + 1] : 'coastal_wetland';
const TEMPLATE = biomes[BIOME];
if (!TEMPLATE) { console.error(`Unknown biome: ${BIOME}`); process.exit(1); }
console.log(`\n  Biome: ${BIOME}\n`);

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : def;
};
const SEED_COUNT = argVal('--seeds', 1000);
const SEED_START = argVal('--start', 1);

// ── Balance knobs — sourced from balance.js (single source of truth) ──────
// The harness re-implements the *step logic* as an independent oracle, but the
// tuning *numbers* come from the same file the game ships, so a retune can never
// pass here while shipping different values. Local aliases keep the sim wording.
const BIOREMEDIATION_COST  = COST_BIOREMEDIATION;
const BIOREMEDIATION_L_RED = BIOREM_AMOUNT;
const CULL_COST            = COST_REBALANCING;   // rebalancing/cull slot price
const PROTECT_COST         = COST_STABILIZATION; // stabilization/protect slot price
const COLLAPSE_TIMER_START = TEMPLATE.collapseTimer ?? COLLAPSE_TIMER; // per-biome clock (wetland 45, reef 52)

// ── Handicapped player constants (§5) ─────────────────────────────────────
const DIAGNOSIS_LAG        = 3;    // days before handicapped player acts usefully
const MISTAKE_EVERY        = 4;    // every 4th intervention is wrong-tool

// ─────────────────────────────────────────────────────────────────────────────
// Mock state factory
// ─────────────────────────────────────────────────────────────────────────────
function makeMockState(world) {
  // Uniform timer — no invasive special-case
  return {
    meta: {
      seed:             0,
      biome_template:   'coastal_wetland',
      day_count:        1,
      collapse_timer:   COLLAPSE_TIMER_START,
      health_streak:    0,
      ecosystem_health: 50,
      market_tier:      'Degraded'
    },
    player: {
      resources:       START_RESOURCES,
      tile_x:          0,
      tile_y:          0,
      scanner_charges: SCANNER_CHARGES
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
    save()     { /* no-op — no localStorage in Node */ },
    resetDay() { this.world.actionsThisStep = {}; }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Instrumented daily step — checks NaN/Infinity and |delta|>0.35·P
//
// NOTE on overharvest: processStressors() drains the target node's population
// BEFORE stepPopulation() runs, so the stability clamp inside stepPopulation
// operates on the post-drain population. The harness measures the total
// population change across the full tick; to avoid false-positive delta
// violations we add the overharvest drain back into the allowed cap.
// ─────────────────────────────────────────────────────────────────────────────
function instrumentedStep(state) {
  const before = {};
  for (const [id, n] of Object.entries(state.world.nodes)) {
    before[id] = n.population;
  }

  // Pre-compute overharvest drains for delta cap adjustment
  const harvestDrains = {};
  for (const s of (state.world.activeStressors ?? [])) {
    if (s.type !== 'overharvest') continue;
    const tn = state.world.nodes[s.targetNative];
    if (!tn || tn.status === 'extinct') continue;
    const tile = state.world.tiles[tn.tileId];
    if (tile?.protected) continue;
    harvestDrains[s.targetNative] = (harvestDrains[s.targetNative] ?? 0) + (s.harvestDrain ?? 6);
  }

  runDailyStep(state);

  const issues = { nanFound: false, infinityFound: false, deltaViolation: false };

  for (const [id, n] of Object.entries(state.world.nodes)) {
    if (n.kind === 'stressor') continue;

    const P_after  = n.population;
    const P_before = before[id] ?? 0;

    if (!isFinite(P_after) || isNaN(P_after)) issues.nanFound = true;
    if (!isFinite(state.meta.ecosystem_health) || isNaN(state.meta.ecosystem_health)) {
      issues.nanFound = true;
    }

    const delta = Math.abs(P_after - P_before);
    // Allow for overharvest drain (external removal before stepPopulation)
    const drain = harvestDrains[id] ?? 0;
    const cap   = MAX_DELTA_FRAC * P_before + drain + 1;
    if (P_before > 0 && delta > cap) issues.deltaViolation = true;
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Apply one correct intervention (shared logic for both players)
// Returns true if an action was taken (and resources deducted).
// ─────────────────────────────────────────────────────────────────────────────
function applyCorrectIntervention(state, hasRunoff, invasiveDef, harvestDef, activeStressors) {
  let acted = false;

  // 1. Overharvest: protect the target tile (stops drain permanently)
  if (harvestDef && state.player.resources >= PROTECT_COST) {
    const targetNode = state.world.nodes[harvestDef.targetNative];
    if (targetNode) {
      const tile = state.world.tiles[targetNode.tileId];
      if (tile && !tile.protected) {
        tile.protected = true;
        tile.stressor  = Math.min(tile.stressor ?? 0, PROTECT_CAP);
        state.player.resources -= PROTECT_COST;
        acted = true;
      }
    }
  }

  // 2. Invasive: cull the invasive node — TRADE-OFF-AWARE (#2).
  //    The invasive is also the keystone predator's food, so don't cull it toward
  //    zero while the primary prey (targetNative) is still scarce — that starves
  //    the keystone. Cull freely while the invasive is abundant OR once the prey
  //    has recovered enough to feed the predator alone.
  if (invasiveDef && state.player.resources >= CULL_COST) {
    const inv  = state.world.nodes[invasiveDef.nodeId];
    const prey = state.world.nodes[invasiveDef.targetNative];
    const preyRel = prey && prey.K_max > 0 ? prey.population / prey.K_max : 1;
    // Restore the habitat first: only cull once the predator's prey is healthy,
    // so finishing the invasive off never starves the keystone (trade-off #2).
    const safeToCull = preyRel >= TRADEOFF_PREY_SAFE;
    if (inv && inv.status !== 'extinct' && inv.population > 0 && safeToCull) {
      const removal = Math.ceil(inv.population * CULL_FRAC);
      inv.population = Math.max(0, inv.population - removal);
      state.player.resources -= CULL_COST;
      acted = true;
    }
  }

  // 3. Bioremediate highest-L tile (source priority for runoff)
  if (state.player.resources >= BIOREMEDIATION_COST) {
    let bestTileId = null;
    let bestL      = -Infinity;

    if (hasRunoff) {
      for (const s of activeStressors) {
        if (s.type !== 'runoff') continue;
        const tile = state.world.tiles[s.sourceTileId];
        if (tile && tile.stressor > bestL) {
          bestL      = tile.stressor;
          bestTileId = s.sourceTileId;
        }
      }
    }

    for (const n of Object.values(state.world.nodes)) {
      const tile = state.world.tiles[n.tileId];
      if (tile && tile.stressor > bestL) {
        bestL      = tile.stressor;
        bestTileId = n.tileId;
      }
    }

    if (bestTileId !== null && bestL > 0) {
      state.world.tiles[bestTileId].stressor = Math.max(
        0, state.world.tiles[bestTileId].stressor - BIOREMEDIATION_L_RED
      );
      state.player.resources -= BIOREMEDIATION_COST;
      acted = true;
    }
  }

  // 4. Reintroduce crashed natives (rebalancing slot, ¤CULL_COST)
  if (state.player.resources >= CULL_COST) {
    const bioNodes = Object.values(state.world.nodes)
      .filter(n => n.kind !== 'stressor' && n.kind !== 'invasive' && n.status !== 'extinct')
      .sort((a, b) => (a.population / a.K_max) - (b.population / b.K_max));
    const reintroTarget = bioNodes.find(n => {
      const tileL = state.world.tiles[n.tileId]?.stressor ?? 100;
      return n.K_max > 0 && n.population < 0.15 * n.K_max && tileL < 40;
    });
    if (reintroTarget) {
      reintroTarget.population = Math.round(0.20 * reintroTarget.K_max);
      reintroTarget.extinction_counter = 0;
      if (reintroTarget.status !== 'stable') reintroTarget.status = 'stable';
      state.player.resources -= CULL_COST;
      acted = true;
    }
  }

  return acted;
}

// Apply a WRONG-TOOL action: spends resources, no useful ecological effect.
// Uses the cheapest available intervention cost as the waste amount.
function applyWrongTool(state, hasRunoff, invasiveDef, harvestDef) {
  // Wrong tool: apply the counter for a stressor that is NOT active, or
  // bioremediate a clean tile (no runoff world → bioremediate a tile that's
  // already near-zero), costing BIOREMEDIATION_COST.
  if (state.player.resources >= BIOREMEDIATION_COST) {
    // Find the lowest-L node tile (likely near zero — wasteful but spends money)
    let lowestL    = Infinity;
    let lowestTile = null;
    for (const n of Object.values(state.world.nodes)) {
      const tile = state.world.tiles[n.tileId];
      if (tile && tile.stressor < lowestL) {
        lowestL    = tile.stressor;
        lowestTile = tile;
      }
    }
    if (lowestTile !== null) {
      // Spend resources but apply to a tile that's already low (negligible benefit)
      lowestTile.stressor = Math.max(0, lowestTile.stressor - BIOREMEDIATION_L_RED);
      state.player.resources -= BIOREMEDIATION_COST;
      return true;
    }
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// OPTIMAL greedy auto-player
// ─────────────────────────────────────────────────────────────────────────────
function runGreedyPlayer(world) {
  const state = makeMockState(world);
  const maxDays = state.meta.collapse_timer;

  const activeStressors = world.activeStressors ?? [];
  const hasRunoff    = activeStressors.some(s => s.type === 'runoff');
  const invasiveDef  = activeStressors.find(s => s.type === 'invasive');
  const harvestDef   = activeStressors.find(s => s.type === 'overharvest');

  const comboLabel = activeStressors.map(s => s.type).sort().join('+') || 'none';

  let wonDay          = null;
  let nanFound        = false;
  let deltaViolation  = false;
  let keystoneExtinct = false;

  for (let day = 0; day < maxDays; day++) {
    applyCorrectIntervention(state, hasRunoff, invasiveDef, harvestDef, activeStressors);

    const issues = instrumentedStep(state);
    if (issues.nanFound || issues.infinityFound) nanFound       = true;
    if (issues.deltaViolation)                   deltaViolation = true;

    for (const n of Object.values(state.world.nodes)) {
      if (n.keystone && n.status === 'extinct') keystoneExtinct = true;
    }

    if (state.flags.win) {
      wonDay = state.meta.day_count - 1;
      break;
    }
    if (state.flags.lose) break;
  }

  return {
    won:            state.flags.win,
    wonDay,
    finalH:         state.meta.ecosystem_health,
    healthStreak:   state.meta.health_streak,
    nanFound,
    deltaViolation,
    keystoneExtinct,
    comboLabel,
    lostReason:     state.flags.lose && !state.flags.win
      ? (keystoneExtinct ? 'keystone_extinct' : 'timer_expired')
      : null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDICAPPED auto-player (§5)
//   (a) DIAGNOSIS_LAG = 3: no useful action for first 3 days
//   (b) Every 4th would-be intervention: apply wrong tool instead
//   Deterministic: no RNG — lag and mistake pattern are fixed offsets.
// ─────────────────────────────────────────────────────────────────────────────
function runHandicappedPlayer(world) {
  const state = makeMockState(world);
  const maxDays = state.meta.collapse_timer;

  const activeStressors = world.activeStressors ?? [];
  const hasRunoff    = activeStressors.some(s => s.type === 'runoff');
  const invasiveDef  = activeStressors.find(s => s.type === 'invasive');
  const harvestDef   = activeStressors.find(s => s.type === 'overharvest');

  const comboLabel = activeStressors.map(s => s.type).sort().join('+') || 'none';

  let wonDay          = null;
  let keystoneExtinct = false;
  let interventionCount = 0; // counts intended interventions (for mistake cadence)

  for (let day = 0; day < maxDays; day++) {
    if (day >= DIAGNOSIS_LAG) {
      // Count this as an intervention attempt
      interventionCount++;

      if (interventionCount % MISTAKE_EVERY === 0) {
        // Wrong-tool intervention: waste resources on mismatched action
        applyWrongTool(state, hasRunoff, invasiveDef, harvestDef);
      } else {
        // Correct intervention
        applyCorrectIntervention(state, hasRunoff, invasiveDef, harvestDef, activeStressors);
      }
    }
    // Days 0..DIAGNOSIS_LAG-1: observe only, no action (resources accumulate)

    runDailyStep(state);

    for (const n of Object.values(state.world.nodes)) {
      if (n.keystone && n.status === 'extinct') keystoneExtinct = true;
    }

    if (state.flags.win) {
      wonDay = state.meta.day_count - 1;
      break;
    }
    if (state.flags.lose) break;
  }

  return {
    won:            state.flags.win,
    wonDay,
    finalH:         state.meta.ecosystem_health,
    comboLabel,
    keystoneExtinct,
    lostReason:     state.flags.lose && !state.flags.win
      ? (keystoneExtinct ? 'keystone_extinct' : 'timer_expired')
      : null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation wrapper
// ─────────────────────────────────────────────────────────────────────────────
function generateForSeed(seed) {
  let usedDefaults = false;
  const origWarn = console.warn;
  console.warn = (...a) => {
    if (String(a[0]).includes('Loading guaranteed-valid template defaults')) usedDefaults = true;
  };

  let rerolls = 0;
  const origDebug = console.debug;
  console.debug = (...a) => {
    if (String(a[0]).includes('failed validation')) rerolls++;
  };

  const mockState = {
    meta: {
      seed: 0, biome_template: 'coastal_wetland', day_count: 1,
      collapse_timer: COLLAPSE_TIMER_START, health_streak: 0,
      ecosystem_health: 50, market_tier: 'Degraded'
    },
    player: { resources: START_RESOURCES, tile_x: 0, tile_y: 0, scanner_charges: SCANNER_CHARGES },
    world:  { grid:{w:16,h:12}, tiles:{}, nodes:{}, edges:[], actionsThisStep:{}, activeStressors:[] },
    notebook: { discovered_nodes:[], revealed_edges:[] },
    vendor: { base_prices:{bioremediation:BIOREMEDIATION_COST,rebalancing:CULL_COST,stabilization:PROTECT_COST},
              price_factor:1.0, available:[] },
    flags: { win:false, lose:false },
    save()     { /* no-op */ },
    resetDay() { this.world.actionsThisStep = {}; }
  };

  generateWorld(TEMPLATE, seed, mockState);

  console.warn  = origWarn;
  console.debug = origDebug;

  return {
    world:        mockState.world,
    acceptedSeed: mockState.meta.seed,
    rerolls,
    usedDefaults
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Determinism check — run the same seed twice and compare final state
// ─────────────────────────────────────────────────────────────────────────────
function checkDeterminism(seed) {
  const r1 = generateForSeed(seed);
  const r2 = generateForSeed(seed);

  const s1 = makeMockState(r1.world);
  const s2 = makeMockState(r2.world);

  const DAYS = 5;
  for (let d = 0; d < DAYS; d++) {
    for (const s of [s1, s2]) {
      const activeStressors = s.world.activeStressors ?? [];
      const invasiveDef = activeStressors.find(a => a.type === 'invasive');
      const harvestDef  = activeStressors.find(a => a.type === 'overharvest');
      const hasRunoff   = activeStressors.some(a => a.type === 'runoff');
      applyCorrectIntervention(s, hasRunoff, invasiveDef, harvestDef, activeStressors);
      runDailyStep(s);
    }
  }

  const snap = (s) => JSON.stringify({
    nodes: Object.fromEntries(Object.entries(s.world.nodes).map(([k,v]) => [k, {p:v.population, s:v.status}])),
    health: s.meta.ecosystem_health
  });

  return snap(s1) === snap(s2);
}

// ─────────────────────────────────────────────────────────────────────────────
// Knob advisor
// ─────────────────────────────────────────────────────────────────────────────
function advisorMessage(stats) {
  const lines = [];

  if (stats.fallbackCount > 0) {
    const pct = ((stats.fallbackCount / SEED_COUNT) * 100).toFixed(1);
    lines.push(`\n⚠  FALLBACK RATE: ${pct}% (${stats.fallbackCount}/${SEED_COUNT} seeds used template defaults)`);
  }

  if (stats.totalLosses > 0) {
    const pct = ((stats.totalLosses / SEED_COUNT) * 100).toFixed(1);
    lines.push(`\n❌  OPTIMAL WIN-RATE: ${((1 - stats.totalLosses / SEED_COUNT) * 100).toFixed(1)}%  (${stats.totalLosses} seeds unwinnable)`);
    if (stats.lossReasons.timer_expired > 0) {
      lines.push(`   ${stats.lossReasons.timer_expired} timer-expired:`);
      lines.push('     • Raise DAILY_INCOME or collapse_timer');
      lines.push('     • Lower invasive β or harvestDrain');
      lines.push('     • Raise native r bands');
    }
    if (stats.lossReasons.keystone_extinct > 0) {
      lines.push(`   ${stats.lossReasons.keystone_extinct} keystone-extinction:`);
      lines.push('     • Reduce STARVE_RATE');
      lines.push('     • Raise start.populationFrac lower bound');
      lines.push('     • Reduce invasive β band');
    }
  }

  // Per-combo advisor
  for (const [combo, cs] of Object.entries(stats.comboStats)) {
    if (cs.losses > 0) {
      lines.push(`\n  ⚠  Combo "${combo}": ${cs.losses} optimal losses out of ${cs.total}`);
    }
    if (cs.wins > 0) {
      const ratio = cs.medianDays / COLLAPSE_TIMER_START;
      if (ratio > 0.65) {
        lines.push(`  🟡 Combo "${combo}": median ${cs.medianDays}d = ${(ratio*100).toFixed(0)}% of timer (>65% — too grindy)`);
        lines.push('     • Raise native r or lower invasive β');
      }
      if (ratio < 0.30) {
        lines.push(`  🟡 Combo "${combo}": median ${cs.medianDays}d = ${(ratio*100).toFixed(0)}% of timer (<30% — too trivial)`);
        lines.push('     • Raise start.stressor or invasive β');
      }
    }
    if (cs.handicappedWinRate !== undefined && cs.handicappedWinRate < 70) {
      lines.push(`  ❌  Combo "${combo}": handicapped win-rate ${cs.handicappedWinRate.toFixed(1)}% < 70% threshold`);
      lines.push('     • Raise native r, reduce stressor bands, or reduce β');
    }
  }

  const overallHandicapRate = stats.handicappedWinRate;
  if (overallHandicapRate !== undefined && overallHandicapRate < 80) {
    lines.push(`\n❌  HANDICAPPED WIN-RATE: ${overallHandicapRate.toFixed(1)}% < 80% threshold`);
    lines.push('     • Raise native r bands (primary lever)');
    lines.push('     • Lower STARVE_RATE');
    lines.push('     • Lower invasive β');
  }

  if (stats.pacingRatio > 1.6) {
    lines.push(`\n🟡  PACING INCONSISTENCY: fastest/slowest combo ratio = ${stats.pacingRatio.toFixed(2)} > 1.6`);
    lines.push('     • Tune combos toward similar median days');
  }

  if (stats.nanCount > 0) {
    lines.push(`\n🔴  NaN/Infinity in ${stats.nanCount} seeds — check getCarryingCapacity K=0 guard`);
  }
  if (stats.deltaViolationCount > 0) {
    lines.push(`\n🔴  |delta|>0.35·P in ${stats.deltaViolationCount} seeds — check stepPopulation clamp`);
  }
  if (stats.determinismFailed) {
    lines.push('\n🔴  DETERMINISM FAILURE — search for Math.random() or unsorted iteration');
  }

  return lines.length ? lines.join('\n') : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Percentile helper
// ─────────────────────────────────────────────────────────────────────────────
function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[idx];
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — sweep
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'═'.repeat(72)}`);
console.log(`  Ecosystem X — Balance Harness  (Re-tune §1-5)`);
console.log(`  Seeds ${SEED_START}..${SEED_START + SEED_COUNT - 1}  (${SEED_COUNT} seeds)  |  collapse_timer=${COLLAPSE_TIMER_START} (uniform)`);
console.log(`${'═'.repeat(72)}\n`);

const PROGRESS_INTERVAL = Math.max(1, Math.floor(SEED_COUNT / 20));
const results = [];
let determinismFailed = false;
const DET_CHECK_SEEDS = 5;

for (let i = 0; i < SEED_COUNT; i++) {
  const seed = SEED_START + i;

  if (i % PROGRESS_INTERVAL === 0) {
    const pct = ((i / SEED_COUNT) * 100).toFixed(0).padStart(3);
    process.stdout.write(`\r  Progress: ${pct}%  [seed ${seed}]   `);
  }

  const gen = generateForSeed(seed);

  if (i < DET_CHECK_SEEDS) {
    const det = checkDeterminism(seed);
    if (!det) {
      determinismFailed = true;
      console.error(`\n  ❌ DETERMINISM FAIL at seed ${seed}`);
    }
  }

  const optPlay  = runGreedyPlayer(gen.world);
  const handicap = runHandicappedPlayer(gen.world);

  results.push({
    seed,
    rerolls:      gen.rerolls,
    usedDefaults: gen.usedDefaults,
    firstValid:   gen.rerolls === 0 && !gen.usedDefaults,
    // optimal player
    ...optPlay,
    // handicapped player
    handicapWon:     handicap.won,
    handicapWonDay:  handicap.wonDay,
    handicapCombo:   handicap.comboLabel
  });
}

process.stdout.write('\r  Progress: 100%                    \n\n');

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate statistics — OPTIMAL
// ─────────────────────────────────────────────────────────────────────────────
const wins           = results.filter(r => r.won);
const losses         = results.filter(r => !r.won);
const firstValidSeeds= results.filter(r => r.firstValid);
const fallbackSeeds  = results.filter(r => r.usedDefaults);
const nanSeeds       = results.filter(r => r.nanFound);
const deltaSeeds     = results.filter(r => r.deltaViolation);
const ksExtSeeds     = results.filter(r => r.keystoneExtinct);

const wonDays = wins.map(r => r.wonDay).filter(d => d != null).sort((a,b) => a-b);
const finalHs = wins.map(r => r.finalH).sort((a,b) => a-b);
const lossHs  = losses.map(r => r.finalH).sort((a,b) => a-b);

const lossReasons = { timer_expired: 0, keystone_extinct: 0 };
for (const r of losses) {
  if (r.lostReason) lossReasons[r.lostReason] = (lossReasons[r.lostReason] ?? 0) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate statistics — HANDICAPPED
// ─────────────────────────────────────────────────────────────────────────────
const handicapWins   = results.filter(r => r.handicapWon);
const handicapLosses = results.filter(r => !r.handicapWon);
const handicapWinRate= (handicapWins.length / SEED_COUNT * 100);

// ─────────────────────────────────────────────────────────────────────────────
// Per-stressor-combo stats (OPTIMAL + HANDICAPPED)
// ─────────────────────────────────────────────────────────────────────────────
const comboStats = {};
for (const r of results) {
  const c = r.comboLabel;
  if (!comboStats[c]) comboStats[c] = { wins:0, losses:0, total:0, days:[], hWins:0, hLosses:0, hTotal:0, hDays:[] };
  comboStats[c].total++;
  if (r.won) { comboStats[c].wins++; if (r.wonDay!=null) comboStats[c].days.push(r.wonDay); }
  else       comboStats[c].losses++;
  // handicapped
  comboStats[c].hTotal++;
  if (r.handicapWon) { comboStats[c].hWins++; if (r.handicapWonDay!=null) comboStats[c].hDays.push(r.handicapWonDay); }
  else               comboStats[c].hLosses++;
}
for (const c of Object.values(comboStats)) {
  c.days.sort((a,b)=>a-b);
  c.hDays.sort((a,b)=>a-b);
  c.medianDays          = percentile(c.days, 50);
  c.winRate             = ((c.wins / c.total) * 100).toFixed(1);
  c.handicappedMedian   = percentile(c.hDays, 50);
  c.handicappedWinRate  = (c.hWins / c.hTotal) * 100;
}

// Pacing ratio: max/min of combo median days
const allMedians = Object.values(comboStats).map(c=>c.medianDays).filter(d=>!isNaN(d));
const pacingRatio = allMedians.length >= 2
  ? (Math.max(...allMedians) / Math.min(...allMedians))
  : 1;

const winRate        = (wins.length / SEED_COUNT * 100).toFixed(2);
const firstValidRate = (firstValidSeeds.length / SEED_COUNT * 100).toFixed(2);
const fallbackRate   = (fallbackSeeds.length / SEED_COUNT * 100).toFixed(2);
const medianDays     = percentile(wonDays, 50);
const p10Days        = percentile(wonDays, 10);
const p90Days        = percentile(wonDays, 90);
const minDays        = wonDays[0] ?? 'N/A';
const maxDays2       = wonDays[wonDays.length-1] ?? 'N/A';
const minH           = wins.length ? finalHs[0].toFixed(1)               : 'N/A';
const maxH           = wins.length ? finalHs[finalHs.length-1].toFixed(1): 'N/A';
const minLossH       = losses.length ? lossHs[0].toFixed(1)              : 'N/A';
const maxLossH       = losses.length ? lossHs[lossHs.length-1].toFixed(1): 'N/A';

// ─────────────────────────────────────────────────────────────────────────────
// Print summary table
// ─────────────────────────────────────────────────────────────────────────────
const W  = 48;
const row = (label, value, flag='') =>
  `  │ ${label.padEnd(28)} │ ${String(value).padStart(12)} ${flag.padEnd(4)}│`;

const medRatio = medianDays / COLLAPSE_TIMER_START;
const medFlag = isNaN(medRatio) ? '' : (medRatio >= 0.30 && medRatio <= 0.65 ? '✓' : '🟡');

console.log(`  ┌${'─'.repeat(W)}┐`);
console.log(`  │${'  OPTIMAL PLAYER  (uniform timer=' + COLLAPSE_TIMER_START + ')'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
console.log(row('Seeds tested',           SEED_COUNT));
console.log(row('Win-rate',               `${winRate}%`,          wins.length === SEED_COUNT ? '✓' : '❌'));
console.log(row('First-seed valid rate',  `${firstValidRate}%`,   firstValidSeeds.length === SEED_COUNT ? '✓' : ''));
console.log(row('Defaults fallback rate', `${fallbackRate}%`,     fallbackSeeds.length === 0 ? '✓' : '⚠'));
console.log(row('Losses (timer expired)', lossReasons.timer_expired));
console.log(row('Losses (ks. extinct)',   lossReasons.keystone_extinct));
console.log(row('Keystone extinctions',   ksExtSeeds.length));
console.log(row('NaN / Infinity seeds',   nanSeeds.length,        nanSeeds.length === 0 ? '✓' : '🔴'));
console.log(row('|Δ|>0.35·P violations', deltaSeeds.length,      deltaSeeds.length === 0 ? '✓' : '🔴'));
console.log(row('Determinism OK',         determinismFailed ? 'FAIL' : 'pass', determinismFailed ? '🔴' : '✓'));
console.log(`  ├${'─'.repeat(28)}┴${'─'.repeat(18)}┤`);
console.log(`  │${'  OPTIMAL — DAYS TO WIN'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
console.log(row('Median days to win',     wonDays.length ? medianDays : 'N/A', medFlag));
console.log(row('  (target: 0.30–0.65×timer)', `[${Math.round(COLLAPSE_TIMER_START*0.30)}–${Math.round(COLLAPSE_TIMER_START*0.65)}]`));
console.log(row('p10 / p90',             wonDays.length ? `${p10Days} / ${p90Days}` : 'N/A'));
console.log(row('Min / Max days',         wonDays.length ? `${minDays} / ${maxDays2}` : 'N/A'));
console.log(row('Pacing ratio (max/min)', isNaN(pacingRatio) ? 'N/A' : pacingRatio.toFixed(2),
  pacingRatio <= 1.6 ? '✓' : '🟡'));
console.log(`  ├${'─'.repeat(28)}┴${'─'.repeat(18)}┤`);
console.log(`  │${'  FINAL HEALTH'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
console.log(row('Min / Max H (wins)',     `${minH} / ${maxH}`));
console.log(row('Min / Max H (losses)',   `${minLossH} / ${maxLossH}`));
console.log(`  ├${'─'.repeat(28)}┴${'─'.repeat(18)}┤`);
console.log(`  │${'  HANDICAPPED PLAYER  (lag=3, mistake every 4)'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
console.log(row('Handicapped win-rate',  `${handicapWinRate.toFixed(1)}%`,
  handicapWinRate >= 80 ? '✓' : '❌'));
console.log(row('  (target: ≥80% overall)', ''));
console.log(`  ├${'─'.repeat(28)}┴${'─'.repeat(18)}┤`);
console.log(`  │${'  PER-COMBO: OPTIMAL + HANDICAPPED'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
for (const [combo, cs] of Object.entries(comboStats).sort(([a],[b])=>a<b?-1:1)) {
  const optFlag   = cs.losses === 0 ? '✓' : '❌';
  const hRate     = cs.handicappedWinRate;
  const hFlag     = hRate >= 70 ? '✓' : '❌';
  const ratio     = isNaN(cs.medianDays) ? '?' : (cs.medianDays / COLLAPSE_TIMER_START).toFixed(2);
  const ratioFlag = !isNaN(cs.medianDays) && cs.medianDays/COLLAPSE_TIMER_START >= 0.30 && cs.medianDays/COLLAPSE_TIMER_START <= 0.65 ? '✓' : '🟡';
  console.log(row(`  ${combo} (n=${cs.total})`, `${cs.winRate}%`, optFlag));
  console.log(row(`    opt-median (×timer)`, cs.days.length ? `${cs.medianDays}d (${ratio}×)` : 'N/A', ratioFlag));
  console.log(row(`    handicap win-rate`,   `${hRate.toFixed(1)}%`, hFlag));
  console.log(row(`    handicap median`,     cs.hDays.length ? `${cs.handicappedMedian}d` : 'N/A'));
}
console.log(`  └${'─'.repeat(28)}┴${'─'.repeat(18)}┘`);

// ── Failure details ────────────────────────────────────────────────────────
if (losses.length > 0) {
  console.log('\n  ── Optimal unwinnable seeds (first 20) ─────────────────────────────────');
  for (const r of losses.slice(0, 20)) {
    console.log(
      `     seed=${r.seed}  H=${r.finalH.toFixed(1).padStart(5)}  ` +
      `streak=${r.healthStreak}  combo=${r.comboLabel}  reason=${r.lostReason ?? 'unknown'}  ` +
      `defaults=${r.usedDefaults}  rerolls=${r.rerolls}`
    );
  }
}

if (nanSeeds.length > 0) {
  console.log('\n  ── NaN / Infinity seeds ──────────────────────────────────────────────');
  for (const r of nanSeeds.slice(0, 10)) console.log(`     seed=${r.seed}`);
}

if (deltaSeeds.length > 0) {
  console.log('\n  ── Stability-clamp violation seeds ───────────────────────────────────');
  for (const r of deltaSeeds.slice(0, 10)) console.log(`     seed=${r.seed}`);
}

// ── Knob advisor ───────────────────────────────────────────────────────────
const advice = advisorMessage({
  fallbackCount:       fallbackSeeds.length,
  totalLosses:         losses.length,
  lossReasons,
  comboStats,
  medianDaysToWin:     medianDays,
  nanCount:            nanSeeds.length,
  deltaViolationCount: deltaSeeds.length,
  determinismFailed,
  handicappedWinRate:  handicapWinRate,
  pacingRatio
});

if (advice) {
  console.log('\n' + '─'.repeat(72));
  console.log('  KNOB ADVISOR');
  console.log('─'.repeat(72));
  console.log(advice);
}

// ── Final assertions ──────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(72));

// Check per-combo median ratio
const comboBadRatio = Object.entries(comboStats).filter(([,cs]) =>
  cs.wins > 0 && (cs.medianDays / COLLAPSE_TIMER_START < 0.30 || cs.medianDays / COLLAPSE_TIMER_START > 0.65)
);
const comboBadHandicap = Object.entries(comboStats).filter(([,cs]) => cs.handicappedWinRate < 70);

const allGood = wins.length === SEED_COUNT &&
                !determinismFailed &&
                nanSeeds.length === 0 &&
                deltaSeeds.length === 0 &&
                handicapWinRate >= 80 &&
                comboBadHandicap.length === 0 &&
                comboBadRatio.length === 0 &&
                pacingRatio <= 1.6;

if (allGood) {
  console.log('  ✅  ALL GATES PASSED');
  console.log('      • Optimal: 100% winnable, deterministic, 0 NaN, 0 Δ-violation');
  console.log(`      • Pacing: all combo medians in [0.30–0.65]×${COLLAPSE_TIMER_START}d, ratio ≤ 1.6`);
  console.log(`      • Handicapped: ≥80% overall, ≥70% per combo`);
  console.log('      Proceed to Phase 3 (systems & AI content).\n');
  process.exit(0);
} else {
  const failMsgs = [];
  if (wins.length < SEED_COUNT)       failMsgs.push(`optimal win-rate ${winRate}% < 100%`);
  if (nanSeeds.length > 0)            failMsgs.push(`${nanSeeds.length} NaN/Infinity seeds`);
  if (deltaSeeds.length > 0)          failMsgs.push(`${deltaSeeds.length} clamp-violation seeds`);
  if (determinismFailed)              failMsgs.push('determinism failure');
  if (handicapWinRate < 80)           failMsgs.push(`handicapped win-rate ${handicapWinRate.toFixed(1)}% < 80%`);
  if (comboBadHandicap.length > 0)    failMsgs.push(`combos below 70% handicap: ${comboBadHandicap.map(([c])=>c).join(', ')}`);
  if (comboBadRatio.length > 0)       failMsgs.push(`combos outside [0.30–0.65] window: ${comboBadRatio.map(([c,cs])=>`${c}=${cs.medianDays}d`).join(', ')}`);
  if (pacingRatio > 1.6)              failMsgs.push(`pacing ratio ${pacingRatio.toFixed(2)} > 1.6`);
  console.log(`  ❌  GATES FAILED: ${failMsgs.join('; ')}`);
  console.log('      See KNOB ADVISOR above for remediation steps.\n');
  process.exit(1);
}

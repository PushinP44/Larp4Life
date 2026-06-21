/**
 * tools/balance-harness.js — Phase 1 exit gate for Ecosystem X
 *
 * Node-run, pure logic. No DOM, no rendering, no localStorage.
 * Run with:  node tools/balance-harness.js [--seeds N] [--start S]
 *
 * What it does:
 *   For seeds START .. START+N-1 (default 1..1000):
 *     1. generateWorld(coastal_wetland, seed, mockState)
 *        — records first-seed-valid and fallback-to-defaults flags.
 *     2. Runs a greedy auto-player (same strategy as validator's checkSolvable,
 *        but against the LIVE world so it reflects real gameplay exactly):
 *        each day pick the highest-stressor tile across ALL nodes → bioremediate
 *        (L−40, cost 120) if resources allow → runDailyStep.
 *     3. Records: won? day-to-win, final H, any keystone extinction,
 *        any NaN/Infinity, any |delta|>0.35·P violation.
 *     4. Asserts 100% winnable; asserts determinism (seed run twice).
 *
 * Prints a summary table and — if win-rate < 100% or fallback > 0% — tells
 * you exactly which knob to move and in which direction.
 */

// ── Resolve project root so imports work from any cwd ─────────────────────
import { createRequire } from 'module';
import { fileURLToPath }  from 'url';
import { readFileSync }   from 'fs';
import path               from 'path';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ── ES-module imports from project root ────────────────────────────────────
import { generateWorld }  from '../generator.js';
import { runDailyStep, getCarryingCapacity } from '../ecosystem.js';

// ── Load biomes.json synchronously (no fetch in Node) ─────────────────────
const biomes   = JSON.parse(readFileSync(path.join(projectRoot, 'data/biomes.json'), 'utf8'));
const TEMPLATE = biomes.coastal_wetland;

// ── CLI args ───────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const argVal = (flag, def) => {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? Number(args[i + 1]) : def;
};
const SEED_COUNT = argVal('--seeds', 1000);
const SEED_START = argVal('--start', 1);

// ── Balance knobs (mirrored from ecosystem.js / state.js for delta-violation check) ──
const MAX_DELTA_FRAC       = 0.35;
const BIOREMEDIATION_COST  = 60;   // mirrors state.js base_prices.bioremediation (re-tuned 80→60)
const BIOREMEDIATION_L_RED = 50;   // re-tuned 40→50 per difficulty re-tune
const COLLAPSE_TIMER_START = 40;   // re-tuned 30→40 for humane margin
const DAILY_INCOME         = 55;   // mirrors ecosystem.js DAILY_INCOME (re-tuned 40→55)

// ─────────────────────────────────────────────────────────────────────────────
// Mock state factory
// No localStorage. save() / resetDay() are no-ops structurally matching
// state.js so runDailyStep works without modification.
// ─────────────────────────────────────────────────────────────────────────────
function makeMockState(world) {
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
      resources:       100,
      tile_x:          0,
      tile_y:          0,
      scanner_charges: 5
    },
    world:    JSON.parse(JSON.stringify(world)),
    notebook: { discovered_nodes: [], revealed_edges: [] },
    vendor: {
      base_prices:  { bioremediation: BIOREMEDIATION_COST, rebalancing: 90, stabilization: 150 }, // BIOREMEDIATION_COST=60
      price_factor: 1.0,
      available:    ['bioremediation', 'rebalancing', 'stabilization']
    },
    flags: { win: false, lose: false },
    save()     { /* no-op — no localStorage in Node */ },
    resetDay() { this.world.actionsThisStep = {}; }
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Instrumented daily step
// Wraps runDailyStep and checks for NaN/Infinity and |delta|>0.35·P violations.
// Returns { nanFound, deltaViolation } flags.
// ─────────────────────────────────────────────────────────────────────────────
function instrumentedStep(state) {
  // Snapshot populations before the step.
  const before = {};
  for (const [id, n] of Object.entries(state.world.nodes)) {
    before[id] = n.population;
  }

  runDailyStep(state);

  const issues = { nanFound: false, infinityFound: false, deltaViolation: false };

  for (const [id, n] of Object.entries(state.world.nodes)) {
    if (n.kind === 'stressor') continue;

    const P_after = n.population;
    const P_before = before[id] ?? 0;

    if (!isFinite(P_after) || isNaN(P_after)) {
      issues.nanFound = true;
    }
    if (!isFinite(state.meta.ecosystem_health) || isNaN(state.meta.ecosystem_health)) {
      issues.nanFound = true;
    }

    const delta = Math.abs(P_after - P_before);
    const cap   = MAX_DELTA_FRAC * P_before + 1; // +1 for Math.round tolerance
    if (P_before > 0 && delta > cap) {
      issues.deltaViolation = true;
    }
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Greedy auto-player
// Mirrors checkSolvable in validator.js — picks the highest-stressor tile
// among ALL node tiles (including stressor source) and bioremediates it.
// Returns the per-seed result record.
// ─────────────────────────────────────────────────────────────────────────────
function runGreedyPlayer(world) {
  const state = makeMockState(world);
  const maxDays = COLLAPSE_TIMER_START;

  let wonDay          = null;
  let nanFound        = false;
  let infinityFound   = false;
  let deltaViolation  = false;
  let keystoneExtinct = false;

  for (let day = 0; day < maxDays; day++) {
    // Greedy intervention: bioremediate the highest-L tile (ALL nodes)
    if (state.player.resources >= BIOREMEDIATION_COST) {
      let bestTileId = null;
      let bestL      = -Infinity;
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
      }
    }

    const issues = instrumentedStep(state);
    if (issues.nanFound      || issues.infinityFound) nanFound       = true;
    if (issues.deltaViolation)                         deltaViolation = true;

    // Check keystone extinction
    for (const n of Object.values(state.world.nodes)) {
      if (n.keystone && n.status === 'extinct') keystoneExtinct = true;
    }

    if (state.flags.win) {
      wonDay = state.meta.day_count - 1; // day_count was already incremented
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
    infinityFound,
    deltaViolation,
    keystoneExtinct,
    lostReason:     state.flags.lose && !state.flags.win
      ? (keystoneExtinct ? 'keystone_extinct' : 'timer_expired')
      : null
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generation wrapper — calls generateWorld into a fresh mock state,
// captures whether the first seed was accepted or a reroll happened,
// and whether it fell back to defaults.
// ─────────────────────────────────────────────────────────────────────────────
function generateForSeed(seed) {
  // Intercept console.warn to detect defaults fallback
  let usedDefaults = false;
  const origWarn = console.warn;
  console.warn = (...a) => {
    if (String(a[0]).includes('Loading guaranteed-valid template defaults')) {
      usedDefaults = true;
    }
    // Suppress — don't clutter harness output
  };

  // Intercept console.debug to count rerolls
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
    player: { resources: 100, tile_x: 0, tile_y: 0, scanner_charges: 5 },
    world:  { grid:{w:16,h:12}, tiles:{}, nodes:{}, edges:[], actionsThisStep:{} },
    notebook: { discovered_nodes:[], revealed_edges:[] },
    vendor: { base_prices:{bioremediation:BIOREMEDIATION_COST,rebalancing:90,stabilization:150},
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

  // Run 5 greedy days on each
  const DAYS = 5;
  for (let d = 0; d < DAYS; d++) {
    // Apply same greedy intervention
    for (const s of [s1, s2]) {
      if (s.player.resources >= BIOREMEDIATION_COST) {
        let bestTileId = null, bestL = -Infinity;
        for (const n of Object.values(s.world.nodes)) {
          const tile = s.world.tiles[n.tileId];
          if (tile && tile.stressor > bestL) { bestL = tile.stressor; bestTileId = n.tileId; }
        }
        if (bestTileId && bestL > 0) {
          s.world.tiles[bestTileId].stressor = Math.max(0, s.world.tiles[bestTileId].stressor - BIOREMEDIATION_L_RED);
          s.player.resources -= BIOREMEDIATION_COST;
        }
      }
      runDailyStep(s);
    }
  }

  const snap1 = JSON.stringify({
    nodes: Object.fromEntries(Object.entries(s1.world.nodes).map(([k,v]) => [k, {p:v.population, s:v.status}])),
    health: s1.meta.ecosystem_health
  });
  const snap2 = JSON.stringify({
    nodes: Object.fromEntries(Object.entries(s2.world.nodes).map(([k,v]) => [k, {p:v.population, s:v.status}])),
    health: s2.meta.ecosystem_health
  });

  return snap1 === snap2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Knob advisor — called if win-rate < 100% or fallback > 0%
// ─────────────────────────────────────────────────────────────────────────────
function advisorMessage(stats) {
  const lines = [];

  if (stats.fallbackCount > 0) {
    const pct = ((stats.fallbackCount / SEED_COUNT) * 100).toFixed(1);
    lines.push(`\n⚠  FALLBACK RATE: ${pct}% (${stats.fallbackCount}/${SEED_COUNT} seeds used template defaults)`);
    lines.push('   Root cause: the solvability gate in checkSolvable is over-rejecting procedural worlds.');
    lines.push('   Knob candidates (move ONE at a time, re-run harness):');
    lines.push('     • Increase collapse_timer 30 → 35 in template defaults / mockState init');
    lines.push('     • Raise DAILY_INCOME 30 → 40  (more resources → greedy player can afford more remediations)');
    lines.push('     • Lower bioremediation cost 120 → 100  (same effect)');
    lines.push('     • Raise bioremediation L-reduction 40 → 50  (faster stressor removal per application)');
    lines.push('     • Lower start.stressor band [70,90] → [60,80]  (less initial pressure on solvability check)');
    lines.push('     • Lower start.populationFrac [0.15,0.40] → [0.25,0.45]  (healthier start populations)');
  }

  if (stats.totalLosses > 0) {
    const pct = ((stats.totalLosses / SEED_COUNT) * 100).toFixed(1);
    lines.push(`\n❌  WIN-RATE: ${((1 - stats.totalLosses / SEED_COUNT) * 100).toFixed(1)}%  (${stats.totalLosses} seeds unwinnable)`);

    if (stats.lossReasons.timer_expired > 0) {
      lines.push(`   ${stats.lossReasons.timer_expired} seeds lost to TIMER EXPIRY → game too hard:`);
      lines.push('     Knob candidates:');
      lines.push('       • DAILY_INCOME 30 → 40  (afford more actions per run)');
      lines.push('       • collapse_timer 30 → 35  (more time to recover)');
      lines.push('       • bioremediation L-reduction 40 → 50  (each action does more)');
      lines.push('       • start.stressor lower bound 70 → 60  (biome not quite as stressed at t=0)');
      lines.push('       • stressor penalty coefficient 0.25 → 0.20  (less H penalty from runoff tile)');
    }
    if (stats.lossReasons.keystone_extinct > 0) {
      lines.push(`   ${stats.lossReasons.keystone_extinct} seeds lost to KEYSTONE EXTINCTION → too fragile:`);
      lines.push('     Knob candidates:');
      lines.push('       • Reduce STARVE_RATE 0.30 → 0.20  (consumers survive longer without food)');
      lines.push('       • Reduce beta bands in biomes.json (less predation pressure)');
      lines.push('       • Raise K_max lower bound for keystone nodes (bigger safety margin)');
      lines.push('       • Raise start.populationFrac lower bound 0.15 → 0.25');
    }
  }

  if (stats.medianDaysToWin < 6) {
    lines.push('\n🟡  MEDIAN DAYS-TO-WIN < 6 → game may feel too easy:');
    lines.push('     • Raise start.stressor band [70,90] → [75,95]');
    lines.push('     • Increase STARVE_RATE 0.30 → 0.35');
    lines.push('     • Increase beta band upper bounds in biomes.json');
  }

  if (stats.medianDaysToWin > COLLAPSE_TIMER_START - 5 && stats.totalLosses === 0) {
    lines.push('\n🟡  MEDIAN DAYS-TO-WIN close to timer → game very tight (OK if intentional):');
    lines.push('     • Raise collapse_timer further for more breathing room');
    lines.push('     • Lower STARVE_RATE slightly');
  }

  if (stats.nanCount > 0) {
    lines.push(`\n🔴  NaN/Infinity detected in ${stats.nanCount} seeds:`);
    lines.push('     • Check getCarryingCapacity for K=0 division guard (L=100 path)');
    lines.push('     • Check computeHealth totalWeight=0 guard');
  }

  if (stats.deltaViolationCount > 0) {
    lines.push(`\n🔴  |delta|>0.35·P stability clamp violated in ${stats.deltaViolationCount} seeds:`);
    lines.push('     • The clamp in stepPopulation may not be applied before Math.round');
    lines.push('     • Check the ±1 rounding tolerance in the assert');
  }

  if (stats.determinismFailed) {
    lines.push('\n🔴  DETERMINISM FAILURE:');
    lines.push('     • Search codebase for Math.random() — there must be a stray call');
    lines.push('     • Check Object.values() / Object.keys() iteration order for unsorted paths');
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
console.log(`  Ecosystem X — Balance Harness`);
console.log(`  Seeds ${SEED_START}..${SEED_START + SEED_COUNT - 1}  (${SEED_COUNT} seeds)`);
console.log(`${'═'.repeat(72)}\n`);

const PROGRESS_INTERVAL = Math.max(1, Math.floor(SEED_COUNT / 20));

const results = [];
let determinismFailed = false;

// Run determinism check on first 5 seeds only (expensive — 2× per seed)
const DET_CHECK_SEEDS = 5;

for (let i = 0; i < SEED_COUNT; i++) {
  const seed = SEED_START + i;

  // Progress bar
  if (i % PROGRESS_INTERVAL === 0) {
    const pct = ((i / SEED_COUNT) * 100).toFixed(0).padStart(3);
    process.stdout.write(`\r  Progress: ${pct}%  [seed ${seed}]   `);
  }

  // Generate
  const gen = generateForSeed(seed);

  // Determinism check (only first DET_CHECK_SEEDS seeds)
  if (i < DET_CHECK_SEEDS) {
    const det = checkDeterminism(seed);
    if (!det) {
      determinismFailed = true;
      console.error(`\n  ❌ DETERMINISM FAIL at seed ${seed}`);
    }
  }

  // Greedy auto-play
  const play = runGreedyPlayer(gen.world);

  results.push({
    seed,
    rerolls:       gen.rerolls,
    usedDefaults:  gen.usedDefaults,
    firstValid:    gen.rerolls === 0 && !gen.usedDefaults,
    ...play
  });
}

process.stdout.write('\r  Progress: 100%                    \n\n');

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate statistics
// ─────────────────────────────────────────────────────────────────────────────
const wins           = results.filter(r => r.won);
const losses         = results.filter(r => !r.won);
const firstValidSeeds= results.filter(r => r.firstValid);
const fallbackSeeds  = results.filter(r => r.usedDefaults);
const nanSeeds       = results.filter(r => r.nanFound || r.infinityFound);
const deltaSeeds     = results.filter(r => r.deltaViolation);
const ksExtSeeds     = results.filter(r => r.keystoneExtinct);

const wonDays        = wins.map(r => r.wonDay).filter(d => d != null).sort((a,b) => a-b);
const finalHs        = wins.map(r => r.finalH).sort((a,b) => a-b);
const lossHs         = losses.map(r => r.finalH).sort((a,b) => a-b);

const lossReasons = { timer_expired: 0, keystone_extinct: 0 };
for (const r of losses) {
  if (r.lostReason) lossReasons[r.lostReason] = (lossReasons[r.lostReason] ?? 0) + 1;
}

const winRate          = (wins.length / SEED_COUNT * 100).toFixed(2);
const firstValidRate   = (firstValidSeeds.length / SEED_COUNT * 100).toFixed(2);
const fallbackRate     = (fallbackSeeds.length / SEED_COUNT * 100).toFixed(2);
const medianDays       = percentile(wonDays, 50);
const p10Days          = percentile(wonDays, 10);
const p90Days          = percentile(wonDays, 90);
const minDays          = wonDays[0]                ?? 'N/A';
const maxDays          = wonDays[wonDays.length-1] ?? 'N/A';
const minH             = wins.length ? finalHs[0].toFixed(1)               : 'N/A';
const maxH             = wins.length ? finalHs[finalHs.length-1].toFixed(1): 'N/A';
const minLossH         = losses.length ? lossHs[0].toFixed(1)              : 'N/A';
const maxLossH         = losses.length ? lossHs[lossHs.length-1].toFixed(1): 'N/A';

// ─────────────────────────────────────────────────────────────────────────────
// Print summary table
// ─────────────────────────────────────────────────────────────────────────────
const W  = 48;
const hr = '─'.repeat(W);
const row = (label, value, flag='') =>
  `  │ ${label.padEnd(28)} │ ${String(value).padStart(12)} ${flag.padEnd(4)}│`;

console.log(`  ┌${'─'.repeat(W)}┐`);
console.log(`  │${'  BALANCE SUMMARY'.padEnd(W)}│`);
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
console.log(`  │${'  DAYS TO WIN (winning seeds only)'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
console.log(row('Median days to win',     wonDays.length ? medianDays : 'N/A'));
console.log(row('p10 / p90',             wonDays.length ? `${p10Days} / ${p90Days}` : 'N/A'));
console.log(row('Min / Max days',         wonDays.length ? `${minDays} / ${maxDays}` : 'N/A'));
console.log(`  ├${'─'.repeat(28)}┴${'─'.repeat(18)}┤`);
console.log(`  │${'  FINAL HEALTH'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
console.log(row('Min / Max H (wins)',     `${minH} / ${maxH}`));
console.log(row('Min / Max H (losses)',   `${minLossH} / ${maxLossH}`));
console.log(`  └${'─'.repeat(28)}┴${'─'.repeat(18)}┘`);

// ── Failures detail ────────────────────────────────────────────────────────
if (losses.length > 0) {
  console.log('\n  ── Unwinnable seeds (first 20) ─────────────────────────────────────');
  for (const r of losses.slice(0, 20)) {
    console.log(
      `     seed=${r.seed}  H=${r.finalH.toFixed(1).padStart(5)}  ` +
      `streak=${r.healthStreak}  reason=${r.lostReason ?? 'unknown'}  ` +
      `defaults=${r.usedDefaults}  rerolls=${r.rerolls}`
    );
  }
}

if (nanSeeds.length > 0) {
  console.log('\n  ── NaN / Infinity seeds ───────────────────────────────────────────');
  for (const r of nanSeeds.slice(0, 10)) {
    console.log(`     seed=${r.seed}`);
  }
}

if (deltaSeeds.length > 0) {
  console.log('\n  ── Stability-clamp violation seeds ────────────────────────────────');
  for (const r of deltaSeeds.slice(0, 10)) {
    console.log(`     seed=${r.seed}`);
  }
}

// ── Knob advisor ──────────────────────────────────────────────────────────
const advice = advisorMessage({
  fallbackCount:        fallbackSeeds.length,
  totalLosses:          losses.length,
  lossReasons,
  medianDaysToWin:      medianDays,
  nanCount:             nanSeeds.length,
  deltaViolationCount:  deltaSeeds.length,
  determinismFailed
});

if (advice) {
  console.log('\n' + '─'.repeat(72));
  console.log('  KNOB ADVISOR');
  console.log('─'.repeat(72));
  console.log(advice);
}

// ── Final assertion ───────────────────────────────────────────────────────
console.log('\n' + '─'.repeat(72));
const allGood = wins.length === SEED_COUNT && !determinismFailed &&
                nanSeeds.length === 0 && deltaSeeds.length === 0;

if (allGood) {
  console.log('  ✅  Phase 1 exit gate PASSED — all assertions green.');
  console.log('      Engine is deterministic, 100% winnable, numerically stable.');
  console.log('      Proceed to Phase 2 (renderer + input).\n');
  process.exit(0);
} else {
  const failMsgs = [];
  if (wins.length < SEED_COUNT)     failMsgs.push(`win-rate ${winRate}% < 100%`);
  if (nanSeeds.length > 0)          failMsgs.push(`${nanSeeds.length} NaN/Infinity seeds`);
  if (deltaSeeds.length > 0)        failMsgs.push(`${deltaSeeds.length} clamp-violation seeds`);
  if (determinismFailed)            failMsgs.push('determinism failure');
  console.log(`  ❌  Phase 1 exit gate FAILED: ${failMsgs.join('; ')}`);
  console.log('      See KNOB ADVISOR above for remediation steps.\n');
  process.exit(1);
}

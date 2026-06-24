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
 *     2. Runs a TYPED greedy auto-player that DIAGNOSES activeStressors and
 *        applies the MATCHING counter each day (same logic as validator.js §4):
 *          • runoff:      bioremediate highest-L tile (source priority)
 *          • invasive:    cull the invasive node
 *          • overharvest: protect the harvested species' tile
 *        Mismatched tools are not used (they still spend resources — wrong-tool
 *        penalty is tested separately).
 *     3. Records per-seed: won? day-to-win, final H, stressor combo, any
 *        keystone extinction, NaN/Infinity, |delta|>0.35·P violation.
 *     4. Asserts 100% winnable; asserts determinism (seed run twice).
 *
 * Prints a summary table:
 *   • Overall win-rate, per-stressor-combo win-rate
 *   • First-seed-valid rate, median days-to-win, p10/p90
 *   • NaN/Infinity count, delta-violation count
 *   • Knob advisor if any metric fails
 *
 * Acceptable gate (per §4 spec):
 *   100% winnable, median days ≤ ~0.7 × collapse_timer (≈28).
 *   First-seed-valid may dip below 60% (combo worlds are harder — reroll handles it).
 */

import { fileURLToPath }  from 'url';
import { readFileSync }   from 'fs';
import path               from 'path';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

import { generateWorld }  from '../generator.js';
import { runDailyStep, getCarryingCapacity } from '../ecosystem.js';

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

// ── Balance knobs (mirrored from ecosystem.js) ─────────────────────────────
const MAX_DELTA_FRAC       = 0.35;
const BIOREMEDIATION_COST  = 60;
const BIOREMEDIATION_L_RED = 50;
const CULL_COST            = 55;
const PROTECT_COST         = 150;
const PROTECT_CAP          = 20;
const COLLAPSE_TIMER_START = 40;
const DAILY_INCOME         = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Mock state factory
// ─────────────────────────────────────────────────────────────────────────────
function makeMockState(world) {
  // Match generator.js: invasive worlds get +10 days on the collapse timer.
  const hasInvasive = (world.activeStressors ?? []).some(s => s.type === 'invasive');
  const collapseTimer = COLLAPSE_TIMER_START + (hasInvasive ? 30 : 0);
  return {
    meta: {
      seed:             0,
      biome_template:   'coastal_wetland',
      day_count:        1,
      collapse_timer:   collapseTimer,
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
// ─────────────────────────────────────────────────────────────────────────────
function instrumentedStep(state) {
  const before = {};
  for (const [id, n] of Object.entries(state.world.nodes)) {
    before[id] = n.population;
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
    const cap   = MAX_DELTA_FRAC * P_before + 1;
    if (P_before > 0 && delta > cap) issues.deltaViolation = true;
  }

  return issues;
}

// ─────────────────────────────────────────────────────────────────────────────
// Typed greedy auto-player
// Diagnoses activeStressors and applies the MATCHING counter each day.
// ─────────────────────────────────────────────────────────────────────────────
function runGreedyPlayer(world) {
  const state = makeMockState(world);
  const maxDays = state.meta.collapse_timer; // includes invasive +10 bonus

  const activeStressors = world.activeStressors ?? [];
  const hasRunoff    = activeStressors.some(s => s.type === 'runoff');
  const invasiveDef  = activeStressors.find(s => s.type === 'invasive');
  const harvestDef   = activeStressors.find(s => s.type === 'overharvest');

  // Stressor combo label for per-combo stats
  const comboLabel = activeStressors.map(s => s.type).sort().join('+') || 'none';

  let wonDay          = null;
  let nanFound        = false;
  let deltaViolation  = false;
  let keystoneExtinct = false;

  for (let day = 0; day < maxDays; day++) {
    // ── 1. Overharvest: protect the target tile ───────────────────────────────
    if (harvestDef && state.player.resources >= PROTECT_COST) {
      const targetNode = state.world.nodes[harvestDef.targetNative];
      if (targetNode) {
        const tile = state.world.tiles[targetNode.tileId];
        if (tile && !tile.protected) {
          tile.protected = true;
          tile.stressor  = Math.min(tile.stressor ?? 0, PROTECT_CAP);
          state.player.resources -= PROTECT_COST;
        }
      }
    }

    // ── 2. Invasive: cull the invasive node ───────────────────────────────────
    if (invasiveDef && state.player.resources >= CULL_COST) {
      const inv = state.world.nodes[invasiveDef.nodeId];
      if (inv && inv.status !== 'extinct' && inv.population > 0) {
        const removal = Math.ceil(inv.population * 0.45);
        inv.population = Math.max(0, inv.population - removal);
        state.player.resources -= CULL_COST;
      }
    }

    // ── 3. Bioremediate highest-L tile (source priority for runoff) ──────────
    if (state.player.resources >= BIOREMEDIATION_COST) {
      let bestTileId = null;
      let bestL      = -Infinity;

      // Source-tile priority
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

      // Fallback: any node tile with higher L
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

    // ── 4. Reintroduce crashed natives (rebalancing slot, ¤CULL_COST) ────────
    // If a native species has been devastated (P < 15% K_max) and its tile stressor
    // is now below 40, reintroduce it to 20% K_max. This models the vendor's
    // rebalancing→reintroduction path and accelerates post-invasive recovery.
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
      }
    }

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
    player: { resources: 100, tile_x: 0, tile_y: 0, scanner_charges: 5 },
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

  // Apply same greedy play for 5 days
  const DAYS = 5;
  for (let d = 0; d < DAYS; d++) {
    for (const s of [s1, s2]) {
      const activeStressors = s.world.activeStressors ?? [];
      const invasiveDef = activeStressors.find(a => a.type === 'invasive');
      const harvestDef  = activeStressors.find(a => a.type === 'overharvest');
      const hasRunoff   = activeStressors.some(a => a.type === 'runoff');

      if (harvestDef && s.player.resources >= PROTECT_COST) {
        const tn = s.world.nodes[harvestDef.targetNative];
        if (tn) {
          const t = s.world.tiles[tn.tileId];
          if (t && !t.protected) { t.protected=true; t.stressor=Math.min(t.stressor??0,PROTECT_CAP); s.player.resources-=PROTECT_COST; }
        }
      }
      if (invasiveDef && s.player.resources >= CULL_COST) {
        const inv = s.world.nodes[invasiveDef.nodeId];
        if (inv && inv.status!=='extinct' && inv.population>0) {
          inv.population=Math.max(0,inv.population-Math.ceil(inv.population*0.45));
          s.player.resources-=CULL_COST;
        }
      }
      if (s.player.resources >= BIOREMEDIATION_COST) {
        let bestTileId=null, bestL=-Infinity;
        if (hasRunoff) {
          for (const a of activeStressors) {
            if (a.type!=='runoff') continue;
            const t=s.world.tiles[a.sourceTileId];
            if (t && t.stressor>bestL) { bestL=t.stressor; bestTileId=a.sourceTileId; }
          }
        }
        for (const n of Object.values(s.world.nodes)) {
          const t=s.world.tiles[n.tileId];
          if (t && t.stressor>bestL) { bestL=t.stressor; bestTileId=n.tileId; }
        }
        if (bestTileId && bestL>0) {
          s.world.tiles[bestTileId].stressor=Math.max(0,s.world.tiles[bestTileId].stressor-BIOREMEDIATION_L_RED);
          s.player.resources-=BIOREMEDIATION_COST;
        }
      }
      if (s.player.resources >= CULL_COST) {
        const bn=Object.values(s.world.nodes).filter(n=>n.kind!=='stressor'&&n.kind!=='invasive'&&n.status!=='extinct').sort((a,b)=>(a.population/a.K_max)-(b.population/b.K_max));
        const rt=bn.find(n=>{const tL=s.world.tiles[n.tileId]?.stressor??100;return n.K_max>0&&n.population<0.15*n.K_max&&tL<40;});
        if(rt){rt.population=Math.round(0.20*rt.K_max);rt.extinction_counter=0;if(rt.status!=='stable')rt.status='stable';s.player.resources-=CULL_COST;}
      }
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
    lines.push('   Knob candidates:');
    lines.push('     • Raise collapse_timer 40 → 45');
    lines.push('     • Lower start.stressor band [40,60] → [35,55]');
    lines.push('     • Lower invasive β band upper bound');
    lines.push('     • Lower harvestDrain band upper bound');
  }

  if (stats.totalLosses > 0) {
    const pct = ((stats.totalLosses / SEED_COUNT) * 100).toFixed(1);
    lines.push(`\n❌  WIN-RATE: ${((1 - stats.totalLosses / SEED_COUNT) * 100).toFixed(1)}%  (${stats.totalLosses} seeds unwinnable)`);
    if (stats.lossReasons.timer_expired > 0) {
      lines.push(`   ${stats.lossReasons.timer_expired} timer-expired losses:`);
      lines.push('     • Raise DAILY_INCOME 55 → 65  (more resources/day)');
      lines.push('     • Raise collapse_timer 40 → 45');
      lines.push('     • Lower CULL_COST or PROTECT_COST');
      lines.push('     • Lower invasive population frac bands');
      lines.push('     • Lower harvestDrain band');
    }
    if (stats.lossReasons.keystone_extinct > 0) {
      lines.push(`   ${stats.lossReasons.keystone_extinct} keystone-extinction losses:`);
      lines.push('     • Reduce STARVE_RATE 0.30 → 0.20');
      lines.push('     • Raise start.populationFrac lower bound 0.35 → 0.40');
      lines.push('     • Reduce invasive β band');
    }
  }

  // Per-combo advisor
  for (const [combo, comboStats] of Object.entries(stats.comboStats)) {
    if (comboStats.losses > 0) {
      lines.push(`\n  ⚠  Combo "${combo}": ${comboStats.losses} losses out of ${comboStats.total}`);
    }
    if (comboStats.wins > 0 && comboStats.medianDays > COLLAPSE_TIMER_START * 0.7) {
      lines.push(`  🟡 Combo "${combo}": median days ${comboStats.medianDays} > 0.7×timer — tight but OK`);
    }
  }

  if (stats.medianDaysToWin < 6) {
    lines.push('\n🟡  MEDIAN DAYS < 6 → may feel too easy:');
    lines.push('     • Raise start.stressor band');
    lines.push('     • Increase invasive β or harvestDrain');
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
console.log(`  Ecosystem X — Balance Harness  (Typed Stressors)`);
console.log(`  Seeds ${SEED_START}..${SEED_START + SEED_COUNT - 1}  (${SEED_COUNT} seeds)`);
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

  const play = runGreedyPlayer(gen.world);

  results.push({
    seed,
    rerolls:      gen.rerolls,
    usedDefaults: gen.usedDefaults,
    firstValid:   gen.rerolls === 0 && !gen.usedDefaults,
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

// Per-stressor-combo stats
const comboStats = {};
for (const r of results) {
  const c = r.comboLabel;
  if (!comboStats[c]) comboStats[c] = { wins:0, losses:0, total:0, days:[] };
  comboStats[c].total++;
  if (r.won) { comboStats[c].wins++; if (r.wonDay!=null) comboStats[c].days.push(r.wonDay); }
  else       comboStats[c].losses++;
}
for (const c of Object.values(comboStats)) {
  c.days.sort((a,b)=>a-b);
  c.medianDays = percentile(c.days, 50);
  c.winRate = ((c.wins / c.total) * 100).toFixed(1);
}

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

console.log(`  ┌${'─'.repeat(W)}┐`);
console.log(`  │${'  BALANCE SUMMARY  (Typed Stressors)'.padEnd(W)}│`);
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
console.log(row('Median days to win',     wonDays.length ? medianDays : 'N/A',
  wonDays.length && medianDays <= COLLAPSE_TIMER_START * 0.7 ? '✓' : (wonDays.length ? '🟡' : '')));
console.log(row('p10 / p90',             wonDays.length ? `${p10Days} / ${p90Days}` : 'N/A'));
console.log(row('Min / Max days',         wonDays.length ? `${minDays} / ${maxDays2}` : 'N/A'));
console.log(`  ├${'─'.repeat(28)}┴${'─'.repeat(18)}┤`);
console.log(`  │${'  FINAL HEALTH'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
console.log(row('Min / Max H (wins)',     `${minH} / ${maxH}`));
console.log(row('Min / Max H (losses)',   `${minLossH} / ${maxLossH}`));
console.log(`  ├${'─'.repeat(28)}┴${'─'.repeat(18)}┤`);
console.log(`  │${'  PER-STRESSOR-COMBO WIN RATES'.padEnd(W)}│`);
console.log(`  ├${'─'.repeat(28)}┬${'─'.repeat(18)}┤`);
for (const [combo, cs] of Object.entries(comboStats).sort(([a],[b])=>a<b?-1:1)) {
  const flag = cs.losses === 0 ? '✓' : '❌';
  console.log(row(`  ${combo} (n=${cs.total})`, `${cs.winRate}%`, flag));
  console.log(row(`    median days`, cs.days.length ? cs.medianDays : 'N/A'));
}
console.log(`  └${'─'.repeat(28)}┴${'─'.repeat(18)}┘`);

// ── Failure details ────────────────────────────────────────────────────────
if (losses.length > 0) {
  console.log('\n  ── Unwinnable seeds (first 20) ─────────────────────────────────────');
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
  console.log('  ✅  Phase 2 exit gate PASSED — typed stressors verified.');
  console.log('      Engine is deterministic, 100% winnable, numerically stable.');
  console.log('      Proceed to Phase 3 (systems & AI content).\n');
  process.exit(0);
} else {
  const failMsgs = [];
  if (wins.length < SEED_COUNT)   failMsgs.push(`win-rate ${winRate}% < 100%`);
  if (nanSeeds.length > 0)        failMsgs.push(`${nanSeeds.length} NaN/Infinity seeds`);
  if (deltaSeeds.length > 0)      failMsgs.push(`${deltaSeeds.length} clamp-violation seeds`);
  if (determinismFailed)          failMsgs.push('determinism failure');
  console.log(`  ❌  Phase 2 exit gate FAILED: ${failMsgs.join('; ')}`);
  console.log('      See KNOB ADVISOR above for remediation steps.\n');
  process.exit(1);
}

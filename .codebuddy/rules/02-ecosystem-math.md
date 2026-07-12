# Rule 02 — Ecosystem Mathematics & Generation (Immutable — Do Not Approximate)

The math is the scientific and educational heart of the game. Implement verbatim. No linear "close enough" rewrites.

---

## A. Seeded hybrid generation (the DAG)

A world is built once at init from a **biome template** + a numeric **seed**:

1. `prng = mulberry32(seed)` — the only randomness source.
2. From the template, instantiate **nodes**. Each node is one of: `stressor` (environmental factor, e.g. pollution source), `producer`, `consumer`, `predator`.
3. Jitter each node's parameters within the template's **safe bands** using `prng` (e.g. `r ∈ [0.10, 0.18]`).
4. Lay down **directed edges** = trophic dependencies (`stressor → producer → consumer → predator`). Edge `A → B` means **energy flows A→B, i.e. B eats A** (see §C). Edges are **hidden** from the player until observed.
5. Run `validator.js`:
   - **Acyclicity** — topological sort must succeed (it is a DAG).
   - **Solvability** — there must exist an intervention sequence that reaches Win (Rule 02-D). If not, **increment seed and reroll** (cap 50 tries, then fall back to template defaults).
6. Set start populations and start stressor levels `L` per the (validated) seed.

**Never** generate with `Math.random()`. **Never** ship a world that failed validation.

---

## B. Equation 1 — Dynamic carrying capacity

```
K_i(L) = K_max_i × (1 − L/100) ^ α_i
```
- `K_max_i` — node's pristine-condition max population
- `L` — local stressor level on the node's tile, float 0–100
- `α_i` — environmental sensitivity exponent

**Design intent of α:** high α (≈2.5) = fragile keystone — `K` collapses toward 0 unless `L` is driven low; low α (≈0.8) = resilient generalist — keeps some capacity even under stress. Example: α=2.5 at L=85 → `K = K_max × 0.15^2.5 ≈ K_max × 0.0087` (functionally extinct until cleaned). Do not change α bands without a balance review.

```javascript
function getCarryingCapacity(nodeId, state) {
  const n = state.world.nodes[nodeId];
  const L = state.world.tiles[n.tileId].stressor; // 0–100
  const K = n.K_max * Math.pow(Math.max(0, 1 - L / 100), n.alpha);
  return K; // float; do NOT round here
}
```

---

## C. Equation 2 — Discrete logistic step with FOOD dependency, predation + player action

**Edge semantics (read first):** a directed edge `A → B` means **energy flows A→B — i.e. B eats A** (A is B's food/prey; B is A's predator). The chain `stressor → producer → consumer → predator` therefore reads as "producer is eaten by consumer is eaten by predator." A **stressor edge** (`from` is a `stressor`, `beta = 0`) is a non-trophic marker for the dependency-reveal puzzle only — it is **skipped** in both the food and predation terms; the stressor acts solely through tile `L` in Eq1.

```
P_i(t+1) = max(0,  P_i + growth_i − starvation_i − predation_i − A_i(t) ),   net Δ clamped to ±0.35·P_i

growth_i      = K_i(L)>0 ? r_i·P_i·(1 − P_i/K_i(L)) : −P_i        // logistic on own-tile carrying capacity
foodFactor_i  = hasFood(i) ? clamp( mean_j(P_j / K_max_j) / θ, 0, 1 ) : 1   // j = i's food: edges j→i, j non-stressor
starvation_i  = STARVE_RATE · P_i · (1 − foodFactor_i)            // food shortage kills → bottom-up cascade
predation_i   = Σ_k [ β_ik · min(P_k, P_i) ]                      // k = i's predators: edges i→k, k non-stressor
```
- `r_i` reproduction rate · `A_i(t)` player removal this step (invasive culling / sampling), 0 for most nodes.
- **Bottom-up food (the cascade engine):** a consumer's food is the prey **upstream** of it (`j → i`). When that prey collapses, `foodFactor_i → 0` and `starvation_i` drives the consumer down — so a polluted producer starves the whole chain above it. **Producers have no food edge → `foodFactor = 1`** (light-limited; only K- and predation-limited).
- **Top-down predation:** node `i` (as prey) loses to its predators `k` **downstream** of it (`i → k`). `min(P_k,P_i)` is the bounded functional response (a predator can't remove more prey than exist).
- `θ` = `FOOD_SUFFICIENCY` (food at ≥θ of its pristine capacity fully sustains the consumer). Start **0.4**.
- `STARVE_RATE` start **0.3** · `MAX_DELTA_FRAC` = **0.35**. All three are balance knobs — the harness is the source of truth.

```javascript
const FOOD_SUFFICIENCY = 0.4;   // θ
const STARVE_RATE      = 0.18;  // re-tune §2: 0.30→0.18 (faster native recovery); see §F
const MAX_DELTA_FRAC   = 0.35;

function stepPopulation(nodeId, state) {
  const n = state.world.nodes[nodeId];
  if (n.kind === 'stressor' || n.status === 'extinct') return n.population ?? 0;
  const P = n.population;
  const K = getCarryingCapacity(nodeId, state);

  // Logistic growth on own-tile carrying capacity (pollution lowers K via Eq1).
  const growth = K > 0 ? n.r * P * (1 - P / K) : -P;          // collapse if K→0

  // Bottom-up FOOD dependency: i's food = prey j with edge j→i (j non-stressor).
  let foodSum = 0, foodCount = 0;
  for (const e of state.world.edges) {
    if (e.to === nodeId) {
      const j = state.world.nodes[e.from];
      if (j.kind === 'stressor') continue;                   // stressor edge ≠ food
      foodSum += j.K_max > 0 ? j.population / j.K_max : 0;
      foodCount++;
    }
  }
  const foodFactor = foodCount === 0
    ? 1
    : Math.max(0, Math.min(1, (foodSum / foodCount) / FOOD_SUFFICIENCY));
  const starvation = STARVE_RATE * P * (1 - foodFactor);

  // Top-down PREDATION: i (prey) loses to predators k with edge i→k (k non-stressor).
  let predation = 0;
  for (const e of state.world.edges) {
    if (e.from === nodeId) {
      const k = state.world.nodes[e.to];
      if (k.kind === 'stressor') continue;
      predation += e.beta * Math.min(k.population, P);
    }
  }

  const action = state.world.actionsThisStep?.[nodeId] ?? 0;
  let delta = growth - starvation - predation - action;
  const cap = MAX_DELTA_FRAC * P;
  delta = Math.max(-cap, Math.min(cap, delta));
  n.population = Math.max(0, Math.round(P + delta));
  return n.population;
}
```
**Do not change:** the `Math.max(0,…)` floor; food uses `j→i` (prey upstream), predation uses `i→k` (predators downstream); both bounded by `min(...)`; the ±0.35·P clamp; `Math.round` (whole organisms); stressor edges skipped in both terms.

---

## D. Ecosystem Health & win/lose

```
H = 100 × ( Σ_i w_i · clamp(P_i / K_i(L_pristine), 0, 1) ) / Σ_i w_i  −  stressorLoadPenalty
```
- `w_i` node weight; keystones weigh more. `K_i(L_pristine)` uses L=0. Stressor nodes have weight 0 (excluded from the sum).
- `stressorLoadPenalty` = **0.10** × mean stressor L over the stressor-source tiles (re-tuned from 0.15). This is a balance knob — the harness is the source of truth.
- Phase 2 adds typed-stressor penalties to H; see §F.
- Clamp `H` to 0–100.

**Tiers:** Toxic `<25` · Degraded `25–50` · Recovering `50–75` · Pristine `≥75` (drives Rule on Hysteria, audio, tile retint).

**Win:** `H ≥ 75` sustained for **3 consecutive days** AND no keystone node `extinct`.
**Lose:** collapse timer reaches 0, OR any keystone node `extinct`.

---

## E. Extinction logic
```
IF P_i == 0 for 3 consecutive days → status = "extinct" (permanent)
IF P_i  > 0 → reset extinction_counter to 0
```
Counter at `state.world.nodes[nodeId].extinction_counter` (0–3). One warning day, one last-chance day, then permanent — the point-of-no-return lesson. Keystone extinction force-fails the run (the cascade lesson).

---

## F. Typed stressors — instantiation, effects, and matched counters

Each world has 1 (≈60%) or 2 (≈40%) stressor types selected at generation time via `stressorPool` in `biomes.json`. Descriptors are stored in `state.world.activeStressors[]`.

### Daily pre-step order (runDailyStep, before Eq2)

`processStressors(state)` runs **before** the population step so symptoms cascade into the same day's simulation:

| Type | Pre-step effect | Symptom |
|------|----------------|---------|
| **runoff** | If source tile L ≥ 10: each orthogonal neighbour gets +`spreadRate` L (clamp 0–100). Cleaning the source tile to L < 10 stops propagation. | High & spreading tile L; `n_runoff` stressor node |
| **overharvest** | Subtract `harvestDrain` from the target species' population (floor 0), **unless** its tile is `protected`. | Species declining under low L with no rising predator; `node.harvestPressure` flag |
| **invasive** | *No pre-step* — the invasive's edge to its target native is handled by the normal Eq2 predation loop. | `n_invasive` node whose population **rises** while its target native **falls**, under low L |

### Matched counter-interventions

| Stressor | Correct counter | Effect | Cost |
|----------|----------------|--------|------|
| runoff | `applyBioremediation(tileId)` | L -= BIOREM_AMOUNT (=50), clamp 0. Root fix: clean source tile to L<10. | ¤60 |
| invasive | `applyCull(nodeId)` | population -= ceil(CULL_FRAC × P). CULL_FRAC = 0.45. | ¤45 |
| overharvest | `applyProtect(tileId)` | tile.protected = true; L capped at PROTECT_CAP (=20); harvest drain zeroed. | ¤120 |

**Wrong-counter rule:** mismatched tools still spend resources but have no useful effect (applying bioremediation in an invasive world reduces L but not the invasive — resources wasted). This is intentional — the mechanic teaches diagnosis.

### Balance knobs (harness-verified, 1000-seed sweep — balance pass 3: root-cause re-tune)
```
RUNOFF_SPREAD = 4       BIOREM_AMOUNT = 50
HARVEST_DRAIN = 6       CULL_FRAC     = 0.45
PROTECT_CAP   = 20      DAILY_INCOME  = 65
STARVE_RATE   = 0.18    (re-tune §2: 0.30→0.18 — faster staggered native recovery)

Intervention costs:  bioremediation ¤60 · rebalancing/cull ¤45 · stabilization/protect ¤120

Collapse timer: UNIFORM 45 days for ALL worlds.
  Re-tune §1 REMOVED both invasive special-cases (the +30-day timer bonus AND the
  reduced native-tile-stressor). The real fix was faster NATIVE RECOVERY, not
  per-stressor band-aids — so invasive worlds now play on the same clock as the rest.

Native recovery (biomes.json node r-bands, raised ~1.6× — re-tune §2):
  producer (seagrass) r:[0.20,0.28] · consumer (shrimp) r:[0.17,0.24] · predator (heron) r:[0.09,0.15]

Stressor parameter bands (biomes.json stressorPool):
  runoff:      sourceLBand [60,95]   spreadRate [3,7]
  invasive:    βBand [0.02,0.035]   r [0.10,0.16]   K_max [80,140]   alpha [0.7,1.0]
               populationFrac [0.15,0.25]   → target n_shrimp
               (re-tune §3: β restored from the hollow [0.008,0.018] — unmanaged it
                now drives the target native down ~37% in 12 days: a REAL threat.)
  overharvest: drainBand [3,6]   protectCapStressor 20   → target n_shrimp
  start.stressor (ALL worlds): [45,65]

Verified (balance pass 3): 100% optimal-winnable, deterministic, 0 NaN, 0 Δ-violations,
  all combo medians in [0.30–0.65]×45, pacing ratio 1.50, and a HANDICAPPED player
  (3-day diagnosis lag + misplay every 4th action) wins 100% across every combo.
```

### Updated full daily-step order (ecosystem.js → runDailyStep)
```
PRE-0. processStressors()    — runoff spread, overharvest drain
a.     stepPopulation (Eq2)  — Jacobi simultaneous update, all non-stressor non-extinct nodes
b.     checkExtinction        — per node
c.     computeHealth (Eq3)   → state.meta.ecosystem_health
d.     updateMarketTier
e.     day_count += 1; collapse_timer -= 1
f.     player.resources += DAILY_INCOME
g.     evaluateWinLose
h.     state.resetDay(); state.save()
```

### computeHealth additions (Phase 2)
- **Invasive penalty**: REMOVED — set to 0 (re-tune §3). The invasive now harms H *ecologically* via real predation (β [0.02,0.035]) suppressing its target native, **not** via an artificial flat penalty.
- **Overharvest penalty**: `+3 × (harvestDrain / K_max_target) × 100` subtracted from H while the target tile is **not** protected.
- Invasive nodes (`kind = 'invasive'`) are **excluded** from the weighted population sum (weight = 0).

---

## H. Web enrichment — trade-off + competition (depth passes #2/#3)

### #2 Trade-off — the invasive is the predator's food (coupled consequence)
When an invasive is generated, a SECOND edge `n_invasive → <apex predator>` is added (`predatorBetaBand [0.010,0.020]`) — the stork feeds on the tilapia too. This makes over-culling a **losing** move:

- In `processStressors`, for each active invasive stressor: if the invasive is culled to near-zero (`P_inv/K_max < INVASIVE_STARVE_FLOOR`) **while** its prey is still scarce (`P_prey/K_max < TRADEOFF_PREY_SAFE`), the predator suffers a starve penalty.
- The penalty is applied as a **clamped action term** (`actionsThisStep[predator] += HERON_STARVE_PENALTY`) so it respects the ±0.35·P envelope — no clamp-bypass, no delta-violation, no harness exemption needed.
- **Winning line:** restore the prey's habitat FIRST (raise prey ≥ 0.45 rel), THEN finish the cull. "Cull max every day" starves the keystone.

```
TRADEOFF_PREY_SAFE    = 0.45   INVASIVE_STARVE_FLOOR = 0.20   HERON_STARVE_PENALTY = 6
```
Greedy/validator rule: only cull when `preyRel ≥ 0.45`. Verified: naive cull-max → 0 wins; smart restore-first → 100%.

### #3 Competition — a 5th native grazing the shared producer
A permanent native `n_crab` (Mud Crab, consumer, low `weight [0.5,0.8]`) grazes the same producer as the shrimp via edge `n_seagrass → n_crab` (`betaBand [0.04,0.07]`, `r [0.17,0.24]`, `K_max [200,340]`). Combined grazing pressure on the shared seagrass means a booming crab thins the meadow faster than it regrows — **suppressing the shrimp 15–39% under clean water** (non-obvious diagnosis). Resolved by boosting the shared resource (bioremediate the seagrass), NOT a new lever. No engine change — pure food-web edge + node.

**Verified (passes #2+#3):** 100% optimal-winnable, 100% optimal / 99.7% handicapped, 0 NaN, 0 Δ-violations, deterministic, pacing 1.48, first-seed-valid 92.8%.

---

## I. Escalation — unaddressed runoff accelerates (depth pass #4)

Runoff pollution intensifies the longer its source is left uncleaned, and reverses once bioremediated —
a "rising tide" that rewards fast root-cause action and punishes dawdling. Tile-L based → no
population-clamp interaction, no delta-violation risk.

In `processStressors` (runoff branch), per day, on the descriptor `s.escalation` (init 0):
```
if (sourceTile L ≥ 10):  s.escalation = min(RUNOFF_ESCALATION_MAX, s.escalation + RUNOFF_ESCALATION_RATE)
else (source cleaned):   s.escalation = max(0, s.escalation − RUNOFF_ESCALATION_DECAY); stop spreading
effectiveSpread = spreadRate × (1 + s.escalation)
```
```
RUNOFF_ESCALATION_RATE = 0.06   RUNOFF_ESCALATION_MAX = 0.80 (→ up to ×1.8 spread)   DECAY = 0.15
```
Guard: coerce `s.escalation` to 0 if non-finite (tampered save). **Teeth (verified):** ignoring the source
ramps escalation 0→0.8 and roughly 2.6× the total map pollution vs cleaning it on day 1. Diagnosis UI warns
"bloom is ACCELERATING — ×N faster" once escalation > 0.2. Harness stays 100% / 99.6% handicapped.

---

## J. Multiple biomes + per-biome clock (depth pass #5)

`data/biomes.json` holds MULTIPLE templates; the engine is biome-agnostic. Each template has `id`,
`displayName`, `collapseTimer`, `nodes` (with `kind`), `edges`, `start`, `stressorPool`, and a `defaults`
fallback world. The renderer/generator read structurally (`kind === 'producer'|'consumer'|'predator'|
'stressor'`, `template.nodes.find(...)`) — never by hardcoded id. Adding a biome = data + art, no engine change.

- **Per-biome timer:** `state.meta.collapse_timer = template.collapseTimer ?? 45`. Wetland **45**, reef **52**
  (a fragile biome earns a longer restoration window). The harness reads `TEMPLATE.collapseTimer` and the
  pacing window `[0.30–0.65]×timer` scales with it. Replays keep the biome (`GameState.meta.biome_template`).
- **coral_reef** (shipped): coral (producer, keystone) · parrotfish (consumer) · sea urchin (consumer,
  competitor) · blacktip reef shark (predator, keystone) · lionfish (invasive) · sediment plume (stressor).
  Distinct **feel via fragility**: coral `alpha [0.90,1.25]` (sediment-sensitive → bleaches hard) with `r`
  kept near-normal so pacing holds. Invasive combos run tighter (0.62–0.63×) than the wetland's (0.49–0.53×).
- **Art is biome-agnostic by lookup:** invasive sprite resolves by node NAME (`Lionfish→sprite_lionfish`,
  `Mozambique Tilapia→sprite_tilapia`); tiles remap on reef (`water→reefwater, marsh→sand, land→reef,
  source→sediment`); props via `_PROP_NAMES[biome]`; codex prefers name-key then id. Missing art degrades to
  the neutral procedural fallback (no cross-biome bleed).

**Verified (both biomes, ALL GATES PASSED):** wetland 100% / 99.6% handicapped @ timer 45;
reef 100% / 99.3% handicapped @ timer 52; both deterministic, 0 NaN, 0 Δ-violations.

---

## G. Validated test cases (run before each commit; headless harness in Phase 1)
```javascript
// 1. Carrying capacity collapses for fragile keystone
console.assert(Math.abs(K(K_max=200, L=85, alpha=2.5) - 200*Math.pow(0.15,2.5)) < 1e-6, "Eq1 FAIL");
// 2. Pristine capacity equals K_max
console.assert(K(K_max=500, L=0, alpha=0.8) === 500, "Eq1 pristine FAIL");
// 3. Population never negative under heavy predation/action
// 4. Net step change never exceeds ±0.35·P (stability guard)
// 5. Every generated seed passes validator (acyclic + solvable) across 1000 seeds
// 6. Same seed + same inputs → identical final state (determinism)
// 7. Bottom-up cascade: zero out a producer's population → its consumer's foodFactor→0 and
//    starvation drives the consumer down over the next steps (the trophic-cascade lesson).
// 8. Top-down direction: a node with NO outgoing trophic edge (apex) takes zero predation loss.
```

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
const STARVE_RATE      = 0.3;
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
- `stressorLoadPenalty` = **0.15** × mean stressor L over the stressor-source tiles (post-balance value; was 0.25). This is a balance knob — the harness is the source of truth.
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

## F. Intervention effects on stressors
- **Bioremediation** — `L_new = max(0, L_old − 40)` on the targeted tile.
- **Habitat Stabilization** — raises that tile's effective `K_max` weight (declares a protected zone); persists.
- **Population Rebalancing** — reintroduce a native node (`+seed population`, requires its tile `L < 20`) OR cull an invasive (`A_i` spike for one step).
- Stressors **never** decrease passively — only player action reduces `L`. All writes clamp `L` to `[0,100]`.

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

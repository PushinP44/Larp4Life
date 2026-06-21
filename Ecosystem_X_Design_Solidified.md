# ECOSYSTEM X: THE LAST BALANCE — Solidified Design (1-Month Build)

> **Status:** Design-locked v1.0 · **Track 1, Direction 2 — Biodiversity & Environmental Protection**
> **Platform:** HTML5 browser, single static bundle, offline-capable · **Engine:** Vanilla JS ES6 + HTML5 Canvas
> This document supersedes the original `gemini-code` proposal. It keeps the Ecosystem X vision but scopes it to what one team can ship *and polish* in 30 days, and maps every feature to the official rubric.

---

## 0. What changed from the original proposal (and why)

The original proposal is strong but carries three completion risks for a 30-day window. This version keeps the ambition and removes the risk:

| Original (risky) | Solidified (shippable) | Reason |
|---|---|---|
| Fully runtime-procedural ecosystems, "unique every playthrough" | **Hybrid seeded generation**: 1–2 handcrafted, hand-balanced *biome templates* + a seeded PRNG that varies species parameters, stressor placement, and start populations within validated safe bands | Guarantees every run is winnable and polished, still feels procedural, and yields a shareable seed (leaderboard hook) |
| "Multiple biomes" | **MVP = 1 flawless biome (Coastal Wetland); stretch = 2nd (Mountain Forest)** | One polished biome scores higher than two broken ones |
| Separate scan/fishing screens implied | **Unified single top-down viewport** — scanning, intervention, and environmental shifts all render on the main map | Project architectural constraint; also reads as more "alive" to judges |
| Open-ended food-web math | **Deterministic, bounded, unit-tested** carrying-capacity + logistic-predation step with stability guards | Determinism = testable = balanceable in time |

**Core thesis (unchanged):** *Nature is a network. Every species is a structural node. Pull one thread and the web unravels — restoring balance means thinking in systems, not symptoms.*

---

## 1. Rubric map (this is the spec's north star)

Total 100 + 5 bonus. Every feature below exists to move one of these numbers.

### Theme Alignment — 30 pts
- Core loop *is* the lesson: trophic cascades become visible, measurable feedback. A wrong intervention triggers a secondary collapse the player watches happen on the map.
- The deductive "investigation" framing (hidden dependency edges revealed through observation) teaches **systemic thinking**, the exact skill the conservation message needs.
- Explicit educational payloads: AI-generated species codex (real species, real threats), end-of-run "what you learned" recap tied to the player's actual decisions.

### Use of AI Tools — 40 pts (the biggest lever — hit *multiple* AI modules)
The rulebook explicitly rewards depth *across multiple* AI-created modules. We deliberately ship **five**:
1. **CodeBuddy** — 100% of code; full conversation history exported (mandatory submission item).
2. **Worldbuilding & Story** (CodeBuddy Genie / WorkBuddy) — species codex, biome backstory, the village "rule system," and the pre-baked Market-Hysteria dialogue pools, all AI-generated into offline JSON.
3. **Game Key Art** (Miora / Tencent Cloud MPS) — top-down tilesets (healthy/toxic variants), species sprites, UI, key art.
4. **AI Audio** (VoxFlow Studio / WorkBuddy) — health-tier ambient layers that crossfade at runtime + victory theme.
5. **Game Security Architecture** (EdgeOne Security skill + HaS-Anonymizer) — EdgeOne WAF/bot/DDoS (abnormal-behavior detection) + the optional advisor's server-side input validation & HaS anonymization (data-interaction validation).
6. **(Optional stretch) Intelligent NPC** — an opt-in live "Ask the Field Ecologist" advisor (model via an EdgeOne Function proxy) that answers the player's questions in-world. Read-only to the simulation with a deterministic offline codex fallback, so the core stays offline/deterministic (Rule 01, Law 2½). This is the "intelligent NPC" the 40-pt line explicitly names; it's cuttable without touching the core loop.

Also under Worldbuilding: an **end-of-run AI Field Report** assembles a personalized debrief from the player's actual outcome (which keystone fell, root stressor, days taken) + pre-baked Genie fragments — scoring Theme *and* AI depth, fully offline (skill `field-report.md`).

### Game Quality — 30 pts
Full start-to-finish loop, deterministic & balanced (proven by a headless balance harness), seeded replayability, single-viewport clarity, AI-asset polish, no-tutorial-needed onboarding.

### Bonus — +5 pts
Social post on Xiaohongshu / YouTube / X / WeChat with `#CodeBuddy #TencentCloudHackathon`.

---

## 2. Core gameplay loop

```
EXPLORE biome  →  SCAN entities  →  REVEAL dependency edges (the hidden DAG)
      ↑                                                 ↓
   EVALUATE  ←  DEPLOY intervention  ←  ISOLATE the root stressor
```

A single playthrough = restore the biome's **Ecosystem Health (H)** to the *Pristine* tier and keep all **keystone** species non-extinct for N consecutive in-game days, before the collapse timer expires.

**Player role:** an Environmental Field Agent walking a top-down grid biome.

1. **Explore** — desaturated tiles, decaying foliage, sparse wildlife flag stressed zones.
2. **Scan** — walk to an entity, scan; it populates the Field Notebook. Observing interactions (e.g., consumer eating producer) draws a connection line, revealing one hidden edge of the dependency graph.
3. **Isolate** — from revealed edges, deduce the *root stressor* node (e.g., a pollution source feeding a producer crash that starves a pollinator that an apex predator depends on).
4. **Intervene** — spend resources on a targeted action applied directly to map tiles.
5. **Evaluate** — the discrete time-step loop advances; populations shift; the map re-renders; a wrong move shows a visible secondary cascade.

---

## 3. Architecture (immutable constraints)

- **Target:** client-side browser, Vanilla JS ES6 modules, HTML5 Canvas, plain CSS3. Zero frameworks, zero build step, zero npm, offline-capable.
- **UI:** one unified top-down viewport. No separate scan/intervention screens. Allowed overlays only: top HUD bar, toggleable Field Notebook panel, vendor interaction panel, start/win/lose cards. Environmental change renders **on the map tiles themselves**.
- **System math:** deterministic. A seeded **Directed Acyclic Graph** is built at world init; population changes run through a discrete mathematical time-step loop. **No runtime NLP, no live LLM calls in the simulation/generation/save path** — the one exception is the optional, read-only, offline-fallback AI Ecologist advisor (Rule 01, Law 2½).
- **Social mechanic:** a deterministic **Market Hysteria State Machine** swaps vendor prices and dialogue pools from pre-baked JSON when health crosses tier thresholds.

---

## 4. The ecological model

### 4.1 Hybrid seeded generation
- Ship handcrafted **biome templates** (start with `coastal_wetland`). A template defines the node roster, base parameter bands, edge topology, and the legal stressor set.
- A seeded PRNG (`mulberry32(seed)`) jitters parameters within **validated safe bands**, picks the stressor configuration, and sets start populations.
- A **DAG validator** runs at init: confirms acyclicity, confirms at least one solvable intervention path exists, and rejects+rerolls any seed that is unsolvable. Result: infinite-feeling variety, zero unwinnable runs.
- The seed is surfaced to the player (shareable; reproducible "same-seed" runs — a ready hook if a leaderboard is ever added, though it's currently cut).

### 4.2 The two core equations (immutable — implement verbatim)

**Equation 1 — Dynamic carrying capacity**
```
K_i(L) = K_max_i × (1 − L/100) ^ α_i
```
`L` = local stressor/pollution level (0–100) on the node's tile; `α_i` = environmental sensitivity exponent. High α = fragile keystone (collapses unless L is driven low); low α = resilient generalist.

**Equation 2 — Discrete logistic step with food dependency, predation + player action**
```
P_i(t+1) = max(0, P_i + growth_i − starvation_i − predation_i − A_i(t) )
```
- `growth_i` = logistic `r_i·P_i·(1 − P_i/K_i(L))` on the node's own-tile carrying capacity (pollution lowers K via Eq1).
- `starvation_i` = `STARVE_RATE·P_i·(1 − foodFactor_i)` — **bottom-up cascade engine**: a consumer's food is the prey *upstream* of it (edge `food→consumer`); when that prey collapses, foodFactor→0 and the consumer starves. Producers have no food edge (foodFactor=1).
- `predation_i` = `Σ_k β_ik·min(P_k, P_i)` over the node's predators `k` *downstream* of it (edge `prey→predator`); bounded functional response.
- Edge `A → B` means **B eats A**. Stressor edges (β=0) are non-trophic markers, skipped in both terms. Always `Math.max(0,…)`, `Math.round()`, and clamp net Δ to ±`MAX_DELTA_FRAC·P_i` (0.35). Full spec + code: Rule 02-C.

### 4.3 Ecosystem Health (the single visible score)
```
H = 100 × ( Σ_i w_i · clamp(P_i / K_i(L_pristine), 0, 1) ) / Σ_i w_i  −  stressorLoadPenalty
```
Keystone nodes carry higher weight `w_i`. H drives everything visible: tile saturation, audio layer, Market-Hysteria tier, win/lose.

### 4.4 Extinction & cascade
- `P_i == 0` for **3 consecutive days** → `extinct` (permanent). One warning day, one last-chance day, then loss — teaches the point-of-no-return.
- Keystone extinction can force-fail the run (the cascade lesson).

### 4.5 Win / lose
- **Win:** H ≥ 75 (Pristine) sustained for N consecutive days AND no keystone extinct.
- **Lose:** collapse timer hits 0, or a keystone goes extinct.

---

## 5. Market Hysteria State Machine (deterministic social mechanic)

Tiers by Ecosystem Health: **Toxic** (H<25) · **Degraded** (25–50) · **Recovering** (50–75) · **Pristine** (≥75).

On a tier crossing (and only then), deterministically:
- Multiply vendor prices by the tier's `priceFactor` (panic inflation when collapsing, relief deflation when recovering).
- Adjust item availability (scarcity in Toxic).
- Swap the active **dialogue pool** to the tier's pre-baked JSON array (AI-generated villager reactions).
- Trigger the audio crossfade and the tile-palette retint.

All pre-baked, all offline, all reproducible from state + seed. No runtime text generation.

---

## 6. Content scope (MVP vs stretch)

| Item | MVP (must ship) | Stretch |
|---|---|---|
| Biomes | 1 — Coastal Wetland | +Mountain Forest |
| Nodes per biome | 6–8 (2 stressors, 2 producers, 2 consumers, 1–2 predators) | up to 12 |
| Interventions | Bioremediation, Population Rebalancing, Habitat Stabilization | +pH/temperature boosters |
| Vendor | 1 village vendor, 4 tiers of dialogue | named NPC personalities |
| AI modules live | Code, Worldbuilding (+recap), Key Art, Audio, Security (5) | + Intelligent-NPC live advisor (offline fallback) |
| Leaderboard | **Not built** (decided — see Integrations doc) | — |
| AI Field Ecologist | — | opt-in live advisor + HaS-anonymized EdgeOne Function proxy |

---

## 7. 30-Day roadmap (realistic, buffered)

**Phase 0 — Setup (Day 1–2):** repo + folder structure, load `CODEBUDDY.md`, create EdgeOne Pages project, stub `/assets`, kick off Miora/VoxFlow generation early (they run in parallel with code).

**Phase 1 — Engine core (Day 1–7):** seeded PRNG → DAG generator from template → DAG validator/solvability check → global state object → Equation 1 & 2 step loop → **headless balance harness** (run 1000 seeds, assert all winnable, no NaN, no oscillation). *No rendering yet.* Exit gate: a seed is provably solvable in code.

**Phase 2 — Single-viewport play (Day 8–15):** canvas grid renderer, player movement, scan interaction → edge-reveal overlay, Field Notebook panel, environmental-shift tile rendering (saturation/decay driven by H and L). Exit gate: you can walk, scan, and watch the map degrade/recover.

**Phase 3 — Systems & AI wiring (Day 16–22):** interventions applied to tiles, resource economy, **Market Hysteria machine** + vendor + dialogue pools, win/lose, AI content wiring (codex JSON, art layer swap, audio crossfade). Exit gate: full loop playable start-to-finish.

**Phase 4 — Polish & deploy (Day 23–30):** import all Miora art + VoxFlow audio, EdgeOne security config (+optional AI-Ecologist advisor proxy), full balance pass, cross-browser playtest, **≤3-min demo video**, **intro PPT** (track + AI module breakdown), social post, submit. **Days 28–30 are buffer.**

---

## 8. Submission checklist (rulebook §3 / §5)
- [ ] Project web link — `*.edgeone.app` (browser-accessible, single static bundle)
- [ ] Game demo video — ≤3 min, shows full loop + AI features
- [ ] Project intro PPT — overview, Track 1/Dir 2, AI-module breakdown, team info
- [ ] CodeBuddy conversation history — exported from all phases (mandatory)
- [ ] Social post — `#CodeBuddy #TencentCloudHackathon` (+5)

---

## 9. Critical numbers (POST Phase-1 balance pass + difficulty re-tune — harness-verified)
```
Ecosystem Health tiers:  Toxic <25 · Degraded 25–50 · Recovering 50–75 · Pristine ≥75
Win:  H≥75 sustained 3 consecutive days, 0 keystone extinct
Lose precedence (evaluateWinLose order):
  1. any keystone extinct → LOSE (overrides everything)
  2. health_streak ≥ 3 AND no keystone extinct → WIN (even if timer just hit 0 on same tick)
  3. collapse_timer ≤ 0 → LOSE
Extinction:  P==0 for 3 consecutive days
Stability guard:  MAX_DELTA_FRAC = 0.35  (per-step net change cap)
Food model:  FOOD_SUFFICIENCY (θ) = 0.4 · STARVE_RATE = 0.3
Health penalty:  stressorLoadPenalty coefficient = 0.10  (was 0.15)
Market priceFactor:  Toxic ×1.8 · Degraded ×1.3 · Recovering ×1.0 · Pristine ×0.8
Interventions (base cost, pre-hysteria):  Bioremediation 60 (−50 L, player tile) · Rebalancing 90 · Stabilization 150
Economy:  Start resources 100 · DAILY_INCOME 55/day · collapse_timer 40
Generation:  start.stressor [40,60] · start.populationFrac [0.35,0.55]
```
The headless balance harness (`tools/balance-harness.js`) is the source of truth. 1000-seed sweep results:
**win-rate 100% · first-seed-valid 78.1% · median days-to-win 23 · p10/p90 19/26 · 0% fallback · deterministic.**
Re-run after any change to these numbers.

# 🌿 Ecosystem X: The Last Balance

> A browser game about **systems thinking in conservation**. A coastal wetland is
> collapsing. You are a Field Agent: walk the marsh, discover the hidden food web,
> diagnose the *root* pollution source, and restore the ecosystem to health —
> before the collapse timer hits zero.
>
> **Tencent Cloud Hackathon 2026 · Track 1, Direction 2 — Biodiversity & Environmental Protection**

Vanilla JavaScript + HTML5 Canvas. **Zero frameworks, zero build step, fully offline-capable.**
Every run is seeded and deterministic — the same seed always produces the same world.

---

## ▶ Play it in 30 seconds

The game is ES modules, so it must be served over HTTP (not opened as a `file://`).

```bash
npm run serve        # → http://localhost:8080
```

No dependencies to install — `serve` is a tiny built-in Node server (Node ≥18).
Then open the URL and press **Begin Field Assignment**.

> Prefer Python? `python -m http.server 8080` works too (dev only — it sets no
> security headers; see `security/deploy-headers.md`).

---

## 🎮 How to play

You win by raising **Ecosystem Health** to the **Pristine** tier (≥75) and holding it
for **3 consecutive days**, with no keystone species extinct — before the collapse timer runs out.

| Action | How |
|---|---|
| **Move** | `WASD` / arrow keys, or **click a tile** |
| **Discover species** | Walk near one (a **❗** marks the nearest) — it auto-populates your Field Notebook and reveals food-web links |
| **Field Notebook** | `N` — see discovered species, revealed edges, and the codex |
| **Vendor / Interventions** | `V` — buy and apply the three interventions |
| **Advance a day** | `Space` — runs the simulation one step forward |
| **Close a panel** | `Esc` |

### The core loop

```
EXPLORE  →  DISCOVER species  →  REVEAL the hidden food web (a DAG)
   ↑                                            ↓
EVALUATE ←  ADVANCE the day  ←  INTERVENE  ←  DIAGNOSE the root stressor
```

### The three interventions

| Intervention | Effect | Use it for |
|---|---|---|
| **Bioremediation** | −50 pollution (L) on your current tile | **Runoff** — clean the source tile |
| **Rebalancing** | Culls 45% of an over-abundant species | **Invasive** species |
| **Stabilization** | Protects a tile (caps pollution, boosts capacity) | **Overharvest** pressure |

**The lesson is in the failure:** use the wrong tool and you watch a *secondary
cascade* ripple across the map. Nature is a network — pull one thread and the web unravels.

---

## 🧠 How it works (architecture)

A discrete, deterministic ecological simulation. No live LLM in the sim/save path
(the optional AI advisor is read-only, opt-in, with an offline fallback).

```
index.html ──▶ main.js (orchestrator + render loop + event delegation)
                 │
   ┌─────────────┼────────────────────────────────────────────┐
   │             │                                             │
 generator.js   ecosystem.js        renderer.js / input.js   ai_content.js
 (seeded world) (Eq1/Eq2 daily step) (single canvas viewport) (codex/dialogue/
   │             │                                             audio/field report)
 validator.js   hysteria.js / vendor.js
 (acyclic +     (Market Hysteria tiers + interventions)
  solvable)          │
        ╰──────── balance.js ────────╯
          (SINGLE SOURCE OF TRUTH for every tuning constant)
```

- **Hybrid seeded generation** — a handcrafted *coastal wetland* template + a seeded
  PRNG (`mulberry32`) jitters parameters within validated safe bands.
- **DAG validator** — every generated world is proven **acyclic** *and* **solvable**
  (a greedy auto-player must be able to win it) before it's accepted; unsolvable seeds are rerolled.
- **Two equations** drive everything (see `Ecosystem_X_Design_Solidified.md §4.2`):
  dynamic carrying capacity `K(L)` and a discrete logistic step with bottom-up
  starvation + top-down predation, clamped for stability.
- **`balance.js`** — one file holds every gameplay constant; `ecosystem.js`,
  `validator.js`, `state.js` and the balance harness all import from it, so the
  numbers can never silently drift apart.

### Single source of truth for balance

All tuning lives in [`balance.js`](balance.js). Change a number there, then:

```bash
npm test
```

The **headless balance harness** re-runs the simulation across 1000 seeds with an
independent step implementation and asserts the game is still winnable and stable.

**Current verified results:** win-rate **100%** · median days-to-win **23** ·
p10/p90 **19/26** · deterministic · **0** NaN · **0** stability-clamp violations.

---

## 🛠 Scripts

| Command | What it does |
|---|---|
| `npm run serve` | Start the local dev server (Node, no deps) at `:8080` |
| `npm start` | Alias for `serve` |
| `npm test` | Full balance harness — 1000-seed winnability + stability sweep |
| `npm run test:quick` | Fast 100-seed sweep |
| `npm run lint` | `node --check` every module (there's no build step) |
| `npm run verify` | Lint + quick balance sweep (pre-commit gate) |

---

## 🤖 AI modules (Use-of-AI rubric, 40 pts)

Five AI-produced modules ship in the game:

1. **CodeBuddy** — 100% of the code, conversation history exported.
2. **Worldbuilding & Story** — species codex, dialogue pools, and end-of-run
   **Field Report** generated offline into `data/*.json`.
3. **Game Key Art** (Miora / Tencent MPS) — tilesets (healthy/toxic), sprites, UI,
   key art in `assets/images/`.
4. **AI Audio** (VoxFlow) — health-tier ambient layers that crossfade at runtime +
   a victory sting in `assets/audio/`.
5. **Game Security** (EdgeOne + HaS) — strict CSP, response-header hardening
   (`security/`, `_headers`), save-integrity signing (`integrity.js`).

*(Stretch: an opt-in "Ask the Field Ecologist" advisor via an EdgeOne Function proxy — read-only, offline fallback.)*

---

## 📁 Project layout

```
index.html            single entry point (strict CSP, one <canvas>)
balance.js            ★ single source of truth for tuning constants
main.js               orchestrator: bootstrap, render loop, event delegation
generator.js          seeded world generation from a biome template
validator.js          acyclic + solvability check (rerolls bad seeds)
ecosystem.js          Eq1/Eq2 daily simulation step + health + win/lose
state.js              GameState singleton + save/load + integrity
renderer.js           single-viewport canvas render (map, scan/edge overlays)
input.js              movement, click-to-move, scanning
notebook.js/vendor.js Field Notebook + intervention store panels
hysteria.js           Market Hysteria tier state machine
ai_content.js         codex / dialogue / audio / field-report wiring
data/                 AI-generated JSON (biomes, codex, dialogue, report fragments)
assets/               AI-generated art + audio
tools/                balance-harness.js, serve.js, lint.js, asset generators
security/             PENTEST report + production deploy headers
```

---

## 📦 Deploy

Static bundle — deploys to **EdgeOne Pages** (primary) or any static host.
The `_headers` file at the repo root applies the production security headers
(CSP, HSTS, anti-clickjacking, nosniff) on Pages-style hosts. See
`security/deploy-headers.md` for the full header set and rationale.

## License

MIT.

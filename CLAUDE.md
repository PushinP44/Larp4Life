# CLAUDE.md — Ecosystem X: The Last Balance

Browser game (Tencent Cloud Hackathon 2026, Track 1 · Dir 2 — Biodiversity). You are a
Field Agent: walk a collapsing coastal wetland, scan species to reveal a hidden food-web
DAG, diagnose the root stressor, and deploy interventions to restore **Ecosystem Health**
before the collapse timer expires. **Vanilla JS ES6 + Canvas 2D + CSS. Zero frameworks,
zero build step, offline-capable, deterministic (seeded PRNG).**

## Working here
- **Ask the knowledge graph before grep-hunting the codebase.** A prebuilt graph lives in
  `graphify-out/graph.json`. For "how/where/what calls X" questions run `/graphify query "..."`
  (fast path — do not rebuild). God nodes by degree: `main.js` → `renderer.js` →
  `ecosystem.js`. Rebuild only after big refactors: `/graphify . --update`.
- **`balance.js` is the SINGLE SOURCE OF TRUTH for every gameplay constant.** Never hardcode
  a tuning number elsewhere; import from `balance.js`. After changing it: `npm test`.
- **Two hard laws:** (1) one unified top-down viewport — no extra screens; overlays limited to
  HUD, Notebook, Vendor, start/win/lose cards. (2) determinism — no live LLM / NLP in the
  sim/gen/save path (the opt-in AI advisor is read-only with an offline fallback).
- Strict CSP: `script-src 'self'`, no inline scripts or `on*` handlers — events via
  `data-action` delegation. Sanitize any HTML through `safehtml.js`.
- Windows shell is PowerShell; a Bash tool is also available. Node ≥18.

## Commands
```
npm run serve     # dev server → http://localhost:8080 (ES modules need HTTP, not file://)
npm test          # balance harness: 1000-seed winnability + stability sweep
npm run test:quick# 100-seed sweep
npm run verify    # lint (node --check) + quick sweep — run before committing
```

## Module map (all root-level ES modules; `index.html` → `main.js`)
| File | Role |
|---|---|
| `main.js` | orchestrator: bootstrap, render loop, event delegation, win/lose cards |
| `balance.js` | ★ all tuning constants (imported by ecosystem/validator/state/harness) |
| `generator.js` | seeded world gen from a biome template (`data/biomes.json`) |
| `validator.js` | proves each world acyclic **and** solvable; rerolls bad seeds |
| `ecosystem.js` | daily step: `runDailyStep` → Eq1/Eq2, `computeHealth`, `evaluateWinLose`, interventions |
| `state.js` | `GameState` singleton + save/load + sanitize (default export) |
| `renderer.js` | single-canvas viewport: tiles, sprites, edges, HUD, atmosphere |
| `input.js` | WASD/arrows/click-to-move, scanning, proximity discovery |
| `notebook.js` / `vendor.js` | Field Notebook + intervention-store panels |
| `hysteria.js` | Market Hysteria tier state machine (prices + dialogue pools) |
| `ai_content.js` | sprites/audio wiring, codex, dialogue, offline Field Report + run grade |
| `prng.js` `integrity.js` `safehtml.js` | mulberry32 RNG · save signing · HTML escaping |
| `data/*.json` | AI-generated biomes, codex, dialogue, report fragments |
| `tools/` | `balance-harness.js`, `serve.js`, `lint.js`, `gen_*.py` asset generators |

## The model (implement equations verbatim — full spec: `Ecosystem_X_Design_Solidified.md §4`)
- Edge `A → B` means **B eats A**. Stressor edges are non-trophic markers (β=0), skipped in the step.
- **Eq1 carrying capacity:** `K_i(L) = K_max_i × (1 − L/100)^α_i` (L = tile pollution 0–100; high α = fragile keystone).
- **Eq2 population step:** `P_i(t+1) = max(0, P_i + growth − starvation − predation − A_i)`;
  logistic growth, bottom-up starvation from upstream prey, bounded top-down predation.
  Always `max(0,…)`, `round`, and clamp net Δ to ±`MAX_DELTA_FRAC·P_i`.
- **Health** `H` (0–100) is the one visible score → drives tile saturation, audio tier, prices, win/lose.
- Tiers: Toxic <25 · Degraded 25–50 · Recovering 50–75 · Pristine ≥75.
- **Win:** H≥75 for 3 consecutive days, 0 keystone extinct. **Lose:** keystone extinct (priority) OR timer 0.
- **3 interventions:** Bioremediation (−pollution on your tile → Runoff) · Rebalancing (cull an
  over-abundant species → Invasive) · Stabilization (protect a tile → Overharvest). Wrong tool = visible cascade — *that failure is the lesson.*

## Reference docs (read only when the task needs them — keep them out of context otherwise)
- `Ecosystem_X_Design_Solidified.md` — full design, rubric map, equations, roadmap.
- `README.md` — player-facing how-to-play + architecture diagram.
- `.codebuddy/rules/*` & `.codebuddy/skills/*` — legacy CodeBuddy rule/skill packs (mirror this file).
- `security/` + `_headers` — CSP/security-header set and pentest notes.
- `proposal/`, `submission/` — hackathon deliverables (not code).

## Conventions
- Match surrounding style and each file's idiom (ES modules, existing naming/comment density).
- Any gameplay/balance change → re-run `npm test` and confirm win-rate 100%, 0 NaN, 0 Δ-violation.
- Don't add dependencies or a build step. Don't break determinism or the single-viewport law.
</content>
</invoke>

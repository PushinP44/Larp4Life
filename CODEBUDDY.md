# CODEBUDDY.md — Ecosystem X: The Last Balance
## Tencent Cloud Hackathon 2026 | Track 1, Direction 2: Biodiversity & Environmental Protection

Master context for CodeBuddy. Load this at the start of every session.

---

## Quick Start
```
STEP 1: Load this file into CodeBuddy context.
STEP 2: Tell CodeBuddy: "Read CODEBUDDY.md and activate the project agent (.codebuddy/agents/project-agent.md)."
STEP 3: Run the prompt for your current phase from CodeBuddy_Prompt_Roadmap.md.
```

---

## What We're Building
**Ecosystem X: The Last Balance** — a browser-based 2D top-down ecological investigation & restoration game. The player is a Field Agent who scans a collapsing biome, reveals a hidden web of species dependencies (a DAG), deduces the root environmental stressor, and deploys targeted interventions to restore Ecosystem Health before a collapse timer expires.

- **Platform:** HTML5 browser, single static bundle, offline-capable
- **Stack:** Vanilla JS ES6 modules + HTML5 Canvas 2D + plain CSS3
- **Model:** hybrid seeded-procedural — handcrafted biome templates + seeded PRNG + DAG validator (every run unique *and* winnable)
- **Deployment:** EdgeOne Pages (primary) → CloudStudio (fallback)

See `Ecosystem_X_Design_Solidified.md` for the full game design.

---

## Configuration Structure
```
CODEBUDDY.md                       ← master context (this file)
Ecosystem_X_Design_Solidified.md   ← full game design, rubric map, 30-day roadmap
CodeBuddy_Prompt_Roadmap.md        ← sequential copy-paste CodeBuddy production prompts

.codebuddy/
├── rules/
│   ├── 00-project-context.md      ← identity, module map, 5 AI-tool assignments
│   ├── 01-stack-constraints.md    ← hard limits + the 2 architecture laws
│   ├── 02-ecosystem-math.md       ← seeded DAG gen + Eq1/Eq2 + health + extinction
│   ├── 03-state-schema.md         ← canonical GameState schema + mutation rules
│   └── 04-hackathon-rubric.md     ← rubric guard, 5 AI modules, submission checklist
├── skills/
│   ├── project/
│   │   ├── dag-generation.md      ← seeded generator + validator prompt
│   │   ├── ecosystem-step.md      ← daily population step loop prompt
│   │   ├── market-hysteria.md     ← price/dialogue tier state machine prompt
│   │   ├── canvas-viewport.md     ← single-viewport render + scan/edge overlay prompt
│   │   ├── state-mutation.md      ← safe state mutation prompt + templates
│   │   ├── ai-content-gen.md      ← codex + dialogue-pool generation (Genie/WorkBuddy)
│   │   ├── field-report.md        ← end-of-run AI recap (scores Theme + AI, offline/deterministic)
│   │   ├── ai-ecologist.md        ← OPTIONAL opt-in live AI advisor (intelligent NPC) + secure proxy
│   │   └── balance-verify.md      ← headless balance harness prompt
│   └── user/
│       ├── game-dev-patterns.md   ← reusable Vanilla JS / Canvas game patterns
│       └── vanilla-js-module.md   ← ES6 module scaffold generator
├── agents/
│   ├── project-agent.md           ← Ecosystem X specialist (use in this project)
│   └── user-agent.md              ← general game-dev preferences (use everywhere)
└── integrations/
    ├── INTEGRATIONS-DECISION.md   ← Supabase vs CloudBase vs EdgeOne vs Lighthouse
    ├── PLUGINS-SETUP.md           ← plugin/skill install guide (EdgeOne, Miora, VoxFlow, Genie, MPS, HaS)
    └── edgeone-pages.json         ← EdgeOne Pages deployment config
```

---

## Rules Summary (full detail in .codebuddy/rules/)
| Rule | Key constraint |
|---|---|
| 00 Context | Identity, module map, 5 AI-tool assignments |
| 01 Stack | Vanilla JS only · **one viewport** · **determinism (seeded PRNG)** · no live LLM |
| 02 Math | Seeded DAG gen + validator; Eq1/Eq2 verbatim; health tiers; ±0.35·P stability guard |
| 03 State | One `GameState`; always `save()`; clamp ranges; seed written once |
| 04 Rubric | Every feature serves the loop; ship 5 AI modules; flag scope creep |

---

## Skills Quick Reference
**Project skills:** generate the world → `dag-generation` · daily sim → `ecosystem-step` · vendor panic → `market-hysteria` · draw/scan on the map → `canvas-viewport` · change state → `state-mutation` · AI text → `ai-content-gen` · end-of-run recap → `field-report` · live AI advisor (optional) → `ai-ecologist` · balance → `balance-verify`.
**User skills:** any canvas game pattern → `game-dev-patterns` · scaffold a module → `vanilla-js-module`.

---

## Agents Quick Reference
| Agent | Activate when |
|---|---|
| `project-agent.md` | Working on Ecosystem X code |
| `user-agent.md` | Setting general coding preferences (any project) |
Activate in CodeBuddy: "Follow the agent configuration in .codebuddy/agents/project-agent.md".

---

## Plugin & Integration Status
| Tool | Purpose | Status |
|---|---|---|
| CodeBuddy | All code generation | ✅ Active |
| EdgeOne Pages + Security skill | Deploy + CDN + WAF (security AI module) | ⚙️ Set up Phase 0 |
| Miora / Tencent MPS | Tilesets, sprites, key art | ⚙️ Generate from Phase 0 (parallel) |
| VoxFlow Studio | Tier ambient + victory audio | ⚙️ Generate from Phase 0 (parallel) |
| CodeBuddy Genie / WorkBuddy | Codex + dialogue + recap-fragment JSON | ⚙️ Generate Phase 3 |
| Live AI advisor (model via EdgeOne Function) | Intelligent-NPC "Ask the Field Ecologist" (opt-in, offline fallback) | ⚙️ Optional stretch, Phase 3–4 |
| HaS-Anonymizer | Anonymize advisor payloads server-side (security module) | ⚙️ With the advisor proxy, Phase 4 |

---

## Development Phase Tracker
| Phase | Modules | Status |
|---|---|---|
| 1 — Engine core | prng, generator, validator, state, ecosystem + headless harness | ⬜ |
| 2 — Single-viewport play | renderer, input, notebook, scan/edge overlay | ⬜ |
| 3 — Systems & AI | hysteria, vendor, interventions, ai_content (codex/dialogue/art/audio), win/lose | ⬜ |
| 4 — Polish & deploy | asset import, EdgeOne security, balance pass, video, PPT, submit | ⬜ |

---

## Critical Numbers (POST Phase-1 balance pass + difficulty re-tune — harness-verified)
```
Health tiers:  Toxic <25 · Degraded 25–50 · Recovering 50–75 · Pristine ≥75
Win: H≥75 for 3 consecutive days, 0 keystone extinct   |   Lose: keystone extinct (priority) OR timer 0
  (win/lose precedence: keystone extinct → LOSE always; streak≥3 no-extinct → WIN even if timer just hit 0; then timer 0 → LOSE)
Extinction: P==0 for 3 consecutive days
Stability guard: MAX_DELTA_FRAC = 0.35
Food model:  FOOD_SUFFICIENCY (θ) = 0.4 · STARVE_RATE = 0.3
Health penalty: stressorLoadPenalty coefficient = 0.10  (was 0.15 pre-re-tune, 0.25 pre-balance)
Market price ×:  Toxic 1.8 · Degraded 1.3 · Recovering 1.0 · Pristine 0.8
Interventions (base): Bioremediation 60 (−50 L, player tile) · Rebalancing 55 (cull 45%) · Stabilization 150
Economy: Start resources 100 · DAILY_INCOME 60/day · Scanner charges 5
Invasive timer bonus: +30 days (invasive worlds get collapse_timer 70 instead of 40)
Generation: start.stressor [40,60] · start.populationFrac [0.35,0.55] · collapse_timer 40
Verified: 1000-seed sweep  win-rate 100%  first-seed-valid 78.1%  median days-to-win 23  p10/p90 19/26  deterministic.
```

---

## Submission Checklist
- [ ] Project Web Link — `[project].edgeone.app`
- [ ] Game Demo Video — ≤3 min, full loop + 5 AI modules
- [ ] Project Introduction PPT — track + AI-module breakdown + team
- [ ] CodeBuddy Conversation History — exported from all phases (mandatory)
- [ ] Social Post — #CodeBuddy #TencentCloudHackathon (+5)

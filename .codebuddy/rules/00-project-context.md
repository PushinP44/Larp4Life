# Rule 00 — Project Context: Ecosystem X: The Last Balance

## What This Project Is
**Ecosystem X: The Last Balance** is a single-player, offline-capable, browser-based **2D top-down ecological investigation & restoration game** for the **Tencent Cloud Hackathon "AI CAN DO IT" 2026 — Track 1, Direction 2: Biodiversity & Environmental Protection**.

The player is an **Environmental Field Agent** dropped into a biome on the brink of collapse. They explore a top-down grid, **scan** organisms to reveal a hidden web of dependencies (a Directed Acyclic Graph), **deduce** the root environmental stressor, and **deploy targeted interventions** to restore the biome's Ecosystem Health before a collapse timer expires.

**Core thesis:** *Nature is a network — every species is a structural node. Restoring balance means thinking in systems, not symptoms.*

## Design model (READ THIS FIRST)
This build uses a **HYBRID seeded-procedural model**, not pure runtime generation:
- Handcrafted, hand-balanced **biome templates** define node roster, parameter bands, and edge topology.
- A **seeded PRNG** varies parameters/stressors/start populations within validated safe bands → every run feels procedural.
- A **DAG validator** at init guarantees the run is acyclic AND solvable (rerolls bad seeds). No unwinnable games, ever.
The seed is shown to the player and is shareable (reproducible runs). *(A same-seed leaderboard was considered and cut — see INTEGRATIONS-DECISION.md.)*

## Judging Rubric (100 + 5 — always optimize for this)
- **Theme Alignment: 30** — ecological consequences are visible, measurable, and caused by player choices. Wrong interventions trigger a visible secondary cascade.
- **Use of AI Tools: 40** — CodeBuddy for all code + **five AI-created modules** (see below). The rulebook rewards depth across *multiple* modules.
- **Game Quality: 30** — full start-to-finish loop, deterministic & balanced, single-viewport clarity, no tutorial needed.
- **Bonus: +5** — social post with #CodeBuddy #TencentCloudHackathon.

## Project File Map (unified single-viewport architecture)
```
index.html        → HTML5 shell: one <canvas> + HUD overlay + notebook/vendor panels
style.css         → All styling (CSS variables, no frameworks)
main.js           → Entry point, input wiring, game loop, startup sequence
state.js          → Global state singleton: save/load/resetDay, seed
prng.js           → Seeded mulberry32 PRNG (determinism backbone)
generator.js      → Builds the DAG from a biome template + seed; rerolls if invalid
validator.js      → DAG acyclicity + solvability checks
ecosystem.js      → Equations 1 & 2, Ecosystem Health, extinction, daily step loop
hysteria.js       → Market Hysteria state machine (price + dialogue tier swaps)
renderer.js       → Single top-down canvas: tiles, entities, edge-reveal overlay, HUD
input.js          → Player movement, scan, intervention placement
notebook.js       → Field Notebook panel (discovered species/edges, codex)
vendor.js         → Village vendor panel, intervention purchases
ai_content.js     → Loads AI JSON (codex + dialogue pools), art layer + audio crossfade
recap.js          → End-of-run AI Field Report (offline, deterministic; see field-report skill)
ai_ecologist.js   → OPTIONAL opt-in live "Ask the Field Ecologist" advisor (online; offline fallback)
data/biomes.json  → Handcrafted biome templates
data/codex.json   → AI-generated species lore (Genie/WorkBuddy)
data/dialogue.json→ AI-generated Market Hysteria dialogue pools (4 tiers)
data/report-fragments.json → AI-generated end-of-run recap fragments (Genie/WorkBuddy)
functions/ask.js  → OPTIONAL EdgeOne Pages Function: secure proxy for ai_ecologist (holds key, HaS-anonymizes)
```

## Active Deployment
- **Primary:** EdgeOne Pages (staff-recommended) → public `*.edgeone.app` URL + CDN + WAF/security.
- **Fallback:** CloudStudio static hosting.
- See `.codebuddy/integrations/INTEGRATIONS-DECISION.md` for the full platform analysis.

## AI Tool Assignment (FIVE modules — never reassign)
| Module (rubric category) | Tool | Output |
|---|---|---|
| All code generation | **CodeBuddy** | Every line; conversation log exported (mandatory) |
| Worldbuilding & Story | **CodeBuddy Genie / WorkBuddy** | `data/codex.json` + biome backstory + `data/dialogue.json` |
| Game Key Art | **Miora / Tencent Cloud MPS** | Top-down tilesets (healthy/toxic), species sprites, UI, key art |
| AI Audio | **VoxFlow Studio / WorkBuddy** | Health-tier ambient layers + victory theme |
| Intelligent NPC (live, optional) | **Model via EdgeOne Function proxy** | `ai_ecologist.js` — opt-in in-world advisor; offline fallback to codex (see Law 2½, Rule 01) |
| Game Security Architecture | **EdgeOne Security skill + HaS-Anonymizer** | EdgeOne WAF/bot/DDoS (abnormal-behavior detection) + the AI-Ecologist proxy's server-side input validation & HaS anonymization (data-interaction validation) |

# Rule 04 — Hackathon Rubric Compliance

## Before Every Feature — Ask These 3 Questions
1. **Theme Alignment (30):** Does it make the *ecological consequence* of a player choice more visible/measurable? If it could exist in any non-environmental game, it's scope creep.
2. **AI Tools (40):** Can its content (text/art/audio) be AI-generated instead of hardcoded? Is there a clearly labelled `/* AI_INTEGRATION_STUB */` at the wiring point?
3. **Game Quality (30):** Does it serve the core loop below, and is it usable by a first-timer with no tutorial?

## The Core Loop (never break this chain)
```
EXPLORE biome → SCAN entity → REVEAL a hidden dependency edge
   ↑                                        ↓
EVALUATE (map re-renders) ← DEPLOY intervention ← ISOLATE the root stressor
                                                       ↓
                              Ecosystem Health rises → tier improves → WIN
```
Every feature must map to at least one step. A *wrong* intervention must produce a **visible secondary cascade** — that visible consequence is the whole point of the theme score.

## AI Module Checklist (we ship FIVE — the 40-pt dimension rewards multiple)
| Module (rubric line) | Tool | Maintain this |
|---|---|---|
| Code generation | CodeBuddy | Every phase logged in the exported conversation history |
| Worldbuilding & Story | CodeBuddy Genie / WorkBuddy | `data/codex.json` + biome backstory + `data/dialogue.json` populated by AI |
| Game Key Art | Miora / Tencent Cloud MPS | Healthy/toxic tilesets + species sprites + UI + key art; stub in `ai_content.js::initArtLayers()` |
| AI Audio | VoxFlow Studio / WorkBuddy | Tier ambient layers + victory theme; stub in `ai_content.js::initAudio()` |
| Game Security Architecture | EdgeOne Security skill + HaS-Anonymizer | At least one foundational protection — EdgeOne WAF/bot (abnormal-behavior detection) **and** the AI-Ecologist proxy's server-side validation + HaS anonymization (data-interaction validation); documented in PPT with dashboard screenshots |
| *Optional* Intelligent NPC (live) | Model via EdgeOne Function proxy | `ai_ecologist.js` opt-in advisor; offline fallback to codex. Demonstrates "live" AI depth the 40-pt line names — but is non-core and cuttable (Rule 01, Law 2½) |

Keep `/* AI_INTEGRATION_STUB: <tool> — <what> */` comments at each wiring point so judges can verify AI depth in the code.

> ⚠️ **Never nest these `/* … */` stubs inside a JSDoc `/** … */` block** — the stub's `*/` closes the JSDoc early and breaks the file with `Unexpected token '*'` (it killed the whole Phase-2 build once). Put the stub as a **standalone block comment inside the function body**, not in the doc comment above it.

## Scope-Creep Red Flags — pause and flag if you see these
- A mechanic that changes neither `stressor` (L) nor any node `population`.
- An overlay that doesn't show ecosystem data.
- A "free win" item that bypasses environmental investment.
- A *separate gameplay screen* (violates the single-viewport law, Rule 01).
- A new node added without `r`, `K_max`, `alpha`, `weight`, and an edge into the DAG.
- Any **live API / runtime LLM** call **in the simulation, generation, or save path** (violates offline + determinism laws). The *only* permitted network call is the opt-in `ai_ecologist.js` advisor, which is read-only to the sim and falls back offline (Rule 01, Law 2½). A network call anywhere else is a hard reject.

## Submission Materials Checklist
- [ ] Project Web Link — `*.edgeone.app` (or CloudStudio), browser-accessible static bundle
- [ ] Game Demo Video — ≤3 min, shows full loop + the five AI modules
- [ ] Project Introduction PPT — overview, Track 1/Dir 2, AI-module breakdown, team info
- [ ] CodeBuddy Conversation History — exported from every development phase (mandatory)
- [ ] Social Post — #CodeBuddy #TencentCloudHackathon (+5)

## CodeBuddy Conversation-History Protocol
The chat log is a **mandatory, scored submission artifact**. Generate every significant change *inside CodeBuddy* using the prompts in `CodeBuddy_Prompt_Roadmap.md`. If you fix something by hand, paste it back and ask CodeBuddy to "review and confirm this fix" so the log reflects real AI-assisted development depth. Judges read this log to score the 40-pt AI dimension.

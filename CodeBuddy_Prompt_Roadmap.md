# Ecosystem X — CodeBuddy Prompt-Chain Roadmap
**Master orchestration document | Tencent Cloud Hackathon 2026 — Track 1, Direction 2**

Run these prompts **in order**, one per CodeBuddy session-step. Each follows the project format: a **Technical Specification Breakdown** (the logic/state/math the feature needs) and a **CodeBuddy Production Prompt** (copy-paste). The full CodeBuddy conversation history is a mandatory, scored submission item — keep every step.

**Before prompt 1**, tell CodeBuddy:
> "Read CODEBUDDY.md and all files in .codebuddy/rules/ and .codebuddy/agents/project-agent.md. Acknowledge the two architecture laws (one viewport, determinism) and the two equations. Confirm before we start."

Conventions referenced below live in: rules 00–04, and the project skills (`dag-generation`, `ecosystem-step`, `market-hysteria`, `canvas-viewport`, `state-mutation`, `ai-content-gen`, `balance-verify`).

---

# PHASE 1 — ENGINE CORE (Days 1–7)
*Goal: a deterministic, provably-winnable world that runs headless before any pixels exist.*

## Prompt P1 — Seeded PRNG + global state

**TECHNICAL SPECIFICATION BREAKDOWN**
Everything downstream depends on determinism, so the PRNG and the single state object come first. State must be one object with `save()/load()/resetDay()` and a `seed` written once. No randomness may exist outside the PRNG.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `prng.js` and `state.js`.
Context Rules: Follow rule 03 (state schema) exactly; rule 01 (no Math.random, localStorage only).
Copy-Paste Prompt for CodeBuddy:
> "Act as an expert Vanilla-JS (ES6 modules) engineer for our offline browser game Ecosystem X. (1) Create `prng.js` exporting `mulberry32(seed)`, `randInt(rng,lo,hi)`, `randFloat(rng,lo,hi)` — deterministic, no Math.random. (2) Create `state.js` exporting a `GameState` singleton matching the schema in `.codebuddy/rules/03-state-schema.md`, with `save()`/`load()` (localStorage, default-merge for missing fields) and `resetDay()` (clears `world.actionsThisStep`). `meta.seed` is set once and never mutated. Add console.assert tests: same seed → same PRNG sequence; load() returns defaults when storage is empty. Output both complete files."

## Prompt P2 — Biome template + seeded generator + validator

**TECHNICAL SPECIFICATION BREAKDOWN**
The hybrid model: handcrafted bands in `data/biomes.json`, a generator that jitters within bands via the PRNG and builds the DAG, and a validator that guarantees acyclicity **and** solvability (reroll on failure). See the `dag-generation` skill.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `data/biomes.json` (coastal_wetland), `generator.js`, `validator.js`.
Context Rules: Rule 02-A; reuse `ecosystem.js` step in the solvability check (build it next prompt — for now stub the check behind a TODO and wire it in P3).
Copy-Paste Prompt for CodeBuddy:
> "Using the biome template shape and the three-module spec in `.codebuddy/skills/project/dag-generation.md`, create `data/biomes.json` with a `coastal_wetland` template (stressor → seagrass[keystone] → shrimp → painted-stork[keystone], with parameter bands), plus `generator.js` (`generateWorld(template, seed, state)` — jitter via PRNG, place nodes/tiles/edges, set start L and populations, reroll up to 50× on validation failure, else load template defaults) and `validator.js` (`validateWorld(world)` — Kahn topological sort for acyclicity; a solvability hook). Deterministic, offline. Add console.assert: same seed → identical world. Output all files."

## Prompt P3 — Ecosystem math + daily step + health/extinction/win-lose

**TECHNICAL SPECIFICATION BREAKDOWN**
The two equations (verbatim, with the ±0.35·P stability clamp), Ecosystem Health (Eq3), extinction counters, win/lose, and the ordered daily step loop. See the `ecosystem-step` skill.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `ecosystem.js`; finish the validator's solvability check by reusing it.
Context Rules: Rule 02-B/C/D/E verbatim; no reordering; integers for population.
Copy-Paste Prompt for CodeBuddy:
> "Implement `ecosystem.js` per `.codebuddy/skills/project/ecosystem-step.md`: `getCarryingCapacity`, `stepPopulation` (logistic + predation `min(P_j,P_i)` + action, net delta clamped ±0.35·P), `checkExtinction` (P==0 for 3 days ⇒ extinct), `computeHealth` (Eq3), `runDailyStep(state)` in the exact order specified, and `evaluateWinLose(state)`. Then update `validator.js` solvability to run a greedy auto-player through `runDailyStep`. Include the console.assert tests from rule 02-G. Output `ecosystem.js` and the validator patch."

## Prompt P4 — Headless balance harness (Phase-1 exit gate)

**TECHNICAL SPECIFICATION BREAKDOWN**
Prove the design before building UI: 1000 seeds all valid + winnable, no NaN, no clamp violation, determinism holds. See the `balance-verify` skill.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `tools/balance-harness.js` (Node-run, logic only).
Context Rules: No rendering imports. Source of truth for tuning.
Copy-Paste Prompt for CodeBuddy:
> "Write the headless balance harness exactly as specified in `.codebuddy/skills/project/balance-verify.md`: sweep seeds 1..1000, assert validator passes, run a greedy auto-player, assert 100% winnable within the collapse timer, assert no NaN/Infinity and no |delta|>0.35·P, and assert determinism (seed run twice → identical final state). Print a summary table and flag any parameter band to adjust. Output the file and tell me how to run it."

---

# PHASE 2 — SINGLE-VIEWPORT PLAY (Days 8–15)
*Goal: walk the biome, scan, reveal edges, watch the map degrade/recover. One canvas only.*

## Prompt P5 — index.html shell + style.css + canvas renderer

**TECHNICAL SPECIFICATION BREAKDOWN**
One `<canvas>` + overlay container. Renderer is read-only: tiles tinted by L and Ecosystem Health, node sprites scaled by population, revealed edges only, agent, HUD. See `canvas-viewport`.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `index.html`, `style.css`, `renderer.js`.
Context Rules: Architecture Law 1 (no separate screens); CSS variables from `canvas-viewport`; Miora art stub with CSS-color fallback.
Copy-Paste Prompt for CodeBuddy:
> "Create `index.html` (single `<canvas id="game">`, an `<div id="overlay">` for panels, loads `main.js` as a module), `style.css` (use the CSS variables in `.codebuddy/skills/project/canvas-viewport.md`), and `renderer.js` implementing the `render(state, ctx)` spec from that skill: tile grid tinted by stressor L and ecosystem_health (lerpColor), node sprites scaled by population (extinct = faded), the revealed-edge overlay (only `edge.revealed`), the agent, and the HUD bar. Keep an `/* AI_INTEGRATION_STUB: Miora/MPS */` with a CSS-color fallback so missing art never breaks rendering. Render must mutate nothing. Output all three files."

## Prompt P6 — input, movement, scanning, edge reveal + main loop

**TECHNICAL SPECIFICATION BREAKDOWN**
Movement doesn't advance the sim; scanning discovers nodes and reveals an edge when both endpoints are known (the deductive mechanic); End-Day advances the step. See `canvas-viewport` + `state-mutation`.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `input.js`, `main.js` (game loop + wiring), and `revealEdge`/`scanNode` mutators.
Context Rules: input never mutates state directly; all writes via mutators; rAF loop.
Copy-Paste Prompt for CodeBuddy:
> "Implement `input.js` and `main.js` per `.codebuddy/skills/project/canvas-viewport.md`: WASD/arrows move the agent one tile (no sim advance); `S`/click scans an on/adjacent undiscovered node (decrement scanner_charges, set discovered, push to notebook) and reveals an edge when both endpoints are discovered (use a `revealEdge` mutator added to `state-mutation` rules); `E` calls `runDailyStep`. `main.js` boots the world (generator → render), runs a requestAnimationFrame render loop, and wires input via event delegation. Output all files plus the new mutators."

---

# PHASE 3 — SYSTEMS & AI (Days 16–22)
*Goal: full loop — interventions, economy, Market Hysteria, AI content, win/lose.*

## Prompt P7 — interventions + vendor + resource economy

**TECHNICAL SPECIFICATION BREAKDOWN**
Three interventions mutate tiles/nodes (rule 02-F); vendor prices derive from the hysteria factor; resources gate actions. See `state-mutation`.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `vendor.js` + intervention mutators in `ecosystem.js`.
Context Rules: clamp ranges; `state.save()` last; prices = base × factor (never stored multiplied).
Copy-Paste Prompt for CodeBuddy:
> "Create `vendor.js` (the overlay panel: `priceOf(item,state)`, buy handlers via `data-action`, shows the tier dialogue line) and add intervention mutators to `ecosystem.js`: `applyBioremediation(tileId)` (L−40), `applyStabilization(tileId)` (protect/raise effective K weight), `applyRebalancing(nodeId)` (reintroduce if tile L<20, or cull invasive via one-step action spike). All deduct resources (`spendResources`), clamp ranges, and call `state.save()`. Follow `.codebuddy/skills/project/state-mutation.md`. Output the files."

## Prompt P8 — Market Hysteria state machine + dialogue

**TECHNICAL SPECIFICATION BREAKDOWN**
Tier crossings (Toxic/Degraded/Recovering/Pristine) deterministically reset price factor, availability, dialogue pool, audio, tile tint. See `market-hysteria`.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `hysteria.js`; wire `updateTier` into `runDailyStep`.
Context Rules: tier change is the only trigger; deterministic; offline JSON.
Copy-Paste Prompt for CodeBuddy:
> "Implement `hysteria.js` exactly per `.codebuddy/skills/project/market-hysteria.md` (`tierForHealth`, `updateTier`, `priceOf`, `vendorLine`) and call `updateTier(state)` inside `runDailyStep` after health is recomputed. Load dialogue from `data/dialogue.json` (stub a 4-tier fallback inline). Deterministic, no Math.random. Output `hysteria.js` and the one-line `ecosystem.js` wiring change."

## Prompt P9 — AI content wiring (codex, dialogue, art layers, audio)

**TECHNICAL SPECIFICATION BREAKDOWN**
Load offline AI JSON; preload art with graceful fallback; crossfade audio by health. This is the Worldbuilding/Art/Audio AI-module wiring. See `ai-content-gen`.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `ai_content.js` + `notebook.js`; generate `data/codex.json` & `data/dialogue.json`.
Context Rules: offline only; try/catch with fallback; attribution badges.
Copy-Paste Prompt for CodeBuddy:
> "Implement `ai_content.js` and `notebook.js` per `.codebuddy/skills/project/ai-content-gen.md`: `loadContent` (fetch codex/dialogue JSON with fallback), `codexFor(nodeId)`, `initArtLayers()` (preload `/assets`, keep CSS fallback), `initAudio()`+`setHealthAudio(H)` (Web Audio crossfade). `notebook.js` renders discovered nodes + serif codex text + revealed-edge list + AI attribution badges. Keep the four `AI_INTEGRATION_STUB` comments. Output both files. Then give me the Genie prompts (from the skill) to produce `data/codex.json` and `data/dialogue.json`."

## Prompt P10 — start/win/lose cards + end-to-end loop (Phase-3 exit gate)

**TECHNICAL SPECIFICATION BREAKDOWN**
Tie it together: start card (shows seed), win card (days, final H, + the AI Field Report), lose card (the cascade explanation — the teaching moment).

**CODEBUDDY PRODUCTION PROMPT**
Goal: Add cards + wire win/lose flags to UI; verify the full loop.
Copy-Paste Prompt for CodeBuddy:
> "Add start/win/lose overlay cards (built as HTML-string functions, event-delegated buttons, classes in style.css). The start card shows the seed and a 'new seed' option; the lose card explains which keystone collapsed and why (the trophic-cascade lesson); the win card shows day count and final H. Wire them to `state.flags.win/lose`. Then walk me through a full playthrough checklist to confirm explore→scan→reveal→isolate→intervene→restore→win works end to end. Output the card code and the checklist."

### Then build the AI Field Report (recap) inside those cards
Goal: Create `recap.js` + `data/report-fragments.json`.
Context Rules: offline + deterministic (no Math.random, no runtime LLM); renders inside the existing win/lose card (Law 1).
Copy-Paste Prompt for CodeBuddy:
> "Following `.codebuddy/skills/project/field-report.md`, first give me the CodeBuddy Genie prompt to produce `data/report-fragments.json`. Then implement `recap.js` exporting `buildFieldReport(state)` that derives the outcome + lesson from terminal `GameState` (extinct keystones, highest-L stressor node, % edges revealed, whether bioremediation happened), selects fragments deterministically by `meta.seed`, splices in the real numbers, and returns `{title, outcomeLine, lessonLine, stats}` rendered in the serif codex font with a 'Generated by CodeBuddy Genie' badge inside the win/lose card. Add the determinism console.assert. Output the prompt, `recap.js`, and the card wiring."

## Prompt P10b — AI Field Ecologist (OPTIONAL stretch — the intelligent-NPC module)

**TECHNICAL SPECIFICATION BREAKDOWN**
The one sanctioned live-AI feature (Rule 01, Law 2½): an opt-in advisor, read-only to the sim, with an offline codex fallback and a secure EdgeOne Function proxy. Build only if Phase 3 is on schedule; it's the first thing cut. See `ai-ecologist.md`.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Create `ai_ecologist.js` (client overlay) — the proxy `functions/ask.js` is built in P12.
Context Rules: never read seed/RNG, never write/save state; offline fallback must never throw.
Copy-Paste Prompt for CodeBuddy:
> "Following `.codebuddy/skills/project/ai-ecologist.md`, implement `ai_ecologist.js`: a toggleable overlay panel (Law 1) with `initEcologist()` and `async askEcologist(question, state)`. Build a minimal non-PII context from READ-ONLY state (tier, day, discovered species names), POST to `/ask` with a 6s AbortController timeout when `navigator.onLine`, and on any failure fall back to a deterministic `localAnswer(question, state)` using `ai_content.codexFor` + a fixed FAQ map. Show a 'Live: CodeBuddy' / 'Offline guide' badge. It must not read seed/RNG or mutate/save state. Keep the `/* AI_INTEGRATION_STUB */` comment. Output the file."

---

# PHASE 4 — POLISH & DEPLOY (Days 23–30)
*Goal: assets in, secured, balanced, deployed, submission materials done. Days 28–30 = buffer.*

## Prompt P11 — asset import, balance pass, cross-browser hardening

**TECHNICAL SPECIFICATION BREAKDOWN**
Drop in Miora art + VoxFlow audio, re-run the balance harness with final numbers, fix any browser quirks. Graceful degradation everywhere.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Integrate assets, finalize tuning, harden.
Copy-Paste Prompt for CodeBuddy:
> "I've added the Miora images to `/assets/images` and VoxFlow audio to `/assets/audio`. Update `ai_content.js` paths, confirm the CSS/audio fallbacks still work if a file is missing, re-run the balance harness mentally against these final numbers and flag any tuning, and review the code for cross-browser issues (Web Audio autoplay-unlock on first input, canvas DPI scaling). Output the patches."

## Prompt P12 — EdgeOne deploy + security module (+ optional AI-Ecologist proxy)

**TECHNICAL SPECIFICATION BREAKDOWN**
Deploy the static bundle to EdgeOne Pages, enable WAF/bot for the Security AI module, and — if you built the advisor in P10b — add its secure EdgeOne Function proxy (this Function is the data-interaction-validation half of the Security module). Leaderboard is **not** built. See `INTEGRATIONS-DECISION.md`.

**CODEBUDDY PRODUCTION PROMPT**
Goal: Deployment config + optional `functions/ask.js` proxy.
Context Rules: core game stays offline/static; the model key is a Function env var, never in the client; the advisor fails gracefully offline.
Copy-Paste Prompt for CodeBuddy:
> "Using `.codebuddy/integrations/edgeone-pages.json` and `INTEGRATIONS-DECISION.md`, give me the exact EdgeOne Pages deploy steps (static, build=none, output=`.`) and how to enable WAF + bot management for the Game Security Architecture module. THEN (optional Tier B, only if `ai_ecologist.js` exists) implement `functions/ask.js` per `.codebuddy/skills/project/ai-ecologist.md`: accept POST `{tier,day,discoveredSpecies,question}`, reject/validate + rate-limit abusive input, run the payload through HaS-Anonymizer, call the model using a key read from a Function env var (never echoed), and return `{answer}`. Output the deploy steps and the Function."

---

## Submission wrap (after P12)
- [ ] Deploy → copy the `*.edgeone.app` link.
- [ ] Record the ≤3-min demo: explore → scan → reveal a cascade → intervene → restore → win; show codex, art, audio crossfade, vendor panic.
- [ ] PPT: overview, Track 1/Dir 2, the AI modules with screenshots — CodeBuddy log, Genie JSON (codex + dialogue + **recap fragments**), Miora art, VoxFlow audio, EdgeOne WAF, and (if built) the **AI Field Ecologist** intelligent-NPC + its HaS-anonymized proxy — plus team info.
- [ ] Export the **CodeBuddy conversation history** (all 12 prompts) — mandatory.
- [ ] Social post with `#CodeBuddy #TencentCloudHackathon` (+5).

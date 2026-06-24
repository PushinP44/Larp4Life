# ECOSYSTEM X: THE LAST BALANCE
### Project Proposal — AI CAN DO IT · Tencent Cloud Hackathon 2026
**Track 1 — Little Red Flower (Social Impact) · Direction 2 — Biodiversity & Environmental Protection**

> *Nature is a network. Every species is a structural node. Pull one thread and the web unravels — restoring balance means thinking in systems, not symptoms.*

---

## 1. Executive Summary

**Ecosystem X: The Last Balance** is a browser-based, top-down ecological **investigation-and-restoration** game. You play an Environmental Field Agent dropped into a collapsing Southeast-Asian coastal wetland. You **explore** the biome as a character, **discover** hidden species, **reveal** the invisible food web that binds them, **deduce** the root environmental stressor, and **deploy** targeted interventions to restore Ecosystem Health before a collapse timer expires — then you get **graded** and hit **New Seed** to do it faster.

It runs entirely in the browser as a **single static, offline-capable bundle** (Vanilla JS + HTML5 Canvas, zero frameworks, zero build step). Every line of code was generated with **CodeBuddy**, and AI is woven through **five creative modules** — worldbuilding, key art, audio, security, and an optional intelligent NPC.

The game is **already built, playable end-to-end, balanced, and visually polished** — not a concept. A headless balance harness proves **100% of 1,000 procedurally-generated worlds are winnable**, and the full loop (explore → discover → deduce → intervene → restore → win) has been verified live with zero runtime errors.

**Why it wins:** it turns the *invisible* nature of biodiversity collapse into a *visible, playable, deductive system* — the exact educational payload Track 1 rewards — while hitting AI depth across five modules (the 40-point lever) and shipping a genuinely fun, replayable, polished loop (the 30-point Game-Quality lever).

---

## 2. The Problem & Social Impact

Biodiversity loss is accelerating, yet public engagement is blocked by one thing: **systemic collapse is invisible.** People grasp isolated issues — a polluted river, an endangered bird — but very few intuit how a *minor disruption in one trophic layer cascades through an entire food web*. You can't see a trophic cascade. You can't feel a keystone species' weight until it's gone.

Ecosystem X makes the invisible visible. By turning conservation biology into real-time, playable feedback loops, players build **systemic thinking** — the actual skill conservation requires:

- **Trophic cascades** — pollute a producer's habitat and watch the collapse propagate *upward* to the apex predator.
- **Keystone fragility** — lose the Painted Stork and the run can become unrecoverable; the point-of-no-return is felt, not lectured.
- **Root-cause vs. symptom** — the game punishes treating symptoms (propping up a consumer) instead of the driver (the nutrient runoff at the source).
- **Real-world grounding** — the in-game species are real (seagrass *Halophila/Enhalus*, giant tiger prawn *Penaeus monodon*, Painted Stork *Mycteria leucocephala*) and the codex carries real data points (29% global seagrass decline since 1879; 2.5M ha of SE-Asian mangrove converted to aquaculture; ~450k tonnes of reactive nitrogen exported annually to the Mekong Delta).

This is **green development as a system you operate**, not a poster you read — directly fulfilling Direction 2's call to "communicate the concept of green development and inspire environmental awareness and action."

---

## 3. The Game

### 3.1 Core loop
```
   EXPLORE the wetland (walk/click as the Field Agent)
        ↓
   DISCOVER species by walking into their territory ("!" alert)
        ↓
   REVEAL the hidden food web (dependency edges)
        ↓
   DEDUCE the root stressor (the pollution source)
        ↓
   INTERVENE — bioremediate the right tiles, on a budget, against the clock
        ↓
   RESTORE — watch the biome visibly recover · WIN at Pristine health
        ↓
   GRADE (S–F) → New Seed → "one more run, faster"
```

### 3.2 What makes it fun (the engagement pillars)
- **Exploration & discovery** — wander a living, atmospheric biome; wildlife is hidden until you're near, then a bouncing **"!"** marker + a discovery chime + a scale-pop reward your curiosity.
- **Investigation / deduction** — the food web is hidden; you reconstruct it by finding species, then reason backward to the cause. Detective satisfaction.
- **Strategy under pressure** — a finite resource budget, a ticking collapse timer, and the threat of *irreversible* keystone extinction make every intervention a real decision.
- **Visible cause-and-effect payoff** — your actions transform the world on screen: the biome shifts from desaturated brown to vibrant green, the audio brightens, the village's economy (Market Hysteria) recovers, and a personalized AI Field Report recaps *your* run.
- **Mastery & replayability** — seeded procedural worlds (every run unique *and* guaranteed winnable), a letter grade to beat, and one-click **New Seed** = the roguelite "one more run" loop.
- **Meaning** — it's *about* something real, which gives the challenge emotional weight beyond points.

*Genre comparables: the systems-restoration satisfaction of **Terra Nil** × the top-down exploration of a classic adventure, with a deductive food-web puzzle at its core.*

### 3.3 The ecological model (the scientific heart)
A seeded **Directed Acyclic Graph** of trophic dependencies is built at world-init and driven by two immutable equations:

- **Eq. 1 — Dynamic carrying capacity:** `K_i(L) = K_max_i × (1 − L/100)^α_i` (pollution `L` on a tile crushes capacity; high α = fragile keystone).
- **Eq. 2 — Discrete population step** with a **bottom-up food-dependency term** (a consumer starves when its prey collapses — the cascade engine), **top-down predation**, a player-action term, and a ±35% stability clamp.

Edge semantics, food/predation direction, and the cascade were corrected to be **scientifically faithful** (energy flows prey→predator; pollution starves the chain upward) — so the simulation teaches the *right* lesson, and a biology-literate judge sees correct ecology, not hand-waving.

---

## 4. Use of AI — the 40-point centerpiece

AI is not an assistant here; it is the **creative engine**, applied with depth across **five modules** (the rulebook explicitly rewards breadth across modules):

| # | Module (rubric line) | Tool | What it produced | Status |
|---|---|---|---|---|
| 1 | **All code generation** | **CodeBuddy** | 100% of the game (engine, renderer, UI, AI wiring); full conversation history is a mandatory scored artifact | ✅ done |
| 2 | **Worldbuilding & Story** | **CodeBuddy Genie** | `codex.json` (real species + real data points), `dialogue.json` (4-tier villager voice), `report-fragments.json` (personalized end-of-run Field Report) | ✅ done |
| 3 | **Game Key Art** | **Miora / Tencent MPS** | Tilesets (healthy/toxic), species sprites, UI, key art | ✅ tiles/sprites generated · ⚙️ props/keyart on programmatic placeholders (Miora auth outage) — drop-in swap pre-final |
| 4 | **Audio** | **VoxFlow Studio** | 4 health-tier ambient loops + victory sting; runtime crossfade by health; synthesized UI SFX (discover/intervene/tier-up) | ✅ done |
| 5 | **Game Security Architecture** | **EdgeOne Security + HaS-Anonymizer** | WAF/bot/DDoS on the static deploy (abnormal-behavior detection); the optional AI-Ecologist proxy adds server-side input validation + anonymization (data-interaction validation) | ⚙️ Phase 4 (deploy) |
| + | *Optional* **Intelligent NPC** | Model via EdgeOne Function | "Ask the Field Ecologist" — opt-in live advisor, read-only to the sim, with an offline codex fallback (the "intelligent NPC" the rubric names) | ⚙️ stretch |

**AI authorship is auditable.** Every generation prompt is preserved in `ai-prompts/`, the data artifacts are in `data/`, and the CodeBuddy conversation history is exported as the scored submission item. Where a tool was temporarily unavailable (Miora), we shipped a cohesive programmatic placeholder behind the *same filenames* — the pipeline is drop-in, so the AI art upgrades with zero code changes before final submission.

---

## 5. Technical Architecture

- **Stack:** Vanilla JS ES6 modules · HTML5 Canvas 2D · plain CSS3. **No frameworks, no npm, no build step, no TypeScript.**
- **Single offline static bundle** → deploys to **EdgeOne Pages** as `*.edgeone.app` (CloudStudio fallback). Runs fully offline once loaded.
- **Determinism (the backbone):** a seeded `mulberry32` PRNG drives all generation; **`Math.random()` never appears** in generation or simulation. Same seed + same inputs ⇒ identical run, every browser, every time. This makes the game testable, balanceable, and the seed shareable.
- **Hybrid seeded-procedural model:** handcrafted, hand-balanced biome templates + seeded parameter jitter + a **DAG validator** that guarantees every world is acyclic *and* solvable (rerolls bad seeds). Infinite-feeling variety, zero unwinnable runs.
- **Single unified viewport (Architecture Law 1):** one canvas; environmental change renders on the map tiles themselves — no separate screens.
- **Read-only renderer (Rule 03):** all state lives in one `GameState`; the renderer never mutates it; every mutator ends with `save()`.

### Proven, not promised
A headless **balance harness** sweeps 1,000 seeds every run and asserts the design before the demo:

| Metric | Result |
|---|---|
| Win-rate (greedy optimal player) | **100.0%** |
| First-seed-valid rate | **78.1%** (fast generation, real variety) |
| Defaults-fallback rate | **0.0%** |
| Median days-to-win | **23 of 40** (humane margin) |
| NaN / Infinity / clamp violations | **0** |
| Determinism (re-run identical) | **pass** |

The full playable loop — movement, discovery, food-web reveal, intervention, recovery to Pristine, win card + grade, instant replay — has been **verified live in-browser with zero console errors.**

---

## 6. What's Built & Verified (current state)

This is a working game, not slides. Verified this build:

- ✅ Deterministic, balanced engine (1,000-seed harness green) with the faithful trophic-cascade model
- ✅ Single-viewport renderer with a **living biome**: health-driven vibrancy (sick brown → lush green), animated water with **rounded, foam-banked shorelines**, a **deterministic decorative-prop layer** (trees/reeds/lilypads/rocks/flowers), atmosphere particles, vignette, scan ripples
- ✅ **Directional animated avatar** (adventurer/field-explorer), **hold-to-walk** and **click-to-walk** at a steady cadence (no warping), with smooth tile-gliding
- ✅ **Walk-to-discover** exploration — species hidden until you enter their territory ("!" marker), auto-discovered on proximity, food-web edges revealed deductively
- ✅ Real **AI worldbuilding** in-game: species codex (real species + data), Market-Hysteria villager dialogue by tier, personalized end-of-run **Field Report** (spliced from Genie fragments)
- ✅ **Engagement layer:** run **grade (S–F)** + flavour line, **New Seed / Retry Seed** instant replay, and "juice" — discovery chime + scale-pop, intervention clean-burst, tier-up flash
- ✅ Market Hysteria economy (vendor prices + villager mood shift with ecosystem health)
- ✅ Tier audio crossfade + victory sting + synthesized UI SFX
- ✅ Graceful degradation everywhere (missing asset/JSON/audio never breaks the game)

---

## 7. Why This Wins — Differentiators

1. **It teaches the exact thing the theme is about.** The core *mechanic is the lesson* — systemic thinking, made visible. Most Track-1 entries bolt a message onto a generic game; here the game *is* the message.
2. **AI depth across five modules,** with auditable authorship — the strongest possible read on the 40-point dimension, not a single bolt-on.
3. **Scientifically faithful,** not decorative — real species, real data, a correctly-directed cascade. Survives expert scrutiny.
4. **Provably polished & winnable** — a 1,000-seed harness + live verification means no broken builds at the roadshow, and a humane difficulty so first-timers can actually win and feel the payoff.
5. **Genuinely replayable** — seeded worlds + grade + one-click new run = the "one more go" loop that keeps judges (and players) engaged past the 3-minute mark.
6. **Zero-friction deployment** — a single static bundle on Tencent's own EdgeOne (SE-Asia CDN), instant global load, offline-capable, security module built in.

---

## 8. Submission Plan & Roadmap

**Deployment is intentionally held until after the demo** (so the demo is recorded against a frozen, perfect build); everything else is staged:

- **Now → demo:** record the ≤3-min **demo video** (explore → discover a cascade → bioremediate → restore → win → grade → New Seed); finalize the **PPT** (track, AI-module breakdown, team).
- **Pre-final:** regenerate props/keyart/avatar via **Miora** (drop-in by filename) to maximize the Key-Art AI module; optional **AI-Ecologist** intelligent-NPC stretch.
- **Deploy:** **EdgeOne Pages** + enable **WAF/bot/DDoS** (Security module evidence; screenshot the dashboard for the PPT); CloudStudio fallback.
- **Bonus:** social post with **#CodeBuddy #TencentCloudHackathon** (+5).

### Submission checklist (rulebook §5)
- [ ] Project Web Link — `*.edgeone.app` (browser-accessible static bundle)
- [ ] Game Demo Video — ≤3 min, full loop + the five AI modules
- [ ] Project Introduction PPT — overview, Track 1/Dir 2, AI-module breakdown, team
- [ ] CodeBuddy Conversation History — exported from all phases (mandatory)
- [ ] Social Post — `#CodeBuddy #TencentCloudHackathon` (+5)

---

## 9. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| "Where's the *live* AI?" (core is offline/deterministic by design) | The determinism is a *strength* (winnable, polished, reproducible); live AI lives in the optional intelligent-NPC + dev-time generation of all content. Pre-empted directly on a PPT slide. |
| Art tier (programmatic placeholders) below pixel-art bar | Pipeline is drop-in by filename; regenerate via Miora pre-final — instant upgrade, no code change. |
| Balance feels too hard/easy at the roadshow | 1,000-seed harness is the source of truth; tuned to a humane median (23/40). Re-runnable any time. |
| Deploy snag at the last minute | EdgeOne is a static-bundle deploy (no build); CloudStudio fallback; URL locked early. |
| CodeBuddy-history authenticity | All game code authored/reviewed in CodeBuddy; generation prompts preserved in `ai-prompts/`; history re-exported at submission. |

---

## 10. The Ask

Ecosystem X is **complete, verified, and demo-ready today**, with a clear, low-risk path through deployment and the submission materials. It is the rare Track-1 entry where the **theme, the AI depth, and the game quality reinforce each other** instead of competing.

We're asking judges to advance a project that does what the hackathon set out to prove: **AI can build a complete, polished, meaningful game — and make the invisible systems that sustain our world something a player can finally see, touch, and restore.**

---

*Appendices (in repo): full game design (`Ecosystem_X_Design_Solidified.md`), rubric guard (`.codebuddy/rules/04-hackathon-rubric.md`), AI authorship evidence (`ai-prompts/`), generated content (`data/`), and the build itself.*

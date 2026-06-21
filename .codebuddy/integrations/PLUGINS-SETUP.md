# CodeBuddy Plugins, Skills & Integrations Setup
## Ecosystem X: The Last Balance — Hackathon Configuration

This is the install/setup guide for every external tool the project uses. Each maps to a rubric line. Generate art/audio/text **at development time**; the game ships them as static assets/JSON (no runtime API).

---

## Plugin / skill install order (in the CodeBuddy IDE)

| # | Tool | Rubric module | When | Status |
|---|---|---|---|---|
| 1 | **CodeBuddy** (IDE extension / plugin / CLI) | Worldbuilding & complex gameplay code | Day 1 | core |
| 2 | **EdgeOne Pages + EdgeOne Security Acceleration Skill** | Game Security Architecture + deploy | Phase 0 | mandatory |
| 3 | **Miora** (+ optional **Tencent Cloud MPS** for enhance) | Game Key Art | Phase 0 → import Phase 4 | mandatory |
| 4 | **VoxFlow Studio** (or WorkBuddy audio skill) | AI Audio | Phase 0 → import Phase 4 | mandatory |
| 5 | **CodeBuddy Genie / WorkBuddy** | Worldbuilding & Story (codex + dialogue + recap fragments) | Phase 3 | mandatory |
| 6 | **Live model + EdgeOne Pages Function** | Intelligent NPC ("Ask the Field Ecologist") | Phase 3–4 | optional (chosen stretch) |
| 7 | **HaS-Anonymizer** (SkillHub) | Game Security — anonymize advisor payloads in the Function | Phase 4 | with the advisor |

> Install plugins via the CodeBuddy IDE extension marketplace / ClawHub / SkillHub. Verify exact names and availability in your region's console.

---

## 1. CodeBuddy (core — mandatory)
- All code is generated here using `CodeBuddy_Prompt_Roadmap.md`.
- **The exported conversation history is a scored submission item.** Keep every phase's chat. Generate, don't hand-edit silently; if you fix by hand, paste back and ask CodeBuddy to "review and confirm."

## 2. EdgeOne Pages + Security Acceleration Skill (mandatory)
- **Purpose:** public `*.edgeone.app` URL, SE-Asia CDN, WAF/DDoS → claims the **Game Security Architecture** AI module.
- **Setup:**
  1. Create an EdgeOne Pages project; deploy a placeholder `index.html` now to lock the URL.
  2. Use `.codebuddy/integrations/edgeone-pages.json` as your settings reference (framework = static, build = none, output = `.`).
  3. Enable **WAF + bot management**; screenshot the dashboard for the PPT.
  4. (Optional advisor) add an EdgeOne Pages **Function** (`functions/ask.js`) as the AI-Ecologist proxy — see `INTEGRATIONS-DECISION.md` + section 6 below. (Leaderboard was cut.)
- Fallback host: **CloudStudio** static hosting.

## 3. Miora — game key art (mandatory)
- **Integration point:** `ai_content.js::initArtLayers()`; renderer falls back to CSS colors if an image is missing (game never breaks).
- **Generate (top-down, single style):**
  ```
  tiles_healthy.png    — vibrant wetland tiles (water/marsh/land), top-down
  tiles_toxic.png      — same tiles, desaturated/algal/oil-slick variants
  sprite_seagrass.png  sprite_shrimp.png  sprite_heron.png  (+ faded "extinct" variants)
  agent.png            — the Field Agent
  ui_pack.png          — HUD meter, notebook icons, edge/scan markers
  keyart.png           — title/cover key art for the PPT & social post
  ```
- **Prompt template:**
  ```
  Style: stylized 2D top-down game art, cohesive palette, Southeast-Asian coastal wetland.
  Asset: [name]. Variant: [healthy: lush emerald | toxic: brown/grey, pollution cues].
  Transparent PNG, consistent tile size [e.g. 64×64], readable at small scale.
  ```
- Optionally pass outputs through **Tencent Cloud MPS** (super-resolution / color enhance).

## 4. VoxFlow Studio — AI audio (mandatory)
- **Integration point:** `ai_content.js::initAudio()` + `setHealthAudio(H)` crossfades by tier.
- **Generate (seamless loops):**
  ```
  amb_toxic.mp3       — sparse, distorted, oppressive
  amb_degraded.mp3    — tense, thin
  amb_recovering.mp3  — warming, organic textures returning
  amb_pristine.mp3    — bright, full natural ambience
  sting_win.mp3       — short uplifting victory theme
  ```
- **Prompt template:** `Loopable [X]s ambient track for a wetland ecology game at the [tier] health tier; mood [...]; instruments [...]; seamless loop.`

## 5. CodeBuddy Genie / WorkBuddy — worldbuilding & story (mandatory)
- Generates `data/codex.json` (species lore) and `data/dialogue.json` (Market Hysteria pools).
- Exact prompts: `.codebuddy/skills/project/ai-content-gen.md`.
- Save the prompts you used in `/ai-prompts/` as authorship evidence.

## 6. AI Field Ecologist — intelligent NPC advisor (optional, chosen stretch)
- **Integration point:** `ai_ecologist.js` (client overlay) + `functions/ask.js` (EdgeOne Function proxy). Spec: `.codebuddy/skills/project/ai-ecologist.md`.
- **What it is:** an opt-in in-world ecologist the player can ask for advice. Online → secure proxy → model; offline/error → deterministic codex fallback. Read-only to the simulation (Rule 01, Law 2½), so the deterministic core is untouched.
- **Setup:**
  1. Add `functions/ask.js` to the EdgeOne Pages project; set the model API key as a **Function env var** (never in the client).
  2. Run payloads through **HaS-Anonymizer**; validate + rate-limit requests (abnormal-behavior detection).
  3. Screenshot the Function config + EdgeOne security dashboard for the PPT.
- **Rubric value:** this is the "intelligent NPC" the 40-pt line names, AND its proxy is the Game Security Architecture evidence (data-interaction validation + anonymization).

## 7. HaS-Anonymizer — security (with the advisor)
- Anonymize the advisor's request payload server-side inside `functions/ask.js` before any logging/forwarding — no PII leaves the edge.
- Needed only if you ship the AI Ecologist (Tier B). The mandatory Security floor (EdgeOne WAF/bot/DDoS) stands on its own without it.

---

## Asset / data folder structure (must match code paths)
```
assets/
├── images/  tiles_healthy.png tiles_toxic.png sprite_*.png agent.png ui_pack.png keyart.png
└── audio/    amb_toxic.mp3 amb_degraded.mp3 amb_recovering.mp3 amb_pristine.mp3 sting_win.mp3
data/
├── biomes.json     (handcrafted templates — see dag-generation skill)
├── codex.json      (Genie)
└── dialogue.json   (Genie)
ai-prompts/         (the exact Miora/VoxFlow/Genie prompts — authorship evidence)
```
**Graceful degradation:** every asset/JSON load is wrapped in try/catch with a built-in fallback, so a missing file degrades visuals/audio but never breaks gameplay.

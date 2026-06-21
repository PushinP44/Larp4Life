# Rule 01 — Stack & Architecture Constraints (HARD LIMITS — Never Violate)

## Permitted Technologies
- **JavaScript:** ES6 modules (import/export) — Vanilla JS only
- **HTML:** HTML5 semantic elements + a single `<canvas>` (Canvas 2D API)
- **CSS:** Plain CSS3 with custom properties (variables)
- **Storage:** `localStorage` only — no IndexedDB, no cookies, no server calls in the core game
- **Canvas:** Native `CanvasRenderingContext2D` — no WebGL, no Three.js, no Pixi
- **Audio:** Web Audio API (`AudioContext`) — no Howler.js, no Tone.js

## Absolutely Forbidden
- ❌ React, Vue, Angular, Svelte, or any UI framework
- ❌ npm, webpack, Vite, Rollup, or any build tool / bundler
- ❌ TypeScript (must run directly in the browser, uncompiled)
- ❌ jQuery or any DOM library
- ❌ External CDN script imports in the core game code
- ❌ Server-side code / Node runtime / backend APIs inside the game loop
- ❌ `eval()`, `Function()`, dynamic code execution
- ❌ **Runtime NLP or live LLM/API calls in the simulation, generation, or save path** — all *gameplay* AI content is pre-baked into offline JSON. (One tightly-scoped, opt-in advisory exception is defined below.)
- ❌ Anything requiring `npm install` to run the game (dev-only tools like the Node balance harness are fine)

## Two Architectural Laws (specific to Ecosystem X)

### Law 1 — ONE unified top-down viewport
There is exactly **one** gameplay canvas. There are **no separate screens** for scanning, intervening, or "fishing."
- Scanning, intervention, and environmental change all happen **on the main map**.
- Environmental shifts (degradation/recovery) render **directly on the map tile textures** — desaturation, decay sprites, retint by Ecosystem Health.
- The only DOM overlays permitted: top **HUD bar**, toggleable **Field Notebook** panel, **vendor** interaction panel, and start/win/lose **cards**. These overlay the canvas; they never replace it.

### Law 2 — Determinism
- Same seed + same player inputs ⇒ identical outcome, every time.
- All randomness flows through `prng.js` (seeded mulberry32). **Never call `Math.random()`** in generation or simulation.
- The population loop is a discrete mathematical time-step (Rule 02). No frame-rate-dependent simulation.

## The Single Live-AI Exception — "Ask the Field Ecologist" (Law 2½)
Exactly **one** optional, opt-in feature may touch the network: an in-world **AI Field Ecologist**
advisory panel (`ai_ecologist.js`). It exists to satisfy the rubric's "intelligent NPC" language
without compromising the deterministic, offline core. It is bound by **four non-negotiable rules**:

1. **Read-only to the simulation.** It may *read* a tiny, non-PII context (current tier, names of
   *discovered* species, day count) to ground its answer. It must **never** read the RNG/seed or
   **write** any field of `GameState` — not population, not `L`, not resources, not the save. It
   cannot change win/lose or determinism. The sim is byte-identical whether or not it's ever used.
2. **Graceful offline fallback.** If offline, the proxy is unreachable, or the call errors/timeouts,
   it falls back to a **pre-baked, deterministic** answer (keyword match against `data/codex.json`).
   The game is fully playable, start to finish, with the network disconnected.
3. **No secrets in the client.** The model key lives only in an **EdgeOne Pages Function**
   (`functions/ask.js`) acting as a proxy. The static bundle never embeds a key or a model SDK.
   The proxy runs the question through **HaS-Anonymizer**, validates/rate-limits it (abnormal-
   behavior detection), then calls the model. This *is* the Game Security Architecture module.
4. **Non-core / cuttable.** It's a stretch feature. If Phase 4 runs short, it's the first thing cut,
   and cutting it changes nothing about the core loop. Never let it block the deterministic build.

Any proposal to let this feature (or any network call) influence the simulation, the seed, or the
save is a **hard reject** — re-read Law 2.

## File Structure Rules
- Every JS file uses `export`/`import`. `index.html` loads `main.js` as `type="module"`.
- No inline `<script>` except the module entry point. No inline `<style>` in JS-generated HTML.
- All media in `/assets/`; all data tables in `/data/*.json`.
- Filenames lowercase-hyphen (existing canonical names in Rule 00 file map are fixed).

## Why These Constraints Matter
Submission requires a directly accessible static URL (EdgeOne Pages / CloudStudio). The whole game must run as a static bundle with zero server dependency and full offline capability. Any build step or live API breaks the deployment and the "offline-capable" promise.

## When CodeBuddy Suggests a Framework or a Live API
Stop. Re-read this rule. Find the Vanilla JS / pre-baked-JSON equivalent. If none exists in under ~30 lines, raise it as a scope discussion — never silently introduce a dependency or a network call.

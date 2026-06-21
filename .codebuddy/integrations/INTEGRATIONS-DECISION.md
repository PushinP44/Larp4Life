# Integrations Decision — Ecosystem X
## Supabase vs CloudBase vs EdgeOne Pages vs Tencent Lighthouse

> **TL;DR (decisions locked):** Deploy on **EdgeOne Pages** (staff-recommended, mandatory floor). The game is offline-capable and needs **no backend to win**.
> - **Same-seed leaderboard: SKIPPED** (decided 2026-06-21). It added schedule risk for marginal score; polish + balance + demo win more in a 1-month window.
> - **EdgeOne Pages Functions: KEPT, but repurposed** — instead of a leaderboard, the one Function (`functions/ask.js`) is the **secure proxy for the optional AI Field Ecologist** advisor. It holds the model key, runs payloads through **HaS-Anonymizer**, and validates/rate-limits them. This Function *is* the Game Security Architecture module's data-interaction-validation evidence.
> - **Tencent CloudBase** remains the documented step-up only if you later want a real DB/auth. **Reject Supabase and Lighthouse.**

*(Tencent product feature sets change — confirm exact KV/Functions limits in the EdgeOne / CloudBase console before relying on them.)*

---

## Why deployment platform matters to the score
- **Project Requirements (rulebook §3):** must submit a directly accessible browser URL. EdgeOne Pages and CloudStudio both satisfy this; EdgeOne is staff-recommended.
- **Use of AI Tools (40 pts)** explicitly lists a **Game Security Architecture** module ("EdgeOne Security Acceleration Skill") needing ≥1 foundational protection (identity auth / data-interaction validation / abnormal-behavior detection). EdgeOne's WAF + bot management is the cheapest way to claim this module.
- **Game Quality (30 pts):** fast global load (SE-Asia CDN) and zero downtime read as polish.

---

## Decision matrix

| Platform | Role it could play | Fit for Ecosystem X | Rubric value | Verdict |
|---|---|---|---|---|
| **EdgeOne Pages** | Static hosting + CDN + WAF/DDoS; optional edge Functions + KV | Perfect — static bundle, SE-Asia CDN matches the wetland setting, security out of the box | Deploy URL **+ Security AI module** | ✅ **PRIMARY (mandatory)** |
| **EdgeOne Pages Functions** | Serverless proxy on the *same* platform | Used for the **AI-Ecologist proxy** (holds the model key, HaS-anonymizes, validates) | +AI depth (intelligent NPC) +Security (server-side validation) | ✅ **Used for the advisor proxy** (leaderboard cut) |
| **Tencent CloudBase** | Serverless BaaS: NoSQL DB + anonymous auth + cloud functions | Works, Tencent-native (judges favor the Tencent stack); more setup than EdgeOne KV | +Game Quality; stronger "cloud integration" narrative | 🟡 **Step-up alternative** if you want richer data/auth |
| **Supabase** | Postgres + instant REST/Realtime + auth | Technically excellent DX, but **not** Tencent; weakest "Tencent ecosystem" story for this hackathon | Neutral-to-slightly-negative narrative | ❌ Only if the team already knows it well |
| **Tencent Lighthouse** | Lightweight cloud VPS (Linux box) | Requires server admin, a runtime, ports, patching — overkill for a static game; adds failure surface | None; risks the "offline/static" promise | ❌ **Reject** |

---

## Recommended architecture (two tiers)

### Tier A — Ship this no matter what (MVP)
```
Player ──HTTPS──▶ EdgeOne Pages (static bundle: index.html + JS + /assets + /data)
                   └─ EdgeOne WAF + DDoS + bot management  ← Security AI module evidence
```
- Zero backend. Fully offline-capable once loaded. `localStorage` holds the save.
- Claim the **Game Security Architecture** module: enable WAF, screenshot the dashboard, document it in the PPT and leave an `/* AI_INTEGRATION_STUB: EdgeOne/HaS — security */` note in code.

### Tier B — Optional "intelligent NPC" advisor proxy (the chosen stretch)
```
Advisor panel ──POST {tier,day,species,question}──▶ EdgeOne Pages Function (functions/ask.js)
                                                       ├─ HaS-Anonymizer (strip PII)
                                                       ├─ validate + rate-limit (abnormal-behavior)
                                                       └─ model call (key server-side) ──▶ { answer }
Offline / failure ──▶ deterministic codex fallback (game never breaks)
```
- The **AI Field Ecologist**: an opt-in, read-only-to-the-sim advisor that demonstrates the "intelligent NPC" the 40-pt line names — without touching the deterministic core (Rule 01, Law 2½; skill `ai-ecologist.md`).
- **Security tie-in (scores the Security AI module):** the Function validates every request server-side, rate-limits abusive input (abnormal-behavior detection), and HaS-anonymizes the payload (data-interaction validation + no PII). The model key never reaches the client.
- If you later want richer server logic, swap the EdgeOne Function for a **Tencent CloudBase** cloud function — same diagram.
- **(Leaderboard: not built — see TL;DR.)**

---

## What this means for the code (keep the game pure)
- The **core game stays 100% static and offline** (Rule 01). The advisor is an **isolated, optional module** (`ai_ecologist.js`) that fails gracefully: if the network/Function is unavailable, it falls back to pre-baked codex answers and the game plays normally.
- No secrets in the client. The Function (`functions/ask.js`) holds the model key. The static bundle never imports a backend SDK or a model key into the game loop.

---

## Action items
1. **Now (Phase 0):** create the EdgeOne Pages project; deploy a "hello world" `index.html` to lock the URL early.
2. **Phase 4:** enable WAF + bot management; capture dashboard screenshots for the PPT.
3. **Tier B = AI Ecologist advisor (decided: build if time allows, cut first if not).** Add the EdgeOne Function `functions/ask.js` with HaS anonymization + server-side validation; keep the model key as a Function env var. The advisor must fall back offline so the core game is unaffected. (Leaderboard: not built.)

# Project Skill: Market Hysteria State Machine

**Trigger:** Building `hysteria.js` and `data/dialogue.json` (Phase 3). This is the deterministic social-impact mechanic.

## Concept
Ecosystem Health crosses milestone tiers → the village vendor deterministically changes prices and swaps its dialogue pool. No runtime text generation: all lines are pre-baked AI JSON. This makes the social/economic consequence of ecological state *visible*, scoring Theme Alignment.

Tiers: **Toxic** H<25 · **Degraded** 25–50 · **Recovering** 50–75 · **Pristine** ≥75.

## Skill Prompt (paste into CodeBuddy)
```
Implement hysteria.js for Ecosystem X — a deterministic Market Hysteria state machine.

export function tierForHealth(H): returns 'Toxic'|'Degraded'|'Recovering'|'Pristine'.

export function updateTier(state):
  1. const tier = tierForHealth(state.meta.ecosystem_health)
  2. if tier === state.meta.market_tier: return  // only act on a crossing
  3. state.meta.market_tier = tier
  4. state.vendor.price_factor = PRICE_FACTOR[tier]   // Toxic 1.8, Degraded 1.3, Recovering 1.0, Pristine 0.8
  5. state.vendor.available = AVAILABILITY[tier]      // e.g. fewer items in Toxic
  6. (renderer reads market_tier to retint tiles / trigger ai_content audio crossfade)
  7. state.save()

export function priceOf(itemId, state):
  return Math.round(state.vendor.base_prices[itemId] * state.vendor.price_factor)

export function vendorLine(state):
  // pick a deterministic line from the tier's pre-baked pool using a day-seeded index
  const pool = DIALOGUE[state.meta.market_tier]
  return pool[state.meta.day_count % pool.length]

Load DIALOGUE from data/dialogue.json. Pure, deterministic, offline. No Math.random.
```

## `data/dialogue.json` shape (AI-generated via Genie — see ai-content-gen skill)
```json
{
  "Toxic":      ["The water's dead. Tools cost more — everyone's panic-buying.", "..."],
  "Degraded":   ["Still bad, but I've seen worse. Prices are steep.", "..."],
  "Recovering": ["Fish are coming back. Folks are calmer now.", "..."],
  "Pristine":   ["The marsh is alive again. Take what you need, cheap.", "..."]
}
```

## Rules
- Tier change is the ONLY trigger — never re-apply on every frame.
- Prices are derived (`base × factor`), never stored multiplied (avoids drift).
- 4+ lines per tier so repetition isn't obvious.
- Keep it deterministic: same state ⇒ same price and same line.

# Rule 03 — State Schema Integrity

## The Golden Rule
**All game state lives in one object — `GameState` in `state.js`.** No module stores persistent data anywhere else. No module-level mutable variables that survive a reload. If it must persist, it goes through `GameState.save()`.

## Canonical Schema (authoritative — never add fields without noting them here)
```json
{
  "meta": {
    "seed": 0,                         // integer; the run is fully reproducible from this
    "biome_template": "coastal_wetland",
    "day_count": 1,
    "collapse_timer": 30,              // days remaining before lose
    "health_streak": 0,               // consecutive days at H>=75 (win needs 3)
    "ecosystem_health": 50.0,         // 0–100, derived each step
    "market_tier": "Degraded"         // Toxic|Degraded|Recovering|Pristine
  },
  "player": {
    "name": "Field Agent",
    "resources": 100,                 // spent on interventions
    "tile_x": 4, "tile_y": 6,         // position on the grid
    "scanner_charges": 5
  },
  "world": {
    "grid": { "w": 16, "h": 12 },
    "tiles": {
      "<tileId>": {
        "id": "string", "x": 0, "y": 0,
        "type": "water|land|marsh|source",
        "stressor": 0.0,              // L, float 0–100 (0 = pristine)
        "protected": false            // set by Habitat Stabilization
      }
    },
    "nodes": {
      "<nodeId>": {
        "id": "string", "name": "string",
        "kind": "stressor|producer|consumer|predator",
        "keystone": false,
        "tileId": "string",
        "population": 0,              // integer >= 0
        "r": 0.0, "K_max": 0, "alpha": 0.0, "weight": 1.0,
        "status": "stable|endangered|reintroduced|extinct",
        "discovered": false,
        "extinction_counter": 0      // 0–3
      }
    },
    "edges": [
      { "from": "<nodeId>", "to": "<nodeId>", "beta": 0.0, "revealed": false }
    ],
    "actionsThisStep": { "<nodeId>": 0 }   // player removal A_i; cleared by resetDay()
  },
  "notebook": {
    "discovered_nodes": [],          // nodeIds the player has scanned
    "revealed_edges": []             // "from->to" keys the player has observed
  },
  "vendor": {
    "base_prices": { "bioremediation": 120, "rebalancing": 90, "stabilization": 150 },
    "price_factor": 1.3,             // set by Market Hysteria tier
    "available": ["bioremediation", "rebalancing", "stabilization"]
  },
  "flags": { "win": false, "lose": false }
}
```

## Mutation Rules
1. **Never mutate state in render/input code.** `renderer.js`, `input.js`, `notebook.js` may READ state; all WRITES go through dedicated functions in `ecosystem.js`, `hysteria.js`, `vendor.js`, or `generator.js`.
2. **Call `state.save()` as the last line of every mutating function.** No exceptions.
3. **`actionsThisStep` is a per-step accumulator** — cleared by `state.resetDay()`. Never read as history.
4. **`stressor` (L) is a float clamped to [0,100]** on every write: `Math.max(0, Math.min(100, v))`.
5. **`population` is a non-negative integer:** `Math.max(0, Math.round(v))`.
6. **`status` is an enum:** only `stable | endangered | reintroduced | extinct`.
7. **`seed` is written once at generation** and never mutated mid-run (changing it would break determinism).

## Determinism contract
The full world is reconstructable from `meta.seed` + `meta.biome_template` + the ordered list of player actions. Keep it that way: if a feature needs new randomness, draw it from `prng.js`, not `Math.random()`.

## Adding new fields
1. Add to the schema above. 2. Add default in `state.js` default object. 3. Make `load()` backward-compatible (merge defaults for missing fields). 4. Document type + valid range here.

## Forbidden patterns
```javascript
// ❌ module-level mutable persistence
let scannedCount = 0;
// ❌ direct mutation without save
GameState.player.resources -= 50;
// ❌ randomness outside the PRNG
const r = Math.random();
// ✅ correct
function spendResources(amount, state) {
  if (state.player.resources < amount) throw new Error(`Need ${amount}, have ${state.player.resources}`);
  state.player.resources -= amount;
  state.save();
}
```

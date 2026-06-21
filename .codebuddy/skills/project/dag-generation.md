# Project Skill: Seeded DAG Generation + Validation

**Trigger:** Building `prng.js`, `generator.js`, `validator.js`, or the biome template format (Phase 1).

## Skill Prompt (paste into CodeBuddy)
```
Implement the hybrid seeded-procedural world generator for Ecosystem X across three modules.

prng.js — export mulberry32(seed) returning a function () => float in [0,1).
  Also export randInt(rng, lo, hi) and randFloat(rng, lo, hi). NO Math.random anywhere.

generator.js — export generateWorld(template, seed, state):
  1. rng = mulberry32(seed)
  2. Instantiate nodes from template.nodes. For each, jitter r/K_max/alpha/beta within
     the template's safe bands using rng (e.g. r = randFloat(rng, band.r[0], band.r[1])).
  3. Assign each node to a tile; place stressor sources; set start populations and tile L
     from the template's start ranges via rng.
  4. Build directed edges (stressor→producer→consumer→predator) with beta weights.
  5. Call validateWorld(); if it fails, seed++ and retry (max 50). After 50, load template
     defaults (guaranteed-valid fallback baked into the template).
  6. Write the result into state.world and state.meta.seed.

validator.js — export validateWorld(world) → { ok, reason }:
  - ACYCLIC: topological sort (Kahn's algorithm) must consume all nodes.
  - SOLVABLE: simulate a greedy auto-player (cheapest health-raising intervention each day)
    for collapse_timer days; ok only if it can reach H>=75 sustained 3 days with no keystone
    extinction. Reuse ecosystem.js runDailyStep so the check matches real gameplay exactly.

Constraints: deterministic, offline, Vanilla JS ES6. Add console.assert: same seed → same
world; 1000 seeds all valid after reroll.
```

## Biome template shape (`data/biomes.json`)
```json
{
  "coastal_wetland": {
    "grid": { "w": 16, "h": 12 },
    "nodes": [
      { "id": "n_runoff", "kind": "stressor", "name": "Agricultural Runoff" },
      { "id": "n_seagrass", "kind": "producer", "name": "Seagrass", "keystone": true,
        "bands": { "r": [0.12,0.18], "K_max": [400,600], "alpha": [0.7,1.0], "weight": [2,3] } },
      { "id": "n_shrimp", "kind": "consumer", "name": "Mangrove Shrimp",
        "bands": { "r": [0.10,0.16], "K_max": [250,400], "alpha": [1.2,1.8], "weight": [1,1.5] } },
      { "id": "n_heron", "kind": "predator", "name": "Painted Stork", "keystone": true,
        "bands": { "r": [0.05,0.09], "K_max": [60,120], "alpha": [2.0,2.6], "weight": [3,4] } }
    ],
    "edges": [
      { "from": "n_runoff", "to": "n_seagrass", "betaBand": [0,0] },
      { "from": "n_seagrass", "to": "n_shrimp", "betaBand": [0.02,0.05] },
      { "from": "n_shrimp", "to": "n_heron", "betaBand": [0.03,0.06] }
    ],
    "start": { "stressor": [70,90], "populationFrac": [0.15,0.4] },
    "defaults": { "_comment": "a known-valid fully-specified world used if 50 rerolls fail" }
  }
}
```

## Why hybrid (explain to teammates/judges)
Pure runtime generation risks unwinnable or unbalanced worlds you can't fix before the deadline. Handcrafted bands + a solvability validator give procedural *variety* with a *guarantee* every run is winnable and polished — and the seed is shareable (leaderboard hook).

## Flags
- Any `Math.random()` → determinism break.
- Validator that checks acyclicity but not solvability → ships unwinnable seeds.
- Object-key iteration order assumed stable across engines → sort keys before generating.

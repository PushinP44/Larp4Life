# Project Skill: Run Ecosystem Step

**Trigger:** Implementing or debugging the daily simulation tick in `ecosystem.js`.

## Skill Prompt (paste into CodeBuddy)
```
Implement/fix the daily ecosystem step for Ecosystem X in ecosystem.js as runDailyStep(state).

Order of operations (do not reorder):
1. For every node in state.world.nodes (skip kind === 'stressor' and status === 'extinct'):
     call stepPopulation(nodeId, state)   // Equation 2 below
2. For every node: call checkExtinction(nodeId, state)
3. Recompute state.meta.ecosystem_health (Equation 3 below)
4. Update Market Hysteria tier (call hysteria.js updateTier(state))
5. state.meta.day_count += 1; state.meta.collapse_timer -= 1
6. Update win/lose flags (Rule 02-D)
7. state.resetDay()  // clears world.actionsThisStep
8. state.save()

Equation 1 — Carrying capacity (use verbatim):
  K_i(L) = K_max_i × (1 − L/100) ^ alpha_i      // L = tile.stressor of the node's tile

Equation 2 — Population step (use verbatim per Rule 02-C, WITH food + stability clamp):
  Edge A→B means B eats A. Skip stressor edges (beta=0) in BOTH terms below.
  growth     = K>0 ? r·P·(1 − P/K) : −P
  foodFactor = hasFood ? clamp( mean over edges j→node of (P_j / K_max_j) / 0.4, 0, 1) : 1   // bottom-up
  starvation = 0.3 · P · (1 − foodFactor)
  predation  = Σ over edges where e.from===node of  e.beta · min(P_to, P)                    // top-down
  action     = state.world.actionsThisStep[node] ?? 0
  delta      = clamp(growth − starvation − predation − action, −0.35·P, +0.35·P)
  P_next     = max(0, round(P + delta))
  // FOOD_SUFFICIENCY=0.4, STARVE_RATE=0.3, MAX_DELTA_FRAC=0.35 — balance knobs (harness tunes).

Equation 3 — Ecosystem Health:
  H = 100 · ( Σ w_i · clamp(P_i / K_i(L=0), 0, 1) ) / Σ w_i  −  stressorLoadPenalty
  clamp H to [0,100]; stressorLoadPenalty = 0.15 · mean(stressor-source tile L)   // 0.15 = post-balance value

Constraints: no Math.random(); all reads/writes via state; integers for population.
Add console.assert tests for: Eq1 collapse at high alpha, P never negative, |delta|<=0.35·P.
[Paste current ecosystem.js here if fixing]
```

## When to use
- First implementation of `runDailyStep` (Phase 1, Prompt P3).
- A population won't recover/decline correctly, or oscillates (check the ±0.35·P clamp).
- Adding a node/edge and verifying it enters the loop.

## Common mistakes to flag
- Linearizing `(1 − L/100)^alpha` instead of the power function.
- **Wrong coupling direction:** food must read edges `j→node` (prey upstream); predation must read edges `node→k` (predators downstream). Swapping them inverts the ecology (Rule 02-C).
- Forgetting to skip stressor edges in the food/predation loops (a stressor is not food and not a predator).
- Predation without `min(P_to, P)` → negative/oscillating populations.
- Dropping the stability clamp → discrete-step blow-up.
- Forgetting `state.resetDay()` (actions won't clear) or `state.save()`.
- Using `Math.random()` anywhere (breaks determinism — use `prng.js`).

# Project Skill: Balance Verification (Headless Harness)

**Trigger:** End of each phase; whenever a run feels "too easy" or "impossible." This is the source of truth for final tuning (Rule 02-G).

## Skill Prompt — build the harness (paste into CodeBuddy)
```
Write a headless balance harness for Ecosystem X that runs WITHOUT any rendering
(pure logic: imports prng.js, generator.js, validator.js, ecosystem.js, hysteria.js).

The harness must, for seeds 1..1000:
1. Generate a world (coastal_wetland template) and assert validator passes
   (acyclic AND solvable). Log any seed that needed a reroll.
2. Run a "greedy optimal" auto-player: each day, apply the cheapest intervention
   that most increases Ecosystem Health; advance runDailyStep.
3. Record: did it WIN before collapse_timer hit 0? min days to win, final H,
   any keystone extinction, any NaN/Infinity, any |delta|>0.35·P violation.
4. Assert: 100% of seeds are winnable by the greedy player within the timer.
   Assert determinism: running seed S twice yields identical final state.

Output a summary table: win-rate, median days-to-win, min/max H, failures.
Flag any seed that is unwinnable or numerically unstable, and suggest which
parameter band (r, K_max, alpha, beta, intervention cost) to adjust.
```

## Manual sanity checks (do by hand before the harness exists)
- **Day-1 affordability:** start 100 resources. Cheapest intervention = Rebalancing 90. Player can act on day 1 but not spam — correct tension.
- **Keystone recovery:** a fragile keystone (alpha≈2.5) at L=85 has `K ≈ K_max·0.0087` → near-zero. Player MUST bioremediate (L→45→5) before reintroduction can hold. Confirms the "fix the root, not the symptom" lesson.
- **Market hysteria pressure:** in Toxic tier prices ×1.8 → interventions cost more exactly when the player most needs them. Confirms it raises stakes without a hard lock (passive resource trickle still lets them dig out).
- **No soft-lock:** there must always be at least one affordable action that raises H. The harness's greedy player proves this for every seed.

## Gate criteria — "PASSED" requires ALL of these, not just post-reroll winnability
A 100% win-rate alone is **not** a pass: the generator rerolls until it finds a winnable seed, so win-rate
is ~always 100% and hides over-tuning. The gate must also assert difficulty is humane:
- **First-seed-valid rate ≥ ~60%.** Below that, most raw seeds are unwinnable-by-greedy → slow generation,
  variety risk, and (since a human is worse than the greedy bot) a near-zero human win-rate. (Observed once
  at **12.2%** — brutally over-tuned; the headline failure mode.)
- **Median days-to-win ≤ ~70% of collapse_timer** (e.g. ≤ ~21 of 30), with p90 leaving real slack. The greedy
  bot is near-optimal; a human needs headroom for exploration, scanning, and mis-targeting.
- Remember the oracle **auto-targets the optimal tile**; the human must navigate there. The bot's win-rate is
  the *optimistic* bound — leave generous margin.

## What to flag
- Win-rate < 100% on the 1000-seed sweep → generator bands too harsh, or validator's solvability check is wrong.
- First-seed-valid rate < 60% → difficulty too high; raise DAILY_INCOME, lower bioremediation cost / raise its
  effect, lower the stressor penalty, or lower start.stressor. Re-run.
- Median days-to-win < 6 (too easy) or > 0.7·collapse_timer (too tight).
- Any NaN/Infinity → division by `K=0` not guarded in Eq2.
- Determinism failure → a stray `Math.random()` or unordered object iteration.

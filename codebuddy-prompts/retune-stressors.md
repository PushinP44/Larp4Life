# PENDING CodeBuddy prompt — Stressor re-tune (native-recovery fix + human-fairness pass)

Status: **NOT YET RUN** (CodeBuddy credits ran out mid-task). Paste this verbatim into CodeBuddy
when credits are restored. After it returns, the harness is the gate — run
`node tools/balance-harness.js` and check BOTH the optimal AND the new handicapped tables.

Context recap: the previous pass hit 100% bot-winnable but by nerfing the invasive into irrelevance,
inflating invasive worlds' timer +30, and special-casing their starting stressor — incoherent pacing and
invasive+overharvest still human-unwinnable. Root cause: crashed natives recover too slowly. This prompt
fixes the recovery, restores the invasive as a real threat, removes the special-cases, and adds a harness
pass that MEASURES human-fairness directly.

---

```
RE-TUNE — fix the root cause (native recovery), restore the invasive as a real-but-fair threat, and
REMOVE the invasive special-cases. The previous pass hit 100% bot-winnable but by (a) nerfing the invasive
into irrelevance (β 5× too low — it's a "red herring", does ~0.26 dmg/day vs native pops in the hundreds),
(b) inflating invasive worlds' timer +30 (54-day grinds), and (c) special-casing invasive worlds' starting
stressor. The result is incoherent pacing and invasive+overharvest is still HUMAN-unwinnable (bot needs
0.77×timer playing perfectly). Root cause we never fixed: a crashed native takes 50+ days to recover, so
ANY early setback is unwinnable without timer inflation. Fix the recovery, not the symptom.

CONSTRAINTS unchanged: vanilla JS ES6, offline, seeded prng only (NO Math.random), Rule 03, determinism.
The harness stays the source of truth — keep 100% winnable AND now provably human-fair (see §5).

=== 1. REMOVE the special-cases (generator.js) ===
  • Delete the +30 (or +N) collapse_timer bonus for invasive worlds. ONE uniform timer for all worlds.
  • Delete the reduced native-tile-stressor hack for invasive worlds. ALL worlds use the same
    start.stressor band. No per-stressor generation special-casing.
  • Set the uniform collapse_timer = 45 (up from 40 to give a little breathing room now that invasive is a
    real threat again) — tune 42–48 if needed, but it's the SAME for every world.

=== 2. FIX native recovery (the actual root cause) — ecosystem.js + biomes.json ===
  Raise the native node reproduction-rate (r) bands (producer/consumer/predator) so a crashed native
  (P ≈ 10% of K_max, its tile stressor cleared to ~0) rebounds to ≥75% of K_max within ~15–20 days.
  Starting point: scale native r bands up ~1.5–1.7× (e.g. ~[0.10–0.18] → ~[0.16–0.28]); let the harness
  settle exact values. Verify the discrete-logistic stays stable (no oscillation/overshoot; the ±0.35·P
  clamp holds; 0 NaN). If the food-cascade (STARVE_RATE) delays staggered recovery too much, you may lower
  STARVE_RATE slightly as a secondary lever — but r is the primary one.

=== 3. RESTORE the invasive as a real-but-fair threat — biomes.json + ecosystem.js ===
  • Raise invasive βBand back to a MEANINGFUL level: target so an UNMANAGED invasive visibly drives its
    target native down ~20–40% over ~10 days, but a player who culls keeps the native alive. Starting
    point βBand ≈ [0.025, 0.05] (was [0.008,0.018]; original [0.04,0.08] was too aggressive — land between).
  • Reduce/REMOVE the flat invasive health penalty in computeHealth (was 5×, then 2×). The invasive's
    impact on H should come from REALLY suppressing natives (ecological), not an artificial subtraction.
    Set the flat penalty to 0 (or ≤1×) and let β do the work.
  • Invasive r / K_max / alpha / populationFrac can stay near current softened values or partially restore
    — the harness decides; β + native-recovery are the levers that matter.

=== 4. Greedy player (validator.js + harness) — simplify ===
  Remove the invasive-timer-bonus logic (no longer exists). Keep the diagnose→matched-counter→reintroduce
  strategy (reintroduce maps to the real rebalancing action — keep it).

=== 5. NEW — measure human-fairness directly (tools/balance-harness.js) ===
  Add a SECOND pass, runHandicappedPlayer(seed): identical to the optimal greedy player EXCEPT it simulates
  human imperfection, deterministically (no RNG):
    (a) DIAGNOSIS_LAG = 3: it applies NO useful counter for the first 3 days (simulating figuring out the
        stressor — it may walk/observe but not fix).
    (b) Every 4th intervention it would make, it instead applies a WRONG-tool action (spends the resources,
        no useful effect) — simulating misdiagnosis.
  Run all 1000 seeds through it. Report HANDICAPPED win-rate overall + per-combo, alongside the optimal
  table. ASSERT: handicapped win-rate ≥ 80% overall AND ≥ 70% per combo. THIS is the real human-fairness
  gate — a world only "passes" if an imperfect player can usually win it.

=== 6. SUCCESS CRITERIA (all must hold) ===
  • Optimal-bot win-rate = 100%, deterministic, 0 NaN, 0 |Δ|>0.35·P, 0 keystone extinctions.
  • Every combo's OPTIMAL bot-median days-to-win between ~0.30 and ~0.65 × timer — i.e. human-fair (≤0.65)
    AND non-trivial (≥0.30; if a combo trivially solves <0.30, the challenge evaporated — nudge it back).
  • Handicapped win-rate ≥ 80% overall, ≥ 70% per combo (§5).
  • Consistent pacing: no combo's median is more than ~1.6× another's (no 24-vs-54 split).
  • NO regression on runoff / overharvest (currently good) and NO per-stressor generation special-cases.

=== OUTPUT + VERIFY ===
  Output patched data/biomes.json, ecosystem.js, generator.js, validator.js, tools/balance-harness.js
  (+ state.js/vendor.js if timer/knobs surface there). Update .codebuddy/rules/02-ecosystem-math.md §F & §D
  to the final values. Run `node tools/balance-harness.js` and paste the FULL output — BOTH the optimal and
  the new handicapped tables.
```

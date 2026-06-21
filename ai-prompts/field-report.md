## Tool: CodeBuddy Genie
## Date: 2026-06-22
## Output file(s): data/report-fragments.json

### Prompt
Write reusable end-of-run "Field Report" fragments for the wetland game. Output a JSON object whose
keys are the situations below; each holds 3 interchangeable one-sentence variants (field-biologist tone,
factual, encouraging, never preachy). Variants may use placeholders {days} {keystone} {stressor}
{health} {edgePct} which the game splices in.
Keys: "win_fast","win_close","lose_timeout","lose_keystone","lesson_root_cause","lesson_symptom_only",
"lesson_shallow_scan","lesson_deep_scan".
Shape: { "win_fast":["...","...","..."], ... }

### Notes
Output used verbatim → data/report-fragments.json (8 keys × 3 variants). Consumed by ai_content.js
getFieldReportFragment(): pick one outcome key + one lesson key, select a variant deterministically by
meta.seed, splice in real {days}/{keystone}/{stressor}/{health}/{edgePct}. Placeholders verified to match
the splice fields in the Step-2 wiring.

## Tool: CodeBuddy Genie
## Date: 2026-06-22
## Output file(s): data/dialogue.json

### Prompt
Write villager-vendor dialogue for an ecological restoration game with 4 ecosystem-health tiers.
Give 5 short lines (1 sentence each) per tier, reflecting the community's economic mood as the wetland's
health changes — panic and scarcity when sick, relief and generosity when healthy. Everyday human voice,
no preaching. Output ONE JSON object:
  { "Toxic":[5 lines], "Degraded":[5], "Recovering":[5], "Pristine":[5] }

### Notes
Output used verbatim → data/dialogue.json (4 tiers × 5 lines). Feeds hysteria.js getVendorDialogue();
inline VENDOR_DIALOGUE kept as the offline fallback. Lines double as bioindicator hints (heron sightings,
seagrass smell, nesting pairs) which reinforce the Theme without preaching.

## Tool: CodeBuddy Genie
## Date: 2026-06-22
## Output file(s): data/codex.json

### Prompt
Generate educational codex entries for an ecological game set in a Southeast-Asian COASTAL WETLAND.
For each species below write 2–3 sentences (≤60 words) that: (1) name the real species + scientific
name, (2) describe one real biological adaptation, (3) state the specific human activity that threatens
it with a concrete real-world data point where possible. Tone: factual field-biologist logbook, slightly
melancholic, never preachy.
Output ONE JSON object keyed by these exact node ids (values are plain strings):
  n_seagrass  — Seagrass (Halophila/Enhalus), keystone primary producer
  n_shrimp    — Mangrove/banana shrimp (Penaeus), trophic-bridge consumer
  n_heron     — Painted Stork (Mycteria leucocephala), keystone apex predator
  n_runoff    — Agricultural runoff (nitrogen/phosphorus loading), the primary stressor
Shape: { "n_seagrass": "...", "n_shrimp": "...", "n_heron": "...", "n_runoff": "..." }

### Notes
Output used verbatim → data/codex.json. Each entry carries a real species + scientific name + a concrete
data point (29% global seagrass decline; 2.5M ha mangrove→aquaculture conversion; ~30% Painted Stork
colony decline; ~450k t/yr reactive nitrogen to the Mekong Delta). Wired into ai_content.js
getAICodexEntry() with the inline SPECIES_CODEX constant kept as the offline fallback.

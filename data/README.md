# data/ — offline game data (no runtime API)

All generated **at development time** and shipped as static JSON. The game `fetch`es these
locally; it never calls a live model (Rule 01/02). Generate each via CodeBuddy so it lands in
the scored conversation history; save the prompt used into `../ai-prompts/`.

| File | Source | Built in | Spec |
|---|---|---|---|
| `biomes.json` | handcrafted by you (+ CodeBuddy) | Phase 1, Prompt P2 | `.codebuddy/skills/project/dag-generation.md` |
| `codex.json` | CodeBuddy Genie / WorkBuddy | Phase 3, Prompt P9 | `.codebuddy/skills/project/ai-content-gen.md` |
| `dialogue.json` | CodeBuddy Genie / WorkBuddy | Phase 3, Prompt P9 | `.codebuddy/skills/project/ai-content-gen.md` |
| `report-fragments.json` | CodeBuddy Genie / WorkBuddy | Phase 3, Prompt P10 | `.codebuddy/skills/project/field-report.md` |

Every loader uses try/catch with a small inline fallback, so a missing file degrades content
but never breaks gameplay.

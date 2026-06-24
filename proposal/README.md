# Proposal — Ecosystem X: The Last Balance

The complete proposal package for the AI CAN DO IT · Tencent Cloud Hackathon 2026 submission
(Track 1 / Direction 2 — Biodiversity & Environmental Protection).

## Contents
| File | What it is |
|---|---|
| **[PROPOSAL.md](PROPOSAL.md)** | The full proposal — problem, game, AI depth, architecture, what's built, why it wins, roadmap, risks, the ask. **Start here.** |
| **[EXECUTIVE-SUMMARY.md](EXECUTIVE-SUMMARY.md)** | One-page pitch for quick reads / the PPT opener. |
| **[RUBRIC-SCORECARD.md](RUBRIC-SCORECARD.md)** | Honest, evidence-backed self-assessment against the 100+5 rubric, with the highest-ROI gaps to close. |

## Supporting material (elsewhere in the repo)
- `../Ecosystem_X_Design_Solidified.md` — full game design + the two equations + 30-day roadmap
- `../.codebuddy/rules/` — the architecture laws, ecosystem math, state schema, rubric guard
- `../ai-prompts/` — AI authorship evidence (the exact generation prompts)
- `../data/` — AI-generated content (`codex.json`, `dialogue.json`, `report-fragments.json`)
- `../submission/` — PPT outline, demo-video shot list, social-post draft
- `../tools/balance-harness.js` — the 1,000-seed proof of balance

---

## Note on `headroom` and `gstack` (the two requested repos)

Both were cloned and inspected. **Neither is a game library, and neither belongs inside Ecosystem X** — integrating them would break the game and violate the hackathon's hard constraints. Honest assessment so the decision is documented:

- **headroom** (`headroomlabs-ai/headroom`) — "the context-compression layer for AI agents." A Python/TypeScript library + proxy + MCP server that compresses LLM tokens at dev time. Useful for running long AI-agent sessions cheaply; **irrelevant to a browser game's runtime** and incompatible with the no-npm/offline/static-bundle architecture.
- **gstack** (`garrytan/gstack`) — Garry Tan's "Claude Code skills + headless browser." A **Claude Code** dev-workflow toolkit (role-based slash commands: CEO/eng/design/review/QA/security/release) installed into `~/.claude/skills`, requires Bun. A development *workflow* tool — **not** something you ship in a game, and it targets Claude Code while this hackathon **mandates CodeBuddy** as the dev tool.

**Why they were not "implemented into" the project:**
1. **Architecture conflict** — Ecosystem X is Vanilla JS, no frameworks/npm/build, single offline static bundle (Rule 01). Both repos need npm/Bun/build steps/servers.
2. **Category mismatch** — both are dev/AI-agent *tooling*, not game functionality. There is nothing to "implement" into the game.
3. **Hackathon rules** — the required dev tool is CodeBuddy; gstack is Claude-Code-specific.
4. **Risk** — forcing them in would break a working, verified, polished build.

**If you want them anyway (legitimate, separate from the game):**
- **gstack** can be installed as *your own* dev-workflow toolkit (`git clone … ~/.claude/skills/gstack && ./setup`) — but it runs a side-effecting setup script and needs Bun, and it's for Claude Code, not CodeBuddy. Confirm before installing; I won't run arbitrary installers automatically.
- **headroom** is only relevant if you're optimizing token cost on long agent sessions — not part of this submission.

Their useful *ideas* (rigorous role-based review: CEO/eng/design/QA/security/release) are already reflected in how this project was built and verified, and in the rubric scorecard above.

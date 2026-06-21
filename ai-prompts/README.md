# AI Authorship Evidence — Ecosystem X

This folder is **scored evidence**. The 40-pt "Use of AI Tools" dimension and the mandatory
*CodeBuddy Conversation History* submission both reward provable AI authorship. Drop the exact
prompt you used into the matching file every time you generate an asset or content blob, so the
chain "prompt → AI tool → shipped artifact" is auditable by the judges.

## What goes here (one file per AI module)

| File | AI tool | Produces | Rubric module |
|---|---|---|---|
| `worldbuilding-codex.md` | CodeBuddy Genie / WorkBuddy | `data/codex.json` (species lore) | Worldbuilding & Story |
| `worldbuilding-dialogue.md` | CodeBuddy Genie / WorkBuddy | `data/dialogue.json` (Market-Hysteria pools) | Worldbuilding & Story |
| `field-report.md` | CodeBuddy Genie / WorkBuddy | `data/report-fragments.json` (end-of-run recap) | Worldbuilding & Story |
| `keyart-miora.md` | Miora (+ Tencent Cloud MPS enhance) | `assets/images/*` tilesets, sprites, UI, key art | Game Key Art |
| `audio-voxflow.md` | VoxFlow Studio | `assets/audio/*` tier ambience + victory sting | Audio Performance |
| `security-edgeone.md` | EdgeOne Security Skill / HaS-Anonymizer | WAF config + the AI-Ecologist proxy's server-side validation & anonymization | Game Security Architecture |

## Format for each file
```
## Tool: <name + version/region>
## Date: <YYYY-MM-DD>
## Output file(s): <path>

### Prompt
<the verbatim prompt you pasted>

### Notes
<seed/settings, what you kept vs regenerated, any manual touch-ups>
```

The canonical generation prompts already live in `.codebuddy/skills/project/ai-content-gen.md`
and `.codebuddy/skills/project/field-report.md` — copy them here *as used* (with your tweaks)
so this folder reflects reality, not the template.

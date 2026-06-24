## Tool: Miora (intended) — programmatic placeholder currently in repo
## Date: 2026-06-24
## Output file(s): assets/images/keyart.png (1600×1000, 16:9 cover)
##                 assets/images/prop_*.png (8 decorative props)
##                 assets/images/player.png (4×4 directional walk spritesheet) + player_concept.png

### Status (read first — honesty for the 40-pt Game-Key-Art module)
The Miora image service returned an invalid-JWT (server-side auth) error during this build, so the cover
art, decorative props, and player avatar were produced as **cohesive programmatic placeholders** via
`tools/gen_keyart.py` and `tools/gen_player.py` (composed from the project's palette + the AI-generated
tile/sprite set). These are drop-in by filename. **Before final submission, regenerate via Miora using the
prompts below and overwrite the same filenames** — the renderer needs no code changes, and it converts the
Key-Art module from "programmatic placeholder" to genuine AI-generated art.

The AI-generated assets already shipped (Miora batch + VoxFlow) remain: the healthy/toxic **tilesets**,
the four **species sprites** (+ extinct variants), the **UI pack**, and the four **VoxFlow audio** tier
loops + win sting.

---

### Shared STYLE anchor (prepend to every Miora generation)
```
STYLE: cohesive hand-painted 2D pixel-art, top-down, Southeast-Asian coastal wetland / mangrove estuary.
Warm, slightly melancholic naturalism. Palette: healthy #1a9e6b, water #1a4e6b, marsh #2a6b3a,
land #4a5a3a, pollution #6b3a1a, toxic #5c4a1e, accent gold #f0a500, danger #c0392b.
Clean readable shapes legible at small scale. Transparent PNG. No text in the image.
```

### Prompt — Cover key art (→ keyart.png, 1600×1000)
```
[STYLE] Cover key art, 16:9, 1600×1000: a top-down coastal wetland at a tipping point — left half lush
emerald seagrass with a wading Painted Stork; right half murky algal-brown polluted water with a runoff
outfall. A lone field-agent figure stands at the boundary. Cinematic, hopeful-but-urgent.
(Title text is overlaid by the build / start card — keep the image text-free or leave headroom at top.)
```

### Prompt — Decorative props (→ 8 separate transparent PNGs)
```
[STYLE] Eight separate top-down prop sprites, transparent PNG, soft baked drop-shadow, readable 48–96px.
Exact filenames: prop_tree.png (~96), prop_bush.png (~64), prop_reeds.png (~64), prop_rock.png (~64),
prop_flowers.png (~48), prop_lilypad.png (~64), prop_stump.png (~64), prop_grass.png (~48).
```

### Prompt — Avatar character concept (→ player_concept.png; spritesheet caveat below)
```
[STYLE] A field-explorer / ranger character concept, top-down view: brimmed field hat, olive field jacket
with a green insignia badge, backpack, boots, a gold handheld scanner. Clean readable game-avatar
silhouette. Transparent PNG.
```
> Note: a frame-aligned **4×4 walk spritesheet** (rows down/left/right/up, equal 64px frames →
> player.png 256×256) is hard for image-gen to align. Best path: use Miora for the concept, then a
> purpose-built sprite-pack walk sheet (or keep the programmatic `tools/gen_player.py` sheet) for
> `player.png`. Whatever is used must be 4 cols × 4 rows, rows down/left/right/up, transparent.

### Notes
- `keyart` is preloaded by `ai_content.js` (`_SPRITE_NAMES`) and used by the intro cutscene + start-card backdrop.
- Re-running `tools/gen_keyart.py` / `tools/gen_player.py` regenerates the placeholders deterministically.
- When Miora art lands, update the "Tool" line above to "Miora" and date it, for the authorship trail.

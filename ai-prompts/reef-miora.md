## Tool: Miora — Coral Reef biome art (sprites + tiles)
## Output → assets/images/  (drop-in by exact filename; renderer falls back gracefully until present)

### STATUS (2026-07-10)
**Programmatic PLACEHOLDER reef art is now generated and LIVE** via `tools/gen_reef.py` (Pillow, same
pattern as gen_keyart.py/gen_player.py) — all 26 reef files exist in assets/images/ and render correctly
in a reef game (verified: turquoise reefwater tiles, rippled sand, coral-rubble reef, coral/anemone/kelp/
starfish/shell props, lionfish + tilapia sprites, keyart_reef cover). These are cohesive placeholders, NOT
real AI art. The Miora prompts below produce the real AI versions — generate them when Miora auth is up and
overwrite the SAME filenames for a zero-code-change upgrade. Re-run `python3 tools/gen_reef.py` to
regenerate the placeholders deterministically.

### Shared STYLE anchor (prepend to EVERY reef generation — keeps it cohesive with the game)
```
STYLE: cohesive hand-painted 2D pixel-art, TOP-DOWN view, tropical coral-reef lagoon. Clean readable
shapes legible at ~48px. Reef palette: turquoise water #1a6e8b, pale sand #d8c89a, coral pink #e0748a,
reef green #2a8b6b, sediment brown #6b5a3a, bleached #cfc8bo, toxic silt #5c4a1e, accent gold #f0a500,
danger #c0392b. Soft baked drop-shadow. Transparent PNG. No text in the image.
```

---

### 1. Species sprites — 128×128, transparent PNG (EXACT filenames)
```
[STYLE] Five separate top-down creature/organism sprites, each its own 128×128 transparent PNG:
  sprite_coral.png       branching reef-building coral colony, vivid living pink-green
  sprite_parrotfish.png  a parrotfish (teal/green, beak-like mouth), seen from above
  sprite_urchin.png      a black long-spined sea urchin
  sprite_shark.png       a blacktip reef shark, sleek grey with black fin tips, top-down
  sprite_sediment.png    a murky brown sediment/silt plume clouding the water (the pollution SOURCE)
```

### 2. Extinct / collapsed variants — 128×128 transparent PNG
```
[STYLE] Three "collapsed" variants — desaturated, ghostly, clearly dead:
  sprite_coral_extinct.png      bleached white coral skeleton
  sprite_parrotfish_extinct.png pale fish silhouette / bones
  sprite_shark_extinct.png      faint grey shark silhouette
```

### 3. Invasive — the Lionfish
```
[STYLE] sprite_lionfish.png (128×128, transparent) — a red-and-white striped lionfish with fanned
venomous spines, dramatic top-down silhouette. Reads instantly as "invader".
```
> INTEGRATION — ✅ WIRED & VERIFIED. renderer.js `_spriteKeyForNode` now resolves the invasive sprite by
> node NAME: `Lionfish → sprite_lionfish`, `Mozambique Tilapia → sprite_tilapia`. Both filenames are
> preloaded in ai_content.js `_SPRITE_NAMES`. Drop `sprite_lionfish.png` in and it appears — zero code
> changes. (The wetland tilapia also now expects `sprite_tilapia.png` — optional, generate it too if you
> want a real tilapia sprite instead of the current fallback.)

### 4. Reef tileset — 128×128, opaque (fills the map)
```
[STYLE] A seamless top-down reef tileset, four 128×128 tiles, each edge-tileable:
  tile_reefwater.png  clear turquoise open water, faint caustics
  tile_sand.png       pale rippled lagoon sand
  tile_reef.png       living coral-rubble reef flat (pinks, greens)
  tile_sediment.png   silt-choked brown murky water (the degraded/source look)
Also 4 "toxic/degraded" variants (browned, algae-choked, lifeless): tile_reefwater_toxic.png,
tile_sand_toxic.png, tile_reef_toxic.png, tile_sediment_toxic.png
```
> INTEGRATION — ✅ WIRED & VERIFIED. renderer.js `drawTileGrid` now remaps tile types on the reef:
> `water→reefwater, marsh→sand, land→reef, source→sediment` (healthy + `_toxic`). All 8 names are
> preloaded. Drop the reef tile PNGs in and they appear — zero code changes. Until then the reef renders
> via the neutral procedural fallback (verified: no wetland art bleeds in).

### 5. (optional) Reef key art — 1600×1000
```
[STYLE] Cover key art, 16:9: a top-down coral reef at a tipping point — left half vivid living reef with
a blacktip shark; right half bleached, silt-smothered dead reef. Cinematic, hopeful-but-urgent. File:
keyart_reef.png  (used only if we add a per-biome start-card backdrop.)
```

### 6. Reef decorative props — transparent PNG, soft baked drop-shadow (EXACT filenames)
```
[STYLE] Seven separate top-down decorative reef props, each its own transparent PNG, readable at 48–96px:
  prop_coral.png     (~96) a large branching / brain coral formation, vivid living colour
  prop_coralhead.png (~64) a small rounded coral head
  prop_anemone.png   (~64) a sea anemone with waving tentacles (sits on reef water)
  prop_kelp.png      (~64) a frond of kelp / macroalgae (sways)
  prop_algae.png     (~48) a small tuft of turf algae
  prop_starfish.png  (~48) a starfish
  prop_shell.png     (~64) a conch / spiral shell
(prop_rock.png is shared with the wetland — no need to regenerate.)
```
> INTEGRATION — ✅ WIRED & VERIFIED. renderer.js `_PROP_NAMES.coral_reef` maps the scatter slots to these
> names (water→anemone, reed→kelp, tree→coral, bush→coralhead, grass→algae, flower→starfish, stump→shell,
> rock shared). All 7 are preloaded in ai_content.js. Drop them in → they appear, zero code changes. Until
> then the reef scatters only shared rocks (verified: no wetland reeds/lilypads bleed in).

### Drop-in checklist
- Save into `assets/images/` with the EXACT names above · sprites/props transparent PNG (128px species, 48–96px props) · tiles 128×128 opaque.
- Save the prompts you used here (authorship trail for the AI-Art module).
- Tell me when they're in — I'll wire the two one-line renderer mappings (lionfish sprite + reef tileset) and verify live.

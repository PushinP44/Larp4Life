# Project Skill: Single-Viewport Canvas + Scan/Edge Overlay

**Trigger:** Building `renderer.js`, `input.js`, and the overlay panels (Phase 2). Enforces Architecture Law 1 (one viewport, no separate screens).

## Skill Prompt — renderer (paste into CodeBuddy)
```
Implement renderer.js for Ecosystem X. ONE top-down canvas; everything renders here.

export function render(state, ctx):
  1. Draw the tile grid. Each tile's color is interpolated by its stressor L AND the
     global ecosystem_health: healthy = vibrant, toxic = desaturated/brown. Use lerpColor.
     /* AI_INTEGRATION_STUB: Miora/MPS — replace flat colors with generated tile sprites */
  2. Draw nodes (organisms) as sprites on their tiles; size/opacity scales with population.
     Extinct nodes draw as faded silhouettes.
  3. Draw the DAG edge overlay: ONLY edges with edge.revealed === true, as lines between
     node tiles (prey→predator). Animate a pulse along revealed edges.
  4. Draw the player agent at (tile_x, tile_y).
  5. Draw the HUD bar (top): day, collapse_timer, ecosystem_health meter + tier label,
     resources, scanner_charges.
  6. If a panel is open (notebook/vendor), the panel module renders over the canvas.

No separate screens. No DOM canvas swaps. Environmental change = tile re-tint, never a new view.
Use requestAnimationFrame from main.js; render is pure (reads state, draws, mutates nothing).
```

## Skill Prompt — input + WALK-TO-DISCOVER (paste into CodeBuddy)
```
Implement input.js for Ecosystem X. Discovery is PROXIMITY-BASED (walk to find species), NOT clicking.

- Arrow/WASD (or click/tap a tile): move the agent one tile (bounds-checked). Movement does NOT
  advance the sim. On each move, set player.facing ('down'|'left'|'right'|'up') for the avatar sprite row.
- NO scan key, NO click-to-scan. Discovery happens automatically by walking (see renderer/main below).
- Intervention: vendor panel buttons act on the agent's CURRENT tile (bioremediation etc.).
- End Day: Space / button → ecosystem.js runDailyStep(state).

Proximity discovery (renderer.js exports TERRITORY_RADIUS=3, DISCOVER_RADIUS=1.4; Chebyshev tiles):
- renderer.js drawNodes: an undiscovered non-stressor node is HIDDEN beyond TERRITORY_RADIUS; within
  it, draw a faded "ghost" + a prominent bouncing "!" badge above it.
- main.js game loop: each frame, any undiscovered non-stressor node within DISCOVER_RADIUS of the
  agent is auto-discovered (reuse scanTile/triggerScan) → notebook + edge reveal (deductive web).
- scanner_charges is a SOFT counter: decrement on discovery, never block.

All state writes go through dedicated mutators (scanTile/movePlayer set facing then save()). The
renderer stays read-only. The avatar uses assets/images/player.png (4 cols × 4 rows: down/left/right/up).
```

## Overlay panels (allowed DOM, over the canvas)
Only these overlays exist; each is a toggled `<div>` over the canvas, built from a function
returning an HTML string (no inline styles; classes live in style.css):
- **Field Notebook** (`notebook.js`): discovered species + AI codex text + the revealed-edge list.
- **Vendor** (`vendor.js`): intervention buttons with live prices (`priceOf`) + the tier dialogue line.
- **Cards**: start / win / lose.
Use event delegation (`data-action`) for all overlay buttons; close with an X/Back button.

## CSS variables (use these, never hardcode)
```
--bg-dark:#101820  --tile-healthy:#1a9e6b  --tile-toxic:#5c4a1e
--accent:#f0a500   --text-light:#f5f0e8    --danger:#c0392b   --edge:#7fd1ff
```

## Flags
- Any code path that hides the canvas to show a "scan screen" or "shop screen" → violates Law 1.
- Drawing unrevealed edges → breaks the investigation puzzle.
- Mutating state inside `render()` → forbidden (render is read-only).

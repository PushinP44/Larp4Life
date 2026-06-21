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

## Skill Prompt — input + scanning (paste into CodeBuddy)
```
Implement input.js for Ecosystem X.

- Arrow/WASD: move the agent one tile (bounds-checked). Movement does NOT advance the sim.
- Scan (key S or click adjacent entity): if scanner_charges>0 and an undiscovered node is on/
  adjacent to the agent's tile, mark node.discovered=true, push to notebook.discovered_nodes,
  decrement charges. Observing a predator while its prey is also discovered REVEALS that edge
  (call revealEdge) — this is the deductive mechanic.
- Intervention: open a small radial/contextual choice ON the map tile (not a new screen);
  selecting one calls the vendor purchase + ecosystem.js apply function for that tile.
- End Day (key E): calls ecosystem.js runDailyStep(state).

All writes go through ecosystem.js / vendor.js mutators. input.js never mutates state directly.
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

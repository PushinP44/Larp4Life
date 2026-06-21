# Project Skill: Safe State Mutation

**Trigger:** Any time you add a function that writes to GameState.

## Skill Prompt (paste into CodeBuddy)
```
Add a new state-mutation function to Ecosystem X.

Every mutation function MUST:
1. Take (params..., state) — never read GameState from global scope inside.
2. Validate preconditions first; throw descriptive Errors on failure.
3. Mutate fields on the passed state object only.
4. Clamp to valid ranges:
   - resources:  Math.max(0, v)
   - stressor L: Math.max(0, Math.min(100, v))
   - population: Math.max(0, Math.round(v))
   - status: one of stable|endangered|reintroduced|extinct
5. Never write meta.seed after generation (determinism).
6. Call state.save() as the LAST line.

Schema authority: .codebuddy/rules/03-state-schema.md

Function I need: [DESCRIBE]
Inputs: [...]   Fields mutated: [...]   Preconditions: [...]
Write it as a named export in [TARGET_FILE].js.
```

## Templates
```javascript
export function spendResources(amount, state) {
  if (state.player.resources < amount)
    throw new Error(`Need ${amount} resources, have ${state.player.resources}`);
  state.player.resources -= amount;
  state.save();
}

export function applyBioremediation(tileId, state) {
  const tile = state.world.tiles[tileId];
  if (!tile) throw new Error(`Unknown tile: ${tileId}`);
  tile.stressor = Math.max(0, Math.min(100, tile.stressor - 40));
  state.save();
}

export function revealEdge(fromId, toId, state) {
  const e = state.world.edges.find(e => e.from === fromId && e.to === toId);
  if (!e) return;                         // nothing to reveal
  e.revealed = true;
  const key = `${fromId}->${toId}`;
  if (!state.notebook.revealed_edges.includes(key)) state.notebook.revealed_edges.push(key);
  state.save();
}
```

## Anti-patterns (must NOT generate)
```javascript
GameState.player.resources -= 50;              // ❌ global mutate, no save
function render(state){ state.player.resources -= 50; } // ❌ write in render code
state.meta.seed = Date.now();                   // ❌ mutating the seed mid-run
const r = Math.random();                        // ❌ non-deterministic
```

# User Skill: Vanilla JS ES6 Module Generator

**Scope:** Scaffold any new JS module for a no-framework browser project.

## Skill Prompt (paste into CodeBuddy)

```
Create a new ES6 module for a Vanilla JS browser game. 

Module name: [NAME].js
Module responsibility: [ONE SENTENCE — what does this module own?]

Imports it needs from other modules:
- [list what it needs to import]

Exports it must provide:
- [list named exports]

Rules:
- No default export (use named exports only, except state.js which is a singleton)
- No side effects on import — all initialization must be in an explicit init() function
- All DOM interaction must go through IDs, not class queries (IDs are stable contracts)
- Throw descriptive Error objects for all precondition failures
- Add a JSDoc comment block above every exported function
- Add a /* MODULE: [NAME] — [responsibility] */ header comment at the top of the file

Please scaffold the complete module with stub implementations and JSDoc.
```

## Standard Module Template
```javascript
/* MODULE: example — Handles [responsibility] */

import GameState from './state.js';
import { updateHUD } from './renderer.js';

/**
 * Initialize this module. Call once from main.js on startup.
 */
export function initExample() {
  // setup code here
}

/**
 * Does [X].
 * @param {string} param - Description
 * @param {Object} state - GameState singleton
 * @returns {void}
 * @throws {Error} If precondition fails
 */
export function doSomething(param, state) {
  if (!param) throw new Error('doSomething: param is required');
  // implementation
  state.save();
}
```

## JSDoc Types Reference
```javascript
/**
 * @param {string} nodeId - A node in state.world.nodes (e.g. "n_seagrass")
 * @param {string} tileId - A tile in state.world.tiles
 * @param {number} L - Stressor level, float 0.0–100.0
 * @param {Object} state - The GameState singleton from state.js
 * @returns {number} The computed carrying capacity K_i(L)
 */
```

## Module Dependency Rules (Ecosystem X)
- `state.js`, `prng.js` → imported by others, import nothing
- `validator.js` → imports ecosystem.js (reuses runDailyStep for solvability)
- `generator.js` → imports prng.js, validator.js
- `ecosystem.js` → imports state.js only
- `hysteria.js` → imports state.js only
- `renderer.js`, `notebook.js`, `vendor.js` → import state.js (read-only) + their mutators
- `input.js` → imports ecosystem.js, vendor.js
- `ai_content.js` → imports state.js
- `recap.js` → imports state.js (read-only) + ai_content.js (fragments); pure, deterministic, no save
- `ai_ecologist.js` → imports state.js (READ-ONLY) + ai_content.js (codex fallback); never writes/saves state (Law 2½)
- `main.js` → imports everything (the wiring layer)

**Never create circular imports.** If module A needs something from module B and B needs something from A, extract the shared logic into a new utility module.

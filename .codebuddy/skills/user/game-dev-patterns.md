# User Skill: HTML5 Game Development Patterns

**Scope:** Reusable patterns for any Vanilla JS / HTML5 Canvas browser game.

## Skill Prompt (paste into CodeBuddy for any game project)

```
I'm building a browser game using only Vanilla JavaScript ES6 modules, HTML5, and plain CSS. No frameworks, no build tools.

For the feature I'm about to describe, please:
1. Use the ES6 module pattern (export/import) — no global variables
2. Keep each module focused on one concern (state, rendering, input, audio)
3. Use requestAnimationFrame for all animations
4. Prefer event delegation over per-element addEventListener
5. Make all interactive elements keyboard-accessible (tabindex, keydown handlers)
6. Handle all errors with descriptive thrown Error objects, not silent failures

Feature I need: [DESCRIBE FEATURE]
```

## Pattern Library

### Game Loop Pattern
```javascript
// gameloop.js
let lastTime = 0;
let running = false;

export function startLoop(updateFn, renderFn) {
  running = true;
  requestAnimationFrame(tick);
  
  function tick(timestamp) {
    if (!running) return;
    const delta = timestamp - lastTime;
    lastTime = timestamp;
    updateFn(delta);
    renderFn();
    requestAnimationFrame(tick);
  }
}

export function stopLoop() { running = false; }
```

### Canvas Resize Handler
```javascript
export function makeResponsiveCanvas(canvas) {
  function resize() {
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  window.addEventListener('resize', resize);
  resize();
  return () => window.removeEventListener('resize', resize);
}
```

### Seeded PRNG (determinism backbone — use this, never Math.random)
```javascript
// prng.js — mulberry32: tiny, fast, deterministic
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const randInt   = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
export const randFloat = (rng, lo, hi) => lo + rng() * (hi - lo);
// Same seed → same sequence → reproducible worlds (and shareable seeds).
```

### Event Delegation for Overlay Panels
```javascript
// In main.js — one listener handles all overlay button clicks
document.getElementById('overlay').addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (!action) return;
  const handlers = { buy: buyIntervention, scan: scanNode, endday: runDailyStep, close: hidePanel };
  if (handlers[action]) handlers[action](e.target.dataset, GameState);
});
// In HTML: <button data-action="buy" data-item="bioremediation">Bioremediate (120)</button>
```

### localStorage Save/Load Pattern
```javascript
const SAVE_KEY = 'my_game_save';

export function save(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('Save failed (storage full?):', e);
  }
}

export function load(defaultState) {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return { ...defaultState };
    return { ...defaultState, ...JSON.parse(raw) }; // merge to handle missing fields
  } catch (e) {
    console.warn('Load failed, using defaults:', e);
    return { ...defaultState };
  }
}
```

### Weighted Random Selection (deterministic — takes an injected RNG)
```javascript
// Select an item by probability weight. The RNG is INJECTED, never global Math.random,
// so the result is reproducible from a seed. Pass a mulberry32-derived rng (see prng.js).
// Determinism law (Ecosystem X Rule 01/02): there is NO Math.random() fallback on purpose —
// a missing rng is a programming error, not something to paper over with non-determinism.
export function weightedRandom(items, weights, rng) {
  if (typeof rng !== 'function')
    throw new Error('weightedRandom: pass a seeded rng () => [0,1) from prng.js (no Math.random)');
  const total = weights.reduce((sum, w) => sum + w, 0);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}
```

### Canvas Color Interpolation (dirty → clean)
```javascript
export function lerpColor(colorA, colorB, t) {
  // t: 0 = colorA, 1 = colorB
  const a = hexToRgb(colorA), b = hexToRgb(colorB);
  const r = Math.round(a.r + (b.r - a.r) * t);
  const g = Math.round(a.g + (b.g - a.g) * t);
  const blue = Math.round(a.b + (b.b - a.b) * t);
  return `rgb(${r},${g},${blue})`;
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
```

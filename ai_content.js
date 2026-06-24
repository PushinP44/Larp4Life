/**
 * ai_content.js — AI-generated content pool for Ecosystem X
 *
 * AI_MODULE_TAG: AI_CONTENT (rubric AI module — generated codex entries,
 *   intervention result dialogue, and field-report fragments).
 *
 * Content generated offline — fully deterministic, no live LLM calls.
 * All text is seeded/static so the game works offline (Rule 01).
 *
 * External JSON files (data/) are loaded at boot via loadAIContent().
 * On any fetch error the inline constants below are the OFFLINE FALLBACK
 * (Rule 01 — game must still run if a file is missing).
 *
 * Exports:
 *   loadAIContent()                       → Promise<void>  (call once at boot)
 *   getAICodexEntry(nodeId)               → string | null
 *   getInterventionDialogue(type, tier)   → string
 *   getFieldReportFragment(state)         → string  (end-of-run recap)
 *   computeRunGrade(state)                → { grade, line }  (run score for win/lose card)
 *   INTERVENTION_DESCRIPTIONS             → object  (for vendor panel)
 *
 *   Synthesized SFX (Web Audio — no audio assets needed):
 *   playDiscoverChime()   — bright 2-note blip on species discovery
 *   playInterveneChime()  — soft watery tone on successful bioremediation
 *   playTierUp()          — rising 3-note arpeggio on market tier improvement
 *
 *   initArtLayers()                       → void   (call at boot — fire-and-forget)
 *   getSprite(name)                       → HTMLImageElement|null
 *
 *   initAudio()                           → Promise<void>  (call after first user gesture)
 *   setHealthAudio(H)                     → void   (crossfade ambience to match health 0-100)
 *   playWinSting()                        → void   (play sting_win once)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Module-level cache — populated by loadAIContent(); null = not yet loaded
// ─────────────────────────────────────────────────────────────────────────────
let _loadedCodex     = null;   // keyed by node id → string
let _loadedFragments = null;   // keyed by situation key → string[]

// ─────────────────────────────────────────────────────────────────────────────
// Art layer — sprite preloader
// Rule 01: a missing file degrades gracefully; never throws.
// ─────────────────────────────────────────────────────────────────────────────

/** @type {Map<string, HTMLImageElement>} */
const _sprites = new Map();

const _SPRITE_NAMES = [
  // tiles (healthy)
  'tile_water', 'tile_marsh', 'tile_land', 'tile_source',
  // tiles (toxic variants)
  'tile_water_toxic', 'tile_marsh_toxic', 'tile_land_toxic', 'tile_source_toxic',
  // species
  'sprite_seagrass', 'sprite_shrimp', 'sprite_heron', 'sprite_runoff',
  // extinct silhouettes
  'sprite_seagrass_extinct', 'sprite_shrimp_extinct', 'sprite_heron_extinct',
  // agent, player spritesheet + UI pack
  'agent', 'player', 'ui_pack',
  // decorative props (scatter layer)
  'prop_tree', 'prop_bush', 'prop_reeds', 'prop_rock',
  'prop_flowers', 'prop_lilypad', 'prop_stump', 'prop_grass',
  // cover key art (used by intro sequence + start card)
  'keyart',
];

/**
 * initArtLayers() — fire-and-forget image preloader.
 *
 * Loads all sprites from assets/images/.  Each Image's onerror handler
 * simply leaves it absent from the cache; getSprite() returns null.
 * Call once at boot (no await needed — renderer falls back until loaded).
 */
export function initArtLayers() {
  for (const name of _SPRITE_NAMES) {
    const img = new Image();
    img.onload  = () => { _sprites.set(name, img); };
    img.onerror = () => { /* graceful — leave absent from cache */ };
    img.src = `assets/images/${name}.png`;
  }
}

/**
 * getSprite(name) → HTMLImageElement | null
 *
 * Returns a fully-loaded HTMLImageElement, or null if it wasn't loaded yet
 * or failed to load.  Never throws.
 *
 * @param {string} name  e.g. 'tile_water', 'sprite_heron', 'agent'
 * @returns {HTMLImageElement|null}
 */
export function getSprite(name) {
  const img = _sprites.get(name);
  return (img && img.complete && img.naturalWidth > 0) ? img : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio layer — Web Audio API ambient crossfader
// Rule 01: entire block wrapped in try/catch; silent fallback if unsupported.
// ─────────────────────────────────────────────────────────────────────────────

let _audioCtx      = null;   // AudioContext, created on first user gesture
let _ambBuffers    = {};     // { toxic, degraded, recovering, pristine } → AudioBuffer
let _ambSources    = {};     // currently playing looping BufferSourceNode per tier
let _ambGains      = {};     // GainNode per tier
let _winBuffer     = null;   // AudioBuffer for sting_win
let _audioReady    = false;  // true once buffers are fetched

const _AMB_TIERS = ['toxic', 'degraded', 'recovering', 'pristine'];

/**
 * _loadAudioBuffer(ctx, url) → Promise<AudioBuffer>
 * Fetches and decodes an audio file.  Rejects on network or decode error.
 */
async function _loadAudioBuffer(ctx, url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
  const ab = await resp.arrayBuffer();
  return ctx.decodeAudioData(ab);
}

/**
 * initAudio() → Promise<void>
 *
 * Creates the AudioContext (must be called from a user-gesture handler to
 * satisfy browser autoplay policy), loads all ambient loops + win sting,
 * and connects each to its own GainNode (all starting at gain 0).
 *
 * Safe to call multiple times — returns immediately if already initialised.
 * All errors are caught; audio simply won't play on failure (Rule 01).
 */
export async function initAudio() {
  if (_audioReady) return;
  try {
    if (!_audioCtx) {
      _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (_audioCtx.state === 'suspended') {
      await _audioCtx.resume();
    }

    // Load all ambient tracks + win sting in parallel
    const loadResults = await Promise.allSettled([
      ..._AMB_TIERS.map(t => _loadAudioBuffer(_audioCtx, `assets/audio/amb_${t}.mp3`)),
      _loadAudioBuffer(_audioCtx, 'assets/audio/sting_win.mp3'),
    ]);

    // Wire ambient gains — start silent
    for (let i = 0; i < _AMB_TIERS.length; i++) {
      const result = loadResults[i];
      if (result.status !== 'fulfilled') {
        console.warn(`[ai_content] Audio: failed to load amb_${_AMB_TIERS[i]}`, result.reason);
        continue;
      }
      const tier = _AMB_TIERS[i];
      _ambBuffers[tier] = result.value;

      const gainNode = _audioCtx.createGain();
      gainNode.gain.setValueAtTime(0, _audioCtx.currentTime);
      gainNode.connect(_audioCtx.destination);
      _ambGains[tier] = gainNode;

      // Start looping source at gain 0
      const source = _audioCtx.createBufferSource();
      source.buffer = _ambBuffers[tier];
      source.loop   = true;
      source.connect(gainNode);
      source.start(0);
      _ambSources[tier] = source;
    }

    // Win sting buffer (played on demand)
    const winResult = loadResults[_AMB_TIERS.length];
    if (winResult.status === 'fulfilled') {
      _winBuffer = winResult.value;
    } else {
      console.warn('[ai_content] Audio: failed to load sting_win', winResult.reason);
    }

    _audioReady = true;
    console.log('[ai_content] Audio initialised.');
  } catch (err) {
    console.warn('[ai_content] Audio init failed — silent fallback.', err);
  }
}

/**
 * setHealthAudio(H) — crossfade ambient layers to match ecosystem health H (0–100).
 *
 * Health tiers:  Toxic <25 · Degraded 25–50 · Recovering 50–75 · Pristine ≥75
 * Crossfade: the active tier ramps to 1, neighbours ramp to 0, over ~0.5s.
 * Safe to call before initAudio() — silently no-ops.
 *
 * @param {number} H  ecosystem_health, 0–100
 */
export function setHealthAudio(H) {
  if (!_audioReady || !_audioCtx) return;
  try {
    const tier =
      H >= 75 ? 'pristine'   :
      H >= 50 ? 'recovering' :
      H >= 25 ? 'degraded'   : 'toxic';

    const now  = _audioCtx.currentTime;
    const ramp = 0.5; // seconds

    for (const t of _AMB_TIERS) {
      const gain = _ambGains[t];
      if (!gain) continue;
      const target = t === tier ? 1.0 : 0.0;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(target, now + ramp);
    }
  } catch (err) {
    // silent — never break gameplay
  }
}

/**
 * playWinSting() — play sting_win.mp3 once, fading all ambient out first.
 * Safe to call before initAudio() — silently no-ops.
 */
export function playWinSting() {
  if (!_audioReady || !_audioCtx || !_winBuffer) return;
  try {
    // Fade out all ambient
    const now = _audioCtx.currentTime;
    for (const t of _AMB_TIERS) {
      const gain = _ambGains[t];
      if (!gain) continue;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.8);
    }
    // Play sting once
    const src = _audioCtx.createBufferSource();
    src.buffer = _winBuffer;
    src.loop   = false;
    src.connect(_audioCtx.destination);
    src.start(now + 0.1);
  } catch (err) {
    // silent
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthesized SFX — Web Audio OscillatorNode envelopes, NO audio asset files.
// All three helpers reuse the existing _audioCtx created by initAudio().
// Each is wrapped in try/catch and no-ops if _audioCtx is null or not running.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _synthNote(freq, type, startTime, duration, peakGain, ctx)
 * Internal helper: creates one oscillator + gain-envelope note and starts it.
 * Attack 8ms → hold → exponential decay to near-zero. Connects to destination.
 *
 * @param {number}  freq       Hz
 * @param {string}  type       OscillatorType ('sine'|'triangle'|'square'|'sawtooth')
 * @param {number}  startTime  AudioContext.currentTime offset
 * @param {number}  duration   seconds
 * @param {number}  peakGain   0–1
 * @param {AudioContext} ctx
 */
function _synthNote(freq, type, startTime, duration, peakGain, ctx) {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type      = type;
  osc.frequency.setValueAtTime(freq, startTime);
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(peakGain, startTime + 0.008);  // fast attack
  gain.gain.setValueAtTime(peakGain, startTime + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration + 0.01);
}

/**
 * playDiscoverChime() — bright 2-note rising blip (C5 → E5) on species discovery.
 * Triangle wave for a clean bell-like tone. Total duration ≈ 200ms.
 * Safe to call before initAudio() — no-ops silently.
 */
export function playDiscoverChime() {
  if (!_audioCtx || _audioCtx.state === 'suspended') return;
  try {
    const now = _audioCtx.currentTime;
    _synthNote(523.25, 'triangle', now,        0.18, 0.22, _audioCtx); // C5
    _synthNote(659.25, 'triangle', now + 0.08, 0.16, 0.18, _audioCtx); // E5
  } catch (err) { /* silent */ }
}

/**
 * playInterveneChime() — soft watery "clean" tone on successful bioremediation.
 * Sine wave at A4 with a gentle second harmonic, duration ≈ 400ms.
 * Safe to call before initAudio() — no-ops silently.
 */
export function playInterveneChime() {
  if (!_audioCtx || _audioCtx.state === 'suspended') return;
  try {
    const now = _audioCtx.currentTime;
    _synthNote(440,   'sine',     now,        0.40, 0.18, _audioCtx); // A4 fundamental
    _synthNote(880,   'sine',     now,        0.35, 0.07, _audioCtx); // A5 harmonic (soft)
    _synthNote(523.25,'triangle', now + 0.14, 0.28, 0.12, _audioCtx); // C5 tail-note
  } catch (err) { /* silent */ }
}

/**
 * playTierUp() — rising 3-note arpeggio on market tier improvement.
 * G4 → B4 → D5, triangle wave, spaced 130ms apart. Total duration ≈ 550ms.
 * Safe to call before initAudio() — no-ops silently.
 */
export function playTierUp() {
  if (!_audioCtx || _audioCtx.state === 'suspended') return;
  try {
    const now = _audioCtx.currentTime;
    _synthNote(392.00, 'triangle', now,        0.40, 0.20, _audioCtx); // G4
    _synthNote(493.88, 'triangle', now + 0.13, 0.38, 0.20, _audioCtx); // B4
    _synthNote(587.33, 'triangle', now + 0.26, 0.36, 0.22, _audioCtx); // D5
  } catch (err) { /* silent */ }
}

// ─────────────────────────────────────────────────────────────────────────────
// Species Codex — OFFLINE FALLBACK
// AI_CONTENT: generated by CodeBuddy Genie / WorkBuddy
// ─────────────────────────────────────────────────────────────────────────────
const SPECIES_CODEX = {
  n_seagrass: `Seagrass meadows are the foundation of this wetland. 
    They oxygenate sediment, sequester carbon, and anchor the entire food web. 
    When stressor levels rise, their leaf area collapses first — watch them closely.`,

  n_shrimp: `Mangrove Shrimp are the trophic bridge of the system. 
    They convert primary productivity into predator-accessible biomass. 
    A shrimp crash is an early warning: something upstream is broken.`,

  n_heron: `The Painted Stork is a keystone apex predator and bioindicator. 
    Its breeding success tracks fish and shrimp abundance with a 2-day lag. 
    Loss of the stork triggers trophic cascades that are hard to reverse.`,

  n_runoff: `Agricultural runoff is the primary stressor in this biome. 
    Nitrogen and phosphorus loading depresses seagrass, triggers algae blooms, 
    and reduces dissolved oxygen. Bioremediation is the only direct counter.`,
};

// ─────────────────────────────────────────────────────────────────────────────
// loadAIContent() — fetch JSON files once at boot; keep fallbacks on error
// ─────────────────────────────────────────────────────────────────────────────

/**
 * loadAIContent() → Promise<void>
 *
 * Fetches data/codex.json and data/report-fragments.json.
 * On success, caches them in module-level vars.
 * On any error (network, parse, missing file), silently keeps inline fallbacks.
 * Safe to call multiple times — re-fetches only if not yet loaded.
 */
export async function loadAIContent() {
  // Codex
  try {
    const resp = await fetch('data/codex.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (json && typeof json === 'object') {
      _loadedCodex = json;
      console.log('[ai_content] codex.json loaded:', Object.keys(json).length, 'entries');
    }
  } catch (err) {
    console.warn('[ai_content] codex.json unavailable — using inline fallback.', err.message);
  }

  // Report fragments
  try {
    const resp = await fetch('data/report-fragments.json');
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const json = await resp.json();
    if (json && typeof json === 'object') {
      _loadedFragments = json;
      console.log('[ai_content] report-fragments.json loaded:', Object.keys(json).length, 'keys');
    }
  } catch (err) {
    console.warn('[ai_content] report-fragments.json unavailable — using inline fallback.', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getAICodexEntry — returns loaded JSON entry if present, else inline fallback
// ─────────────────────────────────────────────────────────────────────────────

/**
 * getAICodexEntry(nodeId) → string | null
 * @param {string} nodeId
 * @returns {string|null}
 */
export function getAICodexEntry(nodeId) {
  if (_loadedCodex && _loadedCodex[nodeId]) return _loadedCodex[nodeId];
  return SPECIES_CODEX[nodeId] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intervention result dialogue — AI-generated per-action flavour text
// AI_CONTENT: generated by CodeBuddy Genie / WorkBuddy
// ─────────────────────────────────────────────────────────────────────────────
const INTERVENTION_RESULT_DIALOGUE = {
  bioremediation: {
    Toxic:      "Bioremediation package deployed on this tile. The water clarifies slightly — a small victory in a toxic war.",
    Degraded:   "Bioremediators take hold here. If you targeted the source tile, stressor levels should drop noticeably by tomorrow.",
    Recovering: "The intervention supplements natural recovery on this tile. Stressor load is visibly declining.",
    Pristine:   "Almost unnecessary at this point — but thorough. Stressor suppressed on your current tile.",
  },
  rebalancing: {
    Toxic:      "Rebalancing intervention deployed under duress. Populations stabilise — barely.",
    Degraded:   "You redistribute resources across trophic levels. The food web breathes a little easier.",
    Recovering: "Rebalancing accelerates the recovery trajectory. Well timed.",
    Pristine:   "Fine-tuning a healthy system. Population dynamics are now near-optimal.",
  },
  stabilization: {
    Toxic:      "Site locked down. Stressor can no longer spike here — giving species on this tile a fighting chance.",
    Degraded:   "Stabilization anchors this tile. Effective carrying capacity rises as the stressor load drops to a safe ceiling.",
    Recovering: "A protected tile in a recovering biome amplifies the recovery signal. Species here should rebound faster.",
    Pristine:   "The tile is already clean — stabilization is mostly symbolic, but the protection marker stands.",
  },
};

/**
 * getInterventionDialogue(type, tier) → string
 *
 * @param {'bioremediation'|'rebalancing'|'stabilization'} type
 * @param {'Toxic'|'Degraded'|'Recovering'|'Pristine'} tier
 * @returns {string}
 */
export function getInterventionDialogue(type, tier) {
  const pool = INTERVENTION_RESULT_DIALOGUE[type];
  if (!pool) return "Intervention deployed.";
  return pool[tier] ?? pool.Degraded;
}

// ─────────────────────────────────────────────────────────────────────────────
// Intervention descriptions (shown in vendor panel)
// ─────────────────────────────────────────────────────────────────────────────
export const INTERVENTION_DESCRIPTIONS = {
  bioremediation: {
    name:   'Bioremediation',
    icon:   '🧪',
    effect: '−50 stressor on YOUR current tile',
    detail: 'Navigate to the polluted tile first, then deploy microbial agents. The right tile matters — this is the core deduction.',
  },
  rebalancing: {
    name:   'Trophic Rebalancing',
    icon:   '⚖️',
    effect: 'Reintroduce a native (if habitat clear) OR cull an invasive',
    detail: 'If a species is critically low on a clean tile (L<20), it is reintroduced to 20% capacity. Otherwise, the most over-abundant non-keystone species is culled by 30%.',
  },
  stabilization: {
    name:   'Site Stabilization',
    icon:   '🛡️',
    effect: 'Protect current tile — stressor capped at 20 (raises K)',
    detail: 'Stand on the tile you want to protect. Marks it stable: stressor locked ≤20, raising effective carrying capacity for species on that tile.',
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Field Report — AI-generated end-of-run recap
// AI_CONTENT: deterministic assembly from report-fragments.json (fallback: inline)
// AI_MODULE_TAG: FIELD_REPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _pickFragment(key, seedIndex) → string
 *
 * Picks one variant from the loaded (or fallback) fragments pool for `key`.
 * Selection is deterministic: index = seedIndex % variants.length.
 *
 * @param {string} key        — e.g. 'win_fast', 'lesson_root_cause'
 * @param {number} seedIndex  — derived from state.meta.seed (no Math.random)
 * @returns {string}
 */
function _pickFragment(key, seedIndex) {
  const pool = _loadedFragments?.[key];
  if (pool && Array.isArray(pool) && pool.length > 0) {
    return pool[Math.abs(seedIndex) % pool.length];
  }
  // Inline fallback strings (used when JSON not loaded)
  const FALLBACK = {
    win_fast:             "Early stressor control compounded; the meadow is recovering ahead of schedule.",
    win_close:            "The margin was thin, but the wetland is standing — a narrow but legitimate restoration.",
    lose_timeout:         "Stressor loading persisted too long; cumulative trophic debt exceeded what the remaining window could repay.",
    lose_keystone:        "Once the apex node collapses the energy pyramid loses its regulatory ceiling — recovery without restocking is not viable.",
    lesson_root_cause:    "Suppressing the stressor at its source gave downstream species the clean-water window they needed.",
    lesson_symptom_only:  "Mid-trophic interventions slowed the decline but never addressed the source; symptom management without source control is a rearguard action against arithmetic.",
    lesson_deep_scan:     "Full edge resolution early converted ambiguous health readings into a ranked action list.",
    lesson_shallow_scan:  "Shallow survey confirmed presence/absence but the dependency edges remained invisible until it was too late.",
  };
  return FALLBACK[key] ?? '';
}

/**
 * _splicePlaceholders(template, vars) → string
 *
 * Replaces {days} {keystone} {stressor} {health} {edgePct} in a template string.
 * Unknown placeholders are left as-is.
 *
 * @param {string} template
 * @param {object} vars — map of placeholder name → value
 * @returns {string}
 */
function _splicePlaceholders(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}

/**
 * getFieldReportFragment(state) → string
 *
 * Generates a deterministic end-of-run text summary.
 * Prose outcome + lesson lines come from report-fragments.json (loaded at boot).
 * Falls back to inline strings if the JSON was not loaded (Rule 01 offline safety).
 * Stats block (coverage, extinctions, day count, timer) is always computed live.
 *
 * Variant selection: deterministic index from state.meta.seed (NO Math.random).
 *
 * @param {object} state — GameState at end of run
 * @returns {string} multi-line report text
 */
export function getFieldReportFragment(state) {
  const { day_count, ecosystem_health, market_tier, collapse_timer, seed } = state.meta;
  const { win, lose } = state.flags;

  // ── Derived stats ─────────────────────────────────────────────────────────
  const discoveredCount = state.notebook.discovered_nodes
    .filter(id => state.world.nodes[id] && state.world.nodes[id].kind !== 'stressor').length;
  const revealedEdges   = state.notebook.revealed_edges.length;
  const totalNodes      = Object.values(state.world.nodes).filter(n => n.kind !== 'stressor').length;
  const totalEdges      = state.world.edges.length;

  const extinctList = Object.values(state.world.nodes)
    .filter(n => n.status === 'extinct')
    .map(n => n.name);
  const keystoneSurvived = Object.values(state.world.nodes)
    .filter(n => n.keystone && n.kind !== 'stressor')
    .every(n => n.status !== 'extinct');

  // First extinct keystone name (for {keystone} placeholder)
  const extinctKeystone = Object.values(state.world.nodes)
    .find(n => n.keystone && n.status === 'extinct');
  const keystoneName = extinctKeystone?.name ?? 'keystone species';

  // Primary stressor name (first stressor-kind node)
  const stressorNode = Object.values(state.world.nodes).find(n => n.kind === 'stressor');
  const stressorName = stressorNode?.name ?? 'agricultural runoff';

  // Edge coverage % (for lesson_deep_scan threshold)
  const edgePct = totalEdges > 0 ? Math.round((revealedEdges / totalEdges) * 100) : 0;

  // Mean stressor load across all tiles (to judge root-cause success)
  const tileStressors = Object.values(state.world.tiles).map(t => t.stressor ?? 0);
  const meanStressor  = tileStressors.length > 0
    ? tileStressors.reduce((a, b) => a + b, 0) / tileStressors.length
    : 100;

  // Was bioremediation ever used? Check via state flag or tile evidence
  const bioUsed = state.notebook.interventions_used?.includes('bioremediation') ?? meanStressor < 40;

  // Deterministic seed index for variant selection (no Math.random)
  const seedIdx = Math.abs(typeof seed === 'number' ? seed : 1);

  // ── Placeholder map ───────────────────────────────────────────────────────
  const vars = {
    days:     day_count,
    keystone: keystoneName,
    stressor: stressorName,
    health:   Math.round(ecosystem_health),
    edgePct:  edgePct,
  };

  // ── Outcome key selection ─────────────────────────────────────────────────
  // win_fast  : won with >8 days to spare on the 40-day timer
  // win_close : won but ≤8 days to spare
  // lose_keystone : a keystone is extinct
  // lose_timeout  : timer expired, no keystone extinct
  let outcomeKey;
  if (win) {
    outcomeKey = collapse_timer > 8 ? 'win_fast' : 'win_close';
  } else if (!keystoneSurvived) {
    outcomeKey = 'lose_keystone';
  } else {
    outcomeKey = 'lose_timeout';
  }

  // ── Lesson key selection ──────────────────────────────────────────────────
  // lesson_root_cause   : bioremediation was used AND final mean stressor is low (<35)
  // lesson_symptom_only : interventions used but stressor not resolved
  // lesson_deep_scan    : edge-reveal coverage ≥ 66%
  // lesson_shallow_scan : edge-reveal coverage < 66%
  let lessonKey;
  if (bioUsed && meanStressor < 35) {
    lessonKey = 'lesson_root_cause';
  } else if (edgePct >= 66) {
    lessonKey = 'lesson_deep_scan';
  } else if (bioUsed) {
    lessonKey = 'lesson_symptom_only';
  } else {
    lessonKey = 'lesson_shallow_scan';
  }

  // ── Pick and splice prose fragments ──────────────────────────────────────
  const outcomeProse = _splicePlaceholders(_pickFragment(outcomeKey, seedIdx),     vars);
  const lessonProse  = _splicePlaceholders(_pickFragment(lessonKey,  seedIdx + 7), vars);

  // ── Static stats block (always computed live) ─────────────────────────────
  const coveragePct   = totalNodes > 0 ? Math.round((discoveredCount / totalNodes) * 100) : 0;
  const investigation =
    `Investigation coverage: ${discoveredCount}/${totalNodes} species (${coveragePct}%), ` +
    `${revealedEdges}/${totalEdges} trophic links revealed.`;

  const extinctReport = extinctList.length > 0
    ? `Species lost: ${extinctList.join(', ')}.`
    : `No species extinctions recorded. ` + (keystoneSurvived ? 'All keystone species survived.' : '');

  const healthReport =
    `Final ecosystem health: ${Math.round(ecosystem_health)}% (${market_tier}). ` +
    `Day ${day_count}. Collapse timer remaining: ${Math.max(0, collapse_timer)} days.`;

  // ── Attribution badge (hackathon rubric: AI_CONTENT tag) ─────────────────
  const badge = `[ Generated by CodeBuddy Genie · AI_MODULE: FIELD_REPORT · seed ${seed} ]`;

  return [
    outcomeProse,
    '',
    lessonProse,
    '',
    investigation,
    extinctReport,
    healthReport,
    '',
    badge,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Run Grade — deterministic letter grade for the win/lose card
// AI_MODULE_TAG: AI_CONTENT (rubric AI module)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * computeRunGrade(state) → { grade: string, line: string }
 *
 * Grades the completed run from terminal GameState.
 *
 * WIN grades (state.flags.win === true) — primarily on day_count:
 *   S : day_count ≤ 18  AND  speciesFound == 1.0  AND  edgesFound == 1.0
 *   A : day_count ≤ 22
 *   B : day_count ≤ 28
 *   C : day_count ≤ 34
 *   D : any other win
 *
 * LOSE grades:
 *   F : a keystone species went extinct
 *   E : collapse timer expired (no keystone extinct)
 *
 * speciesFound = discovered non-stressor nodes / total non-stressor nodes  (0–1)
 * edgesFound   = revealed edges / total edges  (0–1)
 *
 * Returns:
 *   grade  — single letter string  'S' | 'A' | 'B' | 'C' | 'D' | 'E' | 'F'
 *   line   — short flavour sentence (deterministic, no Math.random)
 *
 * Deterministic — NO Math.random; selection uses state.meta.seed.
 *
 * @param {object} state  terminal GameState
 * @returns {{ grade: string, line: string }}
 */
export function computeRunGrade(state) {
  const { day_count, seed } = state.meta;
  const { win }             = state.flags;

  // ── Coverage fractions ────────────────────────────────────────────────────
  const totalNonStressor = Object.values(state.world.nodes)
    .filter(n => n.kind !== 'stressor').length;
  const discoveredCount  = state.notebook.discovered_nodes
    .filter(id => {
      const n = state.world.nodes[id];
      return n && n.kind !== 'stressor';
    }).length;
  const speciesFound = totalNonStressor > 0 ? discoveredCount / totalNonStressor : 0;

  const totalEdges   = state.world.edges.length;
  const revealedEdges = state.notebook.revealed_edges.length;
  const edgesFound   = totalEdges > 0 ? revealedEdges / totalEdges : 0;

  // ── Keystone extinction check ─────────────────────────────────────────────
  const keystoneExtinct = Object.values(state.world.nodes)
    .some(n => n.keystone && n.kind !== 'stressor' && n.status === 'extinct');

  // ── First extinct keystone name (for flavour) ─────────────────────────────
  const extinctKsNode = Object.values(state.world.nodes)
    .find(n => n.keystone && n.kind !== 'stressor' && n.status === 'extinct');
  const extinctKsName = extinctKsNode?.name ?? 'keystone species';

  // ── Grade computation ─────────────────────────────────────────────────────
  let grade;
  if (win) {
    if      (day_count <= 18 && speciesFound >= 1 && edgesFound >= 1) grade = 'S';
    else if (day_count <= 22) grade = 'A';
    else if (day_count <= 28) grade = 'B';
    else if (day_count <= 34) grade = 'C';
    else                      grade = 'D';
  } else {
    grade = keystoneExtinct ? 'F' : 'E';
  }

  // ── Deterministic flavour lines (keyed by grade, variant by seed) ─────────
  // NO Math.random — index derived from seed mod variants.length
  const seedIdx = Math.abs(typeof seed === 'number' ? seed : 1);

  const GRADE_LINES = {
    S: [
      "Perfect restoration — every species found, every link mapped, the biome back in days.",
      "Full ecological survey completed at record pace. The wetland thrives.",
    ],
    A: [
      `Restored in ${day_count} days — efficient fieldwork.`,
      `Rapid intervention — the biome stabilised in ${day_count} days.`,
    ],
    B: [
      `Solid field operation. Biome secured in ${day_count} days.`,
      `Methodical approach paid off — balance restored on day ${day_count}.`,
    ],
    C: [
      `Recovery took ${day_count} days — the ecosystem held on.`,
      `Close call, but the wetland is stable after ${day_count} days.`,
    ],
    D: [
      `A hard-fought win at day ${day_count}. The biome barely holds.`,
      `The restoration succeeded, though the margin was thin — day ${day_count}.`,
    ],
    E: [
      "The collapse timer ran out. Stressor load outpaced every intervention.",
      "Time expired before health could stabilise. The wetland is lost.",
    ],
    F: [
      `Lost the ${extinctKsName} — the cascade ran away.`,
      `The ${extinctKsName} went extinct; the trophic pyramid collapsed.`,
    ],
  };

  const variants = GRADE_LINES[grade];
  const line     = variants[seedIdx % variants.length];

  return { grade, line };
}

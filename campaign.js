/**
 * campaign.js — Lightweight campaign ladder for Ecosystem X: The Last Balance
 *
 * A mission ladder gives the player a reason to keep playing: each mission uses
 * a fixed biome + seed + modifier combo with escalating difficulty.  Completing
 * a mission unlocks the next.  Progress persists in localStorage under a
 * dedicated key (CAMPAIGN_KEY) — never collides with STORAGE_KEY ('ecosystem_x_state').
 *
 * Rule 01: offline-capable, no live LLM, no Math.random in mission data.
 * Rule 01 / CSP: no inline handlers — callers use data-action delegation.
 * Rule 03: never mutates GameState; owns its own storage key.
 * Rule 02: does NOT change daily-step math or balance.js constants.
 *
 * Exports:
 *   MISSIONS        — the ordered mission array (pure data)
 *   CampaignState   — singleton: load(), save(), complete(missionId)
 *   buildCampaignHTML(selectedMissionId?) — returns HTML for the mission-select list
 */

import { escapeHTML, escapeAttr } from './safehtml.js';

// ─────────────────────────────────────────────────────────────────────────────
// Storage key — must NOT match state.js's STORAGE_KEY ('ecosystem_x_state')
// ─────────────────────────────────────────────────────────────────────────────
const CAMPAIGN_KEY = 'ecosystem_x_campaign';

// ─────────────────────────────────────────────────────────────────────────────
// Mission ladder — 8 missions, difficulty escalates.
//
// Each mission specifies:
//   id        — stable string key (used in localStorage)
//   title     — short display name shown on the card
//   biome     — 'coastal_wetland' | 'coral_reef'
//   seed      — integer; controls world layout + stressor type via pickModifier(seed)
//   modifierHint — one of the MODIFIERS id values; shown as flavour only —
//                  the ACTUAL modifier is derived from seed % MODIFIERS.length
//                  inside generator.js so world generation is NEVER forked.
//                  Seeds are chosen so seed % 5 maps to the intended modifier:
//                    0 → 'none'            (Standard)
//                    1 → 'drought'
//                    2 → 'double_invasive'
//                    3 → 'tight_budget'
//                    4 → 'drought_and_budget' / 'Austerity'
//   winBlurb  — 3-5 word win text shown after completing the mission
//   difficulty — label shown on the card ('Intro' | 'Easy' | 'Medium' | 'Hard' | 'Expert')
//
// Seed selection rationale:
//   MODIFIERS.length === 5 (indices 0-4), so seed % 5 selects the modifier.
//   We pick memorable small seeds within each residue class.
// ─────────────────────────────────────────────────────────────────────────────
export const MISSIONS = [
  {
    id:           'mission_1',
    title:        'First Contact',
    biome:        'coastal_wetland',
    seed:         100,          // 100 % 5 === 0 → modifier 'none' (Standard)
    modifierHint: 'none',
    difficulty:   'Intro',
    winBlurb:     'The wetland breathes again.',
    description:  'A standard wetland in distress. Learn the basics of scanning and intervention.',
  },
  {
    id:           'mission_2',
    title:        'Reef Awakening',
    biome:        'coral_reef',
    seed:         200,          // 200 % 5 === 0 → 'none' (Standard)
    modifierHint: 'none',
    difficulty:   'Easy',
    winBlurb:     'Coral colours return.',
    description:  'Your first reef mission. Species behave differently in saltwater.',
  },
  {
    id:           'mission_3',
    title:        'Dry Season',
    biome:        'coastal_wetland',
    seed:         201,          // 201 % 5 === 1 → 'drought'
    modifierHint: 'drought',
    difficulty:   'Easy',
    winBlurb:     'Rain returns at last.',
    description:  'A prolonged dry spell cuts producer capacity. Prioritise resources.',
  },
  {
    id:           'mission_4',
    title:        'Reef Under Pressure',
    biome:        'coral_reef',
    seed:         301,          // 301 % 5 === 1 → 'drought' (warm-water stress)
    modifierHint: 'drought',
    difficulty:   'Medium',
    winBlurb:     'Bleaching reversed.',
    description:  'Thermal stress hammers the reef producers. Act swiftly before bleaching sets in.',
  },
  {
    id:           'mission_5',
    title:        'Double Invasion',
    biome:        'coastal_wetland',
    seed:         102,          // 102 % 5 === 2 → 'double_invasive'
    modifierHint: 'double_invasive',
    difficulty:   'Medium',
    winBlurb:     'Invasives contained.',
    description:  'Two invasive pressures at once. Rebalancing must be timed carefully to avoid starving your keystone.',
  },
  {
    id:           'mission_6',
    title:        'Budget Cuts',
    biome:        'coral_reef',
    seed:         203,          // 203 % 5 === 3 → 'tight_budget'
    modifierHint: 'tight_budget',
    difficulty:   'Hard',
    winBlurb:     'Restored on a shoestring.',
    description:  'Conservation funding slashed. Every credit counts — choose interventions wisely.',
  },
  {
    id:           'mission_7',
    title:        'Drought & Austerity',
    biome:        'coastal_wetland',
    seed:         204,          // 204 % 5 === 4 → 'drought_and_budget' (Austerity)
    modifierHint: 'drought_and_budget',
    difficulty:   'Hard',
    winBlurb:     'Against all odds.',
    description:  'Deep funding cuts AND drought. You have extra days — use them or lose everything.',
  },
  {
    id:           'mission_8',
    title:        'The Last Balance',
    biome:        'coral_reef',
    seed:         404,          // 404 % 5 === 4 → 'drought_and_budget' (Austerity)
    modifierHint: 'drought_and_budget',
    difficulty:   'Expert',
    winBlurb:     'Ecosystem X: balanced.',
    description:  'The final mission. Reef + austerity + the harshest starting conditions. Prove you understand the web.',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// CampaignState singleton
//
// Schema stored in localStorage (CAMPAIGN_KEY):
//   { completed: string[], unlocked: string[] }
//   completed — mission ids the player has won
//   unlocked  — mission ids currently playable (always a superset of completed)
//
// Invariants:
//   • Mission 1 is always unlocked.
//   • Completing mission N unlocks mission N+1 (if it exists).
//   • completed ⊆ unlocked.
// ─────────────────────────────────────────────────────────────────────────────
export const CampaignState = {
  completed: /** @type {string[]} */ ([]),
  unlocked:  /** @type {string[]} */ ([MISSIONS[0].id]),

  /** Persist to localStorage (separate key from game save). */
  save() {
    try {
      const payload = JSON.stringify({
        completed: this.completed,
        unlocked:  this.unlocked,
      });
      localStorage.setItem(CAMPAIGN_KEY, payload);
    } catch (e) {
      console.warn('[campaign.js] save() failed:', e.message);
    }
  },

  /**
   * Load campaign progress from localStorage.
   * If nothing is stored (first run), initialises with only mission_1 unlocked.
   * Tolerates corrupted data by resetting gracefully.
   */
  load() {
    const raw = localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) {
      this._reset();
      return this;
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad shape');
      this.completed = Array.isArray(parsed.completed)
        ? parsed.completed.filter(x => typeof x === 'string') : [];
      this.unlocked  = Array.isArray(parsed.unlocked)
        ? parsed.unlocked.filter(x => typeof x === 'string') : [MISSIONS[0].id];
      // Always guarantee mission_1 is unlocked — safety net.
      if (!this.unlocked.includes(MISSIONS[0].id)) {
        this.unlocked.unshift(MISSIONS[0].id);
      }
    } catch (e) {
      console.warn('[campaign.js] load() parse error — resetting campaign progress:', e.message);
      this._reset();
    }
    return this;
  },

  /**
   * Mark a mission as completed; unlock the next mission in the ladder.
   * Idempotent — safe to call multiple times for the same mission.
   * @param {string} missionId
   */
  complete(missionId) {
    if (!this.completed.includes(missionId)) {
      this.completed.push(missionId);
    }
    // Unlock next mission
    const idx = MISSIONS.findIndex(m => m.id === missionId);
    if (idx !== -1 && idx + 1 < MISSIONS.length) {
      const nextId = MISSIONS[idx + 1].id;
      if (!this.unlocked.includes(nextId)) {
        this.unlocked.push(nextId);
      }
    }
    this.save();
  },

  /**
   * True if the player has completed ALL missions.
   */
  isFullyComplete() {
    return MISSIONS.every(m => this.completed.includes(m.id));
  },

  /** Internal: reset to only mission_1 unlocked. */
  _reset() {
    this.completed = [];
    this.unlocked  = [MISSIONS[0].id];
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// buildCampaignHTML(selectedMissionId?)
//
// Returns an HTML string for injection into #overlay via showOverlay().
// All interactivity uses data-action / data-* attributes — no inline handlers
// (Rule 01 / strict CSP).
//
// data-action values emitted:
//   'campaign-select'   — user clicks a (unlocked, non-locked) mission row;
//                         data-mission-id carries the id
//   'campaign-play'     — user clicks the "Play" button for the highlighted mission
//   'campaign-close'    — user closes the campaign panel (→ back to start card)
//
// The caller (main.js overlay delegation) handles these actions.
// ─────────────────────────────────────────────────────────────────────────────
export function buildCampaignHTML(selectedMissionId) {
  // Default selection: first incomplete+unlocked mission, or last unlocked.
  const firstPlayable = MISSIONS.find(
    m => CampaignState.unlocked.includes(m.id) && !CampaignState.completed.includes(m.id)
  );
  const resolvedSelected = selectedMissionId
    || firstPlayable?.id
    || CampaignState.unlocked[CampaignState.unlocked.length - 1];

  const selectedMission = MISSIONS.find(m => m.id === resolvedSelected) ?? MISSIONS[0];

  const DIFF_COLOR = {
    Intro:  '#4caf91',
    Easy:   '#56c96d',
    Medium: '#f0a500',
    Hard:   '#e05c2a',
    Expert: '#c0392b',
  };

  // ── Mission list rows ──────────────────────────────────────────────────────
  const rowsHTML = MISSIONS.map((mission, idx) => {
    const isCompleted = CampaignState.completed.includes(mission.id);
    const isUnlocked  = CampaignState.unlocked.includes(mission.id);
    const isSelected  = mission.id === resolvedSelected;
    const isLocked    = !isUnlocked;

    let statusIcon;
    if (isCompleted)    statusIcon = '<span class="cm-status cm-done"  aria-label="Completed">✓</span>';
    else if (isLocked)  statusIcon = '<span class="cm-status cm-lock"  aria-label="Locked">🔒</span>';
    else                statusIcon = '<span class="cm-status cm-open"  aria-label="Available">▷</span>';

    const diffColor = DIFF_COLOR[mission.difficulty] ?? '#aaa';

    const rowClass = [
      'cm-row',
      isSelected  ? 'cm-row-selected'  : '',
      isLocked    ? 'cm-row-locked'    : '',
      isCompleted ? 'cm-row-completed' : '',
    ].filter(Boolean).join(' ');

    const actionAttr = isLocked
      ? ''
      : `data-action="campaign-select" data-mission-id="${escapeAttr(mission.id)}"`;

    return `
      <div class="${escapeHTML(rowClass)}" ${actionAttr} role="button"
           tabindex="${isLocked ? '-1' : '0'}"
           aria-disabled="${isLocked ? 'true' : 'false'}"
           aria-label="Mission ${idx + 1}: ${escapeHTML(mission.title)}${isLocked ? ' (locked)' : isCompleted ? ' (completed)' : ''}">
        <span class="cm-num">${idx + 1}</span>
        ${statusIcon}
        <span class="cm-title">${escapeHTML(mission.title)}</span>
        <span class="cm-diff" style="color:${diffColor};">${escapeHTML(mission.difficulty)}</span>
      </div>`;
  }).join('');

  // ── Detail pane for selected mission ──────────────────────────────────────
  const diffColor = DIFF_COLOR[selectedMission.difficulty] ?? '#aaa';
  const isCompletedSel = CampaignState.completed.includes(selectedMission.id);
  const isUnlockedSel  = CampaignState.unlocked.includes(selectedMission.id);
  const biomeLabel = selectedMission.biome === 'coral_reef' ? '🐠 Coral Reef' : '🌿 Coastal Wetland';

  const playBtnLabel = isCompletedSel ? 'Play Again' : 'Play Mission';
  const playBtnDisabled = !isUnlockedSel;

  const completionBadge = isCompletedSel
    ? `<div class="cm-detail-badge">✓ Completed</div>`
    : '';

  const playBtn = playBtnDisabled
    ? `<button class="cm-play-btn" disabled aria-disabled="true">🔒 Locked</button>`
    : `<button class="cm-play-btn" data-action="campaign-play"
         data-mission-id="${escapeAttr(selectedMission.id)}"
         data-biome="${escapeAttr(selectedMission.biome)}"
         data-seed="${escapeAttr(String(selectedMission.seed))}"
       >${escapeHTML(playBtnLabel)} →</button>`;

  const totalComplete = CampaignState.completed.length;
  const progressPct   = Math.round((totalComplete / MISSIONS.length) * 100);

  return `
    <div class="panel campaign-panel" role="document" aria-label="Mission Select">
      <div class="cm-header">
        <h2 class="cm-heading">Mission Select</h2>
        <div class="cm-progress-wrap" aria-label="Campaign progress: ${totalComplete} of ${MISSIONS.length} missions complete">
          <div class="cm-progress-bar-bg">
            <div class="cm-progress-bar-fill" style="width:${progressPct}%;"></div>
          </div>
          <span class="cm-progress-label">${totalComplete}/${MISSIONS.length} complete</span>
        </div>
        <button class="cm-close-btn" data-action="campaign-close" aria-label="Close mission select">✕</button>
      </div>

      <div class="cm-body">
        <div class="cm-list" role="listbox" aria-label="Missions">
          ${rowsHTML}
        </div>

        <div class="cm-detail">
          ${completionBadge}
          <div class="cm-detail-diff" style="color:${diffColor};">${escapeHTML(selectedMission.difficulty)}</div>
          <h3 class="cm-detail-title">${escapeHTML(selectedMission.title)}</h3>
          <div class="cm-detail-biome">${biomeLabel}</div>
          <p class="cm-detail-desc">${escapeHTML(selectedMission.description)}</p>
          <div class="cm-detail-meta">Seed ${escapeHTML(String(selectedMission.seed))}</div>
          ${isCompletedSel
            ? `<div class="cm-detail-win-blurb">"${escapeHTML(selectedMission.winBlurb)}"</div>`
            : ''}
          ${playBtn}
        </div>
      </div>
    </div>
  `;
}

/**
 * notebook.js — Field Notebook overlay panel for Ecosystem X
 *
 * Shows:
 *   • All discovered nodes (id, name, kind, population, status, keystone)
 *   • All revealed edges (from → to, with beta weight)
 *   • Per-node "codex" entry from ai_content if available
 *
 * Exports:
 *   openNotebook(state)  — injects panel HTML into #overlay, returns nothing
 *
 * Rule 03: read-only — never mutates state.
 */

import { getAICodexEntry } from './ai_content.js';
import { escapeHTML } from './safehtml.js';

// ─────────────────────────────────────────────────────────────────────────────
// Kind → display label + colour
// ─────────────────────────────────────────────────────────────────────────────
const KIND_BADGE = {
  producer: { label: 'PRODUCER', color: '#26c97a' },
  consumer: { label: 'CONSUMER', color: '#5bc4e8' },
  predator: { label: 'PREDATOR', color: '#e8a84a' },
  stressor: { label: 'STRESSOR', color: '#c04020' },
};

const STATUS_COLOR = {
  stable:     '#4ccea0',
  endangered: '#f0a500',
  extinct:    '#888',
};

// Population trend vs the start of the last day (node.prev_population, recorded
// by ecosystem.runDailyStep). Guarded for non-finite (tampered/early state).
function _trend(node) {
  const prev = node.prev_population;
  if (!Number.isFinite(prev) || !Number.isFinite(node.population)) return 0;
  return Math.sign(node.population - prev);
}
/** Styled arrow span for the species record (HTML — used in unescaped context). */
function trendArrowHTML(node) {
  const d = _trend(node);
  if (d > 0) return `<span class="nb-trend nb-trend-up" title="rising">▲</span>`;
  if (d < 0) return `<span class="nb-trend nb-trend-down" title="falling">▼</span>`;
  return `<span class="nb-trend nb-trend-flat" title="stable">▬</span>`;
}
/** Plain unicode arrow for the diagnosis evidence (escaped context — no HTML). */
function trendChar(node) {
  const d = _trend(node);
  return d > 0 ? ' ▲' : d < 0 ? ' ▼' : '';
}

// ─────────────────────────────────────────────────────────────────────────────
// Build node card HTML
// ─────────────────────────────────────────────────────────────────────────────
function nodeCardHTML(node, state) {
  const badge  = KIND_BADGE[node.kind] ?? { label: node.kind.toUpperCase(), color: '#aaa' };
  const sColor = STATUS_COLOR[node.status] ?? '#aaa';
  const relPop = node.K_max > 0
    ? Math.round((node.population / node.K_max) * 100)
    : 0;

  const codex  = getAICodexEntry(node.id);
  const codexHTML = codex
    ? `<p class="nb-codex">"${escapeHTML(codex)}"</p>`
    : '';

  const keystoneMark = node.keystone
    ? `<span style="color:#f0a500;margin-left:6px;" title="Keystone species">★ KEYSTONE</span>`
    : '';

  const popBar = node.kind === 'stressor' ? '' : `
    <div class="nb-bar-track">
      <div class="nb-bar-fill" style="width:${relPop}%;background:${badge.color}"></div>
    </div>
    <span class="nb-pop-label">${node.population} / ${Math.round(node.K_max)} (${relPop}%) ${trendArrowHTML(node)}</span>
  `;

  return `
    <div class="nb-node-card">
      <div class="nb-node-header">
        <span class="nb-kind-badge" style="background:${badge.color}20;color:${badge.color};border-color:${badge.color}40;">
          ${escapeHTML(badge.label)}
        </span>
        <strong class="nb-node-name">${escapeHTML(node.name)}</strong>
        ${keystoneMark}
        <span class="nb-status" style="color:${sColor}">● ${escapeHTML(String(node.status).toUpperCase())}</span>
      </div>
      ${popBar}
      ${codexHTML}
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build edge list HTML
// ─────────────────────────────────────────────────────────────────────────────
function edgesHTML(state) {
  const revealed = state.world.edges.filter(e => e.revealed);
  if (revealed.length === 0) {
    return `<p style="opacity:0.5;font-style:italic">No trophic links revealed yet. Keep scanning.</p>`;
  }

  const items = revealed.map(e => {
    const fromNode = state.world.nodes[e.from];
    const toNode   = state.world.nodes[e.to];
    const fromName = fromNode?.name ?? e.from;
    const toName   = toNode?.name   ?? e.to;
    const betaStr  = e.beta > 0 ? `β=${e.beta.toFixed(3)}` : 'impact edge';
    return `
      <div class="nb-edge-row">
        <span class="nb-edge-from">${escapeHTML(fromName)}</span>
        <span class="nb-edge-arrow">→</span>
        <span class="nb-edge-to">${escapeHTML(toName)}</span>
        <span class="nb-edge-beta">${betaStr}</span>
      </div>
    `;
  }).join('');

  return `<div class="nb-edge-list">${items}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// openNotebook(state) — public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * openNotebook(state)
 * Injects the notebook panel into #overlay and shows it.
 * Caller is responsible for injecting into overlay.innerHTML.
 *
 * @param {object} state — GameState
 * @returns {string} HTML string for the panel
 */
// ─────────────────────────────────────────────────────────────────────────────
// Field Diagnosis — surfaces the active-stressor SYMPTOMS as a detective-style
// case file. Each cause is only revealed once its evidence is gathered (pollution
// is visible on the map; the invasive / harvested species must be SCANNED), then
// it names the likely cause and the matching counter-intervention. Read-only.
// ─────────────────────────────────────────────────────────────────────────────
function buildDiagnosisHTML(state) {
  const stressors  = state.world.activeStressors ?? [];
  const nodes      = state.world.nodes;
  const tiles      = state.world.tiles;
  const discovered = new Set(state.notebook.discovered_nodes);
  const symptoms   = [];
  let pending      = 0; // active causes whose evidence isn't gathered yet

  for (const s of stressors) {
    if (s.type === 'runoff') {
      // Pollution is directly observable on the map (toxic tiles).
      const polluted = Object.values(tiles).filter(t => (t.stressor ?? 0) >= 40);
      if (polluted.length > 0) {
        const maxL = Math.round(Math.max(...polluted.map(t => t.stressor)));
        symptoms.push({
          icon: '☣', title: 'Nutrient pollution', tool: 'bioremediation',
          evidence: `${polluted.length} tile(s) contaminated — stressor up to ${maxL}, spreading from a source.`,
          action: 'Bioremediate the SOURCE tile — cleaning it stops the spread.',
        });
      } else pending++;
    } else if (s.type === 'invasive') {
      const inv = Object.values(nodes).find(n => n.kind === 'invasive');
      if (inv && discovered.has(inv.id)) {
        const edge   = state.world.edges.find(e => e.from === inv.id && e.revealed);
        const target = edge ? nodes[edge.to] : nodes[s.targetNative];
        symptoms.push({
          icon: '🦠', title: 'Invasive species', tool: 'rebalancing',
          evidence: `${inv.name}${trendChar(inv)} is established and multiplying${target ? `, suppressing ${target.name}${trendChar(target)}` : ''}.`,
          action: `Cull ${inv.name} (Rebalancing) — repeated culls drive it out.`,
        });
      } else pending++;
    } else if (s.type === 'overharvest') {
      const target = nodes[s.targetNative];
      if (target && discovered.has(s.targetNative)) {
        symptoms.push({
          icon: '🎣', title: 'Overharvesting', tool: 'stabilization',
          evidence: `${target.name}${trendChar(target)} is being depleted faster than it can breed, with no predator surge to explain it — an external removal pressure.`,
          action: `Protect ${target.name}'s habitat (Stabilization) to stop the drain.`,
        });
      } else pending++;
    }
  }

  let body;
  if (symptoms.length === 0) {
    body = `<p class="diag-empty">No cause confirmed yet. Survey the wetland for pollution and scan species to gather evidence${pending ? ' — something is still hidden.' : '.'}</p>`;
  } else {
    body = symptoms.map(s => `
      <div class="diag-card">
        <div class="diag-head">
          <span class="diag-icon">${s.icon}</span>
          <strong>${escapeHTML(s.title)}</strong>
          <span class="diag-tool-tag">${escapeHTML(s.tool)}</span>
        </div>
        <p class="diag-evidence">${escapeHTML(s.evidence)}</p>
        <div class="diag-action">↳ ${escapeHTML(s.action)}</div>
      </div>`).join('');
    if (pending) {
      body += `<p class="diag-empty">…another cause may still be hidden — keep investigating.</p>`;
    }
  }
  return `
    <section class="nb-section">
      <h3>🔬 Field Diagnosis</h3>
      ${body}
    </section>`;
}

export function buildNotebookHTML(state) {
  const discoveredNodes = state.notebook.discovered_nodes
    .map(id => state.world.nodes[id])
    .filter(Boolean);

  const nodeCards = discoveredNodes.length === 0
    ? `<p style="opacity:0.5;font-style:italic">No species scanned yet. Move to a tile with a species and press E or click.</p>`
    : discoveredNodes.map(n => nodeCardHTML(n, state)).join('');

  // Count discovered SPECIES only (exclude the stressor source) so the numerator
  // matches the species-only denominator — otherwise scanning runoff shows 4/3.
  const scanCount   = discoveredNodes.filter(n => n.kind !== 'stressor').length;
  const totalNodes  = Object.values(state.world.nodes).filter(n => n.kind !== 'stressor').length;
  const edgeCount   = state.notebook.revealed_edges.length;
  const totalEdges  = state.world.edges.length;          // all trophic links (including stressor edges)

  return `
    <div class="panel nb-panel" role="document" aria-label="Field Notebook">
      <div class="nb-header">
        <h2>📓 Field Notebook</h2>
        <button class="btn btn-sm" data-action="close" aria-label="Close notebook">✕</button>
      </div>

      <div class="nb-stats-row">
        <span>🔬 Species scanned: <strong>${scanCount} / ${totalNodes}</strong></span>
        <span>🔗 Links revealed: <strong>${edgeCount} / ${totalEdges}</strong></span>
        <span>⚡ Scanner charges: <strong>${state.player.scanner_charges}</strong></span>
      </div>

      <section class="nb-section">
        <h3>Species Records</h3>
        <div class="nb-nodes-list">${nodeCards}</div>
      </section>

      ${buildDiagnosisHTML(state)}

      <section class="nb-section">
        <h3>Trophic Web (Revealed Links)</h3>
        ${edgesHTML(state)}
      </section>

      <div class="nb-footer">
        <button class="btn" data-action="open-vendor">🛒 Open Intervention Store</button>
        <button class="btn btn-secondary" data-action="endday">⏭ Advance Day</button>
      </div>
    </div>
  `;
}

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
    ? `<p class="nb-codex">"${codex}"</p>`
    : '';

  const keystoneMark = node.keystone
    ? `<span style="color:#f0a500;margin-left:6px;" title="Keystone species">★ KEYSTONE</span>`
    : '';

  const popBar = node.kind === 'stressor' ? '' : `
    <div class="nb-bar-track">
      <div class="nb-bar-fill" style="width:${relPop}%;background:${badge.color}"></div>
    </div>
    <span class="nb-pop-label">${node.population} / ${Math.round(node.K_max)} (${relPop}%)</span>
  `;

  return `
    <div class="nb-node-card">
      <div class="nb-node-header">
        <span class="nb-kind-badge" style="background:${badge.color}20;color:${badge.color};border-color:${badge.color}40;">
          ${badge.label}
        </span>
        <strong class="nb-node-name">${node.name}</strong>
        ${keystoneMark}
        <span class="nb-status" style="color:${sColor}">● ${node.status.toUpperCase()}</span>
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
        <span class="nb-edge-from">${fromName}</span>
        <span class="nb-edge-arrow">→</span>
        <span class="nb-edge-to">${toName}</span>
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

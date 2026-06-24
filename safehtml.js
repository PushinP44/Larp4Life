/**
 * safehtml.js — HTML/attribute escaping for safe interpolation into innerHTML.
 *
 * Security control for PENTEST F2 (DOM-XSS via save-derived data → innerHTML).
 * Every dynamic value that originates from the save (species/edge names, seed,
 * report text, error messages) MUST pass through escapeHTML() (element text) or
 * escapeAttr() (quoted attribute value) before being placed in a template string
 * that is assigned to innerHTML.
 *
 * No dependencies; pure functions; never throws (coerces non-strings to string).
 */

const _HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/**
 * escapeHTML(value) → string
 * Escapes the five HTML-significant characters (+ backtick) so the value renders
 * as literal text inside an element. Safe for element content.
 * @param {*} value — coerced to string
 * @returns {string}
 */
export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"'`]/g, (c) => _HTML_ESCAPES[c]);
}

/**
 * escapeAttr(value) → string
 * Same escaping, intended for use inside a double-quoted HTML attribute
 * (e.g. data-seed="${escapeAttr(x)}"). Prevents attribute breakout.
 * @param {*} value
 * @returns {string}
 */
export function escapeAttr(value) {
  return escapeHTML(value);
}

// build-freshness-note.js — the "Your app: ..." line of a Ready-for-review card (PRO42, AGE35).
// Checks each PR link through GET /api/build-freshness and rolls them up (shared/build-freshness-rollup.js);
// an epic card reads its children's links, since the epic has none of its own.

import { cardPrLinks, rollUpFreshness } from '../../shared/build-freshness-rollup.js';

// Build freshness per PR link: url -> result, or null when nothing applies (kept for the page's life).
const freshnessByUrl = new Map();
const freshnessPending = new Set();

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * The build line of a review card, or null while loading / when no rule applies. `tasks` is every
 * ticket (flat, dashboard shape); `rerender` is called once a lookup lands. Fetches lazily.
 */
export function buildFreshnessNote(task, tasks, rerender) {
  const links = cardPrLinks(task, tasks);
  const entries = links.map(({ ticketId, url }) => {
    if (!freshnessByUrl.has(url) && !freshnessPending.has(url) && typeof fetch === 'function') {
      freshnessPending.add(url);
      fetch(`/api/build-freshness?url=${encodeURIComponent(url)}`).then(r => (r.ok ? r.json() : null)).catch(() => null).then((res) => {
        freshnessPending.delete(url);
        freshnessByUrl.set(url, res && res.state ? res : null);
        if (res && res.state && typeof rerender === 'function') rerender();
      });
    }
    return { ticketId, result: freshnessByUrl.has(url) ? freshnessByUrl.get(url) : undefined };
  });
  const line = rollUpFreshness(entries, task?.taskId);
  if (!line) return null;
  const note = el('div', `rp-build rp-build-${line.kind}`, line.unknown ? line.text : `Your app: ${line.text}`);
  if (line.staleIds) note.appendChild(document.createTextNode(`. Behind: ${line.staleIds.join(', ')}`));
  if (line.command) {
    note.appendChild(document.createTextNode('. Update: '));
    note.appendChild(el('code', null, line.command));
  }
  return note;
}

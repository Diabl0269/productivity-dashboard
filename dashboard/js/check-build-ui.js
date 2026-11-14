// check-build-ui.js — PRO100: next to a check's Open project button, the exact app build it opens in
// and whether that build has the change. Nothing is shown when no build is configured or known.

import { checkBuildInfo, noProjectLine } from '../../shared/check-build.js';
import { buildFreshnessLine } from './build-freshness-note.js';

let reviewApp; // undefined = not asked yet, null = none configured, { app, builtAt } = the newest build
let pending = false;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function loadReviewApp(rerender) {
  if (reviewApp !== undefined || pending || typeof fetch !== 'function') return;
  pending = true;
  fetch('/api/review-app').then(r => (r.ok ? r.json() : null)).catch(() => null).then((res) => {
    pending = false;
    reviewApp = res && res.app ? res : null;
    if (reviewApp && typeof rerender === 'function') rerender();
  });
}

/** The build chip of one check (path + "in your build" / "needs a newer build"), or null. `tasks` is every ticket (flat). */
export function checkBuildChip(task, check, tasks, rerender) {
  loadReviewApp(rerender);
  if (!check?.project) return null;
  const freshness = check.heldPr ? null : buildFreshnessLine(task, tasks, rerender);
  const info = checkBuildInfo(check, reviewApp, freshness);
  if (!info) return null;
  const chip = el('span', 'rp-check-build');
  chip.appendChild(el('span', 'rp-check-muted', 'Build: '));
  chip.appendChild(el('code', null, info.app));
  if (info.text) chip.appendChild(el('span', `rp-check-build-${info.state}`, ` (${info.text})`));
  chip.title = `Open project opens in ${info.app}${info.builtAt ? `, built ${info.builtAt.slice(0, 16).replace('T', ' ')}` : ''}`;
  return chip;
}

/** The muted "No project: <reason>" span of a check filed without a project, or null. */
export function noProjectNote(check) {
  const text = noProjectLine(check);
  return text ? el('span', 'rp-check-muted', text) : null;
}

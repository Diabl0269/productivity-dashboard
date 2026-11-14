// held-pr-ui.js — PRO92: a check on an unmerged PR says so on the Plan page.
// A check with `heldPr: { pr, branch }` (shared/held-pr.js) gets a chip "on branch X (PR #n), not merged"
// and, when it has a project, its Open project button's tooltip says the project needs a build of that
// branch. The PR state comes from /api/pr-state (one lookup per distinct PR per page load); once it says
// MERGED the chip goes and the tooltip is restored. Silent when the server or gh cannot answer.

import { prNumber } from '../../shared/held-pr.js';

const lookups = new Map(); // PR url -> Promise<state string | ''>

/** The PR's state ('OPEN', 'MERGED', ...) or '' when it cannot be read; asked once per page load. */
function prStateOnce(url) {
  if (!lookups.has(url)) {
    const none = Promise.resolve('');
    if (typeof fetch !== 'function' || (typeof location !== 'undefined' && location.protocol === 'file:')) lookups.set(url, none);
    else {
      lookups.set(url, fetch(`/api/pr-state?url=${encodeURIComponent(url)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(res => String(res?.state || '').toUpperCase())
        .catch(() => ''));
    }
  }
  return lookups.get(url);
}

/** The chip text for a heldPr. */
export function heldPrText(held) {
  const n = prNumber(held.pr);
  const pr = n ? ` (PR ${n})` : '';
  return `${held.branch ? `on branch ${held.branch}` : 'on its PR branch'}${pr}, not merged`;
}

/** The tooltip for an Open project button whose project lives only on the held branch. */
export function heldPrProjectTitle(held) {
  return `This project needs a build of branch ${held.branch || 'the PR'}; main does not have the change yet`;
}

/**
 * The chip for `check` (null when it has no heldPr). `buttons` are Open project buttons (the check's
 * group header's) whose tooltip is replaced while the PR is unmerged.
 */
export function heldPrChip(check, buttons = []) {
  const held = check?.heldPr;
  if (!held?.pr) return null;
  const chip = document.createElement('span');
  chip.className = 'rp-check-branch';
  chip.textContent = heldPrText(held);
  chip.title = held.pr;
  const was = new Map();
  for (const b of buttons) { was.set(b, b.title); b.title = heldPrProjectTitle(held); }
  prStateOnce(held.pr).then((state) => {
    if (state !== 'MERGED') return;
    chip.remove();
    for (const [b, title] of was) b.title = title;
  });
  return chip;
}

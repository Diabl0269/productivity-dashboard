// held-pr-ui.js — PRO92: a check on an unmerged PR says so on the Plan page.
// A check with `heldPr: { pr, branch }` (shared/held-pr.js) gets a chip "on branch X (PR #n), not merged"
// and, when it has a project, its Open project button's tooltip says the project needs a build of that
// branch. The PR state comes from /api/pr-state (one lookup per distinct PR per page load); once it says
// MERGED the chip goes and the tooltip is restored. Silent when the server or gh cannot answer.

import { prNumber } from '../../shared/held-pr.js';

const lookups = new Map(); // PR url -> Promise<{ state, branch }>

/** The PR's { state, branch } ('OPEN', 'MERGED', ...; '' when it cannot be read); asked once per page load. */
function prInfoOnce(url) {
  if (!lookups.has(url)) {
    const none = Promise.resolve({ state: '', branch: '' });
    if (typeof fetch !== 'function' || (typeof location !== 'undefined' && location.protocol === 'file:')) lookups.set(url, none);
    else {
      lookups.set(url, fetch(`/api/pr-state?url=${encodeURIComponent(url)}`)
        .then(r => (r.ok ? r.json() : null))
        .then(res => ({ state: String(res?.state || '').toUpperCase(), branch: String(res?.branch || '') }))
        .catch(() => ({ state: '', branch: '' })));
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

/** AGE162: the tooltip for the Open project button of a held check that has no saved project. */
export function heldPrBranchTitle(held) {
  return `Open the build of ${held.branch ? `branch ${held.branch}` : 'its PR branch'} (no saved project)`;
}

/**
 * The chip for `check` (null when it has no heldPr). `buttons` are Open project buttons (the check's
 * group header's) whose tooltip is replaced while the PR is unmerged.
 */
export function heldPrChip(check, buttons = []) {
  return heldChip(check?.heldPr, buttons);
}

/**
 * PRO101: the same chip for an ask with a `mergePr` (its branch comes from the PR lookup).
 * `buttons` are the ask's Open project buttons.
 */
export function askHeldPrChip(ask, buttons = []) {
  return ask?.mergePr ? heldChip({ pr: ask.mergePr, branch: '' }, buttons) : null;
}

function heldChip(held, buttons) {
  if (!held?.pr) return null;
  const chip = document.createElement('span');
  chip.className = 'rp-check-branch';
  chip.textContent = heldPrText(held);
  chip.title = held.pr;
  const was = new Map();
  // PRO101: while unmerged, Open project asks for the PR's branch build; MERGED clears it (newest main build again).
  const live = { pr: held.pr, branch: held.branch };
  const titleOf = (b, h) => (b.branchOnly ? heldPrBranchTitle(h) : heldPrProjectTitle(h));
  for (const b of buttons) { was.set(b, b.title); b.title = titleOf(b, held); b.held = live; }
  prInfoOnce(held.pr).then(({ state, branch }) => {
    if (state === 'MERGED') {
      chip.remove();
      // AGE162: a branch-only button has nothing to open on main (no project), so it goes.
      for (const [b, title] of was) { if (b.branchOnly) { b.remove(); continue; } b.title = title; b.held = null; }
      return;
    }
    if (!live.branch && branch) {
      live.branch = branch;
      chip.textContent = heldPrText(live);
      for (const b of was.keys()) b.title = titleOf(b, live);
    }
  });
  return chip;
}

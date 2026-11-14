/**
 * cli/lib/taste-checks.js — PRO86: a taste question is a check, never an ask.
 *
 * `ch tasks review` takes each Unverified line `needs-tal: taste: <what to judge> | video=<path>
 * project=<path> audio=<path>` out of the result and makes it a check (paths under
 * $CH_HOME/evidence, at least one). A line without media is refused. When the ticket, its epic or
 * this call already has a check on the same project, the line folds into that check instead of
 * adding a second one (FRO1033 duplicated FRO1257's check this way). Without a project hit, a check
 * that says the same judgement (shared/ask-check-overlap.js) takes it too (PRO90).
 *
 * Pure apart from `relOrDie(value, kind, flag)`, which the caller passes to validate a path on disk.
 */

import { sameJudgement } from '../../shared/ask-check-overlap.js';

const TASTE_LINE = /^\s*needs-tal\s*:\s*taste\s*:\s*/i;
const MEDIA_RE = /\b(project|video|audio)\s*=\s*(\S+)/gi;

/** Is this Unverified line a taste question for Tal? */
export function isTasteLine(line) {
  return TASTE_LINE.test(String(line ?? ''));
}

/** `needs-tal: taste: <text> | video=a.mp4` -> { text, media: { video: 'a.mp4' } }. */
export function parseTasteLine(line) {
  const body = String(line).replace(TASTE_LINE, '');
  const bar = body.lastIndexOf('|');
  const text = (bar >= 0 ? body.slice(0, bar) : body).trim();
  const media = {};
  if (bar >= 0) for (const m of body.slice(bar + 1).matchAll(MEDIA_RE)) media[m[1].toLowerCase()] = m[2];
  return { text, media };
}

/**
 * Split `unverified` into the lines that stay and the checks made from taste lines.
 * Throws an Error naming every taste line that carries no media.
 * @returns {{ unverified: string[], checks: Array<{ text, project?, video?, audio?, taste: true }> }}
 */
export function tasteLinesToChecks(unverified, relOrDie) {
  const keep = [];
  const checks = [];
  const bare = [];
  for (const line of unverified || []) {
    if (!isTasteLine(line)) { keep.push(line); continue; }
    const { text, media } = parseTasteLine(line);
    if (!text || !Object.keys(media).length) { bare.push(line); continue; }
    const check = { text, taste: true };
    for (const [kind, value] of Object.entries(media)) check[kind] = relOrDie(value, kind, `needs-tal: taste: ${kind}=`);
    checks.push(check);
  }
  if (bare.length) {
    throw new Error(`a taste question is a check on the epic and needs the thing to judge (${bare.length}):\n${bare.map(l => `  - "${l}"`).join('\n')}\n`
      + 'Add the media after a bar, e.g. "needs-tal: taste: caption colour | video=FRO1/caption.mp4 project=FRO1/caption.agsproj", or pass it as --check with --check-video / --check-audio / --check-project.');
  }
  return { unverified: keep, checks };
}

/**
 * Fold taste checks into `targets` (existing checks: the ticket's, its epic's, this call's) that
 * use the same project, else (PRO90) say the same judgement. Mutates the targets; returns the taste checks still to add.
 */
export function foldTasteChecks(tasteChecks, targets) {
  const rest = [];
  for (const c of tasteChecks) {
    const byProject = c.project ? targets.find(t => t && t !== c && t.project === c.project) : null;
    // PRO90: with no project hit, a target that says the same judgement takes it (near-duplicates no longer stand side by side).
    const hit = byProject || targets.find(t => t && t !== c && !t.checked && !t.handedTo && sameJudgement(t.text, c.text));
    if (!hit) { const { taste: _t, ...plain } = c; rest.push(plain); continue; }
    if (byProject && !String(hit.text).toLowerCase().includes(c.text.toLowerCase())) hit.text = `${hit.text}. Also judge: ${c.text}`;
    for (const kind of ['video', 'audio']) if (c[kind] && !hit[kind]) { hit[kind] = c[kind]; if (kind === 'video') delete hit.noVideo; }
  }
  return rest;
}

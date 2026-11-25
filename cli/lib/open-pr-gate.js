/**
 * cli/lib/open-pr-gate.js
 * PRO70: `ch tasks review` refuses a ticket whose pull request is still open, so nobody reviews a
 * build that lacks the feature. A PR may be held open on purpose (waiting on a real-machine look):
 * `--held-pr '<why>' --try-steps '<steps>'` lets it through and adds the check "Try on branch X: <steps>"
 * (AGE162: the steps are required, at least 40 characters, so Tal knows what to try; the generic
 * "say merge or not" text is refused).
 * MERGED passes; CLOSED-unmerged refuses; gh missing/offline/unreadable warns and does not block.
 * `state` is injectable so tests need no real gh.
 */

import { spawnSync } from 'node:child_process';
import { saysNothingToTry } from '../../shared/merge-decision.js';

const MIN_STEPS = 40;
const PR_LABEL = /^\s*PR\s*#\d+/i;
const PR_URL = /github\.com\/[^/\s]+\/[^/\s]+\/pull\/\d+/i;

/** WEB38: wording of a taste judgement ("whether these ... are the ones you want", "do you like ..."). */
export const TASTE_QUESTION = /\bwhether\b|\bare the ones you want\b|\bdo you like\b|\blook right\b|\bwhich (one|of)\b/i;
const TRY_ON_BRANCH = /^\s*Try on branch\b/i;

/** WEB38: the first check (text or {text}) that already holds the taste judgement, ignoring the auto "Try on branch" check. */
export function tasteCheckIn(checks) {
  for (const c of checks || []) {
    const t = typeof c === 'string' ? c : c?.text;
    if (typeof t === 'string' && !TRY_ON_BRANCH.test(t) && TASTE_QUESTION.test(t)) return t;
  }
  return null;
}

/** WEB39: tickets of these projects need a command and a URL in --try-steps. */
const hasCommand = (s) => /`[^`\n]+`/.test(s);
const hasUrl = (s) => /https?:\/\//i.test(s);

/** Links that name a pull request: label 'PR #n' or a github.com/.../pull/n URL. */
export function prLinks(links) {
  return (links || []).filter(l => l && l.url && (PR_LABEL.test(l.label || '') || PR_URL.test(l.url)));
}

/** Ask gh for a PR's state. Returns { state, branch } or { error }. */
export function ghPrState(url) {
  const r = spawnSync('gh', ['pr', 'view', url, '--json', 'state,headRefName'], { encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) return { error: (r.error?.code === 'ENOENT' ? 'gh not installed' : (r.stderr || '').trim().split('\n')[0]) || 'gh failed' };
  try {
    const j = JSON.parse(r.stdout);
    return { state: String(j.state || '').toUpperCase(), branch: j.headRefName || '' };
  } catch {
    return { error: 'gh returned unreadable output' };
  }
}

/**
 * Decide what a review does about the ticket's PR links.
 * @returns {{ error: string|null, warnings: string[], checks: string[], held: object|null }}
 */
export function openPrGate({ id, links, heldPr, trySteps, state = ghPrState, checks, project }) {
  const out = { error: null, warnings: [], checks: [], held: null };
  const why = typeof heldPr === 'string' ? heldPr.trim() : '';
  const steps = typeof trySteps === 'string' ? trySteps.trim() : '';
  const seen = new Set();
  for (const { url } of prLinks(links)) {
    if (seen.has(url)) continue;
    seen.add(url);
    const s = state(url);
    if (s.error) { out.warnings.push(`could not check ${url} (${s.error}); not blocking`); continue; }
    if (s.state === 'MERGED') continue;
    if (s.state === 'CLOSED') {
      out.error = `${id}: ${url} was closed without merging. Reopen or merge it, or drop the link (ch tasks update ${id} --remove-link N), then review.`;
      return out;
    }
    if (s.state !== 'OPEN') { out.warnings.push(`${url} has state "${s.state}"; not blocking`); continue; }
    if (heldPr !== undefined && !why) { out.error = '--held-pr needs a reason: --held-pr "<why the PR stays open>"'; return out; }
    if (!why) {
      out.error = `${id}: ${url} is still open, so a review would check a build without the feature. Merge it first, or if it is held open on purpose pass --held-pr "<why>" --try-steps "<exact steps on branch ${s.branch || '<branch>'} and what Tal should see>" (adds the check "Try on branch ${s.branch || '<branch>'}: <steps>").`;
      return out;
    }
    if (steps && saysNothingToTry(steps)) {
      // AGE219: nothing to see or hear is a merge decision, not a check: no "Try on branch" check, no Open project button.
      out.error = `${id}: --try-steps says there is nothing to see or hear on branch ${s.branch || '<branch>'}, so there is no check to file: the merge decision belongs on a merge ask (or file a merge ask with ch tasks ask --merge-pr). File it with ch tasks ask ${id} "<merge question naming the PR and the live effect>" --option "A: Merge" --option "B: Keep held" --details "<60+ chars>" --merge-pr ${url} (drop --held-pr/--try-steps here; pass --no-checks "<reason>" when the review has no other checks).`;
      return out;
    }
    if (steps.length < MIN_STEPS || /say merge or not/i.test(steps)) {
      out.error = `--held-pr needs --try-steps "<exact steps on branch ${s.branch || '<branch>'} and what Tal should see>", e.g. --try-steps "Open project, in the Mixer panel press Play on the Reverb card: the tail should fade out in about 2 s"`;
      return out;
    }
    if (project === 'website' && !(hasCommand(steps) && hasUrl(steps))) {
      out.error = `--try-steps on a website ticket needs a runnable command (in backticks) and the URL to open. Start the branch's site with \`scripts/launch-web-branch.sh ${s.branch || '<branch>'}\` (it prints the URL), e.g. --try-steps "Site started with \`scripts/launch-web-branch.sh ${s.branch || 'feat/x'}\`, open http://localhost:4321/account: the plan card shows the new price"`;
      return out;
    }
    const taste = tasteCheckIn(checks);
    if (taste) {
      out.error = `${id}: the ticket already has a check for the taste part ("${taste.slice(0, 80)}"), so the held-PR check would repeat it. A merge decision belongs on a card: ch tasks ask ${id} "<merge question naming the PR and the live effect>" --option "A: Merge" --option "B: Keep held" --details "<60+ chars>" --merge-pr ${url} --same-judgement`;
      return out;
    }
    out.checks.push(`Try on branch ${s.branch || url}: ${steps}`);
    out.held = { reason: why, pr: url, branch: s.branch, at: new Date().toISOString() };
  }
  return out;
}

/** WEB40: why a website/backend check has no synth music project. */
export const NO_SYNTH_PROJECT = { website: 'website page, no synth project', backend: 'backend, no synth project' };

/**
 * FRO1979: the auto-added "Try on branch X" check has no evidence of its own, so it takes the first
 * project (or its noProject reason) and the first video/audio (or its noVideo reason) of the review's
 * other checks: Plan then shows Open project (in the branch's build) and Play video on it too.
 * `siblings` are the checks the call passed, or the ticket's own when it passed none.
 */
export function inheritHeldCheckEvidence(item, siblings, opts = {}) {
  const from = (siblings || []).filter(c => c && c !== item);
  const project = from.find(c => c.project);
  const noProject = from.find(c => c.noProject);
  const reason = NO_SYNTH_PROJECT[opts?.project];
  if (reason) item.noProject = reason; // WEB40: a website/backend check never inherits a synth project
  else if (project) item.project = project.project;
  else if (noProject) item.noProject = noProject.noProject;
  const video = from.find(c => c.video);
  const noVideo = from.find(c => c.noVideo);
  const audio = from.find(c => c.audio);
  if (video) item.video = video.video;
  else if (noVideo) item.noVideo = noVideo.noVideo;
  if (audio) item.audio = audio.audio;
  return item;
}

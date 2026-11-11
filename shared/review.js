/**
 * shared/review.js — "Ready for review": shipped work waiting for Tal's own look.
 *
 * A ticket lands in the `review` section (between In progress and Done) when its PR has
 * merged. It carries:
 *   - `result`  what shipped, set by the session that shipped it (see normalizeResult)
 *   - `checks`  the "worth checking yourself" list, ticked one by one in the tracker
 * Ticking the last check moves it to Done. A ticket opened while reviewing another one
 * records `reviewOf: <id>`, so the Plan page can show the relation both ways.
 *
 * Pure (no fs, no DOM); used by the CLI, the run plan and the dashboard.
 */

import { hasUnsentNotes, unsentNotes } from './review-notes.js';

export const REVIEW_SECTION = 'review';
export const REVIEW_SECTION_NAME = 'Ready for review';

const ISO_RE = /^\d{4}-\d{2}-\d{2}T/;

/** True when every check is ticked (also when there are none). */
export function allChecksTicked(task) {
  return (task?.checks || []).every(c => c && c.checked);
}

/** { done, total } for a ticket's checks. */
export function checkProgress(task) {
  const checks = task?.checks || [];
  return { done: checks.filter(c => c && c.checked).length, total: checks.length };
}

/**
 * Should a review ticket move to Done now? Only after a tick in this action, so a ticket
 * with no checks doesn't jump to Done on an unrelated edit. Never while review notes are
 * still unsent (neither filed nor dismissed).
 */
export function reviewComplete(task, sectionId, { ticked }) {
  return sectionId === REVIEW_SECTION && !!ticked && allChecksTicked(task) && !hasUnsentNotes(task);
}

/**
 * When the ticket shipped into review: its result's time (set when the work shipped, so a
 * backfilled result keeps its original date), else the last history move to `review`,
 * else updated.
 */
export function enteredReviewAt(task) {
  if (task?.result && typeof task.result.at === 'string') return task.result.at;
  const history = Array.isArray(task?.history) ? task.history : [];
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && h.to === REVIEW_SECTION && typeof h.at === 'string') return h.at;
  }
  return task?.updated || task?.created || '';
}

function cleanList(value, name) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.map((item) => {
    if (typeof item !== 'string') throw new Error(`result.${name} must be a list of strings`);
    return item.trim();
  }).filter(Boolean);
}

/**
 * Validate and tidy a ship result. Shape on the ticket:
 *   { at: ISO, shipped: string[], left?: string[], tests?: string[], ci: string,
 *     unverified?: string[], risks?: string[], fixed?: string[], opened?: string[] }
 * Optional lists are omitted when empty: `left` (blocked or left over), `tests` (added or
 * changed), `unverified` (major things not checked for real), `risks`, `fixed` (fixed on
 * the way) and `opened` (tickets opened). Judgment calls go in the ticket's `decisions`;
 * `ci` defaults to "all passed".
 */
export function normalizeResult(input, { now = new Date().toISOString() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('result must be an object');
  }
  const shipped = cleanList(input.shipped, 'shipped');
  if (!shipped.length) throw new Error('result.shipped needs at least one line');
  const out = { at: typeof input.at === 'string' && ISO_RE.test(input.at) ? input.at : now, shipped };
  const left = cleanList(input.left, 'left');
  if (left.length) out.left = left;
  const tests = cleanList(input.tests, 'tests');
  if (tests.length) out.tests = tests;
  for (const key of ['unverified', 'risks', 'fixed', 'opened']) {
    const list = cleanList(input[key], key);
    if (list.length) out[key] = list;
  }
  const ci = typeof input.ci === 'string' && input.ci.trim() ? input.ci.trim() : 'all passed';
  out.ci = ci;
  return out;
}

/** Schema errors for a stored result (empty when valid). */
export function resultErrors(result, ref) {
  try {
    if (result && typeof result === 'object' && typeof result.at !== 'string') {
      return [`${ref}.result.at must be an ISO string`];
    }
    normalizeResult(result);
    return [];
  } catch (e) {
    return [`${ref}.${e.message}`];
  }
}

const CHECK_OWNER_RULES = [
  ['CI or a PR being green is yours to watch and verify', /\bCI\b[^.]{0,40}\b(green|passed|passes|pass|red|build|checks?|shards?)\b|\bPR\b[^.]{0,40}\bgreen\b|\bCI (build|run)\b/i],
  ['running a command or test suite is yours to do: run it yourself and put the result in --tests', /(^|[\s:])Run:\s|\brun (the |all |a |your )?(full )?(test suite|tests?|gate|lint)\b|\bTools\/|\bgit (status|diff|log)\b|\b(npm|pnpm|node) (run |test|--test)|\bci-local\b/i],
  ['opening older or saved projects is a compatibility check you can run yourself', /\bproject saved (before|with|in)\b|\bopen (a|an|the) (saved|older|previous|old) (project|patch|file)\b|\b(older|previous|old) (project|build|version|release)s?\b/i],
  ['regressions are yours to check with tests', /\bregress(ion|ions)?\b|\bstill works?\b/i],
  ['VoiceOver checks are yours to run (see the accessibility notes)', /voice ?over/i],
  ['a design pick is a Co-task: pick ticket, so it shows in the Design round lane, not a check', /\b(pick|answer|choose)\b[^.]{0,60}\bboard\b|\bboard\b[^.]{0,30}\b(pick|answer|choose)\b/i],
];

// Rules that depend on what is attached to the check (see checkOwnerProblem's `evidence`).
// Each reason names the fix. Kept narrow: ordinary UI wording ("Press Run", "Run your finger
// along the strip", "the node snaps to the grid") must pass. `needs`: true = refused unless
// something is attached; 'project' = refused unless a project is attached; false = always.
const ID = String.raw`(?:[A-Za-z]{2,6}\d+:\s*)?`;
const FILE_EXTS = String.raw`(?:wav|mp3|flac|ogg|m4a|mp4|mov|png|jpe?g|agsproj)`;
const CHECK_EVIDENCE_RULES = [
  {
    reason: 'this is a measured result, not a check: put it in --tests',
    needs: false,
    re: new RegExp([
      String.raw`^\s*${ID}(?:Eval|Evals|Result|Results|Measured|Benchmark|Tests?|CI):`,
      String.raw`\bcosts?\b[^.]{0,20}\$\s?\d`,
      String.raw`\$\s?\d+(?:\.\d+)?\s*(?:per|each|total)\b`,
      String.raw`\b\d+\s*(?:/|of)\s*\d+\s+(?:tests?|checks?|songs?|cases?)?\s*pass(?:ed)?\b`,
      String.raw`\b\d+\s+(?:tests?|checks?|songs?|cases?)\s+(?:pass(?:ed)?|green)\b`,
      String.raw`\bops per song\b`,
    ].join('|'), 'i'),
  },
  {
    reason: 'there is nothing to check: use --no-checks "<reason>" instead of a placeholder check',
    needs: false,
    re: new RegExp([
      String.raw`^\s*${ID}(?:there is |there's |there are )?(?:nothing|no manual|n/a|none)\b[^.]{0,40}$`,
      String.raw`\bnothing (?:left )?to (?:check|test|verify|review)\b`,
      String.raw`\bno manual (?:check|test|step|verification)s?\b`,
      String.raw`\bno need to (?:check|test|verify)\b`,
    ].join('|'), 'i'),
  },
  {
    reason: 'it tells the reviewer to run something: run it yourself and put the result in --tests',
    needs: false,
    re: new RegExp([
      String.raw`\b(?:run|rerun|re-run|execute|launch|kick off|invoke)\s+(?:the |this |that |an? |your |our |each )?(?:[\w-]+\s+){0,2}(?:evals?|evaluations?|scripts?|commands?|benchmarks?|harness|pipeline|cli)\b`,
      String.raw`^\s*${ID}eval\b`,
      String.raw`\b(?:node|python3?|bash|sh|zsh)\s+(?:-\S+|\S*\.(?:m?js|cjs|py|sh|ts)\b|[\w.-]+/\S+)`,
      String.raw`\b(?:npm|pnpm|yarn|npx)\s+(?:run|test|install|ci|exec|start|build|-\S+|[\w@/.-]+)`,
      '`\\s*(?:bash|sh|zsh|node|npm|pnpm|npx|python3?|git|ch|curl|make|cmake|ctest|cd|\\./|/|~/)[^`]*`',
      String.raw`\b[\w-]+\.(?:sh|py|mjs)\b`,
      String.raw`\bscripts?/`,
    ].join('|'), 'i'),
  },
  {
    reason: 'it points at a file on disk: attach it (--check-video / --check-audio / --check-project) instead of a path',
    needs: true,
    re: new RegExp([
      String.raw`(?:^|[\s("'\x60])(?:~/|/Users/|/home/|/tmp/|/private/|/var/)\S*`,
      String.raw`\b[\w.-]+/[\w./-]*\.${FILE_EXTS}\b`,
      String.raw`\b[\w-]+\.${FILE_EXTS}\b`,
    ].join('|'), 'i'),
  },
  {
    reason: 'it is about AI-generated content: create the project with the AI yourself and attach it with --check-project',
    needs: 'project',
    re: /\bask (?:the |an? )?(?:ai|assistant|chatbot|claude)\b|\bmake (?:me )?an? ai[- ](?:song|project|patch|track|preset)\b|\bgenerate\b[^.]{0,50}\bwith (?:the )?(?:ai|assistant)\b|\b(?:ai|assistant)[- ]generated\b|\bprompt (?:the )?(?:ai|assistant)\b/i,
  },
];

/**
 * Checks are for what only Tal can judge (look, feel, taste). Returns a reason when `text`
 * is something the shipping session should do itself, else null. `evidence` is what the check
 * carries ({ project?, video?, audio? }): a file path in the text is fine when something is
 * attached, and an AI-content check needs an attached project. Tuned so ordinary product
 * steps ("Press Run", "drag Cutoff") pass.
 */
export function checkOwnerProblem(text, evidence = {}) {
  const t = String(text ?? '');
  for (const [reason, re] of CHECK_OWNER_RULES) if (re.test(t)) return reason;
  const ev = evidence || {};
  const attached = !!(ev.project || ev.video || ev.audio);
  for (const { reason, re, needs } of CHECK_EVIDENCE_RULES) {
    if (!re.test(t)) continue;
    if (needs === true && attached) continue;
    if (needs === 'project' && ev.project) continue;
    return reason;
  }
  return null;
}

/** Does this check text (without the "<id>: " prefix) ask Tal to pick a design option? */
export function isPickCheckText(text) {
  return /^\s*(Pick\b|Answer Pick\b|Open the [^.]{0,80}\bboard\b|Board shows\b)/i.test(String(text ?? ''));
}

/**
 * Drop from `epic` the unticked pick checks that were rolled up from tickets in `blockerIds`
 * (a pick that is answered no longer needs to be checked). Returns how many were removed.
 */
export function removeStalePickChecks(epic, blockerIds) {
  if (!Array.isArray(epic?.checks) || !blockerIds?.length) return 0;
  const before = epic.checks.length;
  epic.checks = epic.checks.filter((c) => {
    if (!c || c.checked) return true;
    const text = String(c.text ?? '');
    return !blockerIds.some(id => text.startsWith(`${id}: `) && isPickCheckText(text.slice(id.length + 2)));
  });
  return before - epic.checks.length;
}

export const REVIEW_DONE_FAST_MS = 5 * 60 * 1000;

/** True when the ticket's history shows a move review -> done less than 5 minutes after it entered review. */
export function reviewClosedTooFast(task) {
  const history = Array.isArray(task?.history) ? task.history : [];
  for (let i = 0; i < history.length; i++) {
    const h = history[i];
    if (!h || h.to !== 'done' || h.from !== REVIEW_SECTION) continue;
    const doneAt = Date.parse(h.at);
    for (let j = i - 1; j >= 0; j--) {
      const e = history[j];
      if (e && e.to === REVIEW_SECTION) {
        const inAt = Date.parse(e.at);
        if (Number.isFinite(doneAt) && Number.isFinite(inAt) && doneAt - inAt <= REVIEW_DONE_FAST_MS) return true;
        break;
      }
    }
  }
  return false;
}

/**
 * Evidence paths: a check can carry a saved `project` (.agsproj) and a short `video` (.mp4),
 * each a path relative to $CH_HOME/evidence. Returns an error message, or null when valid.
 */
export function evidencePathError(value, ext, label = 'path') {
  if (typeof value !== 'string' || !value.trim()) return `${label} must be a non-empty string`;
  const p = value.trim();
  if (p.includes('\0')) return `${label} must not contain a NUL byte`;
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\')) return `${label} must be relative to the evidence folder: ${p}`;
  if (p.split(/[\\/]/).some(seg => seg === '..')) return `${label} must not contain "..": ${p}`;
  if (!p.toLowerCase().endsWith(ext)) return `${label} must end with ${ext}: ${p}`;
  return null;
}

export const projectPathError = (v, label = 'project') => evidencePathError(v, '.agsproj', label);
export const videoPathError = (v, label = 'video') => evidencePathError(v, '.mp4', label);
export const AUDIO_EXTS = ['.wav', '.mp3', '.m4a', '.ogg', '.flac'];
/** Audio evidence: any of AUDIO_EXTS, otherwise the same rules as video. */
export function audioPathError(v, label = 'audio') {
  const ext = AUDIO_EXTS.find(e => String(v ?? '').trim().toLowerCase().endsWith(e));
  if (ext) return evidencePathError(v, ext, label);
  const base = evidencePathError(v, '.wav', label);
  return base && base.includes('must end with') ? `${label} must end with one of ${AUDIO_EXTS.join(', ')}: ${String(v).trim()}` : base || `${label} must end with one of ${AUDIO_EXTS.join(', ')}: ${String(v).trim()}`;
}

/** Forward-slash, trimmed, no "./" or doubled slashes. */
export function tidyEvidencePath(value) {
  return String(value).trim().replace(/\\/g, '/').split('/').filter(seg => seg && seg !== '.').join('/');
}

/**
 * A check as given on the CLI or in --result-json: a string or { text, project?, video?, audio?, noVideo? }.
 * Returns { text, project?, video?, audio?, noVideo? } with tidied paths; throws on a bad shape or path.
 */
export function normalizeCheckInput(item) {
  const obj = typeof item === 'string' ? { text: item } : item;
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || typeof obj.text !== 'string') {
    throw new Error('each check must be a string or an object with a text string');
  }
  const out = { text: obj.text.trim() };
  for (const [key, check] of [['project', projectPathError], ['video', videoPathError], ['audio', audioPathError]]) {
    if (obj[key] === undefined || obj[key] === null || obj[key] === '') continue;
    const err = check(obj[key], `check ${key}`);
    if (err) throw new Error(err);
    out[key] = tidyEvidencePath(obj[key]);
  }
  if (obj.noVideo !== undefined && obj.noVideo !== null && obj.noVideo !== '') {
    const err = noVideoReasonError(obj.noVideo, 'check noVideo');
    if (err) throw new Error(err);
    if (out.video) throw new Error('a check cannot carry both video and noVideo (attach the video or give the reason, not both)');
    out.noVideo = obj.noVideo.trim();
  }
  return out;
}

/** A check's `noVideo` reason: why this check has no video (3-200 chars after trim); '' when fine. */
export const noVideoReasonError = (v, label = 'noVideo') => {
  if (typeof v !== 'string') return `${label} must be a string (the reason there is no video)`;
  const n = v.trim().length;
  return n < 3 || n > 200 ? `${label} must be 3-200 characters (why there is no video), got ${n}` : '';
};

/** Schema errors for a stored check's project/video/noVideo (empty when valid). */
export function checkEvidenceErrors(check, ref) {
  const errors = [];
  if (check?.project !== undefined) {
    const e = projectPathError(check.project, `${ref}.project`);
    if (e) errors.push(e);
  }
  if (check?.video !== undefined) {
    const e = videoPathError(check.video, `${ref}.video`);
    if (e) errors.push(e);
  }
  if (check?.audio !== undefined) {
    const e = audioPathError(check.audio, `${ref}.audio`);
    if (e) errors.push(e);
  }
  if (check?.noVideo !== undefined) {
    const e = noVideoReasonError(check.noVideo, `${ref}.noVideo`);
    if (e) errors.push(e);
    if (check.video !== undefined) errors.push(`${ref} cannot carry both video and noVideo`);
  }
  return errors;
}

/** The project bundle name of a check ("end.agsproj"), or ''. */
export function projectName(project) {
  return String(project || '').split('/').filter(Boolean).pop() || '';
}

/**
 * Order checks for display: checks that share a `project` sit together under one group, groups in
 * order of first appearance, then the checks without a project in their own order. Each entry keeps
 * its original check object and index, so ticking and notes still address the right check.
 * @returns {Array<{ project: string|null, items: Array<{ check, index }> }>}
 */
export function groupChecksByProject(checks) {
  const groups = [];
  const byProject = new Map();
  const loose = [];
  (checks || []).forEach((check, index) => {
    const project = check && typeof check.project === 'string' && check.project ? check.project : null;
    if (!project) { loose.push({ check, index }); return; }
    let group = byProject.get(project);
    if (!group) { group = { project, items: [] }; byProject.set(project, group); groups.push(group); }
    group.items.push({ check, index });
  });
  if (loose.length) groups.push({ project: null, items: loose });
  return groups;
}

/**
 * Add checks (strings or { text, project?, video?, audio?, noVideo? }), skipping texts already on the ticket.
 * A text already present keeps its tick but gains a project/video it lacked. Returns how many were added.
 */
export function addChecks(task, texts, { now = new Date().toISOString() } = {}) {
  if (!Array.isArray(task.checks)) task.checks = [];
  const byText = new Map(task.checks.map(c => [String(c.text).trim(), c]));
  let added = 0;
  for (const raw of texts) {
    const input = typeof raw === 'object' && raw ? raw : { text: raw };
    const text = String(input.text || '').trim();
    if (!text) continue;
    const have = byText.get(text);
    if (have) {
      for (const key of ['project', 'video', 'audio']) if (input[key] && !have[key]) have[key] = input[key];
      if (input.noVideo && !have.noVideo && !have.video) have.noVideo = input.noVideo;
      if (input.video && have.noVideo) delete have.noVideo;
      continue;
    }
    const check = { text, checked: false, addedAt: now };
    for (const key of ['project', 'video', 'audio']) if (input[key]) check[key] = input[key];
    if (input.noVideo && !check.video) check.noVideo = input.noVideo;
    task.checks.push(check);
    byText.set(text, check);
    added++;
  }
  return added;
}

/** Plain lines describing a result, for `ch tasks get` and the markdown export. */
export function resultLines(result) {
  if (!result) return [];
  const lines = [];
  for (const s of result.shipped || []) lines.push(`Shipped: ${s}`);
  for (const s of result.left || []) lines.push(`Left: ${s}`);
  for (const s of result.tests || []) lines.push(`Tests: ${s}`);
  if (result.ci) lines.push(`CI: ${result.ci}`);
  for (const s of result.unverified || []) lines.push(`Unverified: ${s}`);
  for (const s of result.risks || []) lines.push(`Risk: ${s}`);
  for (const s of result.fixed || []) lines.push(`Fixed: ${s}`);
  for (const s of result.opened || []) lines.push(`Opened: ${s}`);
  return lines;
}

function flat(doc) {
  const rows = [];
  for (const section of doc?.sections || []) {
    for (const task of section.tasks || []) rows.push({ task, section: section.id });
  }
  return rows;
}

/** Tickets opened from reviewing `id`: [{ id, title, section }] in id order of appearance. */
export function followUpsOf(doc, id) {
  return flat(doc)
    .filter(({ task }) => task.reviewOf === id)
    .map(({ task, section }) => ({ id: task.id, title: task.title, section }));
}

/**
 * Everything waiting for review, oldest first (the order it shipped in).
 * @returns {Array<{ id, title, project, parentId, enteredAt, checks: {done,total}, result, followUps, reviewOf }>}
 */
export function reviewQueue(doc) {
  const rows = flat(doc).filter(({ section }) => section === REVIEW_SECTION);
  return rows
    .map(({ task }) => ({
      id: task.id,
      title: task.title,
      project: task.project || null,
      parentId: task.parentId || null,
      reviewOf: task.reviewOf || null,
      enteredAt: enteredReviewAt(task),
      checks: checkProgress(task),
      notes: unsentNotes(task).length,
      result: task.result || null,
      followUps: followUpsOf(doc, task.id),
    }))
    .sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : 0));
}

/**
 * Checks waiting on tickets that are still open, oldest first. A child's checks roll up onto its
 * epic the day it ships, but the epic only reaches Ready for review with its last child, so the
 * queue above never shows these until then.
 */
export function checksOnOpenWork(doc) {
  const untickedOf = (task) => (task.checks || []).filter(c => c && !c.checked && !c.handedTo);
  return flat(doc)
    .filter(({ task, section }) => !CLOSED_SECTIONS.has(section) && untickedOf(task).length)
    .map(({ task }) => ({
      id: task.id,
      title: task.title,
      project: task.project || null,
      parentId: task.parentId || null,
      reviewOf: task.reviewOf || null,
      enteredAt: untickedOf(task).map(c => c.addedAt || '').sort()[0] || '',
      checks: checkProgress(task),
      notes: unsentNotes(task).length,
      result: task.result || null,
      followUps: followUpsOf(doc, task.id),
    }))
    .sort((a, b) => (a.enteredAt < b.enteredAt ? -1 : a.enteredAt > b.enteredAt ? 1 : 0));
}

function findRow(doc, id) {
  return flat(doc).find(({ task }) => task.id === id) || null;
}

/** The nearest ancestor of `task` that is an epic, or null (standalone tickets have none). */
export function epicOf(doc, task) {
  const seen = new Set([task.id]);
  let parentId = task.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const row = findRow(doc, parentId);
    if (!row) return null;
    if (row.task.type === 'epic') return row;
    parentId = row.task.parentId;
  }
  return null;
}

/** Every ticket under `epicId`, at any depth. */
function descendantsOf(doc, epicId) {
  const rows = flat(doc);
  const out = [];
  const queue = [epicId];
  while (queue.length) {
    const parent = queue.shift();
    for (const row of rows) {
      if (row.task.parentId === parent) { out.push(row); queue.push(row.task.id); }
    }
  }
  return out;
}

/**
 * Fold a shipped child's result and checks into its epic, so the Plan page's "Ready for
 * review" holds one card per epic. Lines are prefixed with the child's id; the child keeps
 * its own result and goes to Done. Returns { epic, epicSection, moveEpicToReview } for the
 * caller to apply, or null when the ticket has no epic.
 *
 * The epic moves to review once every other ticket under it is Done or Ready for review
 * (checks ticked on it finish it as for any ticket). An epic already in Done comes back to
 * review only when the child added checks.
 */
export function rollUpIntoEpic(doc, task, checkTexts, { now = new Date().toISOString() } = {}) {
  // checkTexts items are strings or { text, project?, video?, audio?, noVideo? }; the prefix goes on the text only.
  const found = epicOf(doc, task);
  if (!found) return null;
  const { task: epic, section: epicSection } = found;
  const prefix = (s) => `${task.id}: ${s}`;

  const result = task.result;
  const already = (epic.result?.shipped || []);
  const fresh = (result?.shipped || []).map(prefix).filter(l => !already.includes(l));
  if (result && fresh.length) {
    const mine = epic.result || { at: result.at, shipped: [], ci: result.ci || 'all passed' };
    mine.shipped = [...(mine.shipped || []), ...fresh];
    for (const key of ['left', 'tests', 'unverified', 'risks', 'fixed', 'opened']) {
      const lines = (result[key] || []).map(prefix);
      if (lines.length) mine[key] = [...(mine[key] || []), ...lines];
    }
    if (mine.ci === 'all passed' && result.ci && result.ci !== 'all passed') mine.ci = prefix(result.ci);
    epic.result = mine;
  }
  removeStalePickChecks(epic, task.blockedBy);
  const added = addChecks(epic, checkTexts.map((c) => (
    typeof c === 'object' && c ? { ...c, text: prefix(c.text) } : prefix(c)
  )), { now });

  const siblingsOpen = descendantsOf(doc, epic.id).some(
    ({ task: t, section }) => t.id !== task.id && t.type !== 'epic' && !CLOSED_SECTIONS.has(section),
  );
  const moveEpicToReview = epicSection !== REVIEW_SECTION && !siblingsOpen && (epicSection !== 'done' || added > 0);
  return { epic, epicSection, added, moveEpicToReview };
}

const CLOSED_SECTIONS = new Set(['done', REVIEW_SECTION, 'archive']);

/**
 * Epics to drop from the day plan now that `task` has closed (done, review or archive):
 * the ticket itself when it is an epic, and each enclosing epic once nothing under it is
 * still open. Call after the move, so sections reflect the new state.
 */
export function epicsToUnpin(doc, task) {
  const row = findRow(doc, task.id);
  if (!row || !CLOSED_SECTIONS.has(row.section)) return [];
  const out = task.type === 'epic' ? [task.id] : [];
  let found = epicOf(doc, task);
  while (found) {
    const { task: epic } = found;
    const open = descendantsOf(doc, epic.id).some(
      ({ task: t, section }) => t.type !== 'epic' && !CLOSED_SECTIONS.has(section),
    );
    if (open) break;
    out.push(epic.id);
    found = epicOf(doc, epic);
  }
  return out;
}

/** Does anything that is not an epic and still open sit under `epicId` (any depth)? */
function hasOpenWork(doc, epicId) {
  return descendantsOf(doc, epicId).some(
    ({ task: t, section }) => t.type !== 'epic' && !CLOSED_SECTIONS.has(section),
  );
}

function moveBetween(doc, task, from, to, now) {
  const src = (doc.sections || []).find(s => s.id === from);
  const dst = (doc.sections || []).find(s => s.id === to);
  if (!src || !dst) return false;
  src.tasks = src.tasks.filter(t => t.id !== task.id);
  dst.tasks.push(task);
  task.checked = true;
  task.updated = now.slice(0, 10);
  if (!Array.isArray(task.history)) task.history = [];
  task.history.push({ at: now, event: 'moved', from, to });
  return true;
}

/**
 * An epic closes whichever way its last child closes (done, moved out to another epic, ticked
 * off in review). Starting at `epicId`, move each epic that no longer has open work under it:
 * to review when it has a result or checks to look at, else straight to done; then do the same
 * for the epic above it. An epic already in review/done/archive, one with open work left, and
 * one that never had any children, result or checks stay put.
 * Mutates `doc`; returns [{ id, from, to }] for the epics moved, innermost first.
 */
export function rollUpAfterClose(doc, epicId, { now = new Date().toISOString() } = {}) {
  const moved = [];
  let row = epicId ? findRow(doc, epicId) : null;
  while (row && row.task.type === 'epic') {
    const { task: epic, section } = row;
    if (CLOSED_SECTIONS.has(section) || hasOpenWork(doc, epic.id)) break;
    const toReview = !!epic.result || (epic.checks || []).length > 0;
    if (!toReview && !descendantsOf(doc, epic.id).length) break;
    const to = toReview ? REVIEW_SECTION : 'done';
    if (!moveBetween(doc, epic, section, to, now)) break;
    moved.push({ id: epic.id, from: section, to });
    row = epicOf(doc, epic);
  }
  return moved;
}

/** Drop the Nth (1-based) Unverified line of a ticket's result. Returns the removed text; throws on a bad N. */
export function resolveUnverified(task, n) {
  const list = task?.result?.unverified || [];
  if (!Number.isInteger(n) || n < 1 || n > list.length) {
    throw new Error(`--resolve-unverified N must be between 1 and ${list.length}`);
  }
  const [gone] = list.splice(n - 1, 1);
  if (!list.length) delete task.result.unverified;
  return gone;
}

/** Drop every Unverified line of a ticket's result. Returns how many were removed. */
export function clearUnverified(task) {
  const had = (task?.result?.unverified || []).length;
  if (had) delete task.result.unverified;
  return had;
}

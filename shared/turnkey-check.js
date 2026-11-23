/**
 * shared/turnkey-check.js — FRO2246: every check Tal gets is turnkey (kind check-tal-should-not-get).
 *
 * `ch tasks review` already refuses wording shapes (shared/review.js checkOwnerProblem) and checks without a
 * project (checkProjectGateProblem). These rules decide by what the check carries and by the ticket, not by
 * wording, so a check that slips past the phrase lists is still refused:
 *   - AI ticket (label `ai` on it or its epic): every check carries the project or the audio the AI made.
 *   - Every check, in every repo, carries a clip, a still or audio, or a no-video reason; on a ui, website,
 *     frontend or AI ticket a reason shaped "nothing to see" is refused.
 *   - Every check was tried by the session (agentVerified, `--check-verify N=<how>`) or is Tal's own judgement
 *     (a taste question: phrased as a question, a `taste:` line, audio to hear, or names taste, hearing,
 *     hardware or consent), so only taste reaches Tal.
 * Plus the script-path guard for held-PR try steps: a script the steps name must exist where they say.
 * Pure (no fs, no DOM): the caller passes `exists`.
 */

const NOTHING_TO_SEE_RE = /\bnothing (?:to (?:see|show|look at|watch|film)|visible|visual|on screen)\b|\bno (?:visible|visual|ui|screen|on-screen) (?:change|difference)s?\b|\bnot (?:a )?visual\b|^\s*(?:n\/?a|none|-)\s*\.?\s*$/i;
const TAL_ONLY_RE = /needs-tal|taste|\bhear|\blisten|\bby ear|hardware|consent|\bsounds?\b/i;
const QUESTION_RE = /\?\s*$/;

/** Is this check Tal's own judgement (taste, hearing, hardware, consent), which no session can settle? */
export function isTalOnlyCheck(c) {
  if (!c) return false;
  const text = String(c.text || '');
  return !!(c.taste || c.audio || QUESTION_RE.test(text) || TAL_ONLY_RE.test(text));
}

/** The ticket kinds the rules depend on, from its and its epic's labels and its project. */
export function turnkeyContext({ labels = [], project = null } = {}) {
  const set = new Set((labels || []).map(l => String(l).toLowerCase()));
  const ai = set.has('ai');
  const visual = !set.has('no-ui') && (ai || set.has('ui') || project === 'website' || project === 'frontend');
  return { ai, visual };
}

/**
 * Problems with the review's checks (`items`: normalized { text, project?, video?, image?, audio?, noVideo?,
 * agentVerified?, taste? }), one line each, or [] when every check is turnkey.
 */
export function turnkeyCheckProblems(items, ctx = {}) {
  const { ai, visual } = turnkeyContext(ctx);
  const out = [];
  (items || []).forEach((c, i) => {
    if (!c) return;
    const n = i + 1;
    const head = `check ${n} ("${String(c.text || '').slice(0, 80)}")`;
    if (ai && !c.project && !c.audio) {
      out.push(`${head}: an AI ticket's check carries what the AI made: make it yourself and attach --check-project ${n}=<path> (or --check-audio ${n}=<wav>)`);
    }
    if (!c.video && !c.image && !c.audio && !c.noVideo) {
      out.push(`${head}: no clip or still: attach --check-video ${n}=<mark clip>, --check-image ${n}=<still> or --check-audio ${n}=<wav>, or say why there is nothing to see with --check-no-video ${n}=<reason>`);
    } else if (c.noVideo && visual && NOTHING_TO_SEE_RE.test(c.noVideo)) {
      out.push(`${head}: "${c.noVideo}" is not a reason on a ui, website or AI ticket: film it or attach a still (--check-video / --check-image ${n}=<path>)`);
    }
    if (!c.agentVerified && !isTalOnlyCheck(c)) {
      out.push(`${head}: you can try this one yourself: run it and pass --check-verify ${n}="<the scenario or run that proved it, what it showed>", or if only Tal can judge it, ask it as a taste question ("is ... calm in each theme?")`);
    }
  });
  return out;
}

/** The refusal text for `ch tasks review`, or null. */
export function turnkeyCheckProblem(items, ctx = {}) {
  const lines = turnkeyCheckProblems(items, ctx);
  if (!lines.length) return null;
  return `${lines.length} problem(s) keep these checks from being turnkey (only taste goes to Tal, ready to judge):\n`
    + lines.map(l => `  - ${l}`).join('\n')
    + '\n(--force "<why>" overrides and is recorded on the ticket.)';
}

const ABS_SCRIPT_RE = /(?:^|[\s`'"(])((?:~\/|\/)[\w.@+/-]+\.(?:sh|py|mjs|cjs|js|ts))\b/g;
const REL_SCRIPT_RE = /(?:^|[\s`'"(])((?:\.\/)?(?:scripts|tools|bin)\/[\w.@+/-]+\.(?:sh|py|mjs|cjs|js|ts))\b/g;

/**
 * FRO2246 (WEB5 "No such file"): script paths named in `text` that do not exist. `exists(absPath)` checks the disk,
 * `home` expands `~/`, and a relative `scripts/...` path is looked up under each of `roots` (skipped when none).
 * @returns {string[]} the missing paths as written
 */
export function missingScriptPaths(text, { exists, home = '', roots = [] } = {}) {
  const t = String(text ?? '');
  const missing = [];
  for (const m of t.matchAll(ABS_SCRIPT_RE)) {
    const p = m[1];
    const abs = p.startsWith('~/') ? `${home.replace(/\/$/, '')}/${p.slice(2)}` : p;
    if (!exists(abs)) missing.push(p);
  }
  if ((roots || []).length) {
    for (const m of t.matchAll(REL_SCRIPT_RE)) {
      const rel = m[1].replace(/^\.\//, '');
      if (!roots.some(r => exists(`${String(r).replace(/\/$/, '')}/${rel}`))) missing.push(m[1]);
    }
  }
  return [...new Set(missing)];
}

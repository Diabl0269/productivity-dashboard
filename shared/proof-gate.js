/**
 * shared/proof-gate.js
 * PRO37: a `ui` or `audio` ticket (or one under such an epic) reaches review only with its
 * proofs done. Every Unverified line must name an allowed reason with a tag, and the ticket
 * needs evidence (a saved file) or at least one tagged Unverified line. `--force "<why>"`
 * overrides, and the reason is kept on the ticket.
 */

/** Allowed reasons a check could not be done on this Mac, tag -> what it covers. */
export const UNVERIFIED_TAGS = {
  taste: 'only Tal can judge it (feel, look, sound quality)',
  hardware: 'needs hardware this Mac lacks (a real controller, trackpad pinch, a specific audio device)',
  outside: 'happens outside the Mac (an API deploy, paid evals beyond budget, production)',
  consent: "needs Tal's password or an OS prompt, only while Tal is away",
};

export const PROOF_LABELS = ['ui', 'audio'];

// An optional `needs-tal:` / `tried:` prefix (the session-side hook's words) may come first:
// `needs-tal: taste: does the fade feel smooth`, `tried: hardware: no controller attached`.
const TAG_RE = new RegExp(`^\\s*(?:(?:needs-tal|tried)\\s*:\\s*)?(${Object.keys(UNVERIFIED_TAGS).join('|')})\\s*:\\s*\\S`, 'i');

/** The reason tag an Unverified line starts with (lower case, after any needs-tal:/tried:), or null. */
export function unverifiedTag(line) {
  const m = TAG_RE.exec(String(line ?? ''));
  return m ? m[1].toLowerCase() : null;
}

/** The proof labels (`ui`, `audio`) on the ticket or its epic. */
export function proofLabels(task, epic) {
  const labels = [...(task?.labels || []), ...(epic?.labels || [])].map(l => String(l).toLowerCase());
  return PROOF_LABELS.filter(l => labels.includes(l));
}

/** The allowed reasons, one per line, for an error message. */
export function allowedReasonsText() {
  return Object.entries(UNVERIFIED_TAGS).map(([tag, what]) => `  ${tag}: ${what}`).join('\n');
}

/**
 * Why this review must be refused, or null. `unverified` is the ticket's Unverified lines after
 * this call; `hasEvidence` is true when a file backs the review (--evidence, or a check with a
 * project, video or audio attached).
 */
export function proofGateProblem({ task, epic, unverified = [], hasEvidence = false }) {
  const labels = proofLabels(task, epic);
  if (!labels.length) return null;
  const kind = labels.join('/');
  const untagged = unverified.filter(line => !unverifiedTag(line));
  if (untagged.length) {
    return `${task.id} is a ${kind} ticket: each --unverified line must start with an allowed reason tag.\n`
      + `Untagged (${untagged.length}):\n${untagged.map(l => `  - "${l}"`).join('\n')}\n`
      + `Allowed reasons:\n${allowedReasonsText()}\n`
      + 'Write it as `needs-tal: taste: <what Tal should judge>` or `tried: hardware: <what you did and what stopped it>`.\n'
      + 'Anything else can be checked on this Mac: do it, attach the proof (--evidence <path>) and put the result in --tests. '
      + '(--force "<why>" overrides and is recorded on the ticket.)';
  }
  if (!hasEvidence && !unverified.length) {
    return `${task.id} is a ${kind} ticket with no proof: pass --evidence <path> (a screenshot, AX dump, render or run log saved under $CH_HOME/evidence), `
      + 'attach one to a check (--check-video / --check-audio / --check-project), or say what could not be checked with a tagged --unverified line.\n'
      + `Allowed reasons:\n${allowedReasonsText()}\n`
      + '(--force "<why>" overrides and is recorded on the ticket.)';
  }
  return null;
}

/**
 * `--force` takes an optional reason: `--force "<why>"` becomes `--force --force-reason "<why>"`,
 * a bare `--force` stays as it is. A value is any next token that does not start with "-".
 */
export function splitForceReason(argv) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--force=')) { out.push('--force', '--force-reason', a.slice('--force='.length)); continue; }
    if (a === '--force' && i + 1 < argv.length && !String(argv[i + 1]).startsWith('-')) {
      out.push('--force', '--force-reason', argv[i + 1]);
      i++;
      continue;
    }
    out.push(a);
  }
  return out;
}

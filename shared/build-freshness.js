/**
 * shared/build-freshness.js — "does the app you have installed contain this change?"
 *
 * Pure helpers (no fs, no git): match a ticket's PR link to a config.json `buildFreshness`
 * rule, and turn a freshness result into the line a Ready-for-review card shows.
 * The git/plist work lives in cli/lib/build-freshness.js.
 *
 * config.json: "buildFreshness": [{
 *   "repo": "<path to the git repo>",
 *   "prPattern": "github.com/<owner>/<repo>/pull/",
 *   "buildCommit": { "plist": "<Info.plist>", "key": "<key>", "tag": "v{value}" }   // or { "file": "<path>" } or { "command": "..." }
 *   "updateCommand": "<text shown when the build is older>"
 * }]
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-07T10:00:00Z" -> "7 Nov" (from the date part as written; '' when unparseable). */
export function shortDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month}` : '';
}

/** The first valid rule: an object with a repo, a prPattern and a buildCommit source. */
export function validRules(rules) {
  return (Array.isArray(rules) ? rules : []).filter(r => r && typeof r === 'object'
    && typeof r.repo === 'string' && r.repo.trim()
    && typeof r.prPattern === 'string' && r.prPattern.trim()
    && r.buildCommit && typeof r.buildCommit === 'object'
    && (typeof r.buildCommit.plist === 'string' || typeof r.buildCommit.file === 'string' || typeof r.buildCommit.command === 'string'));
}

/** { rule, number } for the first rule whose prPattern prefixes a PR link in `url`, else null. */
export function matchPr(rules, url) {
  const u = String(url || '');
  for (const rule of validRules(rules)) {
    const at = u.indexOf(rule.prPattern);
    if (at < 0) continue;
    const m = /^(\d+)/.exec(u.slice(at + rule.prPattern.length));
    if (m) return { rule, number: Number(m[1]) };
  }
  return null;
}

/** The PR link of a ticket that some rule matches: { url, rule, number }, or null (nothing to show). */
export function matchTicketPr(rules, task) {
  const links = Array.isArray(task?.links) ? task.links : [];
  for (const l of links) {
    const hit = l && typeof l.url === 'string' ? matchPr(rules, l.url) : null;
    if (hit) return { url: l.url, ...hit };
  }
  return null;
}

/**
 * The card line for a result { state: 'current'|'stale'|'unknown', mergedAt?, buildAt?, updateCommand? }:
 * { text, command?, unknown? }, or null for no result. An unknown result (a rule exists but the
 * installed build or merge commit could not be read) says so rather than showing nothing.
 */
export function freshnessLine(result) {
  if (!result) return null;
  if (result.state === 'current') return { text: 'in your build' };
  if (result.state === 'stale') {
    const merged = shortDay(result.mergedAt);
    const built = shortDay(result.buildAt);
    const parts = [];
    if (merged) parts.push(`merged ${merged}`);
    if (built) parts.push(`your app is from ${built}`);
    const out = { text: `needs a newer build${parts.length ? ` (${parts.join(', ')})` : ''}` };
    if (result.updateCommand) out.command = result.updateCommand;
    return out;
  }
  if (result.state === 'unknown') return { text: 'No build info for this change', unknown: true };
  return null;
}

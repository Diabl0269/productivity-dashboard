/**
 * shared/quality-metrics.js (pure): the Quality section of the Metrics tab.
 *   notes     review notes (kind fix/idea/design, state filed/dismissed/new) per shipped ticket and by taste principle
 *   rework    reopened (flow.reopenedByLabel: moves back plus fix tickets) per shipped ticket, by model label
 *   ci        failed CI runs per PR (branch), rerun cost and the top failing job, by model label
 * Spec: docs/metrics.md "Quality".
 */
import { isUncounted } from './ci-metrics.js';

const r2 = n => Math.round(n * 100) / 100;
const ratio = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);

// Principles named in the product-taste doc; first match wins, so list the narrow ones first.
export const PRINCIPLES = [
  ['motion', /motion|animat|glide|flicker|fade|transition|\bpop(s|ped|ping)?\b|jump|smooth/i],
  ['keyboard', /keyboard|shortcut|hotkey|tab order|focus|\bkeys?\b|\besc\b|arrow/i],
  ['consistency', /consisten|sibling|same as|both directions|matches|every knob|\bsame\b/i],
  ['research', /research|cubase|serum|best practice|reference|convention/i],
  ['proof', /proofs?\b|screenshot|evidence|clip|recording/i],
  ['layout', /layout|spacing|align|overlap|cover|anchor|near-touching|\bsize\b/i],
  ['words', /\bwords?\b|wording|copy\b|label|plain words|text\b/i],
  ['looks', /\blooks?\b|polish|visual|colou?r|contrast|icon/i],
  ['intuitive', /intuitive|obvious|discover/i],
];

/** The principle a note belongs to: the filed ticket's "**Taste:**" line first, else the check text, else 'other'. */
export function principleOf(note, filedTicket) {
  const m = /\*\*Taste:?\*\*:?\s*(.*)/i.exec(filedTicket?.description || '');
  const sources = [m && m[1], note?.check];
  for (const text of sources) {
    if (!text) continue;
    for (const [name, re] of PRINCIPLES) if (re.test(text)) return name;
  }
  return 'other';
}

const MODEL_ORDER = ['model:opus', 'model:sonnet', 'model:haiku'];
const labelRank = l => { const i = MODEL_ORDER.indexOf(l); return i < 0 ? MODEL_ORDER.length : i; };
const modelLabelOf = t => {
  const l = (t?.labels || []).find(x => /^model:\s*\S/i.test(String(x)));
  return l ? String(l).trim().toLowerCase().replace(/^model:\s*/, 'model:') : 'none';
};

export const THRESHOLDS = { principleFix: 3, reworkShare: 0.2, redPerPr: 1.5 };

export const HINTS = {
  principle: 'A principle with many fix notes: add a pre-ship check or a rule to the taste doc.',
  rework: 'A label with rework over 20%: raise the tier for that kind of ticket.',
  red: 'More than 1.5 red runs per PR: fix the repeat failing job first.',
};

/**
 * @param {{tasks:object[], flow:object, timings:object[], sessions:object[], sinceMs:number, untilMs:number, project?:string}} a
 *   tasks: every ticket in the document (any section); flow: the payload's flow; timings: window CI records;
 *   sessions: every session record (the branch to ticket join is not window-limited).
 */
export function qualityBlock({ tasks = [], flow, timings = [], sessions = [], sinceMs, untilMs, project } = {}) {
  const byId = new Map(tasks.map(t => [t.id, t]));
  const inScope = t => !project || t.project === project;
  const inWin = ms => Number.isFinite(ms) && ms >= sinceMs && ms <= untilMs;
  const shipped = flow?.counts?.shipped ?? 0;

  // ----- review notes -----
  const kinds = { fix: 0, idea: 0, design: 0 };
  const states = { filed: 0, dismissed: 0, new: 0 };
  const principles = new Map();
  const perTicket = new Map();
  let total = 0;
  for (const t of tasks) {
    if (!inScope(t)) continue;
    for (const n of t.reviewNotes || []) {
      if (!n || !inWin(Date.parse(n.at))) continue;
      total++;
      kinds[n.kind] = (kinds[n.kind] || 0) + 1;
      states[n.state] = (states[n.state] || 0) + 1;
      const p = principleOf(n, n.filed ? byId.get(n.filed) : null);
      const row = principles.get(p) || { principle: p, fix: 0, idea: 0, design: 0, total: 0, filed: 0, dismissed: 0 };
      row[n.kind] = (row[n.kind] || 0) + 1;
      row.total++;
      if (n.state === 'filed') row.filed++;
      if (n.state === 'dismissed') row.dismissed++;
      principles.set(p, row);
      const pt = perTicket.get(t.id) || { ticket: t.id, notes: 0, fix: 0 };
      pt.notes++;
      if (n.kind === 'fix') pt.fix++;
      perTicket.set(t.id, pt);
    }
  }
  const principleRows = [...principles.values()]
    .sort((a, b) => b.fix - a.fix || b.total - a.total || (a.principle < b.principle ? -1 : 1))
    .map(r => ({ ...r, high: r.principle !== 'other' && r.fix >= THRESHOLDS.principleFix }));
  const notes = {
    total, kinds, states, shipped,
    perShipped: shipped ? r2(total / shipped) : null,
    byPrinciple: principleRows,
    topTickets: [...perTicket.values()].sort((a, b) => b.fix - a.fix || b.notes - a.notes || (a.ticket < b.ticket ? -1 : 1)).slice(0, 5),
    hint: HINTS.principle,
    high: principleRows.some(r => r.high),
  };

  // ----- rework by model label -----
  const reworkRows = new Map();
  const row = l => {
    if (!reworkRows.has(l)) reworkRows.set(l, { label: l, shipped: 0, reopened: 0, reworkShare: null, prs: 0, runs: 0, failedRuns: 0, failedPerPr: null, rerunSeconds: 0, failedSeconds: 0 });
    return reworkRows.get(l);
  };
  for (const r of flow?.reopenedByLabel || []) {
    const x = row(r.label);
    x.shipped = r.shipped || 0;
    x.reopened = (r.moves || 0) + (r.fixes || 0);
  }

  // ----- red CI per PR (a PR is a branch with counted runs; branches are joined to tickets through sessions) -----
  const branchTicket = new Map();
  for (const s of sessions) if (s.branch && s.ticket && !branchTicket.has(s.branch)) branchTicket.set(s.branch, s.ticket);
  const ticketOfBranch = b => {
    if (branchTicket.has(b)) return byId.get(branchTicket.get(b)) || null;
    const m = /(?:^|\/)([a-z]{2,5})-?(\d+)/i.exec(b); // fix/fro1182-cutoff, FRO1516-x, pro7-fix
    return m ? byId.get(`${m[1].toUpperCase()}${m[2]}`) || byId.get(`${m[1].toUpperCase()}-${m[2]}`) || null : null;
  };
  const prs = new Map();
  const jobCounts = new Map();
  for (const r of timings) {
    if (r.kind !== 'ci' || !r.branch || /^(main|master)$/.test(r.branch) || isUncounted(r)) continue;
    const t = ticketOfBranch(r.branch);
    if (t && !inScope(t)) continue;
    const k = `${r.repo ?? ''}\u0000${r.branch}`;
    const p = prs.get(k) || { repo: r.repo, branch: r.branch, label: t ? modelLabelOf(t) : 'none', runs: 0, failed: 0, rerunSeconds: 0, failedSeconds: 0 };
    p.runs++;
    if (r.ok === false) {
      p.failed++;
      p.failedSeconds += Number(r.seconds) || 0;
      for (const j of r.failedJobs || []) jobCounts.set(j, (jobCounts.get(j) || 0) + 1);
    }
    if (Number(r.attempt) > 1) p.rerunSeconds += Number(r.seconds) || 0;
    prs.set(k, p);
  }
  const all = { runs: 0, failed: 0, prs: prs.size, rerunSeconds: 0, failedSeconds: 0 };
  for (const p of prs.values()) {
    const x = row(p.label);
    x.prs++; x.runs += p.runs; x.failedRuns += p.failed; x.rerunSeconds += p.rerunSeconds; x.failedSeconds += p.failedSeconds;
    all.runs += p.runs; all.failed += p.failed; all.rerunSeconds += p.rerunSeconds; all.failedSeconds += p.failedSeconds;
  }
  const byLabel = [...reworkRows.values()].map(x => ({
    ...x,
    reworkShare: ratio(x.reopened, x.shipped),
    failedPerPr: x.prs ? r2(x.failedRuns / x.prs) : null,
    rerunHours: r2(x.rerunSeconds / 3600), failedHours: r2(x.failedSeconds / 3600),
    reworkHigh: ratio(x.reopened, x.shipped) > THRESHOLDS.reworkShare,
    redHigh: x.prs > 0 && x.failedRuns / x.prs > THRESHOLDS.redPerPr,
  })).sort((a, b) => labelRank(a.label) - labelRank(b.label) || (a.label < b.label ? -1 : 1));
  const topJobs = [...jobCounts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || (a.name < b.name ? -1 : 1)).slice(0, 3);
  const failedPerPr = all.prs ? r2(all.failed / all.prs) : null;
  const ci = {
    prs: all.prs, runs: all.runs, failedRuns: all.failed, failedPerPr,
    rerunHours: r2(all.rerunSeconds / 3600), failedHours: r2(all.failedSeconds / 3600),
    topFailedJobs: topJobs, topFailedJob: topJobs[0] || null,
    hint: HINTS.red, high: failedPerPr !== null && failedPerPr > THRESHOLDS.redPerPr,
  };
  const reopened = byLabel.reduce((a, x) => a + x.reopened, 0);
  const rework = {
    shipped: byLabel.reduce((a, x) => a + x.shipped, 0), reopened,
    share: ratio(reopened, byLabel.reduce((a, x) => a + x.shipped, 0)),
    hint: HINTS.rework, high: byLabel.some(x => x.reworkHigh),
  };
  return { notes, rework, ci, byLabel, thresholds: THRESHOLDS };
}

/**
 * shared/tasks-merge.js — three-way merge of the tasks document.
 *
 * The dashboard saves with the text it loaded as `base`. When a `ch` write from another
 * session landed since (the server answers 409 with the file as it is now), the edits made
 * in the dashboard must not be lost and must not overwrite the other write:
 *
 *   mergeTasksDocs(base, local, current)  ->  merged document
 *
 * Per ticket:
 *   - changed only locally -> local; only remotely -> current; added on either side -> kept
 *   - a ticket removed on one side is removed only if the other side did not change it
 *   - the section comes from whichever side moved it (both moved: current)
 *   - changed on both sides: start from current; `reviewNotes` are unioned by `n` (a note
 *     whose state is not `new` beats one that is; two different notes added with the same
 *     `n` keep both, the local one renumbered to the next free n); `checks` are merged by
 *     text (ticked when the side that changed it ticked it); `history` is unioned; every
 *     other field comes from current unless only local changed it.
 * Top-level keys other than `sections` (meta, ticketTypes, version) follow the same
 * "local only changed it -> local, else current" rule.
 *
 * Pure (no fs, no DOM). All three arguments are parsed documents ({ sections: [...] }).
 */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function indexDoc(doc) {
  const map = new Map();
  for (const section of doc?.sections || []) {
    for (const task of section.tasks || []) {
      if (task && typeof task.id === 'string') map.set(task.id, { task, section: section.id });
    }
  }
  return map;
}

function sectionOrder(doc, sectionId) {
  const s = (doc?.sections || []).find(x => x.id === sectionId);
  return (s?.tasks || []).map(t => t.id);
}

/** Merge two lists of keyed items (checks by text). */
function mergeChecks(b, l, c) {
  const key = (x) => String(x?.text ?? '').trim();
  const by = (list) => new Map((list || []).filter(Boolean).map(x => [key(x), x]));
  const bm = by(b); const lm = by(l); const cm = by(c);
  const out = [];
  const seen = new Set();
  const add = (k) => {
    if (seen.has(k)) return;
    seen.add(k);
    const bi = bm.get(k); const li = lm.get(k); const ci = cm.get(k);
    if (li && ci) {
      const m = clone(ci);
      const lChanged = !!li.checked !== !!bi?.checked;
      const cChanged = !!ci.checked !== !!bi?.checked;
      if (lChanged && cChanged) m.checked = !!(li.checked || ci.checked);
      else if (lChanged) m.checked = !!li.checked;
      else m.checked = !!ci.checked;
      out.push(m);
    } else if (li) {
      // Gone from current: drop it only when the other side removed it and we did not touch it.
      if (bi && same(bi, li)) return;
      out.push(clone(li));
    } else if (ci) {
      if (bi && same(bi, ci)) return; // removed locally, untouched remotely
      out.push(clone(ci));
    }
  };
  for (const x of c || []) if (x) add(key(x));
  for (const x of l || []) if (x) add(key(x));
  return out;
}

/** Union review notes by n. */
function mergeNotes(b, l, c) {
  const bm = new Map((b || []).filter(Boolean).map(x => [x.n, x]));
  const out = [];
  const used = new Set();
  for (const x of c || []) if (x) { out.push(clone(x)); used.add(x.n); }
  let next = [...(b || []), ...(l || []), ...(c || [])].reduce((m, x) => Math.max(m, Number(x?.n) || 0), 0) + 1;
  for (const ln of l || []) {
    if (!ln) continue;
    const idx = out.findIndex(x => x.n === ln.n);
    if (idx === -1) { out.push(clone(ln)); used.add(ln.n); continue; }
    const cn = out[idx];
    const bn = bm.get(ln.n);
    if (!bn) {
      // Added on both sides with the same n.
      if (same(cn, ln)) continue;
      if (cn.at === ln.at && cn.text === ln.text) {
        if (cn.state === 'new' && ln.state !== 'new') out[idx] = clone(ln);
        continue;
      }
      const moved = { ...clone(ln), n: next++ };
      out.push(moved);
      continue;
    }
    // In all three: the one that moved on from `new` wins, else whichever changed.
    if (cn.state === 'new' && ln.state !== 'new') out[idx] = clone(ln);
    else if (cn.state !== 'new' && ln.state === 'new') { /* current wins */ }
    else if (same(cn, bn) && !same(ln, bn)) out[idx] = clone(ln);
  }
  return out;
}

function mergeHistory(l, c) {
  const rows = [];
  const seen = new Set();
  for (const h of [...(c || []), ...(l || [])]) {
    const k = JSON.stringify(h);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push(h);
  }
  return rows.sort((a, b) => String(a?.at || '').localeCompare(String(b?.at || '')));
}

/** Both sides changed the ticket: start from current, bring in what only local changed. */
function mergeTicket(b, l, c) {
  const base = b || {};
  const m = clone(c);
  const keys = new Set([...Object.keys(l), ...Object.keys(base)]);
  for (const k of keys) {
    if (k === 'reviewNotes' || k === 'checks' || k === 'history') continue;
    if (same(l[k], base[k])) continue; // local did not change it
    if (!same(c[k], base[k])) continue; // remote changed it too: current wins
    if (l[k] === undefined) delete m[k]; else m[k] = clone(l[k]);
  }
  if (l.reviewNotes || c.reviewNotes || base.reviewNotes) {
    const notes = mergeNotes(base.reviewNotes, l.reviewNotes, c.reviewNotes);
    if (notes.length) m.reviewNotes = notes; else delete m.reviewNotes;
  }
  if (l.checks || c.checks || base.checks) {
    const checks = mergeChecks(base.checks, l.checks, c.checks);
    if (checks.length || c.checks || l.checks) m.checks = checks;
  }
  if (l.history || c.history) {
    m.history = mergeHistory(l.history, c.history);
    if (!m.history.length) delete m.history;
  }
  return m;
}

export function mergeTasksDocs(base, local, current) {
  const B = indexDoc(base); const L = indexDoc(local); const C = indexDoc(current);
  const merged = clone(current);

  // Top-level keys other than sections.
  const topKeys = new Set([...Object.keys(local || {}), ...Object.keys(base || {})]);
  for (const k of topKeys) {
    if (k === 'sections') continue;
    if (same(local?.[k], base?.[k])) continue;
    if (!same(current?.[k], base?.[k])) continue;
    if (local[k] === undefined) delete merged[k]; else merged[k] = clone(local[k]);
  }
  // Sections only local has (a section added in the dashboard).
  for (const s of local?.sections || []) {
    if (!merged.sections.some(x => x.id === s.id) && !(base?.sections || []).some(x => x.id === s.id)) {
      merged.sections.push({ ...clone(s), tasks: [] });
    }
  }

  // Decide every ticket's final task and section.
  const final = new Map(); // id -> { task, section }
  for (const id of new Set([...B.keys(), ...L.keys(), ...C.keys()])) {
    const b = B.get(id); const l = L.get(id); const c = C.get(id);
    if (l && c) {
      const lChanged = !b || !same(l.task, b.task) || l.section !== b.section;
      const cChanged = !b || !same(c.task, b.task) || c.section !== b.section;
      let task; let section;
      if (!lChanged) { task = c.task; section = c.section; }
      else if (!cChanged) { task = l.task; section = l.section; }
      else {
        task = mergeTicket(b?.task, l.task, c.task);
        const lMoved = !b || l.section !== b.section;
        const cMoved = !b || c.section !== b.section;
        section = lMoved && !cMoved ? l.section : c.section;
      }
      final.set(id, { task: clone(task), section });
    } else if (l && !c) {
      // Removed remotely: stays removed unless we changed it.
      if (b && same(l.task, b.task) && l.section === b.section) continue;
      final.set(id, { task: clone(l.task), section: l.section });
    } else if (c && !l) {
      // Removed locally: stays removed unless the other side changed it.
      if (b && same(c.task, b.task) && c.section === b.section) continue;
      final.set(id, { task: clone(c.task), section: c.section });
    }
  }

  // Rebuild each section: local's order when the remote did not reorder it, else current's.
  for (const section of merged.sections) {
    const members = [...final.entries()].filter(([, v]) => v.section === section.id).map(([id]) => id);
    const memberSet = new Set(members);
    const remoteReordered = !same(sectionOrder(base, section.id).filter(id => C.has(id)), sectionOrder(current, section.id).filter(id => B.has(id)));
    const primary = remoteReordered ? sectionOrder(current, section.id) : sectionOrder(local, section.id);
    const secondary = remoteReordered ? sectionOrder(local, section.id) : sectionOrder(current, section.id);
    const ids = [];
    for (const id of [...primary, ...secondary, ...members]) {
      if (memberSet.has(id) && !ids.includes(id)) ids.push(id);
    }
    section.tasks = ids.map(id => final.get(id).task);
  }
  return merged;
}

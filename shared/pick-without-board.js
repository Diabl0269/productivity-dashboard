/**
 * shared/pick-without-board.js (FRO2329 guard): a design pick ("Co-task: pick ...", label `design`) is answered
 * on a board, so an open one with no artifact link has nothing for Tal to open. Pure (no fs, no DOM).
 */

/** Open (todo / in-progress, any epic) design picks with no link to a claude.ai artifact: [{ id, title }]. */
export function pickWithoutBoard(doc) {
  const out = [];
  for (const section of doc?.sections || []) {
    if (section.id !== 'todo' && section.id !== 'in-progress') continue;
    for (const t of section.tasks || []) {
      if (!(t.labels || []).some(l => String(l).trim().toLowerCase() === 'design')) continue;
      if (!/^\s*Co-task: pick\b/i.test(t.title || '')) continue;
      if ((t.links || []).some(l => /claude\.ai\/artifact/i.test(l?.url || ''))) continue;
      out.push({ id: t.id, title: t.title });
    }
  }
  return out;
}

// home-queue-data.js — the Overview queue panel's data side (PRO152): talking to /api/home/queue and the small
// pure helpers the panel uses (where a move lands, where a drag drops, which fields show as chips).
// No DOM here, so node tests can import it.

const URL_BASE = '/api/home/queue';

async function answer(res) {
  let body = null;
  try { body = await res.json(); } catch { /* not JSON */ }
  if (res.ok) return body;
  throw Object.assign(new Error(body?.error || `The server answered ${res.status}.`), { status: res.status });
}

export async function fetchQueue(project, id) {
  const q = `?${project ? `project=${encodeURIComponent(project)}&` : ''}id=${encodeURIComponent(id)}`;
  return answer(await fetch(`${URL_BASE}${q}`, { cache: 'no-store' }));
}

/** body: { id, etag, op, ... } as in server/home/queue-route.js. */
export async function putQueue(project, body) {
  const q = project ? `?project=${encodeURIComponent(project)}` : '';
  return answer(await fetch(`${URL_BASE}${q}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

/** The new index of item `id` after moving it `delta` places, kept inside the window; null when it cannot move. */
export function moveTarget(items, id, delta, max = items.length) {
  const from = items.findIndex(i => i.id === id);
  if (from < 0) return null;
  const to = Math.max(0, Math.min(Math.min(items.length, max) - 1, from + delta));
  return to === from ? null : to;
}

/** A copy of `items` with item `from` moved to `to`. */
export function reordered(items, from, to) {
  const out = items.slice();
  out.splice(to, 0, out.splice(from, 1)[0]);
  return out;
}

/** The drop index for a pointer at `y`: how many row middles are above it (`mids` are in row order, `from` is the dragged row). */
export function dropIndex(mids, y, from) {
  let to = 0;
  mids.forEach((m, i) => { if (i !== from && y > m) to += 1; });
  return Math.min(to, mids.length - 1);
}

/** The fields shown as chips on a collapsed row: the first `max` with a value; the rest wait in the expanded row. */
export function chipsOf(fields, max = 2) {
  return fields.filter(f => f.value && f.value.trim()).slice(0, max);
}

/** True when two lists show the same items in the same order with the same fields (so a refresh changes nothing). */
export function sameItems(a, b) {
  return a.length === b.length && a.every((x, i) => x.id === b[i].id && JSON.stringify(x.fields) === JSON.stringify(b[i].fields));
}

/** What to say for a failed request, in plain words. */
export function plainError(e) {
  if (e?.status === 409) return `${e.message}`;
  if (e?.status) return e.message;
  return `The dashboard server could not be reached (${e?.message || 'no answer'}).`;
}

/** "Dropped “Rye”" / "Skipped “Rye”" for the undo line. */
export function droppedText(title, dropAs) {
  return `${dropAs === 'skipped' ? 'Skipped' : 'Dropped'} “${title}”.`;
}

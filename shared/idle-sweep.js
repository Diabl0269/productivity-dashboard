/**
 * shared/idle-sweep.js (pure): in-progress tickets nobody has worked on lately. Used by `ch tasks sweep-idle`.
 * A ticket's last activity is the newest of: when it last moved into in-progress, the end of any session interval
 * for it (batch runs credit every ticket in the batch, see time-split.js), and the end of a session that names it
 * (its ticket or its batch). Epics are never swept: an epic stays in progress while its children run.
 */
import { sessionIntervals, sessionBatch } from './time-split.js';

const HOUR = 3600 * 1000;

const toMs = v => {
  const ms = typeof v === 'number' ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/** ms of the last move into in-progress (history), else null. */
function enteredAt(task) {
  let at = null;
  for (const e of task.history || []) {
    if (e && e.event === 'moved' && e.to === 'in-progress') {
      const ms = toMs(e.at);
      if (ms !== null && (at === null || ms > at)) at = ms;
    }
  }
  return at;
}

/**
 * @param {{doc:object, sessions?:object[], now?:number, hours?:number}} args
 * @returns {{id:string, title:string, lastActivity:string|null, idleHours:number|null}[]} tickets idle at least `hours`, longest first
 */
export function idleInProgress({ doc, sessions = [], now = Date.now(), hours = 24 } = {}) {
  const last = new Map(); // id -> newest activity ms
  const bump = (id, ms) => { if (id && ms !== null && ms > (last.get(id) ?? -Infinity)) last.set(id, ms); };
  for (const kind of ['work', 'waitUser']) {
    for (const [id, list] of sessionIntervals(sessions, kind)) for (const [, e] of list) bump(id, e);
  }
  for (const s of sessions) {
    const end = toMs(s && s.end);
    if (end === null) continue;
    bump(s.ticket, end);
    for (const id of sessionBatch(s)) bump(id, end);
  }
  const out = [];
  const sec = (doc?.sections || []).find(x => x.id === 'in-progress');
  for (const t of sec?.tasks || []) {
    if (!t || !t.id || t.type === 'epic') continue;
    const entered = enteredAt(t);
    bump(t.id, entered);
    const at = last.get(t.id) ?? null;
    if (at !== null && now - at < hours * HOUR) continue;
    out.push({
      id: t.id, title: t.title || '', lastActivity: at === null ? null : new Date(at).toISOString(),
      idleHours: at === null ? null : Math.round(((now - at) / HOUR) * 10) / 10,
    });
  }
  out.sort((a, b) => (b.idleHours ?? Infinity) - (a.idleHours ?? Infinity) || (a.id < b.id ? -1 : 1));
  return out;
}

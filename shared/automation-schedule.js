// Schedule helpers shared by the server (server/automations/) and the Automations page.
// A launchd StartCalendarInterval is one dict or an array of dicts; Weekday 0 or 7 = Sunday.

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** @returns {object[]} calendar entries, always an array */
export function calendarEntries(value) {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]).filter(e => e && typeof e === 'object');
}

const pad = n => String(n).padStart(2, '0');

function formatTime(e) {
  if (e.Hour == null && e.Minute == null) return null;
  return `${pad(e.Hour ?? 0)}:${pad(e.Minute ?? 0)}`;
}

function formatDays(days) {
  const sorted = [...new Set(days.map(d => d % 7))].sort((a, b) => a - b);
  if (sorted.length === 7) return 'Daily';
  if (sorted.length === 1) return WEEKDAYS[sorted[0]];
  const run = sorted.every((d, i) => i === 0 || d === sorted[i - 1] + 1);
  if (run) return `${WEEKDAYS[sorted[0]]}–${WEEKDAYS[sorted[sorted.length - 1]]}`;
  return sorted.map(d => WEEKDAYS[d]).join(', ');
}

/** One human line per distinct time, e.g. "Sun–Thu 08:58". */
export function formatCalendar(value) {
  const groups = new Map(); // key -> { time, days[], other }
  for (const e of calendarEntries(value)) {
    const time = formatTime(e);
    const scope = e.Day != null ? `day ${e.Day}${e.Month != null ? ` of month ${e.Month}` : ''}` : e.Month != null ? `month ${e.Month}` : '';
    const key = `${time}|${scope}`;
    if (!groups.has(key)) groups.set(key, { time, scope, days: [] });
    if (e.Weekday != null) groups.get(key).days.push(Number(e.Weekday));
  }
  return [...groups.values()].map(g => {
    const day = g.days.length ? formatDays(g.days) : g.scope ? (g.scope.startsWith('day') ? `Monthly (${g.scope})` : g.scope) : 'Daily';
    const base = g.days.length && g.scope ? `${day}, ${g.scope}` : day;
    return [base, g.time].filter(Boolean).join(' ');
  });
}

export function formatInterval(seconds) {
  const s = Number(seconds);
  if (!s) return '';
  if (s % 86400 === 0) return `Every ${s / 86400}d`;
  if (s % 3600 === 0) return `Every ${s / 3600}h`;
  if (s % 60 === 0) return `Every ${s / 60}m`;
  return `Every ${s}s`;
}

/** @param {{calendar?: any, interval?: number|null, runAtLoad?: boolean}} schedule */
export function formatSchedule(schedule = {}) {
  const parts = [...formatCalendar(schedule.calendar)];
  if (schedule.interval) parts.push(formatInterval(schedule.interval));
  if (schedule.runAtLoad) parts.push('At load');
  return parts.length ? parts.join('; ') : 'Manual only';
}

/**
 * Editor rows -> calendar dicts. Row: { days:number[], hour, minute, day? }.
 * No days selected means every day (no Weekday key); a Day-of-month row keeps Day.
 */
export function rowsToCalendar(rows) {
  const out = [];
  for (const r of rows || []) {
    const base = { Hour: Number(r.hour), Minute: Number(r.minute) };
    if (r.day) base.Day = Number(r.day);
    const days = (r.days || []).map(Number);
    if (days.length === 0 || days.length === 7) out.push(base);
    else for (const d of days) out.push({ ...base, Weekday: d });
  }
  return out;
}

/** Calendar dicts -> editor rows (entries with the same time/Day merge their weekdays). */
export function calendarToRows(value) {
  const rows = new Map();
  for (const e of calendarEntries(value)) {
    const key = `${e.Hour ?? 0}:${e.Minute ?? 0}:${e.Day ?? ''}`;
    if (!rows.has(key)) rows.set(key, { days: [], hour: e.Hour ?? 0, minute: e.Minute ?? 0, day: e.Day ?? '' });
    if (e.Weekday != null) rows.get(key).days.push(Number(e.Weekday) % 7);
  }
  return [...rows.values()];
}

export function validateCalendar(value) {
  for (const e of calendarEntries(value)) {
    const ok = (v, lo, hi) => v == null || (Number.isInteger(v) && v >= lo && v <= hi);
    if (!ok(e.Minute, 0, 59) || !ok(e.Hour, 0, 23) || !ok(e.Weekday, 0, 7) || !ok(e.Day, 1, 31) || !ok(e.Month, 1, 12)) {
      return `Invalid calendar entry: ${JSON.stringify(e)}`;
    }
  }
  return null;
}

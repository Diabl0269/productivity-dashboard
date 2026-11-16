/**
 * shared/weekly-reset.js (pure): the one definition of when the plan's weekly limit resets.
 * Config `metrics.weeklyReset: { weekday: 0-6 (0 = Sunday), utcHour: 0-23, utcMinute?: 0-59 }`, in UTC so
 * the week is always exactly 168 hours (daylight saving never moves it). The default is Tuesday 11:00 UTC.
 * Read by `shared/next-start.js` (pace stop), `shared/usage-meter.js` (the Home usage chip) and the
 * `ch metrics usage` command. Anything invalid falls back to the default.
 */
export const DEFAULT_WEEKLY_RESET = Object.freeze({ weekday: 2, utcHour: 11, utcMinute: 0 });
export const WEEK_MS = 7 * 86400e3;
const DAY_MS = 86400e3;
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/** A config value as { weekday, utcHour, utcMinute }; the default when it is missing or out of range. */
export function normalizeWeeklyReset(raw) {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_WEEKLY_RESET };
  const minute = raw.utcMinute === undefined ? 0 : raw.utcMinute;
  if (!intIn(raw.weekday, 0, 6) || !intIn(raw.utcHour, 0, 23) || !intIn(minute, 0, 59)) return { ...DEFAULT_WEEKLY_RESET };
  return { weekday: raw.weekday, utcHour: raw.utcHour, utcMinute: minute };
}

/** The first reset after 1970-01-01 (a Thursday, weekday 4); every other reset is a whole number of weeks from it. */
function anchorMs(reset) {
  const r = normalizeWeeklyReset(reset);
  return ((r.weekday - 4 + 7) % 7) * DAY_MS + r.utcHour * 3600e3 + r.utcMinute * 60e3;
}

/** The latest reset at or before `nowMs`. */
export function lastWeeklyReset(nowMs, reset) {
  const a = anchorMs(reset);
  return a + Math.floor((nowMs - a) / WEEK_MS) * WEEK_MS;
}

/** The first reset strictly after `nowMs`. */
export function nextWeeklyReset(nowMs, reset) {
  return lastWeeklyReset(nowMs, reset) + WEEK_MS;
}

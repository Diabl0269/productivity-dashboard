/**
 * cli/lib/estimate.js
 * Time estimates stored as integer minutes (estimateMinutes).
 * Human forms: "30m", "2h", "1h30m", "1.5h", "90", "1d" (1d = 8h workday).
 */

const DAY_MINUTES = 8 * 60;

/**
 * Parse a human estimate string into minutes.
 * @param {string|number} input
 * @returns {number|null} minutes, or null if empty/invalid
 */
export function parseEstimate(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input);
  }
  const s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);

  let total = 0;
  let matched = false;

  // 1d / 2.5d
  const day = s.match(/^(\d+(?:\.\d+)?)d(.*)$/);
  if (day) {
    total += Math.round(parseFloat(day[1]) * DAY_MINUTES);
    matched = true;
    const rest = day[2];
    if (rest) {
      const more = parseEstimate(rest);
      if (more == null && rest) return null;
      if (more) total += more;
    }
    return total;
  }

  // Combined 1h30m or 2h15m
  const hm = s.match(/^(\d+(?:\.\d+)?)h(?:(\d+)m)?$/);
  if (hm) {
    total += Math.round(parseFloat(hm[1]) * 60);
    if (hm[2]) total += parseInt(hm[2], 10);
    return total;
  }

  // 30m only
  const mOnly = s.match(/^(\d+)m$/);
  if (mOnly) return parseInt(mOnly[1], 10);

  // bare hours like 1.5h already covered; plain "2h"
  const hOnly = s.match(/^(\d+(?:\.\d+)?)h$/);
  if (hOnly) return Math.round(parseFloat(hOnly[1]) * 60);

  return matched ? total : null;
}

/**
 * Format minutes as a compact human string (e.g. 90 → "1h30m", 480 → "1d").
 * @param {number|null|undefined} minutes
 * @returns {string}
 */
export function formatEstimate(minutes) {
  if (minutes == null || minutes === '' || !Number.isFinite(Number(minutes))) return '';
  let m = Math.round(Number(minutes));
  if (m <= 0) return '0m';

  const parts = [];
  if (m >= DAY_MINUTES) {
    const days = Math.floor(m / DAY_MINUTES);
    parts.push(`${days}d`);
    m %= DAY_MINUTES;
  }
  if (m >= 60) {
    const hours = Math.floor(m / 60);
    parts.push(`${hours}h`);
    m %= 60;
  }
  if (m > 0 || parts.length === 0) {
    parts.push(`${m}m`);
  }
  return parts.join('');
}

export { DAY_MINUTES };

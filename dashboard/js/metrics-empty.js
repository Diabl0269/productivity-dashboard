// metrics-empty.js — the one empty-state rule for every Metrics section (PRO88).
// "Key missing" (the server's answer lacks this part: it runs older code than the page) is not
// "zero rows" (the part is there and holds nothing). A missing part defers to the banner at the
// top of the page; only a real zero says "no data" and gives its own advice.
import { METRICS_SCHEMA } from '../../shared/metrics-schema.js';

export const STALE_TEXT = 'This server is running older code than the page: restart it (node serve.js).';

/** True when the payload was built by a server whose code does not match this page. */
export function isOutOfDate(d) {
  return !!d && d.schema !== METRICS_SCHEMA;
}

/** The one banner for an out-of-date server, or null. `el` is the page's element helper. */
export function staleBanner(d, el) {
  if (!isOutOfDate(d)) return null;
  const n = el('div', 'mc-note bad mc-stale');
  n.setAttribute('role', 'alert');
  const lines = el('div', 'mc-note-lines');
  lines.appendChild(el('b', null, 'Server is older than the page'));
  lines.appendChild(el('div', null, STALE_TEXT));
  lines.appendChild(el('div', null, 'Some sections below are missing for that reason, not because there is no data.'));
  n.appendChild(lines);
  return n;
}

/**
 * Empty text for a section. `value` is the payload part the section reads: undefined means the key
 * is missing (the banner explains it), anything else means a real zero, shown with `zeroText`.
 */
export function emptyFor(value, zeroText, empty) {
  if (value === undefined) return empty('Not in this server\'s answer (see the note at the top of the page).');
  return empty(zeroText);
}

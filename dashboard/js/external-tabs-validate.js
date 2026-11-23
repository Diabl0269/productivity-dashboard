// external-tabs-validate.js — pure validation/id helpers for config.json `externalTabs`
// entries, split out from external-tabs.js so they're unit-testable without a DOM.

export const VALID_EXTERNAL_TAB_MODES = new Set(['iframe', 'link']);

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost']);

/** Keep loopback embeds same-site by matching the dashboard host spelling. */
export function externalTabUrl(url, pageUrl = window.location.href) {
  try {
    const target = new URL(url, pageUrl);
    const page = new URL(pageUrl);
    if (!LOOPBACK_HOSTS.has(target.hostname) || !LOOPBACK_HOSTS.has(page.hostname)) return url;
    target.hostname = page.hostname;
    return target.href;
  } catch {
    return url;
  }
}

/** @param {unknown} entry */
export function isValidEntry(entry) {
  return !!entry
    && typeof entry === 'object'
    && typeof entry.label === 'string' && entry.label.trim().length > 0
    && typeof entry.url === 'string' && entry.url.trim().length > 0
    && VALID_EXTERNAL_TAB_MODES.has(entry.mode);
}

/** Build a stable, DOM-safe id from a tab's label + position, e.g. "ext-status-page-0". */
export function slugify(label, index) {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `ext-${base || 'tab'}-${index}`;
}

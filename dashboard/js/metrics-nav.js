// metrics-nav.js — the sticky contents row at the top of Metrics (PRO87): one link per section, so a
// long page can be jumped around by mouse or keyboard (Tab to a link, Enter to go). Pure DOM, no state.

/** Part label (as listed in metrics-view.js `parts`) -> the id of the element to scroll to. */
export const PART_IDS = {
  'Insights': 'mcH-insights',
  'Headline numbers': 'mcH-headline',
  'Ticket flow': 'mcH-flow',
  'Sessions': 'mcH-sessions',
  'Session health': 'mcH-health',
  'Backlog': 'mcH-backlog',
  'Quality': 'mcH-quality',
  'Cost': 'mcH-cost',
  'Build and CI': 'mcH-build',
  'Next up': 'mcH-next',
  'Data sources': 'mcH-sources',
};
/** The cost estimate card, linked right after Cost because it was the hardest thing to find. */
export const LIKELY_COST = { label: 'Likely cost per ticket', id: 'mcC-likely-cost' };

/** Nav entries for the parts on the page, in page order. */
export function navItems(partLabels) {
  const out = [];
  for (const label of partLabels) {
    if (!PART_IDS[label]) continue;
    out.push({ label, id: PART_IDS[label] });
    if (label === 'Cost') out.push(LIKELY_COST);
  }
  return out;
}

/** Scroll to an element and put keyboard focus there (a heading or card made focusable on the fly). */
function jump(id) {
  const target = document.getElementById(id);
  if (!target) return;
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' });
  target.focus({ preventScroll: true });
}

/** @param {string[]} partLabels  @param {Function} el the page's element helper */
export function buildNav(partLabels, el) {
  const nav = el('nav', 'mc-nav');
  nav.setAttribute('aria-label', 'Metrics sections');
  for (const it of navItems(partLabels)) {
    const a = el('a', 'mc-nav-link', it.label);
    a.href = `#${it.id}`;
    a.dataset.target = it.id;
    a.addEventListener('click', (e) => { e.preventDefault(); jump(it.id); });
    nav.appendChild(a);
  }
  return nav;
}

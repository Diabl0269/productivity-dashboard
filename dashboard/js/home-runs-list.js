// home-runs-list.js (PRO122, PRO123) — the lower part of How it runs: every automation grouped (scheduled jobs,
// inside another job, hooks, CI, by hand), then every outside service. Each row: a state chip (ok, late,
// failed, off, unknown, checking), name and what it does, trigger, last run, next run, and a fold with the
// detail behind the chip and the docs link. "Only problems" folds every row that is fine away (animated).
// Rows are kept between refreshes and only their text changes, so live data never makes the page jump.

import { healthState, HEALTH_STATES, relTime, GROUP_ORDER } from '../../shared/home-config-runs.js';
import { getRuns, onHealth, getHealth } from './home-health-data.js';
import { editAutomation, editAutomationDefaults } from './home-state.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

const STATE_HELP = {
  ok: 'It ran and nothing says it failed.',
  late: 'It has not run for longer than the config allows (maxAgeMin).',
  waiting: 'It runs on time but holds its work for the reason shown, until the time shown.',
  failed: 'Its last run failed.',
  off: 'It is not loaded, so it will not run.',
  unknown: 'The tracker cannot tell from what the config points at.',
  checking: 'Still being read; it fills in by itself.',
};

/** Build one row; returns { li, paint(entry, now, hide) }. */
function makeRow(kind, entry, ctx) {
  const li = el('li', 'hr-row');
  li.dataset.id = entry.id;
  const inner = el('div', 'hr-row-in');
  const line = el('div', 'hr-row-line');
  const chip = el('span', 'rp-chip hr-state');
  const main = el('div', 'hr-row-main');
  const name = el('span', 'hr-row-name', entry.name);
  name.tabIndex = -1;
  const what = el('span', 'hr-row-what');
  main.append(name, what);
  const trig = el('span', 'hr-row-trigger');
  const last = el('span', 'hr-row-when');
  const next = el('span', 'hr-row-when hr-row-next');
  const fold = el('button', 'hr-btn hr-fold-btn');
  fold.type = 'button';
  fold.dataset.hmKey = `fold-${kind}-${entry.id}`;
  fold.setAttribute('aria-expanded', 'false');
  fold.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  const tip = el('span', 'hr-tip');
  tip.id = `hrTip-${kind}-${entry.id}`;
  tip.setAttribute('role', 'tooltip');
  fold.setAttribute('aria-describedby', tip.id);
  line.append(chip, main, trig, last, next);
  let consoleLink = null;
  if (kind === 'services' && entry.console) {
    consoleLink = el('a', 'hr-btn hr-console', 'Open console');
    consoleLink.href = entry.console;
    consoleLink.target = '_blank';
    consoleLink.rel = 'noopener noreferrer';
    consoleLink.dataset.hmKey = `console-${entry.id}`;
    line.appendChild(consoleLink);
  }
  if (kind === 'automations') {
    const edit = el('button', 'hr-btn hr-edit-btn', 'Edit');
    edit.type = 'button';
    edit.dataset.hmKey = `edit-${entry.id}`;
    edit.setAttribute('aria-label', `Edit ${entry.name}`);
    edit.addEventListener('click', () => { editAutomation(entry.id); });
    line.appendChild(edit);
  }
  line.append(fold, tip);
  const body = el('div', 'hr-fold');
  body.dataset.open = 'false';
  const bodyIn = el('div', 'hr-fold-in');
  const detail = el('ul', 'hr-fold-lines');
  const meta = el('p', 'hr-fold-meta');
  bodyIn.append(detail, meta);
  if (entry.docs && /^https?:/i.test(entry.docs)) {
    const docs = el('a', 'hr-fold-docs', 'How it works');
    docs.href = entry.docs;
    docs.target = '_blank';
    docs.rel = 'noopener noreferrer';
    bodyIn.appendChild(docs);
  } else if (entry.docs) {
    const docs = el('p', 'hr-fold-meta', 'How it works: ');
    docs.appendChild(el('code', '', entry.docs));
    bodyIn.appendChild(docs);
  }
  body.appendChild(bodyIn);
  body.inert = true;
  fold.addEventListener('click', () => {
    const on = body.dataset.open !== 'true';
    body.dataset.open = String(on);
    body.inert = !on;
    fold.setAttribute('aria-expanded', String(on));
  });
  inner.append(line, body);
  li.appendChild(inner);

  /** Open the fold (when closed) so a link from the flow lands on the detail behind the chip. */
  function openFold() {
    if (body.dataset.open === 'true') return;
    fold.click();
  }

  function paint(e, now, hide) {
    const res = e.result || { checking: true };
    const state = healthState(res);
    li.dataset.state = state;
    chip.className = `rp-chip hr-state hr-state-${state}`;
    setText(chip, HEALTH_STATES[state].label);
    setText(what, e.what || '');
    setText(trig, kind === 'services'
      ? (e.usedBy?.length ? `used by ${e.usedBy.map(id => boxName(ctx, id)).join(', ')}` : '')
      : (e.trigger || ''));
    const lastText = relTime(res.lastRun, now);
    const noLive = !res.sources?.length || res.sources.every(s => s.type === 'none');
    setText(last, lastText ? `${kind === 'services' ? 'last run' : 'ran'} ${lastText}`
      : state === 'checking' ? 'checking…' : noLive ? 'no live status' : res.ok === true ? 'answering now' : 'never seen');
    setText(next, res.waiting ? `waiting: ${res.waiting.text}` : res.nextRun ? `next ${relTime(res.nextRun, now)}` : '');
    const tipText = `${e.name}: ${e.what || 'no description in the config'}${e.trigger ? ` Runs: ${e.trigger}.` : ''} ${STATE_HELP[state]}`;
    setText(tip, tipText);
    fold.setAttribute('aria-label', `Details of ${e.name} (${HEALTH_STATES[state].label})`);
    const lines = (res.sources?.length ? res.sources.map(s => `${s.type}: ${s.detail}`) : [res.detail || 'no status in the config']);
    const sig = lines.join('\n');
    if (detail.dataset.sig !== sig) {
      detail.dataset.sig = sig;
      detail.textContent = '';
      for (const t of lines) detail.appendChild(el('li', '', t));
    }
    const metaParts = [];
    if (res.lastRun) metaParts.push(`last run ${new Date(res.lastRun).toLocaleString()}`);
    if (res.nextRun) metaParts.push(`next ${new Date(res.nextRun).toLocaleString()}`);
    if (res.checkedAt) metaParts.push(`checked ${relTime(res.checkedAt, now)}`);
    if (e.cost) metaParts.push(`cost: ${e.cost}`);
    if (!e.status?.length) metaParts.push('add "status" to this entry in the config to see when it last ran');
    setText(meta, metaParts.join(' · '));
    li.dataset.hidden = String(hide);
    li.inert = hide;
  }
  return { li, paint, openFold };
}

function boxName(ctx, id) {
  for (const g of ctx.config()?.groups || []) {
    if (g.id === id) return g.name;
    for (const a of g.areas) {
      if (a.id === id) return a.name;
      for (const p of a.parts) if (p.id === id) return p.name;
    }
  }
  return id;
}

/**
 * Build the Automations and Services sections into `host`.
 * @param {HTMLElement} host
 * @param {object} ctx Home ctx
 * @param {{ serviceScope: () => Set<string>|null }} src box ids of the selected place (services used there), or null
 * @returns {{ update(): void, reveal(id): boolean, setProblemsOnly(on: boolean): void, dispose(): void }}
 */
export function buildRuns(host, ctx, src) {
  const sections = {};
  let problemsOnly = false;
  const filterWrap = el('label', 'hr-filter');
  const filter = el('input');
  filter.type = 'checkbox';
  filter.dataset.hmKey = 'only-problems';
  filterWrap.append(filter, el('span', '', 'Only problems'));
  filter.addEventListener('change', () => { problemsOnly = filter.checked; update(); });

  for (const [kind, title, intro] of [
    ['automations', 'Automations', 'Jobs that run by themselves: schedules, hooks, CI and the runs inside them. A chip says whether each one is alive.'],
    ['services', 'Services', 'The outside services the project depends on, with their state and a way to their console.'],
  ]) {
    const sec = el('section', 'hr-section');
    sec.setAttribute('aria-labelledby', `hrTitle-${kind}`);
    const head = el('div', 'hr-section-head');
    const h = el('h3', 'hr-h3', title);
    h.id = `hrTitle-${kind}`;
    const summary = el('span', 'hr-summary');
    head.append(h, summary);
    if (kind === 'automations') {
      const defaults = el('button', 'hr-btn hr-defaults-btn', 'Defaults');
      defaults.type = 'button';
      defaults.dataset.hmKey = 'automation-defaults';
      defaults.addEventListener('click', () => editAutomationDefaults(true));
      head.append(defaults, filterWrap);
    }
    const introP = el('p', 'hr-sub', intro);
    const empty = el('div', 'hr-empty');
    const groups = el('div', 'hr-groups');
    const none = el('p', 'hr-empty-problems', kind === 'automations' ? 'No automation is late, failed or off.' : 'No service is failing or off.');
    sec.append(head, introP, empty, groups, none);
    host.appendChild(sec);
    sections[kind] = { sec, summary, empty, groups, none, rows: new Map(), groupEls: new Map() };
  }

  function groupEl(s, name) {
    if (s.groupEls.has(name)) return s.groupEls.get(name);
    const g = el('div', 'hr-group');
    const h = el('h4', 'hr-group-title', name);
    if (s === sections.services) h.hidden = true; // one group, already named by the section heading
    const ul = el('ul', 'hr-rows');
    g.append(h, ul);
    const rank = n => (GROUP_ORDER.includes(n) ? GROUP_ORDER.indexOf(n) : GROUP_ORDER.length);
    const after = [...s.groupEls.entries()].find(([n]) => rank(n) > rank(name));
    s.groups.insertBefore(g, after ? after[1].g : null);
    const rec = { g, ul };
    s.groupEls.set(name, rec);
    return rec;
  }

  function paintEmpty(s, kind, runs) {
    s.empty.textContent = '';
    const home = ctx.home();
    let text = '';
    if (!ctx.config()) text = home ? 'This project has no Home config yet, so there is nothing to list. Set it up from the card above.' : 'Loading…';
    else if (runs.failed && runs[kind] === null) text = `The list could not be loaded: ${runs.failed}`;
    else if (runs[kind] === null) text = 'Loading…';
    else if (!runs[kind].length) text = `No ${kind} in this project's config yet. Add a "${kind}" list to ${home?.path || 'its home.config.json'}; docs/home-page.md shows every key.`;
    s.empty.hidden = !text;
    if (text) s.empty.appendChild(el('p', 'hr-muted', text));
  }

  function update() {
    const runs = getRuns();
    const now = Date.now();
    const scope = src.serviceScope();
    for (const kind of ['automations', 'services']) {
      const s = sections[kind];
      paintEmpty(s, kind, runs);
      const list = runs[kind] || [];
      const seen = new Set();
      let visible = 0;
      for (const e of list) {
        seen.add(e.id);
        let row = s.rows.get(e.id);
        const group = kind === 'automations' ? (e.group || 'Other') : 'Services';
        if (!row || row.group !== group) {
          row?.li.remove();
          row = { ...makeRow(kind, e, ctx), group };
          s.rows.set(e.id, row);
        }
        const { ul } = groupEl(s, group);
        if (row.li.parentElement !== ul) ul.appendChild(row.li);
        const outOfPlace = kind === 'services' && scope && e.usedBy?.length && !e.usedBy.some(id => scope.has(id));
        const hide = (problemsOnly && !HEALTH_STATES[healthState(e.result)].problem) || !!outOfPlace;
        row.paint(e, now, hide);
        if (!hide) visible++;
      }
      for (const [id, row] of s.rows) if (!seen.has(id)) { row.li.remove(); s.rows.delete(id); }
      for (const [name, g] of s.groupEls) {
        const any = [...g.ul.children].some(li => li.dataset.hidden !== 'true');
        g.g.dataset.hidden = String(!any);
        if (!g.ul.children.length) { g.g.remove(); s.groupEls.delete(name); }
      }
      s.none.hidden = !(list.length && !visible && problemsOnly);
      const h = getHealth()[kind];
      const parts = Object.keys(HEALTH_STATES).filter(k => h[k]).map(k => `${h[k]} ${HEALTH_STATES[k].label}`);
      setText(s.summary, list.length ? parts.join(' · ') : '');
    }
    filter.checked = problemsOnly;
  }

  /** Show one automation: leave "Only problems" if it hides the row, scroll to it, open its fold and flash it. */
  function reveal(id) {
    const row = sections.automations.rows.get(id);
    if (!row) return false;
    if (row.li.dataset.hidden === 'true') { problemsOnly = false; update(); }
    row.openFold();
    row.li.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
    row.li.classList.remove('hr-row-flash');
    void row.li.offsetWidth;
    row.li.classList.add('hr-row-flash');
    row.li.querySelector('.hr-row-name')?.focus({ preventScroll: true });
    return true;
  }

  const off = onHealth(update);
  update();
  return {
    update,
    reveal,
    setProblemsOnly(on) { problemsOnly = !!on; update(); },
    dispose() { off(); },
  };
}

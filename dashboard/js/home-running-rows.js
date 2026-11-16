// home-running-rows.js — the rows of the "Running now" panel (PRO117): one row per running ticket or epic,
// updated in place and reconciled by key, so a refresh never rebuilds a row the user is on. Rows that arrive
// glide in, rows that leave glide out, rows that move glide to their new place (FLIP); focus and scroll stay.

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const DUR = 160;

export const STATE_WORDS = {
  working: 'Working', 'waiting-ci': 'Waiting on CI', 'waiting-you': 'Waiting on you', idle: 'Idle', stale: 'Stale',
};
const CHIP = {
  working: 'rp-chip-running', 'waiting-ci': 'rp-chip-partial', 'waiting-you': 'rp-chip-review', idle: 'rp-chip-later', stale: 'rp-chip-later',
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function setText(node, text) { if (node.textContent !== text) node.textContent = text; }

/** "42 m", "3 h", "2 d" for an ISO time or a YYYY-MM-DD date; '' when unknown. */
export function howLong(since, now = Date.now()) {
  const ms = Date.parse(since);
  if (!Number.isFinite(ms)) return '';
  const min = Math.max(0, Math.round((now - ms) / 60e3));
  if (min < 60) return `${min} m`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h`;
  return `${Math.round(min / 1440)} d`;
}

function prLabel(url) {
  const n = /\/pull\/(\d+)/.exec(url);
  return n ? `PR #${n[1]}` : 'PR';
}

/** A row skeleton: id button, title, state chip, age, source, PR slot, epic slot. */
function buildRow(spec, ctx) {
  const li = el('li', 'hm-run-row');
  li.dataset.hmKey = `row-${spec.key}`;
  const id = ctx.idButton(spec.id, 'rp-link rp-chip-id hm-run-id');
  id.dataset.hmKey = `id-${spec.key}`;
  const parts = {
    id, title: el('span', 'hm-run-title'), chip: el('span', 'rp-chip'), age: el('span', 'hm-run-age'),
    source: el('span', 'hm-run-source'), pr: el('span', 'hm-run-pr'), epic: el('span', 'hm-run-epic'), epicId: null,
  };
  li.append(id, parts.title, parts.chip, parts.age, parts.source, parts.pr, parts.epic);
  li._parts = parts;
  return li;
}

/** Bring a row up to date without replacing what has not changed. */
function fillRow(li, spec, ctx) {
  const p = li._parts;
  setText(p.title, spec.title || '');
  p.title.title = spec.title || '';
  const cls = `rp-chip ${CHIP[spec.state] || 'rp-chip-later'}`;
  if (p.chip.className !== cls) p.chip.className = cls;
  setText(p.chip, STATE_WORDS[spec.state] || spec.state);
  setText(p.age, spec.age);
  p.age.title = spec.ageTitle || '';
  setText(p.source, spec.source || '');
  const prUrl = spec.pr || '';
  if ((p.pr.firstChild?.href || '') !== prUrl) {
    p.pr.textContent = '';
    if (prUrl) {
      const a = el('a', 'rp-link hm-run-prlink', prLabel(prUrl));
      a.href = prUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.dataset.hmKey = `pr-${spec.key}`;
      a.setAttribute('aria-label', `Open ${prLabel(prUrl)} for ${spec.id} in a new tab`);
      p.pr.appendChild(a);
    }
  }
  const epic = spec.epicId || null;
  if (p.epicId !== epic || p.epicTitle !== (spec.epicTitle || '')) {
    p.epicId = epic;
    p.epicTitle = spec.epicTitle || '';
    p.epic.textContent = '';
    if (epic) {
      const b = ctx.idButton(epic, 'rp-link rp-chip-id');
      b.dataset.hmKey = `epic-${spec.key}`;
      p.epic.append(b, el('span', 'hm-run-epictitle', spec.epicTitle || ''));
    } else if (spec.noEpicText) {
      p.epic.appendChild(el('span', 'hm-muted', spec.noEpicText));
    }
  }
}

/**
 * Make `list` show exactly `specs` (in order), keyed by spec.key. `rows` is the Map the caller keeps
 * between calls (key -> li). Specs: { key, id, title, state, age, ageTitle?, source?, pr?, epicId?, epicTitle?, noEpicText? }.
 */
export function syncRows(list, rows, specs, ctx) {
  const wanted = new Set(specs.map(s => s.key));
  const animate = !reduced() && list.isConnected && list.offsetParent !== null;
  const before = new Map();
  if (animate) for (const [k, li] of rows) before.set(k, li.getBoundingClientRect().top);

  for (const [key, li] of [...rows]) {
    if (wanted.has(key)) continue;
    rows.delete(key);
    retire(li, animate, list);
  }
  let prev = null;
  for (const spec of specs) {
    let li = rows.get(spec.key);
    const fresh = !li;
    if (fresh) { li = buildRow(spec, ctx); rows.set(spec.key, li); }
    fillRow(li, spec, ctx);
    // Only move a row that is not already right after the previous one: a row that stays never moves,
    // so the focus on it survives.
    const next = prev ? prev.nextElementSibling : list.firstElementChild;
    const place = (n) => { while (n && n.classList.contains('hm-run-leaving')) n = n.nextElementSibling; return n; };
    if (place(next) !== li) {
      const focused = document.activeElement && li.contains(document.activeElement) ? document.activeElement : null;
      list.insertBefore(li, next ? place(next) || null : null);
      if (focused) focused.focus({ preventScroll: true });
    }
    if (fresh && animate) enter(li);
    prev = li;
  }
  if (animate) {
    for (const [k, li] of rows) {
      if (!before.has(k)) continue;
      const dy = before.get(k) - li.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) li.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: DUR, easing: 'cubic-bezier(0.22, 0.6, 0.36, 1)' });
    }
  }
}

function enter(li) {
  li.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: DUR, easing: 'cubic-bezier(0.22, 0.6, 0.36, 1)' });
}

/** Take a row out: fade and collapse, then remove. Focus on it moves to the next row (or the list). */
function retire(li, animate, list) {
  const had = li.contains(document.activeElement);
  const sibling = li.nextElementSibling || li.previousElementSibling;
  if (had) {
    const t = sibling && !sibling.classList.contains('hm-run-leaving') ? sibling.querySelector('button, a') : null;
    (t || list).focus({ preventScroll: true });
  }
  li.inert = true;
  li.setAttribute('aria-hidden', 'true');
  li.classList.add('hm-run-leaving');
  if (!animate) { li.remove(); return; }
  const h = li.offsetHeight;
  const a = li.animate([
    { opacity: 1, height: `${h}px`, transform: 'none' },
    { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', transform: 'translateX(12px)' },
  ], { duration: DUR, easing: 'ease', fill: 'forwards' });
  a.onfinish = () => li.remove();
  setTimeout(() => li.remove(), DUR + 200);
}

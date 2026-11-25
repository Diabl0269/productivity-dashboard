// home-usage.js (PRO124) — the usage chip in Home's top bar (slot `usage`) and the popover that grows from it.
// The chip reads "62% of the week used · resets Tue 13:00" (local time; amber over 75%, red over 90%), or
// "$412 this week · resets Tue 13:00" while there is no calibrated limit to take a percent of. Click, Enter or
// Space opens the popover: the pace in plain words, cost per day, top epics, running sessions, "as of hh:mm"
// and whether the number is estimated or set by you. Esc, a click away or the chip again close it, animated back
// into the chip; focus returns to the chip. Data: GET /api/home/usage?project= (server cache 60 s).
// The popover lives on <body> (the top bar clips overflow) and uses base.css tokens only; styles: home-usage.css.

import { registerTopBarItem } from './home-state.js';
import { chipParts, chipLevel, paceSentence, fmtMoney, resetLabel } from '../../shared/usage-meter.js';

const REFRESH_MS = 60e3;
const CLOSE_MS = 130;
const DAY_LETTERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const st = { body: null, project: null, error: false, loading: false, chip: null, pop: null, closing: null, ctx: null, timer: null, fetchedAt: 0 };

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
const hm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

// ---------- data ----------

async function load(force) {
  const project = st.ctx?.project?.() || null;
  if (st.loading) return;
  if (!force && st.body && st.project === project && Date.now() - st.fetchedAt < REFRESH_MS) return;
  st.loading = true;
  st.chip?.setAttribute('aria-busy', String(!st.body || st.project !== project)); // quiet skeleton, first read only
  try {
    const res = await fetch(`/api/home/usage${project ? `?project=${encodeURIComponent(project)}` : ''}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    st.body = await res.json();
    st.project = project;
    st.error = false;
    st.fetchedAt = Date.now();
  } catch {
    st.error = true;
  } finally {
    st.loading = false;
    st.chip?.removeAttribute('aria-busy');
  }
  paintChip();
  if (st.pop) paintPopover();
}

function startTimer() {
  if (st.timer) return;
  st.timer = setInterval(() => {
    if (!st.chip?.isConnected) { clearInterval(st.timer); st.timer = null; return; }
    if (document.visibilityState === 'visible' && st.chip.offsetParent !== null) load(false);
  }, REFRESH_MS);
}

// ---------- chip ----------

function buildChip() {
  const chip = el('button', 'hu-chip');
  chip.type = 'button';
  chip.dataset.hmKey = 'usage';
  chip.setAttribute('aria-haspopup', 'dialog');
  chip.setAttribute('aria-expanded', 'false');
  chip.appendChild(el('span', 'hu-dot'));
  chip.appendChild(el('span', 'hu-text', 'Usage…'));
  chip.addEventListener('click', e => toggle({ viaKeyboard: e.detail === 0 }));
  chip.addEventListener('keydown', e => {
    if (e.key === 'Tab' && !e.shiftKey && st.pop && st.pop.dataset.state !== 'closing') {
      const first = focusables()[0];
      if (first) { e.preventDefault(); first.focus(); }
    }
  });
  return chip;
}

function paintChip() {
  const chip = st.chip;
  if (!chip) return;
  const text = chip.querySelector('.hu-text');
  const m = st.body;
  if (!m) {
    text.textContent = st.error ? 'Usage unavailable' : 'Usage…';
    chip.dataset.level = 'none';
    chip.title = st.error ? 'The usage numbers could not be read.' : 'Reading this week\'s usage';
    return;
  }
  const parts = chipParts(m);
  text.textContent = parts.main;
  text.appendChild(el('span', 'hu-rest', parts.rest)); // hidden when the top bar is narrow (home-palette.css)
  chip.dataset.level = chipLevel(m);
  chip.dataset.stale = st.error ? 'true' : 'false';
  chip.title = `${sourceLine(m)}, as of ${hm(Date.parse(m.asOf))}. Click for the details.`;
}

/** Where the chip's number comes from, named for the tooltip: the reading's own time for a set or read percent. */
export function sourceLine(m) {
  return m.source === 'set by you' ? `Set by you at ${hm(Date.parse(m.setAt))}`
    : m.source === 'read from Claude' ? `Read from Claude at ${hm(Date.parse(m.setAt))}`
      : m.source === 'estimated' ? 'Estimated from cost this week' : 'No percent yet';
}

// ---------- popover ----------

function focusables() {
  return st.pop ? [...st.pop.querySelectorAll('button:not([disabled])')] : [];
}

function section(title) {
  const s = el('section', 'hu-sec');
  s.appendChild(el('h3', 'hu-h', title));
  return s;
}

function row(left, right, sub) {
  const r = el('div', 'hu-row');
  r.appendChild(left);
  if (sub) r.appendChild(el('span', 'hu-sub', sub));
  r.appendChild(el('span', 'hu-usd', right));
  return r;
}

function bars(m) {
  const wrap = el('div', 'hu-bars');
  wrap.setAttribute('role', 'list');
  wrap.setAttribute('aria-label', 'Cost per day this week');
  const max = Math.max(1, ...m.perDay.map(d => d.usd));
  const today = m.perDay[m.perDay.length - 1]?.date;
  for (const d of m.perDay) {
    const [y, mo, da] = d.date.split('-').map(Number);
    const name = DAY_LETTERS[new Date(y, mo - 1, da).getDay()];
    const col = el('div', 'hu-bar');
    col.setAttribute('role', 'listitem');
    col.setAttribute('aria-label', `${name} ${fmtMoney(d.usd)}`);
    col.title = `${name} ${d.date}: ${fmtMoney(d.usd)}`;
    if (d.date === today) col.dataset.today = 'true';
    const fill = el('span', 'hu-bar-fill');
    fill.style.height = `${Math.max(d.usd > 0 ? 3 : 0, Math.round((d.usd / max) * 100))}%`;
    col.append(el('span', 'hu-bar-val', d.usd >= 1 ? `$${Math.round(d.usd)}` : ''), el('span', 'hu-bar-track', ''), el('span', 'hu-bar-day', name));
    col.querySelector('.hu-bar-track').appendChild(fill);
    wrap.appendChild(col);
  }
  return wrap;
}

function paintPopover() {
  const pop = st.pop;
  const m = st.body;
  if (!pop || !m) return;
  const keep = document.activeElement && pop.contains(document.activeElement) ? document.activeElement.dataset.ticket : null;
  pop.textContent = '';

  const head = el('div', 'hu-head');
  head.appendChild(el('div', 'hu-big', m.pctUsed === null ? fmtMoney(m.costThisWeekUSD) : `${m.source === 'estimated' ? '~' : ''}${Math.round(m.pctUsed)}%`));
  const meta = el('div', 'hu-meta');
  meta.appendChild(el('div', 'hu-line', m.pctUsed === null ? (m.limitHit ? `spent this week at API prices · ${m.limitHit.kind} limit hit` : 'spent this week at API prices') : `of the week used · ${fmtMoney(m.costThisWeekUSD)} at API prices`));
  meta.appendChild(el('div', 'hu-line hu-muted', `resets ${resetLabel(Date.parse(m.resetsAt))} (your local time)`));
  head.appendChild(meta);
  pop.appendChild(head);

  if (m.pctUsed !== null) {
    const track = el('div', 'hu-meter');
    track.setAttribute('role', 'img');
    track.setAttribute('aria-label', `${Math.round(m.pctUsed)} percent of the week used`);
    const fill = el('span', 'hu-meter-fill');
    fill.dataset.level = chipLevel(m);
    fill.style.width = `${Math.min(100, m.pctUsed)}%`;
    track.appendChild(fill);
    pop.appendChild(track);
  }
  pop.appendChild(el('p', 'hu-pace', paceSentence(m)));

  const days = section('Cost per day');
  days.appendChild(bars(m));
  pop.appendChild(days);

  const epics = section('Top epics this week');
  if (!m.perEpic.length) epics.appendChild(el('p', 'hu-muted', 'No epic work recorded yet this week.'));
  for (const e of m.perEpic) {
    const left = el('span', 'hu-who');
    left.appendChild(st.ctx.idButton(e.id));
    if (e.title) left.appendChild(el('span', 'hu-title', e.title));
    epics.appendChild(row(left, fmtMoney(e.usd)));
  }
  pop.appendChild(epics);

  const live = section('Running now');
  if (!m.perRunning.length) live.appendChild(el('p', 'hu-muted', 'No session is running.'));
  for (const r of m.perRunning) {
    const left = el('span', 'hu-who');
    left.appendChild(r.ticketId ? st.ctx.idButton(r.ticketId) : el('span', 'hu-muted', `session ${r.sessionId.slice(0, 8)}`));
    live.appendChild(row(left, fmtMoney(r.usd), r.since ? `since ${hm(Date.parse(r.since))}` : null));
  }
  pop.appendChild(live);

  const how = m.source === 'read from Claude' ? `${sourceLine(m)}: Claude's own weekly percent.`
    : m.source === 'set by you' ? `Set by you at ${hm(Date.parse(m.setAt))}, then counted forward from the cost since.`
    : m.source === 'estimated' ? `Estimated: cost this week against a limit of about ${fmtMoney(m.weekUSD)} learned from past limit hits.`
      : (m.reason || 'No percent yet.');
  const foot = el('div', 'hu-foot');
  foot.appendChild(el('span', '', `as of ${hm(Date.parse(m.asOf))}${m.capped ? ' (some newer sessions are not counted yet; run ch metrics collect)' : ''}`));
  foot.appendChild(el('span', 'hu-muted', how));
  if (m.source === 'none' || m.limitHit) {
    const cmd = el('button', 'hu-copy', 'Copy: ch metrics usage --set <pct>');
    cmd.type = 'button';
    cmd.addEventListener('click', () => { navigator.clipboard?.writeText('ch metrics usage --set ').then(() => { cmd.textContent = 'Copied'; }, () => {}); });
    foot.appendChild(cmd);
  }
  if (m.limitHitNote) foot.appendChild(el('span', 'hu-muted', m.limitHitNote));
  pop.appendChild(foot);

  if (keep) pop.querySelector(`[data-ticket="${keep}"]`)?.focus();
  place();
}

function place() {
  const pop = st.pop;
  const chip = st.chip;
  if (!pop || !chip) return;
  const r = chip.getBoundingClientRect();
  const width = Math.min(380, window.innerWidth - 16);
  pop.style.width = `${width}px`;
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, r.right - width));
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.round(r.bottom + 8)}px`;
  pop.style.maxHeight = `${Math.max(200, window.innerHeight - r.bottom - 24)}px`;
  // It grows from the chip: the scale origin is the chip's centre, in the popover's own coordinates.
  pop.style.transformOrigin = `${Math.round(r.left + r.width / 2 - left)}px -8px`;
}

function open({ viaKeyboard }) {
  if (st.pop && st.pop.dataset.state !== 'closing') return;
  if (st.closing) { clearTimeout(st.closing); st.closing = null; st.pop?.remove(); st.pop = null; }
  const pop = el('div', 'hu-pop');
  pop.id = 'huPopover';
  pop.setAttribute('role', 'dialog');
  pop.setAttribute('aria-label', 'Usage this week');
  pop.tabIndex = -1;
  pop.dataset.state = 'enter';
  pop.addEventListener('keydown', onPopKey);
  pop.addEventListener('click', e => { if (e.target.closest?.('[data-ticket]')) close({ refocus: false }); }); // the ticket opens over it
  st.pop = pop;
  document.body.appendChild(pop);
  st.chip.setAttribute('aria-expanded', 'true');
  st.chip.setAttribute('aria-controls', 'huPopover');
  if (st.body) paintPopover(); else { pop.appendChild(el('p', 'hu-muted', st.error ? 'The usage numbers could not be read.' : 'Reading this week\'s usage…')); place(); }
  void pop.offsetWidth; // start from the "enter" look, then grow
  pop.dataset.state = 'open';
  document.addEventListener('pointerdown', onAway, true);
  document.addEventListener('keydown', onEsc, true);
  window.addEventListener('resize', place);
  load(true);
  if (viaKeyboard) (focusables()[0] || pop).focus();
}

function close({ refocus = true } = {}) {
  const pop = st.pop;
  if (!pop || pop.dataset.state === 'closing') return;
  document.removeEventListener('pointerdown', onAway, true);
  document.removeEventListener('keydown', onEsc, true);
  window.removeEventListener('resize', place);
  st.chip?.setAttribute('aria-expanded', 'false');
  st.chip?.removeAttribute('aria-controls');
  if (refocus) st.chip?.focus();
  const done = () => { pop.remove(); if (st.pop === pop) st.pop = null; st.closing = null; };
  if (reduced()) { done(); return; }
  pop.dataset.state = 'closing';
  st.closing = setTimeout(done, CLOSE_MS);
}

function toggle(opts) {
  if (st.pop && st.pop.dataset.state !== 'closing') close(); else open(opts);
}

function onEsc(e) {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  e.stopPropagation();
  close();
}

function onAway(e) {
  if (st.pop?.contains(e.target) || st.chip?.contains(e.target)) return;
  close({ refocus: false });
}

function onPopKey(e) {
  if (e.key !== 'Tab') return;
  const f = focusables();
  if (!f.length) { e.preventDefault(); close(); return; }
  const at = f.indexOf(document.activeElement);
  if ((e.shiftKey && at <= 0) || (!e.shiftKey && at === f.length - 1)) { e.preventDefault(); close(); }
}

// ---------- registration ----------

function mount(root, ctx) {
  st.ctx = ctx;
  if (!st.chip) st.chip = buildChip();
  if (st.chip.parentNode !== root) root.appendChild(st.chip);
  paintChip();
  startTimer();
  load(false);
}

registerTopBarItem({
  id: 'usage',
  slot: 'usage',
  render(root, ctx) { mount(root, ctx); },
  update(root, ctx) { mount(root, ctx); }, // keep the chip element (and an open popover) when tasks or config change
});

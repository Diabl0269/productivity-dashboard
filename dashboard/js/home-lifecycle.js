// home-lifecycle.js (PRO122) — the top of How it runs: the life of a note and a ticket as a flow, left to right
// (two rows under 1100 px), one colour per actor with a legend, each step a box with its live count, who acts
// and one line of what happens. Click or Enter opens the step's tickets and notes below the flow; Esc closes.
// Arrow keys move between steps. The wires are an SVG drawn from the boxes' real positions, so the layout
// is plain CSS grid and the drawing follows any wrap. Data: shared/lifecycle.js.
// AGE199: hover a line to read what travels on it; an open step links to the job or skill that does it
// (the config's stage `job` / `skill` / `page`); a "waits on" line runs from the questions back to the running
// sessions that wait for you, and its label opens exactly those sessions.

import { WHO, LIFECYCLE_PATH, LIFECYCLE_SIDE, applyLifecycleConfig, lifecycleEdges, lifecycleSnapshot } from '../../shared/lifecycle.js';
import { paintItems, itemsSignature } from './home-lifecycle-items.js';
import { getRuns } from './home-health-data.js';

const NARROW = '(max-width: 1100px)';
const SVG_NS = 'http://www.w3.org/2000/svg';
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const WAITING = 'waiting-you';

/** The id of the box whose handbook page is `page` (relative path like pages/workspace.md), or null. */
export function boxOfPage(config, page) {
  const norm = p => String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  const want = norm(page);
  if (!want) return null;
  for (const g of config?.groups || []) {
    if (g.page && norm(g.page) === want) return g.id;
    for (const a of g.areas || []) {
      if (a.page && norm(a.page) === want) return a.id;
      for (const p of a.parts || []) if (p.page && norm(p.page) === want) return p.id;
    }
  }
  return null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function svg(tag, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Grid places of the shown stages: the main path in rows, the side step under the stage it hangs off. */
export function placeStages(stageIds, narrow) {
  const path = LIFECYCLE_PATH.filter(id => stageIds.includes(id));
  const cols = Math.max(1, narrow ? Math.ceil(path.length / 2) : path.length);
  const pos = {};
  path.forEach((id, i) => { pos[id] = { row: Math.floor(i / cols) + 1, col: (i % cols) + 1 }; });
  const rows = Math.ceil(path.length / cols);
  if (stageIds.includes(LIFECYCLE_SIDE.id) && pos[LIFECYCLE_SIDE.attach]) pos[LIFECYCLE_SIDE.id] = { row: rows + 1, col: pos[LIFECYCLE_SIDE.attach].col };
  return { pos, cols };
}

/** Count up or down to `to` over 400 ms. */
function tween(node, from, to) {
  if (from === to || from === null || to === null || reducedMotion()) { node.textContent = to === null ? '—' : String(to); return; }
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / 400);
    node.textContent = String(Math.round(from + (to - from) * (1 - (1 - k) ** 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  node.classList.remove('hr-bump');
  void node.offsetWidth;
  node.classList.add('hr-bump');
}

/**
 * Build the flow into `host`.
 * @param {HTMLElement} host
 * @param {object} ctx Home ctx
 * @param {{ scope: () => ({ epicIds: Set|null }), live: () => object|null, placeNote: () => string }} src
 * @returns {{ update(): void, closePanel(): boolean, dispose(): void }}
 */
export function buildFlow(host, ctx, src) {
  const wrap = el('section', 'hr-flow-wrap');
  wrap.setAttribute('aria-labelledby', 'hrFlowTitle');
  const head = el('div', 'hr-flow-head');
  const title = el('h3', 'hr-h3', 'The life of a note');
  title.id = 'hrFlowTitle';
  const sub = el('p', 'hr-sub', 'From a note you write to work that is done. Each box shows what sits at that step right now; open one to see it.');
  const legend = el('ul', 'hr-legend');
  legend.setAttribute('aria-label', 'Who acts');
  for (const w of WHO) {
    const li = el('li', 'hr-legend-item');
    li.dataset.who = w.id;
    li.append(el('i', 'hr-dot'), el('span', '', w.label));
    legend.appendChild(li);
  }
  const place = el('p', 'hr-place-note');
  head.append(title, sub, legend, place);

  const flow = el('div', 'hr-flow');
  flow.setAttribute('role', 'group');
  flow.setAttribute('aria-label', 'Steps of the life of a note. Arrow keys move between steps, Enter opens one.');
  const wires = svg('svg', { class: 'hr-wires', 'aria-hidden': 'true' });
  const loopLabel = el('span', 'hr-loop-label');
  const sideLabel = el('span', 'hr-side-label');
  const waitLabel = el('button', 'hr-wait-label');
  waitLabel.type = 'button';
  waitLabel.dataset.hmKey = 'wait-edge';
  waitLabel.addEventListener('click', () => (open === 'running' && filter === WAITING ? closePanel(false) : openPanel('running', WAITING)));
  const wireTip = el('span', 'hr-wire-tip');
  wireTip.setAttribute('role', 'tooltip');
  wireTip.hidden = true;
  flow.append(wires, loopLabel, sideLabel, waitLabel, wireTip);

  const panel = el('div', 'hr-panel');
  panel.id = 'hrStagePanel';
  panel.dataset.open = 'false';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'Items at the open step');
  panel.inert = true;
  const panelIn = el('div', 'hr-panel-in');
  const panelHead = el('div', 'hr-panel-head');
  const panelTitle = el('h4', 'hr-panel-title');
  const panelSource = el('p', 'hr-panel-source');
  const close = el('button', 'hr-btn hr-panel-close', 'Close');
  close.type = 'button';
  close.dataset.hmKey = 'stage-panel-close';
  close.setAttribute('aria-label', 'Close this step (Esc)');
  close.addEventListener('click', () => closePanel(true));
  const panelText = el('div', 'hr-panel-text');
  const panelLinks = el('p', 'hr-panel-links');
  panelText.append(panelTitle, panelSource, panelLinks);
  panelHead.append(panelText, close);
  const list = el('ul', 'hr-items');
  panelIn.append(panelHead, list);
  panel.appendChild(panelIn);

  wrap.append(head, flow, panel);
  host.appendChild(wrap);

  const boxes = new Map(); // id -> { btn, num, detail, count }
  let stages = [];
  let edges = [];
  let snap = {};
  let open = null;
  let filter = null; // 'waiting-you' while the running step shows only the sessions that wait for you
  let shownSig = null;
  let narrow = window.matchMedia(NARROW).matches;
  let focusId = null;

  function stageBox(s) {
    const btn = el('button', 'hr-stage');
    btn.type = 'button';
    btn.dataset.stage = s.id;
    btn.dataset.who = s.who;
    btn.dataset.hmKey = `stage-${s.id}`;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', panel.id);
    if (s.id === LIFECYCLE_SIDE.id) btn.classList.add('hr-stage-side');
    const who = el('span', 'hr-who');
    who.append(el('i', 'hr-dot'), el('span', '', WHO.find(w => w.id === s.who)?.label.replace(/ \(.*\)$/, '') || s.who));
    const top = el('span', 'hr-stage-top');
    const num = el('span', 'hr-count', '—');
    top.append(el('span', 'hr-label', s.label), num);
    const what = el('span', 'hr-what', s.what);
    const detail = el('span', 'hr-detail', '');
    const tip = el('span', 'hr-tip', s.source || s.what);
    tip.id = `hrTip-${s.id}`;
    tip.setAttribute('role', 'tooltip');
    btn.setAttribute('aria-describedby', tip.id);
    btn.append(who, top, what, detail, tip);
    btn.addEventListener('click', () => (open === s.id && !filter ? closePanel(false) : openPanel(s.id)));
    btn.addEventListener('focus', () => { focusId = s.id; roving(); });
    return { btn, num, detail, count: null };
  }

  function order() {
    return [...LIFECYCLE_PATH, LIFECYCLE_SIDE.id].filter(id => boxes.has(id));
  }
  function roving() {
    const ids = order();
    const current = focusId && boxes.has(focusId) ? focusId : ids[0];
    for (const id of ids) boxes.get(id).btn.tabIndex = id === current ? 0 : -1;
  }
  flow.addEventListener('keydown', (e) => {
    const ids = order();
    const i = ids.indexOf(document.activeElement?.dataset?.stage);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = Math.min(ids.length - 1, i + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = Math.max(0, i - 1);
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = ids.length - 1;
    if (next < 0) return;
    e.preventDefault();
    boxes.get(ids[next]).btn.focus();
  });

  function layout() {
    const { pos, cols } = placeStages(stages.map(s => s.id), narrow);
    flow.style.setProperty('--hr-cols', cols);
    flow.dataset.layout = narrow ? 'two-rows' : 'one-row';
    for (const [id, b] of boxes) {
      const p = pos[id];
      b.btn.hidden = !p;
      if (p) { b.btn.style.gridRow = String(p.row); b.btn.style.gridColumn = String(p.col); }
    }
    requestAnimationFrame(drawWires);
  }

  function drawWires() {
    if (!flow.isConnected) return;
    const fr = flow.getBoundingClientRect();
    if (!fr.width) return;
    const r = id => {
      const b = boxes.get(id)?.btn;
      if (!b || b.hidden) return null;
      const x = b.getBoundingClientRect();
      return { l: x.left - fr.left, t: x.top - fr.top, r: x.right - fr.left, b: x.bottom - fr.top, cx: (x.left + x.right) / 2 - fr.left, cy: (x.top + x.bottom) / 2 - fr.top };
    };
    wires.setAttribute('width', fr.width);
    wires.setAttribute('height', fr.height);
    wires.setAttribute('viewBox', `0 0 ${fr.width} ${fr.height}`);
    wires.textContent = '';
    const defs = svg('defs');
    for (const [idName, cls] of [['hrArrow', 'hr-arrow'], ['hrArrowLoop', 'hr-arrow-loop']]) {
      const m = svg('marker', { id: idName, viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' });
      m.appendChild(svg('path', { d: 'M0 0 L10 5 L0 10 z', class: cls }));
      defs.appendChild(m);
    }
    wires.appendChild(defs);
    const boxesDown = [...boxes.values()].filter(b => !b.btn.hidden).map(b => b.btn.getBoundingClientRect().bottom - fr.top);
    const bottom = Math.max(...boxesDown, 0) + 18;
    loopLabel.hidden = true;
    sideLabel.hidden = true;
    waitLabel.hidden = true;
    for (const e of edges) {
      const a = r(e.from);
      const b = r(e.to);
      if (!a || !b) continue;
      let d;
      if (e.kind === 'flow') {
        d = Math.abs(a.cy - b.cy) < 4 ? `M${a.r + 2} ${a.cy} H${b.l - 3}` : `M${a.cx} ${a.b + 2} V${(a.b + b.t) / 2} H${b.cx} V${b.t - 3}`;
      } else if (e.kind === 'side') {
        d = `M${a.cx} ${a.b + 2} V${b.t - 3}`;
        Object.assign(sideLabel.style, { left: `${a.cx - 8}px`, top: `${(a.b + b.t) / 2 - 9}px` });
        sideLabel.textContent = e.label;
        sideLabel.hidden = false;
      } else if (e.kind === 'wait') {
        // From the questions back up to the sessions that wait for them, a little right of the way down.
        const x = b.cx + 22;
        d = `M${x} ${a.t - 3} V${b.b + 2}`;
        Object.assign(waitLabel.style, { left: `${x + 8}px`, top: `${(a.t + b.b) / 2 - 11}px` });
        waitLabel.textContent = e.ids.length ? `${e.label}: ${e.ids.length} ${e.ids.length === 1 ? 'session' : 'sessions'}` : `${e.label}: no session`;
        waitLabel.disabled = !e.ids.length;
        waitLabel.setAttribute('aria-label', e.ids.length ? `${e.ids.length} running ${e.ids.length === 1 ? 'session waits' : 'sessions wait'} for you: ${e.ids.join(', ')}. Open them.` : 'No running session waits for you right now.');
        waitLabel.hidden = false;
      } else {
        d = `M${a.cx} ${a.b + 2} V${bottom} H8 V${b.cy} H${b.l - 3}`;
        Object.assign(loopLabel.style, { left: `${Math.max(16, (a.cx + 8) / 2 - 140)}px`, top: `${bottom + 4}px` });
        loopLabel.textContent = `↺ ${e.label}`;
        loopLabel.hidden = false;
      }
      wires.appendChild(svg('path', { d, class: `hr-wire hr-wire-${e.kind}`, 'marker-end': `url(#${e.kind === 'loop' ? 'hrArrowLoop' : 'hrArrow'})` }));
      const hit = svg('path', { d, class: 'hr-wire-hit' });
      const text = `${stages.find(s => s.id === e.from)?.label || e.from} to ${stages.find(s => s.id === e.to)?.label || e.to}: ${e.travels}`;
      const showTip = (ev) => {
        const f = flow.getBoundingClientRect();
        wireTip.textContent = text;
        wireTip.hidden = false;
        const w = wireTip.offsetWidth;
        Object.assign(wireTip.style, { left: `${Math.max(0, Math.min(f.width - w, ev.clientX - f.left - w / 2))}px`, top: `${ev.clientY - f.top + 14}px` });
      };
      hit.addEventListener('pointerenter', showTip);
      hit.addEventListener('pointermove', showTip);
      hit.addEventListener('pointerleave', () => { wireTip.hidden = true; });
      wires.appendChild(hit);
    }
  }

  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => drawWires()) : null;
  ro?.observe(flow);
  const mq = window.matchMedia(NARROW);
  const onMq = () => { narrow = mq.matches; layout(); };
  mq.addEventListener?.('change', onMq);

  function build() {
    stages = applyLifecycleConfig(undefined, ctx.config()?.lifecycle || null);
    for (const b of boxes.values()) b.btn.remove();
    boxes.clear();
    for (const s of stages) {
      const b = stageBox(s);
      boxes.set(s.id, b);
      flow.appendChild(b.btn);
    }
    roving();
    layout();
  }

  function paintPanel(animate) {
    const s = stages.find(x => x.id === open);
    if (!s) return;
    const data = snap[s.id] || { count: null, items: [] };
    const items = filter ? data.items.filter(r => r.state === filter) : data.items;
    panelTitle.textContent = filter ? `${s.label}: ${items.length} waiting for you` : `${s.label}: ${data.count === null ? 'unknown' : data.count}`;
    panelSource.textContent = filter ? 'Running sessions that stopped to ask you something. Answer them on the Plan page.' : (s.source || s.what);
    paintLinks(s);
    const sig = `${s.id}#${filter || ''}#${itemsSignature(items)}`;
    if (sig === shownSig) return;
    shownSig = sig;
    const empty = data.count === null ? 'Running data is not available in this build of the page.' : 'Nothing here right now.';
    paintItems(list, items, ctx, empty);
    if (animate && !reducedMotion()) { panelIn.classList.remove('hr-swap'); void panelIn.offsetWidth; panelIn.classList.add('hr-swap'); }
  }

  /** The job, skill and page a step links to (the config's `job`, `skill`, `page`), as buttons and text. */
  function paintLinks(s) {
    const sig = `${s.id}|${s.job || ''}|${s.skill || ''}|${s.page || ''}|${filter || ''}`;
    if (panelLinks.dataset.sig === sig) return;
    panelLinks.dataset.sig = sig;
    panelLinks.textContent = '';
    if (filter) return;
    if (s.job) {
      const name = (getRuns().automations || []).find(a => a.id === s.job)?.name || ctx.config()?.automations?.find(a => a.id === s.job)?.name || s.job;
      const b = el('button', 'hr-btn hr-link-job', `Done by: ${name}`);
      b.type = 'button';
      b.dataset.hmKey = `stage-job-${s.id}`;
      b.dataset.job = s.job;
      b.setAttribute('aria-label', `Show the job that does this step: ${name}`);
      b.addEventListener('click', () => document.dispatchEvent(new CustomEvent('hm:open', { detail: { view: 'how-it-runs', focus: `job:${s.job}` } })));
      panelLinks.appendChild(b);
    }
    const box = s.page ? boxOfPage(ctx.config(), s.page) : null;
    if (box) {
      const b = el('button', 'hr-btn hr-link-page', 'Open its page');
      b.type = 'button';
      b.dataset.hmKey = `stage-page-${s.id}`;
      b.addEventListener('click', () => { ctx.setSelection(box); document.querySelector('.hm-insp-tab[data-id="how"]')?.click(); });
      panelLinks.appendChild(b);
    }
    if (s.skill) {
      const t = el('span', 'hr-link-skill', 'Skill: ');
      t.appendChild(el('code', '', s.skill));
      panelLinks.appendChild(t);
    }
  }

  function openPanel(id, only = null) {
    const was = open;
    open = id;
    filter = only;
    for (const [sid, b] of boxes) b.btn.setAttribute('aria-expanded', sid === id ? 'true' : 'false');
    shownSig = null;
    paintPanel(!!was);
    panel.dataset.open = 'true';
    panel.inert = false;
    // The open step sits under the whole flow: bring it into view (nearest, so a visible panel does not move).
    setTimeout(() => { if (open === id) panel.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' }); }, 220); // after the panel has grown
  }

  /** Close the open step; true when one was open. */
  function closePanel(focusBack) {
    if (!open) return false;
    const was = open;
    open = null;
    filter = null;
    shownSig = null;
    panel.dataset.open = 'false';
    panel.inert = true;
    for (const b of boxes.values()) b.btn.setAttribute('aria-expanded', 'false');
    if (focusBack) boxes.get(was)?.btn.focus();
    return true;
  }

  function update() {
    const want = applyLifecycleConfig(undefined, ctx.config()?.lifecycle || null).map(s => `${s.id}:${s.label}`).join('|');
    if (want !== stages.map(s => `${s.id}:${s.label}`).join('|')) build();
    snap = lifecycleSnapshot(ctx.doc(), src.live(), { ...src.scope(), now: Date.now() }, stages);
    edges = lifecycleEdges(stages, src.live());
    for (const s of stages) {
      const b = boxes.get(s.id);
      const d = snap[s.id];
      tween(b.num, b.count, d.count);
      b.count = d.count;
      b.detail.textContent = d.detail;
      b.btn.classList.toggle('hr-stage-zero', d.count === 0);
      const out = edges.find(e => e.from === s.id && e.kind === 'flow');
      b.btn.setAttribute('aria-label', `${s.label}: ${d.count === null ? 'unknown' : d.count}. ${WHO.find(w => w.id === s.who)?.label}. ${s.what} ${d.detail}.${out ? ` Next: ${out.travels}` : ''}`);
    }
    place.textContent = src.placeNote();
    place.hidden = !place.textContent;
    if (open && !stages.some(s => s.id === open)) closePanel(false);
    if (open) paintPanel(false);
    requestAnimationFrame(drawWires);
  }

  build();
  update();
  return {
    update,
    closePanel,
    dispose() { ro?.disconnect(); mq.removeEventListener?.('change', onMq); },
  };
}

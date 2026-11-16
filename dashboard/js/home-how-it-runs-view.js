// home-how-it-runs-view.js (PRO122, PRO123) — the Home "How it runs" view (key 5): the life of a note as a flow
// with live counts (home-lifecycle.js), then every automation and outside service with its state
// (home-runs-list.js, data from home-health-data.js), plus the lower strip's "health" item.
//
// Two modules other tickets write are loaded here if they exist, each behind one function with a fallback:
//   home-where.js         selectedEpicIds(ctx) -> Set of epic ids inside the selected place, or null
//   home-running-data.js  getRunning() / onRunning(fn) -> the live running answer (shared/running.js)

import { registerHomeView, registerStripItem, setView } from './home-state.js';
import { boxOfWhere } from '../../shared/home-config.js';
import { buildFlow } from './home-lifecycle.js';
import { buildRuns } from './home-runs-list.js';
import { loadRuns, getRuns, onHealth, getHealth, healthLine, askProblems, takeProblemsAsk } from './home-health-data.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// ===== optional modules from sibling tickets =====

let whereMod; // undefined: not tried yet; null: not in this build
let runningMod;
const optionalReady = Promise.all([
  import('./home-where.js').then(m => { whereMod = m; }, () => { whereMod = null; }),
  import('./home-running-data.js').then(m => { runningMod = m; }, () => { runningMod = null; }),
]);

/** Epic ids inside the selected place (Set), or null for everything / when the place helper is missing. */
function selectedEpicIds(ctx) {
  try { return whereMod?.selectedEpicIds?.(ctx) ?? null; } catch { return null; }
}

/** The live running answer ({ running: [...] }), or null when the running data is not available. */
function liveRunning() {
  try { return runningMod?.getRunning?.() ?? null; } catch { return null; }
}

/** Box ids of the selected place and everything inside it (for services' usedBy), or null. */
function placeBoxIds(ctx) {
  const box = boxOfWhere(ctx.config(), ctx.selection());
  if (!box) return null;
  const ids = new Set([box.id]);
  for (const a of box.areas || []) { ids.add(a.id); for (const p of a.parts || []) ids.add(p.id); }
  for (const p of box.parts || []) ids.add(p.id);
  return ids;
}

function placeNote(ctx) {
  const box = boxOfWhere(ctx.config(), ctx.selection());
  if (!box) return '';
  return selectedEpicIds(ctx) ? `Counting only work inside ${box.name}.` : `${box.name} is selected; these counts still cover the whole project.`;
}

// ===== the view =====

const mounted = new WeakMap(); // view root -> { flow, runs, offs[] }

function render(root, ctx) {
  root.classList.add('hr-view');
  const head = el('div', 'hr-head'); // not <header>: base.css makes every header sticky
  head.append(
    el('h2', 'hr-title', 'How it runs'),
    el('p', 'hr-sub', 'How a note becomes shipped work, who acts at each step, and every job that runs by itself.'),
  );
  root.appendChild(head);
  const flowHost = el('div', 'hr-block');
  const runsHost = el('div', 'hr-block hr-runs');
  root.append(flowHost, runsHost);

  const flow = buildFlow(flowHost, ctx, {
    scope: () => ({ epicIds: selectedEpicIds(ctx) }),
    live: liveRunning,
    placeNote: () => placeNote(ctx),
  });
  const runs = buildRuns(runsHost, ctx, { serviceScope: () => placeBoxIds(ctx) });
  const rec = { flow, runs, offs: [] };
  mounted.set(root, rec);

  const showProblems = () => {
    if (!takeProblemsAsk()) return;
    runs.setProblemsOnly(true);
    requestAnimationFrame(() => runsHost.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  rec.offs.push(onHealth(showProblems));
  showProblems();
  ctx.subscribe((e) => {
    if (e.type === 'selection') { flow.update(); runs.update(); }
    if (e.type === 'project') loadRuns(ctx.project());
  });
  optionalReady.then(() => {
    if (!root.isConnected) return;
    if (runningMod?.onRunning) {
      try { const off = runningMod.onRunning(() => flow.update()); if (typeof off === 'function') rec.offs.push(off); } catch { /* keep the fallback */ }
    }
    try { runningMod?.refreshRunningIfStale?.(); } catch { /* keep the fallback */ }
    flow.update();
  });
  // Esc closes the open step first (before Home's own Esc clears the place).
  const onKey = (e) => {
    if (e.key !== 'Escape' || e.defaultPrevented || !root.isConnected || !root.offsetParent) return;
    if (document.querySelector('dialog[open], .modal-overlay.visible, .modal.visible')) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' && t.type !== 'checkbox' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (flow.closePanel(root.contains(document.activeElement))) e.preventDefault();
  };
  document.addEventListener('keydown', onKey, true);
  rec.offs.push(() => document.removeEventListener('keydown', onKey, true));
  if (getRuns().project !== ctx.project() || getRuns().automations === null) loadRuns(ctx.project());
}

registerHomeView({
  id: 'how-it-runs',
  label: 'How it runs',
  key: 5,
  render,
  update(root, ctx) {
    const rec = mounted.get(root);
    if (!rec) { root.textContent = ''; render(root, ctx); return; }
    try { runningMod?.refreshRunningIfStale?.(); } catch { /* keep the fallback */ }
    rec.flow.update();
    rec.runs.update();
  },
  dispose(root) {
    const rec = mounted.get(root);
    if (!rec) return;
    rec.flow.dispose();
    rec.runs.dispose();
    rec.offs.splice(0).forEach(off => off());
    mounted.delete(root);
  },
});

// ===== lower strip: shows only while an automation or a service needs a look =====

const stripPaint = new WeakMap();

registerStripItem({
  id: 'health',
  render(root, ctx) {
    root.classList.add('hr-health');
    const btn = el('button', 'hr-health-btn');
    btn.type = 'button';
    btn.dataset.hmKey = 'strip-health';
    const dot = el('i', 'hr-health-dot');
    const text = el('span', 'hr-health-text');
    btn.append(dot, text);
    btn.addEventListener('click', () => { askProblems(); setView('how-it-runs'); });
    root.appendChild(btn);
    const paint = () => {
      const h = getHealth();
      const line = healthLine(h);
      const show = !!line;
      if (show && root.hidden) { root.classList.remove('hr-health-in'); void root.offsetWidth; root.classList.add('hr-health-in'); }
      root.hidden = !show;
      text.textContent = line;
      btn.dataset.level = h.automations.failed || h.services.failed ? 'failed' : 'late';
      btn.title = h.problems.map(p => `${p.name}: ${p.state}`).join('\n');
      btn.setAttribute('aria-label', `${line}. Open How it runs, showing only problems.`);
    };
    root.hidden = true;
    stripPaint.set(root, paint);
    onHealth(paint);
    paint();
    if (getRuns().project !== ctx.project() || getRuns().automations === null) loadRuns(ctx.project());
  },
  update(root, ctx) {
    stripPaint.get(root)?.();
    if (getRuns().project !== ctx.project()) loadRuns(ctx.project());
  },
});

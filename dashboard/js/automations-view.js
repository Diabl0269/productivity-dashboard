// automations-view.js — "Automations" tab: every macOS LaunchAgent (OpenCode, Copilot, Claude, Codex, Gemini, other).
// Data: GET /api/automations (server/automations-routes.js). Editor: automations-editor.js.

import { buildEditor } from './automations-editor.js';
import { showStatus } from './state.js';

const TOOL_LABEL = { opencode: 'OpenCode', copilot: 'Copilot', claude: 'Claude', codex: 'Codex', gemini: 'Gemini', other: 'Other' };
const POLL_INTERVAL_MS = 2000;
const START_GRACE_MS = 5000;
const state = {
  list: [], selected: null, built: false, root: null, error: null,
  editor: null, log: null, capabilities: { harnesses: [] }, runs: [],
  editorKey: null, selectedSession: null,
  starting: new Map(), // label -> { at, prevStartedAt, sawRunning }
  wasRunning: new Set(),
  pollTimer: null,
};

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

async function api(method, path, body) {
  const r = await fetch(`/api/automations${path}`, {
    method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function runHarnessLabel(run, fallbackTool = null) {
  const h = run?.harness || (String(run?.sessionID || '').startsWith('ses_') ? 'opencode' : fallbackTool);
  if (!h) return '';
  const label = TOOL_LABEL[h] || h;
  return run?.model ? `${label} (${run.model})` : label;
}

function formatRunOption(run, fallbackTool = null) {
  const when = run.startedAt ? new Date(run.startedAt).toLocaleString() : 'Unknown date';
  const hm = runHarnessLabel(run, fallbackTool);
  const exit = run.exitCode ? `exit ${run.exitCode}${run.error ? ` (${run.error})` : ''}` : 'success';
  return `${when}${hm ? ` · ${hm}` : ''} · ${exit} · ${run.sessionID || 'no session'}`;
}

function effectiveState(a) {
  if (a.state === 'running') return 'running';
  const st = state.starting.get(a.label);
  if (st && Date.now() - st.at < START_GRACE_MS) return 'running';
  return a.state;
}

function lastRunText(a) {
  if (effectiveState(a) === 'running') {
    const rs = a.runningSession;
    const hm = rs ? runHarnessLabel(rs, a.tool) : (TOOL_LABEL[a.tool] || a.tool);
    const sec = rs?.startedAt ? Math.max(0, Math.round((Date.now() - Date.parse(rs.startedAt)) / 1000)) : null;
    return `Running now${hm ? ` · ${hm}` : ''}${Number.isFinite(sec) ? ` (${sec}s)` : '…'}`;
  }
  const s = a.lastSession || a.recentRuns?.[0];
  if (!s?.startedAt) return a.lastExit != null && a.lastExit !== 0 ? `exit ${a.lastExit}` : '—';
  const d = new Date(s.startedAt);
  const hm = runHarnessLabel(s, a.tool);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}${hm ? ` · ${hm}` : ''}${s.exitCode ? ` · exit ${s.exitCode}` : ''}`;
}

function renderTable() {
  const table = el('table', 'mc-table au-table');
  const head = el('tr');
  for (const h of ['Label', 'Tool', 'Schedule', 'State', 'Last run']) head.appendChild(el('th', null, h));
  table.appendChild(el('thead')).appendChild(head);
  const body = el('tbody');
  for (const a of state.list) {
    const tr = el('tr', a.label === state.selected ? 'au-row au-row-active' : 'au-row');
    tr.tabIndex = 0;
    tr.appendChild(el('td', null, a.label));
    const tool = el('td'); tool.appendChild(el('span', `au-badge au-tool-${a.tool}`, TOOL_LABEL[a.tool] || a.tool)); tr.appendChild(tool);
    tr.appendChild(el('td', null, a.scheduleText));
    const eff = effectiveState(a);
    const st = el('td'); st.appendChild(el('span', `au-state au-state-${eff.replace(' ', '-')}`, eff)); tr.appendChild(st);
    tr.appendChild(el('td', null, lastRunText(a)));
    const open = () => { state.selected = a.label; state.selectedSession = null; state.log = null; state.runs = []; state.editor = null; state.editorKey = null; render(); loadRuns(a); };
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    body.appendChild(tr);
  }
  table.appendChild(body);
  return table;
}

async function act(label, fn, okMsg) {
  try { const out = await fn(); showStatus(okMsg || 'Done'); await load(); return out; }
  catch (e) { showStatus(`Failed: ${e.message}`); return null; }
}

async function loadRuns(a, { selectLatest = false } = {}) {
  try { state.runs = (await api('GET', `/${encodeURIComponent(a.label)}/runs`)).runs || []; }
  catch { state.runs = []; }
  if (selectLatest && state.runs[0]?.sessionID) state.selectedSession = state.runs[0].sessionID;
  if (state.selected === a.label) render();
}

async function showLog(a, which) {
  try { state.log = { which, ...(await api('GET', `/${encodeURIComponent(a.label)}/log?which=${which}`)) }; }
  catch (e) { state.log = { which, text: `Could not read log: ${e.message}`, path: null }; }
  render();
}

function renderDetail(a) {
  const box = el('section', 'au-detail');
  const head = el('div', 'au-detail-head');
  head.appendChild(el('h3', 'au-title', a.label));
  head.appendChild(el('span', `au-badge au-tool-${a.tool}`, TOOL_LABEL[a.tool] || a.tool));
  box.appendChild(head);
  const lastInfo = a.lastSession?.sessionID
    ? ` · last session ${a.lastSession.sessionID}${runHarnessLabel(a.lastSession, a.tool) ? ` (${runHarnessLabel(a.lastSession, a.tool)})` : ''}`
    : '';
  box.appendChild(el('p', 'au-meta', `${a.path}${lastInfo}`));
  if (a.error) { box.appendChild(el('p', 'au-error', a.error)); return box; }

  if (!state.editor || state.editorKey !== a.label) {
    state.editor = buildEditor(a, state.capabilities);
    state.editorKey = a.label;
  }
  box.appendChild(state.editor.node);

  const isRunning = effectiveState(a) === 'running';
  const bar = el('div', 'au-actions');
  const button = (text, cls, fn, disabled = false) => { const b = el('button', `au-btn ${cls || ''}`, text); b.type = 'button'; b.disabled = disabled; b.addEventListener('click', fn); bar.appendChild(b); return b; };
  const L = encodeURIComponent(a.label);
  button('Save', 'au-btn-primary', () => act(a.label, () => api('PUT', `/${L}`, state.editor.collect()), 'Saved and reloaded').then(out => { if (out) { state.editor = null; state.editorKey = null; render(); } }));
  button(isRunning ? 'Running…' : 'Run now', isRunning ? 'au-btn-running' : '', async () => {
    state.starting.set(a.label, { at: Date.now(), prevStartedAt: a.lastSession?.startedAt || null, sawRunning: false });
    render();
    const out = await act(a.label, () => api('POST', `/${L}/run`), `Running ${a.label}…`);
    if (!out) { state.starting.delete(a.label); render(); }
    else syncPolling();
  }, isRunning);
  button(a.state === 'disabled' ? 'Enable' : 'Disable', '', () => act(a.label, () => api('POST', `/${L}/toggle`, { enabled: a.state === 'disabled' }), a.state === 'disabled' ? 'Enabled' : 'Disabled'));
  button('View log', '', () => showLog(a, 'stdout'));
  const session = el('select', 'au-input au-session');
  const fallback = a.lastSession ? [{ ...a.lastSession }] : [];
  const runs = state.runs.length ? state.runs : fallback;
  const defaultOpenable = state.selectedSession || runs.find(r => r.sessionID)?.sessionID || '';
  if (!runs.length) { const option = el('option', null, 'No recorded sessions'); option.value = ''; session.appendChild(option); session.disabled = true; }
  for (const run of runs) {
    const option = el('option', null, formatRunOption(run, a.tool));
    option.value = run.sessionID || '';
    option.dataset.harness = run.harness || (String(run.sessionID || '').startsWith('ses_') ? 'opencode' : a.tool);
    if (defaultOpenable && run.sessionID === defaultOpenable) option.selected = true;
    session.appendChild(option);
  }
  const openBtn = button('Open session', '', async () => { const r = await act(a.label, () => api('POST', `/${L}/open-session`, { sessionID: session.value }), 'Opened'); if (r?.note) showStatus(r.note); }, !session.value);
  const termBtn = el('button', 'au-btn', 'Open in Terminal');
  termBtn.type = 'button';
  const syncTermBtn = () => {
    state.selectedSession = session.value || null;
    openBtn.disabled = !session.value;
    const h = session.selectedOptions?.[0]?.dataset?.harness || a.tool;
    termBtn.hidden = !session.value || !(h === 'opencode' || h === 'copilot');
  };
  termBtn.addEventListener('click', async () => { const r = await act(a.label, () => api('POST', `/${L}/open-session`, { sessionID: session.value, mode: 'terminal' }), 'Opened in Terminal'); if (r?.note) showStatus(r.note); });
  session.addEventListener('change', syncTermBtn);
  syncTermBtn();
  bar.appendChild(termBtn);
  button('Delete', 'au-btn-danger', () => { if (confirm(`Delete ${a.label}? This removes its plist.`)) { state.selected = null; act(a.label, () => api('DELETE', `/${L}`), 'Deleted'); } });
  const history = el('div', 'au-history');
  const refreshRuns = el('button', 'au-btn', '↻');
  refreshRuns.type = 'button';
  refreshRuns.title = 'Refresh previous runs';
  refreshRuns.addEventListener('click', () => loadRuns(a));
  history.append(el('span', 'au-label', 'Previous runs'), session, refreshRuns);
  box.append(bar, history);

  if (state.log) {
    const log = el('div', 'au-log');
    log.appendChild(el('div', 'au-meta', state.log.path || 'No log path configured'));
    log.appendChild(el('pre', 'au-log-text', state.log.text || '(empty)'));
    box.appendChild(log);
  }
  return box;
}

function render() {
  const root = state.root;
  root.replaceChildren();
  const bar = el('div', 'au-toolbar');
  bar.appendChild(el('h2', 'au-heading', 'Automations'));
  const refresh = el('button', 'au-btn', 'Refresh');
  refresh.type = 'button';
  refresh.addEventListener('click', () => { state.editor = null; state.editorKey = null; load(); });
  bar.appendChild(refresh);
  root.appendChild(bar);
  if (state.error) { root.appendChild(el('p', 'au-error', state.error)); return; }
  if (!state.list.length) { root.appendChild(el('p', 'au-meta', 'No LaunchAgents found.')); return; }
  root.appendChild(renderTable());
  const sel = state.list.find(a => a.label === state.selected);
  if (sel) root.appendChild(renderDetail(sel));
}

function syncPolling() {
  const anyActive = state.list.some(a => effectiveState(a) === 'running');
  if (!anyActive) {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
    return;
  }
  if (state.pollTimer) return;
  state.pollTimer = setInterval(async () => {
    if (!document.getElementById('automationsMain')?.offsetParent && state.starting.size === 0) {
      clearInterval(state.pollTimer); state.pollTimer = null; return;
    }
    await load({ poll: true });
  }, POLL_INTERVAL_MS);
}

async function load({ poll = false } = {}) {
  const finishedLabels = [];
  try {
    const [list, capabilities] = await Promise.all([
      api('GET', ''),
      poll && state.capabilities.harnesses.length ? Promise.resolve(state.capabilities) : api('GET', '/capabilities'),
    ]);
    const nextList = list.automations || [];
    for (const a of nextList) {
      const st = state.starting.get(a.label);
      if (a.state === 'running') {
        state.wasRunning.add(a.label);
        if (st) st.sawRunning = true;
      } else {
        const advanced = st && a.lastSession?.startedAt && a.lastSession.startedAt !== st.prevStartedAt;
        const graceExpired = st && Date.now() - st.at >= START_GRACE_MS;
        if (state.wasRunning.has(a.label) || advanced || (st && (st.sawRunning || graceExpired))) {
          state.wasRunning.delete(a.label);
          state.starting.delete(a.label);
          finishedLabels.push(a);
        }
      }
    }
    state.list = nextList;
    state.capabilities = capabilities;
    state.error = null;
  }
  catch (e) { state.error = `Could not load automations: ${e.message}`; }
  const selected = state.list.find(a => a.label === state.selected);
  if (poll && selected && effectiveState(selected) === 'running' && state.log) {
    try { state.log = { which: state.log.which, ...(await api('GET', `/${encodeURIComponent(selected.label)}/log?which=${state.log.which}`)) }; } catch { /* ignore */ }
  }
  render();
  if (selected && (!poll || finishedLabels.some(f => f.label === selected.label))) {
    await loadRuns(selected, { selectLatest: finishedLabels.some(f => f.label === selected.label) });
  }
  for (const done of finishedLabels) {
    const exit = done.lastSession?.exitCode ?? done.lastExit ?? 0;
    const hm = done.lastSession ? runHarnessLabel(done.lastSession, done.tool) : (TOOL_LABEL[done.tool] || done.tool);
    showStatus(exit ? `Failed ${done.label} (exit ${exit})` : `Finished ${done.label}${hm ? ` · ${hm}` : ''} — ready to open`);
  }
  syncPolling();
}

export function onAutomationsTabShow() {
  const root = document.getElementById('automationsMain');
  if (!root) return;
  state.root = root;
  if (!state.built) { state.built = true; render(); }
  load();
}

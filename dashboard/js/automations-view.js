// automations-view.js — "Automations" tab: every macOS LaunchAgent (OpenCode, Copilot, Claude, Codex, other).
// Data: GET /api/automations (server/automations-routes.js). Editor: automations-editor.js.

import { buildEditor } from './automations-editor.js';
import { showStatus } from './state.js';

const TOOL_LABEL = { opencode: 'OpenCode', copilot: 'Copilot', claude: 'Claude', codex: 'Codex', other: 'Other' };
const state = { list: [], selected: null, built: false, root: null, error: null, editor: null, log: null, capabilities: { harnesses: [] }, runs: [], editorKey: null, editorDirty: false };

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

function lastRunText(a) {
  const s = a.lastSession;
  if (!s?.startedAt) return a.lastExit != null && a.lastExit !== 0 ? `exit ${a.lastExit}` : '—';
  const d = new Date(s.startedAt);
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}${s.exitCode ? ` · exit ${s.exitCode}` : ''}`;
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
    const st = el('td'); st.appendChild(el('span', `au-state au-state-${a.state.replace(' ', '-')}`, a.state)); tr.appendChild(st);
    tr.appendChild(el('td', null, lastRunText(a)));
    const open = () => { state.selected = a.label; state.log = null; state.runs = []; state.editor = null; state.editorDirty = false; state.editorKey = null; render(); loadRuns(a); };
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

async function loadRuns(a) {
  try { state.runs = (await api('GET', `/${encodeURIComponent(a.label)}/runs`)).runs || []; }
  catch { state.runs = []; }
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
  box.appendChild(el('p', 'au-meta', `${a.path}${a.lastSession?.sessionID ? ` · last session ${a.lastSession.sessionID}` : ''}`));
  if (a.error) { box.appendChild(el('p', 'au-error', a.error)); return box; }

  if (!state.editor || state.editorKey !== a.label || !state.editorDirty) state.editor = buildEditor(a, state.capabilities);
  state.editorKey = a.label;
  state.editor.node.addEventListener('change', () => { state.editorDirty = true; }, { capture: true });
  box.appendChild(state.editor.node);

  const bar = el('div', 'au-actions');
  const button = (text, cls, fn) => { const b = el('button', `au-btn ${cls || ''}`, text); b.type = 'button'; b.addEventListener('click', fn); bar.appendChild(b); };
  const L = encodeURIComponent(a.label);
  button('Save', 'au-btn-primary', () => act(a.label, () => api('PUT', `/${L}`, state.editor.collect()), 'Saved and reloaded').then(out => { if (out) { state.editor = null; state.editorDirty = false; state.editorKey = null; render(); } }));
  button('Run now', '', () => act(a.label, () => api('POST', `/${L}/run`), 'Started'));
  button(a.state === 'disabled' ? 'Enable' : 'Disable', '', () => act(a.label, () => api('POST', `/${L}/toggle`, { enabled: a.state === 'disabled' }), a.state === 'disabled' ? 'Enabled' : 'Disabled'));
  button('View log', '', () => showLog(a, 'stdout'));
  const session = el('select', 'au-input au-session');
  const fallback = a.lastSession?.sessionID ? [{ ...a.lastSession }] : [];
  const runs = state.runs.length ? state.runs : fallback;
  if (!runs.length) { const option = el('option', null, 'No recorded sessions'); option.value = ''; session.appendChild(option); session.disabled = true; }
  for (const run of runs) {
    const when = run.startedAt ? new Date(run.startedAt).toLocaleString() : 'Unknown date';
    const option = el('option', null, `${when} · ${run.exitCode ? `exit ${run.exitCode}` : 'success'} · ${run.sessionID}`);
    option.value = run.sessionID; session.appendChild(option);
  }
  button('Open session', '', async () => { const r = await act(a.label, () => api('POST', `/${L}/open-session`, { sessionID: session.value }), 'Opened'); if (r?.note) showStatus(r.note); });
  button('Delete', 'au-btn-danger', () => { if (confirm(`Delete ${a.label}? This removes its plist.`)) { state.selected = null; act(a.label, () => api('DELETE', `/${L}`), 'Deleted'); } });
  const history = el('div', 'au-history');
  history.append(el('span', 'au-label', 'Previous runs'), session);
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
  const refresh = el('button', 'au-btn', 'Refresh'); refresh.type = 'button'; refresh.addEventListener('click', load);
  bar.appendChild(refresh);
  root.appendChild(bar);
  if (state.error) { root.appendChild(el('p', 'au-error', state.error)); return; }
  if (!state.list.length) { root.appendChild(el('p', 'au-meta', 'No LaunchAgents found.')); return; }
  root.appendChild(renderTable());
  const sel = state.list.find(a => a.label === state.selected);
  if (sel) root.appendChild(renderDetail(sel));
}

async function load() {
  try {
    const [list, capabilities] = await Promise.all([api('GET', ''), api('GET', '/capabilities')]);
    state.list = list.automations; state.capabilities = capabilities; state.error = null;
  }
  catch (e) { state.error = `Could not load automations: ${e.message}`; }
  render();
  const selected = state.list.find(a => a.label === state.selected);
  if (selected) loadRuns(selected);
}

export function onAutomationsTabShow() {
  const root = document.getElementById('automationsMain');
  if (!root) return;
  state.root = root;
  if (!state.built) { state.built = true; render(); }
  load();
}

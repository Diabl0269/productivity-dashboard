/**
 * Automations API (LaunchAgents manager): /api/automations*. serve.js calls handleAutomationsRoute for
 * paths under /api/automations. Env: LAUNCH_AGENTS_DIR, AUTOMATION_LOG_DIR, LAUNCHCTL_BIN, PLUTIL_BIN.
 *   GET    /api/automations                    list every plist in the LaunchAgents dir
 *   POST   /api/automations                    create
 *   GET    /api/automations/:label             one
 *   PUT    /api/automations/:label             edit schedule / arguments / script, rewrite plist, reload
 *   DELETE /api/automations/:label             bootout + remove plist
 *   POST   /api/automations/:label/run|toggle|open-session
 *   GET    /api/automations/:label/log?which=stdout|stderr   log tail
 */
import * as svc from './automations/service.js';
import { automationCapabilities } from './automations/capabilities.js';
import { openSession, launchAgentSession } from './automations/open-session.js';
import { automationRuns } from './automations/history.js';
import { TERMINALS, readTerminalSetting, writeTerminalSetting } from './automations/terminal-settings.js';
import { clearStatusCache } from './home/status-cache.js';

const BASE = '/api/automations';
const clearHome = p => Promise.resolve(p).then(out => { clearStatusCache(); return out; });

function route(method, rest, body, url, deps) {
  const dataRoot = deps?.dataRoot || process.env.CH_HOME || process.cwd();
  const [label, action] = rest.split('/').filter(Boolean).map(decodeURIComponent);
  if (method === 'GET' && label === 'capabilities' && !action) return automationCapabilities({ force: url.searchParams.has('refresh') });
  if (label === 'settings' && !action) {
    if (method === 'GET') return Promise.resolve({ terminalApp: readTerminalSetting(dataRoot), terminals: TERMINALS });
    if (method === 'PUT') return Promise.resolve({ terminalApp: writeTerminalSetting(dataRoot, body?.terminalApp), terminals: TERMINALS });
    return null;
  }
  if (method === 'POST' && label === 'launch' && !action) return launchAgentSession(body, { dataRoot });
  if (!label) {
    if (method === 'GET') return svc.listAutomations().then(automations => ({ automations }));
    if (method === 'POST') return clearHome(svc.createAutomation(body));
    return null;
  }
  if (!action) {
    if (method === 'GET') return svc.getAutomation(label).then(automation => ({ automation }));
    if (method === 'PUT') return clearHome(svc.updateAutomation(label, body));
    if (method === 'DELETE') return clearHome(svc.deleteAutomation(label));
    return null;
  }
  if (method === 'GET' && action === 'log') return svc.tailLog(label, url.searchParams.get('which') || 'stdout');
  if (method === 'GET' && action === 'runs') return automationRuns(label, { cwd: process.cwd() }).then(runs => ({ runs }));
  if (method !== 'POST') return null;
  if (action === 'run') return clearHome(svc.runAutomation(label));
  if (action === 'toggle') return clearHome(svc.toggleAutomation(label, body?.enabled));
  if (action === 'open-session') return openSession(label, body?.sessionID || null, { mode: body?.mode || null, terminal: body?.terminal || null, dataRoot });
  return null;
}

/** @returns {boolean} true when the request was answered */
export function handleAutomationsRoute(req, res, url, deps) {
  if (url.pathname !== BASE && !url.pathname.startsWith(`${BASE}/`)) return false;
  const send = (status, body) => {
    res.writeHead(status, { ...(deps.corsHeaders || {}), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  };
  // These routes can run code as the user: refuse cross-origin pages and DNS-rebinding hosts.
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) { send(403, { error: 'Local access only' }); return true; }
  const origin = req.headers.origin;
  if (origin && origin !== 'null' ? new URL(origin).host !== req.headers.host : origin === 'null') { send(403, { error: 'Cross-origin request refused' }); return true; }
  Promise.resolve().then(async () => {
    const hasBody = req.method === 'POST' || req.method === 'PUT';
    const raw = hasBody ? await deps.readBody(req) : '';
    let body = {};
    if (raw) { try { body = JSON.parse(raw); } catch { return send(400, { error: 'Body must be JSON' }); } }
    const out = route(req.method, url.pathname.slice(BASE.length), body, url, deps);
    if (!out) return send(405, { error: `${req.method} is not allowed on ${url.pathname}` });
    send(200, await out);
  }).catch(e => send(e.status || 500, { error: e.message }));
  return true;
}

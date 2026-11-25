import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { automationId, readRecordedRuns } from './model.js';
import { getAutomation } from './service.js';
import { run } from './exec.js';
import { inferRunHarness } from '../../shared/harnesses.js';

const ID_RE = /^[A-Za-z0-9_.-]+$/;
const OPENCODE = '/Applications/OpenCode.app/Contents/Resources/opencode-cli';

function readGeminiTranscriptModel(sessionID) {
  if (!sessionID || sessionID.startsWith('ses_')) return '';
  const brainDir = process.env.CH_GEMINI_BRAIN_DIR || path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
  const file = path.join(brainDir, sessionID, '.system_generated', 'logs', 'transcript.jsonl');
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(64 * 1024);
      const n = fs.readSync(fd, buf, 0, buf.length, 0);
      const text = buf.subarray(0, n).toString('utf8');
      for (const line of text.split('\n')) {
        if (!line.includes('"PLANNER_RESPONSE"')) continue;
        const parsed = JSON.parse(line);
        if (parsed?.model) return String(parsed.model);
      }
    } finally { fs.closeSync(fd); }
  } catch { /* transcript not found */ }
  return '';
}

function parseOpencodeModelField(raw) {
  if (!raw) return '';
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (parsed?.providerID && parsed?.id) return `${parsed.providerID}/${parsed.id}`;
      if (parsed?.id) return String(parsed.id);
    } catch { return raw; }
  }
  return '';
}

async function readOpencodeDbSessions(id) {
  if (process.env.AUTOMATION_LOG_DIR && !process.env.OPENCODE_DB_PATH) return null;
  const db = process.env.OPENCODE_DB_PATH || path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db');
  if (!fs.existsSync(db)) return null;
  const safe = id.replaceAll("'", "''");
  const sql = `SELECT id, title, model, time_created, time_updated FROM session_v2 WHERE title = '${safe}' OR title LIKE '${safe} %' OR title LIKE '%"${safe}" automation%' ORDER BY time_created DESC LIMIT 200;`;
  const res = await run('sqlite3', ['-readonly', '-json', db, sql]);
  if (res.code !== 0 || !res.stdout.trim()) return null;
  try {
    const rows = JSON.parse(res.stdout);
    return (Array.isArray(rows) ? rows : []).map(r => ({
      sessionID: r.id,
      startedAt: new Date(Number(r.time_created)).toISOString(),
      finishedAt: new Date(Number(r.time_updated)).toISOString(),
      title: r.title,
      harness: 'opencode',
      model: parseOpencodeModelField(r.model),
      source: 'opencode',
    }));
  } catch { return null; }
}

export function recordedRuns(label, env = {}) {
  return readRecordedRuns(label, env).map(r => {
    const harness = inferRunHarness(r);
    const model = r.model || (harness === 'gemini' ? readGeminiTranscriptModel(r.sessionID) : '');
    return { ...r, ...(harness ? { harness } : {}), ...(model ? { model } : {}) };
  });
}

/**
 * Merge durable run records (<id>.runs.jsonl + <id>.last.json) with historical OpenCode sessions so switching
 * harnesses (e.g. OpenCode -> Gemini) keeps all previous runs and reports each run's exact harness and model.
 */
export async function automationRuns(label, { cli, cwd = process.cwd() } = {}) {
  let meta = null;
  try { meta = await getAutomation(label); } catch { /* allow direct unit calls without a plist */ }
  const id = automationId(label);
  const env = meta?.environment || {};
  const known = recordedRuns(label, env);
  const workDir = meta?.workingDirectory && fs.existsSync(meta.workingDirectory) ? meta.workingDirectory : cwd;

  // Always include past OpenCode sessions for this automation id, even after switching harness to Gemini/Claude/etc.
  let legacy = await readOpencodeDbSessions(id);
  if (!legacy) {
    const defaultOc = process.env.AUTOMATION_LOG_DIR ? null : OPENCODE;
    const ocCli = cli || env.OPENCODE_CLI || process.env.OPENCODE_CLI || defaultOc;
    const result = ocCli && fs.existsSync(ocCli)
      ? await run(ocCli, ['session', 'list', '--format', 'json', '-n', '500'], { cwd: workDir })
      : { code: 1, stdout: '[]' };
    legacy = [];
    if (result.code === 0) {
      try {
        const sessions = JSON.parse(result.stdout);
        legacy = (Array.isArray(sessions) ? sessions : []).filter(session => {
          const title = String(session?.title || '');
          return title === id || title.startsWith(`${id} `) || title.includes(`"${id}" automation`);
        }).map(session => ({
          sessionID: session.id,
          startedAt: new Date(session.created).toISOString(),
          finishedAt: new Date(session.updated).toISOString(),
          title: session.title,
          harness: 'opencode',
          model: parseOpencodeModelField(session.model),
          source: 'opencode',
        }));
      } catch { /* keep durable history */ }
    }
  }

  const byID = new Map();
  for (const entry of legacy) {
    if (ID_RE.test(entry.sessionID || '')) byID.set(entry.sessionID, entry);
  }
  for (const entry of known) {
    const hasSid = ID_RE.test(entry.sessionID || '');
    const key = hasSid ? entry.sessionID : (entry.startedAt && entry.exitCode ? `failed:${entry.startedAt}` : null);
    if (!key) continue;
    const prev = byID.get(key) || {};
    const harness = inferRunHarness(entry, prev.harness || null);
    const model = entry.model || prev.model || (hasSid && harness === 'gemini' ? readGeminiTranscriptModel(entry.sessionID) : '');
    byID.set(key, {
      ...prev,
      ...entry,
      ...(harness ? { harness } : {}),
      ...(model ? { model } : {}),
    });
  }
  return [...byID.values()].sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));
}

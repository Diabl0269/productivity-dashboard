import fs from 'node:fs';
import path from 'node:path';
import { logDir, LABEL_PREFIX } from './model.js';
import { run } from './exec.js';

const ID_RE = /^[A-Za-z0-9_.-]+$/;
const OPENCODE = '/Applications/OpenCode.app/Contents/Resources/opencode-cli';

function automationId(label) {
  return label.startsWith(LABEL_PREFIX) ? label.slice(LABEL_PREFIX.length) : label;
}

export function recordedRuns(label) {
  const file = path.join(logDir(), `${automationId(label)}.runs.jsonl`);
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(run => run && ID_RE.test(run.sessionID || ''));
  } catch { return []; }
}

/** Merge durable run records with OpenCode sessions from before run history existed. */
export async function automationRuns(label, { cli = process.env.OPENCODE_CLI || OPENCODE, cwd = process.cwd() } = {}) {
  const id = automationId(label);
  const known = recordedRuns(label);
  const result = fs.existsSync(cli) ? await run(cli, ['session', 'list', '--format', 'json', '-n', '500'], { cwd }) : { code: 1, stdout: '[]' };
  let sessions = [];
  if (result.code === 0) {
    try { sessions = JSON.parse(result.stdout); } catch { /* keep durable history */ }
  }
  const legacy = sessions.filter(session => {
    const title = String(session.title || '');
    return title === id || title.startsWith(`${id} `) || title.includes(`"${id}" automation`);
  }).map(session => ({
    sessionID: session.id,
    startedAt: new Date(session.created).toISOString(),
    finishedAt: new Date(session.updated).toISOString(),
    title: session.title,
    source: 'opencode',
  }));
  const byID = new Map();
  for (const entry of [...legacy, ...known]) if (ID_RE.test(entry.sessionID || '')) byID.set(entry.sessionID, entry);
  return [...byID.values()].sort((a, b) => Date.parse(b.startedAt || 0) - Date.parse(a.startedAt || 0));
}

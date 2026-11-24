import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';

const OPENCODE = '/Applications/OpenCode.app/Contents/Resources/opencode-cli';
const DEFAULT_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const GEMINI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
let cached;
let cacheAt = 0;

function isWrapperDir(dir) {
  return dir.includes('.cmuxterm/cmux-cli-shims') || dir.startsWith('/Applications/cmux.app/');
}

function searchDirs() {
  const home = os.homedir();
  const pathDirs = (process.env.PATH || '').split(':').filter(d => d && !isWrapperDir(d));
  // Keep PATH entries first when custom test bins are prepended, while preferring ~/.local/bin over system dirs.
  return [...new Set([
    ...pathDirs,
    path.join(home, '.local', 'bin'),
    path.join(home, '.gemini', 'antigravity-cli', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
  ])];
}

export function executable(name, envKeys = [`${name.toUpperCase()}_CLI`]) {
  for (const key of envKeys) {
    if (process.env[key] && fs.existsSync(process.env[key])) return process.env[key];
  }
  const candidates = searchDirs().map(dir => path.join(dir, name));
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function lines(stdout) {
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function parseModelIds(raw) {
  return [...new Set(lines(raw).filter(line => line.includes('/')))];
}

function parseAgyJsonList(raw, key) {
  try {
    const parsed = JSON.parse(raw);
    const items = parsed?.command?.data?.[key];
    if (Array.isArray(items)) {
      return items.map(item => (typeof item === 'string' ? item : item?.id || item?.name)).filter(Boolean);
    }
  } catch { /* fall back to line parsing */ }
  return lines(raw)
    .map(line => line.split(/\s+/)[0])
    .filter(token => token && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token));
}

async function opencodeCapabilities() {
  const cli = process.env.OPENCODE_CLI || executable('opencode', []) || (fs.existsSync(OPENCODE) ? OPENCODE : null);
  if (!cli) return null;
  const result = await run(cli, ['models']);
  const models = result.code === 0 ? parseModelIds(result.stdout) : [];
  return {
    id: 'opencode', label: 'OpenCode', cli, models,
    agents: [], efforts: DEFAULT_EFFORTS,
  };
}

async function geminiCapabilities() {
  const cli = executable('agy', ['GEMINI_CLI', 'AGY_CLI']);
  if (!cli) return null;
  const [modelsRes, agentsRes] = await Promise.all([
    run(cli, ['--output-format', 'json', 'models']),
    run(cli, ['--output-format', 'json', 'agents']),
  ]);
  const models = modelsRes.code === 0 ? parseAgyJsonList(modelsRes.stdout, 'models') : [];
  const agents = agentsRes.code === 0 ? parseAgyJsonList(agentsRes.stdout, 'agents') : [];
  return {
    id: 'gemini', label: 'Gemini (Antigravity)', cli,
    models, agents, efforts: GEMINI_EFFORTS,
  };
}

async function claudeCapabilities() {
  const cli = executable('claude');
  if (!cli) return null;
  return {
    id: 'claude', label: 'Claude Code', cli,
    models: ['auto', 'haiku', 'sonnet', 'opus', 'fable'], agents: [], efforts: DEFAULT_EFFORTS,
  };
}

async function codexCapabilities() {
  const cli = executable('codex');
  if (!cli) return null;
  return {
    id: 'codex', label: 'Codex', cli,
    models: ['gpt-5.1-codex', 'o3', 'o4-mini'], agents: [], efforts: DEFAULT_EFFORTS,
  };
}

async function copilotCapabilities() {
  const cli = executable('copilot');
  if (!cli) return null;
  return {
    id: 'copilot', label: 'GitHub Copilot', cli,
    models: ['auto', 'gpt-4.1', 'claude-sonnet-4'], agents: [], efforts: GEMINI_EFFORTS,
  };
}

export function clearCapabilitiesCache() {
  cached = undefined;
  cacheAt = 0;
}

/** Live, user-specific harness/model capabilities. Cached briefly to avoid repeated CLI starts. */
export async function automationCapabilities({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached && now - cacheAt < 60_000) return cached;
  const found = (await Promise.all([
    geminiCapabilities(),
    opencodeCapabilities(),
    claudeCapabilities(),
    codexCapabilities(),
    copilotCapabilities(),
  ])).filter(Boolean);
  cached = {
    harnesses: found.map(({ id, label, cli, models, agents, efforts }) => ({ id, label, cli, models, agents, efforts })),
    checkedAt: new Date(now).toISOString(),
  };
  cacheAt = now;
  return cached;
}

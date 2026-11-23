import fs from 'node:fs';
import path from 'node:path';
import { run } from './exec.js';

const OPENCODE = '/Applications/OpenCode.app/Contents/Resources/opencode-cli';
const DEFAULT_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
let cached;
let cacheAt = 0;

function executable(name) {
  const candidates = process.env[`${name.toUpperCase()}_CLI`]
    ? [process.env[`${name.toUpperCase()}_CLI`]]
    : (process.env.PATH || '').split(':').map(dir => path.join(dir, name));
  return candidates.find(candidate => candidate && fs.existsSync(candidate)) || null;
}

function lines(stdout) {
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function parseModelIds(raw) {
  return [...new Set(lines(raw).filter(line => line.includes('/')))];
}

async function opencodeCapabilities() {
  const cli = process.env.OPENCODE_CLI || OPENCODE;
  if (!fs.existsSync(cli)) return null;
  const result = await run(cli, ['models']);
  const models = result.code === 0 ? parseModelIds(result.stdout) : [];
  return {
    id: 'opencode', label: 'OpenCode', cli, models,
    agents: [], efforts: DEFAULT_EFFORTS,
    modelValue: model => model,
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

async function copilotCapabilities() {
  const cli = executable('copilot');
  if (!cli) return null;
  return {
    id: 'copilot', label: 'GitHub Copilot', cli,
    models: ['auto'], agents: [], efforts: [],
  };
}

/** Live, user-specific harness/model capabilities. Cached briefly to avoid repeated CLI starts. */
export async function automationCapabilities({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached && now - cacheAt < 60_000) return cached;
  const found = (await Promise.all([opencodeCapabilities(), claudeCapabilities(), copilotCapabilities()])).filter(Boolean);
  cached = {
    harnesses: found.map(({ id, label, cli, models, agents, efforts }) => ({ id, label, cli, models, agents, efforts })),
    checkedAt: new Date(now).toISOString(),
  };
  cacheAt = now;
  return cached;
}

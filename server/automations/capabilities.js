import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from './exec.js';
import { HARNESS_SPECS, harnessEnvKeys } from '../../shared/harnesses.js';

let cached;
let cacheAt = 0;

function isWrapperDir(dir) {
  return dir.includes('.cmuxterm/cmux-cli-shims') || dir.startsWith('/Applications/cmux.app/');
}

function searchDirs() {
  const home = os.homedir();
  const pathDirs = (process.env.PATH || '').split(':').filter(d => d && !isWrapperDir(d));
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

function parseProbeOutput(raw, parser, key) {
  if (parser === 'slash-lines') {
    return [...new Set(lines(raw).filter(line => line.includes('/')))];
  }
  if (parser === 'json-command') {
    try {
      const parsed = JSON.parse(raw);
      const items = parsed?.command?.data?.[key];
      if (Array.isArray(items)) {
        return items.map(item => (typeof item === 'string' ? item : item?.id || item?.name)).filter(Boolean);
      }
    } catch { /* fall back to token lines */ }
    return lines(raw)
      .map(line => line.split(/\s+/)[0])
      .filter(token => token && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(token));
  }
  return [];
}

function resolveHarnessCli(spec) {
  const keys = harnessEnvKeys(spec.id);
  const envList = [keys.cli, ...keys.extraCli];
  for (const bin of spec.binaries) {
    const found = executable(bin, envList);
    if (found) return found;
  }
  if (spec.fallbackCli && fs.existsSync(spec.fallbackCli)) return spec.fallbackCli;
  return null;
}

async function probeHarness(spec) {
  if (!spec.probe) return null;
  const cli = resolveHarnessCli(spec);
  if (!cli) return null;
  const { probe } = spec;
  const [modelsRes, agentsRes] = await Promise.all([
    probe.modelsArgs ? run(cli, probe.modelsArgs) : Promise.resolve(null),
    probe.agentsArgs ? run(cli, probe.agentsArgs) : Promise.resolve(null),
  ]);
  const models = modelsRes
    ? (modelsRes.code === 0 ? parseProbeOutput(modelsRes.stdout, probe.modelsParser, probe.modelsKey) : [])
    : [...(probe.staticModels || [])];
  const agents = agentsRes && agentsRes.code === 0
    ? parseProbeOutput(agentsRes.stdout, probe.agentsParser, probe.agentsKey)
    : [];
  return {
    id: spec.id,
    label: spec.label,
    cli,
    models,
    agents,
    efforts: [...spec.efforts],
  };
}

export function clearCapabilitiesCache() {
  cached = undefined;
  cacheAt = 0;
}

/** Live, user-specific harness/model capabilities driven declaratively by shared/harnesses.js. */
export async function automationCapabilities({ force = false } = {}) {
  const now = Date.now();
  if (!force && cached && now - cacheAt < 60_000) return cached;
  const found = (await Promise.all(HARNESS_SPECS.map(probeHarness))).filter(Boolean);
  cached = {
    harnesses: found,
    checkedAt: new Date(now).toISOString(),
  };
  cacheAt = now;
  return cached;
}

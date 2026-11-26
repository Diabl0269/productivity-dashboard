/**
 * Declarative registry of coding-agent CLI harnesses (pure ES module: no fs, no child_process, no DOM).
 * Shared across server/, cli/, scripts/launchagents/, and dashboard/js/ so adding or tuning a harness
 * happens in one place instead of per-harness switch/case blocks.
 */

export const DEFAULT_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh']);
export const EXTENDED_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);

export const HARNESS_SPECS = Object.freeze([
  {
    id: 'opencode',
    label: 'OpenCode',
    shortLabel: 'OpenCode',
    aliases: [],
    binaries: ['opencode', 'opencode-cli'],
    defaultCli: '/Applications/OpenCode.app/Contents/Resources/opencode-cli',
    fallbackCli: '/Applications/OpenCode.app/Contents/Resources/opencode-cli',
    defaultModel: 'github-copilot/mai-code-2',
    envPrefix: 'OPENCODE',
    extraCliEnv: [],
    efforts: DEFAULT_EFFORTS,
    sessionIdPrefix: 'ses_',
    desktopApp: { name: 'OpenCode', app: '/Applications/OpenCode.app', passCwd: true },
    run: { baseArgs: ['run', '--auto', '--format', 'json'], modelFlag: '--model', effortFlag: '', agentFlag: '--agent', promptFlag: '', titleFlag: '--title' },
    resumeArgs: id => ['-s', id],
    interactiveArgs: prompt => ['run', prompt],
    probe: { modelsArgs: ['models'], modelsParser: 'slash-lines', staticModels: [] },
  },
  {
    id: 'claude',
    label: 'Claude Code',
    shortLabel: 'Claude',
    aliases: [],
    binaries: ['claude'],
    defaultCli: 'claude',
    defaultModel: 'sonnet',
    envPrefix: 'CLAUDE',
    extraCliEnv: [],
    efforts: DEFAULT_EFFORTS,
    sessionIdPrefix: null,
    desktopApp: null,
    run: { baseArgs: ['-p', '--output-format', 'json'], modelFlag: '--model', effortFlag: '--effort', agentFlag: '--agent', promptFlag: '', titleFlag: '' },
    resumeArgs: id => ['--resume', id],
    interactiveArgs: prompt => [prompt],
    probe: { staticModels: ['auto', 'haiku', 'sonnet', 'opus', 'fable'] },
  },
  {
    id: 'codex',
    label: 'Codex',
    shortLabel: 'Codex',
    aliases: [],
    binaries: ['codex'],
    defaultCli: 'codex',
    defaultModel: 'gpt-5.1-codex',
    envPrefix: 'CODEX',
    extraCliEnv: [],
    efforts: DEFAULT_EFFORTS,
    sessionIdPrefix: null,
    desktopApp: null,
    run: { baseArgs: ['exec', '--json'], modelFlag: '--model', effortFlag: '', agentFlag: '', promptFlag: '', titleFlag: '' },
    resumeArgs: id => ['resume', id],
    interactiveArgs: prompt => [prompt],
    probe: { staticModels: ['gpt-5.1-codex', 'o3', 'o4-mini'] },
  },
  {
    id: 'copilot',
    label: 'GitHub Copilot',
    shortLabel: 'Copilot',
    aliases: [],
    binaries: ['copilot'],
    defaultCli: 'copilot',
    defaultModel: 'gpt-4.1',
    envPrefix: 'COPILOT',
    extraCliEnv: [],
    efforts: EXTENDED_EFFORTS,
    sessionIdPrefix: null,
    desktopApp: { name: 'GitHub Copilot', app: 'GitHub Copilot', checkPath: '/Applications/GitHub Copilot.app', passCwd: false },
    run: { baseArgs: ['--allow-all', '--output-format', 'json'], modelFlag: '--model', effortFlag: '--reasoning-effort', agentFlag: '--agent', promptFlag: '-p', titleFlag: '' },
    resumeArgs: id => [`--resume=${id}`],
    interactiveArgs: prompt => ['-i', prompt],
    probe: { staticModels: ['auto', 'gpt-4.1', 'claude-sonnet-4'] },
  },
  {
    id: 'gemini',
    label: 'Gemini (Antigravity)',
    shortLabel: 'Gemini',
    aliases: ['agy', 'antigravity'],
    binaries: ['agy', 'gemini', 'antigravity'],
    defaultCli: 'agy',
    defaultModel: '',
    envPrefix: 'GEMINI',
    extraCliEnv: ['AGY_CLI'],
    efforts: EXTENDED_EFFORTS,
    sessionIdPrefix: null,
    desktopApp: null,
    sessionStore: {
      rootRel: '.gemini/antigravity-cli',
      pathsRel: id => [`.gemini/antigravity-cli/conversations/${id}.db`, `.gemini/antigravity-cli/brain/${id}`],
    },
    run: { baseArgs: ['--output-format', 'json', '--dangerously-skip-permissions'], modelFlag: '--model', effortFlag: '--effort', agentFlag: '--agent', promptFlag: '-p', titleFlag: '' },
    resumeArgs: id => [`--conversation=${id}`],
    interactiveArgs: prompt => ['-i', prompt],
    probe: {
      modelsArgs: ['--output-format', 'json', 'models'],
      modelsParser: 'json-command',
      modelsKey: 'models',
      agentsArgs: ['--output-format', 'json', 'agents'],
      agentsParser: 'json-command',
      agentsKey: 'agents',
      staticModels: [],
    },
  },
  {
    id: 'custom',
    label: 'Custom',
    shortLabel: 'Custom',
    aliases: [],
    binaries: [],
    defaultCli: '',
    defaultModel: '',
    envPrefix: 'AUTOMATION',
    extraCliEnv: [],
    efforts: EXTENDED_EFFORTS,
    sessionIdPrefix: null,
    desktopApp: null,
    resumeArgs: null,
    interactiveArgs: null,
    probe: null,
  },
]);

const BY_ID = new Map(HARNESS_SPECS.map(s => [s.id, s]));
const ALIAS_MAP = new Map();
const BINARY_MAP = new Map();
for (const spec of HARNESS_SPECS) {
  ALIAS_MAP.set(spec.id, spec.id);
  for (const alias of spec.aliases) ALIAS_MAP.set(alias, spec.id);
  for (const bin of spec.binaries) BINARY_MAP.set(bin, spec.id);
}

export const HARNESSES = Object.freeze(HARNESS_SPECS.map(s => s.id));
export const HARNESS_LABELS = Object.freeze(Object.fromEntries(HARNESS_SPECS.map(s => [s.id, s.label])));
export const HARNESS_SHORT_LABELS = Object.freeze({
  ...Object.fromEntries(HARNESS_SPECS.map(s => [s.id, s.shortLabel])),
  other: 'Other',
});
export const HARNESS_DEFAULTS = Object.freeze(
  Object.fromEntries(HARNESS_SPECS.map(s => [s.id, Object.freeze({ cli: s.defaultCli, model: s.defaultModel })])),
);

/** Resolve a harness id or alias ('agy' -> 'gemini'); '' when unknown. */
export function normalizeHarness(value) {
  const key = String(value || '').trim().toLowerCase();
  return ALIAS_MAP.get(key) || '';
}

/** Full spec object for a harness id/alias, or null. */
export function getHarnessSpec(value) {
  const id = normalizeHarness(value);
  return id ? BY_ID.get(id) || null : null;
}

/** Match an executable basename ('opencode-cli', 'agy', 'claude', ...) to a harness id, or null. */
export function harnessForBinary(basename) {
  return BINARY_MAP.get(String(basename || '').trim()) || null;
}

/** Standard per-harness environment variable names derived from envPrefix. */
export function harnessEnvKeys(value) {
  const spec = getHarnessSpec(value);
  const p = spec?.envPrefix || 'AUTOMATION';
  return {
    cli: `${p}_CLI`,
    extraCli: spec?.extraCliEnv || [],
    model: `${p}_MODEL`,
    agent: `${p}_AGENT`,
    effort: `${p}_EFFORT`,
  };
}

/** All harness-specific environment variable keys managed by the UI editor. */
export function allManagedHarnessEnvKeys() {
  const keys = new Set(['AUTOMATION_HARNESS', 'AUTOMATION_MODEL', 'AUTOMATION_AGENT', 'AUTOMATION_EFFORT']);
  for (const spec of HARNESS_SPECS) {
    if (spec.id === 'custom') continue;
    const k = harnessEnvKeys(spec.id);
    keys.add(k.model);
    keys.add(k.agent);
    keys.add(k.effort);
  }
  return keys;
}

/** Whether a harness opens in a desktop app by default (so a separate "Open in Terminal" action is useful). */
export function hasDesktopApp(value) {
  return Boolean(getHarnessSpec(value)?.desktopApp);
}

/** Infer which harness produced a run record from explicit metadata, sessionID prefix, source, or fallback. */
export function inferRunHarness(run, fallback = null) {
  const explicit = normalizeHarness(run?.harness);
  if (explicit) return explicit;
  const sid = String(run?.sessionID || '');
  if (sid) {
    const byPrefix = HARNESS_SPECS.find(s => s.sessionIdPrefix && sid.startsWith(s.sessionIdPrefix));
    if (byPrefix) return byPrefix.id;
  }
  const bySource = normalizeHarness(run?.source);
  if (bySource) return bySource;
  return normalizeHarness(fallback) || fallback || null;
}

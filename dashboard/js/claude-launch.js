// claude-launch.js — provider-aware ticket launcher for Claude Desktop and
// GitHub Copilot app sessions.
//
// Claude deep link (undocumented — read from the Claude Desktop app bundle):
//   claude://code/new?q=<prompt>&folder=<absolute path>   (folder repeatable)
// The app silently truncates q at MAX_PROMPT_CHARS and pre-fills the composer.
// Copilot uses GitHub's documented ghapp://session/new/OWNER/REPO link.

import { childTasks, normalizeTicketTypes, escapeHtml } from './ticket-types.js';

export const MAX_PROMPT_CHARS = 14336;

const TASK_TEMPLATE_KEY = 'dashboard.claudeLaunch.taskTemplate';
const EPIC_TEMPLATE_KEY = 'dashboard.claudeLaunch.epicTemplate';
const DEFAULT_FOLDER_KEY = 'dashboard.claudeLaunch.defaultFolder';
const TASK_OVERRIDES_KEY = 'dashboard.claudeLaunch.taskPrompts';
const AI_PROVIDER_KEY = 'dashboard.aiProvider';
const COPILOT_REPO_KEY = 'dashboard.copilotRepository';

export const DEFAULT_TASK_TEMPLATE = [
  'Work on {{type}} {{id}}: {{title}}',
  '',
  '{{description}}',
  '',
  'Checklist:',
  '{{subtasks}}',
  '',
  'Issue: {{issueUrl}}',
  'Jira: {{jiraKey}}',
  'Project: {{project}}',
  '',
  'Run `ch tasks get {{id}}` for the full ticket (notes, blockers, links). Start by outlining your plan.',
].join('\n');

export const DEFAULT_EPIC_TEMPLATE = [
  'Work on {{type}} {{id}}: {{title}}',
  '',
  '{{description}}',
  '',
  'Child tickets:',
  '{{children}}',
  '',
  'Issue: {{issueUrl}}',
  'Jira: {{jiraKey}}',
  'Project: {{project}}',
  '',
  'Run `ch tasks get <id>` for any ticket above for full context. Propose an order for the open children, then start with the first one.',
].join('\n');

/** Placeholders shown in Settings. Keep in sync with templateValues(). */
export const TEMPLATE_PLACEHOLDERS = [
  ['id', 'Ticket id (e.g. T12)'],
  ['title', 'Title'],
  ['type', 'Ticket type name (Task, Epic, …)'],
  ['description', 'Description'],
  ['subtasks', 'Checklist as - [ ] lines'],
  ['children', 'Child tickets with status'],
  ['priority', 'low / medium / high'],
  ['section', 'Board column'],
  ['project', 'Project name'],
  ['issueUrl', 'Issue URL'],
  ['jiraKey', 'Jira key'],
  ['labels', 'Comma-separated labels'],
  ['links', 'Links as - label: url lines'],
  ['dueDate', 'Due date'],
];

// ── prefs ────────────────────────────────────────────────────────────────

function readString(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

function writeString(key, value, fallback) {
  try {
    if (value === null || value === undefined || value === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* ignore quota / private mode */ }
}

export function readTaskTemplate() { return readString(TASK_TEMPLATE_KEY, DEFAULT_TASK_TEMPLATE); }
export function writeTaskTemplate(v) { writeString(TASK_TEMPLATE_KEY, v, DEFAULT_TASK_TEMPLATE); }
export function readEpicTemplate() { return readString(EPIC_TEMPLATE_KEY, DEFAULT_EPIC_TEMPLATE); }
export function writeEpicTemplate(v) { writeString(EPIC_TEMPLATE_KEY, v, DEFAULT_EPIC_TEMPLATE); }
export function readDefaultFolder() { return readString(DEFAULT_FOLDER_KEY, ''); }
export function writeDefaultFolder(v) { writeString(DEFAULT_FOLDER_KEY, (v || '').trim(), ''); }
export function readAiProvider() {
  return readString(AI_PROVIDER_KEY, 'claude') === 'copilot' ? 'copilot' : 'claude';
}
export function writeAiProvider(provider) {
  writeString(AI_PROVIDER_KEY, provider === 'copilot' ? 'copilot' : 'claude', 'claude');
}
export function readCopilotRepository() { return readString(COPILOT_REPO_KEY, ''); }
export function writeCopilotRepository(repo) {
  writeString(COPILOT_REPO_KEY, (repo || '').trim(), '');
}

export function isValidCopilotRepository(repo) {
  return typeof repo === 'string' && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo.trim());
}

function githubRepositoryFromUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['github.com', 'www.github.com'].includes(url.hostname)) return '';
    const [owner, repo] = url.pathname.split('/').filter(Boolean);
    const candidate = `${owner || ''}/${(repo || '').replace(/\.git$/, '')}`;
    return isValidCopilotRepository(candidate) ? candidate : '';
  } catch {
    return '';
  }
}

function readOverrides() {
  try {
    const all = JSON.parse(localStorage.getItem(TASK_OVERRIDES_KEY) || '{}');
    return all && typeof all === 'object' ? all : {};
  } catch {
    return {};
  }
}

/** Saved per-ticket prompt/folder, or null. Keyed by task id. */
export function readTaskOverride(taskId) {
  if (!taskId) return null;
  const o = readOverrides()[taskId];
  return o && typeof o.prompt === 'string' ? o : null;
}

export function writeTaskOverride(taskId, override) {
  if (!taskId) return;
  try {
    const all = readOverrides();
    if (override) all[taskId] = { prompt: override.prompt, folder: override.folder || '' };
    else delete all[taskId];
    localStorage.setItem(TASK_OVERRIDES_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

// ── prompt building ──────────────────────────────────────────────────────

function sectionNames(state) {
  const map = {};
  for (const s of state?.sections || []) map[s.id] = s.name;
  return map;
}

function findProject(state, id) {
  return (state?.meta?.projects || []).find(p => p.id === id) || null;
}

function templateValues(task, state) {
  const types = normalizeTicketTypes(state?.ticketTypes);
  const typeName = (types.find(t => t.id === task.type) || {}).name || 'Task';
  const names = sectionNames(state);
  const project = findProject(state, task.project);
  const children = childTasks(state?.tasks, task.taskId);
  return {
    id: task.taskId || '',
    title: task.title || '',
    type: typeName,
    description: (task.description || '').trim(),
    subtasks: (task.subtasks || [])
      .filter(st => (st.text || '').trim())
      .map(st => `- [${st.checked ? 'x' : ' '}] ${st.text.trim()}`)
      .join('\n'),
    children: children
      .map(c => {
        const status = c.checked ? 'done' : (names[c.section] || c.section || '');
        return `- [${c.checked ? 'x' : ' '}] ${c.taskId || ''} ${c.title || ''}${status ? ` (${status})` : ''}`.replace(/\s+\(/, ' (');
      })
      .join('\n'),
    priority: task.priority || '',
    section: names[task.section] || task.section || '',
    project: project?.name || task.project || '',
    issueUrl: task.issueUrl || '',
    jiraKey: task.jiraKey || '',
    labels: (task.labels || []).join(', '),
    links: (task.links || [])
      .filter(l => l && l.url)
      .map(l => `- ${l.label ? `${l.label}: ` : ''}${l.url}`)
      .join('\n'),
    dueDate: task.dueDate || '',
  };
}

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/**
 * Fill a template in one pass (values are never re-expanded, so a ticket
 * description containing "{{…}}" stays literal). A line whose placeholders
 * all resolved empty is dropped, so "Issue: {{issueUrl}}" disappears when the
 * ticket has no issue. A "Heading:" line directly followed by a dropped line
 * is dropped too.
 */
export function renderTemplate(template, values) {
  const out = [];
  const lines = String(template || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const keys = [...line.matchAll(PLACEHOLDER_RE)].map(m => m[1]);
    if (keys.length && keys.every(k => !values[k])) continue;
    // Label-only line ("Checklist:") whose next line is an empty placeholder line.
    const next = lines[i + 1];
    if (!keys.length && /:\s*$/.test(line) && next !== undefined) {
      const nextKeys = [...next.matchAll(PLACEHOLDER_RE)].map(m => m[1]);
      if (nextKeys.length && nextKeys.every(k => !values[k]) && next.replace(PLACEHOLDER_RE, '').trim() === '') continue;
    }
    out.push(line.replace(PLACEHOLDER_RE, (m, k) => (k in values ? values[k] : m)));
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function hasChildren(task, state) {
  return childTasks(state?.tasks, task?.taskId).length > 0;
}

export function defaultPromptFor(task, state) {
  const template = hasChildren(task, state) ? readEpicTemplate() : readTaskTemplate();
  return renderTemplate(template, templateValues(task, state));
}

/** First configured doc dir of the ticket's project (or an ancestor), else the Settings default. */
export function defaultFolderFor(task, state) {
  const seen = new Set();
  let project = findProject(state, task?.project);
  while (project && !seen.has(project.id)) {
    seen.add(project.id);
    const dir = (project.docDirs || []).find(d => isAbsolutePath(d));
    if (dir) return dir;
    project = project.parentId ? findProject(state, project.parentId) : null;
  }
  const fallback = readDefaultFolder();
  return isAbsolutePath(fallback) ? fallback : '';
}

export function isAbsolutePath(p) {
  return typeof p === 'string' && (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p));
}

/** What the main button will send right now (saved override wins). */
export function resolveLaunch(task, state) {
  const override = readTaskOverride(task?.taskId);
  const aiProvider = readAiProvider();
  if (override) {
    return {
      prompt: override.prompt,
      folder: override.folder || defaultFolderFor(task, state),
      repo: githubRepositoryFromUrl(task?.issueUrl) || readCopilotRepository(),
      aiProvider,
      custom: true,
    };
  }
  return {
    prompt: defaultPromptFor(task, state),
    folder: defaultFolderFor(task, state),
    repo: githubRepositoryFromUrl(task?.issueUrl) || readCopilotRepository(),
    aiProvider,
    custom: false,
  };
}

export function buildLaunchUrl({ prompt, folder }) {
  const params = new URLSearchParams();
  const q = (prompt || '').slice(0, MAX_PROMPT_CHARS);
  if (q) params.set('q', q);
  if (isAbsolutePath(folder)) params.set('folder', folder.trim());
  // %20 rather than '+' for spaces — both decode the same, %20 is unambiguous.
  const qs = params.toString().replace(/\+/g, '%20');
  return `claude://code/new${qs ? `?${qs}` : ''}`;
}

export function buildCopilotLaunchUrl({ prompt, repo }) {
  if (!isValidCopilotRepository(repo)) return '';
  const params = new URLSearchParams({ prompt: prompt || '', mode: 'interactive' });
  return `ghapp://session/new/${repo.trim()}?${params.toString()}`;
}

export function buildProviderLaunchUrl(opts) {
  return opts?.aiProvider === 'copilot' ? buildCopilotLaunchUrl(opts) : buildLaunchUrl(opts);
}

export function launchWithProvider(opts) {
  const url = buildProviderLaunchUrl(opts);
  if (url) window.location.assign(url);
  return !!url;
}

// ── UI: split button + menu + edit dialog ────────────────────────────────

const PLAY_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z"/></svg>';
const DOTS_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';

let openMenuEl = null;
let openDialogEl = null;

function closeMenu() {
  if (!openMenuEl) return;
  const toggle = openMenuEl._toggle;
  openMenuEl.remove();
  openMenuEl = null;
  toggle?.setAttribute('aria-expanded', 'false');
}

function closeDialog() {
  if (!openDialogEl) return;
  const returnFocus = openDialogEl._returnFocus;
  openDialogEl.remove();
  openDialogEl = null;
  returnFocus?.focus?.();
}

let globalsBound = false;
function bindGlobals() {
  if (globalsBound) return;
  globalsBound = true;
  // Capture phase so Escape closes our menu/dialog before the task modal sees it.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (openDialogEl) { closeDialog(); e.stopImmediatePropagation(); e.preventDefault(); return; }
    if (openMenuEl) {
      const toggle = openMenuEl._toggle;
      closeMenu();
      toggle?.focus();
      e.stopImmediatePropagation();
      e.preventDefault();
    }
  }, true);
  document.addEventListener('mousedown', (e) => {
    if (openMenuEl && !openMenuEl.contains(e.target) && !openMenuEl._toggle?.contains(e.target)) closeMenu();
  });
}

function flash(btn, text) {
  const label = btn.querySelector('.cl-label');
  if (!label) return;
  const prev = label.textContent;
  label.textContent = text;
  setTimeout(() => { label.textContent = prev; }, 1400);
}

/**
 * Split button: main part launches with the current prompt, ⋮ opens a menu
 * (edit before start, copy, reset). getTask/getState are called on click so
 * edits made in the modal are picked up.
 */
export function createClaudeLaunchButton({ getTask, getState, onOpenSettings }) {
  bindGlobals();
  const wrap = document.createElement('div');
  wrap.className = 'cl-split';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'cl-main';
  main.innerHTML = `${PLAY_ICON}<span class="cl-label"></span>`;

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'cl-more';
  toggle.innerHTML = DOTS_ICON;
  toggle.setAttribute('aria-label', 'Claude launch options');
  toggle.setAttribute('aria-haspopup', 'menu');
  toggle.setAttribute('aria-expanded', 'false');

  wrap.append(main, toggle);

  const sync = () => {
    const task = getTask();
    if (!task) return;
    const r = resolveLaunch(task, getState());
    const providerName = r.aiProvider === 'copilot' ? 'Copilot' : 'Claude';
    const repoInfo = r.aiProvider === 'copilot'
      ? (r.repo ? ` · ${r.repo}` : ' · GitHub repository required in Settings')
      : (r.folder ? ` · ${r.folder}` : ' · no folder set');
    main.querySelector('.cl-label').textContent = `Start in ${providerName}`;
    wrap.classList.toggle('cl-custom', r.custom);
    main.dataset.launchUrl = buildProviderLaunchUrl(r);
    main.title = `${r.custom ? 'Saved custom prompt' : 'Default prompt'}${repoInfo}\n\n${r.prompt.slice(0, 600)}${r.prompt.length > 600 ? '…' : ''}`;
  };
  wrap.addEventListener('mouseenter', sync);
  wrap.addEventListener('focusin', sync);
  wrap._sync = sync;
  sync();

  main.addEventListener('click', () => {
    const task = getTask();
    if (!task) return;
    sync();
    const launch = resolveLaunch(task, getState());
    if (launch.aiProvider === 'copilot' && !launch.repo) {
      flash(main, 'Set repo in Settings');
      onOpenSettings?.();
      return;
    }
    launchWithProvider(launch);
    flash(main, 'Opening…');
  });

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    if (openMenuEl) { closeMenu(); return; }
    const task = getTask();
    if (!task) return;
    const r = resolveLaunch(task, getState());
    const menu = document.createElement('div');
    menu.className = 'cl-menu';
    menu.setAttribute('role', 'menu');
    menu._toggle = toggle;

    const item = (label, onClick, { hint = '' } = {}) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'cl-menu-item';
      b.setAttribute('role', 'menuitem');
      const text = document.createElement('span');
      text.textContent = label;
      b.appendChild(text);
      if (hint) {
        const h = document.createElement('span');
        h.className = 'cl-menu-hint';
        h.textContent = hint;
        b.appendChild(h);
      }
      b.addEventListener('click', () => { closeMenu(); onClick(); });
      menu.appendChild(b);
      return b;
    };

    item('Edit prompt & start…', () => openEditDialog({ task: getTask(), state: getState(), returnFocus: toggle, onSaved: sync }));
    item('Copy prompt', async () => {
      try {
        await navigator.clipboard.writeText(r.prompt);
        flash(main, 'Copied');
      } catch {
        flash(main, 'Copy failed');
      }
    });
    if (r.custom) {
      item('Reset to default prompt', () => {
        writeTaskOverride(task.taskId, null);
        sync();
        flash(main, 'Reset');
      }, { hint: 'custom' });
    }
    if (onOpenSettings) {
      const sep = document.createElement('div');
      sep.className = 'cl-menu-sep';
      menu.appendChild(sep);
      item('Edit default templates…', onOpenSettings);
    }

    wrap.appendChild(menu);
    openMenuEl = menu;
    toggle.setAttribute('aria-expanded', 'true');
    menu.querySelector('.cl-menu-item')?.focus();
    menu.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
      ev.preventDefault();
      const items = [...menu.querySelectorAll('.cl-menu-item')];
      const idx = items.indexOf(document.activeElement);
      const next = ev.key === 'ArrowDown' ? (idx + 1) % items.length : (idx - 1 + items.length) % items.length;
      items[next].focus();
    });
  });

  return wrap;
}

export function openEditDialog({ task, state, returnFocus, onSaved }) {
  if (!task) return;
  closeDialog();
  const r = resolveLaunch(task, state);

  const overlay = document.createElement('div');
  overlay.className = 'cl-dialog-overlay';
  overlay._returnFocus = returnFocus;
  overlay.innerHTML = `
    <div class="cl-dialog" role="dialog" aria-modal="true" aria-labelledby="clDialogTitle">
      <div class="cl-dialog-head">
        <h3 id="clDialogTitle"></h3>
        <span class="cl-dialog-source">${r.custom ? 'Saved custom prompt' : 'From default template'}</span>
      </div>
      <label class="cl-field-label" for="clPrompt">Prompt</label>
      <textarea id="clPrompt" class="cl-prompt" rows="14" spellcheck="false"></textarea>
      <div class="cl-counter" aria-live="polite"></div>
      <div class="cl-folder-field">
        <label class="cl-field-label" for="clFolder">Folder <span class="cl-muted">(absolute path — the session's working directory)</span></label>
        <input id="clFolder" class="cl-folder" type="text" spellcheck="false" placeholder="/Users/you/projects/repo" value="${escapeHtml(r.folder)}">
        <div class="cl-folder-warn" hidden>Not an absolute path — it won't be sent.</div>
      </div>
      <label class="cl-remember"><input type="checkbox" id="clRemember" ${r.custom ? 'checked' : ''}> Remember this prompt for ${escapeHtml(task.taskId || 'this ticket')}</label>
      <details class="cl-url-details">
        <summary>Link that will be opened</summary>
        <code class="cl-url"></code>
      </details>
      <div class="cl-dialog-actions">
        <button type="button" class="cl-btn-ghost" data-act="default">Use default template</button>
        <span class="cl-spacer"></span>
        <button type="button" class="cl-btn-ghost" data-act="cancel">Cancel</button>
        <button type="button" class="primary" data-act="start">${PLAY_ICON} Start</button>
      </div>
    </div>`;

  const promptEl = overlay.querySelector('#clPrompt');
  const folderEl = overlay.querySelector('#clFolder');
  const counter = overlay.querySelector('.cl-counter');
  const urlEl = overlay.querySelector('.cl-url');
  const folderWarn = overlay.querySelector('.cl-folder-warn');
  const remember = overlay.querySelector('#clRemember');
  const startBtn = overlay.querySelector('[data-act="start"]');
  overlay.querySelector('#clDialogTitle').textContent =
    `Start ${task.taskId || 'ticket'} in ${r.aiProvider === 'copilot' ? 'Copilot' : 'Claude'}`;
  promptEl.value = r.prompt;

  const update = () => {
    const n = promptEl.value.length;
    const over = n > MAX_PROMPT_CHARS;
    counter.textContent = over
      ? `${n.toLocaleString()} / ${MAX_PROMPT_CHARS.toLocaleString()} chars — Claude will cut the rest`
      : `${n.toLocaleString()} / ${MAX_PROMPT_CHARS.toLocaleString()} chars`;
    counter.classList.toggle('cl-over', over);
    const f = folderEl.value.trim();
    folderWarn.hidden = !f || isAbsolutePath(f);
    const launch = {
      ...r,
      prompt: promptEl.value,
      folder: f,
      repo: githubRepositoryFromUrl(task?.issueUrl) || readCopilotRepository(),
    };
    const url = buildProviderLaunchUrl(launch);
    urlEl.textContent = url;
    startBtn.dataset.launchUrl = url;
    overlay.querySelector('.cl-folder-field').hidden = r.aiProvider === 'copilot';
    startBtn.disabled = r.aiProvider === 'copilot' && !launch.repo;
  };
  promptEl.addEventListener('input', update);
  folderEl.addEventListener('input', update);
  update();

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) { closeDialog(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'cancel') closeDialog();
    if (act === 'default') {
      promptEl.value = defaultPromptFor(task, state);
      folderEl.value = defaultFolderFor(task, state);
      remember.checked = false;
      update();
    }
    if (act === 'start') {
      const prompt = promptEl.value;
      const folder = folderEl.value.trim();
      const repo = githubRepositoryFromUrl(task?.issueUrl) || readCopilotRepository();
      const def = { prompt: defaultPromptFor(task, state), folder: defaultFolderFor(task, state) };
      if (remember.checked && (prompt !== def.prompt || folder !== def.folder)) {
        writeTaskOverride(task.taskId, { prompt, folder: folder === def.folder ? '' : folder });
      } else if (!remember.checked) {
        writeTaskOverride(task.taskId, null);
      }
      onSaved?.();
      closeDialog();
      launchWithProvider({ prompt, folder, repo, aiProvider: r.aiProvider });
    }
  });
  promptEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); startBtn.click(); }
  });

  document.body.appendChild(overlay);
  openDialogEl = overlay;
  promptEl.focus();
  promptEl.setSelectionRange(0, 0);
  promptEl.scrollTop = 0;
}

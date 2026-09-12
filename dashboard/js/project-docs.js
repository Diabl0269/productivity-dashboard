// project-docs.js — Documentation file tree for a project (directories + memory)

import { escapeHtml, renderMarkdownToHtml } from './memory-parser.js';
import {
  buildDocTree,
  projectMemorySlug,
  parseDocFilterPatterns,
  isPreviewableDocName,
} from '../../shared/project-docs.js';
import { readDocFilterPatterns, readDocShowAll, writeDocShowAll } from './project-docs-prefs.js';

const SELECTED_DOC_KEY = 'dashboard.projects.selectedDoc';

let cachedEntries = new Map();
let onConfigureProject = null;

export function setProjectDocsCallbacks({ configureProject } = {}) {
  onConfigureProject = configureProject || null;
}

export function clearProjectDocsCache() {
  cachedEntries = new Map();
}

function readSelectedDoc(projectId) {
  try {
    const all = JSON.parse(localStorage.getItem(SELECTED_DOC_KEY) || '{}');
    return all[projectId] || '';
  } catch {
    return '';
  }
}

function writeSelectedDoc(projectId, docId) {
  try {
    const all = JSON.parse(localStorage.getItem(SELECTED_DOC_KEY) || '{}');
    if (docId) all[projectId] = docId;
    else delete all[projectId];
    localStorage.setItem(SELECTED_DOC_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

async function fetchDocEntries(project, { showAll }) {
  const slug = projectMemorySlug(project);
  const docDirs = project.docDirs || [];
  const filters = readDocFilterPatterns();
  const cacheKey = `${project.id}:${slug}:${showAll}:${filters.join('|')}:${docDirs.join('|')}:${(project.docs || []).join(',')}`;
  if (cachedEntries.has(cacheKey)) return cachedEntries.get(cacheKey);

  const params = new URLSearchParams({ slug: project.id });
  if (project.memorySlug) params.set('memorySlug', project.memorySlug);
  if (project.docs?.length) params.set('docs', project.docs.join(','));
  if (docDirs.length) params.set('docDirs', docDirs.map(d => encodeURIComponent(d)).join('|'));
  if (showAll) params.set('showAll', '1');
  if (filters.length) params.set('filters', filters.join('\n'));

  let payload = { entries: [], total: 0, missingDirs: [], sources: {} };
  try {
    const res = await fetch(`/api/project-docs?${params}`, { cache: 'no-store' });
    if (res.ok) payload = await res.json();
  } catch { /* offline or static host */ }

  cachedEntries.set(cacheKey, payload);
  return payload;
}

function renderDocTreeNode(node, depth, selectedTreePath, onSelect) {
  const frag = document.createDocumentFragment();

  for (const folder of node.children || []) {
    const details = document.createElement('details');
    details.className = 'pv-docs-folder';
    details.open = depth < 2;
    const summary = document.createElement('summary');
    summary.className = 'pv-docs-folder-label';
    summary.innerHTML = `
      <svg class="pv-docs-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      <span>${escapeHtml(folder.name)}</span>`;
    details.appendChild(summary);
    details.appendChild(renderDocTreeNode(folder, depth + 1, selectedTreePath, onSelect));
    frag.appendChild(details);
  }

  for (const file of node.files || []) {
    const treePath = file.treePath || file.path;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pv-docs-file' + (treePath === selectedTreePath ? ' active' : '');
    btn.dataset.path = treePath;
    btn.dataset.ref = file.id || file.path;
    const icon = file.kind === 'overview'
      ? '<svg class="pv-docs-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      : '<svg class="pv-docs-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
    btn.innerHTML = `${icon}<span>${escapeHtml(file.name)}</span>`;
    btn.addEventListener('click', () => onSelect(file));
    frag.appendChild(btn);
  }

  return frag;
}

async function loadDocContent(entry, project) {
  const ref = entry.id || entry.path;
  const allowedRoots = (project.docDirs || []).map(d => encodeURIComponent(d)).join('|');
  if (ref.startsWith('fs:')) {
    const params = new URLSearchParams({ ref, allowedRoots });
    const res = await fetch(`/api/project-doc-content?${params}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('Could not load file');
    return res.text();
  }
  const params = new URLSearchParams({ ref });
  const res = await fetch(`/api/project-doc-content?${params}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load file');
  return res.text();
}

function updateDocsToolbar(project) {
  let bar = document.getElementById('projectsDocsToolbar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'projectsDocsToolbar';
    bar.className = 'pv-docs-toolbar';

    const showAllLabel = document.createElement('label');
    showAllLabel.className = 'pv-docs-show-all';
    const showAllInput = document.createElement('input');
    showAllInput.type = 'checkbox';
    showAllInput.id = 'projectsDocsShowAll';
    const showAllText = document.createElement('span');
    showAllText.textContent = 'Show all files';
    showAllLabel.appendChild(showAllInput);
    showAllLabel.appendChild(showAllText);

    const configBtn = document.createElement('button');
    configBtn.type = 'button';
    configBtn.className = 'pv-docs-config-btn';
    configBtn.textContent = 'Edit paths';
    configBtn.title = 'Edit documentation directories for this project';

    bar.appendChild(showAllLabel);
    bar.appendChild(configBtn);

    const treeEl = document.getElementById('projectsDocsTree');
    treeEl?.parentElement?.insertBefore(bar, treeEl);
  }

  const showAllInput = bar.querySelector('#projectsDocsShowAll');
  const configBtn = bar.querySelector('.pv-docs-config-btn');
  if (showAllInput) {
    showAllInput.checked = readDocShowAll(project.id);
    showAllInput.onchange = () => {
      writeDocShowAll(project.id, showAllInput.checked);
      clearProjectDocsCache();
      renderProjectDocsPanel(project).catch(() => {});
    };
  }
  if (configBtn) {
    configBtn.onclick = () => onConfigureProject?.(project);
  }
  return bar;
}

function renderSourcesBanner(sources, docDirs, missingDirs) {
  const configuredDirs = sources?.directories || docDirs || [];
  const parts = [];
  for (const dir of configuredDirs) parts.push(escapeHtml(dir));
  if (sources?.memoryRepo) parts.push('Repo memory (memory/projects/)');
  if (sources?.memoryExample && !configuredDirs.length) {
    parts.push('Demo files (memory.example/projects/)');
  }
  if (!parts.length && !(missingDirs?.length)) {
    return '<p class="pv-docs-hint">No sources linked — use <strong>Edit paths</strong> or Edit project.</p>';
  }
  let html = `<div class="pv-docs-sources"><span class="pv-docs-sources-label">Sources:</span> ${parts.join(' · ')}</div>`;
  if (sources?.memoryExample && !configuredDirs.length) {
    html += '<p class="pv-docs-hint">Bundled demo docs load automatically when this project id matches a file under <code>memory.example/projects/</code> and no directories are configured.</p>';
  }
  if (missingDirs?.length) {
    html += `<p class="pv-docs-hint pv-docs-warn">Missing path(s): ${escapeHtml(missingDirs.join(', '))}</p>`;
  }
  return html;
}

export async function renderProjectDocsPanel(project) {
  const panel = document.getElementById('projectsDocsPanel');
  const treeEl = document.getElementById('projectsDocsTree');
  const previewEl = document.getElementById('projectsDocsPreview');
  if (!panel || !treeEl || !previewEl) return;

  if (!project) return;

  updateDocsToolbar(project);

  treeEl.innerHTML = '<div class="pv-docs-loading">Loading docs…</div>';
  previewEl.innerHTML = '<div class="pv-docs-empty">Select a document</div>';

  const showAll = readDocShowAll(project.id);
  const { entries, total, missingDirs, sources } = await fetchDocEntries(project, { showAll });
  const docDirs = project.docDirs || [];

  if (entries.length === 0) {
    const slug = projectMemorySlug(project);
    treeEl.innerHTML = `
      ${renderSourcesBanner(sources, docDirs, missingDirs)}
      <div class="pv-docs-empty">
        <p>No documentation found.</p>
        <p class="pv-docs-hint">Use <strong>Edit paths</strong> or <strong>Edit project</strong> to add absolute directory paths, or add <code>memory/projects/${escapeHtml(slug)}.md</code> in this repo.</p>
        ${docDirs.length ? `<p class="pv-docs-hint">${docDirs.length} configured ${docDirs.length === 1 ? 'directory' : 'directories'} — ${showAll ? 'showing all files' : 'try <strong>Show all files</strong> or adjust filter patterns in Settings → Display'}.</p>` : ''}
      </div>`;
    return;
  }

  const treeRoot = buildDocTree(entries);
  const treeToEntry = new Map(entries.map(e => [e.treePath || e.path, e]));

  let selectedId = readSelectedDoc(project.id);
  if (!selectedId || !entries.some(e => (e.id || e.path) === selectedId)) {
    selectedId = entries[0]?.id || entries[0]?.path || '';
  }
  const selectedEntry = entries.find(e => (e.id || e.path) === selectedId) || entries[0];
  const selectedTreePath = selectedEntry?.treePath || selectedEntry?.path || '';

  const onSelect = async (entry) => {
    const docId = entry.id || entry.path;
    writeSelectedDoc(project.id, docId);
    treeEl.querySelectorAll('.pv-docs-file.active').forEach(el => el.classList.remove('active'));
    const active = treeEl.querySelector(`.pv-docs-file[data-path="${CSS.escape(entry.treePath || entry.path)}"]`);
    if (active) active.classList.add('active');

    previewEl.innerHTML = '<div class="pv-docs-loading">Loading…</div>';
    const fileName = entry.treePath?.split('/').pop() || entry.name || '';
    if (entry.previewable === false || !isPreviewableDocName(fileName)) {
      previewEl.innerHTML = `<div class="pv-docs-empty"><p>Preview not available for this file type.</p><p class="pv-docs-hint"><code>${escapeHtml(docId.replace(/^fs:/, ''))}</code></p></div>`;
      return;
    }
    try {
      const content = await loadDocContent(entry, project);
      previewEl.innerHTML = `<div class="markdown-content pv-docs-markdown">${renderMarkdownToHtml(content)}</div>`;
    } catch {
      previewEl.innerHTML = '<div class="pv-docs-empty">Could not load document</div>';
    }
  };

  treeEl.innerHTML = '';
  treeEl.insertAdjacentHTML('afterbegin', renderSourcesBanner(sources, docDirs, missingDirs));
  const meta = document.createElement('div');
  meta.className = 'pv-docs-tree-meta';
  meta.textContent = showAll
    ? `${entries.length} files`
    : `${entries.length} of ${total} files (memory-focused)`;
  treeEl.appendChild(meta);
  treeEl.appendChild(renderDocTreeNode(treeRoot, 0, selectedTreePath, onSelect));

  if (selectedEntry) await onSelect(selectedEntry);
}

// project-docs.js — Documentation file tree for a project (memory/projects links)

import { escapeHtml, renderMarkdownToHtml } from './memory-parser.js';
import { buildDocTree, projectMemorySlug } from '../../shared/project-docs.js';

const BASE = '..';
const SELECTED_DOC_KEY = 'dashboard.projects.selectedDoc';

let cachedEntries = new Map();

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

function writeSelectedDoc(projectId, path) {
  try {
    const all = JSON.parse(localStorage.getItem(SELECTED_DOC_KEY) || '{}');
    if (path) all[projectId] = path;
    else delete all[projectId];
    localStorage.setItem(SELECTED_DOC_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

async function fetchDocEntries(project) {
  const slug = projectMemorySlug(project);
  const cacheKey = `${project.id}:${slug}:${(project.docs || []).join(',')}`;
  if (cachedEntries.has(cacheKey)) return cachedEntries.get(cacheKey);

  const params = new URLSearchParams({ slug: project.id });
  if (project.memorySlug) params.set('memorySlug', project.memorySlug);
  if (project.docs?.length) params.set('docs', project.docs.join(','));

  let entries = [];
  try {
    const res = await fetch(`/api/project-docs?${params}`, { cache: 'no-store' });
    if (res.ok) {
      const data = await res.json();
      entries = data.entries || [];
    }
  } catch { /* offline or static host */ }

  cachedEntries.set(cacheKey, entries);
  return entries;
}

function renderDocTreeNode(node, depth, selectedPath, onSelect) {
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
    details.appendChild(renderDocTreeNode(folder, depth + 1, selectedPath, onSelect));
    frag.appendChild(details);
  }

  for (const file of node.files || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'pv-docs-file' + (file.path === selectedPath ? ' active' : '');
    btn.dataset.path = file.path;
    const icon = file.kind === 'overview'
      ? '<svg class="pv-docs-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
      : '<svg class="pv-docs-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>';
    btn.innerHTML = `${icon}<span>${escapeHtml(file.name)}</span>`;
    btn.addEventListener('click', () => onSelect(file.path));
    frag.appendChild(btn);
  }

  return frag;
}

async function loadDocContent(relPath) {
  const res = await fetch(`${BASE}/${relPath}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load file');
  return res.text();
}

export async function renderProjectDocsPanel(project) {
  const panel = document.getElementById('projectsDocsPanel');
  const treeEl = document.getElementById('projectsDocsTree');
  const previewEl = document.getElementById('projectsDocsPreview');
  if (!panel || !treeEl || !previewEl) return;

  if (!project) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;

  treeEl.innerHTML = '<div class="pv-docs-loading">Loading docs…</div>';
  previewEl.innerHTML = '<div class="pv-docs-empty">Select a document</div>';

  const entries = await fetchDocEntries(project);
  if (entries.length === 0) {
    treeEl.innerHTML = `
      <div class="pv-docs-empty">
        <p>No linked docs yet.</p>
        <p class="pv-docs-hint">Add <code>memory/projects/${escapeHtml(projectMemorySlug(project))}.md</code> or link paths in project settings.</p>
      </div>`;
    return;
  }

  const treeRoot = buildDocTree(entries);
  let selectedPath = readSelectedDoc(project.id);
  if (selectedPath && !entries.some(e => e.path === selectedPath)) selectedPath = entries[0]?.path || '';

  const onSelect = async (path) => {
    writeSelectedDoc(project.id, path);
    treeEl.querySelectorAll('.pv-docs-file.active').forEach(el => el.classList.remove('active'));
    const active = treeEl.querySelector(`.pv-docs-file[data-path="${CSS.escape(path)}"]`);
    if (active) active.classList.add('active');
    previewEl.innerHTML = '<div class="pv-docs-loading">Loading…</div>';
    try {
      const content = await loadDocContent(path);
      previewEl.innerHTML = `<div class="markdown-content pv-docs-markdown">${renderMarkdownToHtml(content)}</div>`;
    } catch {
      previewEl.innerHTML = '<div class="pv-docs-empty">Could not load document</div>';
    }
  };

  treeEl.innerHTML = '';
  treeEl.appendChild(renderDocTreeNode(treeRoot, 0, selectedPath, onSelect));

  if (selectedPath) await onSelect(selectedPath);
}

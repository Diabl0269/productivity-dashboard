// global-memory.js - Global Claude memory viewer and editor

import { showStatus } from './state.js';
import { renderMarkdownToHtml, getPreview, escapeHtml, parseFrontmatter } from './memory-parser.js';

const state = {
  globalClaudeMd: null,
  projects: [],
  loaded: false,
  activeSubTab: 'claude-md', // 'claude-md' or 'project-memories'
  activeProjectFilter: null,  // null = all
  editing: false
};

export function initGlobalMemory() {
  // Make openGlobalMemoryModal globally available for click handlers
  window.openGlobalMemoryModal = openGlobalMemoryModal;
  // Wire up sub-tab click delegation on #globalMemorySubTabs
  const subTabsContainer = document.getElementById('globalMemorySubTabs');
  if (subTabsContainer) {
    subTabsContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.gm-sub-tab');
      if (!btn) return;
      state.activeSubTab = btn.dataset.subtab;
      state.editing = false;
      subTabsContainer.querySelectorAll('.gm-sub-tab').forEach(b => b.classList.toggle('active', b === btn));
      renderContent();
    });
  }
}

export async function loadGlobalMemory() {
  const emptyState = document.getElementById('globalMemoryEmptyState');
  const content = document.getElementById('globalMemoryContent');

  try {
    const resp = await fetch('/api/global-memory');
    if (!resp.ok) throw new Error('Failed to load');
    const data = await resp.json();

    state.globalClaudeMd = data.globalClaudeMd;
    state.projects = data.projects;
    state.loaded = true;

    emptyState.style.display = 'none';
    content.style.display = 'flex';

    renderSubTabs();
    renderContent();
  } catch (e) {
    emptyState.querySelector('p').textContent = 'Failed to load global memory';
    console.error('Global memory load failed:', e);
  }
}

function renderSubTabs() {
  const container = document.getElementById('globalMemorySubTabs');
  const totalMemFiles = state.projects.reduce((sum, p) => sum + p.files.length, 0);

  container.innerHTML = `
    <button class="gm-sub-tab active" data-subtab="claude-md">Global CLAUDE.md</button>
    <button class="gm-sub-tab" data-subtab="project-memories">Project Memories <span class="count">${totalMemFiles}</span></button>
  `;
}

function renderContent() {
  const filtersEl = document.getElementById('globalMemoryFilters');
  const containerEl = document.getElementById('globalMemoryContainer');

  if (state.activeSubTab === 'claude-md') {
    filtersEl.style.display = 'none';
    renderClaudeMd(containerEl);
  } else {
    filtersEl.style.display = 'flex';
    renderProjectFilters(filtersEl);
    renderProjectMemories(containerEl);
  }
}

function renderClaudeMd(container) {
  if (!state.globalClaudeMd) {
    container.innerHTML = '<div class="gm-empty">No global CLAUDE.md found at ~/.claude/CLAUDE.md</div>';
    return;
  }

  if (state.editing) {
    container.innerHTML = `
      <div class="gm-claude-md-edit">
        <div class="gm-edit-toolbar">
          <span class="gm-edit-path">~/.claude/CLAUDE.md</span>
          <div class="gm-edit-actions">
            <button class="gm-btn gm-btn-cancel" id="gmCancelEdit">Cancel</button>
            <button class="gm-btn gm-btn-save" id="gmSaveEdit">Save</button>
          </div>
        </div>
        <textarea class="gm-editor" id="gmEditor">${escapeHtmlAttr(state.globalClaudeMd)}</textarea>
      </div>
    `;

    const textarea = document.getElementById('gmEditor');
    textarea.focus();

    document.getElementById('gmCancelEdit').addEventListener('click', () => {
      state.editing = false;
      renderContent();
    });

    document.getElementById('gmSaveEdit').addEventListener('click', async () => {
      const content = document.getElementById('gmEditor').value;
      try {
        const resp = await fetch('/api/global-save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'CLAUDE.md', content })
        });
        if (!resp.ok) throw new Error('Save failed');
        state.globalClaudeMd = content;
        state.editing = false;
        showStatus('Global CLAUDE.md saved');
        renderContent();
      } catch (e) {
        showStatus('Error saving: ' + e.message);
      }
    });
  } else {
    const rendered = renderMarkdownToHtml(state.globalClaudeMd);
    container.innerHTML = `
      <div class="gm-claude-md-view">
        <div class="gm-view-toolbar">
          <span class="gm-edit-path">~/.claude/CLAUDE.md</span>
          <button class="gm-btn gm-btn-edit" id="gmStartEdit">Edit</button>
        </div>
        <div class="gm-claude-md-content markdown-content">${rendered}</div>
      </div>
    `;

    document.getElementById('gmStartEdit').addEventListener('click', () => {
      state.editing = true;
      renderContent();
    });
  }
}

function escapeHtmlAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderProjectFilters(container) {
  const totalFiles = state.projects.reduce((sum, p) => sum + p.files.length, 0);

  let html = `<button class="gm-filter-pill ${state.activeProjectFilter === null ? 'active' : ''}" data-filter="all">All <span class="count">${totalFiles}</span></button>`;

  for (const project of state.projects) {
    const isActive = state.activeProjectFilter === project.encodedName;
    html += `<button class="gm-filter-pill ${isActive ? 'active' : ''}" data-filter="${project.encodedName}">${project.displayName} <span class="count">${project.files.length}</span></button>`;
  }

  container.innerHTML = html;

  container.onclick = (e) => {
    const pill = e.target.closest('.gm-filter-pill');
    if (!pill) return;
    const filter = pill.dataset.filter;
    state.activeProjectFilter = filter === 'all' ? null : filter;
    container.querySelectorAll('.gm-filter-pill').forEach(p => {
      p.classList.toggle('active', p.dataset.filter === (state.activeProjectFilter || 'all'));
    });
    renderProjectMemories(document.getElementById('globalMemoryContainer'));
  };
}

function renderProjectMemories(container) {
  const projects = state.activeProjectFilter
    ? state.projects.filter(p => p.encodedName === state.activeProjectFilter)
    : state.projects;

  if (projects.length === 0) {
    container.innerHTML = '<div class="gm-empty">No project memories found</div>';
    return;
  }

  container.innerHTML = projects.map(project => renderProjectGroup(project)).join('');

  // Wire up card click to open modal
  container.querySelectorAll('.gm-card').forEach(card => {
    card.addEventListener('click', () => {
      const projectEncoded = card.closest('.gm-project-group').dataset.project;
      const filePath = card.dataset.filepath;
      const projectDir = card.dataset.projectdir;
      openGlobalMemoryModal(projectEncoded, filePath, projectDir);
    });
  });
}

function renderProjectGroup(project) {
  return `
    <div class="gm-project-group" data-project="${project.encodedName}">
      <div class="gm-project-header">
        <div>
          <div class="gm-project-name">${escapeHtml(project.displayName)}</div>
          <div class="gm-project-path">${escapeHtml(project.decodedPath)}</div>
        </div>
        <div class="gm-project-count">${project.files.length} file${project.files.length !== 1 ? 's' : ''}</div>
      </div>
      <div class="gm-card-grid">
        ${project.files.map(f => renderMemoryCard(f)).join('')}
      </div>
    </div>
  `;
}

function renderMemoryCard(file) {
  const { frontmatter, body } = parseFrontmatter(file.content);
  const type = frontmatter.type || '';
  const name = frontmatter.name || file.name.replace('.md', '');
  const preview = getPreview(body);
  const typeBadge = type ? `<span class="gm-type-badge gm-type-${type}">${type}</span>` : '';
  const searchText = `${name} ${type} ${file.name} ${file.content}`.toLowerCase();

  return `
    <div class="gm-card" data-search="${escapeHtmlAttr(searchText)}" data-filepath="${escapeHtmlAttr(file.path)}" data-projectdir="${escapeHtmlAttr(file.projectDir || '')}">
      <div class="gm-card-header">
        <span class="gm-card-title">${escapeHtml(name)}</span>
        ${typeBadge}
      </div>
      <div class="gm-card-preview">${escapeHtml(preview)}</div>
    </div>
  `;
}

function openGlobalMemoryModal(projectEncoded, filePath, projectDir) {
  const project = state.projects.find(p => p.encodedName === projectEncoded);
  if (!project) return;
  const file = project.files.find(f => f.path === filePath);
  if (!file) return;

  const { frontmatter, body } = parseFrontmatter(file.content);
  const name = frontmatter.name || file.name.replace('.md', '');
  // Use the file's actual project directory for saving (may differ from group base)
  const actualProjectDir = projectDir || file.projectDir || projectEncoded;

  const modalOverlay = document.getElementById('modalOverlay');
  document.getElementById('modalTitle').textContent = name;
  document.getElementById('modalBody').innerHTML = `
    <div class="markdown-content" style="margin-bottom: 20px;">
      ${renderMarkdownToHtml(body)}
    </div>
    <div class="form-group">
      <label>Edit Raw Markdown</label>
      <textarea id="editContent">${escapeHtml(file.content)}</textarea>
    </div>
  `;

  modalOverlay.classList.add('visible');
  modalOverlay.dataset.type = 'globalMemoryFile';
  modalOverlay.dataset.projectEncoded = actualProjectDir;
  modalOverlay.dataset.filePath = filePath;
}

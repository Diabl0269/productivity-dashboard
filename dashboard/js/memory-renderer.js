// memory-renderer.js - Memory rendering - tabs, content, overview, files, directories

import { escapeHtml, parseMemoryMarkdown, getPreview, getDisplayName, renderMarkdownToHtml } from './memory-parser.js';
import { showStatus, filePathEl, setMemoryInfoGetter, activeMainTab } from './state.js';
import { saveHandle } from './persistence.js';
import { reapplySearch } from './search.js';

export const memoryState = {
  memoryDirHandle: null,
  memoryData: {
    claudeMd: null,
    memoryFiles: [],
    memoryDirs: {}
  }
};

setMemoryInfoGetter(() => ({
  handle: memoryState.memoryDirHandle,
  name: memoryState.memoryDirHandle ? memoryState.memoryDirHandle.name : (memoryState.memoryData ? 'memory (read-only)' : '')
}));

const memoryEmptyState = document.getElementById('memoryEmptyState');
const memoryMainContent = document.getElementById('memoryMainContent');
const memoryTabsContainer = document.getElementById('memoryTabsContainer');
const memoryContentContainer = document.getElementById('memoryContentContainer');

async function loadMemoryFromHandle(handle) {
  memoryState.memoryDirHandle = handle;
  memoryState.memoryData = { claudeMd: null, memoryFiles: [], memoryDirs: {} };

  try {
    const claudeFileHandle = await memoryState.memoryDirHandle.getFileHandle('CLAUDE.md');
    const file = await claudeFileHandle.getFile();
    memoryState.memoryData.claudeMd = { content: await file.text(), fileHandle: claudeFileHandle };
  } catch (e) { console.log('No CLAUDE.md found'); }

  try {
    const memoryDir = await memoryState.memoryDirHandle.getDirectoryHandle('memory');
    for await (const entry of memoryDir.values()) {
      if (entry.kind === 'file' && entry.name.endsWith('.md')) {
        const file = await entry.getFile();
        memoryState.memoryData.memoryFiles.push({
          name: entry.name,
          content: await file.text(),
          fileHandle: entry
        });
      } else if (entry.kind === 'directory') {
        memoryState.memoryData.memoryDirs[entry.name] = [];
        const subDirHandle = entry;
        for await (const subEntry of subDirHandle.values()) {
          if (subEntry.kind === 'file' && subEntry.name.endsWith('.md')) {
            const file = await subEntry.getFile();
            const content = await file.text();
            memoryState.memoryData.memoryDirs[entry.name].push({
              name: subEntry.name,
              content: content,
              fileHandle: subEntry,
              dirHandle: subDirHandle,
              parsed: parseMemoryMarkdown(content)
            });
          }
        }
      }
    }
  } catch (e) { console.log('No memory/ directory found'); }

  renderMemory();
  memoryEmptyState.style.display = 'none';
  memoryMainContent.style.display = 'flex';
  if (activeMainTab === 'memory') filePathEl.textContent = memoryState.memoryDirHandle.name;
  showStatus('Loaded memory from ' + memoryState.memoryDirHandle.name);
}

async function loadMemoryDirectory() {
  try {
    const handle = await window.showDirectoryPicker();
    await loadMemoryFromHandle(handle);
    await saveHandle('memoryDir', handle);
  } catch (e) {
    if (e.name !== 'AbortError') { showStatus('Error: ' + e.message); }
  }
}

function renderMemory() {
  renderMemoryTabs();
  renderMemoryContent();
}

function renderMemoryTabs() {
  let html = '';

  if (memoryState.memoryData.claudeMd) {
    html += `<button class="memory-tab active" data-tab="overview">Overview</button>`;
  }

  for (const file of memoryState.memoryData.memoryFiles) {
    const name = file.name.replace('.md', '');
    html += `<button class="memory-tab${!memoryState.memoryData.claudeMd && memoryState.memoryData.memoryFiles[0] === file ? ' active' : ''}" data-tab="file-${name}">${name}</button>`;
  }

  for (const dirName of Object.keys(memoryState.memoryData.memoryDirs).sort()) {
    const files = memoryState.memoryData.memoryDirs[dirName];
    let count;
    if (dirName === 'context') {
      count = 0;
      for (const file of files) {
        const p = file.parsed;
        count += Object.keys(p.fields).length;
        for (const table of p.tables) {
          count += table.rows.length;
        }
        for (const [sName, sContent] of Object.entries(p.sections)) {
          if (sContent && sName !== '_intro') {
            count += sContent.split('\n').filter(l => l.trim() && !l.trim().startsWith('|')).length;
          }
        }
      }
    } else {
      count = files.length;
    }
    html += `<button class="memory-tab" data-tab="dir-${dirName}">${dirName} <span class="count">${count}</span></button>`;
  }

  memoryTabsContainer.innerHTML = html;

  memoryTabsContainer.querySelectorAll('.memory-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      memoryTabsContainer.querySelectorAll('.memory-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderMemoryContent();
    });
  });
}

function renderMemoryContent() {
  const activeTab = memoryTabsContainer.querySelector('.memory-tab.active');
  if (!activeTab) return;

  const tabId = activeTab.dataset.tab;

  if (tabId === 'overview') { renderMemoryOverview(); }
  else if (tabId.startsWith('file-')) {
    const fileName = tabId.replace('file-', '') + '.md';
    renderMemoryFile(fileName);
  } else if (tabId.startsWith('dir-')) {
    const dirName = tabId.replace('dir-', '');
    renderMemoryDirectory(dirName);
  }
  reapplySearch();
}

function renderMemoryOverview() {
  if (!memoryState.memoryData.claudeMd) return;

  let statsHtml = '<div class="stats">';
  for (const [dirName, files] of Object.entries(memoryState.memoryData.memoryDirs)) {
    let count;
    if (dirName === 'context') {
      count = 0;
      for (const file of files) {
        const p = file.parsed;
        count += Object.keys(p.fields).length;
        for (const table of p.tables) { count += table.rows.length; }
        for (const [sName, sContent] of Object.entries(p.sections)) {
          if (sContent && sName !== '_intro') {
            count += sContent.split('\n').filter(l => l.trim() && !l.trim().startsWith('|')).length;
          }
        }
      }
    } else {
      count = files.length;
    }
    statsHtml += `
      <div class="stat">
        <div class="stat-value">${count}</div>
        <div class="stat-label">${dirName}</div>
      </div>
    `;
  }
  statsHtml += '</div>';

  const claudeContent = renderMarkdownToHtml(memoryState.memoryData.claudeMd.content);

  memoryContentContainer.innerHTML = `
    ${statsHtml}
    <div class="file-card">
      <div class="file-card-header" onclick="this.nextElementSibling.classList.toggle('expanded'); this.querySelector('.toggle').textContent = this.nextElementSibling.classList.contains('expanded') ? '\u2212' : '+'">
        <span class="file-card-title">CLAUDE.md</span>
        <span class="toggle" style="color: var(--text-muted);">&minus;</span>
      </div>
      <div class="file-card-content expanded markdown-content">${claudeContent}</div>
    </div>
    <button onclick="openEditModal('CLAUDE.md', 'claudeMd')" style="margin-top: 10px;">Edit CLAUDE.md</button>
  `;
}

function renderMemoryFile(fileName) {
  const file = memoryState.memoryData.memoryFiles.find(f => f.name === fileName);
  if (!file) return;

  const content = renderMarkdownToHtml(file.content);

  memoryContentContainer.innerHTML = `
    <div class="file-card">
      <div class="file-card-header">
        <span class="file-card-title">${fileName}</span>
      </div>
      <div class="file-card-content expanded markdown-content">${content}</div>
    </div>
    <button onclick="openEditModal('${fileName}', 'memoryFile')" style="margin-top: 10px;">Edit ${fileName}</button>
  `;
}

function renderMemoryDirectory(dirName) {
  const files = memoryState.memoryData.memoryDirs[dirName] || [];

  // Context directory uses flat list view
  if (dirName === 'context') {
    renderMemoryDirectoryFlat(dirName, files);
    return;
  }

  // All other directories use card grid view
  let html = `
    <div class="memory-grid" id="dirGrid">
  `;

  for (const file of files) {
    const p = file.parsed;
    const title = p.title || getDisplayName(file.name);

    let fieldsHtml = '';
    const fieldEntries = Object.entries(p.fields).slice(0, 3);
    if (fieldEntries.length > 0) {
      fieldsHtml = '<div class="memory-card-fields">';
      for (const [key, value] of fieldEntries) {
        fieldsHtml += `
          <div class="memory-card-field">
            <span class="memory-card-field-label">${escapeHtml(key)}</span>
            <span class="memory-card-field-value">${escapeHtml(value)}</span>
          </div>
        `;
      }
      fieldsHtml += '</div>';
    }

    let preview = '';
    for (const [sectionName, sectionContent] of Object.entries(p.sections)) {
      if (sectionContent && sectionName !== '_intro') {
        preview = getPreview(sectionContent, 100);
        break;
      }
    }
    if (!preview) preview = getPreview(p.rawContent, 100);

    html += `
      <div class="memory-card" onclick="openFileModal('${dirName}', '${file.name}')" data-search="${escapeHtml((title + ' ' + JSON.stringify(p.fields) + ' ' + p.rawContent).toLowerCase())}">
        <div class="memory-card-title">${escapeHtml(title)}</div>
        ${fieldsHtml}
        <div class="memory-card-preview">${escapeHtml(preview)}</div>
      </div>
    `;
  }

  html += `
    <div class="add-btn" onclick="openNewFileModal('${dirName}')">
      + Add to ${dirName}
    </div>
  </div>`;

  memoryContentContainer.innerHTML = html;
}

function renderMemoryDirectoryFlat(dirName, files) {
  let html = `
    <div id="dirGrid">
  `;

  for (const file of files) {
    const p = file.parsed;

    // Render fields as a key-value table
    const fieldEntries = Object.entries(p.fields);
    if (fieldEntries.length > 0) {
      html += `<div class="file-card" data-file-dir="${dirName}" data-file-name="${file.name}" style="margin-bottom: 16px;"><table class="memory-flat-table"><tbody>`;
      for (const [key, value] of fieldEntries) {
        html += `<tr data-search="${escapeHtml((key + ' ' + value).toLowerCase())}"><td>${escapeHtml(key)}</td><td data-editable="field" data-field-key="${escapeHtml(key)}">${escapeHtml(value)}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Render parsed tables (teams, tools, etc.) as proper HTML tables
    for (let ti = 0; ti < p.tables.length; ti++) {
      const table = p.tables[ti];
      html += `<div class="file-card" data-file-dir="${dirName}" data-file-name="${file.name}" style="margin-bottom: 16px;"><table class="memory-flat-table"><thead><tr>`;
      for (const h of table.headers) {
        html += `<th>${escapeHtml(h)}</th>`;
      }
      html += `</tr></thead><tbody>`;
      for (let ri = 0; ri < table.rows.length; ri++) {
        const row = table.rows[ri];
        const searchData = row.join(' ').toLowerCase();
        html += `<tr data-search="${escapeHtml(searchData)}">`;
        for (let ci = 0; ci < row.length; ci++) {
          const cell = row[ci];
          html += `<td data-editable="table-cell" data-table-index="${ti}" data-row-index="${ri}" data-col-index="${ci}">${escapeHtml(cell)}</td>`;
        }
        html += `</tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Render non-table section content as list items
    for (const [sectionName, sectionContent] of Object.entries(p.sections)) {
      if (!sectionContent || sectionName === '_intro') continue;
      const lines = sectionContent.split('\n').filter(l => l.trim() && !l.trim().startsWith('|'));
      if (lines.length === 0) continue;
      html += `<div class="file-card" data-file-dir="${dirName}" data-file-name="${file.name}" style="margin-bottom: 16px;"><table class="memory-flat-table"><thead><tr><th colspan="2">${escapeHtml(sectionName)}</th></tr></thead><tbody>`;
      for (const line of lines) {
        const cleanLine = line.replace(/^[-*]\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
        if (!cleanLine) continue;
        html += `<tr data-search="${escapeHtml((sectionName + ' ' + cleanLine).toLowerCase())}"><td colspan="2" data-editable="section-line" data-section-name="${escapeHtml(sectionName)}" data-original-line="${escapeHtml(line)}">${escapeHtml(cleanLine)}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }
  }

  html += `</div>`;
  memoryContentContainer.innerHTML = html;
}

export function initMemory() {
  document.getElementById('openMemoryBtn').addEventListener('click', loadMemoryDirectory);
  document.getElementById('openMemoryBtnLarge').addEventListener('click', loadMemoryDirectory);
}

function loadMemoryFromHttpData(data) {
  memoryState.memoryDirHandle = null;
  memoryState.memoryData = data;
  renderMemory();
  memoryEmptyState.style.display = 'none';
  memoryMainContent.style.display = 'flex';
  if (activeMainTab === 'memory') filePathEl.textContent = 'memory (read-only)';
  showStatus('Loaded memory via HTTP');
}

export { loadMemoryFromHandle, loadMemoryFromHttpData, loadMemoryDirectory, renderMemory, renderMemoryContent };

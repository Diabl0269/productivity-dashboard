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

/**
 * Format a snake_case or kebab-case filename for display.
 * E.g. "feedback_memory_gap_detection.md" -> "Memory Gap Detection"
 * Strips known prefixes (feedback_, reference_) and capitalises each word.
 */
function formatTabLabel(rawName) {
  const name = rawName.replace(/\.md$/, '');
  // Strip common prefixes for cleaner labels
  const withoutPrefix = name.replace(/^(feedback_|reference_)/, '');
  // Replace underscores/hyphens with spaces, capitalise first letter of each word
  return withoutPrefix
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Classify a memory file into a sidebar group.
 * Returns 'core' | 'feedback' | 'reference'
 */
function classifyFile(name) {
  const lower = name.toLowerCase();
  if (lower.startsWith('feedback_')) return 'feedback';
  if (lower.startsWith('reference_')) return 'reference';
  return 'core';
}

/**
 * Build the grouped vertical sidebar navigation.
 * Spec §7.1–7.2: group labels, vertical nav items, role="tab", aria-selected.
 */
function renderMemoryTabs() {
  // Classify memory files into groups
  const coreFiles = [];
  const feedbackFiles = [];
  const referenceFiles = [];

  for (const file of memoryState.memoryData.memoryFiles) {
    const group = classifyFile(file.name);
    if (group === 'feedback') feedbackFiles.push(file);
    else if (group === 'reference') referenceFiles.push(file);
    else coreFiles.push(file);
  }

  // Determine the default active tab id (first item in render order)
  let defaultTabId = null;
  if (memoryState.memoryData.claudeMd) {
    defaultTabId = 'overview';
  } else if (coreFiles.length > 0) {
    defaultTabId = 'file-' + coreFiles[0].name.replace('.md', '');
  } else if (feedbackFiles.length > 0) {
    defaultTabId = 'file-' + feedbackFiles[0].name.replace('.md', '');
  } else if (referenceFiles.length > 0) {
    defaultTabId = 'file-' + referenceFiles[0].name.replace('.md', '');
  } else {
    const dirNames = Object.keys(memoryState.memoryData.memoryDirs).sort();
    if (dirNames.length > 0) defaultTabId = 'dir-' + dirNames[0];
  }

  let html = '';

  // ── Core group ──
  const hasCoreItems = memoryState.memoryData.claudeMd || coreFiles.length > 0;
  if (hasCoreItems) {
    html += '<span class="memory-sidebar-group-label">Core</span>';

    if (memoryState.memoryData.claudeMd) {
      html += buildTabButton('overview', 'Overview', null, false);
    }

    for (const file of coreFiles) {
      const tabId = 'file-' + file.name.replace('.md', '');
      html += buildTabButton(tabId, formatTabLabel(file.name), null, false);
    }
  }

  // ── Feedback group ──
  if (feedbackFiles.length > 0) {
    html += '<span class="memory-sidebar-group-label">Feedback</span>';
    for (const file of feedbackFiles) {
      const name = file.name.replace('.md', '');
      const tabId = 'file-' + name;
      html += buildTabButton(tabId, formatTabLabel(file.name), null, false);
    }
  }

  // ── Reference group ──
  if (referenceFiles.length > 0) {
    html += '<span class="memory-sidebar-group-label">Reference</span>';
    for (const file of referenceFiles) {
      const tabId = 'file-' + file.name.replace('.md', '');
      html += buildTabButton(tabId, formatTabLabel(file.name), null, false);
    }
  }

  // ── Directories group ──
  const dirNames = Object.keys(memoryState.memoryData.memoryDirs).sort();
  if (dirNames.length > 0) {
    html += '<span class="memory-sidebar-group-label">Directories</span>';
    for (const dirName of dirNames) {
      const files = memoryState.memoryData.memoryDirs[dirName];
      const tabId = 'dir-' + dirName;

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

      const label = dirName.charAt(0).toUpperCase() + dirName.slice(1);
      html += buildTabButton(tabId, label, count, false);
    }
  }

  memoryTabsContainer.innerHTML = html;

  // Activate the default tab
  if (defaultTabId) {
    const defaultBtn = memoryTabsContainer.querySelector('[data-tab="' + defaultTabId + '"]');
    if (defaultBtn) {
      defaultBtn.classList.add('active');
      defaultBtn.setAttribute('aria-selected', 'true');
    }
  }

  // Wire up click handlers
  memoryTabsContainer.querySelectorAll('.memory-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      memoryTabsContainer.querySelectorAll('.memory-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      renderMemoryContent();
    });
  });
}

/**
 * Build a single sidebar nav button HTML string.
 */
function buildTabButton(tabId, label, count, initialActive) {
  const countHtml = count != null
    ? '<span class="count">' + count + '</span>'
    : '';
  const activeClass = initialActive ? ' active' : '';
  const ariaSelected = initialActive ? 'true' : 'false';
  return (
    '<button class="memory-tab' + activeClass + '" ' +
    'data-tab="' + escapeHtml(tabId) + '" ' +
    'role="tab" ' +
    'aria-selected="' + ariaSelected + '">' +
    escapeHtml(label) +
    countHtml +
    '</button>'
  );
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
        <div class="stat-label">${escapeHtml(dirName)}</div>
      </div>
    `;
  }
  statsHtml += '</div>';

  const claudeContent = renderMarkdownToHtml(memoryState.memoryData.claudeMd.content);

  memoryContentContainer.innerHTML = `
    ${statsHtml}
    <div class="file-card">
      <div class="file-card-header" onclick="this.nextElementSibling.classList.toggle('expanded'); this.querySelector('.toggle').textContent = this.nextElementSibling.classList.contains('expanded') ? '−' : '+'">
        <span class="file-card-title">CLAUDE.md</span>
        <span class="toggle" style="color: var(--text-tertiary);">&minus;</span>
      </div>
      <div class="file-card-content expanded markdown-content">${claudeContent}</div>
    </div>
    <button onclick="openEditModal('CLAUDE.md', 'claudeMd')" style="margin-top: 10px;">Edit CLAUDE.md</button>
  `;
}

function renderMemoryFile(fileName) {
  const file = memoryState.memoryData.memoryFiles.find(f => f.name === fileName);
  if (!file) return;

  // Render as markdown — do NOT add file-card-content--raw for markdown files
  const content = renderMarkdownToHtml(file.content);

  memoryContentContainer.innerHTML = `
    <div class="file-card">
      <div class="file-card-header">
        <span class="file-card-title">${escapeHtml(fileName)}</span>
      </div>
      <div class="file-card-content expanded markdown-content">${content}</div>
    </div>
    <button onclick="openEditModal('${escapeHtml(fileName)}', 'memoryFile')" style="margin-top: 10px;">Edit ${escapeHtml(fileName)}</button>
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
  let html = '<div class="memory-grid" id="dirGrid">';

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

    const cardLabel = escapeHtml('Open ' + title);

    html += `
      <div class="memory-card"
           tabindex="0"
           role="button"
           aria-label="${cardLabel}"
           data-dir="${escapeHtml(dirName)}"
           data-file="${escapeHtml(file.name)}"
           data-search="${escapeHtml((title + ' ' + JSON.stringify(p.fields) + ' ' + p.rawContent).toLowerCase())}">
        <div class="memory-card-title">${escapeHtml(title)}</div>
        ${fieldsHtml}
        <div class="memory-card-preview">${escapeHtml(preview)}</div>
      </div>
    `;
  }

  html += `
    <div class="add-btn" onclick="openNewFileModal('${escapeHtml(dirName)}')">
      + Add to ${escapeHtml(dirName)}
    </div>
  </div>`;

  memoryContentContainer.innerHTML = html;

  // Wire up card clicks and keyboard activation (ARIA §7.5)
  memoryContentContainer.querySelectorAll('.memory-card').forEach(card => {
    const dirN = card.dataset.dir;
    const fileN = card.dataset.file;

    card.addEventListener('click', () => {
      window.openFileModal(dirN, fileN);
    });

    card.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        window.openFileModal(dirN, fileN);
      }
    });
  });
}

function renderMemoryDirectoryFlat(dirName, files) {
  let html = '<div id="dirGrid">';

  for (const file of files) {
    const p = file.parsed;

    // Render fields as a key-value table
    const fieldEntries = Object.entries(p.fields);
    if (fieldEntries.length > 0) {
      html += `<div class="file-card" data-file-dir="${escapeHtml(dirName)}" data-file-name="${escapeHtml(file.name)}" style="margin-bottom: 16px;"><table class="memory-flat-table"><tbody>`;
      for (const [key, value] of fieldEntries) {
        html += `<tr data-search="${escapeHtml((key + ' ' + value).toLowerCase())}"><td>${escapeHtml(key)}</td><td data-editable="field" data-field-key="${escapeHtml(key)}">${escapeHtml(value)}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }

    // Render parsed tables (teams, tools, etc.) as proper HTML tables
    for (let ti = 0; ti < p.tables.length; ti++) {
      const table = p.tables[ti];
      html += `<div class="file-card" data-file-dir="${escapeHtml(dirName)}" data-file-name="${escapeHtml(file.name)}" style="margin-bottom: 16px;"><table class="memory-flat-table"><thead><tr>`;
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
      html += `<div class="file-card" data-file-dir="${escapeHtml(dirName)}" data-file-name="${escapeHtml(file.name)}" style="margin-bottom: 16px;"><table class="memory-flat-table"><thead><tr><th colspan="2">${escapeHtml(sectionName)}</th></tr></thead><tbody>`;
      for (const line of lines) {
        const cleanLine = line.replace(/^[-*]\s*/, '').replace(/\*\*(.+?)\*\*/g, '$1').trim();
        if (!cleanLine) continue;
        html += `<tr data-search="${escapeHtml((sectionName + ' ' + cleanLine).toLowerCase())}"><td colspan="2" data-editable="section-line" data-section-name="${escapeHtml(sectionName)}" data-original-line="${escapeHtml(line)}">${escapeHtml(cleanLine)}</td></tr>`;
      }
      html += `</tbody></table></div>`;
    }
  }

  html += '</div>';
  memoryContentContainer.innerHTML = html;
}

export function initMemory() {
  // Registered here (not at module top level) so it runs after all modules have
  // finished evaluating — avoids a TDZ error in the state.js <-> search.js <->
  // memory-renderer.js import cycle (the setter touches a state.js `let` binding).
  setMemoryInfoGetter(() => ({
    handle: memoryState.memoryDirHandle,
    name: memoryState.memoryDirHandle ? memoryState.memoryDirHandle.name : (memoryState.memoryData ? 'memory (read-only)' : '')
  }));

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

/**
 * Build a short highlighted snippet from rawText around the first occurrence
 * of term. Returns an HTML string with <mark> wrapping the matched term.
 * All text is escaped before injection.
 */
function buildSnippet(rawText, term, maxLen = 120) {
  const escaped = escapeHtml(rawText);
  const escapedTerm = escapeHtml(term);
  // Regex-escape the (already HTML-escaped) term so special chars don't break RegExp
  const reTerm = escapedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(reTerm, 'i');

  // Find match index in the escaped text
  const match = escaped.match(re);
  if (!match) {
    // Term not in escaped version — just return a plain snippet
    return escaped.substring(0, maxLen) + (escaped.length > maxLen ? '…' : '');
  }

  const idx = escaped.indexOf(match[0]);
  const start = Math.max(0, idx - 40);
  const end = Math.min(escaped.length, idx + match[0].length + 80);
  const slice = (start > 0 ? '…' : '') + escaped.substring(start, end) + (end < escaped.length ? '…' : '');

  // Replace all occurrences of term (case-insensitive) with <mark> wrapped version
  return slice.replace(new RegExp(reTerm, 'gi'), m => '<mark>' + m + '</mark>');
}

/**
 * Render aggregated search results across ALL memory sources into
 * #memoryContentContainer. Does NOT call renderMemoryContent — no loop.
 */
export function renderMemorySearchResults(term) {
  if (!term) return;

  const lTerm = term.toLowerCase();
  const results = []; // { group, label, title, searchText, rawText, onClick }

  // ── Overview (CLAUDE.md) ──
  if (memoryState.memoryData.claudeMd) {
    const { content } = memoryState.memoryData.claudeMd;
    if ((content).toLowerCase().includes(lTerm)) {
      results.push({
        group: 'Overview',
        label: 'Overview',
        title: 'CLAUDE.md',
        rawText: content,
        onClick: () => window.openEditModal('CLAUDE.md', 'claudeMd')
      });
    }
  }

  // ── memoryFiles: Core / Feedback / Reference ──
  const coreResults = [];
  const feedbackResults = [];
  const referenceResults = [];

  for (const file of memoryState.memoryData.memoryFiles) {
    const haystack = (file.name + ' ' + file.content).toLowerCase();
    if (!haystack.includes(lTerm)) continue;
    const entry = {
      label: formatTabLabel(file.name),
      title: getDisplayName(file.name),
      rawText: file.content,
      fileName: file.name,
      onClick: () => window.openEditModal(file.name, 'memoryFile')
    };
    const cls = classifyFile(file.name);
    if (cls === 'feedback') feedbackResults.push(entry);
    else if (cls === 'reference') referenceResults.push(entry);
    else coreResults.push(entry);
  }

  if (coreResults.length)     results.push(...coreResults.map(e => ({ ...e, group: 'Core' })));
  if (feedbackResults.length) results.push(...feedbackResults.map(e => ({ ...e, group: 'Feedback' })));
  if (referenceResults.length) results.push(...referenceResults.map(e => ({ ...e, group: 'Reference' })));

  // ── memoryDirs: alphabetical ──
  const dirNames = Object.keys(memoryState.memoryData.memoryDirs).sort();
  for (const dirName of dirNames) {
    const files = memoryState.memoryData.memoryDirs[dirName] || [];
    for (const file of files) {
      const p = file.parsed;
      const title = p.title || getDisplayName(file.name);
      const searchText = (title + ' ' + JSON.stringify(p.fields) + ' ' + p.rawContent).toLowerCase();
      if (!searchText.includes(lTerm)) continue;
      const dirLabel = dirName.charAt(0).toUpperCase() + dirName.slice(1);
      results.push({
        group: dirLabel,
        label: dirLabel,
        title,
        rawText: p.rawContent,
        dirName,
        fileName: file.name,
        onClick: () => window.openFileModal(dirName, file.name)
      });
    }
  }

  // ── Render ──
  if (results.length === 0) {
    memoryContentContainer.innerHTML =
      '<div class="memory-search-empty">No memory entries match &#8220;' +
      escapeHtml(term) +
      '&#8221;</div>';
    return;
  }

  // Group by group label, preserving insertion order
  const groups = [];
  const groupMap = {};
  for (const r of results) {
    if (!groupMap[r.group]) {
      groupMap[r.group] = [];
      groups.push(r.group);
    }
    groupMap[r.group].push(r);
  }

  let html = '<div class="memory-search-results">';
  let flatIdx = 0;
  for (const groupName of groups) {
    const items = groupMap[groupName];
    html += '<div class="memory-search-group">';
    html += '<div class="memory-search-group-header">' +
      escapeHtml(groupName) +
      '<span class="memory-search-group-count">' + items.length + '</span>' +
      '</div>';
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const snippet = buildSnippet(item.rawText, term);
      html += '<div class="memory-search-result" tabindex="0" role="button"' +
        ' aria-label="' + escapeHtml('Open ' + item.title) + '"' +
        ' data-result-index="' + flatIdx + '">' +
        '<div class="memory-search-result-breadcrumb">' + escapeHtml(item.label) + '</div>' +
        '<div class="memory-search-result-title">' + escapeHtml(item.title) + '</div>' +
        '<div class="memory-search-result-snippet">' + snippet + '</div>' +
        '</div>';
      flatIdx++;
    }
    html += '</div>';
  }
  html += '</div>';

  memoryContentContainer.innerHTML = html;

  // Wire up click + keyboard activation for each result card
  // Use a flat integer index so querySelector never needs to escape group names
  let resultIdx = 0;
  for (const groupName of groups) {
    const items = groupMap[groupName];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const card = memoryContentContainer.querySelector(
        '[data-result-index="' + resultIdx + '"]'
      );
      if (!card) { resultIdx++; continue; }
      card.addEventListener('click', item.onClick);
      card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          item.onClick();
        }
      });
      resultIdx++;
    }
  }
}

export { loadMemoryFromHandle, loadMemoryFromHttpData, loadMemoryDirectory, renderMemory, renderMemoryContent };

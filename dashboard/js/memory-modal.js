// memory-modal.js - Modal CRUD operations

import { escapeHtml, parseMemoryMarkdown, renderMarkdownToHtml, getDisplayName } from './memory-parser.js';
import { renderMemory, memoryState } from './memory-renderer.js';
import { showStatus } from './state.js';
import { httpSave } from './http-loader.js';

const modalOverlay = document.getElementById('modalOverlay');

function openFileModal(dirName, fileName) {
  const files = memoryState.memoryData.memoryDirs[dirName];
  const file = files.find(f => f.name === fileName);
  if (!file) return;

  document.getElementById('modalTitle').textContent = getDisplayName(fileName);
  document.getElementById('modalBody').innerHTML = `
    <div class="markdown-content" style="margin-bottom: 20px;">
      ${renderMarkdownToHtml(file.content)}
    </div>
    <div class="form-group">
      <label>Edit Raw Markdown</label>
      <textarea id="editContent">${escapeHtml(file.content)}</textarea>
    </div>
  `;

  modalOverlay.classList.add('visible');
  modalOverlay.dataset.type = 'dirFile';
  modalOverlay.dataset.dirName = dirName;
  modalOverlay.dataset.fileName = fileName;
}

function openNewFileModal(dirName) {
  document.getElementById('modalTitle').textContent = `Add to ${dirName}`;

  let template = '# New Entry\n\n';
  const existingFiles = memoryState.memoryData.memoryDirs[dirName];
  if (existingFiles && existingFiles.length > 0) {
    const sample = existingFiles[0].parsed;
    for (const key of Object.keys(sample.fields)) {
      template += `**${key}:** \n`;
    }
    template += '\n';
    for (const section of Object.keys(sample.sections)) {
      if (section !== '_intro') {
        template += `## ${section}\n\n`;
      }
    }
  }

  document.getElementById('modalBody').innerHTML = `
    <div class="form-group">
      <label>Filename (without .md)</label>
      <input type="text" id="newFileName" placeholder="my-new-entry" style="width: 100%; background: var(--bg-secondary); border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; color: var(--text-primary); font-size: 14px; font-family: inherit; margin-bottom: 16px;">
    </div>
    <div class="form-group">
      <label>Content</label>
      <textarea id="editContent">${escapeHtml(template)}</textarea>
    </div>
  `;

  modalOverlay.classList.add('visible');
  modalOverlay.dataset.type = 'newDirFile';
  modalOverlay.dataset.dirName = dirName;
}

function openEditModal(fileName, type) {
  let content = '';
  if (type === 'claudeMd') {
    content = memoryState.memoryData.claudeMd.content;
  } else if (type === 'memoryFile') {
    const file = memoryState.memoryData.memoryFiles.find(f => f.name === fileName);
    if (file) content = file.content;
  }

  document.getElementById('modalTitle').textContent = `Edit ${fileName}`;
  document.getElementById('modalBody').innerHTML = `
    <div class="form-group">
      <label>Content</label>
      <textarea id="editContent" style="min-height: 400px;">${escapeHtml(content)}</textarea>
    </div>
  `;

  modalOverlay.classList.add('visible');
  modalOverlay.dataset.type = type;
  modalOverlay.dataset.fileName = fileName;
}

function closeModal() {
  modalOverlay.classList.remove('visible');
}

async function saveModal() {
  const type = modalOverlay.dataset.type;
  const content = document.getElementById('editContent').value;
  const useHttp = !memoryState.memoryDirHandle;

  try {
    if (type === 'claudeMd') {
      memoryState.memoryData.claudeMd.content = content;
      if (useHttp) {
        await httpSave('CLAUDE.md', content);
      } else {
        const writable = await memoryState.memoryData.claudeMd.fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      }
      showStatus('Saved CLAUDE.md');

    } else if (type === 'memoryFile') {
      const fileName = modalOverlay.dataset.fileName;
      const file = memoryState.memoryData.memoryFiles.find(f => f.name === fileName);
      if (file) {
        file.content = content;
        if (useHttp) {
          await httpSave('memory/' + fileName, content);
        } else {
          const writable = await file.fileHandle.createWritable();
          await writable.write(content);
          await writable.close();
        }
        showStatus('Saved ' + fileName);
      }

    } else if (type === 'dirFile') {
      const dirName = modalOverlay.dataset.dirName;
      const fileName = modalOverlay.dataset.fileName;
      const files = memoryState.memoryData.memoryDirs[dirName];
      const file = files.find(f => f.name === fileName);
      if (file) {
        file.content = content;
        file.parsed = parseMemoryMarkdown(content);
        if (useHttp) {
          await httpSave('memory/' + dirName + '/' + fileName, content);
        } else {
          const writable = await file.fileHandle.createWritable();
          await writable.write(content);
          await writable.close();
        }
        showStatus('Saved ' + fileName);
      }

    } else if (type === 'globalMemoryFile') {
      const projectEncoded = modalOverlay.dataset.projectEncoded;
      const filePath = modalOverlay.dataset.filePath;
      // Save via global-save endpoint, path relative to ~/.claude/
      const savePath = 'projects/' + projectEncoded + '/' + filePath;
      const resp = await fetch('/api/global-save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: savePath, content })
      });
      if (!resp.ok) throw new Error('Save failed');
      showStatus('Saved ' + filePath.split('/').pop());
      // Reload global memory to refresh cards
      const { loadGlobalMemory } = await import('./global-memory.js');
      await loadGlobalMemory();

    } else if (type === 'newDirFile') {
      const dirName = modalOverlay.dataset.dirName;
      let fileName = document.getElementById('newFileName').value.trim();
      if (!fileName) { showStatus('Please enter a filename'); return; }
      if (!fileName.endsWith('.md')) fileName += '.md';

      if (useHttp) {
        await httpSave('memory/' + dirName + '/' + fileName, content);
      } else {
        const memoryDir = await memoryState.memoryDirHandle.getDirectoryHandle('memory');
        const subDir = await memoryDir.getDirectoryHandle(dirName, { create: true });
        const fileHandle = await subDir.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
      }

      if (!memoryState.memoryData.memoryDirs[dirName]) {
        memoryState.memoryData.memoryDirs[dirName] = [];
      }
      memoryState.memoryData.memoryDirs[dirName].push({
        name: fileName,
        content: content,
        fileHandle: null,
        dirHandle: null,
        parsed: parseMemoryMarkdown(content)
      });

      showStatus('Created ' + fileName);
    }

    closeModal();
    renderMemory();

  } catch (e) {
    showStatus('Error saving: ' + e.message);
  }
}

export function initModal() {
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalSave').addEventListener('click', saveModal);

  const modalOverlay = document.getElementById('modalOverlay');
  modalOverlay.addEventListener('click', (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Expose to window for onclick handlers
  window.openFileModal = openFileModal;
  window.openNewFileModal = openNewFileModal;
  window.openEditModal = openEditModal;
}

// task-templates.js — Saved create-task templates (localStorage).

import { openCreateTaskModal, applyTemplateToDraft } from './task-create.js';
import { showStatus } from './state.js';

const KEY = 'dashboard.taskTemplates';

export function loadTemplates() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function persist(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch { /* ignore */ }
}

/**
 * @param {{ name: string, draft: object }} template
 */
export function addTemplate(template) {
  const list = loadTemplates();
  const id = `tpl_${Date.now().toString(36)}`;
  list.push({
    id,
    name: String(template.name || 'Untitled').trim() || 'Untitled',
    draft: template.draft || {},
  });
  persist(list);
  return id;
}

export function removeTemplate(id) {
  persist(loadTemplates().filter(t => t.id !== id));
}

export function renderTemplatesBar() {
  const bar = document.getElementById('taskTemplatesBar');
  if (!bar) return;
  const list = loadTemplates();
  bar.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'task-templates-label';
  label.textContent = 'Templates';
  bar.appendChild(label);

  list.forEach(tpl => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'task-template-pill';
    pill.textContent = tpl.name;
    pill.title = 'Create from template';
    pill.addEventListener('click', () => {
      openCreateTaskModal(tpl.draft?.section);
      if (typeof applyTemplateToDraft === 'function') {
        applyTemplateToDraft(tpl.draft);
      }
    });
    const x = document.createElement('span');
    x.className = 'task-template-remove';
    x.textContent = '×';
    x.title = 'Delete template';
    x.addEventListener('click', (e) => {
      e.stopPropagation();
      removeTemplate(tpl.id);
      renderTemplatesBar();
      showStatus('Template deleted');
    });
    pill.appendChild(x);
    bar.appendChild(pill);
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'task-template-save';
  saveBtn.textContent = 'Save as template…';
  saveBtn.title = 'Save current create-form defaults as a template (open New Task first, fill fields, then save)';
  saveBtn.addEventListener('click', () => {
    // Prefer snapshot from open create modal via global hook
    const snap = typeof window.__getCreateDraftSnapshot === 'function'
      ? window.__getCreateDraftSnapshot()
      : null;
    if (!snap) {
      showStatus('Open New Task, fill fields, then Save as template');
      openCreateTaskModal();
      return;
    }
    const name = window.prompt('Template name');
    if (!name || !name.trim()) return;
    addTemplate({ name: name.trim(), draft: snap });
    renderTemplatesBar();
    showStatus('Template saved');
  });
  bar.appendChild(saveBtn);
}

export function initTaskTemplates() {
  renderTemplatesBar();
}

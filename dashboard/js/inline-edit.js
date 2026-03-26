import { memoryState, renderMemoryContent } from './memory-renderer.js';
import { parseMemoryMarkdown } from './memory-parser.js';
import { httpSave } from './http-loader.js';
import { showStatus } from './state.js';

let activeEditor = null;

/**
 * Initialize inline editing for memory context files
 */
export function initInlineEdit() {
  const container = document.getElementById('memoryContentContainer');
  if (!container) return;

  // Use capture phase to intercept clicks before modal handling
  container.addEventListener('click', (event) => {
    // Don't intercept clicks inside an active editor (input, save/cancel buttons)
    if (event.target.closest('.editing')) return;

    const editableElement = event.target.closest('[data-editable]');
    if (editableElement) {
      event.stopPropagation();
      event.preventDefault();
      activateEditor(editableElement, event);
    }
  }, true);
}

/**
 * Activate inline editor for a clicked element
 */
function activateEditor(element, event) {
  // Cancel any existing editor
  if (activeEditor) {
    cancelEdit();
  }

  const originalText = element.textContent.trim();
  const isLongText = originalText.length > 60 || originalText.includes('\n');

  element.classList.add('editing');
  document.getElementById('memoryContentContainer').classList.add('inline-editing');

  // Create input or textarea
  let input;
  if (isLongText) {
    input = document.createElement('textarea');
    input.rows = 2;
  } else {
    input = document.createElement('input');
    input.type = 'text';
  }
  input.className = 'inline-edit-input';
  input.value = originalText;

  // Create action buttons
  const actionsDiv = document.createElement('div');
  actionsDiv.className = 'inline-edit-actions';
  actionsDiv.innerHTML = `
    <button class="inline-edit-save">Save</button>
    <button class="inline-edit-cancel">Cancel</button>
  `;

  // Replace content and append buttons
  element.innerHTML = '';
  element.appendChild(input);
  element.appendChild(actionsDiv);

  // Store editor state
  activeEditor = {
    element,
    input,
    originalText,
    actionsDiv
  };

  // Focus and select
  input.focus();
  if (input.select) input.select();

  // Wire up button handlers
  const saveBtn = actionsDiv.querySelector('.inline-edit-save');
  const cancelBtn = actionsDiv.querySelector('.inline-edit-cancel');

  saveBtn.addEventListener('click', () => {
    saveEdit(element, originalText, input);
  });

  cancelBtn.addEventListener('click', () => {
    cancelEdit();
  });

  // Wire up keyboard handlers
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelEdit();
    } else if (e.key === 'Enter' && input.tagName === 'INPUT') {
      e.preventDefault();
      saveEdit(element, originalText, input);
    } else if (e.key === 'Enter' && e.ctrlKey && input.tagName === 'TEXTAREA') {
      e.preventDefault();
      saveEdit(element, originalText, input);
    }
  });
}

/**
 * Cancel the current edit
 */
function cancelEdit() {
  if (!activeEditor) return;

  const { element, originalText } = activeEditor;
  element.textContent = originalText;
  element.classList.remove('editing');
  document.getElementById('memoryContentContainer').classList.remove('inline-editing');
  activeEditor = null;
}

/**
 * Save the edit
 */
async function saveEdit(element, originalText, inputElement) {
  const newValue = inputElement.value.trim();

  // Unchanged - just cancel
  if (newValue === originalText) {
    cancelEdit();
    return;
  }

  // Find parent file-card to get dir and filename
  const fileCard = element.closest('[data-file-dir][data-file-name]');
  if (!fileCard) {
    showStatus('Error: Could not find file info', 'error');
    return;
  }

  const dir = fileCard.getAttribute('data-file-dir');
  const fileName = fileCard.getAttribute('data-file-name');

  // Find the file in state
  const files = memoryState.memoryData.memoryDirs[dir];
  if (!files) {
    showStatus('Error: Directory not found', 'error');
    return;
  }

  const file = files.find(f => f.name === fileName);
  if (!file) {
    showStatus('Error: File not found', 'error');
    return;
  }

  const editableType = element.getAttribute('data-editable');
  const oldContent = file.content;
  let newContent = oldContent;

  try {
    if (editableType === 'field') {
      const fieldKey = element.getAttribute('data-field-key');
      newContent = applyFieldEdit(newContent, fieldKey, newValue);
    } else if (editableType === 'table-cell') {
      const tableIndex = parseInt(element.getAttribute('data-table-index'), 10);
      const rowIndex = parseInt(element.getAttribute('data-row-index'), 10);
      const colIndex = parseInt(element.getAttribute('data-col-index'), 10);
      newContent = applyTableCellEdit(newContent, tableIndex, rowIndex, colIndex, newValue);
    } else if (editableType === 'section-line') {
      const originalLine = element.getAttribute('data-original-line');
      newContent = applySectionLineEdit(newContent, originalLine, newValue);
    }

    // Update file state
    file.content = newContent;
    file.parsed = parseMemoryMarkdown(newContent);

    // Save to server
    const filePath = `memory/${dir}/${fileName}`;
    await httpSave(filePath, newContent);

    // Clear editor state before re-render
    activeEditor = null;
    document.getElementById('memoryContentContainer').classList.remove('inline-editing');

    // Re-render content only (preserve active tab)
    renderMemoryContent();
    showStatus('Saved ' + fileName);
  } catch (err) {
    showStatus('Error: ' + err.message);
    // Restore original on failure
    file.content = oldContent;
    file.parsed = parseMemoryMarkdown(oldContent);
    cancelEdit();
  }
}

/**
 * Apply a field edit to raw markdown content
 */
function applyFieldEdit(rawContent, key, newValue) {
  const escapedKey = escapeRegex(key);
  const pattern = new RegExp(`\\*\\*${escapedKey}:\\*\\*\\s*(.*)`, 'm');
  return rawContent.replace(pattern, `**${key}:** ${newValue}`);
}

/**
 * Apply a table cell edit to raw markdown content
 */
function applyTableCellEdit(rawContent, tableIndex, rowIndex, colIndex, newValue) {
  const tablePattern = /\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g;
  let currentTableIndex = 0;
  let result = rawContent;

  result = result.replace(tablePattern, (match, headerLine, bodyLines) => {
    if (currentTableIndex !== tableIndex) {
      currentTableIndex++;
      return match;
    }

    // Parse header
    const headerCells = headerLine.split('|').map(c => c.trim()).filter(c => c);

    // Parse body rows
    const bodyRows = bodyLines
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.split('|').map(c => c.trim()).filter(c => c));

    // Edit the target cell
    if (rowIndex < bodyRows.length && colIndex < bodyRows[rowIndex].length) {
      bodyRows[rowIndex][colIndex] = newValue;
    }

    // Reconstruct table
    let newTable = '| ' + headerCells.join(' | ') + ' |\n';
    newTable += '|' + headerCells.map(() => ' --- ').join('|') + '|\n';
    bodyRows.forEach(row => {
      newTable += '| ' + row.join(' | ') + ' |\n';
    });

    currentTableIndex++;
    return newTable;
  });

  return result;
}

/**
 * Apply a section line edit to raw markdown content
 */
function applySectionLineEdit(rawContent, originalLine, newValue) {
  // Detect if the original line was a bullet point
  const bulletMatch = originalLine.match(/^([-*]\s*)/);
  const prefix = bulletMatch ? bulletMatch[1] : '';

  // Reconstruct the new line preserving bullet prefix
  // Also preserve any **bold** patterns that were in the original
  const boldMatch = originalLine.match(/\*\*(.+?)\*\*/);
  let newLine;
  if (boldMatch) {
    // If original had **bold** text, try to preserve that pattern
    // Replace the non-bold content
    const afterBold = originalLine.replace(/^[-*]\s*/, '').replace(/\*\*(.+?)\*\*\s*/, '').trim();
    if (afterBold && newValue.includes(boldMatch[1])) {
      // User kept the bold text, use as-is
      newLine = prefix + newValue;
    } else {
      // Simple replacement - just use the new value with prefix
      newLine = prefix + newValue;
    }
  } else {
    newLine = prefix + newValue;
  }

  // Find and replace the original line in raw content
  const index = rawContent.indexOf(originalLine);
  if (index === -1) return rawContent;
  return rawContent.substring(0, index) + newLine + rawContent.substring(index + originalLine.length);
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// home-keys.js — Home keyboard: number keys pick a view, Esc clears the selection, arrows move inside
// a tab list (roving tabindex: one Tab stop per list, so Tab hops zone to zone).

import { homeViews, setView, hasSelection, clearSelection } from './home-state.js';
import { isTaskDetailOpen } from './task-detail.js';
import { isTaskCreateOpen } from './task-create.js';

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** A modal or dialog is above the page: its own keys win. */
function somethingOnTop() {
  if (isTaskDetailOpen() || isTaskCreateOpen()) return true;
  return !!document.querySelector('dialog[open], .modal-overlay.visible, .modal.visible');
}

/**
 * Listen once for Home's page keys.
 * @param {() => boolean} isActive true while the Home tab shows
 */
export function installHomeKeys(isActive) {
  document.addEventListener('keydown', (e) => {
    if (!isActive() || e.defaultPrevented) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingTarget(e.target) || somethingOnTop()) return;
    if (e.key === 'Escape') {
      if (!hasSelection()) return;
      e.preventDefault();
      clearSelection();
      return;
    }
    if (/^[1-9]$/.test(e.key) && !e.shiftKey) {
      const view = homeViews().find(v => v.key === Number(e.key));
      if (!view) return;
      e.preventDefault();
      setView(view.id);
    }
  });
}

/**
 * Arrow keys, Home and End inside a tab list move focus and select (automatic activation).
 * @param {HTMLElement} list the role=tablist element
 * @param {(id: string) => void} onSelect
 */
export function rovingTabs(list, onSelect) {
  list.addEventListener('keydown', (e) => {
    const tabs = [...list.querySelectorAll('[role="tab"]:not([disabled])')];
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let next = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
    onSelect(tabs[next].dataset.id);
  });
}

/** Give the selected tab the only tab stop of its list. */
export function markSelectedTab(list, id) {
  for (const tab of list.querySelectorAll('[role="tab"]')) {
    const on = tab.dataset.id === id;
    tab.setAttribute('aria-selected', on ? 'true' : 'false');
    tab.tabIndex = on ? 0 : -1;
    tab.classList.toggle('active', on);
  }
}

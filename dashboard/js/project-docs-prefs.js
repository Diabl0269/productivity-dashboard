// project-docs-prefs.js — localStorage prefs for project documentation panel

import { DEFAULT_DOC_FILTER_PATTERNS, parseDocFilterPatterns } from '../../shared/project-docs.js';

const FILTER_PATTERNS_KEY = 'dashboard.projects.docFilterPatterns';
const SHOW_ALL_KEY = 'dashboard.projects.docShowAllByProject';

export function readDocFilterPatterns() {
  try {
    return parseDocFilterPatterns(localStorage.getItem(FILTER_PATTERNS_KEY) || '');
  } catch {
    return [...DEFAULT_DOC_FILTER_PATTERNS];
  }
}

export function writeDocFilterPatterns(text) {
  try {
    const patterns = parseDocFilterPatterns(text);
    localStorage.setItem(FILTER_PATTERNS_KEY, patterns.join('\n'));
  } catch { /* ignore */ }
}

export function readDocShowAll(projectId) {
  try {
    const all = JSON.parse(localStorage.getItem(SHOW_ALL_KEY) || '{}');
    return !!all[projectId];
  } catch {
    return false;
  }
}

export function writeDocShowAll(projectId, value) {
  try {
    const all = JSON.parse(localStorage.getItem(SHOW_ALL_KEY) || '{}');
    if (value) all[projectId] = true;
    else delete all[projectId];
    localStorage.setItem(SHOW_ALL_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

export function formatDocFilterPatternsForInput() {
  return readDocFilterPatterns().join('\n');
}

// task-fields.js — Shared helpers for due dates, blocked state, labels, links, WIP.

import { escapeHtml, findTaskByTaskId } from './ticket-types.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Local calendar YYYY-MM-DD. */
export function todayYmd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse YYYY-MM-DD as local midnight; null if invalid. */
export function parseYmd(ymd) {
  if (!ymd || !DATE_RE.test(ymd)) return null;
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

/** Days from today to dueDate (negative = overdue). Null if no/invalid due. */
export function daysUntilDue(dueDate, now = new Date()) {
  const due = parseYmd(dueDate);
  if (!due) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((due - today) / (1000 * 60 * 60 * 24));
}

/**
 * Urgency bucket for a due date.
 * @returns {'overdue'|'today'|'soon'|'later'|null}
 */
export function dueUrgency(dueDate, now = new Date()) {
  const days = daysUntilDue(dueDate, now);
  if (days == null) return null;
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 3) return 'soon';
  return 'later';
}

export function formatDueLabel(dueDate, now = new Date()) {
  const days = daysUntilDue(dueDate, now);
  if (days == null) return '';
  if (days < 0) return days === -1 ? '1d overdue' : `${Math.abs(days)}d overdue`;
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return dueDate;
}

/** HTML for due badge on cards/list. Empty string if no dueDate. */
export function dueBadgeHtml(task) {
  if (!task.dueDate) return '';
  const urgency = dueUrgency(task.dueDate);
  const cls = urgency === 'overdue' || urgency === 'today'
    ? 'due-badge due-overdue'
    : urgency === 'soon'
      ? 'due-badge due-soon'
      : 'due-badge';
  const label = formatDueLabel(task.dueDate);
  return `<span class="${cls}" title="Due ${escapeHtml(task.dueDate)}">${escapeHtml(label)}</span>`;
}

/** Flat map of taskId → task across all sections. */
export function indexTasksById(tasksBySection) {
  const map = new Map();
  if (!tasksBySection) return map;
  for (const list of Object.values(tasksBySection)) {
    for (const t of list || []) {
      if (t.taskId) map.set(t.taskId, t);
    }
  }
  return map;
}

/**
 * Peer deps that are still unresolved (not done/archive/checked).
 * @returns {string[]} unresolved task ids
 */
export function unresolvedBlockedBy(task, tasksBySection) {
  const deps = Array.isArray(task.blockedBy) ? task.blockedBy : [];
  if (deps.length === 0) return [];
  const byId = indexTasksById(tasksBySection);
  return deps.filter(id => {
    const dep = byId.get(id);
    if (!dep) return true; // missing = still blocking
    if (dep.checked) return false;
    const sec = dep.section || '';
    return sec !== 'done' && sec !== 'archive';
  });
}

/** True if flagged blocked OR has unresolved peer deps. */
export function isEffectivelyBlocked(task, tasksBySection) {
  if (task.blocked) return true;
  return unresolvedBlockedBy(task, tasksBySection).length > 0;
}

export function labelsHtml(task) {
  const labels = Array.isArray(task.labels) ? task.labels : [];
  if (labels.length === 0) return '';
  return `<span class="task-labels">${labels.map(l =>
    `<span class="task-label-chip">${escapeHtml(l)}</span>`
  ).join('')}</span>`;
}

export function linksAffordanceHtml(task) {
  const links = Array.isArray(task.links) ? task.links : [];
  if (links.length === 0) return '';
  const n = links.length;
  const title = links.map(l => l.label || l.url).join('\n');
  return `<span class="task-links-badge" title="${escapeHtml(title)}">${n} link${n === 1 ? '' : 's'}</span>`;
}

export function blockedIndicatorHtml(task, tasksBySection) {
  if (!isEffectivelyBlocked(task, tasksBySection)) return '';
  const waiting = task.waitingOn ? `Waiting on ${task.waitingOn}` : 'Blocked';
  const deps = unresolvedBlockedBy(task, tasksBySection);
  const depHint = deps.length ? ` (deps: ${deps.join(', ')})` : '';
  return `<span class="task-blocked-badge" title="${escapeHtml(waiting + depHint)}">Blocked</span>`;
}

const DAY_MINUTES = 8 * 60;

/** Parse human estimate ("2h", "30m", "1d") → minutes. */
export function parseEstimate(input) {
  if (input == null || input === '') return null;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input);
  }
  const s = String(input).trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const day = s.match(/^(\d+(?:\.\d+)?)d(.*)$/);
  if (day) {
    let total = Math.round(parseFloat(day[1]) * DAY_MINUTES);
    if (day[2]) {
      const more = parseEstimate(day[2]);
      if (more == null && day[2]) return null;
      if (more) total += more;
    }
    return total;
  }
  const hm = s.match(/^(\d+(?:\.\d+)?)h(?:(\d+)m)?$/);
  if (hm) {
    let total = Math.round(parseFloat(hm[1]) * 60);
    if (hm[2]) total += parseInt(hm[2], 10);
    return total;
  }
  const mOnly = s.match(/^(\d+)m$/);
  if (mOnly) return parseInt(mOnly[1], 10);
  return null;
}

/** Format minutes → "1h30m" / "1d" / "30m". */
export function formatEstimate(minutes) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  let m = Math.round(Number(minutes));
  if (m <= 0) return '0m';
  const parts = [];
  if (m >= DAY_MINUTES) {
    parts.push(`${Math.floor(m / DAY_MINUTES)}d`);
    m %= DAY_MINUTES;
  }
  if (m >= 60) {
    parts.push(`${Math.floor(m / 60)}h`);
    m %= 60;
  }
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join('');
}

export function estimateBadgeHtml(task) {
  if (!task.estimateMinutes) return '';
  const label = formatEstimate(task.estimateMinutes);
  return `<span class="task-estimate-badge" title="Estimate ${escapeHtml(label)}">${escapeHtml(label)}</span>`;
}

export function loggedBadgeHtml(task) {
  if (!task.loggedMinutes) return '';
  const logged = formatEstimate(task.loggedMinutes);
  const est = task.estimateMinutes ? formatEstimate(task.estimateMinutes) : null;
  const title = est ? `Logged ${logged} / est ${est}` : `Logged ${logged}`;
  return `<span class="task-logged-badge" title="${escapeHtml(title)}">${escapeHtml(logged)}</span>`;
}

/** True when Settings → Hide corporate is on (DOM attribute). */
export function isCorporateUiHidden() {
  try {
    return document.documentElement.getAttribute('data-hide-corporate') === 'true'
      || document.documentElement.getAttribute('data-hide-sprints') === 'true';
  } catch {
    return false;
  }
}

/** Mark an element as corporate UI and hide it when the pref is on. */
export function markCorporateUi(el) {
  if (!el) return el;
  el.setAttribute('data-corporate-ui', '');
  if (isCorporateUiHidden()) el.hidden = true;
  return el;
}

export function assigneeChipHtml(task) {
  if (isCorporateUiHidden()) return '';
  if (!task.assignee) return '';
  return `<span class="task-assignee-chip" title="Assignee">${escapeHtml(task.assignee)}</span>`;
}

export function jiraKeyBadgeHtml(task) {
  // Prefer first-class issue URL badge; fall back to legacy jiraKey (corporate)
  const issue = issueBadgeHtml(task);
  if (issue) return issue;
  return '';
}

export function recurrenceBadgeHtml(task) {
  if (!task.recurrence || !task.recurrence.freq) return '';
  const iv = task.recurrence.interval > 1 ? `×${task.recurrence.interval}` : '';
  const label = `${task.recurrence.freq}${iv}`;
  return `<span class="task-recur-badge" title="Recurs ${escapeHtml(label)}">↻ ${escapeHtml(label)}</span>`;
}

const HISTORY_MAX = 50;
const NOTES_MAX = 100;

export function appendHistory(task, entry) {
  if (!task || !entry || !entry.event) return;
  if (!Array.isArray(task.history)) task.history = [];
  const row = {
    at: entry.at || new Date().toISOString(),
    event: String(entry.event),
  };
  if (entry.from != null && entry.from !== '') row.from = String(entry.from);
  if (entry.to != null && entry.to !== '') row.to = String(entry.to);
  if (entry.note != null && entry.note !== '') row.note = String(entry.note);
  task.history.push(row);
  if (task.history.length > HISTORY_MAX) task.history = task.history.slice(-HISTORY_MAX);
}

export function appendNote(task, text) {
  if (!task || !text || !String(text).trim()) return;
  if (!Array.isArray(task.notes)) task.notes = [];
  task.notes.push({ at: new Date().toISOString(), text: String(text).trim() });
  if (task.notes.length > NOTES_MAX) task.notes = task.notes.slice(-NOTES_MAX);
}

/** Soft WIP limit for a section from config. Null = no limit. */
export function wipLimitFor(sectionId) {
  const cfg = (typeof window !== 'undefined' && window.dashboardConfig) || {};
  if (cfg.wipLimits && typeof cfg.wipLimits === 'object') {
    const n = cfg.wipLimits[sectionId];
    if (typeof n === 'number' && n > 0) return n;
  }
  if (sectionId === 'in-progress' && typeof cfg.wipLimit === 'number' && cfg.wipLimit > 0) {
    return cfg.wipLimit;
  }
  return null;
}

/** Normalize optional arrays on a dashboard task object. */
export function ensureTaskFieldDefaults(task) {
  if (!Array.isArray(task.labels)) task.labels = [];
  if (!Array.isArray(task.links)) task.links = [];
  if (!Array.isArray(task.blockedBy)) task.blockedBy = [];
  if (!Array.isArray(task.history)) task.history = [];
  if (!Array.isArray(task.notes)) task.notes = [];
  if (task.blocked == null) task.blocked = false;
  if (task.dueDate == null) task.dueDate = null;
  if (task.startDate == null) task.startDate = null;
  if (task.jiraKey == null) task.jiraKey = null;
  if (task.issueUrl == null) task.issueUrl = null;
  if (task.project == null) task.project = null;
  if (task.energy == null) task.energy = null;
  if (task.snoozeUntil == null) task.snoozeUntil = null;
  if (!Array.isArray(task.timeEntries)) task.timeEntries = [];
  if (!Array.isArray(task.decisions)) task.decisions = [];
  if (task.waitingOn == null) task.waitingOn = null;
  if (task.assignee == null) task.assignee = null;
  if (task.estimateMinutes == null) task.estimateMinutes = null;
  if (task.loggedMinutes == null) task.loggedMinutes = null;
  if (task.recurrence == null) task.recurrence = null;
  return task;
}

/**
 * Advance a YYYY-MM-DD by recurrence {freq, interval}.
 * @returns {string|null}
 */
export function advanceDateByRecurrence(ymd, recurrence) {
  const base = parseYmd(ymd);
  if (!base || !recurrence || !recurrence.freq) return null;
  const interval = Math.max(1, Math.round(Number(recurrence.interval) || 1));
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  if (recurrence.freq === 'daily') d.setDate(d.getDate() + interval);
  else if (recurrence.freq === 'weekly') d.setDate(d.getDate() + 7 * interval);
  else if (recurrence.freq === 'monthly') d.setMonth(d.getMonth() + interval);
  else return null;
  return todayYmd(d);
}

/**
 * Rank score for Focus agenda (higher = more urgent).
 * overdue > due today > high priority unblocked in-progress > soon > rest
 * Skips snoozed tasks. Boosts next unblocked child of epics.
 */
export function focusScore(task, tasksBySection, now = new Date()) {
  if (!task || task.checked) return -Infinity;
  const sec = task.section || '';
  if (sec === 'done' || sec === 'archive' || sec === 'backlog' || sec === 'inbox') return -Infinity;
  if (isSnoozed(task, now)) return -Infinity;

  let score = 0;
  const urgency = dueUrgency(task.dueDate, now);
  if (urgency === 'overdue') score += 1000 + Math.abs(daysUntilDue(task.dueDate, now) || 0) * 10;
  else if (urgency === 'today') score += 800;
  else if (urgency === 'soon') score += 400;
  else if (urgency === 'later') score += 100;

  if (task.startDate) {
    const startDays = daysUntilDue(task.startDate, now);
    if (startDays != null && startDays > 0) score -= 50; // not started yet
  }

  const pri = task.priority || 'medium';
  if (pri === 'high') score += 200;
  else if (pri === 'medium') score += 80;
  else score += 20;

  if (sec === 'in-progress') score += 150;
  else if (sec === 'todo') score += 50;

  if (isEffectivelyBlocked(task, tasksBySection)) score -= 300;

  // Boost next-action children of epics
  if (task.parentId) {
    const byId = indexTasksById(tasksBySection);
    const parent = byId.get(task.parentId);
    if (parent && (parent.type === 'epic' || parent.type === 'Epic')) {
      const next = nextActionForEpic(parent, tasksBySection, now);
      if (next && next.taskId === task.taskId) score += 250;
    }
  }

  return score;
}

/** True if snoozeUntil is today or in the future. */
export function isSnoozed(task, now = new Date()) {
  if (!task?.snoozeUntil) return false;
  const days = daysUntilDue(task.snoozeUntil, now);
  return days != null && days >= 0;
}

/** Days since created/updated (for stale detection). */
export function daysSinceTouch(task, now = new Date()) {
  const ymd = task.updated || task.created;
  const d = parseYmd(ymd);
  if (!d) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - d) / (1000 * 60 * 60 * 24));
}

export function isStale(task, staleDays = 14, now = new Date()) {
  const sec = task.section || '';
  if (sec !== 'todo' && sec !== 'in-progress') return false;
  if (task.checked) return false;
  const days = daysSinceTouch(task, now);
  return days != null && days >= staleDays;
}

export function isWaitingReminder(task, waitingReminderDays = 5, now = new Date()) {
  if (!task.blocked && !task.waitingOn) return false;
  const days = daysSinceTouch(task, now);
  return days != null && days >= waitingReminderDays;
}

/**
 * Next unblocked, incomplete child of an epic (prefer todo/in-progress order).
 */
export function nextActionForEpic(epic, tasksBySection, now = new Date()) {
  if (!epic?.taskId) return null;
  const children = [];
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.parentId === epic.taskId && !t.checked) {
        const sec = t.section || '';
        if (sec === 'done' || sec === 'archive') continue;
        children.push(t);
      }
    }
  }
  children.sort((a, b) => {
    const order = { 'in-progress': 0, todo: 1, inbox: 2, backlog: 3 };
    return (order[a.section] ?? 9) - (order[b.section] ?? 9);
  });
  for (const c of children) {
    if (isSnoozed(c, now)) continue;
    if (isEffectivelyBlocked(c, tasksBySection)) continue;
    return c;
  }
  return children[0] || null;
}

/** Detect issue link kind for badge: github | jira | link */
export function issueLinkKind(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
    if (host.includes('atlassian.net') || host.includes('jira.')) return 'jira';
    return 'link';
  } catch {
    return null;
  }
}

export function issueBadgeHtml(task) {
  const url = task.issueUrl || null;
  if (url) {
    const kind = issueLinkKind(url) || 'link';
    // When corporate is hidden, avoid the "Jira" label — still link to the issue
    const label = kind === 'github' ? 'GH'
      : (kind === 'jira' && isCorporateUiHidden()) ? 'Issue'
      : kind === 'jira' ? 'Jira'
      : 'Link';
    return `<a class="issue-badge issue-${kind}" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(url)}" onclick="event.stopPropagation()">${label}</a>`;
  }
  if (isCorporateUiHidden()) return '';
  if (task.jiraKey) {
    return `<span class="issue-badge issue-jira-key" title="${escapeHtml(task.jiraKey)}">${escapeHtml(task.jiraKey)}</span>`;
  }
  return '';
}

export function staleBadgeHtml(task, staleDays = 14) {
  if (!isStale(task, staleDays)) return '';
  const days = daysSinceTouch(task);
  return `<span class="stale-badge" title="No updates in ${days}d">Stale</span>`;
}

export function snoozeBadgeHtml(task) {
  if (!isSnoozed(task)) return '';
  return `<span class="snooze-badge" title="Snoozed until ${escapeHtml(task.snoozeUntil)}">Snoozed</span>`;
}

export function energyBadgeHtml(task) {
  if (!task.energy) return '';
  return `<span class="energy-badge energy-${escapeHtml(task.energy)}" title="Energy: ${escapeHtml(task.energy)}">${escapeHtml(task.energy)}</span>`;
}

/** Workload rows by project slug. */
export function workloadByProject(tasksBySection, projects = []) {
  const nameById = new Map((projects || []).map(p => [p.id, p.name || p.id]));
  const map = new Map();
  for (const sec of ['in-progress', 'todo', 'inbox']) {
    for (const t of (tasksBySection[sec] || [])) {
      if (t.checked) continue;
      const pid = (t.project || '').trim() || 'Unassigned';
      if (!map.has(pid)) {
        map.set(pid, {
          project: pid,
          name: nameById.get(pid) || pid,
          estimateMinutes: 0,
          count: 0,
          energy: {},
        });
      }
      const row = map.get(pid);
      row.count += 1;
      row.estimateMinutes += (typeof t.estimateMinutes === 'number' ? t.estimateMinutes : 0);
      if (t.energy) row.energy[t.energy] = (row.energy[t.energy] || 0) + 1;
    }
  }
  return [...map.values()].sort((a, b) => b.estimateMinutes - a.estimateMinutes || b.count - a.count);
}

/** Planned estimate minutes for capacity widget. */
export function plannedCapacityMinutes(tasksBySection, dailyPlan) {
  let total = 0;
  const pinned = new Set(dailyPlan?.taskIds || []);
  const byId = indexTasksById(tasksBySection);
  for (const id of pinned) {
    const t = byId.get(id);
    if (t && typeof t.estimateMinutes === 'number') total += t.estimateMinutes;
  }
  for (const sec of ['todo', 'in-progress']) {
    for (const t of (tasksBySection[sec] || [])) {
      if (t.checked) continue;
      if (pinned.has(t.taskId)) continue;
      if (typeof t.estimateMinutes === 'number') total += t.estimateMinutes;
    }
  }
  return total;
}

export function collectProjects(tasksBySection, metaProjects = []) {
  const set = new Set((metaProjects || []).map(p => p.id));
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.project) set.add(t.project);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Active tasks sorted by focusScore descending. */
export function rankFocusTasks(tasksBySection, limit = 8, now = new Date()) {
  const list = [];
  for (const sec of ['in-progress', 'todo']) {
    for (const t of (tasksBySection[sec] || [])) {
      if (t.checked) continue;
      if (isSnoozed(t, now)) continue;
      list.push(t);
    }
  }
  list.sort((a, b) => focusScore(b, tasksBySection, now) - focusScore(a, tasksBySection, now));
  return list.slice(0, limit);
}

/** Workload rows: { assignee, estimateMinutes, count } for active tasks. */
export function workloadByAssignee(tasksBySection) {
  const map = new Map();
  for (const sec of ['in-progress', 'todo']) {
    for (const t of (tasksBySection[sec] || [])) {
      if (t.checked) continue;
      const who = (t.assignee || '').trim() || 'Unassigned';
      if (!map.has(who)) map.set(who, { assignee: who, estimateMinutes: 0, count: 0 });
      const row = map.get(who);
      row.count += 1;
      row.estimateMinutes += (typeof t.estimateMinutes === 'number' ? t.estimateMinutes : 0);
    }
  }
  return [...map.values()].sort((a, b) => b.estimateMinutes - a.estimateMinutes || b.count - a.count);
}

/** Collect tasks with dueDate (or startDate) in a month window for calendar. */
export function tasksForCalendarMonth(tasksBySection, year, month /* 0-based */) {
  const byDay = new Map(); // ymd -> tasks[]
  const add = (ymd, task) => {
    if (!ymd) return;
    const d = parseYmd(ymd);
    if (!d || d.getFullYear() !== year || d.getMonth() !== month) return;
    if (!byDay.has(ymd)) byDay.set(ymd, []);
    byDay.get(ymd).push(task);
  };
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.section === 'archive') continue;
      add(t.dueDate, t);
      if (t.startDate && t.startDate !== t.dueDate) add(t.startDate, t);
    }
  }
  // Dedupe if same task landed twice on a day
  for (const [ymd, list] of byDay) {
    const seen = new Set();
    byDay.set(ymd, list.filter(t => {
      const key = t.taskId || t.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }));
  }
  return byDay;
}

/** Edges for dependency graph: { from, to } where to is blocked by from. */
export function dependencyEdges(tasksBySection) {
  const edges = [];
  const byId = indexTasksById(tasksBySection);
  for (const t of byId.values()) {
    for (const dep of (t.blockedBy || [])) {
      edges.push({ from: dep, to: t.taskId, fromTask: byId.get(dep), toTask: t });
    }
  }
  return edges;
}

/**
 * Match task against active facet filters (AND). Empty filters = match all.
 * filters: { priorities:Set, types:Set, due:Set, labels:Set, sections:Set,
 *            hasParent:bool|null, blocked:bool|null }
 */
export function taskMatchesFacets(task, filters, tasksBySection) {
  if (!filters) return true;

  if (filters.sections && filters.sections.size > 0) {
    if (!filters.sections.has(task.section)) return false;
  }
  if (filters.priorities && filters.priorities.size > 0) {
    if (!filters.priorities.has(task.priority || 'medium')) return false;
  }
  if (filters.types && filters.types.size > 0) {
    if (!filters.types.has(task.type || 'task')) return false;
  }
  if (filters.labels && filters.labels.size > 0) {
    const labs = Array.isArray(task.labels) ? task.labels : [];
    let ok = false;
    for (const l of filters.labels) {
      if (labs.includes(l)) { ok = true; break; }
    }
    if (!ok) return false;
  }
  if (filters.due && filters.due.size > 0) {
    const urgency = dueUrgency(task.dueDate);
    let ok = false;
    for (const d of filters.due) {
      if (d === 'has-due' && task.dueDate) ok = true;
      else if (d === 'overdue' && urgency === 'overdue') ok = true;
      else if (d === 'today' && urgency === 'today') ok = true;
      else if (d === 'soon' && (urgency === 'soon' || urgency === 'today')) ok = true;
    }
    if (!ok) return false;
  }
  if (filters.hasParent === true && !task.parentId) return false;
  if (filters.hasParent === false && task.parentId) return false;
  if (filters.blocked === true && !isEffectivelyBlocked(task, tasksBySection)) return false;
  if (filters.blocked === false && isEffectivelyBlocked(task, tasksBySection)) return false;
  if (filters.dueExact && task.dueDate !== filters.dueExact && task.startDate !== filters.dueExact) {
    return false;
  }
  if (filters.assignees && filters.assignees.size > 0) {
    if (!task.assignee || !filters.assignees.has(task.assignee)) return false;
  }
  if (filters.projects && filters.projects.size > 0) {
    if (!task.project || !filters.projects.has(task.project)) return false;
  }
  if (filters.energy && filters.energy.size > 0) {
    if (!task.energy || !filters.energy.has(task.energy)) return false;
  }
  if (filters.stale === true && !isStale(task, filters.staleDays || 14)) return false;
  if (filters.stale === false && isStale(task, filters.staleDays || 14)) return false;
  if (filters.snoozed === true && !isSnoozed(task)) return false;
  if (filters.snoozed === false && isSnoozed(task)) return false;

  return true;
}

/** Collect unique labels across all tasks. */
export function collectLabels(tasksBySection) {
  const set = new Set();
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      for (const l of (t.labels || [])) set.add(l);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function collectAssignees(tasksBySection) {
  const set = new Set();
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.assignee) set.add(t.assignee);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Sum estimateMinutes for tasks in given section ids. */
export function sumEstimates(tasksBySection, sectionIds) {
  let total = 0;
  for (const id of sectionIds) {
    for (const t of (tasksBySection[id] || [])) {
      if (typeof t.estimateMinutes === 'number') total += t.estimateMinutes;
    }
  }
  return total;
}

/** Candidate task ids for blockedBy picker (exclude self). */
export function blockedByCandidates(tasksBySection, excludeTaskId) {
  const out = [];
  for (const list of Object.values(tasksBySection || {})) {
    for (const t of list || []) {
      if (t.taskId && t.taskId !== excludeTaskId) {
        out.push(t);
      }
    }
  }
  return out.sort((a, b) => a.taskId.localeCompare(b.taskId, undefined, { numeric: true }));
}

/** Next T{n} id from all section tasks. */
export function computeNextTaskId(state) {
  let maxId = 0;
  const { sections = [], tasks = {} } = state || {};
  sections.forEach(section => {
    (tasks[section.id] || []).forEach(t => {
      if (t.taskId) {
        const num = parseInt(t.taskId.substring(1), 10);
        if (!isNaN(num) && num > maxId) maxId = num;
      }
    });
  });
  return `T${maxId + 1}`;
}

const JIRA_KEY_RE = /^[A-Za-z][A-Za-z0-9]+-\d+$/;

/** Normalize/validate Jira key; null if empty/invalid. */
export function normalizeJiraKey(input) {
  if (input == null || input === '') return null;
  const v = String(input).trim().toUpperCase();
  if (!v) return null;
  if (!JIRA_KEY_RE.test(v)) return undefined;
  return v;
}

/**
 * When a recurring task is completed, spawn the next occurrence in todo.
 * @returns {object|null} new task or null
 */
export function spawnRecurringFollowUp(completedTask, state) {
  if (!completedTask?.recurrence?.freq || !state) return null;
  ensureTaskFieldDefaults(completedTask);
  const { sections = [], tasks = {} } = state;
  const todoId = sections.find(s => s.id === 'todo')?.id || 'todo';
  if (!tasks[todoId]) tasks[todoId] = [];

  const taskId = computeNextTaskId(state);
  const nextDue = completedTask.dueDate
    ? advanceDateByRecurrence(completedTask.dueDate, completedTask.recurrence)
    : null;
  const nextStart = completedTask.startDate
    ? advanceDateByRecurrence(completedTask.startDate, completedTask.recurrence)
    : null;

  const newTask = {
    id: Date.now() + Math.random(),
    title: completedTask.title,
    description: '',
    checked: false,
    subtasks: [],
    section: todoId,
    created: todayYmd(),
    updated: null,
    priority: completedTask.priority || 'medium',
    type: completedTask.type || 'task',
    parentId: completedTask.parentId || null,
    color: completedTask.color || null,
    dueDate: nextDue,
    startDate: nextStart,
    blocked: false,
    waitingOn: null,
    labels: [...(completedTask.labels || [])],
    links: [],
    blockedBy: [],
    assignee: completedTask.assignee || null,
    estimateMinutes: completedTask.estimateMinutes ?? null,
    loggedMinutes: null,
    jiraKey: completedTask.jiraKey || null,
    issueUrl: completedTask.issueUrl || null,
    project: completedTask.project || null,
    energy: completedTask.energy || null,
    snoozeUntil: null,
    timeEntries: [],
    decisions: [],
    recurrence: { freq: completedTask.recurrence.freq, interval: completedTask.recurrence.interval || 1 },
    notes: [],
    history: [],
    taskId,
  };
  appendHistory(newTask, {
    event: 'created',
    to: todoId,
    note: `Recurring from ${completedTask.taskId || 'task'}`,
  });
  tasks[todoId].unshift(newTask);
  return newTask;
}

export { findTaskByTaskId };

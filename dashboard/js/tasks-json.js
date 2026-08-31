// tasks-json.js - Load/serialize tasks.json (JSON format) for the dashboard

import {
  normalizeTicketTypes,
  DEFAULT_TICKET_TYPE_ID,
  isHexColor,
} from './ticket-types.js';

const ENERGY_VALUES = new Set(['deep', 'shallow', 'errands', 'creative']);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TASK_ID_RE = /^T\d+$/;

/** Prefer description; fall back to legacy note. */
function readDescription(t) {
  if (t.description != null && t.description !== '') return t.description;
  return t.note || '';
}

function readLinks(t) {
  if (!Array.isArray(t.links)) return [];
  return t.links
    .filter(l => l && typeof l.url === 'string' && l.url.trim())
    .map(l => {
      const row = { url: l.url.trim() };
      if (typeof l.label === 'string' && l.label.trim()) row.label = l.label.trim();
      return row;
    });
}

function readLabels(t) {
  if (!Array.isArray(t.labels)) return [];
  return t.labels.map(l => String(l).trim()).filter(Boolean);
}

function readBlockedBy(t) {
  if (!Array.isArray(t.blockedBy)) return [];
  return [...new Set(t.blockedBy.map(id => String(id).trim()).filter(Boolean))];
}

function readHistory(t) {
  if (!Array.isArray(t.history)) return [];
  return t.history
    .filter(h => h && typeof h === 'object' && typeof h.event === 'string')
    .map(h => {
      const row = { at: h.at || '', event: h.event };
      if (h.from != null && h.from !== '') row.from = String(h.from);
      if (h.to != null && h.to !== '') row.to = String(h.to);
      if (h.note != null && h.note !== '') row.note = String(h.note);
      return row;
    });
}

function readNotes(t) {
  if (!Array.isArray(t.notes)) return [];
  return t.notes
    .filter(n => n && typeof n === 'object' && typeof n.text === 'string' && n.text.trim())
    .map(n => ({ at: String(n.at || ''), text: String(n.text).trim() }));
}

function readTimeEntries(t) {
  if (!Array.isArray(t.timeEntries)) return [];
  return t.timeEntries
    .filter(e => e && typeof e === 'object' && typeof e.minutes === 'number' && e.minutes > 0)
    .map(e => {
      const row = { at: String(e.at || ''), minutes: Math.round(e.minutes) };
      if (typeof e.note === 'string' && e.note.trim()) row.note = e.note.trim();
      return row;
    })
    .slice(-100);
}

function readDecisions(t) {
  if (!Array.isArray(t.decisions)) return [];
  return t.decisions
    .filter(d => d && typeof d === 'object' && typeof d.text === 'string' && d.text.trim())
    .map(d => ({ at: String(d.at || ''), text: String(d.text).trim() }))
    .slice(-50);
}

function readRecurrence(t) {
  const r = t.recurrence;
  if (!r || typeof r !== 'object') return null;
  const freq = r.freq;
  if (freq !== 'daily' && freq !== 'weekly' && freq !== 'monthly') return null;
  const interval = r.interval == null ? 1 : Math.round(Number(r.interval));
  return { freq, interval: interval > 0 ? interval : 1 };
}

function readIssueUrl(t) {
  if (typeof t.issueUrl !== 'string') return null;
  const s = t.issueUrl.trim();
  return s || null;
}

function readEnergy(t) {
  if (typeof t.energy !== 'string') return null;
  return ENERGY_VALUES.has(t.energy) ? t.energy : null;
}

/** Default / empty meta for solo task system. */
export function defaultTasksMeta() {
  return {
    dailyPlan: { date: null, taskIds: [], carriedIds: [] },
    weeklyCapacityMinutes: 600,
    projects: [],
    ideas: [],
    review: { weeklyDate: null, checks: {} },
  };
}

/**
 * Normalize top-level meta from tasks.json.
 * @param {any} meta
 */
export function normalizeTasksMeta(meta) {
  const base = defaultTasksMeta();
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return base;

  const dailyPlan = meta.dailyPlan && typeof meta.dailyPlan === 'object' ? meta.dailyPlan : {};
  const date = (typeof dailyPlan.date === 'string' && DATE_RE.test(dailyPlan.date))
    ? dailyPlan.date
    : null;
  const taskIds = Array.isArray(dailyPlan.taskIds)
    ? dailyPlan.taskIds.map(id => String(id).trim()).filter(id => TASK_ID_RE.test(id))
    : [];
  const carriedIds = Array.isArray(dailyPlan.carriedIds)
    ? dailyPlan.carriedIds.map(id => String(id).trim()).filter(id => TASK_ID_RE.test(id))
    : [];

  let weeklyCapacityMinutes = base.weeklyCapacityMinutes;
  if (typeof meta.weeklyCapacityMinutes === 'number'
      && Number.isFinite(meta.weeklyCapacityMinutes)
      && meta.weeklyCapacityMinutes > 0) {
    weeklyCapacityMinutes = Math.round(meta.weeklyCapacityMinutes);
  }

  const projects = Array.isArray(meta.projects)
    ? meta.projects
      .filter(p => p && typeof p === 'object' && typeof p.id === 'string' && p.id.trim())
      .map(p => {
        const row = {
          id: String(p.id).trim(),
          name: String(p.name || p.id).trim() || String(p.id).trim(),
        };
        if (typeof p.color === 'string' && /^#[0-9A-Fa-f]{6}$/.test(p.color)) row.color = p.color;
        return row;
      })
    : [];

  const ideas = Array.isArray(meta.ideas)
    ? meta.ideas.map(i => String(i).trim()).filter(Boolean)
    : [];

  const reviewIn = meta.review && typeof meta.review === 'object' ? meta.review : {};
  const weeklyDate = (typeof reviewIn.weeklyDate === 'string' && DATE_RE.test(reviewIn.weeklyDate))
    ? reviewIn.weeklyDate
    : null;
  const checks = (reviewIn.checks && typeof reviewIn.checks === 'object' && !Array.isArray(reviewIn.checks))
    ? { ...reviewIn.checks }
    : {};

  return {
    dailyPlan: { date, taskIds, carriedIds },
    weeklyCapacityMinutes,
    projects,
    ideas,
    review: { weeklyDate, checks },
  };
}

/**
 * Load tasks from tasks.json text content.
 *
 * Input format (tasks.json):
 *   { version, ticketTypes?, meta?, sections: [{ id, name, tasks: [...] }] }
 *
 * Output: dashboard in-memory shape:
 *   { sections, tasks, ticketTypes, meta }
 */
export function loadTasksJson(text) {
  const data = JSON.parse(text);
  const sections = [];
  const tasks = {};
  const ticketTypes = normalizeTicketTypes(data.ticketTypes);
  const meta = normalizeTasksMeta(data.meta);

  for (const sec of (data.sections || [])) {
    sections.push({ id: sec.id, name: sec.name });
    tasks[sec.id] = (sec.tasks || []).map(t => ({
      id: Date.now() + Math.random(),
      taskId: t.id || null,
      title: t.title || '',
      description: readDescription(t),
      checked: !!t.checked,
      priority: t.priority || 'medium',
      type: t.type || DEFAULT_TICKET_TYPE_ID,
      parentId: t.parentId || null,
      color: isHexColor(t.color) ? t.color : null,
      dueDate: t.dueDate || null,
      startDate: t.startDate || null,
      jiraKey: t.jiraKey ? String(t.jiraKey).trim().toUpperCase() : null,
      issueUrl: readIssueUrl(t),
      project: (typeof t.project === 'string' && t.project.trim()) ? t.project.trim() : null,
      energy: readEnergy(t),
      snoozeUntil: (typeof t.snoozeUntil === 'string' && DATE_RE.test(t.snoozeUntil)) ? t.snoozeUntil : null,
      blocked: !!t.blocked,
      waitingOn: t.waitingOn || null,
      labels: readLabels(t),
      links: readLinks(t),
      blockedBy: readBlockedBy(t),
      assignee: t.assignee || null,
      estimateMinutes: (typeof t.estimateMinutes === 'number' && t.estimateMinutes > 0)
        ? Math.round(t.estimateMinutes) : null,
      loggedMinutes: (typeof t.loggedMinutes === 'number' && t.loggedMinutes > 0)
        ? Math.round(t.loggedMinutes) : null,
      timeEntries: readTimeEntries(t),
      decisions: readDecisions(t),
      recurrence: readRecurrence(t),
      notes: readNotes(t),
      history: readHistory(t),
      created: t.created || null,
      updated: t.updated || null,
      subtasks: Array.isArray(t.subtasks) ? t.subtasks.map(st => ({ text: st.text || '', checked: !!st.checked })) : [],
      section: sec.id,
    }));
  }

  return { sections, tasks, ticketTypes, meta };
}

/**
 * Serialize the dashboard in-memory shape back to tasks.json text.
 *
 * Drops the ephemeral numeric `id` and the per-task `section` field.
 * Uses `taskId` as the stable `id` in the JSON output.
 * Preserves top-level `meta`.
 */
export function serializeTasksJson(sections, tasks, ticketTypes, meta) {
  const out = {
    version: 1,
    ticketTypes: normalizeTicketTypes(ticketTypes),
    meta: normalizeTasksMeta(meta),
    sections: sections.map(sec => ({
      id: sec.id,
      name: sec.name,
      tasks: (tasks[sec.id] || []).map(t => {
        const row = {
          id: t.taskId || null,
          title: t.title,
          checked: !!t.checked,
          priority: t.priority || 'medium',
          type: t.type || DEFAULT_TICKET_TYPE_ID,
          created: t.created || null,
          updated: t.updated || null,
          subtasks: (t.subtasks || []).map(st => ({ text: st.text, checked: !!st.checked })),
        };
        const desc = (t.description || '').trim();
        if (desc) row.description = desc;
        if (t.parentId) row.parentId = t.parentId;
        if (isHexColor(t.color)) row.color = t.color;
        if (t.dueDate) row.dueDate = t.dueDate;
        if (t.startDate) row.startDate = t.startDate;
        if (t.jiraKey) row.jiraKey = String(t.jiraKey).trim().toUpperCase();
        if (t.issueUrl) row.issueUrl = String(t.issueUrl).trim();
        if (t.project) row.project = String(t.project).trim();
        if (t.energy && ENERGY_VALUES.has(t.energy)) row.energy = t.energy;
        if (t.snoozeUntil) row.snoozeUntil = t.snoozeUntil;
        if (t.blocked) row.blocked = true;
        if (t.waitingOn) row.waitingOn = t.waitingOn;
        const labels = Array.isArray(t.labels) ? t.labels.filter(Boolean) : [];
        if (labels.length) row.labels = labels;
        const links = readLinks(t);
        if (links.length) row.links = links;
        const blockedBy = readBlockedBy(t);
        if (blockedBy.length) row.blockedBy = blockedBy;
        if (t.assignee) row.assignee = t.assignee;
        if (typeof t.estimateMinutes === 'number' && t.estimateMinutes > 0) {
          row.estimateMinutes = Math.round(t.estimateMinutes);
        }
        if (typeof t.loggedMinutes === 'number' && t.loggedMinutes > 0) {
          row.loggedMinutes = Math.round(t.loggedMinutes);
        }
        const timeEntries = readTimeEntries(t);
        if (timeEntries.length) row.timeEntries = timeEntries;
        const decisions = readDecisions(t);
        if (decisions.length) row.decisions = decisions;
        const recurrence = readRecurrence(t);
        if (recurrence) row.recurrence = recurrence;
        const notes = readNotes(t);
        if (notes.length) row.notes = notes.slice(-100);
        const history = readHistory(t);
        if (history.length) row.history = history.slice(-50);
        return row;
      }),
    })),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

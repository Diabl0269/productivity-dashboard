// tasks-parser.js - Pure parsing functions for task markdown

export function taskSectionId(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function parseMeta(text) {
  const metaMatch = text.match(/<!--\s*created:(\d{4}-\d{2}-\d{2})(?:\s+updated:(\d{4}-\d{2}-\d{2}))?(?:\s+priority:(low|medium|high))?(?:\s+id:(T\d+))?\s*-->$/);
  if (metaMatch) {
    return {
      cleanText: text.replace(metaMatch[0], '').trimEnd(),
      created: metaMatch[1],
      updated: metaMatch[2] || null,
      priority: metaMatch[3] || 'medium',
      id: metaMatch[4] || null
    };
  }
  return { cleanText: text, created: null, updated: null, priority: 'medium', id: null };
}

function formatMetaComment(created, updated, priority, id) {
  if (!created) return '';
  let comment = `<!-- created:${created}`;
  if (updated) comment += ` updated:${updated}`;
  comment += ` priority:${priority || 'medium'}`;
  if (id) comment += ` id:${id}`;
  comment += ' -->';
  return ' ' + comment;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escHtml = s => s.replace(/[&<>"]/g, c => ESC[c]);
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
const BARE_URL_RE = /(?<!href="|">)(https?:\/\/[^\s<"&]+)/g;

export function renderLinks(text) {
  if (!text) return '';
  return escHtml(text)
    .replace(MD_LINK_RE, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(BARE_URL_RE, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
}

export function parseTaskMarkdown(content) {
  const resultSections = [];
  const resultTasks = {};
  let currentSection = null;
  let currentSectionId = null;

  const lines = content.split('\n');
  let currentTask = null;

  for (const line of lines) {
    const headerMatch = line.match(/^## \*{0,2}(.+?)\*{0,2}$/);
    if (headerMatch) {
      if (currentTask && currentSectionId) {
        resultTasks[currentSectionId].push(currentTask);
        currentTask = null;
      }

      const sectionName = headerMatch[1].trim();
      currentSectionId = taskSectionId(sectionName);
      currentSection = sectionName;

      if (!resultTasks[currentSectionId]) {
        resultSections.push({ id: currentSectionId, name: sectionName });
        resultTasks[currentSectionId] = [];
      }
    } else if (currentSectionId && line.match(/^- \[[ xX]\]/)) {
      if (currentTask) {
        resultTasks[currentSectionId].push(currentTask);
      }
      const checked = line.match(/\[[xX]\]/) !== null;
      let text = line.replace(/^- \[[ xX]\]\s*/, '');

      // Extract dates, priority, and id from HTML comment
      const { cleanText, created, updated, priority, id } = parseMeta(text);
      text = cleanText;

      let title = text;
      let note = '';

      const boldMatch = text.match(/^\*\*(.+?)\*\*(.*)$/);
      if (boldMatch) {
        title = boldMatch[1];
        note = boldMatch[2].replace(/^\s*[-—]\s*/, '').trim().replace(/<br>/g, '\n');
      }

      // Auto-assign created date to new tasks
      const today = todayStr();

      currentTask = {
        id: Date.now() + Math.random(),
        title,
        note,
        checked,
        subtasks: [],
        section: currentSectionId,
        created: created || today,
        updated: updated || null,
        priority: priority || 'medium',
        taskId: id || null
      };
    } else if (currentTask && line.match(/^\s+- \[[ xX]\]/)) {
      const checked = line.match(/\[[xX]\]/) !== null;
      const text = line.replace(/^\s+- \[[ xX]\]\s*/, '');
      currentTask.subtasks.push({ text, checked });
    }
  }

  if (currentTask && currentSectionId) {
    resultTasks[currentSectionId].push(currentTask);
  }

  return { sections: resultSections, tasks: resultTasks };
}

export function toMarkdown(sections, tasks) {
  let md = '# Tasks\n';

  sections.forEach((section, idx) => {
    md += `\n## ${section.name}\n`;
    const sectionTasks = tasks[section.id] || [];
    sectionTasks.forEach(t => {
      const checkbox = t.checked ? '[x]' : '[ ]';
      const escapedNote = t.note ? t.note.replace(/\n/g, '<br>') : '';
      const note = escapedNote ? ` — ${escapedNote}` : '';
      const meta = formatMetaComment(t.created, t.updated, t.priority, t.taskId);
      md += `- ${checkbox} **${t.title}**${note}${meta}\n`;
      t.subtasks.forEach(st => {
        const stCheckbox = st.checked ? '[x]' : '[ ]';
        md += `  - ${stCheckbox} ${st.text}\n`;
      });
    });
  });

  return md.trimEnd() + '\n';
}

export function autoArchive(sections, tasks) {
  const ARCHIVE_ID = 'archive';
  const DONE_ID = 'done';
  const ARCHIVE_DAYS = 7;

  const doneTasks = tasks[DONE_ID];
  if (!doneTasks || doneTasks.length === 0) return false;

  const now = new Date();
  const toMove = [];
  const toKeep = [];

  for (const task of doneTasks) {
    const dateStr = task.updated || task.created;
    if (!dateStr) {
      toKeep.push(task);
      continue;
    }
    const taskDate = new Date(dateStr + 'T00:00:00');
    const diffDays = (now - taskDate) / (1000 * 60 * 60 * 24);
    if (diffDays >= ARCHIVE_DAYS) {
      toMove.push(task);
    } else {
      toKeep.push(task);
    }
  }

  if (toMove.length === 0) return false;

  // Create Archive section if it doesn't exist
  if (!tasks[ARCHIVE_ID]) {
    sections.push({ id: ARCHIVE_ID, name: 'Archive' });
    tasks[ARCHIVE_ID] = [];
  }

  // Move tasks
  tasks[DONE_ID] = toKeep;
  for (const task of toMove) {
    task.section = ARCHIVE_ID;
    tasks[ARCHIVE_ID].push(task);
  }

  return true;
}

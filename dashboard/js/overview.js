// ============================================================
// ===== OVERVIEW WIDGETS FUNCTIONALITY =====
// ============================================================

// Sprint Info Widget
function updateSprintInfo() {
  // Load sprints from config.json (see config.example.json for format)
  const configSprints = (window.dashboardConfig && window.dashboardConfig.sprints) || [];
  const sprints = configSprints.map(s => ({
    name: s.name,
    start: new Date(s.start),
    end: new Date(s.end)
  }));

  const now = new Date();
  const sprintNameEl = document.getElementById('sprintName');
  const sprintDaysEl = document.getElementById('sprintDays');
  const sprintProgressEl = document.getElementById('sprintProgress');

  let currentSprint = null;
  let nextSprint = null;

  for (let i = 0; i < sprints.length; i++) {
    if (now >= sprints[i].start && now <= sprints[i].end) {
      currentSprint = sprints[i];
      break;
    }
    if (now < sprints[i].start) {
      nextSprint = sprints[i];
      break;
    }
  }

  if (currentSprint) {
    const totalDays = Math.ceil((currentSprint.end - currentSprint.start) / (1000 * 60 * 60 * 24));
    const daysRemaining = Math.ceil((currentSprint.end - now) / (1000 * 60 * 60 * 24));
    const progress = Math.max(0, Math.min(100, ((totalDays - daysRemaining) / totalDays) * 100));

    sprintNameEl.textContent = currentSprint.name;
    sprintDaysEl.textContent = `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} remaining`;
    sprintProgressEl.style.width = `${progress}%`;
  } else if (nextSprint) {
    const daysUntil = Math.ceil((nextSprint.start - now) / (1000 * 60 * 60 * 24));
    sprintNameEl.textContent = 'Between Sprints';
    sprintDaysEl.textContent = `${nextSprint.name} starts in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`;
    sprintProgressEl.style.width = '0%';
  } else {
    sprintNameEl.textContent = 'No Active Sprint';
    sprintDaysEl.textContent = 'Sprint schedule not available';
    sprintProgressEl.style.width = '0%';
  }
}

// Task Summary Widget - updates from parsed task data
export function updateTaskSummary(parsed) {
  if (!parsed || !parsed.tasks) return;
  const tasks = parsed.tasks;

  const inProgress = (tasks['in-progress'] || []).filter(t => !t.checked).length;
  const todo = (tasks['todo'] || []).length;
  const done = (tasks['done'] || []).length;

  // Count high priority across in-progress and todo
  let highPriority = 0;
  ['in-progress', 'todo'].forEach(section => {
    (tasks[section] || []).forEach(t => {
      if (t.priority === 'high' && !t.checked) highPriority++;
    });
  });

  document.getElementById('statInProgress').textContent = inProgress;
  document.getElementById('statTodo').textContent = todo;
  document.getElementById('statDone').textContent = done;
  document.getElementById('statBlocked').textContent = highPriority;
}

// Upcoming Deadlines Widget - extracts dates from task descriptions
export function updateDeadlines(parsed) {
  if (!parsed || !parsed.tasks) return;
  const container = document.getElementById('deadlinesList');
  const deadlines = [];
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  // Date patterns to look for in task titles, notes, and subtasks
  const datePatterns = [
    // "Mar 25" or "March 25"
    { regex: /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})\b/gi, parse: matchToDate },
    // "25.3" or "29.3" (DD.M or DD.MM format)
    { regex: /\b(\d{1,2})\.(\d{1,2})\b/g, parse: dotDateToDate },
    // "Apr 2" style
    { regex: /\b(April|January|February|March|May|June|July|August|September|October|November|December)\s+(\d{1,2})\b/gi, parse: matchToDate }
  ];

  const months = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
    january: 0, february: 1, march: 2, april: 3, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

  function matchToDate(match) {
    const monthStr = match[1].toLowerCase().slice(0, 3);
    const day = parseInt(match[2]);
    const month = months[monthStr];
    if (month === undefined || day < 1 || day > 31) return null;
    const year = now.getMonth() > month + 1 ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, month, day);
  }

  function dotDateToDate(match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const year = now.getMonth() > month + 1 ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, month, day);
  }

  function extractDates(text, taskTitle) {
    for (const pattern of datePatterns) {
      let match;
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      while ((match = regex.exec(text)) !== null) {
        const date = pattern.parse(match);
        if (date && date >= now) {
          const diffDays = Math.ceil((date - now) / (1000 * 60 * 60 * 24));
          deadlines.push({ date, diffDays, task: taskTitle, text: match[0] });
        }
      }
    }
  }

  // Scan in-progress and todo tasks
  ['in-progress', 'todo'].forEach(sectionId => {
    (parsed.tasks[sectionId] || []).forEach(task => {
      if (task.checked) return;
      const fullText = `${task.title} ${task.note || ''} ${task.subtasks.map(s => s.text).join(' ')}`;
      extractDates(fullText, task.title);
    });
  });

  // Deduplicate by date+task
  const seen = new Set();
  const unique = deadlines.filter(d => {
    const key = `${d.date.getTime()}-${d.task}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Sort by date
  unique.sort((a, b) => a.date - b.date);

  // Render (max 8)
  const items = unique.slice(0, 8);
  if (items.length === 0) {
    container.innerHTML = '<div class="deadline-empty">No upcoming deadlines found</div>';
    return;
  }

  container.innerHTML = items.map(d => {
    const dateStr = d.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const isToday = d.diffDays === 0;
    const isSoon = d.diffDays <= 3;
    const urgencyClass = isToday ? 'deadline-today' : isSoon ? 'deadline-soon' : '';
    const label = isToday ? 'Today' : d.diffDays === 1 ? 'Tomorrow' : `in ${d.diffDays}d`;
    return `
      <div class="deadline-item ${urgencyClass}">
        <div class="deadline-date">${dateStr}</div>
        <div class="deadline-task">${d.task}</div>
        <div class="deadline-badge">${label}</div>
      </div>
    `;
  }).join('');
}

// 1:1 Topics Widget
const TOPICS_KEY = 'dashboard_1on1_topics';
let topics = [];

function loadTopics() {
  const stored = localStorage.getItem(TOPICS_KEY);
  if (stored) {
    topics = JSON.parse(stored);
  } else {
    topics = [];
    saveTopics();
  }
  renderTopics();
}

function saveTopics() {
  localStorage.setItem(TOPICS_KEY, JSON.stringify(topics));
}

function renderTopics() {
  const topicsList = document.getElementById('topicsList');
  if (topics.length === 0) {
    topicsList.innerHTML = '<div class="topics-empty">No topics yet — add one below</div>';
    return;
  }
  topicsList.innerHTML = topics.map((topic, index) => `
    <div class="topic-item">
      <span>${topic}</span>
      <button class="topic-delete" onclick="deleteTopic(${index})">×</button>
    </div>
  `).join('');
}

function addTopic() {
  const input = document.getElementById('topicInput');
  const topic = input.value.trim();
  if (topic) {
    topics.push(topic);
    saveTopics();
    renderTopics();
    input.value = '';
  }
}

function deleteTopic(index) {
  topics.splice(index, 1);
  saveTopics();
  renderTopics();
}

window.deleteTopic = deleteTopic;

// Workshops Widget (replaces Pilot Teams)
const WORKSHOPS_KEY = 'dashboard_workshops';
let workshops = [];

function loadWorkshops() {
  const stored = localStorage.getItem(WORKSHOPS_KEY);
  if (stored) {
    workshops = JSON.parse(stored);
  } else {
    workshops = (window.dashboardConfig && window.dashboardConfig.defaultWorkshops) || [];
    saveWorkshops();
  }
  renderWorkshops();
}

function saveWorkshops() {
  localStorage.setItem(WORKSHOPS_KEY, JSON.stringify(workshops));
}

function renderWorkshops() {
  const container = document.getElementById('workshopsContent');
  container.innerHTML = workshops.map((ws, index) => {
    const statusColors = {
      'planned': { bg: 'var(--bg-secondary)', text: 'var(--text-secondary)', label: 'Planned' },
      'in-progress': { bg: '#f59e0b22', text: '#f59e0b', label: 'In Progress' },
      'done': { bg: '#10b98122', text: '#10b981', label: 'Done' }
    };
    const s = statusColors[ws.status] || statusColors['planned'];
    return `
      <div class="workshop-item">
        <input type="text" class="workshop-name-input" value="${ws.name}"
          onchange="updateWorkshopName(${index}, this.value)">
        <select class="workshop-status-select" onchange="updateWorkshopStatus(${index}, this.value)"
          style="background: ${s.bg}; color: ${s.text};">
          <option value="planned" ${ws.status === 'planned' ? 'selected' : ''}>Planned</option>
          <option value="in-progress" ${ws.status === 'in-progress' ? 'selected' : ''}>In Progress</option>
          <option value="done" ${ws.status === 'done' ? 'selected' : ''}>Done</option>
        </select>
      </div>
    `;
  }).join('') + `
    <button class="workshop-add-btn" onclick="addWorkshop()">+ Add Workshop</button>
  `;
}

function updateWorkshopName(index, name) {
  workshops[index].name = name;
  saveWorkshops();
}

function updateWorkshopStatus(index, status) {
  workshops[index].status = status;
  saveWorkshops();
  renderWorkshops();
}

function addWorkshop() {
  workshops.push({ name: 'New Workshop', status: 'planned' });
  saveWorkshops();
  renderWorkshops();
}

window.updateWorkshopName = updateWorkshopName;
window.updateWorkshopStatus = updateWorkshopStatus;
window.addWorkshop = addWorkshop;

// ===== INITIALIZATION =====

export function initOverview() {
  document.getElementById('topicAddBtn').addEventListener('click', addTopic);
  document.getElementById('topicInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') addTopic();
  });

  updateSprintInfo();
  loadTopics();
  loadWorkshops();

  setInterval(updateSprintInfo, 1000 * 60 * 60);
}

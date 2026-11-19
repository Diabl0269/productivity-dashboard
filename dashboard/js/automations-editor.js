// automations-editor.js — detail panel of the Automations tab: schedule, arguments, environment, script.
import { WEEKDAYS, calendarToRows, rowsToCalendar } from '../../shared/automation-schedule.js';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

function field(label, ...kids) {
  const wrap = el('div', 'au-field');
  wrap.appendChild(el('label', 'au-label', label));
  for (const k of kids) wrap.appendChild(k);
  return wrap;
}

function scheduleRow(row, onRemove) {
  const r = el('div', 'au-sched-row');
  const days = el('div', 'au-days');
  WEEKDAYS.forEach((name, i) => {
    const l = el('label', 'au-day');
    const cb = el('input');
    cb.type = 'checkbox'; cb.value = String(i); cb.checked = row.days.includes(i);
    l.append(cb, document.createTextNode(name));
    days.appendChild(l);
  });
  const time = el('input', 'au-input'); time.type = 'time';
  time.value = `${String(row.hour).padStart(2, '0')}:${String(row.minute).padStart(2, '0')}`;
  const dom = el('input', 'au-input au-dom'); dom.type = 'number'; dom.min = '1'; dom.max = '31';
  dom.placeholder = 'day of month'; dom.value = row.day || '';
  const rm = el('button', 'au-btn au-btn-ghost', 'Remove'); rm.type = 'button';
  rm.addEventListener('click', () => { r.remove(); onRemove?.(); });
  r.append(days, time, dom, rm);
  r.readRows = () => {
    const [h, m] = (time.value || '00:00').split(':').map(Number);
    return { days: [...days.querySelectorAll('input:checked')].map(c => Number(c.value)), hour: h, minute: m, day: dom.value ? Number(dom.value) : '' };
  };
  return r;
}

function argRow(value) {
  const r = el('div', 'au-arg-row');
  const ta = el('textarea', 'au-input au-arg'); ta.rows = Math.min(6, Math.max(1, String(value).split('\n').length)); ta.value = value; ta.spellcheck = false;
  const rm = el('button', 'au-btn au-btn-ghost', '×'); rm.type = 'button'; rm.title = 'Remove argument';
  rm.addEventListener('click', () => r.remove());
  r.append(ta, rm);
  return r;
}

const envToText = env => Object.entries(env || {}).map(([k, v]) => `${k}=${v}`).join('\n');
function textToEnv(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return out;
}

/** Build the editor for one automation; returns { node, collect() -> PUT body }. */
export function buildEditor(a) {
  const node = el('div', 'au-editor');

  const rowsBox = el('div', 'au-sched-rows');
  for (const row of calendarToRows(a.schedule.calendar)) rowsBox.appendChild(scheduleRow(row));
  const add = el('button', 'au-btn', '+ Add time'); add.type = 'button';
  add.addEventListener('click', () => rowsBox.appendChild(scheduleRow({ days: [], hour: 9, minute: 0, day: '' })));
  const interval = el('input', 'au-input au-narrow'); interval.type = 'number'; interval.min = '0';
  interval.value = a.schedule.interval ? String(Math.round(a.schedule.interval / 60)) : '';
  interval.placeholder = 'minutes';
  const atLoad = el('input'); atLoad.type = 'checkbox'; atLoad.checked = a.schedule.runAtLoad;
  const atLoadLabel = el('label', 'au-day'); atLoadLabel.append(atLoad, document.createTextNode('Run at load'));
  node.appendChild(field('Schedule (no day ticked = every day)', rowsBox, add));
  node.appendChild(field('Repeat every (minutes, optional)', interval, atLoadLabel));

  const argsBox = el('div', 'au-args');
  for (const arg of a.arguments) argsBox.appendChild(argRow(arg));
  const addArg = el('button', 'au-btn', '+ Add argument'); addArg.type = 'button';
  addArg.addEventListener('click', () => argsBox.appendChild(argRow('')));
  node.appendChild(field('Program arguments', argsBox, addArg));

  const env = el('textarea', 'au-input au-env'); env.rows = 3; env.spellcheck = false; env.value = envToText(a.environment);
  node.appendChild(field('Environment (KEY=value per line, e.g. OPENCODE_MODEL)', env));

  let script = null;
  if (a.script) {
    script = el('textarea', 'au-input au-script'); script.spellcheck = false; script.rows = 16; script.value = a.script.content;
    node.appendChild(field(`Script — ${a.script.path}`, script));
  }

  const collect = () => {
    const calendar = rowsToCalendar([...rowsBox.querySelectorAll('.au-sched-row')].map(r => r.readRows()));
    const body = {
      schedule: { calendar, interval: interval.value ? Number(interval.value) * 60 : null, runAtLoad: atLoad.checked },
      arguments: [...argsBox.querySelectorAll('.au-arg')].map(t => t.value).filter(v => v !== ''),
      environment: textToEnv(env.value),
    };
    if (script) body.scriptContent = script.value;
    return body;
  };
  return { node, collect };
}

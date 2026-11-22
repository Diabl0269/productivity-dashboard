import { shell } from './home-pages-overlay.js';
import { effectiveRun, describeSchedule, checkSchedule, EFFORTS, HARNESSES, HARNESS_DEFAULTS } from '../../shared/automation-run.js';
import { editAutomation, editAutomationDefaults, getAutomationId, isEditingAutomationDefaults } from './home-state.js';
import { loadRuns, getRuns } from './home-health-data.js';

function el(tag, className, text) {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (text != null) n.textContent = text;
  return n;
}

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
let openId = null;
let current = null;

function field(label, hint, control) {
  const wrap = el('label', 'hae-field');
  const title = el('span', 'hae-label', label);
  wrap.append(title);
  if (hint) wrap.appendChild(el('span', 'hae-hint', hint));
  wrap.appendChild(control);
  return wrap;
}

function input(type, value, attrs = {}) {
  const n = el('input');
  n.type = type;
  n.value = value ?? '';
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
}

function scheduleControls(schedule) {
  const wrap = el('div', 'hae-schedule');
  const time = input('time', `${String(schedule?.hour ?? 9).padStart(2, '0')}:${String(schedule?.minute ?? 0).padStart(2, '0')}`);
  time.required = true;
  const days = el('div', 'hae-days');
  const selected = new Set(schedule?.weekdays || []);
  for (let d = 0; d < 7; d++) {
    const label = el('label', 'hae-day');
    const box = input('checkbox');
    box.checked = selected.size ? selected.has(d) : d >= 1 && d <= 5;
    box.value = String(d);
    label.append(box, el('span', '', dayNames[d]));
    days.appendChild(label);
  }
  const monthly = el('label', 'hae-monthly');
  const monthlyBox = input('checkbox');
  monthlyBox.checked = schedule?.day !== undefined;
  const monthDay = input('number', schedule?.day ?? 1, { min: '1', max: '31' });
  monthDay.className = 'hae-month-day';
  monthly.append(monthlyBox, el('span', '', 'Monthly on day'), monthDay);
  wrap.append(time, days, monthly);
  return { wrap, read() {
    const [hour, minute] = time.value.split(':').map(Number);
    if (monthlyBox.checked) return { hour, minute, day: Number(monthDay.value) };
    return { hour, minute, weekdays: [...days.querySelectorAll('input:checked')].map(x => Number(x.value)) };
  }, describe() { return describeSchedule(this.read()); } };
}

function formFor(entry, ctx, close) {
  const defaults = ctx.config()?.automationDefaults || {};
  const run = effectiveRun(entry, defaults);
  const form = el('form', 'hr-edit-form hae-form');
  const intro = el('p', 'hae-intro', `Edit where and how this automation runs. Changes are saved to ${ctx.home()?.path || 'the project home config'}.`);
  const path = el('code', 'hae-path');
  requestAnimationFrame(() => { path.textContent = window.location.pathname + window.location.search; });
  form.append(intro, path);

  const name = input('text', entry.name, { readonly: 'readonly' });
  const description = el('textarea');
  description.value = entry.what || '';
  description.maxLength = 500;
  description.rows = 2;
  const harness = el('select');
  for (const value of HARNESSES) { const option = el('option', '', value); option.value = value; option.selected = value === run.harness; harness.appendChild(option); }
  const model = input('text', run.model || '', { maxlength: '120' });
  const effort = el('select');
  for (const value of EFFORTS) {
    const option = el('option', '', value);
    option.value = value;
    option.selected = value === run.effort;
    effort.appendChild(option);
  }
  const cli = input('text', run.cli, { maxlength: '500' });
  const argumentsLine = el('textarea');
  argumentsLine.value = (run.arguments || []).join('\n');
  argumentsLine.maxLength = 4000;
  argumentsLine.rows = 2;
  argumentsLine.placeholder = 'One argument per line';
  const runner = input('text', run.runner, { maxlength: '500' });
  harness.addEventListener('change', () => {
    const preset = HARNESS_DEFAULTS[harness.value];
    if (preset?.cli) cli.value = preset.cli;
    model.value = preset?.model || '';
  });
  const skill = input('text', run.skill || entry.id, { maxlength: '80' });
  const prompt = el('textarea');
  prompt.value = run.prompt || '';
  prompt.maxLength = 4000;
  prompt.rows = 5;
  prompt.placeholder = `Leave blank to run .agents/skills/${run.skill || entry.id}/SKILL.md`;
  const schedule = scheduleControls(run.schedule);
  const enabled = input('checkbox');
  enabled.checked = run.enabled;
  const enabledWrap = el('label', 'hae-enabled');
  enabledWrap.append(enabled, el('span', '', 'Enabled'));

  form.append(
    field('Automation', 'Stable id; rename it in the Home config by hand.', name),
    field('Description', 'Shown in the automation table.', description),
    field('Schedule', 'Local calendar time used by macOS LaunchAgent.', schedule.wrap),
    field('Harness', 'Command-line agent used for this automation.', harness),
    field('Model', 'Optional model name supported by the selected harness.', model),
    field('Effort', 'Reasoning effort where the selected harness supports it.', effort),
    field('CLI executable', 'Command name, absolute path, or a path starting with ~/.', cli),
    field('Extra arguments', 'One argument per line. Added before the prompt.', argumentsLine),
    field('Runner', 'LaunchAgent runner script path.', runner),
    field('Skill', 'Folder name under .agents/skills/.', skill),
    field('Prompt', 'Optional full prompt. A skill prompt is generated when this is blank.', prompt),
    enabledWrap,
  );
  const error = el('p', 'hae-error');
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const actions = el('div', 'hae-actions');
  const cancel = el('button', 'hp-dlg-btn', 'Cancel');
  cancel.type = 'button';
  const save = el('button', 'hp-dlg-btn hae-save', 'Save changes');
  save.type = 'submit';
  actions.append(cancel, save);
  form.append(error, actions);
  cancel.addEventListener('click', () => close());

  form.addEventListener('submit', async e => {
    e.preventDefault();
    error.hidden = true;
    save.disabled = true;
    save.textContent = 'Saving…';
    const s = schedule.read();
    const valid = checkSchedule(s);
    if (valid.error) {
      error.textContent = valid.error;
      error.hidden = false;
      save.disabled = false;
      save.textContent = 'Save changes';
      return;
    }
    try {
      const res = await fetch(`/api/home/automation?project=${encodeURIComponent(ctx.project())}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: entry.id, description: description.value, schedule: s, harness: harness.value, model: model.value || null, effort: effort.value, cli: cli.value, runner: runner.value, arguments: argumentsLine.value.split('\n').map(x => x.trim()).filter(Boolean), skill: skill.value, prompt: prompt.value || null, enabled: enabled.checked }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
      if (out.launchAgent?.warning) ctx.toast?.(out.launchAgent.warning);
      else ctx.toast?.('Automation saved.');
      await loadRuns(ctx.project(), { force: true });
      close(true);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
    } finally {
      save.disabled = false;
      save.textContent = 'Save changes';
    }
  });
  return form;
}

export function openAutomationEditor(entry, ctx, { trigger } = {}) {
  if (!entry) return;
  if (openId === entry.id && current?.dialog?.open) return current;
  if (current?.dialog?.open) current.close(false);
  openId = entry.id;
  const s = shell({ title: `Edit ${entry.name}`, className: 'hae-dialog', trigger, wide: false });
  const close = (updateRoute = true) => {
    if (!s.dialog.open) return;
    openId = null;
    current = null;
    s.close();
    if (updateRoute) editAutomation(null);
  };
  current = { ...s, close };
  s.dialog.addEventListener('close', () => {
    if (openId === entry.id) { openId = null; current = null; editAutomation(null); }
  }, { once: true });
  s.body.appendChild(formFor(entry, ctx, close));
  return current;
}

function openDefaultsEditor(ctx, trigger) {
  const defaults = ctx.config()?.automationDefaults || {};
  const effective = effectiveRun({ id: null, run: defaults }, {});
  if (openId === 'defaults' && current?.dialog?.open) return current;
  if (current?.dialog?.open) current.close(false);
  openId = 'defaults';
  const s = shell({ title: 'Automation defaults', className: 'hae-dialog', trigger, wide: false });
  const close = (updateRoute = true) => {
    if (!s.dialog.open) return;
    openId = null; current = null; s.close();
    if (updateRoute) editAutomationDefaults(false);
  };
  current = { ...s, close };
  const form = el('form', 'hr-edit-form hae-form');
  form.appendChild(el('p', 'hae-intro', 'Defaults apply to automations that do not override the same field. Schedule and enabled state remain per automation.'));
  const path = el('code', 'hae-path');
  requestAnimationFrame(() => { path.textContent = window.location.pathname + window.location.search; });
  form.appendChild(path);
  const fields = {
    harness: el('select'),
    model: input('text', effective.model || '', { maxlength: '120' }),
    effort: el('select'),
    cli: input('text', effective.cli, { maxlength: '500' }),
    arguments: Object.assign(el('textarea'), { value: (effective.arguments || []).join('\n'), rows: 2, maxLength: 4000 }),
    runner: input('text', effective.runner, { maxlength: '500' }),
    skill: input('text', defaults.skill || '', { maxlength: '80' }),
    prompt: Object.assign(el('textarea'), { value: defaults.prompt || '', rows: 4 }),
  };
  for (const value of HARNESSES) { const o = el('option', '', value); o.value = value; o.selected = value === effective.harness; fields.harness.appendChild(o); }
  for (const value of EFFORTS) { const o = el('option', '', value); o.value = value; o.selected = value === effective.effort; fields.effort.appendChild(o); }
  fields.harness.addEventListener('change', () => { const preset = HARNESS_DEFAULTS[fields.harness.value]; if (preset?.cli) fields.cli.value = preset.cli; fields.model.value = preset?.model || ''; });
  form.append(
    field('Default harness', 'Claude Code, Codex, Copilot, OpenCode, or a custom command.', fields.harness),
    field('Default model', 'Inherited unless the automation overrides it.', fields.model),
    field('Default effort', 'Reasoning effort where the selected harness supports it.', fields.effort),
    field('Default CLI executable', 'Command name or absolute executable path.', fields.cli),
    field('Default extra arguments', 'One argument per line, added before the prompt.', fields.arguments),
    field('Runner', 'LaunchAgent runner script path.', fields.runner),
    field('Default skill', 'Leave blank to use each automation id.', fields.skill),
    field('Default prompt', 'Leave blank to generate the skill prompt.', fields.prompt),
  );
  const error = el('p', 'hae-error'); error.hidden = true; error.setAttribute('role', 'alert');
  const actions = el('div', 'hae-actions');
  const cancel = el('button', 'hp-dlg-btn', 'Cancel'); cancel.type = 'button'; cancel.addEventListener('click', () => close());
  const save = el('button', 'hp-dlg-btn hae-save', 'Save defaults'); save.type = 'submit';
  actions.append(cancel, save); form.append(error, actions); s.body.appendChild(form);
  form.addEventListener('submit', async e => {
    e.preventDefault(); save.disabled = true; error.hidden = true;
    try {
      const res = await fetch(`/api/home/automation-defaults?project=${encodeURIComponent(ctx.project())}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ harness: fields.harness.value, model: fields.model.value || null, effort: fields.effort.value, cli: fields.cli.value, runner: fields.runner.value, arguments: fields.arguments.value.split('\n').map(x => x.trim()).filter(Boolean), skill: fields.skill.value || null, prompt: fields.prompt.value || null }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `The server answered ${res.status}.`);
      ctx.toast?.(out.warnings?.length ? out.warnings.join(' ') : 'Automation defaults saved.');
      await loadRuns(ctx.project(), { force: true });
      close(true);
    } catch (err) { error.textContent = err.message; error.hidden = false; }
    finally { save.disabled = false; }
  });
  return current;
}

export function createAutomationEditor(ctx) {
  const sync = () => {
    if (isEditingAutomationDefaults()) return openDefaultsEditor(ctx, document.querySelector('.hr-defaults-btn'));
    const id = getAutomationId();
    if (!id) { if (current?.dialog?.open) current.close(false); return; }
    const entry = (getRuns().automations || []).find(a => a.id === id);
    if (entry) {
      const trigger = document.querySelector(`.hr-row[data-id="${CSS.escape(id)}"] .hr-edit-btn`);
      openAutomationEditor(entry, ctx, { trigger });
    }
  };
  const dispose = () => current?.close?.(false);
  return { sync, dispose };
}

export function closeAutomationEditor() { current?.close?.(); }
export function automationEditorOpen() { return !!current?.dialog?.open; }

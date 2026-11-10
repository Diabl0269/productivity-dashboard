// autorun-card.js — Overview "Autorun" card: edits $CH_HOME/autorun.json and the autorun.off kill switch
// through GET/POST /api/autorun. Defaults and validation come from shared/autorun-settings.js.

import { DEFAULTS, validateSettings } from '../../shared/autorun-settings.js';

let busy = false;

function els() {
  const root = document.getElementById('autorunWidget');
  if (!root) return null;
  return {
    root,
    on: root.querySelector('#autorunOn'),
    onLabel: root.querySelector('#autorunOnLabel'),
    fields: root.querySelector('#autorunFields'),
    save: root.querySelector('#autorunSave'),
    status: root.querySelector('#autorunStatus'),
    inputs: [...root.querySelectorAll('input[data-key]')],
  };
}

function setStatus(e, msg, isError = false) {
  e.status.textContent = msg;
  e.status.classList.toggle('is-error', isError);
}

function showOnState(e) {
  e.onLabel.textContent = e.on.checked ? 'Autorun is on' : 'Autorun is off (paused)';
  e.fields.classList.toggle('is-off', !e.on.checked);
}

/** Fill the inputs from a { settings, off } payload; a null maxTotal shows empty (no manual cap). */
function render(e, data) {
  e.on.checked = !data.off;
  for (const input of e.inputs) {
    const key = input.dataset.key;
    input.placeholder = key === 'maxTotal' ? `${DEFAULTS.maxTotal} (empty = no manual cap)` : String(DEFAULTS[key]);
    input.value = data.settings[key] === null || data.settings[key] === undefined ? '' : String(data.settings[key]);
    input.removeAttribute('aria-invalid');
  }
  showOnState(e);
}

/** Read the form: empty input = default for every key, and "no manual cap" (null) for maxTotal. */
function readForm(e) {
  const values = {};
  for (const input of e.inputs) {
    const key = input.dataset.key;
    const raw = input.value.trim();
    values[key] = raw === '' ? (key === 'maxTotal' ? null : DEFAULTS[key]) : Number(raw);
  }
  return values;
}

async function load(e) {
  try {
    const res = await fetch('/api/autorun', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    render(e, await res.json());
    setStatus(e, '');
  } catch (err) {
    setStatus(e, `Could not load autorun settings (${err.message})`, true);
  }
}

async function save(e) {
  if (busy) return;
  const values = readForm(e);
  const checked = validateSettings(values);
  e.inputs.forEach(i => i.removeAttribute('aria-invalid'));
  if (!checked.ok) {
    const bad = e.inputs.find(i => checked.error.startsWith(i.dataset.key));
    if (bad) { bad.setAttribute('aria-invalid', 'true'); bad.focus(); }
    setStatus(e, checked.error, true);
    return;
  }
  busy = true;
  e.save.disabled = true;
  setStatus(e, 'Saving...');
  try {
    const res = await fetch('/api/autorun', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...values, off: !e.on.checked }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    render(e, body);
    setStatus(e, 'Saved');
  } catch (err) {
    setStatus(e, `Save failed: ${err.message}`, true);
  } finally {
    busy = false;
    e.save.disabled = false;
  }
}

export function initAutorunCard() {
  const e = els();
  if (!e) return;
  e.on.addEventListener('change', () => showOnState(e));
  e.save.addEventListener('click', () => save(e));
  e.inputs.forEach(i => i.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(e); } }));
  load(e);
}

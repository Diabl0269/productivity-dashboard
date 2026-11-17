// home-notice.js — what Home says above the view about the project's home.config.json: a
// "Set up this project" card when there is none, the problems in plain words when it has any.

const EXAMPLE_FILE = 'home.config.example.json';
const DOC_FILE = 'docs/home-page.md';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function errorList(errors) {
  const ul = el('ul', 'hm-errors');
  for (const e of errors) ul.appendChild(el('li', '', e));
  return ul;
}

function setupCard(project) {
  const card = el('section', 'hm-card hm-setup');
  card.setAttribute('aria-labelledby', 'hmSetupTitle');
  const h = el('h2', 'hm-card-title', 'Set up this project');
  h.id = 'hmSetupTitle';
  card.appendChild(h);
  card.appendChild(el('p', 'hm-card-text', project
    ? `"${project}" has no home config yet, so Home cannot draw its map or group its work.`
    : 'No project has a home config yet, so Home cannot draw a map or group the work.'));
  const steps = el('ol', 'hm-steps');
  const s1 = el('li');
  s1.append('Copy ', el('code', '', EXAMPLE_FILE), ' (in the tracker\'s own folder, next to serve.js) to your project and name it ', el('code', '', 'home.config.json'), '.');
  const s2 = el('li', '', 'Describe your groups and areas in it.');
  const s3 = el('li');
  s3.append('Add it to your tracker ', el('code', '', 'config.json'), ':');
  s3.appendChild(el('pre', 'hm-code', `"home": { "${project || '<project slug>'}": "/absolute/path/to/home.config.json" }`));
  steps.append(s1, s2, s3);
  card.appendChild(steps);
  const doc = el('p', 'hm-card-note');
  doc.append('Every key is explained in ', el('code', '', DOC_FILE), '.');
  card.appendChild(doc);
  return card;
}

function brokenCard(data) {
  const card = el('section', 'hm-card hm-broken');
  card.setAttribute('role', 'alert');
  card.appendChild(el('h2', 'hm-card-title', `The home config for "${data.project}" could not be used`));
  if (data.path) card.appendChild(el('p', 'hm-card-note', data.path));
  card.appendChild(errorList(data.errors || []));
  const doc = el('p', 'hm-card-note');
  doc.append('The keys are explained in ', el('code', '', DOC_FILE), '.');
  card.appendChild(doc);
  return card;
}

function problemsNote(data) {
  const box = el('details', 'hm-problems');
  const n = data.errors.length;
  const file = (data.path || 'home.config.json').split('/').pop();
  const sum = el('summary', '', `${n} ${n === 1 ? 'problem' : 'problems'} in ${file}; the rest of the file is used.`);
  sum.dataset.hmKey = 'problems';
  box.append(sum, errorList(data.errors));
  return box;
}

/**
 * Paint the notice for the current /api/home answer (or nothing). Redraws only when the answer
 * changes, so the 5 s poll never moves it.
 * @param {HTMLElement} slot
 * @param {object|null} data the /api/home answer
 * @param {boolean} loading
 */
export function paintNotice(slot, data, loading) {
  const sig = loading && !data ? 'loading' : JSON.stringify([data?.project, data?.missing, data?.path, data?.errors, !!data?.config]);
  if (slot.dataset.sig === sig) return;
  const wasOpen = slot.querySelector('details')?.open;
  slot.dataset.sig = sig;
  slot.textContent = '';
  if (!data) return;
  if (data.missing) slot.appendChild(setupCard(data.project));
  else if (!data.config) slot.appendChild(brokenCard(data));
  else if (data.errors?.length) {
    const note = problemsNote(data);
    note.open = !!wasOpen;
    slot.appendChild(note);
  }
}

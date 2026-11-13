// check-evidence.js — "Open project" / "Play video" buttons for a review check that carries
// a saved project and a short video (paths under CH_HOME/evidence, see shared/review.js).
// Used by the Plan page check grid and the review panel in the task detail.

import { projectName } from '../../shared/review.js';

let toastTimer = null;

/** Same toast element the Plan page uses (#runPlanToast), created on demand. */
export function showEvidenceToast(message) {
  let toast = document.getElementById('runPlanToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'rp-toast';
    toast.id = 'runPlanToast';
    toast.setAttribute('role', 'status');
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

/** "/evidence/<rel>" with each path segment encoded. */
export function evidenceUrl(rel) {
  return '/evidence/' + String(rel).split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/** "just now", "5 minutes ago", "2 hours ago", "3 days ago" for an ISO time; '' when unparseable. */
export function ageText(iso, now = Date.now()) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 1) return 'just now';
  const unit = (n, word) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (mins < 60) return unit(mins, 'minute');
  if (mins < 60 * 48) return unit(Math.round(mins / 60), 'hour');
  return unit(Math.round(mins / 1440), 'day');
}

/** The toast text for a successful open-project response. */
export function openedMessage(res, now = Date.now()) {
  if (!res || !res.app) return 'Opened with the default app';
  const name = String(res.app).split('/').filter(Boolean).pop();
  const age = ageText(res.builtAt, now);
  return age ? `Opened in the build from ${age} (${name})` : `Opened in ${name}`;
}

/** Ask the server to open a saved project; toasts the build used, or the error text. */
export async function openProject(project, { toast = showEvidenceToast, fetchFn = fetch } = {}) {
  try {
    const resp = await fetchFn('/api/open-project', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: project }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Could not open the project (HTTP ${resp.status})`);
    toast(openedMessage(data));
  } catch (e) {
    toast(`Could not open the project: ${e.message}`);
  }
}

function button(text, label, className = 'rp-btn ce-btn') {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = className;
  btn.textContent = text;
  btn.setAttribute('aria-label', label);
  return btn;
}

/** "Open project" button for one project; `label` names what it opens for screen readers. */
export function openProjectButton(project, label) {
  const btn = button('Open project', label || `Open project ${projectName(project)}`);
  btn.title = `Open ${project} in the newest build`;
  btn.addEventListener('click', () => openProject(project));
  return btn;
}

/** The inline player for a check's (or a decision's) video; pressing the button again removes it. */
export function playVideoButton(check, number, host, label = `check ${number}`) {
  const btn = button('Play video', `Play video for ${label}`);
  btn.setAttribute('aria-pressed', 'false');
  btn.title = `Play ${check.video}`;
  let video = null;
  btn.addEventListener('click', () => {
    if (video) {
      video.pause();
      video.remove();
      video = null;
      btn.textContent = 'Play video';
      btn.setAttribute('aria-label', `Play video for ${label}`);
      btn.setAttribute('aria-pressed', 'false');
      return;
    }
    video = document.createElement('video');
    video.className = 'ce-video';
    video.controls = true;
    video.autoplay = true;
    video.muted = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.preload = 'metadata';
    video.setAttribute('aria-label', `Video for ${label}`);
    video.src = evidenceUrl(check.video);
    host.appendChild(video);
    btn.textContent = 'Hide video';
    btn.setAttribute('aria-label', `Hide video for ${label}`);
    btn.setAttribute('aria-pressed', 'true');
  });
  return btn;
}

/** An inline <audio controls> player for a check's audio (always shown, no button; the same place Play video sits). */
export function audioPlayer(check, number, label = `check ${number}`) {
  const audio = document.createElement('audio');
  audio.className = 'ce-audio';
  audio.controls = true;
  audio.preload = 'metadata';
  audio.setAttribute('aria-label', `Audio for ${label}`);
  audio.title = check.audio;
  audio.src = evidenceUrl(check.audio);
  return audio;
}

/** Small header row for a group of checks sharing a project: "Project: end.agsproj" and one Open project button. */
export function projectGroupHeader(project, className = 'ce-group-head') {
  const row = document.createElement('div');
  row.className = className;
  const name = document.createElement('span');
  name.className = 'ce-group-name';
  name.textContent = `Project: ${projectName(project)}`;
  name.title = project;
  row.appendChild(name);
  row.appendChild(openProjectButton(project, `Open project ${projectName(project)}`));
  return row;
}

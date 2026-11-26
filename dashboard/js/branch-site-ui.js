// branch-site-ui.js — WEB49: a held-branch check of a project with a config.json `branchSites` rule gets one
// "Run site and open" button: the server starts that branch's site in a Terminal window, and the page opens
// in a new tab once the port answers. The rule lookup is asked once per project per page load; silent when
// the server cannot answer (file: protocol, old server), so the button just never shows.

import { showEvidenceToast } from './check-evidence.js';

const rules = new Map(); // project -> Promise<{ configured, url?, command? }>

/** Is a branch-site rule configured for `project`? Asked once per project per page load. */
export function branchSiteRuleOnce(project, fetchFn = typeof fetch === 'function' ? fetch : null) {
  if (!rules.has(project)) {
    const none = { configured: false };
    if (!fetchFn || !project || (typeof location !== 'undefined' && location.protocol === 'file:')) rules.set(project, Promise.resolve(none));
    else {
      rules.set(project, fetchFn(`/api/branch-site?project=${encodeURIComponent(project)}`)
        .then(r => (r.ok ? r.json() : none)).then(j => (j?.configured ? j : none)).catch(() => none));
    }
  }
  return rules.get(project);
}

export const branchSiteLabel = (branch) => `Run the site of branch ${branch} and open it`;

/** Poll `/api/branch-site/ready?url=` every `intervalMs` until ready (true) or `timeoutMs` passes (false). */
export async function pollSiteReady({ url, fetchFn = fetch, sleep = (ms) => new Promise(r => setTimeout(r, ms)), intervalMs = 2000, timeoutMs = 240000 }) {
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    try {
      const r = await fetchFn(`/api/branch-site/ready?url=${encodeURIComponent(url)}`);
      if (r.ok && (await r.json())?.ready) return true;
    } catch { /* keep trying */ }
    await sleep(intervalMs);
  }
  return false;
}

/**
 * The button for a held check (null without a branch). It starts hidden and appears once the project's rule is
 * known; `btn.configured` resolves to true/false so the caller can drop the app-build Open project button.
 */
export function branchSiteButton(check, project, deps = {}) {
  const branch = check?.heldPr?.branch;
  if (!branch || !project) return null;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'rp-btn ce-btn';
  btn.textContent = 'Run site and open';
  btn.setAttribute('aria-label', branchSiteLabel(branch));
  btn.hidden = true;
  btn.configured = branchSiteRuleOnce(project, deps.fetchFn).then((rule) => {
    if (rule.configured) { btn.hidden = false; btn.title = rule.command || ''; }
    return !!rule.configured;
  });
  btn.addEventListener('click', async () => {
    const toast = deps.toast || showEvidenceToast;
    const w = window.open('', '_blank'); // opened now, in the click, so the popup blocker allows it
    try { w?.document.write(`<p style="font:16px sans-serif">Starting branch ${branch.replace(/[<&]/g, '')}… (a Terminal window shows the logs)</p>`); } catch { /* cross-origin */ }
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const resp = await fetch('/api/branch-site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch, project }) });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`);
      toast(`Starting branch ${branch} in Terminal; the page opens when it is up`);
      if (await pollSiteReady({ url: data.url })) { if (w) w.location = data.url; else window.open(data.url, '_blank'); }
      else { toast(`Branch ${branch} did not come up in 4 minutes: see its Terminal window`); w?.close(); }
    } catch (e) {
      toast(`Could not start branch ${branch}: ${e.message}`);
      w?.close();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Run site and open';
    }
  });
  return btn;
}

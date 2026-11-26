/**
 * server/branch-site.js
 * WEB49: "Run site and open" for a review check on an unmerged website branch. config.json `branchSites` maps
 * projects to a shell command (with `{branch}`) that starts that branch's site and the URL it serves. The start
 * writes a .command script under $CH_HOME/run and `open`s it (macOS runs it in Terminal, logs visible).
 * Pure and injectable (`launch`, `writeFile`) so tests never start anything.
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { originAllowed, defaultLaunch } from '../cli/lib/evidence.js';

const BRANCH_RE = /^[A-Za-z0-9._/-]{1,200}$/;
const httpError = (status, message) => Object.assign(new Error(message), { status });

/** Is this an http(s) URL on localhost or 127.0.0.1? */
export function isLocalUrl(url) {
  try {
    const u = new URL(String(url));
    return (u.protocol === 'http:' || u.protocol === 'https:') && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
  } catch { return false; }
}

/** config.json `branchSites`: valid rules only (malformed ones are dropped). */
export function readBranchSites(dataRoot) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(dataRoot, 'config.json'), 'utf8'));
    if (!Array.isArray(cfg.branchSites)) return [];
    return cfg.branchSites.filter(r => r && Array.isArray(r.projects) && r.projects.length
      && r.projects.every(p => typeof p === 'string' && p.trim())
      && typeof r.command === 'string' && r.command.includes('{branch}')
      && isLocalUrl(r.url)).map(r => ({ projects: r.projects, command: r.command, url: r.url }));
  } catch { return []; }
}

/** The first rule that lists `project`, or null. */
export function pickBranchSite(rules, project) {
  return (rules || []).find(r => r.projects.includes(project)) || null;
}

export function checkBranch(branch) {
  if (typeof branch !== 'string' || !BRANCH_RE.test(branch) || branch.startsWith('-')) throw httpError(400, 'invalid branch name');
  return branch;
}

/** The rule's command with `{branch}` replaced by the single-quoted branch. */
export function resolveCommand(rule, branch) {
  checkBranch(branch);
  return rule.command.split('{branch}').join(`'${branch}'`);
}

/** The .command script text for a rule and branch (400 on a bad branch). */
export function branchSiteScript(rule, branch) {
  return `#!/bin/bash\n# Started by the dashboard: branch ${branch}. Its logs show in this window.\n${resolveCommand(rule, branch)}\n`;
}

/** GET /api/branch-site?project=X */
export function handleBranchSiteInfo({ dataRoot, project }) {
  const rule = pickBranchSite(readBranchSites(dataRoot), project);
  return { status: 200, json: rule ? { configured: true, url: rule.url, command: rule.command } : { configured: false } };
}

/** POST /api/branch-site { branch, project }: write the script and open it in Terminal. */
export async function handleStartBranchSite({ origin, host, bodyText, dataRoot, launch = defaultLaunch, writeFile, isUp = portOpen }) {
  if (!originAllowed(origin, host)) return { status: 403, json: { error: 'cross-origin request refused' } };
  let body;
  try { body = JSON.parse(bodyText || '{}'); } catch { return { status: 400, json: { error: 'invalid JSON' } }; }
  const project = typeof body?.project === 'string' ? body.project : '';
  const rule = pickBranchSite(readBranchSites(dataRoot), project);
  if (!rule) return { status: 404, json: { error: `no branchSites rule for project ${project} (config.json)` } };
  // A site already on the port (another branch, or this one started earlier) would be opened in its place.
  if (await isUp(rule.url)) {
    return { status: 409, json: { error: `something already runs on ${rule.url}: stop that site first (see its Terminal window), then press again`, busy: true } };
  }
  try {
    const branch = body.branch;
    const script = branchSiteScript(rule, branch);
    const file = path.join(dataRoot, 'run', `branch-site-${branch.replace(/\//g, '-')}.command`);
    if (writeFile) await writeFile(file, script);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, script, { mode: 0o755 });
      fs.chmodSync(file, 0o755);
    }
    await launch('open', [file]);
    return { status: 200, json: { url: rule.url, command: resolveCommand(rule, branch), script: file } };
  } catch (e) {
    return { status: e.status || 500, json: { error: e.message } };
  }
}

/** Does something listen on the local URL's port? */
export function portOpen(url) {
  const u = new URL(url);
  const port = Number(u.port) || (u.protocol === 'https:' ? 443 : 80);
  return new Promise((resolve) => {
    const sock = net.connect({ host: u.hostname, port });
    const done = (ready) => { sock.destroy(); resolve(ready); };
    sock.setTimeout(1000);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}

/** GET /api/branch-site/ready?url=: does something listen on the URL's local port? */
export async function handleBranchSiteReady({ url }) {
  if (!isLocalUrl(url)) return { status: 400, json: { error: 'only localhost URLs' } };
  return { status: 200, json: { ready: await portOpen(url) } };
}

/**
 * cli/test/check-evidence.test.js
 * A review check can carry a saved project and a short video (paths under CH_HOME/evidence):
 * shared helpers, `ch tasks review` flags, epic roll-up, lint, the server helpers and the
 * dashboard's pure helpers. Synthetic data only; nothing here launches an app.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  projectPathError, videoPathError, normalizeCheckInput, noVideoReasonError, addChecks, groupChecksByProject, rollUpIntoEpic,
} from '../../shared/review.js';
import { validateTasksDoc as validateTasks } from '../lib/schema.js';
import {
  toEvidenceRel, resolveEvidence, parseRange, evidenceVideoResponse, originAllowed, pickReviewApp,
  openProject, handleOpenProject, readReviewApps,
} from '../lib/evidence.js';
import { ageText, evidenceUrl, openedMessage, openProject as dashOpenProject } from '../../dashboard/js/check-evidence.js';
import { loadTasksJson, serializeTasksJson } from '../../dashboard/js/tasks-json.js';
import { mergeTasksDocs } from '../../shared/tasks-merge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_SAMPLE = path.join(__dirname, 'fixtures/tasks.sample.json');
const CH_SCRIPT = path.resolve(__dirname, '../../ch');

function makeHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-evidence-test-'));
  fs.copyFileSync(FIXTURE_SAMPLE, path.join(home, 'tasks.json'));
  const doc = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  for (const s of doc.sections) for (const t of s.tasks) for (const st of t.subtasks || []) st.checked = true;
  fs.writeFileSync(path.join(home, 'tasks.json'), JSON.stringify(doc));
  const dir = path.join(home, 'evidence', 'T1', 'one');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'end.agsproj')); // a bundle is a folder
  fs.writeFileSync(path.join(dir, 'other.agsproj'), 'x');
  fs.writeFileSync(path.join(dir, 'one.mp4'), '0123456789');
  return home;
}

function run(args, home) {
  const r = spawnSync(process.execPath, [CH_SCRIPT, ...args], { env: { ...process.env, CH_HOME: home }, encoding: 'utf8' });
  return { stdout: r.stdout || '', stderr: r.stderr || '', status: r.status ?? 2 };
}

function taskOf(home, id) {
  for (const s of JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8')).sections) {
    const t = s.tasks.find(x => x.id === id);
    if (t) return t;
  }
  return null;
}

const P = 'T1/one/end.agsproj';
const V = 'T1/one/one.mp4';

// --- shared/review.js -------------------------------------------------------

test('path validation: relative, no .., right extension', () => {
  assert.equal(projectPathError(P), null);
  assert.equal(videoPathError(V), null);
  assert.match(projectPathError('/abs/x.agsproj'), /relative/);
  assert.match(projectPathError('a/../x.agsproj'), /\.\./);
  assert.match(projectPathError('a/x.mp4'), /\.agsproj/);
  assert.match(videoPathError('a/x.mov'), /\.mp4/);
  assert.match(videoPathError(''), /non-empty/);
});

test('normalizeCheckInput: strings and objects, tidied paths, bad ones throw', () => {
  assert.deepEqual(normalizeCheckInput('  look  '), { text: 'look' });
  assert.deepEqual(normalizeCheckInput({ text: 'a', project: './T1//x.agsproj', video: V }), { text: 'a', project: 'T1/x.agsproj', video: V });
  assert.throws(() => normalizeCheckInput({ text: 'a', video: '../x.mp4' }), /\.\./);
  assert.throws(() => normalizeCheckInput({ project: P }), /text/);
  assert.throws(() => normalizeCheckInput(5), /string or an object/);
});

test('addChecks keeps project/video and fills them onto a re-reviewed check', () => {
  const task = {};
  assert.equal(addChecks(task, [{ text: 'a', project: P }, 'b']), 2);
  assert.equal(task.checks[0].project, P);
  task.checks[0].checked = true;
  assert.equal(addChecks(task, [{ text: 'a', project: 'other/x.agsproj', video: V }, { text: 'b', video: V }]), 0);
  assert.equal(task.checks[0].project, P, 'an existing project is kept');
  assert.equal(task.checks[0].video, V, 'a missing video is filled in');
  assert.equal(task.checks[0].checked, true, 'the tick is kept');
  assert.equal(task.checks[1].video, V);
});

test('groupChecksByProject: first-appearance groups, loose checks last, original objects and indexes', () => {
  const checks = [{ text: 'a' }, { text: 'b', project: 'p2.agsproj' }, { text: 'c', project: 'p1.agsproj' }, { text: 'd' }, { text: 'e', project: 'p2.agsproj' }];
  const groups = groupChecksByProject(checks);
  assert.deepEqual(groups.map(g => g.project), ['p2.agsproj', 'p1.agsproj', null]);
  assert.deepEqual(groups.map(g => g.items.map(i => i.index)), [[1, 4], [2], [0, 3]]);
  assert.equal(groups[0].items[1].check, checks[4]);
  assert.deepEqual(groupChecksByProject([{ text: 'x' }]), [{ project: null, items: [{ check: { text: 'x' }, index: 0 }] }]);
  assert.deepEqual(groupChecksByProject(undefined), []);
});

test('rollUpIntoEpic keeps project/video on the prefixed check', () => {
  const doc = { sections: [{ id: 'in-progress', tasks: [
    { id: 'E1', type: 'epic', title: 'e' },
    { id: 'C1', type: 'task', title: 'c', parentId: 'E1', result: { at: '2026-01-01T00:00:00Z', shipped: ['s'], ci: 'all passed' } },
  ] }, { id: 'review', tasks: [] }, { id: 'done', tasks: [] }] };
  const out = rollUpIntoEpic(doc, doc.sections[0].tasks[1], [{ text: 'look', project: P, video: V }, 'plain']);
  assert.equal(out.added, 2);
  const [a, b] = doc.sections[0].tasks[0].checks;
  assert.deepEqual([a.text, a.project, a.video], ['C1: look', P, V]);
  assert.equal(b.project, undefined);
});

// --- lint -------------------------------------------------------------------

test('lint accepts project/video on a check and rejects bad ones', () => {
  const home = makeHome();
  const file = path.join(home, 'tasks.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  const task = doc.sections[0].tasks[0];
  task.checks = [{ text: 'a', checked: false, project: P, video: V }];
  assert.deepEqual(validateTasks(doc).errors.filter(e => /checks\[0\]/.test(e)), []);
  task.checks = [{ text: 'a', checked: false, project: '../x.agsproj', video: 'x.mov' }];
  const errs = validateTasks(doc).errors.filter(e => /checks\[0\]/.test(e));
  assert.equal(errs.length, 2, errs.join('\n'));
});

// --- ch tasks review --------------------------------------------------------

test('review: --check-project / --check-video attach to the Nth --check (relative and absolute)', () => {
  const home = makeHome();
  const abs = path.join(home, 'evidence', V);
  const r = run(['tasks', 'review', 'T1', '--shipped', 's', '--check', 'first', '--check', 'second',
    '--check-project', `2=${P}`, '--check-video', `1=${abs}`, '--check-video', `2=${V}`], home);
  assert.equal(r.status, 0, r.stderr);
  const [c1, c2] = taskOf(home, 'T1').checks;
  assert.deepEqual([c1.project, c1.video], [undefined, V]);
  assert.deepEqual([c2.project, c2.video], [P, V]);
});

test('review: --result-json checks may be objects and are validated the same', () => {
  const home = makeHome();
  const json = JSON.stringify({ shipped: ['s'], checks: ['plain', { text: 'rich', project: P, video: V }] });
  const r = run(['tasks', 'review', 'T1', '--result-json', json], home);
  assert.equal(r.status, 0, r.stderr);
  const [a, b] = taskOf(home, 'T1').checks;
  assert.equal(a.project, undefined);
  assert.deepEqual([b.text, b.project, b.video], ['rich', P, V]);
  const bad = run(['tasks', 'review', 'T2', '--result-json', JSON.stringify({ shipped: ['s'], checks: [{ text: 'x', video: 'T1/one/missing.mp4' }] })], home);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /missing\.mp4/);
});

test('review: N out of range, outside evidence, missing file and .. all die and change nothing', () => {
  const home = makeHome();
  const outside = path.join(home, 'tasks.json');
  const cases = [
    [['--check-project', `2=${P}`], /between 1 and 1/],
    [['--check-project', `0=${P}`], /between 1 and 1/],
    [['--check-project', 'nonsense'], /N=<path>/],
    [['--check-video', `1=${outside}`], new RegExp(outside.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))],
    [['--check-video', '1=T1/one/nope.mp4'], /not found/],
    [['--check-project', '1=T1/one/gone.agsproj'], /not found/],
    [['--check-project', '1=T1/../one/end.agsproj'], /\.\./],
    [['--check-project', '1=T1/one/one.mp4'], /\.agsproj/],
    [['--check-video', `1=${path.join(home, 'evidence', '..', 'evidence', 'x', '..', '..', 'tasks.mp4')}`], /outside|not found/],
  ];
  for (const [flags, re] of cases) {
    const r = run(['tasks', 'review', 'T1', '--shipped', 's', '--check', 'one', ...flags], home);
    assert.notEqual(r.status, 0, flags.join(' '));
    assert.match(r.stderr, re, flags.join(' '));
  }
  assert.equal(taskOf(home, 'T1').checks, undefined);
});

test('review: a symlink out of the evidence folder is refused', () => {
  const home = makeHome();
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-evidence-out-'));
  fs.writeFileSync(path.join(outsideDir, 'x.mp4'), 'x');
  fs.symlinkSync(outsideDir, path.join(home, 'evidence', 'link'));
  const r = run(['tasks', 'review', 'T1', '--shipped', 's', '--check', 'one', '--check-video', '1=link/x.mp4'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /link\/x\.mp4/);
});

test('review: re-reviewing an existing check text keeps its fields, and the owner refusal still applies', () => {
  const home = makeHome();
  run(['tasks', 'review', 'T1', '--shipped', 's', '--check', 'look', '--check-project', `1=${P}`], home);
  const r = run(['tasks', 'review', 'T1', '--shipped', 's2', '--check', 'look', '--check-video', `1=${V}`], home);
  assert.equal(r.status, 0, r.stderr);
  const checks = taskOf(home, 'T1').checks;
  assert.equal(checks.length, 1);
  assert.deepEqual([checks[0].project, checks[0].video], [P, V]);
  const refused = run(['tasks', 'review', 'T2', '--shipped', 's', '--check', 'Run: npm test', '--check-video', `1=${V}`], home);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /yours, not Tal's/);
});

test('review: a child of an epic rolls its project/video up onto the epic check', () => {
  const home = makeHome();
  const file = path.join(home, 'tasks.json');
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  doc.sections[0].tasks.push({ id: 'T901', title: 'Epic', type: 'epic', checked: false, priority: 'medium', created: '2026-01-01', subtasks: [] });
  doc.sections[0].tasks.find(t => t.id === 'T1').parentId = 'T901';
  fs.writeFileSync(file, JSON.stringify(doc));
  const r = run(['tasks', 'review', 'T1', '--shipped', 's', '--check', 'look', '--check-project', `1=${P}`, '--check-video', `1=${V}`], home);
  assert.equal(r.status, 0, r.stderr);
  const [c] = taskOf(home, 'T901').checks;
  assert.deepEqual([c.text, c.project, c.video], ['T1: look', P, V]);
});

// --- server helpers ---------------------------------------------------------

test('toEvidenceRel: absolute paths must lie inside evidence', () => {
  const home = makeHome();
  assert.equal(toEvidenceRel(home, path.join(home, 'evidence', V), 'video'), V);
  assert.equal(toEvidenceRel(home, V, 'video'), V);
  assert.throws(() => toEvidenceRel(home, path.join(home, 'x.mp4'), 'video'), /outside the evidence folder/);
  assert.throws(() => toEvidenceRel(home, '/etc/passwd', 'video'), /outside/);
});

test('resolveEvidence: 400 for bad paths and symlink escapes, 404 when missing', () => {
  const home = makeHome();
  assert.ok(resolveEvidence(home, V, 'video').endsWith('one.mp4'));
  assert.throws(() => resolveEvidence(home, '../tasks.mp4', 'video'), { status: 400 });
  assert.throws(() => resolveEvidence(home, 'T1/one/x.txt', 'video'), { status: 400 });
  assert.throws(() => resolveEvidence(home, 'T1/one/none.mp4', 'video'), { status: 404 });
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-evidence-out-'));
  fs.writeFileSync(path.join(outsideDir, 'x.mp4'), 'secret');
  fs.symlinkSync(outsideDir, path.join(home, 'evidence', 'dirlink'));
  fs.symlinkSync(path.join(outsideDir, 'x.mp4'), path.join(home, 'evidence', 'filelink.mp4'));
  assert.throws(() => resolveEvidence(home, 'dirlink/x.mp4', 'video'), { status: 400 });
  assert.throws(() => resolveEvidence(home, 'filelink.mp4', 'video'), { status: 400 });
  assert.throws(() => resolveEvidence(path.join(home, 'nothing'), V, 'video'), { status: 404 });
});

test('parseRange and evidenceVideoResponse: 200, 206, 416, HEAD, errors', () => {
  assert.equal(parseRange(undefined, 10), null);
  assert.deepEqual(parseRange('bytes=2-4', 10), { start: 2, end: 4 });
  assert.deepEqual(parseRange('bytes=5-', 10), { start: 5, end: 9 });
  assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange('bytes=2-99', 10), { start: 2, end: 9 });
  for (const bad of ['bytes=10-', 'bytes=5-2', 'bytes=-', 'items=1-2', 'bytes=0-1,3-4']) assert.equal(parseRange(bad, 10), 'invalid', bad);

  const home = makeHome();
  const full = evidenceVideoResponse({ dataRoot: home, relPath: V });
  assert.equal(full.status, 200);
  assert.equal(full.headers['Content-Type'], 'video/mp4');
  assert.equal(full.headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(full.headers['Content-Length'], '10');
  const part = evidenceVideoResponse({ dataRoot: home, relPath: V, range: 'bytes=2-4' });
  assert.equal(part.status, 206);
  assert.equal(part.headers['Content-Range'], 'bytes 2-4/10');
  assert.equal(part.headers['Content-Length'], '3');
  assert.deepEqual([part.file.start, part.file.end], [2, 4]);
  const bad = evidenceVideoResponse({ dataRoot: home, relPath: V, range: 'bytes=50-' });
  assert.equal(bad.status, 416);
  assert.equal(bad.headers['Content-Range'], 'bytes */10');
  assert.equal(evidenceVideoResponse({ dataRoot: home, relPath: V, method: 'HEAD' }).file, undefined);
  assert.equal(evidenceVideoResponse({ dataRoot: home, relPath: 'T1/one/end.agsproj' }).status, 400);
  assert.equal(evidenceVideoResponse({ dataRoot: home, relPath: '../x.mp4' }).status, 400);
  assert.equal(evidenceVideoResponse({ dataRoot: home, relPath: 'T1/none.mp4' }).status, 404);
});

function makeApp(dir, name, ageDays) {
  const app = path.join(dir, name);
  fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
  const bin = path.join(app, 'Contents', 'MacOS', 'bin');
  fs.writeFileSync(bin, 'x');
  const t = new Date(Date.now() - ageDays * 86400000);
  fs.utimesSync(bin, t, t);
  return app;
}

test('pickReviewApp: newest build wins, missing apps are skipped, none gives null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-'));
  const old = makeApp(dir, 'Old.app', 5);
  const fresh = makeApp(dir, 'Fresh.app', 1);
  const picked = pickReviewApp([old, path.join(dir, 'Gone.app'), fresh]);
  assert.equal(picked.app, fresh);
  assert.ok(Math.abs(Date.parse(picked.builtAt) - (Date.now() - 86400000)) < 60000);
  assert.equal(pickReviewApp([path.join(dir, 'Gone.app')]), null);
  assert.equal(pickReviewApp([]), null);
});

test('openProject: launches open -a <newest build> <bundle>, or plain open; never a real launch', async () => {
  const home = makeHome();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-apps-'));
  const fresh = makeApp(dir, 'Fresh.app', 1);
  const calls = [];
  const launch = async (cmd, args) => { calls.push([cmd, args]); };
  const bundle = fs.realpathSync(path.join(home, 'evidence', P));

  const res = await openProject({ dataRoot: home, relPath: P, apps: [makeApp(dir, 'Old.app', 9), fresh], launch });
  assert.equal(res.ok, true);
  assert.equal(res.app, fresh);
  assert.ok(res.builtAt);
  assert.deepEqual(calls[0], ['open', ['-a', fresh, bundle]]);

  const none = await openProject({ dataRoot: home, relPath: P, apps: [path.join(dir, 'Gone.app')], launch });
  assert.deepEqual([none.app, none.builtAt], [null, null]);
  assert.deepEqual(calls[1], ['open', [bundle]]);

  await assert.rejects(openProject({ dataRoot: home, relPath: 'T1/one/one.mp4', launch }), { status: 400 });
  await assert.rejects(openProject({ dataRoot: home, relPath: 'T1/one/none.agsproj', launch }), { status: 404 });
  assert.equal(calls.length, 2);
});

test('handleOpenProject: foreign Origin refused, own host and no Origin allowed, bad body 400', async () => {
  const home = makeHome();
  const calls = [];
  const launch = async (cmd, args) => { calls.push(args); };
  const base = { host: 'localhost:3000', dataRoot: home, apps: [], launch };
  const body = JSON.stringify({ path: P });
  assert.equal(originAllowed(undefined, 'localhost:3000'), true);
  assert.equal(originAllowed('http://localhost:3000', 'localhost:3000'), true);
  assert.equal(originAllowed('http://evil.example', 'localhost:3000'), false);
  assert.equal(originAllowed('null', 'localhost:3000'), false);

  assert.equal((await handleOpenProject({ ...base, origin: 'http://evil.example', bodyText: body })).status, 403);
  assert.equal(calls.length, 0);
  assert.equal((await handleOpenProject({ ...base, origin: 'http://localhost:3000', bodyText: body })).status, 200);
  assert.equal((await handleOpenProject({ ...base, bodyText: body })).status, 200);
  assert.equal(calls.length, 2);
  assert.equal((await handleOpenProject({ ...base, bodyText: '{' })).status, 400);
  assert.equal((await handleOpenProject({ ...base, bodyText: '{}' })).status, 400);
  assert.equal((await handleOpenProject({ ...base, bodyText: JSON.stringify({ path: '../x.agsproj' }) })).status, 400);
  assert.equal((await handleOpenProject({ ...base, bodyText: JSON.stringify({ path: 'nope.agsproj' }) })).status, 404);
});

test('readReviewApps: reads config.json reviewProjectApps, empty when unset', () => {
  const home = makeHome();
  assert.deepEqual(readReviewApps(home), []);
  fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ reviewProjectApps: ['/a/B.app', '', 5] }));
  assert.deepEqual(readReviewApps(home), ['/a/B.app']);
});

// --- dashboard --------------------------------------------------------------

test('dashboard: tasks.json round trip and merge keep project/video on checks', () => {
  const doc = JSON.parse(fs.readFileSync(FIXTURE_SAMPLE, 'utf8'));
  doc.sections[0].tasks[0].checks = [{ text: 'a', checked: false, addedAt: '2026-01-01T00:00:00Z', project: P, video: V }];
  const mem = loadTasksJson(JSON.stringify(doc));
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks, mem.ticketTypes, mem.meta));
  const c = out.sections[0].tasks[0].checks[0];
  assert.deepEqual([c.project, c.video], [P, V]);
  // The dashboard saved before the CLI added the video: the disk copy's fields survive the merge.
  const base = JSON.parse(JSON.stringify(doc));
  delete base.sections[0].tasks[0].checks[0].video;
  const local = JSON.parse(JSON.stringify(base));
  local.sections[0].tasks[0].checks[0].checked = true;
  const merged = mergeTasksDocs(base, local, doc);
  const m = merged.sections[0].tasks[0].checks[0];
  assert.deepEqual([m.checked, m.project, m.video], [true, P, V]);
});

test('dashboard helpers: url encoding, age text, toast message, open-project round trip', async () => {
  assert.equal(evidenceUrl('T 1/a#b/x y.mp4'), '/evidence/T%201/a%23b/x%20y.mp4');
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(ageText('2026-11-01T11:59:40Z', now), 'just now');
  assert.equal(ageText('2026-11-01T11:55:00Z', now), '5 minutes ago');
  assert.equal(ageText('2026-11-01T11:00:00Z', now), '1 hour ago');
  assert.equal(ageText('2026-11-01T06:00:00Z', now), '6 hours ago');
  assert.equal(ageText('2026-10-30T12:00:00Z', now), '2 days ago');
  assert.equal(ageText('nope', now), '');
  assert.equal(openedMessage({ app: '/x/Synth.app', builtAt: '2026-10-30T12:00:00Z' }, now), 'Opened in the build from 2 days ago (Synth.app)');
  assert.equal(openedMessage({ app: null, builtAt: null }, now), 'Opened with the default app');

  const toasts = [];
  const sent = [];
  const ok = async (url, init) => { sent.push([url, JSON.parse(init.body)]); return { ok: true, json: async () => ({ ok: true, app: null }) }; };
  await dashOpenProject(P, { toast: m => toasts.push(m), fetchFn: ok });
  assert.deepEqual(sent[0], ['/api/open-project', { path: P }]);
  assert.equal(toasts[0], 'Opened with the default app');
  const fail = async () => ({ ok: false, status: 403, json: async () => ({ error: 'cross-origin request refused' }) });
  await dashOpenProject(P, { toast: m => toasts.push(m), fetchFn: fail });
  assert.match(toasts[1], /cross-origin request refused/);
  const boom = async () => { throw new Error('offline'); };
  await dashOpenProject(P, { toast: m => toasts.push(m), fetchFn: boom });
  assert.match(toasts[2], /offline/);
});

// --- noVideo (FRO1684): why a check has no video ----------------------------

test('noVideo: normalize trims, bounds 3-200 chars, refuses together with video', () => {
  assert.deepEqual(normalizeCheckInput({ text: 'a', noVideo: '  pure CLI change  ' }), { text: 'a', noVideo: 'pure CLI change' });
  assert.throws(() => normalizeCheckInput({ text: 'a', noVideo: 'no' }), /3-200/);
  assert.throws(() => normalizeCheckInput({ text: 'a', noVideo: 'x'.repeat(201) }), /3-200/);
  assert.throws(() => normalizeCheckInput({ text: 'a', video: V, noVideo: 'because' }), /both video and noVideo/);
  assert.match(noVideoReasonError('   ab   '), /3-200/);
});

test('noVideo: addChecks gains it on a repeated text, rollUp keeps it, lint rejects bad ones', () => {
  const task = { checks: [{ text: 'a', checked: true, addedAt: 'x' }] };
  addChecks(task, [{ text: 'a', noVideo: 'terminal only' }, { text: 'b', noVideo: 'no UI' }]);
  assert.equal(task.checks[0].noVideo, 'terminal only');
  assert.equal(task.checks[0].checked, true);
  assert.equal(task.checks[1].noVideo, 'no UI');
  const doc = { sections: [{ id: 'in-progress', tasks: [
    { id: 'E1', type: 'epic', title: 'e' },
    { id: 'C1', type: 'task', title: 'c', parentId: 'E1', result: { at: '2026-01-01T00:00:00Z', shipped: ['s'], ci: 'all passed' } },
  ] }, { id: 'review', tasks: [] }, { id: 'done', tasks: [] }] };
  rollUpIntoEpic(doc, doc.sections[0].tasks[1], [{ text: 'look', noVideo: 'no UI change' }]);
  assert.equal(doc.sections[0].tasks[0].checks[0].noVideo, 'no UI change');
  const home = makeHome();
  const full = JSON.parse(fs.readFileSync(path.join(home, 'tasks.json'), 'utf8'));
  const errsFor = () => validateTasks(full).errors.filter(e => /checks\[0\]/.test(e));
  full.sections[0].tasks[0].checks = [{ text: 'a', checked: false, noVideo: 'x' }];
  assert.equal(errsFor().length, 1);
  full.sections[0].tasks[0].checks = [{ text: 'a', checked: false, noVideo: 'fine reason', video: V }];
  assert.equal(errsFor().length, 1);
  full.sections[0].tasks[0].checks = [{ text: 'a', checked: false, noVideo: 'fine reason' }];
  assert.deepEqual(errsFor(), []);
});

test('review: --check-no-video N=<reason> is stored, shown by get, and refused with a video or bad input', () => {
  const home = makeHome();
  const r = run(['tasks', 'review', 'T1', '--shipped', 's', '--check', 'first', '--check', 'second', '--check-no-video', '2=nothing visible to film'], home);
  assert.equal(r.status, 0, r.stderr);
  const [c1, c2] = taskOf(home, 'T1').checks;
  assert.equal(c1.noVideo, undefined);
  assert.equal(c2.noVideo, 'nothing visible to film');
  assert.match(run(['tasks', 'get', 'T1'], home).stdout, /second \(no video: nothing visible to film\)/);
  for (const [args, re] of [
    [['--check-video', `1=${V}`, '--check-no-video', '1=because'], /both a video and a no-video/],
    [['--check-no-video', '2=because'], /between 1 and 1/],
    [['--check-no-video', '1=ab'], /3-200/],
    [['--check-no-video', 'oops'], /N=/],
  ]) {
    const h = makeHome();
    const bad = run(['tasks', 'review', 'T1', '--shipped', 's', '--check', 'one', ...args], h);
    assert.notEqual(bad.status, 0, args.join(' '));
    assert.match(bad.stderr, re);
    assert.equal(taskOf(h, 'T1').checks, undefined);
  }
});

test('review: --result-json check objects accept noVideo and refuse video + noVideo', () => {
  const home = makeHome();
  const ok = run(['tasks', 'review', 'T1', '--result-json', JSON.stringify({ shipped: ['s'], checks: [{ text: 'x', noVideo: 'no UI here' }] })], home);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(taskOf(home, 'T1').checks[0].noVideo, 'no UI here');
  const bad = run(['tasks', 'review', 'T2', '--result-json', JSON.stringify({ shipped: ['s'], checks: [{ text: 'x', video: V, noVideo: 'no UI here' }] })], home);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /both video and noVideo/);
});

test('dashboard loader keeps noVideo on a check', () => {
  const doc = JSON.parse(fs.readFileSync(FIXTURE_SAMPLE, 'utf8'));
  doc.sections[0].tasks[0].checks = [{ text: 'a', checked: false, noVideo: 'no UI' }];
  const mem = loadTasksJson(JSON.stringify(doc));
  const out = JSON.parse(serializeTasksJson(mem.sections, mem.tasks, mem.ticketTypes, mem.meta));
  assert.equal(out.sections[0].tasks[0].checks[0].noVideo, 'no UI');
});

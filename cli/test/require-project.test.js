// Creating a ticket needs a project (or an explicit --no-project): T-prefixed tickets are only
// for personal tasks, so a forgotten --project must fail instead of minting one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveCreateProject } from '../../shared/project-required.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const CH = path.resolve(here, '../../ch');
const projects = [{ id: 'frontend', name: 'Frontend', prefix: 'FRO' }, { id: 'backend', name: 'Backend', prefix: 'BAC' }];

function home() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-reqproj-'));
  fs.copyFileSync(path.join(here, 'fixtures/tasks.sample.json'), path.join(dir, 'tasks.json'));
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8'));
  doc.meta = { ...(doc.meta || {}), projects };
  fs.writeFileSync(path.join(dir, 'tasks.json'), JSON.stringify(doc, null, 2));
  return dir;
}

function ch(args, dir) {
  const r = spawnSync(process.execPath, [CH, ...args], { env: { ...process.env, CH_HOME: dir }, encoding: 'utf8' });
  return { status: r.status ?? 2, out: r.stdout || '', err: r.stderr || '' };
}

test('resolveCreateProject: explicit, opt-out, inherited, refused', () => {
  assert.deepEqual(resolveCreateProject({ project: ' frontend ' }), { project: 'frontend' });
  assert.deepEqual(resolveCreateProject({ noProject: true }), { project: null });
  assert.deepEqual(resolveCreateProject({ parentProject: 'backend' }), { project: 'backend' });
  assert.equal(resolveCreateProject({ project: 'a', parentProject: 'b' }).project, 'a');
  assert.equal(resolveCreateProject({ noProject: true, parentProject: 'b' }).project, null);
  const refused = resolveCreateProject({ metaProjects: projects });
  assert.match(refused.error, /frontend, backend/);
  assert.ok(resolveCreateProject({ project: 'a', noProject: true }).error);
});

test('ch tasks add refuses without a project and names the valid ones', () => {
  const dir = home();
  const r = ch(['tasks', 'add', 'Forgot the project'], dir);
  assert.notEqual(r.status, 0);
  assert.match(r.err + r.out, /needs a project/);
  assert.match(r.err + r.out, /frontend, backend/);
});

test('ch tasks add --project gets that project prefix; --no-project gets a T id', () => {
  const dir = home();
  const a = JSON.parse(ch(['tasks', 'add', 'A', '--project', 'frontend', '--json'], dir).out);
  assert.match(a.id, /^FRO\d+$/);
  const b = JSON.parse(ch(['tasks', 'add', 'B', '--no-project', '--json'], dir).out);
  assert.match(b.id, /^T\d+$/);
});

test('a child inherits its --parent and --review-of project', () => {
  const dir = home();
  const epic = JSON.parse(ch(['tasks', 'add', 'E', '--type', 'epic', '--lane', 'canvas', '--label', 'model:opus', '--project', 'backend', '--json'], dir).out).id;
  const child = JSON.parse(ch(['tasks', 'add', 'C', '--parent', epic, '--json'], dir).out).id;
  assert.match(child, /^BAC\d+$/);
  const followUp = JSON.parse(ch(['tasks', 'add', 'F', '--review-of', child, '--json'], dir).out).id;
  assert.match(followUp, /^BAC\d+$/);
  // a parent without a project does not rescue the child
  const personal = JSON.parse(ch(['tasks', 'add', 'P', '--no-project', '--json'], dir).out).id;
  assert.notEqual(ch(['tasks', 'add', 'Under personal', '--parent', personal], dir).status, 0);
});

test('ch tasks capture needs a project too', () => {
  const dir = home();
  assert.notEqual(ch(['tasks', 'capture', 'idea'], dir).status, 0);
  assert.equal(ch(['tasks', 'capture', 'idea', '--project', 'frontend'], dir).status, 0);
});

test('the dashboard create modal applies the same rule', () => {
  const src = fs.readFileSync(path.resolve(here, '../../dashboard/js/task-create.js'), 'utf8');
  assert.match(src, /resolveCreateProject\(/);
  assert.match(src, /No project \(personal task\)/);
});

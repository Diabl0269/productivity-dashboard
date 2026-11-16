// Test helper: a throwaway bakery project on disk (synthetic): <tmp>/site (the fixture folder:
// home.config.json + pages/) next to <tmp>/repo (a git repo the pages cover), and a CH_HOME whose
// config.json points the project "bakery" at the config. Used by the page tests.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const FIXTURE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'home-pages');

export function git(repo, args, env = {}) {
  return execFileSync('git', ['-C', repo, '-c', 'user.name=Test', '-c', 'user.email=t@example.com', '-c', 'commit.gpgsign=false', ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } }).trim();
}

/** Commit a file in the repo as of `date` (YYYY-MM-DD, noon local). */
export function commit(repo, file, date, message = `edit ${file}`) {
  const full = path.join(repo, file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.appendFileSync(full, `${message}\n`);
  git(repo, ['add', '-A']);
  const when = `${date}T12:00:00`;
  git(repo, ['commit', '-q', '-m', message], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
}

export function makeSite({ withRepo = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ch-pages-'));
  const site = path.join(root, 'site');
  fs.cpSync(FIXTURE, site, { recursive: true });
  const repo = path.join(root, 'repo');
  if (withRepo) { fs.mkdirSync(repo); git(repo, ['init', '-q']); }
  const dataRoot = path.join(root, 'data');
  fs.mkdirSync(dataRoot);
  fs.writeFileSync(path.join(dataRoot, 'config.json'), JSON.stringify({ home: { bakery: path.join(site, 'home.config.json') } }));
  return { root, site, repo, dataRoot, configPath: path.join(site, 'home.config.json') };
}

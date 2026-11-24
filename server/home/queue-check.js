/**
 * The optional `check` of a Home queue: a program from home.config.json (argv list, run with execFile, no
 * shell, 10 s limit) that looks at the queue file. Exit 0: nothing to report. Exit 1: every output line is a
 * problem to show on the panel. Anything else is reported as one line saying the check could not run.
 */

import path from 'node:path';
import { execFile } from 'node:child_process';

export const CHECK_TIMEOUT_MS = 10000;
const MAX_LINES = 20;

const linesOf = (...texts) => texts.join('\n').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

/** @returns {Promise<string[]>} the violations (never rejects) */
export function runQueueCheck(queue, configDir) {
  const check = queue.check;
  if (!check) return Promise.resolve([]);
  const [program, ...args] = check.command;
  const cwd = path.resolve(configDir, check.cwd || '.');
  return new Promise((resolve) => {
    execFile(program, args, { cwd, timeout: CHECK_TIMEOUT_MS, maxBuffer: 256 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (!err) return resolve([]);
      if (err.killed || err.signal) return resolve([`The check took longer than ${CHECK_TIMEOUT_MS / 1000} seconds and was stopped.`]);
      if (err.code === 1) {
        const lines = linesOf(stdout, stderr);
        const shown = lines.slice(0, MAX_LINES);
        if (lines.length > MAX_LINES) shown.push(`...and ${lines.length - MAX_LINES} more.`);
        return resolve(shown.length ? shown : ['The check reported a problem without saying what.']);
      }
      const why = typeof err.code === 'string' ? err.code === 'ENOENT' ? `"${program}" was not found` : err.code : `it exited with ${err.code}`;
      resolve([`The check could not run (${why}).`]);
    });
  });
}

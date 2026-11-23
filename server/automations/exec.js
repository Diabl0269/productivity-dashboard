import { execFile } from 'node:child_process';

/** execFile that never throws: resolves { code, stdout, stderr }. */
export function run(cmd, args = [], opts = {}) {
  return new Promise(resolve => {
    execFile(cmd, args, { timeout: 30000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || err?.message || '') });
    });
  });
}

/**
 * cli/lib/backup.js — Timestamped tasks.json backups under .backup/tasks/
 */

import fs from 'fs';
import path from 'path';
import { tasksJsonPath } from './io.js';

export function backupDir() {
  return path.join(path.dirname(tasksJsonPath()), '.backup', 'tasks');
}

/** ISO-ish timestamp safe for filenames: 2026-09-06T11-00-00Z */
export function backupTimestamp(d = new Date()) {
  return d.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, 'Z');
}

export function backupFileName(ts = backupTimestamp()) {
  return `tasks-${ts}.json`;
}

export function ensureBackupDir() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Create a timestamped backup of tasks.json.
 * @returns {{ name: string, path: string, createdAt: string }}
 */
export function createTasksBackup() {
  const src = tasksJsonPath();
  if (!fs.existsSync(src)) {
    throw new Error(`tasks.json not found at ${src}`);
  }
  const createdAt = new Date().toISOString();
  const name = backupFileName(backupTimestamp(new Date(createdAt)));
  const dir = ensureBackupDir();
  const dest = path.join(dir, name);
  fs.copyFileSync(src, dest);
  return { name, path: dest, createdAt };
}

/**
 * List available backups (newest first).
 * @returns {Array<{ name: string, path: string, size: number, mtime: string }>}
 */
export function listTasksBackups() {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter(f => f.startsWith('tasks-') && f.endsWith('.json'))
    .map(name => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return {
        name,
        path: full,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => b.mtime.localeCompare(a.mtime));
}

/**
 * Restore tasks.json from a backup file name (basename only).
 * @param {string} name
 */
export function restoreTasksBackup(name) {
  const base = path.basename(name);
  if (!base.startsWith('tasks-') || !base.endsWith('.json')) {
    throw new Error(`invalid backup name: ${name}`);
  }
  const src = path.join(backupDir(), base);
  if (!fs.existsSync(src)) {
    throw new Error(`backup not found: ${base}`);
  }
  const dest = tasksJsonPath();
  fs.copyFileSync(src, dest);
  return { name: base, path: dest };
}

/**
 * Read backup file content by name.
 */
export function readTasksBackup(name) {
  const base = path.basename(name);
  const src = path.join(backupDir(), base);
  if (!fs.existsSync(src)) {
    throw new Error(`backup not found: ${base}`);
  }
  return fs.readFileSync(src, 'utf8');
}

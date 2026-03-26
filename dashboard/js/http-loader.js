// http-loader.js - HTTP fetch fallback for loading tasks and memory when FileSystem API is unavailable

import { parseTaskMarkdown } from './tasks-parser.js';
import { parseMemoryMarkdown } from './memory-parser.js';

// Base path from dashboard/ to project root
const BASE = '..';

let httpWatchInterval = null;
let lastTaskContent = null;

/**
 * Load TASKS.md via HTTP fetch
 */
export async function loadTasksViaHttp() {
  try {
    const res = await fetch(`${BASE}/TASKS.md`);
    if (!res.ok) return null;
    const content = await res.text();
    lastTaskContent = content;
    return { content, parsed: parseTaskMarkdown(content) };
  } catch (e) {
    console.log('HTTP task load failed:', e.message);
    return null;
  }
}

/**
 * Start polling TASKS.md for changes via HTTP
 */
export function startHttpTaskWatching(onUpdate) {
  if (httpWatchInterval) clearInterval(httpWatchInterval);
  httpWatchInterval = setInterval(async () => {
    try {
      const res = await fetch(`${BASE}/TASKS.md`);
      if (!res.ok) return;
      const content = await res.text();
      if (content !== lastTaskContent) {
        lastTaskContent = content;
        onUpdate(parseTaskMarkdown(content));
      }
    } catch (e) { /* silent */ }
  }, 2000);
}

/**
 * Load memory directory via dynamic /api/memory-manifest endpoint
 */
export async function loadMemoryViaHttp() {
  try {
    // Try dynamic API first (custom serve.js), fall back to static manifest
    let manifest;
    const apiRes = await fetch(`/api/memory-manifest`);
    if (apiRes.ok) {
      manifest = await apiRes.json();
    } else {
      const staticRes = await fetch(`${BASE}/memory/manifest.json`);
      if (!staticRes.ok) return null;
      manifest = await staticRes.json();
    }

    const data = { claudeMd: null, memoryFiles: [], memoryDirs: {} };

    // Load CLAUDE.md
    if (manifest.claudeMd) {
      try {
        const res = await fetch(`${BASE}/${manifest.claudeMd}`);
        if (res.ok) {
          data.claudeMd = { content: await res.text(), fileHandle: null };
        }
      } catch (e) { /* skip */ }
    }

    // Load root memory files (e.g. memory/glossary.md)
    if (manifest.files) {
      const filePromises = manifest.files.map(async (filePath) => {
        try {
          const res = await fetch(`${BASE}/${filePath}`);
          if (!res.ok) return null;
          const name = filePath.split('/').pop();
          return { name, content: await res.text(), fileHandle: null };
        } catch (e) { return null; }
      });
      data.memoryFiles = (await Promise.all(filePromises)).filter(Boolean);
    }

    // Load subdirectory files (people/, projects/, context/)
    if (manifest.dirs) {
      for (const [dirName, paths] of Object.entries(manifest.dirs)) {
        const dirPromises = paths.map(async (filePath) => {
          try {
            const res = await fetch(`${BASE}/${filePath}`);
            if (!res.ok) return null;
            const name = filePath.split('/').pop();
            const content = await res.text();
            return { name, content, fileHandle: null, dirHandle: null, parsed: parseMemoryMarkdown(content) };
          } catch (e) { return null; }
        });
        data.memoryDirs[dirName] = (await Promise.all(dirPromises)).filter(Boolean);
      }
    }

    return data;
  } catch (e) {
    console.log('HTTP memory load failed:', e.message);
    return null;
  }
}

/**
 * Save a file via HTTP POST
 */
export async function httpSave(filePath, content) {
  const res = await fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || 'Save failed');
  }
}

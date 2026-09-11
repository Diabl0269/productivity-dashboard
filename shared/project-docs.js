/**
 * Project documentation discovery — links task projects to memory/projects files.
 * Shared by serve.js (Node) and dashboard (browser via API).
 */

const DOC_EXT_RE = /\.(md|txt|json)$/i;

/**
 * Resolve the memory slug for a project row (defaults to project id).
 * @param {{ id?: string, memorySlug?: string }} project
 */
export function projectMemorySlug(project) {
  if (typeof project?.memorySlug === 'string' && project.memorySlug.trim()) {
    return project.memorySlug.trim();
  }
  return project?.id || '';
}

/**
 * Normalize optional docs paths on a project row.
 * @param {unknown} docs
 * @returns {string[]}
 */
export function normalizeProjectDocs(docs) {
  if (!Array.isArray(docs)) return [];
  return docs
    .map(d => String(d).trim())
    .filter(Boolean)
    .filter(p => !p.includes('..'));
}

/**
 * Build a flat list of doc entry descriptors for a project.
 * Node callers pass `exists` + `scanDir`; browser uses the HTTP API instead.
 *
 * @param {object} opts
 * @param {string} opts.root - Absolute filesystem root
 * @param {{ id?: string, memorySlug?: string, docs?: string[] }} opts.project
 * @param {(rel: string) => boolean} opts.exists
 * @param {(absDir: string, baseRel: string) => Array<{ path: string, name: string, kind: string }>} [opts.scanDir]
 */
export function discoverProjectDocEntries({ root, project, exists, scanDir }) {
  const slug = projectMemorySlug(project);
  const entries = [];
  const seen = new Set();

  function add(relPath, name, kind = 'doc') {
    const norm = relPath.replace(/\\/g, '/');
    if (seen.has(norm)) return;
    seen.add(norm);
    entries.push({ path: norm, name: name || norm.split('/').pop(), kind });
  }

  if (slug) {
    const mainMd = `memory/projects/${slug}.md`;
    if (exists(mainMd)) add(mainMd, 'Overview', 'overview');

    const subDirRel = `memory/projects/${slug}`;
    if (scanDir) {
      const subEntries = scanDir(`${root}/${subDirRel}`, subDirRel);
      for (const e of subEntries) add(e.path, e.name, e.kind || 'doc');
    }
  }

  for (const rel of normalizeProjectDocs(project.docs)) {
    if (exists(rel)) {
      const base = rel.split('/').pop();
      add(rel, base.replace(/\.(md|txt|json)$/i, ''), 'link');
    }
  }

  return entries;
}

/**
 * Group flat entries into a simple folder tree for UI rendering.
 * @param {Array<{ path: string, name: string, kind?: string }>} entries
 */
export function buildDocTree(entries = []) {
  const root = { name: '', children: [], files: [] };

  for (const entry of entries) {
    const parts = entry.path.split('/');
    const fileName = parts.pop();
    let node = root;
    for (const part of parts) {
      let child = node.children.find(c => c.name === part);
      if (!child) {
        child = { name: part, children: [], files: [] };
        node.children.push(child);
      }
      node = child;
    }
    node.files.push({ ...entry, name: entry.name || fileName, fileName });
  }

  const sortNode = (n) => {
    n.children.sort((a, b) => a.name.localeCompare(b.name));
    n.files.sort((a, b) => {
      if (a.kind === 'overview') return -1;
      if (b.kind === 'overview') return 1;
      return a.name.localeCompare(b.name);
    });
    n.children.forEach(sortNode);
  };
  sortNode(root);
  return root;
}

/** True if path looks like a readable doc file. */
export function isDocPath(relPath) {
  return DOC_EXT_RE.test(relPath);
}

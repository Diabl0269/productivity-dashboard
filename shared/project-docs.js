/**
 * Project documentation discovery — memory/projects, repo paths, and local directories.
 * Shared by serve.js (Node) and dashboard (browser via API).
 */

const DOC_EXT_RE = /\.(md|txt|json)$/i;
const DOC_TEXT_EXT_RE = /\.(md|txt|json|mdc|yaml|yml|toml|css|html|jsx?|tsx?|sh|py|rb|go|rs|sql|csv)$/i;

/** Default globs when "Show all files" is off (memory/agent focused). */
export const DEFAULT_DOC_FILTER_PATTERNS = [
  'CLAUDE.md',
  'AGENTS.md',
  'AGENT.md',
  'README.md',
  '**/CLAUDE.md',
  '**/AGENTS.md',
  '**/AGENT.md',
  '**/agents/**',
  '**/memory/**',
  '**/.agents/**',
  '**/skills/**',
  '**/.cursor/rules/**',
  '**/.cursor/skills/**',
  'memory/projects/**',
];

export const DOC_SKIP_DIR_NAMES = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', 'coverage', '.cache', '__pycache__',
]);

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
 * Normalize optional docs paths on a project row (repo-relative).
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
 * Normalize absolute directory paths configured on a project.
 * @param {unknown} docDirs
 * @returns {string[]}
 */
export function normalizeProjectDocDirs(docDirs) {
  if (!Array.isArray(docDirs)) return [];
  return docDirs
    .filter(d => d != null)
    .map(d => String(d).trim())
    .filter(Boolean)
    .filter(p => !p.includes('..'));
}

/**
 * Parse filter patterns from newline or comma separated text.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function parseDocFilterPatterns(raw) {
  if (!raw) return [...DEFAULT_DOC_FILTER_PATTERNS];
  if (Array.isArray(raw)) {
    const list = raw.map(s => String(s).trim()).filter(Boolean);
    return list.length ? list : [...DEFAULT_DOC_FILTER_PATTERNS];
  }
  const list = String(raw)
    .split(/[\n,]+/)
    .map(s => s.trim())
    .filter(Boolean);
  return list.length ? list : [...DEFAULT_DOC_FILTER_PATTERNS];
}

function globToRegExp(glob) {
  let g = String(glob).replace(/\\/g, '/');
  let re = '^';
  for (let i = 0; i < g.length; ) {
    if (g[i] === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 3;
      } else {
        re += '.*';
        i += 2;
      }
    } else if (g[i] === '*') {
      re += '[^/]*';
      i += 1;
    } else if ('.+^${}()|[]\\'.includes(g[i])) {
      re += `\\${g[i]}`;
      i += 1;
    } else {
      re += g[i];
      i += 1;
    }
  }
  re += '$';
  return new RegExp(re, 'i');
}

/**
 * Simple glob match (** and *). Case-insensitive.
 * @param {string} targetPath
 * @param {string} pattern
 */
export function globMatch(targetPath, pattern) {
  const norm = targetPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const re = globToRegExp(pattern);
  return re.test(norm);
}

/**
 * @param {string} relPath - path relative to a doc root
 * @param {string[]} patterns
 */
export function matchesDocFilter(relPath, patterns) {
  const norm = relPath.replace(/\\/g, '/').replace(/^\.\/+/, '');
  const base = norm.split('/').pop() || norm;
  return patterns.some(p => globMatch(norm, p) || globMatch(base, p));
}

/**
 * @param {Array<{ treePath?: string, path?: string, name?: string, previewable?: boolean }>} entries
 * @param {{ showAll?: boolean, patterns?: string[] }} opts
 */
export function filterDocEntries(entries, { showAll = false, patterns = DEFAULT_DOC_FILTER_PATTERNS } = {}) {
  if (showAll) return entries;
  const pats = patterns?.length ? patterns : DEFAULT_DOC_FILTER_PATTERNS;
  return entries.filter(e => {
    const rel = e.treePath || e.path || e.name || '';
    return matchesDocFilter(rel, pats);
  });
}

/** Label for a configured directory root (basename). */
export function docDirLabel(absPath) {
  const parts = String(absPath).replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || absPath;
}

/**
 * Build a flat list of doc entry descriptors for a project.
 * Node callers pass `exists` + `scanDir`; browser uses the HTTP API instead.
 *
 * @param {object} opts
 * @param {string} opts.root - Absolute filesystem root
 * @param {{ id?: string, memorySlug?: string, docs?: string[], docDirs?: string[] }} opts.project
 * @param {(rel: string) => boolean} opts.exists
 * @param {(absDir: string, baseRel: string) => Array<{ path: string, name: string, kind: string }>} [opts.scanDir]
 */
export function discoverProjectDocEntries({ root, project, exists, scanDir }) {
  const slug = projectMemorySlug(project);
  const entries = [];
  const seen = new Set();

  function add(entry) {
    const id = entry.id || entry.path;
    const norm = id.replace(/\\/g, '/');
    if (seen.has(norm)) return;
    seen.add(norm);
    entries.push({
      id: norm,
      path: norm,
      treePath: entry.treePath || norm,
      name: entry.name || norm.split('/').pop(),
      kind: entry.kind || 'doc',
      source: entry.source || 'repo',
      rootLabel: entry.rootLabel || null,
      previewable: entry.previewable !== false,
    });
  }

  if (slug) {
    const mainMd = `memory/projects/${slug}.md`;
    if (exists(mainMd)) {
      add({
        id: mainMd,
        path: mainMd,
        treePath: 'Overview.md',
        name: 'Overview',
        kind: 'overview',
        source: 'memory',
      });
    }

    const subDirRel = `memory/projects/${slug}`;
    if (scanDir) {
      const subEntries = scanDir(`${root}/${subDirRel}`, subDirRel);
      for (const e of subEntries) {
        const rel = e.path.replace(/^memory\/projects\/[^/]+\/?/, '');
        add({
          id: e.path,
          path: e.path,
          treePath: rel || e.name,
          name: e.name,
          kind: e.kind || 'doc',
          source: 'memory',
        });
      }
    }
  }

  for (const rel of normalizeProjectDocs(project.docs)) {
    if (exists(rel)) {
      const base = rel.split('/').pop();
      add({
        id: rel,
        path: rel,
        treePath: rel,
        name: base.replace(/\.(md|txt|json)$/i, ''),
        kind: 'link',
        source: 'repo',
      });
    }
  }

  return entries;
}

/**
 * Scan an absolute directory into doc entries (Node only).
 * @param {string} absDir
 * @param {{ rootLabel?: string, showAll?: boolean, skipDir?: (name: string) => boolean, isPreviewable?: (name: string) => boolean }} [opts]
 */
export function scanAbsoluteDocDir(absDir, opts = {}) {
  const fs = opts.fs;
  if (!fs?.existsSync(absDir)) return [];
  const label = opts.rootLabel || docDirLabel(absDir);
  const showAll = !!opts.showAll;
  const skipDir = opts.skipDir || ((name) => DOC_SKIP_DIR_NAMES.has(name));
  const isPreviewable = opts.isPreviewable || ((name) => DOC_TEXT_EXT_RE.test(name));
  const entries = [];

  const walk = (dir, relParts) => {
    let list;
    try {
      list = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of list) {
      if (entry.name.startsWith('.') && entry.name !== '.agents' && entry.name !== '.cursor') continue;
      const abs = `${dir}/${entry.name}`.replace(/\\/g, '/');
      const rel = [...relParts, entry.name].join('/');
      if (entry.isDirectory()) {
        if (skipDir(entry.name)) continue;
        walk(abs, [...relParts, entry.name]);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!showAll && !DOC_TEXT_EXT_RE.test(entry.name) && !DOC_EXT_RE.test(entry.name)) continue;
      if (showAll && skipDir(entry.name)) continue;
      const id = `fs:${abs}`;
      entries.push({
        id,
        path: id,
        treePath: `${label}/${rel}`,
        name: entry.name.replace(/\.(md|txt|json)$/i, '') || entry.name,
        kind: 'doc',
        source: 'fs',
        rootLabel: label,
        previewable: isPreviewable(entry.name),
      });
    }
  };

  walk(absDir.replace(/\\/g, '/'), []);
  return entries;
}

/**
 * Group flat entries into a simple folder tree for UI rendering.
 * @param {Array<{ path: string, treePath?: string, name: string, kind?: string }>} entries
 */
export function buildDocTree(entries = []) {
  const root = { name: '', children: [], files: [] };

  for (const entry of entries) {
    const displayPath = entry.treePath || entry.path;
    const parts = displayPath.split('/');
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

/** True if file can be rendered as text in the preview pane. */
export function isPreviewableDocName(name) {
  return DOC_TEXT_EXT_RE.test(name) || DOC_EXT_RE.test(name);
}

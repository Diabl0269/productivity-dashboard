// serve.js - Lightweight dev server with static files + dynamic memory manifest
// Usage: node serve.js [port]

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT || process.argv[2] || 3000;
const ROOT = __dirname;

const MIME_TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.md': 'text/markdown', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function scanDir(dir, base = '') {
  const result = { files: [], dirs: {} };
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isFile() && entry.name.endsWith('.md')) {
      result.files.push(rel);
    } else if (entry.isDirectory()) {
      const sub = scanDir(path.join(dir, entry.name), rel);
      result.dirs[entry.name] = sub.files;
      Object.assign(result.dirs, sub.dirs);
    }
  }
  return result;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function decodeProjectPath(encoded) {
  // "-Users-jane-Documents-my-project" → "/Users/jane/Documents/my-project"
  return encoded.replace(/^-/, '/').replace(/-/g, '/');
}

function getProjectDisplayName(decodedPath) {
  const segments = decodedPath.split('/').filter(Boolean);
  return segments[segments.length - 1] || decodedPath;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS headers for all responses
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Dynamic memory manifest endpoint
  if (url.pathname === '/api/memory-manifest') {
    const memoryDir = path.join(ROOT, 'memory');
    const claudeMdExists = fs.existsSync(path.join(ROOT, 'CLAUDE.md'));
    const scan = fs.existsSync(memoryDir) ? scanDir(memoryDir, 'memory') : { files: [], dirs: {} };
    const manifest = {
      claudeMd: claudeMdExists ? 'CLAUDE.md' : null,
      files: scan.files,
      dirs: scan.dirs,
    };
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(manifest));
    return;
  }

  // Save file endpoint
  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      const body = JSON.parse(await readBody(req));
      const relPath = body.path;
      if (!relPath || !relPath.endsWith('.md')) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only .md files allowed' }));
        return;
      }
      const absPath = path.resolve(ROOT, relPath);
      if (!absPath.startsWith(ROOT)) {
        res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path outside project root' }));
        return;
      }
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(absPath, body.content, 'utf8');
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Global memory endpoint
  if (url.pathname === '/api/global-memory') {
    const claudeDir = path.join(os.homedir(), '.claude');
    const projectsDir = path.join(claudeDir, 'projects');

    // Read global CLAUDE.md
    let globalClaudeMd = null;
    const globalClaudeMdPath = path.join(claudeDir, 'CLAUDE.md');
    if (fs.existsSync(globalClaudeMdPath)) {
      globalClaudeMd = fs.readFileSync(globalClaudeMdPath, 'utf8');
    }

    // Scan all project memory directories and collect raw entries
    const rawEntries = [];
    if (fs.existsSync(projectsDir)) {
      for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const memDir = path.join(projectsDir, entry.name, 'memory');
        if (!fs.existsSync(memDir)) continue;

        const scan = scanDir(memDir, 'memory');
        const allFiles = [...scan.files];
        for (const [, dirFiles] of Object.entries(scan.dirs)) {
          allFiles.push(...dirFiles);
        }

        const files = [];
        for (const relPath of allFiles) {
          const absPath = path.join(projectsDir, entry.name, relPath);
          if (fs.existsSync(absPath)) {
            files.push({
              name: path.basename(relPath),
              path: relPath,
              projectDir: entry.name,
              content: fs.readFileSync(absPath, 'utf8')
            });
          }
        }
        if (files.length > 0) {
          rawEntries.push({ encodedName: entry.name, files });
        }
      }
    }

    // Group related projects (worktrees/bare clones) under the base project.
    // Sort by name length so base projects come first, then variants.
    rawEntries.sort((a, b) => a.encodedName.length - b.encodedName.length);
    const groups = new Map(); // baseEncoded -> { encodedName, files[] }
    for (const entry of rawEntries) {
      let baseKey = null;
      for (const key of groups.keys()) {
        // A variant's encoded name starts with the base name + '-' or '--'
        if (entry.encodedName.startsWith(key + '-')) {
          baseKey = key;
          break;
        }
      }
      if (baseKey) {
        // Merge files into existing group, skip duplicates by content
        const group = groups.get(baseKey);
        for (const file of entry.files) {
          const isDuplicate = group.files.some(f => f.name === file.name && f.content === file.content);
          if (!isDuplicate) group.files.push(file);
        }
      } else {
        groups.set(entry.encodedName, { encodedName: entry.encodedName, files: [...entry.files] });
      }
    }

    // Build final projects array
    const projects = [];
    for (const group of groups.values()) {
      const decodedPath = decodeProjectPath(group.encodedName);
      projects.push({
        encodedName: group.encodedName,
        decodedPath,
        displayName: getProjectDisplayName(decodedPath),
        files: group.files
      });
    }
    projects.sort((a, b) => a.displayName.localeCompare(b.displayName));

    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ globalClaudeMd, projects }));
    return;
  }

  // Global save endpoint
  if (req.method === 'POST' && url.pathname === '/api/global-save') {
    try {
      const claudeDir = path.join(os.homedir(), '.claude');
      const body = JSON.parse(await readBody(req));
      const relPath = body.path;
      if (!relPath || !relPath.endsWith('.md')) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only .md files allowed' }));
        return;
      }
      const absPath = path.resolve(claudeDir, relPath);
      if (!absPath.startsWith(claudeDir)) {
        res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Path outside .claude directory' }));
        return;
      }
      fs.writeFileSync(absPath, body.content, 'utf8');
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // Redirect root to dashboard
  if (url.pathname === '/') {
    res.writeHead(302, { ...corsHeaders, 'Location': '/dashboard/' });
    res.end();
    return;
  }

  // Static file serving
  let filePath = path.join(ROOT, decodeURIComponent(url.pathname));
  if (filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');

  // Prevent directory traversal
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const noCache = ['.html', '.js', '.css'].includes(ext);
    res.writeHead(200, { ...corsHeaders, 'Content-Type': mime, ...(noCache && { 'Cache-Control': 'no-store' }) });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}/dashboard/`);
});

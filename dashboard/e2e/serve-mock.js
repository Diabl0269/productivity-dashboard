#!/usr/bin/env node
// Isolated mock dashboard server for Playwright / local UI checks.
// Writes ONLY under dashboard/e2e/runtime/ — never touches repo-root tasks.json or memory/.
//
// Usage: node dashboard/e2e/serve-mock.js [port]
// Default port: 3010

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT || process.argv[2] || 3010);
const E2E_DIR = __dirname;
const FIXTURES = path.join(E2E_DIR, 'fixtures');
const RUNTIME = path.join(E2E_DIR, 'runtime');
const REAL_DASHBOARD = path.resolve(E2E_DIR, '..');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.md': 'text/markdown',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function rmrf(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function prepareRuntime() {
  rmrf(RUNTIME);
  fs.mkdirSync(RUNTIME, { recursive: true });
  copyFile(path.join(FIXTURES, 'tasks.json'), path.join(RUNTIME, 'tasks.json'));
  copyFile(path.join(FIXTURES, 'CLAUDE.md'), path.join(RUNTIME, 'CLAUDE.md'));
  copyFile(path.join(FIXTURES, 'config.json'), path.join(RUNTIME, 'config.json'));
  copyFile(
    path.join(FIXTURES, 'memory', 'glossary.md'),
    path.join(RUNTIME, 'memory', 'glossary.md')
  );

  const dashLink = path.join(RUNTIME, 'dashboard');
  try {
    fs.symlinkSync(REAL_DASHBOARD, dashLink, 'dir');
  } catch (err) {
    // Windows / restricted FS: fall back to copying is heavy; rethrow with hint
    throw new Error(`Failed to symlink dashboard into e2e runtime: ${err.message}`);
  }

  // Marker so we can prove we're on the mock root
  fs.writeFileSync(
    path.join(RUNTIME, '.e2e-mock'),
    `mock-root prepared ${new Date().toISOString()}\nrealDashboard=${REAL_DASHBOARD}\n`,
    'utf8'
  );
}

function scanDir(dir, base = '') {
  const result = { files: [], dirs: {} };
  if (!fs.existsSync(dir)) return result;
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
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

function assertInsideRuntime(absPath) {
  const resolved = path.resolve(absPath);
  if (!resolved.startsWith(RUNTIME + path.sep) && resolved !== RUNTIME) {
    throw new Error('Path outside e2e runtime');
  }
  return resolved;
}

prepareRuntime();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'X-E2E-Mock': '1',
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders);
    res.end();
    return;
  }

  // Health / proof this is the mock server
  if (url.pathname === '/api/e2e-info') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      mock: true,
      runtime: RUNTIME,
      realTasksUntouched: true,
      port: PORT,
    }));
    return;
  }

  if (url.pathname === '/api/memory-manifest') {
    const memoryDir = path.join(RUNTIME, 'memory');
    const claudeMdExists = fs.existsSync(path.join(RUNTIME, 'CLAUDE.md'));
    const scan = fs.existsSync(memoryDir) ? scanDir(memoryDir, 'memory') : { files: [], dirs: {} };
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      claudeMd: claudeMdExists ? 'CLAUDE.md' : null,
      files: scan.files,
      dirs: scan.dirs,
    }));
    return;
  }

  // Never touch ~/.claude — return empty global memory in e2e
  if (url.pathname === '/api/global-memory') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      globalClaudeMd: '# E2E stub\n\nNo personal global memory loaded.\n',
      projects: [],
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/global-save') {
    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, stubbed: true }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/save') {
    try {
      const body = JSON.parse(await readBody(req));
      const relPath = body.path;
      if (!relPath || (!relPath.endsWith('.md') && !relPath.endsWith('.json'))) {
        res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only .md and .json files allowed' }));
        return;
      }
      // Normalize and keep writes inside runtime only
      const absPath = assertInsideRuntime(path.resolve(RUNTIME, relPath));

      // Block writes through the dashboard symlink folder only (not e2e paths that
      // happen to live under the real repo's dashboard/ directory).
      const dashLink = path.join(RUNTIME, 'dashboard');
      if (absPath === dashLink || absPath.startsWith(dashLink + path.sep)) {
        res.writeHead(403, { ...corsHeaders, 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Refusing to write into real dashboard symlink' }));
        return;
      }

      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (body.baseContent !== undefined && fs.existsSync(absPath)) {
        const current = fs.readFileSync(absPath, 'utf8');
        if (current !== body.baseContent) {
          res.writeHead(409, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'conflict', current }));
          return;
        }
      }
      fs.writeFileSync(absPath, body.content, 'utf8');
      res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mock: true }));
    } catch (e) {
      res.writeHead(500, { ...corsHeaders, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  if (url.pathname === '/') {
    res.writeHead(302, { ...corsHeaders, Location: '/dashboard/' });
    res.end();
    return;
  }

  let filePath = path.join(RUNTIME, decodeURIComponent(url.pathname));
  if (filePath.endsWith('/')) filePath = path.join(filePath, 'index.html');

  if (!filePath.startsWith(RUNTIME)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      const ext = path.extname(url.pathname);
      const isAssetRequest = ext && ext !== '.html';
      if (!isAssetRequest && url.pathname.startsWith('/dashboard/')) {
        const spaIndex = path.join(RUNTIME, 'dashboard', 'index.html');
        if (fs.existsSync(spaIndex)) {
          res.writeHead(200, {
            ...corsHeaders,
            'Content-Type': 'text/html',
            'Cache-Control': 'no-store',
          });
          fs.createReadStream(spaIndex).pipe(res);
          return;
        }
      }
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    const mime = MIME_TYPES[ext] || 'application/octet-stream';
    const noCache = ['.html', '.js', '.css'].includes(ext);
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': mime,
      ...(noCache && { 'Cache-Control': 'no-store' }),
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, () => {
  console.log(`[e2e-mock] Dashboard: http://localhost:${PORT}/dashboard/`);
  console.log(`[e2e-mock] Runtime (writable): ${RUNTIME}`);
  console.log(`[e2e-mock] Personal repo data is NOT used.`);
});

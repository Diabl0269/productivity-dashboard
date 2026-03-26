// memory-parser.js - Pure parsing/utility functions

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text || '';
  return div.innerHTML;
}

function parseMemoryMarkdown(content) {
  const parsed = {
    title: '',
    fields: {},
    sections: {},
    tables: [],
    rawContent: content
  };

  const lines = content.split('\n');
  let currentSection = '_intro';
  parsed.sections[currentSection] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.match(/^# /)) {
      parsed.title = line.replace(/^# /, '').trim();
      continue;
    }

    if (line.match(/^## /)) {
      currentSection = line.replace(/^## /, '').trim();
      parsed.sections[currentSection] = [];
      continue;
    }

    const kvMatch = line.match(/^\*\*(.+?):\*\*\s*(.*)$/);
    if (kvMatch) {
      parsed.fields[kvMatch[1]] = kvMatch[2];
      continue;
    }

    parsed.sections[currentSection].push(line);
  }

  for (const key in parsed.sections) {
    parsed.sections[key] = parsed.sections[key].join('\n').trim();
  }

  const tableRegex = /\|(.+)\|\n\|[-| ]+\|\n((?:\|.+\|\n?)+)/g;
  let match;
  while ((match = tableRegex.exec(content)) !== null) {
    const headers = match[1].split('|').map(h => h.trim()).filter(h => h);
    const rowLines = match[2].trim().split('\n');
    const rows = rowLines.map(row => row.split('|').map(c => c.trim()).filter(c => c));
    parsed.tables.push({ headers, rows });
  }

  return parsed;
}

function getPreview(content, maxLength = 150) {
  let preview = content
    .replace(/^#+ .+$/gm, '')
    .replace(/\*\*(.+?):\*\*.*/g, '')
    .replace(/\|.+\|/g, '')
    .replace(/[-=]{3,}/g, '')
    .trim()
    .substring(0, maxLength);
  if (content.length > maxLength) preview += '...';
  return preview;
}

function getDisplayName(filename) {
  return filename
    .replace('.md', '')
    .split(/[-_]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function renderMarkdownToHtml(md) {
  let html = escapeHtml(md);

  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/```[\s\S]*?```/g, match => {
    const code = match.replace(/```\w*\n?/g, '');
    return '<pre><code>' + code + '</code></pre>';
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/(\|.+\|\n\|[-| ]+\|\n(?:\|.+\|\n?)+)/g, match => {
    const lines = match.trim().split('\n');
    const headers = lines[0].split('|').filter(c => c.trim());
    const rows = lines.slice(2).map(row => row.split('|').filter(c => c.trim()));
    let table = '<table><thead><tr>';
    headers.forEach(h => table += `<th>${h.trim()}</th>`);
    table += '</tr></thead><tbody>';
    rows.forEach(row => {
      table += '<tr>';
      row.forEach(cell => table += `<td>${cell.trim()}</td>`);
      table += '</tr>';
    });
    table += '</tbody></table>';
    return table;
  });
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
  html = html.replace(/^(?!<[hupol]|<li|<table|<pre)(.+)$/gm, '<p>$1</p>');
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: content };
  const fm = {};
  match[1].split('\n').forEach(line => {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^["']|["']$/g, '').trim();
  });
  return { frontmatter: fm, body: match[2] };
}

export { escapeHtml, parseMemoryMarkdown, getPreview, getDisplayName, renderMarkdownToHtml, parseFrontmatter };

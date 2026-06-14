/**
 * cli/commands/mem.js
 *
 * ch mem <subcommand> [args...]
 *
 * Subcommands:
 *   person <slug> [--field a,b,c] [--json]
 *   person list [--has-field X]
 *   person exists <slug>
 *   person create <slug> --name "..." [--role --slack-id --email --github --atlassian-id --canvas-url] [--force]
 *   person update <slug> --field key=value | --append-section "Name" "line"
 *   whois "<name>"
 *   project <slug> [--field a,b,c] [--section "Name"] [--json]
 *   project update <slug> --field key=value | --append-section "Name" "line"
 *   glossary lookup <term>
 *   glossary add "<term>" "<def>" [--table "Section Name"]
 *   index [--json]
 *   self [--field X]
 */

import { parse } from '../lib/args.js';
import { memoryPath, readText, exists, listMd, atomicWrite, readConfig } from '../lib/io.js';
import { print, printErr, jsonOut, ok, die } from '../lib/output.js';
import { extractFields, writeField, getSlugName } from '../lib/field-extractor.js';
import { parseMemoryMarkdown, parseFrontmatter } from '../../dashboard/js/memory-parser.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function peopleDir() { return memoryPath('people'); }
function projectsDir() { return memoryPath('projects'); }
function glossaryFile() { return memoryPath('glossary.md'); }
function contextDir() { return memoryPath('context'); }

function readPerson(slug) {
  const p = memoryPath('people', `${slug}.md`);
  if (!exists(p)) die(`person not found: ${slug}\n  try: ch mem person list`, 1);
  return readText(p);
}

function readProject(slug) {
  const p = memoryPath('projects', `${slug}.md`);
  if (!exists(p)) die(`project not found: ${slug}\n  try: ch mem project list`, 1);
  return readText(p);
}

// Print selected fields or all fields
function printFields(slug, name, fields, fieldList, asJson) {
  if (asJson) {
    if (fieldList) {
      const subset = {};
      for (const k of fieldList) subset[k] = fields[k] ?? null;
      jsonOut({ slug, name, fields: subset });
    } else {
      jsonOut({ slug, name, fields });
    }
    return;
  }
  if (fieldList) {
    if (fieldList.length === 1) {
      print(fields[fieldList[0]] ?? '');
    } else {
      for (const k of fieldList) {
        print(`${k}=${fields[k] ?? ''}`);
      }
    }
  } else {
    print(`${slug}  ${name}`);
    for (const [k, v] of Object.entries(fields)) {
      print(`  ${k}=${v}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Glossary helpers
// ---------------------------------------------------------------------------

/**
 * Parse all tables in glossary content into [{sectionName, headers, rows}].
 * rows: array of string arrays (one per column).
 */
function parseGlossaryTables(content) {
  const tables = [];
  const lines = content.split('\n');
  let currentSection = '(root)';
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^##?\s+/.test(line)) {
      currentSection = line.replace(/^##?\s+/, '').trim();
      i++;
      continue;
    }
    // Detect table header
    if (/^\|.+\|/.test(line) && i + 1 < lines.length && /^\|[-| ]+\|/.test(lines[i + 1])) {
      const headers = line.split('|').map(h => h.trim()).filter(h => h);
      i += 2; // skip header + separator
      const rows = [];
      while (i < lines.length && /^\|.+\|/.test(lines[i])) {
        const cells = lines[i].split('|').map(c => c.trim()).filter(c => c !== undefined && lines[i].includes('|'));
        // Filter out empty strings from leading/trailing pipes
        const row = lines[i].split('|').slice(1, -1).map(c => c.trim());
        rows.push(row);
        i++;
      }
      tables.push({ sectionName: currentSection, headers, rows, lineStart: i - rows.length - 2 });
      continue;
    }
    i++;
  }
  return tables;
}

/**
 * Lookup a term in the glossary. Returns first matching row or null.
 */
function glossaryLookup(content, term) {
  const lterm = term.toLowerCase().trim();
  const tables = parseGlossaryTables(content);
  for (const table of tables) {
    for (const row of table.rows) {
      if (row[0] && row[0].toLowerCase().trim() === lterm) {
        return { term: row[0], definition: row[1] || row.slice(1).join(' | '), sectionName: table.sectionName, fullRow: row };
      }
    }
  }
  return null;
}

/**
 * Append a row to a glossary table (matched by section name, or first table if no match).
 * Returns updated content.
 */
function glossaryAppendRow(content, term, definition, tableSectionName) {
  const lines = content.split('\n');
  // Find last row of target table
  const tables = parseGlossaryTables(content);

  let targetTable = null;
  if (tableSectionName) {
    targetTable = tables.find(t => t.sectionName.toLowerCase() === tableSectionName.toLowerCase());
  }
  if (!targetTable) targetTable = tables[0];
  if (!targetTable) {
    // No table found, append a new one
    return content.trimEnd() + `\n\n| Term | Meaning |\n|------|---------||\n| ${term} | ${definition} |\n`;
  }

  // Find where this table ends in the lines array (after all its rows)
  // We need to re-scan since parseGlossaryTables doesn't track end positions perfectly
  let scanSection = null;
  let tableHeaderLine = -1;
  let tableEndLine = -1;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (/^##?\s+/.test(line)) {
      scanSection = line.replace(/^##?\s+/, '').trim();
      i++;
      continue;
    }
    const matchSection = tableSectionName
      ? (scanSection && scanSection.toLowerCase() === tableSectionName.toLowerCase())
      : true;

    if (matchSection && tableHeaderLine === -1 && /^\|.+\|/.test(line) && i + 1 < lines.length && /^\|[-| ]+\|/.test(lines[i + 1])) {
      tableHeaderLine = i;
      i += 2;
      while (i < lines.length && /^\|.+\|/.test(lines[i])) {
        tableEndLine = i;
        i++;
      }
      break;
    }
    i++;
  }

  if (tableEndLine === -1 && tableHeaderLine !== -1) {
    // Table found but empty — end is the separator line
    tableEndLine = tableHeaderLine + 1;
  }

  if (tableEndLine === -1) {
    return content.trimEnd() + `\n| ${term} | ${definition} |\n`;
  }

  const newRow = `| ${term} | ${definition} |`;
  const updated = lines.slice();
  updated.splice(tableEndLine + 1, 0, newRow);
  return updated.join('\n');
}

// ---------------------------------------------------------------------------
// Fuzzy whois scoring
// ---------------------------------------------------------------------------

// Nickname spelling-equivalences for fuzzy whois matching, e.g. [["jon","jonathan"]].
// Loaded from config.json ("nicknameAliases") so no real names live in committed source;
// config.example.json ships a fictional placeholder. Memoized per process.
let _nicknameAliases;
function nicknameAliases() {
  if (_nicknameAliases === undefined) {
    const a = readConfig().nicknameAliases;
    _nicknameAliases = Array.isArray(a) ? a : [];
  }
  return _nicknameAliases;
}

/**
 * Score how well query matches a person file's slug, name, email, and body text.
 * Higher = better match.
 */
function scoreWhois(query, slug, content) {
  const q = query.toLowerCase().trim();
  const slugLc = slug.toLowerCase();
  const { fields, name } = extractFields(content);
  const nameLc = name.toLowerCase();
  const emailPrefix = (fields.email || '').split('@')[0].toLowerCase();

  let score = 0;

  // Exact slug match
  if (slugLc === q) score += 100;
  // Slug contains query
  else if (slugLc.includes(q)) score += 50;

  // Exact name match
  if (nameLc === q) score += 100;
  // Name contains query
  else if (nameLc.includes(q)) score += 60;
  // Name word match (prefix overlap between the query and any name part, e.g. "jon" ~ "jonathan")
  else {
    const nameParts = nameLc.split(/\s+/);
    for (const part of nameParts) {
      if (part.startsWith(q) || q.startsWith(part)) score += 30;
    }
  }

  // Email prefix match
  if (emailPrefix === q) score += 80;
  else if (emailPrefix.startsWith(q) || emailPrefix.includes(q)) score += 40;

  // Body text contains query (nickname handling)
  const bodyLc = content.toLowerCase();
  if (bodyLc.includes(q)) score += 20;

  // Nickname spelling-equivalences (from config; e.g. "jon" <-> "jonathan")
  for (const [a, b] of nicknameAliases()) {
    if ((q === a && (slugLc.includes(b) || nameLc.includes(b) || bodyLc.includes(b))) ||
        (q === b && (slugLc.includes(a) || nameLc.includes(a) || bodyLc.includes(a)))) {
      score += 70;
    }
  }

  return score;
}

// ---------------------------------------------------------------------------
// Subcommand: person
// ---------------------------------------------------------------------------

async function cmdPerson(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === '--help') {
    print('usage: ch mem person <slug|list|exists|create|update> [opts]');
    return;
  }

  if (sub === 'list') {
    const { values } = parse(rest, {
      'has-field': { type: 'string' },
    });
    const files = listMd(peopleDir());
    const results = [];
    for (const file of files) {
      const slug = file.replace(/\.md$/, '');
      if (values['has-field']) {
        const content = readText(memoryPath('people', file));
        const { fields } = extractFields(content);
        if (!(values['has-field'] in fields)) continue;
      }
      results.push(slug);
    }
    for (const s of results) print(s);
    return;
  }

  if (sub === 'exists') {
    const slug = rest[0];
    if (!slug) die('usage: ch mem person exists <slug>');
    process.exit(exists(memoryPath('people', `${slug}.md`)) ? 0 : 1);
  }

  if (sub === 'create') {
    const slug = rest[0];
    if (!slug) die('usage: ch mem person create <slug> --name "..."');
    const { values } = parse(rest.slice(1), {
      name: { type: 'string' },
      role: { type: 'string' },
      'slack-id': { type: 'string' },
      email: { type: 'string' },
      github: { type: 'string' },
      'atlassian-id': { type: 'string' },
      'canvas-url': { type: 'string' },
      force: { type: 'boolean' },
    });
    if (!values.name) die('--name is required for person create');
    const filePath = memoryPath('people', `${slug}.md`);
    if (exists(filePath) && !values.force) {
      die(`person already exists: ${slug}  (use --force to overwrite)`);
    }
    const lines = [`# ${values.name}`, ''];
    if (values.role) lines.push(`**Role:** ${values.role}`, '');
    lines.push('**Contact:**');
    if (values['slack-id']) lines.push(`- Slack ID: ${values['slack-id']}`);
    if (values.email) lines.push(`- Email: ${values.email}`);
    if (values.github) lines.push(`- GitHub: ${values.github}`);
    if (values['atlassian-id']) lines.push(`- Atlassian ID: ${values['atlassian-id']}`);
    if (values['canvas-url']) lines.push(`- 1:1 Canvas: ${values['canvas-url']}`);
    lines.push('');
    atomicWrite(filePath, lines.join('\n'));
    ok(`created: ${slug}`);
    return;
  }

  if (sub === 'update') {
    const slug = rest[0];
    if (!slug) die('usage: ch mem person update <slug> --field key=value');
    const { values } = parse(rest.slice(1), {
      field: { type: 'string' },
      'append-section': { type: 'string', multiple: true },
    });
    const filePath = memoryPath('people', `${slug}.md`);
    if (!exists(filePath)) die(`person not found: ${slug}`, 1);
    let content = readText(filePath);

    if (values.field) {
      const eqIdx = values.field.indexOf('=');
      if (eqIdx === -1) die('--field requires key=value format');
      const key = values.field.slice(0, eqIdx).trim();
      const val = values.field.slice(eqIdx + 1).trim();
      const updated = writeField(content, key, val);
      if (updated === null) {
        die(`unsupported format for field '${key}' — edit manually: ${filePath}`, 2);
      }
      atomicWrite(filePath, updated);
      ok(`updated ${slug}: ${key}=${val}`);
    } else if (values['append-section'] && values['append-section'].length >= 2) {
      const sectionName = values['append-section'][0];
      const line = values['append-section'][1];
      const lines = content.split('\n');
      let sectionIdx = lines.findIndex(l => l.trim() === `## ${sectionName}`);
      if (sectionIdx === -1) {
        // Append new section at end
        content = content.trimEnd() + `\n\n## ${sectionName}\n- ${line}\n`;
      } else {
        // Find end of section
        let endIdx = sectionIdx + 1;
        while (endIdx < lines.length && !/^##\s/.test(lines[endIdx])) endIdx++;
        lines.splice(endIdx, 0, `- ${line}`);
        content = lines.join('\n');
      }
      atomicWrite(filePath, content);
      ok(`appended to ${slug} section '${sectionName}'`);
    } else {
      die('usage: ch mem person update <slug> --field key=value OR --append-section "Name" "line"');
    }
    return;
  }

  // Default: person <slug> [--field a,b,c] [--json]
  const slug = sub;
  const { values } = parse(rest, {
    field: { type: 'string' },
    json: { type: 'boolean', short: 'j' },
  });

  const content = readPerson(slug);
  const { fields, name } = extractFields(content);
  const fieldList = values.field ? values.field.split(',').map(s => s.trim()).filter(Boolean) : null;
  printFields(slug, name, fields, fieldList, values.json);
}

// ---------------------------------------------------------------------------
// Subcommand: whois
// ---------------------------------------------------------------------------

async function cmdWhois(argv) {
  const query = argv[0];
  if (!query) die('usage: ch mem whois "<name>"');

  const files = listMd(peopleDir());
  let best = null;
  let bestScore = 0;

  for (const file of files) {
    const slug = file.replace(/\.md$/, '');
    const content = readText(memoryPath('people', file));
    const score = scoreWhois(query, slug, content);
    if (score > bestScore) {
      bestScore = score;
      best = { slug, content };
    }
  }

  if (!best || bestScore === 0) {
    printErr(`no match: ${query}`);
    process.exit(1);
  }

  const { fields, name } = extractFields(best.content);
  const parts = [best.slug, name];
  if (fields.slack_id) parts.push(`slack_id=${fields.slack_id}`);
  if (fields.atlassian_id) parts.push(`atlassian_id=${fields.atlassian_id}`);
  if (fields.github) parts.push(`github=${fields.github}`);
  print(parts.join('  '));
}

// ---------------------------------------------------------------------------
// Subcommand: project
// ---------------------------------------------------------------------------

async function cmdProject(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === '--help') {
    print('usage: ch mem project <slug|list|update> [opts]');
    return;
  }

  if (sub === 'list') {
    const files = listMd(projectsDir());
    for (const f of files) print(f.replace(/\.md$/, ''));
    return;
  }

  if (sub === 'update') {
    const slug = rest[0];
    if (!slug) die('usage: ch mem project update <slug> --field key=value');
    const { values } = parse(rest.slice(1), {
      field: { type: 'string' },
      'append-section': { type: 'string', multiple: true },
    });
    const filePath = memoryPath('projects', `${slug}.md`);
    if (!exists(filePath)) die(`project not found: ${slug}`, 1);
    let content = readText(filePath);

    if (values.field) {
      const eqIdx = values.field.indexOf('=');
      if (eqIdx === -1) die('--field requires key=value format');
      const key = values.field.slice(0, eqIdx).trim();
      const val = values.field.slice(eqIdx + 1).trim();
      const updated = writeField(content, key, val);
      if (updated === null) {
        die(`unsupported format for field '${key}' — edit manually: ${filePath}`, 2);
      }
      atomicWrite(filePath, updated);
      ok(`updated ${slug}: ${key}=${val}`);
    } else if (values['append-section'] && values['append-section'].length >= 2) {
      const sectionName = values['append-section'][0];
      const line = values['append-section'][1];
      const lines = content.split('\n');
      let endIdx = lines.findIndex(l => l.trim() === `## ${sectionName}`);
      if (endIdx === -1) {
        content = content.trimEnd() + `\n\n## ${sectionName}\n${line}\n`;
      } else {
        let insertAt = endIdx + 1;
        while (insertAt < lines.length && !/^##\s/.test(lines[insertAt])) insertAt++;
        lines.splice(insertAt, 0, line);
        content = lines.join('\n');
      }
      atomicWrite(filePath, content);
      ok(`appended to ${slug} section '${sectionName}'`);
    } else {
      die('usage: ch mem project update <slug> --field key=value OR --append-section "Name" "line"');
    }
    return;
  }

  // Default: project <slug> [--field a,b,c] [--section "Name"] [--json]
  const slug = sub;
  const { values } = parse(rest, {
    field: { type: 'string' },
    section: { type: 'string' },
    json: { type: 'boolean', short: 'j' },
  });

  const content = readProject(slug);

  if (values.section) {
    const parsed = parseMemoryMarkdown(content);
    const sectionContent = parsed.sections[values.section];
    if (sectionContent === undefined) {
      const available = Object.keys(parsed.sections).filter(k => k !== '_intro').join(', ');
      die(`section '${values.section}' not found. available: ${available}`, 1);
    }
    if (values.json) {
      jsonOut({ slug, section: values.section, content: sectionContent });
    } else {
      print(sectionContent);
    }
    return;
  }

  const { fields, name } = extractFields(content);
  const fieldList = values.field ? values.field.split(',').map(s => s.trim()).filter(Boolean) : null;
  printFields(slug, name, fields, fieldList, values.json);
}

// ---------------------------------------------------------------------------
// Subcommand: glossary
// ---------------------------------------------------------------------------

async function cmdGlossary(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (sub === 'lookup') {
    const term = rest[0];
    if (!term) die('usage: ch mem glossary lookup <term>');
    const filePath = glossaryFile();
    if (!exists(filePath)) die('glossary.md not found', 2);
    const content = readText(filePath);
    const match = glossaryLookup(content, term);
    if (!match) {
      printErr(`not found: ${term}`);
      process.exit(1);
    }
    print(`${match.term} -> ${match.definition}`);
    return;
  }

  if (sub === 'add') {
    const term = rest[0];
    const def = rest[1];
    if (!term || !def) die('usage: ch mem glossary add "<term>" "<def>" [--table "Section"]');
    const { values } = parse(rest.slice(2), {
      table: { type: 'string' },
    });
    const filePath = glossaryFile();
    if (!exists(filePath)) die('glossary.md not found', 2);
    const content = readText(filePath);

    // Check if term already exists
    if (glossaryLookup(content, term)) {
      die(`term already exists: ${term}`, 1);
    }

    const updated = glossaryAppendRow(content, term, def, values.table || null);
    atomicWrite(filePath, updated);
    ok(`added: ${term} -> ${def}`);
    return;
  }

  die('usage: ch mem glossary <lookup|add> [args...]');
}

// ---------------------------------------------------------------------------
// Subcommand: index
// ---------------------------------------------------------------------------

async function cmdIndex(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j' },
  });

  const people = listMd(peopleDir()).map(f => f.replace(/\.md$/, ''));
  const projects = listMd(projectsDir()).map(f => f.replace(/\.md$/, ''));

  // Glossary terms: parse all tables
  const glossaryPath = glossaryFile();
  let glossaryTerms = [];
  if (exists(glossaryPath)) {
    const content = readText(glossaryPath);
    const tables = parseGlossaryTables(content);
    for (const table of tables) {
      for (const row of table.rows) {
        if (row[0]) glossaryTerms.push(row[0]);
      }
    }
  }

  if (values.json) {
    jsonOut({
      people: { count: people.length, slugs: people },
      projects: { count: projects.length, slugs: projects },
      glossary: { count: glossaryTerms.length, terms: glossaryTerms },
    });
  } else {
    print(`people: ${people.length}`);
    print(`projects: ${projects.length}`);
    print(`glossary: ${glossaryTerms.length} terms`);
  }
}

// ---------------------------------------------------------------------------
// Subcommand: self
// ---------------------------------------------------------------------------

async function cmdSelf(argv) {
  const { values } = parse(argv, {
    field: { type: 'string' },
    json: { type: 'boolean', short: 'j' },
  });

  const companyFile = memoryPath('context', 'company.md');
  if (!exists(companyFile)) die('memory/context/company.md not found', 2);
  const content = readText(companyFile);

  // Extract Tal's fields from "Tal's Slack Profile" section
  const parsed = parseMemoryMarkdown(content);
  const fields = {};

  // Parse the "Tal's Slack Profile" section or similar
  // Section lines may use "- Label: value" (plain) or "- **Label:** value" (bold)
  const profileSectionKey = Object.keys(parsed.sections).find(
    k => k.toLowerCase().includes("slack profile") || k.toLowerCase().includes("tal's slack")
  );
  const profileSection = profileSectionKey ? parsed.sections[profileSectionKey] : null;
  if (profileSection) {
    for (const line of profileSection.split('\n')) {
      // "- **Label:** value" (bold)
      const boldM = line.match(/^-\s+\*\*(.+?):\*\*\s*(.+)$/);
      if (boldM) {
        const canon = boldM[1].replace(/\s+/g, '_').toLowerCase();
        fields[canon] = boldM[2].trim();
        continue;
      }
      // "- Label: value" (plain)
      const plainM = line.match(/^-\s+(.+?):\s+(.+)$/);
      if (plainM) {
        const canon = plainM[1].replace(/\s+/g, '_').toLowerCase();
        fields[canon] = plainM[2].trim();
      }
    }
  }

  // Also parse top-level fields
  const { fields: topFields } = extractFields(content);
  Object.assign(fields, topFields);

  // Canonical renames for well-known fields
  if (fields.username && !fields.slack_username) fields.slack_username = fields.username;
  if (fields.user_id && !fields.slack_id) fields.slack_id = fields.user_id;

  if (values.field) {
    const key = values.field;
    if (values.json) {
      jsonOut({ field: key, value: fields[key] ?? null });
    } else {
      print(fields[key] ?? '');
    }
    return;
  }

  if (values.json) {
    jsonOut({ slug: 'self', fields });
    return;
  }

  for (const [k, v] of Object.entries(fields)) {
    print(`${k}=${v}`);
  }
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

export default async function mem(argv) {
  const sub = argv[0];
  const rest = argv.slice(1);

  if (!sub || sub === '--help' || sub === 'help') {
    print(`ch mem <subcommand> [args...]

Subcommands:
  person <slug> [--field a,b,c] [--json]
  person list [--has-field X]
  person exists <slug>
  person create <slug> --name "..." [--role --slack-id --email --github ...]
  person update <slug> --field key=value
  whois "<name>"
  project <slug> [--field a,b,c] [--section "Name"] [--json]
  project list
  project update <slug> --field key=value
  glossary lookup <term>
  glossary add "<term>" "<def>" [--table "Section Name"]
  index [--json]
  self [--field X]`);
    return;
  }

  switch (sub) {
    case 'person':   return cmdPerson(rest);
    case 'whois':    return cmdWhois(rest);
    case 'project':  return cmdProject(rest);
    case 'glossary': return cmdGlossary(rest);
    case 'index':    return cmdIndex(rest);
    case 'self':     return cmdSelf(rest);
    default:
      die(`unknown mem subcommand: ${sub}`);
  }
}

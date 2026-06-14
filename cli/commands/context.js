/**
 * cli/commands/context.js
 * Assemble a compact session digest for Claude context loading.
 *
 * Usage: ch context [--json]
 *
 * Output (terse): sectioned text with active tasks, team IDs, glossary, people index, next-id.
 * Output (--json): one compact JSON object.
 */

import { parse } from '../lib/args.js';
import { print, jsonOut, die } from '../lib/output.js';
import { memoryPath, readText, listMd, exists, readConfig } from '../lib/io.js';
import { load, flatTasks, nextId } from '../lib/tasks-store.js';
import { extractFields } from '../lib/field-extractor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse all markdown tables in a text into { term -> def } records.
 * Handles tables with 2+ columns; first col = term, second col = def.
 * Skips header and separator rows.
 */
function parseGlossaryTables(text) {
  const glossary = {};
  const lines = text.split('\n');
  let inTable = false;
  let headerParsed = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('|')) {
      inTable = false;
      headerParsed = false;
      continue;
    }

    // It's a table line
    const cells = trimmed.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 2) continue;

    // Separator row (all dashes)
    if (cells.every(c => /^[-:]+$/.test(c))) {
      headerParsed = true;
      inTable = true;
      continue;
    }

    if (!inTable) {
      // First row is header — just mark we've seen it
      inTable = true;
      headerParsed = false;
      continue;
    }

    if (!headerParsed) continue;

    // Data row
    const term = cells[0];
    const def = cells[1];
    if (term && def) {
      glossary[term] = def;
    }
  }

  return glossary;
}

/**
 * Load team member data for the squad named in config.json ("team": [slug,...]).
 * Returns array of {slug, name, slack_id, atlassian_id, github, canvas_id}.
 * Skips slugs whose files are missing. Empty if config has no team list.
 */
function loadTeam() {
  const teamSlugs = readConfig().team || [];
  return teamSlugs.map(slug => {
    const filePath = memoryPath('people', `${slug}.md`);
    if (!exists(filePath)) return null;
    let text;
    try {
      text = readText(filePath);
    } catch {
      return null;
    }
    const { fields, name } = extractFields(text);
    return {
      slug,
      name: name || slug,
      slack_id: fields.slack_id || null,
      atlassian_id: fields.atlassian_id || null,
      github: fields.github || null,
      canvas_id: fields.canvas_id || null,
    };
  }).filter(Boolean);
}

/**
 * Load and parse glossary.md into term->def map.
 */
function loadGlossary() {
  const filePath = memoryPath('glossary.md');
  if (!exists(filePath)) return {};
  let text;
  try {
    text = readText(filePath);
  } catch {
    return {};
  }
  return parseGlossaryTables(text);
}

/**
 * List all people slugs (filename without .md) from memory/people/.
 */
function loadPeopleSlugs() {
  const dir = memoryPath('people');
  return listMd(dir).map(f => f.replace(/\.md$/, ''));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function context(argv) {
  const { values } = parse(argv, {
    json: { type: 'boolean', short: 'j', default: false },
  });

  // Load tasks
  let doc;
  try {
    doc = load();
  } catch (e) {
    die(`context: failed to load tasks — ${e.message}`, 2);
  }

  const activeTasks = flatTasks(doc, { active: true }).map(t => ({
    id: t.id,
    section: t.section,
    title: t.title,
    priority: t.priority,
    subtasks: t.subtasks && t.subtasks.length > 0
      ? { done: t.subtasks.filter(s => s.checked).length, total: t.subtasks.length }
      : null,
  }));

  const next_id = nextId(doc);
  const team = loadTeam();
  const glossary = loadGlossary();
  const peopleSlugs = loadPeopleSlugs();

  if (values.json) {
    jsonOut({
      active_tasks: activeTasks,
      next_id,
      team,
      glossary,
      people: peopleSlugs,
    });
    return;
  }

  // Terse text output
  const lines = [];

  // Active tasks
  lines.push(`=== Active Tasks (${activeTasks.length}) ===`);
  for (const t of activeTasks) {
    const sub = t.subtasks ? ` (${t.subtasks.done}/${t.subtasks.total})` : '';
    lines.push(`  ${t.id} [${t.section}] [${t.priority}] ${t.title}${sub}`);
  }
  lines.push(`  next-id: ${next_id}`);

  // Team
  lines.push('=== Team (Prodigy) ===');
  for (const m of team) {
    const parts = [`  ${m.name}`];
    if (m.slack_id) parts.push(`slack:${m.slack_id}`);
    if (m.github) parts.push(`gh:${m.github}`);
    if (m.atlassian_id) parts.push(`atlassian:${m.atlassian_id}`);
    lines.push(parts.join(' '));
  }

  // Glossary
  const glossaryEntries = Object.entries(glossary);
  lines.push(`=== Glossary (${glossaryEntries.length} terms) ===`);
  for (const [term, def] of glossaryEntries) {
    lines.push(`  ${term}: ${def}`);
  }

  // People index
  lines.push(`=== People Index (${peopleSlugs.length}) ===`);
  lines.push(`  ${peopleSlugs.join(', ')}`);

  print(lines.join('\n'));
}

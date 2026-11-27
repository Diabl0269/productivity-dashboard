/**
 * PRO136: names that exist only in the app's test-mode fixtures (a "Test Tone" sound, a "Tiny Kit"
 * drum kit) are not in anyone's app, so a check naming one sends Tal looking for something he cannot
 * find (FRO2023). The list is derived, never typed: every instrument name in
 * `agentsynth/Tools/ui-verify/fixtures/**` `pack.json` that appears nowhere in the app's own
 * `Source/` or `assets/` text. A new fixture name is covered without editing this file.
 */
import fs from 'node:fs';
import path from 'node:path';

const FIXTURES = path.join('agentsynth', 'Tools', 'ui-verify', 'fixtures');
const APP_DIRS = [path.join('agentsynth', 'Source'), path.join('agentsynth', 'assets')];
const TEXT_EXT = /\.(?:cpp|h|mm|json|md|sfz|txt|cmake)$/i;
const MIN_LEN = 4;

function walk(dir, visit) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '.git') walk(p, visit); } else visit(p, e.name);
  }
}

/** Instrument names declared by fixture packs under `root` (the suite checkout). */
export function fixtureNames(root) {
  const names = new Set();
  walk(path.join(root, FIXTURES), (file, base) => {
    if (base !== 'pack.json') return;
    try {
      const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const i of pack.instruments || []) if (typeof i?.name === 'string' && i.name.trim().length >= MIN_LEN) names.add(i.name.trim());
    } catch { /* an unreadable fixture adds no name */ }
  });
  return [...names];
}

function appMentions(root, name) {
  const needle = name.toLowerCase();
  let found = false;
  for (const d of APP_DIRS) {
    walk(path.join(root, d), (file, base) => {
      if (found || !TEXT_EXT.test(base)) return;
      try { if (fs.readFileSync(file, 'utf8').toLowerCase().includes(needle)) found = true; } catch { /* skip */ }
    });
    if (found) return true;
  }
  return found;
}

/** Harness-only names (fixture names the shipped app never mentions) found in `text`, per suite root. */
export function harnessNamesIn(text, roots) {
  const t = String(text ?? '').toLowerCase();
  const out = new Set();
  for (const root of roots || []) {
    for (const name of fixtureNames(root)) {
      if (t.includes(name.toLowerCase()) && !appMentions(root, name)) out.add(name);
    }
  }
  return [...out];
}

/** Reason a check is refused, or null. A check handed with its --project may name the project's own sounds. */
export function harnessNameProblem(check, roots) {
  if (check?.project) return null;
  const hit = harnessNamesIn(check?.text, roots);
  if (!hit.length) return null;
  return `names ${hit.map(n => `"${n}"`).join(', ')}, which exists only in the test harness fixtures, not in the app: name a shipped sound, or hand the project with --check-project`;
}

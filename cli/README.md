# ch — Productivity CLI

A zero-dependency Node.js CLI for managing tasks and memory files in your productivity dashboard.

## Install

```sh
cd cli
npm link
```

After linking, `ch` is available globally. Alternatively, run `./ch` from the repo root without linking.

## Command Groups

### `ch tasks` — task management

| Command | Description |
|---------|-------------|
| `ch tasks list [--section S] [--priority P] [--active] [--json]` | List tasks; `--active` skips done/archive and fully-checked |
| `ch tasks get <id> [--json]` | Show a single task with subtasks |
| `ch tasks add "<title>" [--section todo] [--priority medium] [--note "..."]` | Create a task; prints new id |
| `ch tasks move <id> <section>` | Move task to another section |
| `ch tasks done <id>` | Mark checked and move to done |
| `ch tasks update <id> [--title "..."] [--note "..."] [--add-note "..."] [--priority P] [--add-subtask "text"] [--check-subtask N] [--uncheck-subtask N]` | Update task fields |
| `ch tasks set-priority <id> <low\|medium\|high>` | Change priority |
| `ch tasks next-id` | Print the next available task id (T<n>) |
| `ch tasks dump [--active] [--json]` | Compact JSON dump — all or active tasks |
| `ch tasks export [--md]` | Export tasks as markdown (reads dashboard parser) |
| `ch tasks lint [--fix]` | Validate tasks.json; `--fix` deduplicates ids |
| `ch tasks archive-done` | Move done tasks older than 7 days to archive |

Valid sections: `backlog`, `todo`, `in-progress`, `done`, `archive`.
Valid priorities: `low`, `medium`, `high`.

### `ch mem` — memory files

| Command | Description |
|---------|-------------|
| `ch mem person <slug> [--field a,b,c] [--json]` | Show person fields |
| `ch mem person list [--has-field X]` | List all person slugs |
| `ch mem person exists <slug>` | Exit 0 if exists, 1 if not |
| `ch mem person create <slug> --name "..." [--role --slack-id --email --github ...]` | Create person file |
| `ch mem person update <slug> --field key=value` | Update a field in place |
| `ch mem whois "<name>"` | Fuzzy-match name/email/slug across all person files |
| `ch mem project <slug> [--field a,b,c] [--section "Name"] [--json]` | Show project fields or section |
| `ch mem project list` | List project slugs |
| `ch mem project update <slug> --field key=value` | Update a project field |
| `ch mem glossary lookup <term>` | Look up a term |
| `ch mem glossary add "<term>" "<def>" [--table "Section"]` | Add a glossary entry |
| `ch mem index [--json]` | Count people, projects, glossary terms |
| `ch mem self [--field X]` | Print your own profile fields from memory/context/company.md |

### `ch context [--json]` — session digest

Assembles a compact digest of active tasks, team Slack/Atlassian IDs, glossary, and memory index — optimised for pasting into a new Claude session as context.

### `ch gaps` — memory gap tracking

| Command | Description |
|---------|-------------|
| `ch gaps list [--all]` | List pending (unchecked) gaps; `--all` includes resolved |
| `ch gaps resolve <n...>` | Mark gap(s) by number as resolved |
| `ch gaps clear` | Remove all resolved items |
| `ch gaps add "<category>" "<text>"` | Append a new gap item |

## tasks.json schema

Tasks live in `tasks.json` at the repo root (gitignored). Copy `tasks.example.json` to get started.

```jsonc
{
  "version": 1,               // must be 1
  "sections": [               // ordered; all five ids must be present
    {
      "id": "backlog",        // one of: backlog, todo, in-progress, done, archive
      "name": "Backlog",
      "tasks": [
        {
          "id": "T1",         // matches /^T\d+$/, unique across all sections
          "title": "...",     // non-empty string
          "checked": false,   // boolean
          "priority": "medium", // low | medium | high
          "created": "2026-01-15", // YYYY-MM-DD or null
          "updated": null,    // YYYY-MM-DD or null
          "note": "...",      // optional free-text note
          "subtasks": [
            { "text": "...", "checked": false }
          ]
        }
      ]
    }
    // ... todo, in-progress, done, archive
  ]
}
```

Run `ch tasks lint` to validate at any time. The dashboard reads and writes the same file.

## CH_HOME env var

By default the CLI locates your data root by walking up from `cwd` to the first directory containing both `serve.js` and `dashboard/`. Set `CH_HOME` to override:

```sh
export CH_HOME=/path/to/your/productivity-home
ch tasks list
```

This is useful when invoking `ch` from outside the repo tree (e.g. from a scheduled task or another project directory).

## Memory files

Person, project, and glossary data stays as plain Markdown in `memory/`. The CLI reads and writes these files directly — no database, no sync required. Only `tasks.json` uses structured JSON; all other data remains human-editable Markdown.

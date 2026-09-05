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
| `ch tasks get <id> [--json]` | Show a single task (due, estimate, assignee, labels, links, deps, history) |
| `ch tasks capture "<title>"` | Shorthand add into **inbox** |
| `ch tasks plan [--pin T1] [--unpin T1] [--carry] [--json]` | Today plan pins in `meta.dailyPlan` |
| `ch tasks add "<title>" [flags…]` | Create a task; prints new id. Flags: `--section`, `--priority`, `--description`, `--color`, `--type`, `--parent`, `--due YYYY-MM-DD`, `--issue URL`, `--project slug`, `--energy deep\|shallow\|errands\|creative`, `--snooze YYYY-MM-DD`, `--decision "…"`, `--estimate 2h\|30m\|1d`, `--assignee name`, `--blocked`, `--waiting-on "…"`, `--label L` (repeatable), `--link URL`, `--link-label`, `--blocked-by T1` |
| `ch tasks move <id> <section>` | Move task (records `history` event) |
| `ch tasks done <id>` | Mark checked and move to done |
| `ch tasks update <id> [flags…]` | Update fields — see below |
| `ch tasks set-priority <id> <low\|medium\|high>` | Change priority (records history) |
| `ch tasks next-id` | Print the next available task id (T\<n\>) |
| `ch tasks dump [--active]` | Compact JSON dump (includes dueDate, estimate, assignee, labels, links, blockedBy) |
| `ch tasks export [--md]` | Export tasks as markdown (reads dashboard parser) |
| `ch tasks lint [--fix]` | Validate tasks.json; `--fix` deduplicates ids / normalizes legacy fields |
| `ch tasks archive-done` | Move done tasks older than 7 days to archive |

**`ch tasks update` flags:** `--title`, `--description`, `--add-description`, `--priority`, `--type`, `--parent` / `--clear-parent`, `--color` / `--clear-color`, `--due` / `--clear-due`, `--estimate` / `--clear-estimate`, `--assignee` / `--clear-assignee`, `--blocked` / `--unblocked`, `--waiting-on` / `--clear-waiting-on`, `--add-label` / `--remove-label` / `--clear-labels`, `--add-link` / `--link-label` / `--remove-link N` / `--clear-links`, `--add-blocked-by` / `--remove-blocked-by` / `--clear-blocked-by`, subtask flags, `--uncheck`.

Valid sections: `inbox`, `backlog`, `todo`, `in-progress`, `done`, `archive`.  
Valid priorities: `low`, `medium`, `high`.  
Valid energy: `deep`, `shallow`, `errands`, `creative`.

**Solo fields:** `issueUrl` (HTTPS link to Jira/GH/etc; preferred over legacy `jiraKey`), `project`, `energy`, `snoozeUntil`, `timeEntries[]`, `decisions[]`. Top-level `meta` holds `dailyPlan`, `weeklyCapacityMinutes`, `projects`, `ideas`, `review`. `ch tasks lint --fix` ensures missing sections (incl. inbox) and empty `meta`.

**Time estimates** are stored as `estimateMinutes` (integer minutes) — **not story points**. Human forms: `30m`, `2h`, `1h30m`, `1.5h`, `1d` (`1d` = 8h workday = 480 minutes), or a bare minute count.

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

#### Person/project file formats

Field extraction is format-tolerant — memory files were hand-written over time, so
`ch mem person`/`project` read all of these shapes:

| Shape | Example |
|-------|---------|
| `**Contact:**` block | `**Contact:**` then `- Slack ID: U123` |
| `## Contact` section | `## Contact` then `- Slack ID: U123` |
| Markdown table | `| Slack ID | U123 |` |
| Bold bullet | `- **Epic:** DEMO-1` |
| Top-level kv | `**Role:** Developer` |
| Bare bullet | `- Slack: handle (U123)` |
| Single-value section | `## Role` then `Developer` |

Two rules keep prose out of the field map:

- A plain `- Label: value` bullet is only read as a field when the label is a
  **known** one (Slack ID, Email, GitHub, Role, Team, …) or it sits in a contact
  block/section. Otherwise `- Note: he prefers X` would become a field.
- A **free-form** label is only trusted above the first `## Heading` (the file's
  metadata header) or in a contact scope. Under `## Notes`, `- **Some lead-in:** …`
  is a sentence, not a field.

A Slack ID buried in prose is recovered as a last resort, but only from a line that
also mentions "slack" — so a colleague's ID quoted in the notes is not misattributed.
`handle (U123)` is split into `slack_id` + `slack_username`.

### `ch context [--json]` — session digest

Assembles a compact digest of active tasks, team Slack/Atlassian IDs, glossary, and memory index — optimised for pasting into a new Claude session as context.

### `ch gaps` — memory gap tracking

| Command | Description |
|---------|-------------|
| `ch gaps list [--all]` | List pending (unchecked) gaps; `--all` includes resolved |
| `ch gaps resolve <n...>` | Mark gap(s) by number as resolved |
| `ch gaps clear` | Remove all resolved items |
| `ch gaps add "<category>" "<text>"` | Append a new gap item |

### `ch slack` — Slack queries (read-only)

| Command | Description |
|---------|-------------|
| `ch slack recent --user <UID> --days <N> [--count 100] [--max-pages 5] [--query "<raw>"]` | Recent messages from/to/mentioning the user (3 search buckets, deduped) |
| `ch slack awaiting --user <UID> --days <N> [--cap 10]` | Messages directed at the user with NO reply/reaction from them — verified server-side; returns a short ready-to-act list, no JSON post-processing needed |
| `ch slack channels --ids <C1,C2,...> --days <N> [--limit 200] [--max-pages 5]` | Full message history for specific channels/DMs |
| `ch slack thread --channel <C> --ts <ts>` | All replies in a thread |
| `ch slack reactions --channel <C> --ts <ts> [--user <U>]` | Reactions on a message; `--user` adds a `reacted` boolean |

All output JSON. Requires a Slack `xoxp-` user token via `config.json` `slack_token` / `slack_token_cmd`, or the `SLACK_TOKEN` env var. `recent`/`awaiting` use `search.messages` (needs scope `search:read`; a bot token is rejected).

**How `awaiting` resolves a message** (drops it from the list): you sent any later message in that DM/thread, OR you reacted to it. DM replies are read from the `from:` search bucket (which captures your top-level AND thread replies); channel @mentions are thread-checked via one `conversations.replies` call each. Defunct/inaccessible channels are skipped as `unverifiable` (never flagged, never crash the run). Each result carries an advisory `looks_like_question` flag.

## tasks.json schema

Tasks live in `tasks.json` at the repo root (gitignored). Copy `tasks.example.json` to get started.

```jsonc
{
  "version": 1,
  "ticketTypes": [            // optional; defaults to epic/feature/task/bug (built-in, always restored)
    { "id": "epic", "name": "Epic", "color": "#8B5CF6" }
  ],
  "sections": [
    {
      "id": "todo",             // backlog | todo | in-progress | done | archive
      "name": "Todo",
      "tasks": [
        {
          "id": "T1",           // /^T\d+$/, unique across all sections
          "title": "...",
          "checked": false,
          "priority": "medium", // low | medium | high
          "type": "task",       // ticket-type id (default "task")
          "parentId": "T2",     // optional hierarchy parent
          "created": "2026-01-15",
          "updated": null,
          "description": "...", // optional
          "color": "#3B82F6",   // optional #RRGGBB override
          "dueDate": "2026-03-01",          // optional YYYY-MM-DD
          "blocked": true,                  // optional; omit when false
          "waitingOn": "reviewer",          // optional free-text
          "assignee": "alex",               // optional name or slug
          "estimateMinutes": 120,           // optional minutes (NOT story points)
          "labels": ["ops"],                // optional string[]
          "links": [{ "label": "PR", "url": "https://..." }],
          "blockedBy": ["T3"],              // optional peer task ids
          "history": [                      // optional activity log (capped at 50)
            { "at": "2026-01-15T10:00:00.000Z", "event": "created", "to": "todo" }
          ],
          "subtasks": [
            { "text": "...", "checked": false }
          ]
        }
      ]
    }
  ]
}
```

`history` events typically include: `created`, `moved`, `priority`, `blocked`, `unblocked`, `assignee`, `estimate` (with optional `from` / `to` / `note`).

Run `ch tasks lint` to validate at any time. The dashboard reads and writes the same file.

### WIP limits (dashboard)

Soft column limits are configured in `config.json` (not in tasks.json):

```json
{
  "wipLimit": 5,
  "wipLimits": { "in-progress": 5 }
}
```

`wipLimit` applies to In Progress; `wipLimits` can set a per-section limit. Over-limit columns show a warning on the board (Kanban soft limit — not a hard block).

## CH_HOME env var

By default the CLI locates your data root by walking up from `cwd` to the first directory containing both `serve.js` and `dashboard/`. Set `CH_HOME` to override:

```sh
export CH_HOME=/path/to/your/productivity-home
ch tasks list
```

This is useful when invoking `ch` from outside the repo tree (e.g. from a scheduled task or another project directory).

## Memory files

Person, project, and glossary data stays as plain Markdown in `memory/`. The CLI reads and writes these files directly — no database, no sync required. Only `tasks.json` uses structured JSON; all other data remains human-editable Markdown.

## Nicknames (whois fuzzy matching)

`ch mem whois` can use a per-user list of name spelling-equivalences (e.g. `Liz` ↔ `Elizabeth`). These are personal, so they live in a gitignored `nicknames.json` — copy the template to get started:

```sh
cp nicknames.example.json nicknames.json   # then edit with your own pairs
```

Format is a bare array of `[a, b]` pairs. The repo ships only the fictional `nicknames.example.json`; `nicknames.json` is never committed.

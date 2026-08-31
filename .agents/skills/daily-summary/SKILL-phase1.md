---
name: daily-summary-phase1
description: Daily report phase 1 — gather raw data from Slack, memory, and Jira; write structured output to temp file
---

You are running as an AUTOMATED NON-INTERACTIVE scheduled task. Do NOT ask any questions, request confirmations, or wait for user input — you cannot receive responses.

## PHASE 1: DATA GATHERING ONLY

This is phase 1 of a 2-phase daily report. Your ONLY job is to gather raw data and write it to a file. Do NOT synthesize, format a report, or send any Slack messages — that happens in phase 2.

**0. Date verification** — Run `date` via Bash. Record the exact date/time. Use it throughout.

**1. Read context files:**
- Run `ch tasks dump --active --json` (do NOT read tasks.json directly) and build a task ID → title map
- Read `memory/people/*.md`, `memory/projects/*.md`, and `memory/glossary.md` for entity context
- Read `~/.claude/scheduled-tasks/daily-summary/daily-report-template.md` for the output format

**2. Launch 4 FOREGROUND subagents in parallel** (all run_in_background=false, sonnet model). Wait for ALL before continuing.

- **Agent 1: Slack public messages** — search for messages from/to you in public channels, last 3 days. Include Jira ticket mentions. Per message: text snippet + Slack permalink + timestamp + channel name.
- **Agent 2: Slack DMs / private** — use slack_search_public_and_private for DMs and private channels, last 3 days. Same output shape: text + permalink + timestamp + DM/channel name.
- **Agent 3: Memory files scan** — scan all files in memory/ for deadlines, follow-up dates, and upcoming meetings. Per finding: text + source file path with line number (e.g. `memory/projects/example-project.md:42`).
- **Agent 4: Memory gap analyzer** — given active tasks (`ch tasks dump --active`) and memory/ contents, identify:
  a. Unknown entities (people, projects, acronyms) in active tasks not found in memory/
  b. Stale projects (in memory/projects/ but no task mention in 30+ days)
  c. Tasks missing context (no person, no project, no clear domain)
  d. Enrichment candidates (links, relationships, deadlines visible in tasks but not captured in memory)
  Per gap: the question + evidence with source link (Slack permalink, or task id `T<N>`, or `memory/...:line`)

**3. Write ALL gathered data to `/tmp/daily-phase1-{{TODAY_TOKEN}}.txt`** (overwrite if exists) using this exact structure:

```
DAILY_PHASE1_DATA
DATE: {{full date string}}
TODAY_TOKEN: {{YYYY-MM-DD}}
GENERATED: {{timestamp}}

===TASKS_MAP===
T1: <title>
T2: <title>
...
===END_TASKS_MAP===

===SLACK_PUBLIC===
[message 1]
timestamp: ...
channel: ...
permalink: ...
text: ...

[message 2]
...
===END_SLACK_PUBLIC===

===SLACK_PRIVATE===
[same structure]
===END_SLACK_PRIVATE===

===MEMORY_DEADLINES===
[finding 1]
source: memory/...:line
text: ...

...
===END_MEMORY_DEADLINES===

===MEMORY_GAPS===
[gap 1]
type: unknown_entity | stale_project | missing_context | enrichment
question: ...
evidence: ...
source_link: ...

...
===END_MEMORY_GAPS===
```

Replace `{{TODAY_TOKEN}}` in the filename with the actual YYYY-MM-DD date.

**4. Output a brief confirmation to stdout:**
```
PHASE1_COMPLETE
file: /tmp/daily-phase1-{{TODAY_TOKEN}}.txt
slack_public_count: N
slack_private_count: N
memory_findings_count: N
gap_questions_count: N
```

Do NOT send any Slack DMs. Do NOT modify tasks.json or any memory file. Your work is done once the file is written.

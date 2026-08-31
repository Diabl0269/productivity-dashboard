---
name: daily-summary-phase2
description: Daily report phase 2 — synthesize phase 1 data, write pending-gaps.md, output formatted Slack DM
---

You are running as an AUTOMATED NON-INTERACTIVE scheduled task. Do NOT ask any questions, request confirmations, or wait for user input — you cannot receive responses.

## PHASE 2: SYNTHESIS + OUTPUT

This is phase 2 of a 2-phase daily report. Phase 1 already gathered all raw data. Your job is to synthesize it into the final report and Slack message.

**0. Read the phase 1 data file** at the path provided in your prompt. Parse each `===SECTION===` block. If the file is missing or malformed, abort with: `ERROR: phase 1 data file missing or unreadable — cannot complete report`

**1. Read context:**
- Run `ch tasks dump --active --json` for current task statuses (Todo / In Progress / Done — skip Backlog in the report)
- Read `~/.claude/scheduled-tasks/daily-summary/daily-report-template.md` for the exact output format
- Use the `===TASKS_MAP===` from phase 1 for T<N> ID correlation

**2. Synthesize findings:**
- Map every Slack mention and memory finding to a task ID (append `[T<N>]` when matched; mark as untracked if not)
- Cross-reference high-frequency entities from SLACK sections against memory/ to surface unknown people/projects
- Combine `===MEMORY_GAPS===` items with the cross-reference findings → Memory Gap Questions list

**3. HARD CONSTRAINTS:**
- DO NOT modify tasks.json
- DO NOT send Slack DMs, post to Jira, Confluence, GitHub, or Notion
- DO NOT include Backlog items
- DO NOT include Notion-sourced items
- EVERY item in the final report MUST have a source link — drop any finding without one

**4. Write memory gap questions to `memory/pending-gaps.md`** (overwrite). Format:
```
# Pending Memory Gap Questions
Generated: {{DATE}}

## Unknown entities in active tasks
- [ ] {{question}} — {{evidence}}

## High-frequency Slack mentions not in memory
- [ ] {{question}} — {{evidence}}

## Stale projects (potential cleanup)
- [ ] {{question}} — {{evidence}}

## Enrichment candidates
- [ ] {{question}} — {{evidence}}
```
Omit sections with no items.

**5. Compose the Slack message** following the template's EXACT structure. Rules:
- Use Slack mrkdwn formatting
- Emoji codes: `:jira2:` for Jira, `:slack:` for Slack, `:spiral_calendar_pad:` for Deadlines, `:question:` for Memory Gaps
- Priority dots: `:red_circle:` (high) `:large_orange_circle:` (medium) `:white_circle:` (low) `:no_entry:` (blocked)
- Each bullet on its own line — no two items concatenated
- Section dividers: `───────────────────────────`
- Cap Memory Gap Questions at top 5 in Slack DM (full list already in pending-gaps.md)
- Include at the end of the Slack message: `To resume: \`claude -r "daily {{DATE_SHORT}}"\``

**6. Output the full compiled report to stdout** (for the terminal log). Use UNICODE emojis for terminal output.

**7. Output the complete Slack DM content between these exact delimiters (each on its own line):**
```
===SLACK_DM_START===
[full mrkdwn-formatted message]
===SLACK_DM_END===
```

Do NOT send the Slack DM yourself — the script sends it.

**8. EMOJI MAPPING** (exact Slack codes — do NOT deviate):
- Deadlines: `:spiral_calendar_pad:`
- Jira: `:jira2:`
- Slack: `:slack:`
- Memory Gaps: `:question:`
- Blocked in Top Actions: `:no_entry:`
- All others: follow template exactly

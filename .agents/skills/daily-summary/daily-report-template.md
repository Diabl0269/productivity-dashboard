# Daily Report Template

Use this exact structure when composing the daily report (the full report renders in the Antigravity CLI chat; only a short ready-notification goes to Slack). Replace placeholders with real data. Omit any section or sub-bullet that has no content.

```
:clipboard: *Daily Summary - {{DATE}}*

:dart: *Needs You ({{count}})*
{{The ONE action surface — only items that require something FROM you. One line each, prefixed by verb, ending in a link. Omit a verb-line that has no items. If all are empty: ":dart: *Needs You (0)* — nothing needs you right now ✅".}}
:slack: *Reply:* {{author}} — "{{snippet}}" (permalink)
:no_entry: *Decide:* {{decision/approval blocked on you}} — _{{why blocked}}_ [T<N>] (link)
:question: *Answer:* {{gap question only you can answer}} — {{evidence}} (link)

───────────────────────────

:rotating_light: *Top Actions ({{count}})*  _(FYI — cross-task urgency snapshot)_
{{3–5 most urgent items across all tasks. Blocked items first within priority tier. One line each: priority emoji + task title + one-line context + [T<N>] + link.}}
:no_entry: {{task}} — _blocked on {{who/what}}_ [T<N>] (link)
:red_circle: {{task}} — {{one-line context}} [T<N>] (link)
:large_orange_circle: {{task}} — {{one-line context}} [T<N>] (link)

───────────────────────────

:arrow_forward: *In Progress*

:red_circle: *[T<N>] {{Task Title}}*
{{One-line status summary — what's happening right now.}}
• :slack: {{Slack highlight 1}} (permalink)
• :slack: {{Slack highlight 2}} (permalink)
• :jira2: {{Jira update, if any}} (link)
• :spiral_calendar_pad: {{Upcoming deadline or meeting, if any}}
• ❓ {{Open question or gap for this task, if any}}

:large_orange_circle: *[T<N>] {{Task Title}}*
{{One-line status.}}
• :slack: {{highlight}} (permalink)
• :spiral_calendar_pad: {{deadline, if any}}

:white_circle: *[T<N>] {{Task Title}}*
{{One-line status.}}

───────────────────────────

:memo: *Todo*

:red_circle: *[T<N>] {{Task Title}}*
{{One-line context.}}
• :slack: {{highlight, if any}} (permalink)

:large_orange_circle: *[T<N>] {{Task Title}}*
{{One-line context.}}

:white_circle: *[T<N>] {{Task Title}}*
{{One-line context.}}

───────────────────────────

:white_check_mark: *Recently Done*
✅ [T<N>] {{task}} — {{brief context}}
✅ [T<N>] {{task}} — {{brief context}}

───────────────────────────

:slack: *Untracked Slack Items*
{{Messages, threads, or developments from Slack/Jira found that are NOT linked to any existing task. Include source link for every item. Omit section if empty.}}
• ({{channel/DM}}): "{{snippet}}" — {{context}} (permalink)

───────────────────────────

:question: *Memory Gap Questions — FYI ({{count}})*
{{ONLY reference/researchable gaps that do NOT need you — stale projects, enrichment candidates, entities you could look up yourself. Gap questions only YOU can answer go in the 🎯 Needs You → Answer block at the top, not here. Awaiting-reply messages go in 🎯 Needs You → Reply, not in a separate section. Top 5; full list in memory/pending-gaps.md. Omit if none.}}
1. {{question}} — {{evidence}}
2. {{question}} — {{evidence}}

```

## Rules
- **CRITICAL — newlines:** Every item MUST be on its own line. Each line marker (`:dart:`, `:red_circle:`, `:large_orange_circle:`, `:white_circle:`, `:no_entry:`, `•`, `✅`) MUST be preceded by a literal newline. Never concatenate two items on the same line.
- **Task-first structure:** All context for a task (status, Slack highlights, Jira updates, deadlines, gap questions) is consolidated into that task's block. There are NO separate "Slack Highlights", "Jira", or "Upcoming Deadlines" sections — everything lives inside the task it belongs to.
- **Untracked Items** is the only place for Slack/Jira findings that have no matching task ID.
- Keep each sub-bullet to ONE line max. Sub-bullets use `•` prefix.
- Use `:red_circle:` `:large_orange_circle:` `:white_circle:` for high/medium/low priority; `:no_entry:` for blocked items.
- Separate major sections with `───────────────────────────` for visual breathing room.
- **🎯 Needs You is ALWAYS first**, right after the title — it is the single action surface (Reply / Decide / Answer). A line belongs here ONLY if it requires an action from you; otherwise it's FYI and goes below. Render `🎯 Needs You (0) — nothing needs you right now ✅` when empty.
- "Top Actions" follows as the first FYI block — 3–5 items max, cross-task urgency snapshot, blocked items float to top.
- Blocked items are annotated inline (`_blocked on X_`) within Top Actions — do NOT create a separate "Blocked" section.
- Do not include Backlog items.
- Do not include a Notion section.
- ALWAYS include source links (Slack permalink, Jira URL, file:line) for EVERY item — no exceptions. Drop items with no link.
- **Awaiting-reply messages are folded into 🎯 Needs You → Reply** (sourced from `ch slack awaiting`, already verified) — there is NO separate "Awaiting Your Reply" section. Cap at 5, newest first.
- **Gap questions split by ownership:** ones only YOU can answer → 🎯 Needs You → Answer; researchable/reference ones → "Memory Gap Questions — FYI" (cap 5). Full list always in memory/pending-gaps.md.
- DATE format: DD.MM.YY (Day of week), e.g. "22.03.26 (Saturday)"
- DATE_SHORT format: DD.MM.YY, e.g. "22.03.26"

## Task ID Correlation
- Tasks live in `tasks.json` with ids `T<N>` (e.g. `T1`, `T5`) — use `ch tasks dump --active --json` for the map
- When a Slack/Jira/Confluence finding matches an existing task, include it in that task's block and tag `[T<N>]`
- The "Untracked Items" section contains ONLY findings with NO matching task ID
- Format for untracked: `• (source): "snippet" — context (no matching task) (permalink)`

---
name: daily-summary
description: Daily comprehensive productivity report — gathers Jira, Slack, and memory data; flags memory gaps; full report in Antigravity CLI
---

You are running as an AUTOMATED NON-INTERACTIVE scheduled task. Do NOT ask any questions, request confirmations, or wait for user input — you cannot receive responses.

**ON UNRECOVERABLE FAILURE:** If you hit an error you cannot work around — a required connector/tool is unavailable, Slack/Jira data gathering fails outright, or you otherwise cannot produce the report — send ONE short Slack DM to the Slack user ID from `config.json` `slack_user_id` (required) via `slack_send_message`: `:warning: *daily-summary failed* — <one-line reason>`, then stop. Send it exactly once; do NOT retry in a loop. (Partial data is fine — report it normally; this ping is only for failures that prevent completing the run.)

INSTRUCTIONS FOR THIS AUTOMATED RUN:

0. **Date verification** — Read the system date/time first (e.g., via Bash `date`). Use that exact date and day-of-week throughout the report. Do NOT guess or rely on context.

1. Load task + memory data via the `ch` CLI (`CH_HOME` is in the environment — do NOT prefix commands with it):
   - Active tasks (JSON): `ch tasks dump --active --json` — compact array of non-done/non-archive tasks including `id`, `section`, `title`, `description`/`note`, `priority`, `dueDate`, `startDate`, `jiraKey`, `blocked`, `waitingOn`, `assignee`, `estimateMinutes`, `subtasks`. Do NOT read tasks.json directly.
   - Memory index (JSON): `ch mem index --json` — people/project slugs + glossary terms for gap detection (no file contents).
   - Per-person detail as needed: `ch mem person <slug> --json`.
   - Still read the template file directly: `.agents/skills/daily-summary/daily-report-template.md`.
   (If `ch` is not on PATH, fall back to reading tasks.json + memory/ files directly.)

1.5. **Due-date triage (from the dump — no scripts).** Using TODAY from step 0, partition active tasks that have `dueDate`:
   - **Overdue:** `dueDate` < TODAY
   - **Due today:** `dueDate` === TODAY
   - **Due soon:** `dueDate` within the next 3 calendar days (exclusive of today)
   Promote overdue and due-today into **Needs You → Decide** and into **Top Actions** (lead with `:spiral_calendar_pad:` or `:rotating_light:` for overdue). On each In Progress / Todo task card, when that task has a `dueDate`, add a bullet `• :spiral_calendar_pad: due {{dueDate}} ({{overdue|today|in Nd}})` with the task's Jira link if `jiraKey` is set (prefer `{{jira_base_url}}/browse/{{jiraKey}}` from `config.json` `jira_base_url`, e.g. `https://YOUR_ORG.atlassian.net`, when no other link exists).

2. Build the task ID mapping directly from the step-1 active-tasks JSON — each element already has `id` and `title`. Include this mapping in every subagent prompt so they can correlate findings to existing tasks (append `[T<N>]` when a match is found; mark as untracked if no match). No TASKS.md parsing needed.

2.5. **Pre-fetch Slack data via CLI (zero LLM tokens).** Read `slack_user_id` from `config.json` first (required). Run the following Bash command (runs inside the sandbox; slack.com is allow-listed) and capture its stdout to `SLACK_JSON` and its exit code to `SLACK_EXIT`:
   ```
   ch slack recent --days 5 --user YOUR_SLACK_USER_ID
   ```
   (Replace `YOUR_SLACK_USER_ID` with the value of `config.json` `slack_user_id`.)
   Do NOT suppress stderr (`2>/dev/null` is forbidden — the error text is needed for diagnosis).
   **Failure detection:** Treat the result as FAILURE if the exit code is non-zero OR if the output is not a valid JSON array (i.e. does not start with `[`). A bare `EXIT:N`, an error message, or any non-JSON output is NOT Slack data — it means failure; trigger the fallback. Never treat error output as the payload.
   **Graceful degradation (tiered fallback):** On FAILURE:
   1. **MCP available (interactive run):** If the Slack MCP connector is present in this session (verify by checking whether the `slack_search_public_and_private` tool exists), fall back to an MCP-based Slack search for this run: use `slack_search_public_and_private` to find messages from/to your `slack_user_id` over the same window, and produce the same data shape that `ch slack recent` would have (`{ text, permalink, timestamp, channel, channel_name, author_id, author_name, is_private, match_types }`). Accept the higher token cost — this is a fallback, not the normal path.
   2. **MCP unavailable (headless/cron run):** Set `SLACK_JSON` to the string `"UNAVAILABLE"` and continue — do NOT abort the run. The synthesis step (step 5) will note "⚠️ Slack data unavailable (ch slack not configured — see config secret store)" in the report and skip all Slack sections. The rest of the daily summary (tasks, memory, gaps) still runs normally regardless.
   Always prefer the `ch slack` CLI; only use the MCP fallback when the CLI path fails.

2.6. **Pre-fetch the verified Awaiting-Reply list via CLI (zero LLM tokens).** Run as its OWN standalone Bash call (do NOT chain with `&&`, do NOT pipe into python/node):
   ```
   ch slack awaiting --user YOUR_SLACK_USER_ID --days 5
   ```
   (Same `slack_user_id` substitution as step 2.5.)
   Capture stdout to `AWAITING_JSON`. This returns a JSON object `{ candidates_examined, resolved_count, unverifiable_count, awaiting_count, awaiting: [ { author_name, text, channel, channel_name, timestamp, permalink, match_types, looks_like_question } ] }`. **The `awaiting` array is already fully verified server-side** — every item is a message directed at you with NO later reply or reaction from you. Defunct/inaccessible DMs are already skipped (counted in `unverifiable_count`).
   **Do NOT re-verify these.** Do NOT call `ch slack thread` or `ch slack reactions`, do NOT parse raw `recent` JSON to re-derive candidates, and do NOT write any script. The only thing left for you is light judgment in step 5: from the (already short) `awaiting` array, keep the items that genuinely need YOUR reply and drop pure pleasantries ("good morning", "thanks", "sure"), FYIs, and messages clearly aimed at someone else (use `looks_like_question` + the text as a guide).
   **Graceful degradation:** If `ch slack awaiting` exits non-zero or its output is not valid JSON starting with `{` (e.g. an older `ch` build without the subcommand), set `AWAITING_JSON` to `"UNAVAILABLE"` and continue — note "⚠️ awaiting-reply unavailable (update `ch`: `cd cli && npm link`)" in the Needs-You block and omit the Reply items. Do NOT fall back to manual scripting.

2.7. **Checkpoint (crash-resume).** Immediately after steps 2.5–2.6, write `SLACK_JSON` and `AWAITING_JSON` to `/private/tmp/agy/daily-summary-<TODAY>.json` (single Write, create or overwrite). After the step-3 agents return, update the same file with their outputs. At the START of a run (right after step 0), check whether this file already exists for TODAY: if yes, reuse its contents and skip the corresponding fetch/agent steps — a crashed or interrupted earlier run resumes instead of redoing the work. Never reuse a checkpoint from a previous day. If you need to sanity-check the checkpoint contents, use `jq` (e.g. `jq length <file>`) — the step-6 ban on `python3 -c`/`node -e` applies to this file too.

3. Launch 2 FOREGROUND subagents (sonnet model) in parallel to gather data. **EVERY agent MUST return a source link (Jira URL, file:line ref, or Confluence URL) for EVERY finding — no exceptions. Findings without links are unusable.**
   **Pass `TODAY=<YYYY-MM-DD> (<DayOfWeek>)` explicitly in every subagent prompt** so subagents never derive or hallucinate the date. Example: `TODAY=2026-06-21 (Sunday)`. Subagents MUST use this exact date for all date arithmetic — do NOT let them infer today's date from context. Work week starts Sunday.
   - **Agent 1: Memory files scan** — deadlines, follow-up dates, upcoming meetings. For each finding, return: text + source path with line number (e.g. `memory/projects/example-project.md:42`). Compute the day-of-week for every upcoming date using TODAY as anchor (Sunday=start of week). Double-check: if today is Sunday Jun 21, then Monday Jun 22 is tomorrow, not another Sunday.
   - **Agent 2: Memory gap analyzer** — given the active-tasks JSON (step 1) and the memory index (step 1), plus per-person `ch mem person <slug> --json` as needed, identify:
     **IMPORTANT:** For each task, read BOTH the relevant person files AND the project file before flagging anything as missing. A finding that exists in the project file but not the person file is NOT a gap — resolve it from the project file first.
     a. Unknown entities (people, projects, acronyms) referenced in active tasks but not in memory/
     b. Stale projects (in memory/projects/ but no mentions in tasks for 30+ days)
     c. Tasks missing context (no person, no project, no clear domain)
     d. Enrichment candidates (links, relationships, deadlines visible in tasks but not yet captured in person/project files)
     For each gap, return: the question + evidence with source link (task id `T<N>` or `memory/...:line` for in-file references).

4. CRITICAL — Both agents launch as FOREGROUND (run_in_background=false) so you block and wait for ALL results before continuing. Multiple Agent calls in one message run them in parallel, but all must complete before step 5.

5. Synthesize findings (using the pre-fetched `SLACK_JSON` from step 2.5 and outputs from Agents 1–2):
   - If `SLACK_JSON` is `"UNAVAILABLE"`, include a note in the report: "⚠️ Slack data unavailable (ch slack not configured — see config.json slack_token)" and omit all Slack sections. Otherwise:
     - Parse `SLACK_JSON` (array of `{ text, permalink, timestamp, channel, channel_name, author_id, author_name, is_private, match_types }` objects)
     - Extract Slack highlights: messages with `match_types` containing `"from_user"`, `"to_user"`, or `"mention"` — include text snippet + permalink + timestamp + channel_name for each
     - Cross-reference Slack mentions against memory/ to flag high-frequency unknown people/projects (e.g., "Maya — 12 mentions, no people/ entry")
     - **Awaiting Your Reply:** use the pre-verified `AWAITING_JSON` from step 2.6 — do NOT re-derive or re-verify. Parse its `awaiting` array (each entry is already confirmed to have no reply/reaction from you). Apply light judgment only: keep entries that genuinely need YOUR reply; drop pure pleasantries ("good morning", "thanks", "sure"), pure FYIs, and messages clearly directed at someone else (the `looks_like_question` flag + the text are your guide). For each kept item carry through: author_name + text snippet + permalink + timestamp. Cap at the 5 newest, always keep the permalink. These items feed the **🎯 Needs You** block (step 8). If `AWAITING_JSON` is `"UNAVAILABLE"`, omit the Reply items and add the one-line note from step 2.6.
   - Compile the task report from Agent 1 output
   - Combine Agent 2 output with the Slack cross-reference findings into the Memory Gap Questions section

6. **HARD CONSTRAINTS**:
   - DO NOT modify tasks.json or any memory file (except the pending-gaps.md write in step 7)
   - DO NOT call any tool that posts/edits to Jira, Confluence, GitHub, Notion, or any external system. The ONLY external write is the one-line failure DM described at the top if the run can't complete.
   - **NEVER write ad-hoc scripts** (`.py` / `.js` / `.sh` files) and NEVER use `python3 -c '...'`, `node -e '...'`, or heredocs to process JSON. They trigger a permission prompt per file/run and reliably fail inside the sandbox: Python's `xcrun` cache dir is blocked (`Operation not permitted`), Hebrew/emoji text throws `Non-UTF-8` SyntaxErrors, and zsh history-expansion mangles `!`/`!=`. The `ch` CLI already returns finished, ready-to-read JSON — consume it directly. If you must slice JSON, prefer `jq`. Run each `ch` command as its OWN Bash call (no `&&` chaining, no piping into an interpreter) so it stays within the allow-list and never prompts.

7. Write the memory gap questions to `memory/pending-gaps.md` (overwriting any prior content). **Before writing, run `ch gaps list` and cross-check: exclude any gap already resolved (via `ch gaps resolve`) or already answered in a prior session. Never re-list a gap question that has already been answered or resolved — only genuinely new/open gaps go in the file.** Then, first Read the existing file (the Write tool requires a prior Read of an existing file). Then overwrite it. Use markdown checkboxes so they can be checked off in the daily session. Format:
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
   Omit any section with no items.

8. Output the FULL compiled report as text directly in the chat response — **this is the primary deliverable you read in Antigravity CLI.**

   **Lead with a 🎯 Needs You block; everything else is a skimmable FYI tail.** The report separates *what needs you* from *what informs you* so the daily interaction is: read the top block → reply/decide/answer each item → done.

   **🎯 Needs You (N)** — at the VERY TOP, before anything else. ONLY items that require an action FROM you, as short one-liners, each prefixed by its verb and ending with a link:
   - **Reply:** each kept Awaiting-Reply item from step 5 — `author — "snippet" (permalink)`
   - **Decide:** decisions/approvals blocked on you — e.g. an overdue go/no-go, a pending sign-off (surfaced from task notes or Slack) — `what — why it's blocked (link)`
   - **Answer:** the gap questions that ONLY you can answer (knowledge in your head), NOT research you could do yourself — `question (evidence link)`
   This is where the daily gap questions live now — fold the answerable ones in here rather than making them a separate pass. The rule: if a line does not require something *from you*, it does NOT belong in Needs You. If there are zero items, render `🎯 Needs You (0) — nothing needs you right now ✅`.

   **FYI tail** (everything below the Needs You block — skim or skip on busy days): the task-first structure — each active task gets its own card with ALL its context (status + Slack highlights + Jira updates + deadlines) consolidated into the task block — no separate Slack Highlights or Upcoming Deadlines sections. Untracked items (no task match) go to the Untracked section. Reference-only gap questions (researchable, not needing you) go in a Memory Gap Questions section in the tail. Do NOT duplicate a Needs-You item lower down; the Needs You block is the single action surface.

   **CHAT OUTPUT EMOJI — ALWAYS use Unicode, NEVER Slack codes (`:emoji-name:`).**
   The template file uses Slack codes as placeholders; replace every one with its Unicode equivalent:
   | Template code | Unicode |
   |---|---|
   | `:dart:` | 🎯 |
   | `:clipboard:` | 📋 |
   | `:rotating_light:` | 🚨 |
   | `:red_circle:` | 🔴 |
   | `:large_orange_circle:` | 🟠 |
   | `:white_circle:` | ⚪ |
   | `:no_entry:` | ⛔ |
   | `:arrow_forward:` | ⏩ |
   | `:memo:` | 📝 |
   | `:spiral_calendar_pad:` | 📅 |
   | `:slack:` | 💬 |
   | `:jira2:` | 🎫 |
   | `:inbox_tray:` | 📥 |
   | `:question:` | ❓ |
   | `:white_check_mark:` | ✅ |

9. EMOJI MAPPING FOR SLACK DM PAYLOADS ONLY — applies exclusively to the failure DM sent via `slack_send_message` (step 0 / ON UNRECOVERABLE FAILURE). The chat report (step 8) always uses Unicode. In Slack payloads use these exact codes:
    - Deadlines section: `:spiral_calendar_pad:` (NOT `:calendar_spiral:` or `:calendar:`)
    - Jira section: `:jira2:`
    - Slack section: `:slack:`
    - Memory Gap Questions section: `:question:`
    - Blocked items in Top Actions: `:no_entry:`

Complete everything without any user interaction.
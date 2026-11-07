# Development metrics

`ch metrics` and the dashboard's **Metrics** tab measure where work waits, so you can see the
bottleneck and what is worth investing in. Everything is computed locally from data you already
have; nothing leaves the machine.

| Source | What it gives | How it gets in |
|---|---|---|
| Ticket history (`history` moved events) | cycle time, time per column, WIP, forgotten epics, stale tickets, bottleneck | read live from tasks |
| Claude Code transcripts (`~/.claude/projects/<dir>/*.jsonl`) | session length, waiting on you, questions, stalls, sessions per ticket | `ch metrics collect --sessions` |
| GitHub Actions (`gh run list`) | CI run time per repo/workflow, time a PR stays red | `ch metrics collect --ci` |
| Local gate run logs (JSONL your gate scripts append) | local build/test time per step | `ch metrics collect --gates` |
| Anything else you time | free-form timings | `ch metrics time <name> -- <cmd>`, `ch metrics record` |

Collected data lives in `$CH_HOME/metrics/` (private, never in git). Collection is idempotent:
re-running it rewrites the same records, so it can run by hand or on a schedule.

## Commands

```
ch metrics collect [--sessions] [--ci] [--gates] [--since 30d] [--json]   (no flag = all three)
ch metrics flow    [--project P] [--lane L] [--since 30d] [--json]
ch metrics report  [--project P] [--since 30d] [--json]                    insights + headline numbers
ch metrics cost    [<ticket-id>] [--project P] [--since 30d] [--json]      $ at API prices per ticket; an id gives that ticket (an epic: per child)
ch metrics time <name> [--repo R] -- <command...>                          run, time, record, pass the exit code through
ch metrics record --name N --seconds S [--ok|--failed] [--repo R] [--kind gate|build|test|ci|other]
ch tasks next [--n 5] [--project P] [--json]                                ready tickets, best first, with reasons
```

## Config (`config.json`, all optional)

```json
"metrics": {
  "claudeProjects": ["~/.claude/projects/-Users-you-work*"],
  "repos": [{ "repo": "owner/name", "workflows": ["CI"] }],
  "gateLogs": [{ "repo": "name", "path": "/path/to/checkout/.git/gate-runs.jsonl" }],
  "buildTimeLogs": [{ "repo": "name", "path": "/path/to/checkout/.git/ci-local-build-times.log" }],
  "areas": { "lane-or-project-slug": "Area name" },
  "stallMinutes": 20,
  "forgottenEpicDays": 3,
  "planUSDPerMonth": 200
}
```

`planUSDPerMonth` (optional) is what you pay a month for a plan; with it the Cost section and the report
show the window's API-priced cost scaled to 30 days and its multiple of the plan.

A `claudeProjects` entry ending in `*` matches every directory in that folder whose name starts with the
text before it (one entry for a workspace and all its worktrees). `areas` groups lanes/projects into the areas the bottleneck view reports; without it, each project
and each lane is its own group.

## Files in `$CH_HOME/metrics/`

One JSON object per line. Every record has a stable `key`; collectors replace records by key.

**`sessions.jsonl`** (one per main session; prompt text is never stored)
```json
{"key":"<sessionId>","sessionId":"…","project":"<transcript dir name>","title":"PRO40 - …","ticket":"PRO40",
 "start":"ISO","end":"ISO","wallMin":95.2,"activeMin":61.0,"waitUserMin":30.1,"turns":12,"userPrompts":3,
 "questions":2,"questionsMidRun":1,"stalls":1,"stallMin":34.0,
 "missedWakes":1,"missedWakeMin":45.0,"missedWakeOrigins":{"task-notification":1},"helperWaits":2,"helperWaitMin":61.0,
 "toolWaits":2,"toolWaitMin":55.0,"toolWaitTools":{"Bash":2},"questionWaits":1,"questionWaitMin":40.0,
 "replyWaits":[4.2,31.0],"stopBlocked":0,"compactions":1,
 "helpers":4,"prs":["owner/repo#12"],"branch":"pro40-dev-metrics",
 "costUSD":12.3,"mainCostUSD":9.1,"helperCostUSD":3.2,"costStateUSD":null,
 "tokens":{"input":1200,"output":80000,"cacheRead":9000000,"cacheWrite":400000},
 "byModel":{"claude-opus-5":{"input":1200,"output":80000,"cacheRead":9000000,"cacheWrite":400000,"costUSD":9.1}},
 "helperTokens":{"input":300,"output":20000,"cacheRead":2000000,"cacheWrite":90000},
 "helperByModel":{"claude-sonnet-5":{"input":300,"output":20000,"cacheRead":2000000,"cacheWrite":90000,"costUSD":3.2}},
 "helperToolCalls":140,"toolCalls":{"Bash":210,"Read":90},"toolCallsTotal":300,
 "agentCalls":4,"agentModels":{"sonnet":3,"inherit":1},
 "byTicket":{"PRO40":{"costUSD":12.3,"tokens":11000000,"toolCalls":440}},
 "ticketTimeline":[["ISO","PRO41"]],
 "intervals":{"work":[[1767262800000,1767266400000,"PRO40"]],"waitUser":[[1767266400000,1767270000000,"PRO40"]]}}
```
`costUSD` is computed from usage (see Cost below); `costStateUSD` is Claude Code's own `cost-state`
total when it wrote one (rare). Records from before these fields only have `costUSD`.

**`timings.jsonl`** (gate runs, CI runs, anything timed)
```json
{"key":"…","at":"ISO","kind":"gate|build|test|ci|other","host":"local|ci","name":"ci-local",
 "repo":"my-app","branch":"…","sha":"…","seconds":412,"ok":true,
 "steps":{"configure":3,"build":300,"tests":100},"pr":12,"source":"gate-log|gh|build-times|manual"}
```
CI records also carry `"runId"`, `"workflow"`, `"event"`, `"conclusion"`, `"queuedSeconds"`, `"attempt"`
(the run attempt, 1 unless re-run) and, on failed runs, `"failedJobs"` (names of the jobs that failed). A
cancelled or skipped run has `"ok": null`.

**Gate run log format** (what a repo's gate script appends; the importer maps it to `timings.jsonl`)
```json
{"at":"ISO","name":"ci-local","worktree":"…","branch":"…","sha":"…","ok":true,"seconds":412,
 "flags":["--fast"],"steps":{"build":300,"tests":100}}
```

## Definitions

**Ticket flow** (from `moved` events; history starts when the tracker started recording it)
- **Stage dwell**: time from entering a column to leaving it. Stages: `todo` (waiting to start),
  `in-progress` (being built), `review` (waiting for your review). Open stays count up to now and
  are reported separately as "currently waiting".
- **Cycle time**: first move into `in-progress` → first move into `review` or `done` after it.
  **Lead time**: created → first `review`/`done`. **Review wait**: dwell in `review`.
- **Reopened**: moved from `review`/`done` back to `in-progress`/`todo`.
- **WIP**: tickets (not epics) in `in-progress` at each day's end; epics counted separately.
- **Forgotten epic**: an epic in `in-progress` whose own history and every child's history show no
  event for `forgottenEpicDays` days.
- **Forgotten epics** look at the epic and its children; **stale tickets** are the ticket-level
  version: a non-epic ticket in `in-progress` whose own history shows no event for
  `forgottenEpicDays` days (`staleTickets`: id, title, idleDays, lane, project, most idle first).
- **Bottleneck**: of the stages after work starts (`in-progress`, `review`), the one with the
  largest **median closed stay** per ticket over the window, per project, per lane and per area:
  the step a typical ticket waits longest in, so a few very long stays do not decide it. The total
  dwell stays in the output as `totalHours` (secondary) and `share`. If no stage has a closed stay
  yet, the largest total decides. `todo`
  is a queue, not a stage: it is reported as the wait before work starts and as backlog growth
  (tickets created vs closed per week; closed = first move into review, done or archive), never as the bottleneck.
- **Review** counts every card that waits in `review`, epics included: an epic's card is where its
  children's checks wait for you. Stays under a minute (automatic roll-through) are ignored.
- Epics are otherwise excluded from cycle/dwell numbers (they roll up); bookkeeping moves straight
  `todo → done` count as "closed without work" and are excluded from cycle time.

**Sessions** (main transcripts; helper transcripts under `<id>/subagents/` are only counted, except for cost, see Cost)
- **Wall**: first to last timestamped line. **Turn**: from a user prompt to the next
  `stop_hook_summary`. **Active**: sum of turn lengths. **Waiting on you**: from a turn's end to the
  next prompt that came from you (not a task notification or scheduled wake-up).
- **Question**: an `AskUserQuestion` tool call. **Mid-run question**: one asked after the first
  15 minutes of active time (the up-front approvals question is expected; mid-run ones stall).
- **Silence**: no line written for at least `stallMinutes` while a turn is open, classified by what
  was pending when it began: an `AskUserQuestion` with no result yet is a **question wait**
  (`questionWaits`, `questionWaitMin`; waiting on you, not a stall); any other tool call with no
  result yet is a **tool wait** (`toolWaits`, `toolWaitMin`, `toolWaitTools` counts per tool name: a
  long command or a permission prompt left open); nothing pending is either a **missed wake** (no assistant line since the prompt that opened the
  turn, or since the last tool result when a user line follows the gap: the session never answered it, so it was idle-stopped, queued or blocked; `missedWakes`,
  `missedWakeMin`, `missedWakeOrigins` by prompt origin `task-notification`, `peer`, `human`; also `tool-result` when a tool result was never answered before the next line) or, once the
  assistant has started the turn, a **stall** (`stalls`, `stallMin`: the model or API went silent).
- **Helper wait** (`helperWaits`, `helperWaitMin`): a silence, with nothing pending, in a turn that a
  task notification or peer message opened and that the assistant has not answered yet, ended by
  another notification or peer message. The session was waiting on a still-running subagent or
  background task, not stuck, so it is not a missed wake and is not in the stuck-session
  insight; it is reported as its own count. A silence ended by your prompt, or by an assistant
  line, is still a missed wake or a stall.
- **Reply wait**: one wait from a turn's end to your next prompt (`replyWaits`, minutes);
  `medianReplyMin` is their median. **Stop blocked**: a Stop hook prevented the turn from ending.
- **Ticket**: the id at the start of the session title (`PRO40 - …`), else in the branch name,
  else the first `/ship-task <id>`.
- **Autonomous session**: a session with no mid-run question, no tool wait, no stall and no missed wake.

**Cost** (`costs` in the payload; Cost section of the tab; `ch metrics cost`)
- **Unit**: US dollars at API list prices, computed from token usage, with tokens as secondary detail.
  It is the size of the work, comparable across tickets and models, not what a plan bills. Claude
  Code's own `cost-state` line is rare, so every session is computed from usage (`costStateUSD` is kept
  only to cross-check: on 2026-11-07, where the token counts agree the computed cost matches it per model to about 1.0; across 218 sessions the computed total was a median 0.88 of it, because some calls Claude Code counts are not in the transcript files, and a session resumed after its last `cost-state` line costs more than that line).
- **Prices**: `shared/model-prices.js` (list prices per million tokens: input, output, cache read; a
  5-minute cache write is 1.25x input, a 1-hour write 2x). Model ids drop a `[1m]` suffix and a
  `-YYYYMMDD` date. A model not in the table is not priced (never guessed); add it there.
- **Dedupe**: one API message is written as several transcript lines with the same `message.id`
  and usage, so each id is counted once.
- **Helpers included**: `costUSD` = main session + every helper transcript under
  `<id>/subagents/agent-*.jsonl` (`helperCostUSD`, `helperTokens`, `helperByModel`, `helperToolCalls`).
  Adding a helper file re-reads the session (the cache key covers the helper files).
- **Per-ticket attribution**: usage counts for the session's ticket, except in an epic run: a Bash
  call `ch tasks move <ID> in-progress` makes `<ID>` the current ticket, so usage after it (and each
  helper that starts after it) goes to that child (`byTicket`: cost, tokens, tool calls). Without such
  a call, the whole session is its ticket's. Older records without `byTicket` go whole to their ticket.
- **Epic cost**: the epic's own sessions plus every ticket under it (rolled up the `parentId` chain).
- **Per shipped ticket**: tickets now in review or done with any cost, by their `model:` label
  (`none` without one): median, p75 and total dollars per ticket.
- **Plan comparison**: with `planUSDPerMonth`, the window's cost scaled to 30 days and divided by it.

**Cost estimate** (`estimates` and `next[].estimate` in the payload; `ch metrics estimate`, `ch tasks next`, the Plan tab, the ticket panel; `shared/cost-estimate.js`). Pure statistics, no model calls, same unit as Cost.
- **Samples**: non-epic tickets now in review or done with cost above zero, costed over the last 90 days of
  sessions (not the report window), limited to `--project` when given. A ticket's own cost is left out of its estimate.
- **Groups and fallback**: a ticket is compared with samples sharing its model label (`none` without one),
  type, project and lane (own lane, else its epic's). The first group with at least 5 samples wins:
  label+type+project+lane, label+type+project, label+type, label, all shipped tickets. The estimate names the
  group (`basis`, e.g. `model:sonnet · task · agentsynth`) and its size (`n`).
- **Range**: `typicalUSD` is the median, `highUSD` the p75 ("~$4 (up to $9)"). With fewer than 5 samples overall
  there is no estimate (null, nothing printed).
- **Epic**: the sum of the estimates of its open tickets (not in review, done or archive), `n` = tickets estimated,
  plus `spentUSD` so far. The p75s are summed, so the upper end is generous.
- **Where**: `ch tasks next` (a "likely" range per ticket, nothing without session data),
  `ch metrics estimate [<id>] [--project P] [--json]` (group and n; an epic per open child and total; no id: the samples by
  label), Plan tab (estimated cost left per epic), ticket panel (likely cost for a ticket not started, cost so far
  after), Metrics tab Cost > Estimates. The panel and plan read `GET /api/metrics/ticket-cost?id=X` and
  `/api/metrics/estimates?ids=A,B`, lazily; no data shows nothing.

**Where in-progress time goes** (`flow.inProgressSplit` in the payload; "Where in-progress time went" in the Ticket flow section; the end of `ch metrics flow`; one line in `ch metrics cost <id>`; `shared/time-split.js`)
- **Stays**: every stay of a non-epic ticket in `in-progress` (open stays run to now), clipped to the window.
  Each is split into four categories, each a union of intervals clipped to the stay. A moment counts once,
  by precedence: **working** (a session turn is running for the ticket) > **waiting on CI** (a CI run for the
  ticket's branch is running) > **waiting on you** (a session for the ticket waits on your reply or on an
  `AskUserQuestion`) > **nothing running** (the rest). The four add up to the stay.
- **Session intervals** (`intervals` in `sessions.jsonl`, epoch-ms `[start, end, ticket]`): `work` is every open
  turn (prompt to turn end) minus the time an `AskUserQuestion` was pending; `waitUser` is a turn's end to your next
  prompt (the reply wait) plus those question waits. Each interval carries the ticket current then (same rule as
  per-ticket cost: a `ch tasks move <ID> in-progress` call switches it), same-ticket neighbours less than 60 s
  apart are merged and a session keeps at most about 300 per kind. The last turn's wait counts only once you reply.
  **Helpers**: while a helper (subagent) transcript is active the ticket is being worked on even when the main session
  sits between turns. Each helper's active spans (first to last line, cut at silences of `stallMinutes` or more, so a dead
  helper does not count) are added to `work`, tagged with the ticket current when the helper started.
- **CI intervals**: a CI record (`kind: ci`) belongs to the ticket named in its branch (`fix/fro1610-menus` is
  FRO1610, same rule as the session ticket from a branch) and covers `[at, at + seconds]`. Cancelled runs count:
  CI was running. Runs on `main` or on a branch with no ticket id belong to no ticket.
- **Typical ticket** (`typical`: `n`, `medianHours`, `shares`): the median of each ticket's share per category over
  tickets whose in-progress stay closed in the window (open stays excluded, like the bottleneck's median closed stay),
  so tickets forgotten in progress do not decide it. The insight and the dashboard lead with it; `total` is secondary
  and is inflated by forgotten tickets (they also show as stale tickets). Medians per category need not add up to 100%.
- **Output**: `typical`, `total` (hours, `workingH`, `ciH`, `youH`, `idleH`, `shares`), `byTicket` (the 20 with the most
  nothing-running hours), `byProject`, `byArea`, `sessionsWithIntervals`. Without sessions or CI collected everything
  reads as nothing running, so the insight is skipped then and the tab says so.
- **Limits**: a ticket worked in a session that is not titled, branched or `/ship-task`ed with its id has no
  working time; records collected before this field need `ch metrics collect --sessions` again.

**CI**: run seconds = `updatedAt − startedAt`, queue = `startedAt − createdAt`. **Red time** for a
PR branch: from the first failed run to the next successful run on that branch.
- **Cancelled run**: conclusion `cancelled` or `skipped` (usually a newer push replaced it). Neither a
  pass nor a failure: excluded from fail rate, red time and duration trends, and counted as
  `cancelled` next to the run count. Fail rate = failed / finished (non-cancelled) runs.
- **Flaky rerun** (`flakyReruns`): a run with attempt above 1 that ended in success, i.e. it passed
  on a rerun. Counted per repo/workflow and named in the CI fail-rate insight.
- **Failed jobs**: for failed runs only, `collect --ci` records the names of the failed jobs
  (`gh run view <id> --json jobs`). It reuses what is already stored and fetches at most 100 runs
  per collect (newest first), so a first collect over a long history fills in over several runs.
  The report lists the most failing jobs per repo/workflow (`topFailedJobs`: name, count).

**Trends** compare the median of the last 7 days with the 7 before ("gate +18%").

## Next-ticket picker

Ready = in `todo`, every `blockedBy` done or in review, not a gate (`Co-task:`, `Design:` or
`design` label), parent epic not done. Ranked by: parent epic already in progress, the epic's
position in its lane (first epic in a lane first), priority (`urgent` > `high` > `medium` > `low`),
due date, age. Read-only: it suggests, it never starts or moves anything.

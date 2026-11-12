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
ch tasks sweep-idle [--hours 24] [--dry-run] [--no-collect] [--json]      in-progress tickets with no session work for N hours go back to todo
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
  "planUSDPerMonth": null
}
```

`planUSDPerMonth` (a number, or `null` / absent until you set it) is what you pay a month for a plan; with it the Cost
section and the report show the window's API-priced cost scaled to 30 days and its multiple of the plan. The value is
yours to set (no default is guessed); without it the card reads "set planUSDPerMonth in config.json".

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

`ch metrics collect --ci` also stores one **pr record** per pull request of each configured repo
(`gh pr list --state all`, newest 300), used only to end red time:
```json
{"key":"gh-pr:my-app:12","kind":"pr","repo":"my-app","branch":"fix/x","pr":12,"state":"MERGED",
 "mergedAt":"ISO|null","closedAt":"ISO|null","at":"mergedAt or closedAt, null while open","source":"gh"}
```
pr records have no `seconds`: they never show in timing series, trends, fail rates or the gate/build/CI source counts.

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
- **Reading a column on the Metrics tab**: the big number is the **median** stay (the typical wait). The meta line
  `3 in 4 leave within 4.7 d · 658 visits, 766 wk added up` reads: the p75 (a quarter of the tickets wait longer),
  the number of **visits** (one visit is one stay in the column; a ticket that comes back counts again) and the
  **added up** time of all visits, open stays and forgotten tickets included, so it can be far larger than the
  median. Added-up times of 3 weeks or more show in weeks (`wk`). The hover text and a one-line legend under the bar say the same.
- **Cycle time**: first move into `in-progress` → first move into `review` or `done` after it.
  **Lead time**: created → first `review`/`done`. **Review wait** (`flow.reviewWait.epics` / `.tickets`): dwell in `review`,
  shown on the tab for epic cards (median, p90, waiting now, oldest). **Ready to first look** (`flow.reviewWait.readyToReviewed`):
  from a move into `review` to the card's next move or its first review note, whichever is first, bucketed.
- **Reopened**: moved from `review`/`done` back to `in-progress`/`todo` (`counts.reopenedMoves`), plus a fix ticket created in the
  window within 14 days of a shipped ticket (it names the ticket by `reviewOf`, a non-epic `parentId`, or `link`/`links`:
  `counts.reopenedFixes`). `counts.reopened` is the sum; `flow.reopenedByLabel` splits it by the shipped ticket's `model:` label.
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
  Cost is counted by the hour it was spent: a session that began before the window counts the part spent
  inside it, and a long session that began inside counts only what fell in the window (`costByHour` on each
  record; an hour is weighted by how much of it lies in the window). Per-ticket, per-epic and per-shipped rows
  still follow the session's start time. Records written before `costByHour` count whole by start time.
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
- **Cost by part** (`costs.total.byPart`, first line under the header of `ch metrics cost`): dollars and
  share of cache reads, cache writes, output and input, each split main thread vs helpers. Each API
  message is priced by part with the same `shared/model-prices.js` rules as `costUSD` (cache write
  5m/1h rates, long-prompt multiplier), so the parts sum to the total; sessions store them as `parts` and
  `helperParts`. Records from before the split are priced from their per-model totals (close, not exact).
- **Main-thread context per call** (`costs.total.context`: `median`, `p90`, `calls`, `sessionsWithout`;
  second line of `ch metrics cost`): context = input + cache read + cache write tokens of one main-thread
  API message (deduped by message id). Sessions store `ctxCalls`, `ctxMedian`, `ctxP90` and `ctxHist`
  (calls per 5,000-token bucket, last bucket open-ended); the window median and p90 come from the merged
  histograms, so they are accurate to about one bucket. Sessions collected before this existed are
  skipped for this line (`sessionsWithout`); `ch metrics collect --sessions` re-reads them.
- **Per shipped ticket**: tickets now in review, done or archived with any cost in the window, by their `model:` label
  (`none` without one): median, p75 and total dollars per ticket. `perShippedCoverage` is `{withCost, shipped}`: of the tickets whose first move into
  review/done/archive falls in the window, how many have cost (the card shows "n of N"); `perClosedEpic` is the same for epics in review/done/archive (own sessions plus everything under them).
- **One cost total**: `sessions.summary.costUSD` and `costSessions` come from the same in-window list as `costs.total`
  (cost counted by when it was spent), so the Sessions line and the Cost cards agree; `sessions.summary.n` counts sessions that started in the window.
- **Plan comparison**: with `planUSDPerMonth`, the window's cost scaled to 30 days and divided by it.
- **Limit hits** (`limitHits` per session; `costs.limits` in the payload; `shared/limit-hits.js`, `shared/plan-share.js`):
  an assistant line with `isApiErrorMessage` whose text says `You've hit your session|weekly limit · resets
  …` is a usage-limit hit (`kind`, `at`, `resetsAt`, `lostMin`). `resetsAt` is read from the text with Intl
  only (`resets 12:40pm (Zone)` = the next such time after the hit; `resets Sep 22 at 2pm (Zone)` = that
  date), null when it does not parse. Repeated hit lines with no real assistant line between them are one
  hit (you retrying). `lostMin` runs from the hit to the next real assistant line, cut at `resetsAt`; with no
  later line, to `resetsAt`; null when neither is known. "Credit balance is too low" and other API errors
  are not limit hits (an API-key session, not a subscription). `costs.limits` = `{sessionHits, weeklyHits,
  lostHours, weekUSD, sessionWindowUSD, nWeekly, nSession}`: hits and lost hours inside the window,
  deduped across sessions (parallel sessions share a limit) by `resetsAt`, or by `at` within 1 hour.
- **Week calibration** (`weekUSD`, `sessionWindowUSD`; `weekShare` on `byTicket` and `byEpic` rows, "% wk"
  in the table, `ch metrics cost`): for each distinct weekly hit, the API-price cost of every session in the
  data (all projects, not only the filtered one) that started in the 7 days before it; the median over hits
  is `weekUSD`, and the same over the 5 hours before a session hit is `sessionWindowUSD`. `n` is the hits
  used; with no weekly hit there is no `weekUSD` and no `weekShare` ("not calibrated yet"). It is an
  estimate: computed cost is about 0.88 of what Claude Code counts (see Unit), the reset window starts at
  first use and is not known exactly, sessions are attributed whole by their start time, and the data may
  hold less than a full period before the first hit. Read it as a rough size of a week, not a quota.
- **Stop causes** (`missedWakeCauses` per session, summed in `sessions.summary`): each missed wake that
  stopped right after a tool finished (`tool-result` origin) is classified by lines within 2 minutes of the
  silence: `usage-limit` (a limit hit line), `api-error` (API Error text, credit balance, a system
  `api_error`), `app-closed` (the assistant text `No response requested.`, written when a closed or
  crashed app's session is resumed; such a line right after the silence is a missed wake, not a stall),
  `interrupt` (`[Request interrupted by user…`), else `unknown`; first match in that order. A script can record
  causes it saw outside the transcript in `$CH_HOME/stop-causes.jsonl` (one JSON object per line: `sessionId`, `at`
  (ISO UTC of the stop), `cause` (`idle-sweep`, `app-quit`, `app-update`, `rate-limit`, `network`, `keypress`,
  `mac-sleep` or `unknown`), `evidence`, `recordedAt`); an entry for the session whose `at` is within the gap ±2 min
  and whose cause is not `unknown` counts with that cause, right after `usage-limit` in the order (a missing file changes nothing). `unknown` is
  mostly a session idle after a tool result until a notification, peer message or your prompt woke it.
  Not a missed wake: when the silence ends with another tool result (a parallel or background tool that was
  still running) it is a tool wait (`toolWaits`, tool name `tool` when its call was never seen pending).
  The stuck-session insight names the causes.

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
- **Recorded at start** (PRO60): `ch tasks move <id> in-progress` stores `estimateAtStart` `{median, p75, n, group}` on that
  `moved` history event (tickets only, none without an estimate). Moves made in the dashboard do not record it. A later
  forward check compares it with the real cost, so it is not changed by new samples.
- **Accuracy** (`ch metrics estimate --accuracy [--project P] [--json]`, `accuracyReport` in `shared/cost-estimate.js`):
  a leave-one-out backtest, each shipped ticket estimated without itself against what it really cost. Per model label and
  overall: tickets, share at or under the high end (p75), median actual/typical, median miss in dollars, and a verdict.
  **Close** = at least 70% at or under the high end and median actual/typical between 0.7 and 1.4; above 1.4 the estimates run
  low, below 0.7 high; a label needs 8 tickets to be judged. The Metrics tab's Cost per ticket column is the actual cost.
- **Backtest 2026-11-12** (65 tickets, 90 days): overall 77% at or under the high end, actual/typical 0.86x, close. Sonnet
  (48): 79%, 0.84x, close (estimates run a little high). Opus (15): 67%, 1.0x: typical is right, the high end is slightly too
  tight. Haiku (2): too few. No retune: the bar is met overall; revisit opus's p75 once more opus tickets ship.

**Where in-progress time goes** (`flow.inProgressSplit` in the payload; "Where in-progress time went" in the Ticket flow section; the end of `ch metrics flow`; one line in `ch metrics cost <id>`; `shared/time-split.js`)
- **Stays**: every stay of a non-epic ticket in `in-progress` (open stays run to now), clipped to the window.
  Each is split into four categories, each a union of intervals clipped to the stay. A moment counts once,
  by precedence: **working** (a session turn is running for the ticket) > **waiting on CI** (a CI run for the
  ticket's branch is running) > **waiting on you** (a session for the ticket waits on your reply or on an
  `AskUserQuestion`) > **nobody working on it** (the rest; it can read high when a session does not name its ticket, since only sessions titled, branched or `/ship-task`ed with the ticket id are matched). The four add up to the stay.
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
- **Average ticket** (`typical`: `n`, `medianHours`, `shares`): the average of each ticket's share per category over
  tickets whose in-progress stay closed in the window (open stays excluded, like the bottleneck's median closed stay).
  Averages of shares add up to 100% (per-category medians would not). **All in-progress hours** (`total`): every hour of
  every counted stay added up, so long stays weigh more.
- **Forgotten stays** (`forgotten`: `n`, `hours`, `tickets`): a stay longer than 72 h in which a session worked on the ticket
  for under 2% of it. They are listed apart (ticket, hours) and left out of `typical`, `total`, `byTicket`, the project and
  area groups, and (through `skipStays`) of the in-progress numbers of `flowMetrics`: stage total, bottleneck share and the
  review-vs-build comparison. `forgottenStays` carries the `ticket|from` keys for that.
- **Batch runs**: the auto dispatcher starts one session per epic with a list of tickets (`autorun EPIC ID ID`, prompt
  `/ship-task EPIC auto ID ID`) and those tickets sit in progress from the start. Session records keep that list as `batch`
  (older records: parsed from the title); an interval tagged with any id in the batch counts as working time for every id in it.
- **Output**: `typical` (the average ticket), `total` (all in-progress hours), `forgotten`, `forgottenStays`; `total` is (hours, `workingH`, `ciH`, `youH`, `idleH`, `shares`), `byTicket` (the 20 with the most
  nobody-working-on-it hours), `byProject`, `byArea`, `sessionsWithIntervals`. Without sessions or CI collected everything
  reads as nobody working on it, so the insight is skipped then and the tab says so.
- **Limits**: a ticket worked in a session that is not titled, branched or `/ship-task`ed with its id has no
  working time; records collected before this field need `ch metrics collect --sessions` again.

**CI**: run seconds = `updatedAt − startedAt`, queue = `startedAt − createdAt`. **Red time** for a
PR branch: from the first failed run to the next successful run on that branch. If the branch's PR
merged or closed first (the latest pr record for that repo and branch that closed after the first failure), the span
ends there instead (`endedBy: merged|closed`, not open), so a merged branch is never "red now". No pr record: unchanged.
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

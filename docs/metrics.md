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
  "forgottenEpicDays": 3
}
```

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
 "helpers":4,"prs":["owner/repo#12"],"branch":"pro40-dev-metrics","costUSD":12.3}
```

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

**Sessions** (main transcripts; helper transcripts under `<id>/subagents/` are only counted)
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

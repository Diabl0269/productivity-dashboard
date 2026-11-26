# ch — Productivity CLI

A zero-dependency Node.js CLI for managing tasks and memory files in your productivity dashboard.

## Install

```sh
cd cli
npm link
```

After linking, `ch` is available globally. Alternatively, run `./ch` from the repo root without linking.

**Node version:** the `ch` bin shebang is `#!/usr/bin/env node`, so it runs under whatever `node` your PATH resolves first — this can silently be a stale nvm version. Known-good: v20.19+ or v22+; v16, v18, and v20.17.0-and-below fail deep inside command modules with cryptic errors (`fetch is not defined`, CJS/ESM named-export errors). `cli/index.js` guards against this itself: on startup it checks `process.version` and, if too old, re-execs under the newest qualifying Node found under `~/.nvm/versions/node` — falling back to a clear error message if none qualifies. No action needed unless you see that error, in which case install a qualifying Node via nvm.

## Command Groups

### `ch tasks` — task management

| Command | Description |
|---------|-------------|
| `ch tasks list [--section S] [--priority P] [--active] [--json]` | List tasks; `--active` skips done/archive and fully-checked |
| `ch tasks get <id> [--json]` | Show a single task (due, estimate, assignee, labels, links, deps, history) |
| `ch tasks capture "<title>"` | Shorthand add into **inbox** |
| `ch tasks plan [--pin T1] [--unpin T1] [--carry] [--json]` | Today plan pins in `meta.dailyPlan`. Automatic too: an open epic given a lane (`add --type epic --lane`, `update --lane`) is pinned, and an epic is unpinned when it or its last open child closes (done, review or archive) |
| `ch tasks runplan [--json]` | Plan: Ready state of every epic, then in-progress, Ready and pinned epics that can be launched now, grouped into parallel lanes (set an epic's lane with `--lane`), each split into now and after-your-picks; `Co-task:` tickets are the picks. Same view as the dashboard Plan tab |
| `ch tasks stale [--days 30] [--json]` | Open tickets untouched for N days (newest of created, updated, history, notes, decisions), oldest first, with age and epic |
| `ch tasks add "<title>" [flags…]` | Create a task; prints new id. Flags: `--section`, `--priority`, `--description`, `--color`, `--type`, `--parent`, `--due YYYY-MM-DD`, `--issue URL`, `--project slug` (required unless `--no-project`, or inherited from `--parent`/`--review-of`), `--energy deep\|shallow\|errands\|creative`, `--lane slug` (required with `--type epic`), `--snooze YYYY-MM-DD`, `--decision "…"`, `--estimate 2h\|30m\|1d`, `--assignee name`, `--blocked`, `--waiting-on "…"`, `--label L` (repeatable), `--link URL`, `--link-label`, `--blocked-by T1`, `--review-of T1` |
| `ch tasks review <id> --shipped "…" [--left "…"] [--tests "…"] [--ci "…"] (--check "…"… [--check-project N=<path>]… [--check-video N=<path>]… [--check-no-video N=<reason>]… [--check-no-project N=<reason>]… [--check-audio N=<path>]… [--check-image N=<path>]… [--check-link N=<url>]… [--check-verify N=<note>]… \| --no-checks "<reason>") [--result-json '<json>'] [--file-left] [--clear-unverified] [--resolve-unverified N] [--force] [--allow-check-owner] [--allow-parked "<why>"] [--held-pr "<why>" --try-steps "<steps>" [--build-app <branch .app>]] [--ask "…" --ask-details "…"]… [--ask-by YYYY-MM-DD] [--same-judgement \| --not-same "<why>"] [--add-link URL [--link-label "…"]]` |Ship a ticket to **Ready for review**: records the result and the checks to tick, marks it checked and moves it (details below). Every `--check` must carry a project (`--check-project N=<path>`) or a reason there is none (`--check-no-project N=<reason>`, 3-200 chars, not both); a check with neither is refused by number (`--force "<why>"` overrides, `--no-checks` is exempt). (PRO100.) The Plan page shows each check's Open project button, the exact app build it opens in and whether that build has the change. Fixture tests of this repo set `CH_NO_CHECK_PROJECT_GATE=1` to skip the gate; sessions use `--force` instead. Dies without any check (from `--check`, `--result-json` or already on the ticket) unless `--no-checks "<reason>"` explains why there is nothing to look at (stored as `noChecksReason`); also refuses unchecked subtasks unless `--force`; refuses a ticket with an open pull request (a link labelled `PR #n` or a github.com `/pull/n` URL, on the ticket or given with `--add-link`; state read with `gh pr view`) unless `--held-pr "<why>"` says it is held open on purpose; `--held-pr` also requires `--try-steps "<exact steps and what Tal should see>"` (AGE162: at least 40 characters, not the old "say merge or not"; `--try-steps` alone is refused; the steps go through the same Tal-owned-check gate, so "run the eval" is refused). It adds the check `Try on branch <headRefName>: <steps>` (it takes the first project / video / audio, or the noProject / noVideo reasons, of the call's other checks, else of the ticket's own, so the Plan page shows Open project in that branch's build and Play video on it too; FRO1979; with no project at all the check still gets an Open project button that opens that branch's build with no project, `POST /api/open-project` accepting `{ branch }` or `{ pr }` without `path`, and the button goes when the PR merges; AGE162), records `heldPr` on the ticket and puts `heldPr: { pr, branch }` on every check of that call (own, taste and the generic one; the epic's copy keeps it), so the Plan page shows `on branch X (PR #n), not merged` beside each until the PR merges (merged PRs pass, closed-unmerged ones refuse, gh missing or offline only warns); refuses checks a session should verify itself (CI/PR green, running a command or test suite, opening older/saved projects, regressions, VoiceOver): put those in `--tests`, or pass `--allow-check-owner`; refuses a review that would leave the ticket's open epic with only backlog tickets open (it could never start): move the backlog tickets to a "(later)" epic or to todo, or pass `--allow-parked "<why>"`; `--clear-unverified` / `--resolve-unverified N` drop result `unverified` lines (also on `update`). `--file-left` files each `left` / `unverified` line as a follow-up ticket under the same epic, linked with `--review-of` and listed in the result's `opened`. A `--unverified "needs-tal: taste: <what to judge> \| video=<path> project=<path> audio=<path>"` line becomes a check (paths under `$CH_HOME/evidence`, folded into an existing check on the same project of this call, the ticket or its epic) and leaves the result; one without media is refused (a taste question is a check, never an ask); with no project hit, a taste line folds into a check that says the same judgement. One judgement shows once (PRO90): a new check that repeats an open question on the ticket or its epic, or an `--ask` that repeats a check of the call, is refused unless `--same-judgement` links them (the question stores `checkRefs`) or `--not-same "<why>"` says they differ |
| `ch tasks ask <id> "<question>" [--option "A: ..."]... [--recommend A] --details "<60+ chars>" [--video\|--audio\|--image\|--project <path>] [--board <claude.ai artifact url>] [--link <url>] [--same-as <id>] [--ask-by YYYY-MM-DD] [--merge-pr URL] [--same-judgement \| --not-same "<why>"] [--link-check <ticket>:<n>]... [--tag marketing\|design\|merge\|taste\|account] [--json]` | Leave a decision for Tal (PRO86). Every card carries a tag (AGE220): an area (Marketing, Design, Merge, Taste, Account step) worked out from the ticket (project marketing or lane marketing / brand, a `design` label or a `--board` link, `--merge-pr`, a Co-task ticket, a taste check) and what it asks of you (Watch for a video, Listen for audio, Read for a picture or board, Pick when it has options, Sign in for an account step); `--tag <area>` overrides the area. The Plan page shows the tag on each For you card and filter chips with counts above the list (kept per browser). One judgement shows once (PRO90): a question that repeats an unticked check on the ticket or its epic (same words by `shared/ask-check-overlap.js`, or a merge ask for the PR a `heldPr` check is about) is refused, listing each as `<ticket> check <n>: <text>`; `--same-judgement` stores `checkRefs: [{id, text}]` (the check hides on the Plan page while the question is open and ticks itself, with the note `answered on question <n>: <answer>`, when it is answered or done; dismiss and park do not tick), `--not-same "<why>"` stores `notSame` and goes ahead. `--same-judgement` with no detected match is refused (it lists the open checks); `--link-check <ticket>:<n>` (repeatable; n as `ch tasks get` numbers the check on that ticket or its epic) links an unticked check whatever its wording and also counts as linked for the merge-ask exemption. The question is at most 140 characters (longer is refused; put the rest in `--details`). `--details` is required, at least 60 characters (PRO91): which screen or card it is about, what to try, and why the choice matters. A question (or option) about something seen or heard (sound, hear, listen, look, see, feel, colour, visual, loud, mix), or any question on a `ui` / `audio` ticket (its epic's labels count), also needs the thing to judge: `--video`, `--audio`, `--image`, `--project` or `--board` (a claude.ai artifact link to the design board; it is a URL, not a path under evidence). A question about a design (the ticket or its epic is labelled `ui`, or the question, an option or `--details` names layout, look, board, design or colour) must also carry the link to the board or artifact it is about (FRO2118): `--board`, `--link <url>` (added to the details as `Link: <url>`) or any URL in `--details`; a project, video or image alone is refused with a message to add the board link. A merge ask linked to its check card (`--same-judgement`) is exempt from both. Older stored asks stay valid; a question starting `taste:` is refused (taste is a check, see `review`). Stored on the ticket as `asks[]` (`{n, at, text, options?: [{key, text}], recommend?, details?, media?: {video?, audio?, image?, project?}, sameAs?, by?, mergePr?, state, answer?, resolvedAt?}`, media paths relative to `$CH_HOME/evidence` and checked on disk) and sets `waitingOn` to `Tal: <question>`. Listed in the Plan page's **For you** list (and the Overview widget, tab title and favicon count) while the ticket or its epic is open. `--same-as` shows it as one card with another ticket's ask. `--merge-pr` makes it a merge ask that closes itself once that PR merges (`asks --refresh`, or the page through `GET /api/pr-state`, both via `gh`; skipped silently without it). `review --ask "…" --ask-details "…"` (repeatable, paired by position; optional `--ask-by`) adds asks the same way and follows the same rules (it has no media flags: a seen / heard question goes through `ch tasks ask`) |
| `ch tasks answer <id> [<key>] <A\|B\|"reply"> [--done \| --dismiss \| --park ["reason"]] [--reopen] [--json]` | `--reopen` (PRO107, `answer <id> <key> --reopen`) puts a dismissed or answered own question back to open (answer, `resolvedAt` and `filedAs` cleared, waitingOn set to Tal again) and prints whether Claude already acted on it; it restores the question only (the note, decision or follow-up the old answer made stay), is refused when the follow-up ticket filed from it has started (not in todo), and cannot reopen an older `resolvedAsks[]` line. The Plan page task detail has a Reopen button on its resolved-questions fold. | Resolve an ask and every ask on the same card (same question on other tickets). Keys come from `ch tasks asks`: the ask's number, `L<i>` for an older ticket's Left line that ends in `?` or says `Merge it`, `W` for a ticket whose `waitingOn` names Tal; the key may be left out when the ticket has one. An option letter records that option. The answer drives the work: a decision on the ticket (`Tal <date>: asked "<q>": <reply>`) and `waitingOn` cleared; on a done or archived ticket a review note filed at once as a follow-up ticket (`notes send` path) instead; `--park` (or a reply starting `park`) records the reason and moves the ticket to backlog; `--dismiss` closes it without a decision. Older lines are never rewritten: resolving one records it in `resolvedAsks[]` |
| `ch tasks interpret <id> "<reading>" [--json]` | Record how a run read a vague ticket (PRO96): adds an `Interpretation: <reading>` line to the description (once). The Plan page's **For you** list shows it as a card with **OK** (resolves silently) and **Not this** + text (a review note on the ticket, the newest, so `ch tasks get` shows it and the next session builds to it). Never blocks: no ask, no `waitingOn`, the ticket stays runnable. Resolution is stored in `resolvedAsks[]` (`kind: interpretation`); parsing and rules: `shared/interpretations.js` |
| `ch tasks asks [--ticket ID] [--tag <area>] [--refresh] [--json]` | Every decision on open work, one card per question, oldest first (asks with an `--ask-by` date first, soonest first), with keys, options and media; the CLI twin of the For you list. needs-tal Unverified lines are never asks. `--refresh` first closes merge asks whose PR merged (own `--merge-pr` asks and older `Merge it` lines on a ticket that links a PR) and drops the `heldPr` branch label from checks whose PR merged (prints `cleared branch label on <id> (<url> merged)`). `review` and `done` print `N asks for Tal are on the Plan page` when N > 0 |
| `ch tasks move <id> <section> [--force]` | Move task (records `history` event). Moving to done refuses a ticket with unchecked subtasks (lists them) unless `--force` |
| `ch tasks done <id> [--force]` | Mark checked and move to done. Refuses unchecked subtasks unless `--force`; split them off with `update <id> --promote-subtask N`. Also refuses a ticket in review with unticked checks or unsent notes, and an epic with unticked checks (Tal reviews those; sessions stop at `ch tasks review`) unless `--force` (same for `move … done`). Closing the last open child of an epic (also `move … done`, `update --parent`/`--clear-parent` moving it out, or ticking its last check) closes the epic too (a "later"/"future" epic emptied by `update --parent`/`--clear-parent` closes to Done even with no result): to Ready for review when it has a result or checks, else to Done (`(epic X now in review)`; `--json` adds `epicMoved`) |
| `ch tasks update <id> [flags…]` | Update fields — see below |
| `ch tasks set-priority <id> <low\|medium\|high>` | Change priority (records history) |
| `ch tasks pages [--project <slug>] [--stale] [--json]` | Every box of a project's Home map with its handbook page: has a page, `STALE` (commits touched its `covers` after its `updated` day), `MISSING` (page set, file absent) or no page set. `--stale` keeps only the stale ones; `--json` prints `{ project, pages: [{ box, name, level, parent, page, state, count, newest, capped, notices }] }`. Read-only. Page format: `docs/home-page.md`. |
| `ch tasks ready [--json] [--auto] [--check-picks]` | (FRO2329) Also prints "Pick without board:" with `<id> <title>` for every open (todo/in-progress) `design` ticket titled `Co-task: pick ...` that has no `claude.ai/artifact` link; `--json` adds a `pickWithoutBoard` array; `--check-picks` prints only that list and exits 1 if any. (AGE219) A held PR whose `--try-steps` say there is nothing to see or hear files no "Try on branch" check: `review` refuses it and points at `ch tasks ask --merge-pr`, and the Plan page shows no Open project button on such a check. Every open epic as Ready or Not ready with the reasons (in backlog, a later bucket, a pick or co-task open, a child missing How to check it, blocked, or parked: `waits on T7 in backlog` when its only open tickets are in backlog), and whether Auto is on. The Plan page's lane cards use the same rule: a Not-ready epic shows a "Not ready" card with these reasons, never "Ready now". An epic runs by itself only when it is Ready and has the `auto` label (`ch tasks update <epic> --add-label auto`). `--json` prints `{ epics: [{ id, title, section, lane, ready, reasons, parked, auto, priority, autoRank, model, children: [{ id, title, section, runnable, why, model, needsComputerUse (the `computer-use` label, How to check it wording, or a decision saying it waits for a run Tal starts), blockedBy }] }] }`; `--auto` keeps only Ready + Auto epics. Auto epics are listed in start order: `priority` (`high`, `normal`, `low`; missing = `normal`), then `autoRank` (lower first; missing = after ranked ones), then plan order |
| `ch tasks next-start [--json] [--live A,B] [--manual-busy N] [--now <iso>]` | Which Ready Auto epic the autorun dispatcher starts next and when, or why none (read-only). One line: `Next start: E2 (title) at today 14:30`, `... waits until the weekly usage limit resets, then starts at the next check, about Tue 11:10`, `... starts when a run slot frees`, or `Next start: none, <reason>` (autorun paused, no epic Ready with Auto on, review cap, lane busy, app-build cap, no ticket an automatic run can take). Mirrors the dispatcher's gates (`shared/next-start.js`): only epics Ready by `readinessIn` start, in Auto queue order, one per lane, within `maxRuns`/`maxTotal` (autorun.json) and the machine cap (`DEFAULT_MACHINE_CAP` app builds); a live usage-limit hit or the weekly pace stop holds the start until the reset. Live runs, last tick and tick interval come from the dispatcher's `tick.json` (`$AUTORUN_STATE_DIR`, default `~/.local/share/agentsynth-autorun`); `--live`, `--manual-busy` and `--now` override them. `--json` prints `{ next: { epic, title, lane, children, model, atMs, atKind: tick\|reset\|slot, waitsFor } \| null, reason, line }`. The Plan page shows the same line (`GET /api/next-start`) |
| `ch tasks plan --cleanup-pins [--dry-run]` | A pin means this week's focus. Unpins every pinned epic that is not in-progress and was not pinned by hand with `plan --pin` (hand pins are kept in `meta.dailyPlan.handPinnedIds`; task history records no pins). An epic pins itself only when it moves to in-progress |
| `ch tasks sweep-idle [--hours 24] [--dry-run] [--no-collect] [--json]` | Move in-progress tickets (epics skipped) with no session work for N hours back to todo, with a decision saying why. A real run first reads the Claude Code sessions (`--no-collect` skips that); `--dry-run` changes and collects nothing; refuses when no session data exists. Batch runs (`autorun EPIC ID ID`) keep every ticket in their batch alive while the session runs. For a dispatcher tick |
| `ch tasks next-id` | Print the next available task id (T\<n\>) |
| `ch tasks dump [--active]` | Compact JSON dump (includes dueDate, estimate, assignee, labels, links, blockedBy) |
| `ch tasks export [--md]` | Export tasks as markdown (reads dashboard parser) |
| `ch tasks checks [--json] [--lint] [--turnkey]` | Unticked, not handed-off, unverified checks on open epics and in-progress/review tickets, as `<id>#<n> <text>`. `--lint` (AGE214) lists every open check that says "the board" while its ticket and epic have no board link (url with `claude.ai/artifact`, or a label starting `Design canvas`); `--turnkey` (AGE215) lists every open check that fails the turnkey rules (project/audio on AI tickets, clip or still or reason, verified or taste). Both print `<id>#<n> <problem>` lines and exit 1 when any. `review` and `update --add-check` refuse a check that mentions "the board" unless a board link exists (`--design-link <artifact url>` or `--add-link <url> --link-label "Design canvas"`), and refuse it when a ticket note or decision (dated after the board link) already says `commented`, `answered` or `picked`: put the answer in `--decision` and drop the check (a small wording heuristic, shared/board-check.js) |
| `ch tasks lint [--fix]` | Validate tasks.json; `--fix` deduplicates ids / normalizes legacy fields. Warns about open epics without a lane or model label, and about an open (todo/in-progress) epic whose only open tickets are in backlog (it can never start: move them to todo or to a "(later)" epic), and about an open "later"/"future" epic with nothing open under it (`ch tasks done <id>`), and about tickets that wait on each other in a loop through their epics (`Not ready: loop T1 -> T2 -> T3 -> T1`; `ch tasks ready` shows it as the epic's reason, and the tickets in it are not runnable) |
| `ch tasks archive-done` | Move done tasks older than 7 days to archive |
| `ch tasks backup` / `backups` / `restore <name>` | Timestamped snapshots of the whole document in `.backup/tasks/` (always one assembled `tasks-<ts>.json`, whichever layout is on disk) |
| Note images | Files live in `<CH_HOME>/attachments/<id>/<hash>.<ext>` (outside git). They are **not** part of `ch tasks backup`; copy the whole data folder when you back up. Removing a note leaves its files on disk |
| `ch tasks split` | Move a big `tasks.json` into `tasks.d/` (one file per ticket); backs up first, verifies counts and contents, then moves the original into `.backup/tasks/` |

**`ch tasks update` flags:** `--title`, `--description`, `--add-description`, `--priority`, `--type`, `--parent` / `--clear-parent`, `--color` / `--clear-color`, `--due` / `--clear-due`, `--auto-priority high|normal|low` / `--auto-rank N` / `--clear-auto-rank` (epics only: where the epic starts among Auto epics; stored as `autoPriority` / `autoRank`, separate from the ticket `--priority`), `--lane slug` / `--clear-lane` (an open epic can't be left without a lane; `ch tasks lint` warns about older ones), `--estimate` / `--clear-estimate`, `--assignee` / `--clear-assignee`, `--blocked` / `--unblocked`, `--waiting-on` / `--clear-waiting-on`, `--add-label` / `--remove-label` / `--clear-labels`, `--add-link` / `--link-label` / `--remove-link N` / `--clear-links`, `--add-blocked-by` / `--remove-blocked-by` / `--clear-blocked-by`, `--add-note` / `--remove-note N` / `--clear-notes`, `--edit-note N --note-text "..."` (keeps the date and images, marks the note edited), `--note-image <file>` (repeatable, with `--add-note` or `--edit-note`: png/jpg/webp/gif, max 8 MB, copied to `<CH_HOME>/attachments/<id>/`; `ch tasks get` prints an `image: <absolute path>` line per image so a session can open it), `--decision` / `--remove-decision N` / `--clear-decisions` (review notes take images too: `ch tasks notes add <id> "text" --image <file>`, repeatable, text optional with an image; File review copies them onto the filed ticket as a note; the Plan's note box accepts paste or an **Image** button), `--remove-time-entry N` / `--clear-time-entries`, subtask flags, `--add-check "text"` (repeatable) / `--check-check N` / `--uncheck-check N` / `--remove-check N` / `--clear-checks` / `--check-all-checks` / `--review-of T1` / `--clear-review-of` / `--clear-result` / `--clear-unverified` / `--resolve-unverified N` (the per-ticket **checks** tick-list: separate from subtasks, never blocks marking a ticket done; `ch tasks get` shows `Checks (n/m)`), `--uncheck`, `--promote-subtask N` (subtask N becomes its own task in `todo`: same project, labels and priority, description "Split from <id>", parent = `--parent EPIC` / `--promote-parent EPIC` or the ticket's epic; with `--promote-subtask`, `--parent` names the new task's parent and does not re-parent the ticket; prints/`--json` returns the new id), `--force` (finish by ticking the last check despite open subtasks). The dashboard has no separate HTTP API for tasks (it saves the whole file), so the shared function `promoteSubtask` / `splitSubtask` in `shared/subtasks.js` is the API: the subtask row's **Make task** button calls it.

Valid sections: `inbox`, `backlog`, `todo`, `in-progress`, `review`, `done`, `archive`.  

**Ready for review** (section `review`, between In progress and Done): where shipped work waits for your own look. `ch tasks review <id>` records a `result` (`shipped[]`, optional `left[]` and `tests[]`, `ci`, default "all passed", and optional `unverified[]` (major things not checked for real), `risks[]`, `fixed[]` (fixed on the way) and `opened[]` (tickets opened) via `--unverified`, `--risk`, `--fixed`, `--opened`; judgment calls go on the ticket as `--decision`; `--shipped`, `--left`, `--tests` are repeatable, or pass `--result-json '{"shipped":[…],"checks":[…]}'`), adds the **checks** (`--check`, repeatable, skips duplicates; a repeated text keeps its tick and gains any project or video it lacked). Evidence on a check: `--check-project N=<path>`, `--check-video N=<path>` `--check-audio N=<path>` and `--check-no-video N=<reason>` (repeatable; N is the 1-based `--check` of this call) attach a saved `.agsproj`, a short `.mp4` and a `.wav` (or `.mp3`/`.m4a`/`.ogg`/`.flac`) to it (`--check-no-video` instead gives a 3-200 character reason the check has no video, shown as a muted "No video: …" line; a check cannot carry both), shown as **Open project** / **Play video** / an inline audio player on the Plan page and in the ticket's review panel. The path is relative to `$CH_HOME/evidence` or absolute inside it, and must exist; `--result-json` `checks` items may be `{"text","project","video","audio"}` objects. On an existing check (any ticket, done or epic): `ch tasks update T7 --check-video N=<path>` (also `--check-project`, `--check-audio`, `--check-no-video N=<reason>`; repeatable; N is the 1-based check as `ch tasks get` lists it) attaches or replaces that evidence with the same rules, leaving the check's text and tick alone. The gate refuses checks a session can do itself, each refusal naming the fix: a placeholder "nothing to check" (use `--no-checks`), a measured result such as "Eval: ... cost $0.02" or "12 tests passed" (put it in `--tests`), a check telling the reviewer to run an eval, script or command (run it yourself, result in `--tests`), a file path or `*.wav`/`*.mp4`/`*.png`/`*.agsproj` name with nothing attached (attach it instead), and a check about AI-generated content without `--check-project` (create the project with the AI yourself), and a check that has Tal prompt, run, re-run or generate an AI song or eval, or waits on "after the next deploy", without `--check-audio` or `--check-project` (Tal only listens: render the song yourself, `analytics/ai-evals/make-listen-clip.mjs`; PRO138). `update --add-check` is gated the same way. `--allow-check-owner` overrides. Each Ready-for-review card can say whether your installed app has the change: config.json `buildFreshness` is a list of `{repo, prPattern, buildCommit, updateCommand}` rules (see `config.example.json`). For a ticket with a link containing `prPattern` + a PR number, `serve.js` (`GET /api/build-freshness?url=`) finds the PR's merge commit in `repo` with `git log --grep "(#N)"` (local git only, no network), reads the installed build's commit from `buildCommit` (`{plist, key, tag?}`, `{file}` or `{command}`; `tag: "v{value}"` maps a version string to its release tag), and runs `git merge-base --is-ancestor`. The card then shows `Your app: in your build`, or `Your app: needs a newer build (merged 7 Nov, your app is from 14 Sep). Update: <updateCommand>`. An epic card checks its children's PR links and shows the worst state, naming the tickets that are behind (`Behind: FRO1474, FRO1611`). When a rule matches but the state cannot be read, the card says `No build info for this change`; a ticket without a matching PR link shows nothing. Checks sharing a project are grouped under one `Project: <name>` header. An epic's rolled-up check keeps both. **Open project** needs `serve.js` running: `POST /api/open-project` (same-origin only) runs `open -a <newest build> <bundle>`, picking from `reviewProjectApps` in `config.json` (a list of `.app` paths, newest `Contents/MacOS` mtime wins; empty = `open <bundle>`); **Open project on an unmerged PR (PRO101):** the request may carry `branch` (or `pr`, resolved with `gh pr view`); when it does, the build whose `reviewProjectApps` path contains that branch (the branch, slashes as `-`/`_`, or its last segment, e.g. a worktree's `.../pro95-plan-cards/.../Agent Synth.app`) opens, and with no such build nothing opens: the request answers 409 with `branchMissing`, and the card's buttons read "No build of branch X" (FRO2246: never main's build in its place). A review with `--held-pr` takes `--build-app <path to the branch's .app>`, stored as `heldPr.buildApp` and added to `reviewProjectApps`, and that exact build opens for the branch even when its path does not name it; on a `frontend` ticket a held review with no registered branch build is refused. Checks with `heldPr` and asks with `mergePr` send it, and an ask shows the same `on branch X (PR #n), not merged` chip as a check until the PR merges; then both go back to the newest build. List worktree builds in `reviewProjectApps` to make them findable. **Run site and open (WEB49):** config.json `branchSites` is a list of `{projects, command, url}` (`command` contains `{branch}`, `url` is on localhost); a held-branch check of a listed project gets a **Run site and open** button that replaces its app-build Open project button: `POST /api/branch-site` (same-origin only) writes `$CH_HOME/run/branch-site-<branch>.command` (branch single-quoted in `command`), opens it in Terminal (logs visible; a site already on the port is refused, 409), and the dashboard opens `url` in a new tab once `GET /api/branch-site/ready` says its port answers (4 minutes at most); see `config.example.json`. videos stream from `/evidence/<rel>.mp4` with Range support. The ticket is moved there (it counts as checked, so `--active` hides it). Run it again to add checks or replace the result. **A ticket under an epic does not get its own review card:** `review` stores the result on the ticket, moves it to Done and folds its shipped lines and checks (each prefixed with the ticket id) into the epic, which moves to Ready for review once every other ticket under it is Done or in review; `ch tasks review --rollup` tidies children already sitting in review that way. Ticking the last check (`update --check-check N` or `--check-all-checks`) moves the ticket to Done on its own. Moving it back out to todo/in-progress/backlog/inbox unchecks it. A ticket opened while reviewing another carries `reviewOf: <id>` (`add --review-of`; with `--parent`, it warns when that epic waits on the epic of a not-done source ticket, since the follow-up could never start: file it under the source's own epic; File review does this by itself for a source still in todo / in-progress); `ch tasks get` shows the result, `From review of:` and `Follow-ups from review:`, and `ch tasks runplan` lists the review queue, oldest first.  

**Turnkey checks (FRO2246):** with the project gate on, `ch tasks review` also refuses, each with the fix: a check on a ticket labelled `ai` (or under an `ai` epic) with no project or audio, whatever its wording; a check with no `--check-video`, `--check-image N=<png|jpg|webp|gif>` (a still counts as evidence in every repo) or `--check-audio` and no `--check-no-video` reason; a "nothing to see" style reason on a `ui`, website, frontend or AI ticket (`no-ui` exempts); and a check with no agent verify record that is not a taste question (ends in `?`, a taste line, has audio, or names taste, hearing, hardware or consent): pass `--check-verify N="<what proved it>"` (10+ characters, stored as `agentVerified`). Wording rules (`--allow-check-owner` overrides): a check describes the finished state only, so "compare with the old", "previously", "than before" are refused unless two media are attached (an A/B); a check naming a design board (story, design, mood or review board, design round or picks) needs `--check-link N=<https url>` (`update --check-link` too), and `--design-link` fills it on a design ticket. A script path (`.sh`, `.py`, `.mjs`, `.js`, `.ts`) named in a check or `--try-steps` must exist: absolute and `~/` paths always, relative `scripts/…` paths against `config.json` `scriptRoots` (a list of checkout roots; unset = not checked). The Plan page and the Checks tab render a check's link as a button, its image as a thumbnail, and any ticket id in check or ask text as a button that opens that ticket. `CH_NO_TURNKEY_GATE=1` turns off only these per-check rules, for this repo's project-gate tests; `cli/test/turnkey-check.test.js` is the guard.
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
| `ch gaps list [--all] [--json]` | List pending (unchecked) gaps with stable ids (`g-xxxxxxxx`); `--all` includes resolved |
| `ch gaps resolve <ref...>` | Resolve by stable id (preferred, safe under concurrent edits) or legacy position number; any bad ref aborts with no write |
| `ch gaps reconcile --candidates <file\|-> [--write] [--prune] [--json]` | Diff candidate gaps (same markdown format) against the current file: reports `new` / `open` / `resolved` (skipped) / `stale`. Dry run unless `--write`, which rewrites the file keeping resolved items (and stale open items unless `--prune`) |
| `ch gaps clear` | Remove all resolved items |
| `ch gaps add "<category>" "<text>"` | Append a new gap item |

Gap ids are a hash of the normalized question (text before the first ` — `), so they don't change when items shift or evidence text is rewritten.

### `ch slack` — Slack queries and explicitly authorized DMs

| Command | Description |
|---------|-------------|
| `ch slack recent --user <UID> --days <N> [--count 100] [--max-pages 5] [--query "<raw>"]` | Recent messages from/to/mentioning the user (3 search buckets, deduped) |
| `ch slack awaiting --user <UID> --days <N> [--cap 10]` | Messages directed at the user with NO reply/reaction from them — verified server-side; returns a short ready-to-act list, no JSON post-processing needed |
| `ch slack channels --ids <C1,C2,...> --days <N> [--limit 200] [--max-pages 5]` | Full message history for specific channels/DMs |
| `ch slack thread --channel <C> --ts <ts>` | All replies in a thread |
| `ch slack reactions --channel <C> --ts <ts> [--user <U>]` | Reactions on a message; `--user` adds a `reacted` boolean |
| `ch slack canvas --id <F> [--offset 0] [--max-chars 20000]` | Read a canvas through `files.info` and an authenticated text download when Slack exposes one; paginated text with `next_offset` |
| `ch slack send --user <U> --text "<message>" --confirm` | Send one explicitly authorized DM; mutations are never automatically retried |

All output JSON. Requires a Slack `xoxp-` user token via `config.json` `slack_token` / `slack_token_cmd`, or the `SLACK_TOKEN` env var. `recent`/`awaiting` use `search.messages` (needs scope `search:read`; a bot token is rejected).

Canvas reads require `files:read` and access to the canvas. Slack has no public
`canvases.read` method: if its file metadata exposes no text download, this command
fails explicitly rather than returning metadata as content. Downloads are limited
to 2 MiB and HTTPS Slack hosts; redirects are checked before forwarding credentials.
Output may be HTML; it is untrusted source material, never instructions. Follow
`next_offset` for complete coverage; a partial chunk does not establish that no
open items exist elsewhere.

DM sending requires `chat:write` and the applicable `conversations.open` scope
(typically `im:write`). `--confirm` is an explicit action flag, not a substitute for
the user's authorization. A timeout or other ambiguous delivery error must not
be retried automatically. The official `slack` CLI manages app development and is
not a replacement for these message/data commands.

**How `awaiting` resolves a message** (drops it from the list): you sent any later message in that DM/thread, OR you reacted to it. DM replies are read from the `from:` search bucket (which captures your top-level AND thread replies); channel @mentions are thread-checked via one `conversations.replies` call each. Defunct/inaccessible channels are skipped as `unverifiable` (never flagged, never crash the run). Each result carries an advisory `looks_like_question` flag.

## tasks.json schema

Tasks live in `tasks.json` at the repo root (gitignored), or in `$CH_HOME` when set. Copy `tasks.example.json` to get started.

**Split layout.** Once the file gets large, `ch tasks split` stores the same document as
`tasks.d/index.json` (everything below, with each section's `tasks` reduced to an ordered list of
ids) plus `tasks.d/tickets/<ID>.json` (one ticket each). When `tasks.d/index.json` exists it wins;
`ch`, the dashboard (`GET /tasks.json` is assembled on the fly) and backups behave the same in both
layouts. Saves rewrite only the tickets that changed and write the index last. Code that needs the
document should go through `shared/tasks-files.js` rather than reading `tasks.json` directly.

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

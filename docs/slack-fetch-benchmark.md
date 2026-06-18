# Slack Fetch Benchmark — `ch slack` CLI vs. MCP-agent approach

Measures the Slack data-gathering phase of the daily-summary automation before and
after introducing the `ch slack` CLI subcommand.

## TL;DR

| | Old (2 LLM agents via MCP) | New (`ch slack` CLI) |
|---|---|---|
| LLM tokens, fetch + awaiting-reply verify | **~120,000 / run** (prior observation) | **0** (deterministic subprocess) |
| Sub-agents spawned for Slack | 2 (sonnet) | 0 |
| Wall-clock, fetch | minutes (LLM + many tool round-trips) | **~2.1 s** (measured, median of 3) |
| Slack data handed to synthesis | digested agent findings | ~85 KB / ~22k-token JSON (measured) |
| Output | LLM-variable | deterministic, repeatable |
| Daily sub-agents (whole task) | 4 | 2 |

**Net:** the fetch + verify phase drops from ~120k LLM tokens to ~0. The only added
cost is a one-time ~22k-token JSON entering the synthesis context — data the synthesis
step received in some (digested) form anyway. The daily task also goes from 4 sub-agents
to 2 and gains deterministic Slack output.

## What is compared

The "gather N days of Slack activity for one user, then detect *awaiting-reply* items" phase.

- **Old design:** two foreground LLM sub-agents — one for public search, one for
  private/DM search — each calling the Slack MCP (`slack_search_*`) plus, per candidate,
  `slack_read_thread` + `slack_get_reactions`, then emitting structured findings.
- **New design:** `ch slack recent --days <N> --user <id>` returns JSON directly from the
  Slack Web API (zero LLM tokens). A single synthesis agent reads that JSON and runs the
  awaiting-reply checks via `ch slack thread` / `ch slack reactions` — also zero-LLM-token
  CLI calls.

## Method & caveats

- **New-path numbers are measured** on a real 3-day window, median of 3 consecutive runs.
- **Old-path total (~120k) is the project's prior production observation**, not a live
  re-measurement: the MCP Slack connector was offline during benchmarking. As an anchor,
  a bare sonnet sub-agent in this harness was measured at **~18k tokens of fixed init
  overhead** (system prompt + base tool definitions) *before doing any work* — so two
  agents start at ~36k tokens, and the ~120k full-run figure follows once search results
  and per-candidate thread/reaction reads are added across both agents.
- Token counts for the CLI JSON are approximated as bytes ÷ 4.
- The fetch itself spends **0 LLM tokens** because `ch slack` is an ordinary subprocess
  hitting the Slack Web API; tokens are only spent when an LLM later reads the JSON.

## Why the old approach is structurally expensive

Each Slack message verified for awaiting-reply triggered separate `slack_read_thread` and
`slack_get_reactions` MCP round-trips, every response landing in an LLM context window and
being reasoned over — multiplied across two agents that each carry full system-prompt and
tool-definition overhead. The CLI collapses all of that into one deterministic Web API
pass with no LLM in the loop.

## Conclusion

Replacing the two Slack LLM agents with `ch slack` removes ~120k tokens/run of fetch +
verify cost in exchange for a ~22k-token JSON input to the existing synthesis step. The
fetch is also ~2 seconds and fully deterministic, and the daily task drops from 4
sub-agents to 2. Awaiting-reply verification still works, now via zero-token CLI calls.

---

*No Slack message content, user/channel names, or credentials appear in this report — only
aggregate size and timing metrics.*

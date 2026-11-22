#!/bin/bash
# Runs one unattended coding-agent automation and records its result.
# Usage: run-job.sh <id> <prompt>
id="$1"; prompt="$2"
[ -n "$id" ] && [ -n "$prompt" ] || { echo "usage: run-job.sh <id> <prompt>" >&2; exit 64; }
harness="${AUTOMATION_HARNESS:-}"
cli="${AUTOMATION_CLI:-}"
model="${AUTOMATION_MODEL:-}"
effort="${AUTOMATION_EFFORT:-medium}"
logdir="${AUTOMATION_LOG_DIR:-$HOME/Library/Logs/agent-automations}"
mkdir -p "$logdir"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="$(mktemp "$logdir/.run.XXXXXX")"
case "$harness" in
  opencode)
    cli="${cli:-opencode}"
    args=(run --auto --format json --title "$id $(date +%Y-%m-%d)")
    [ -n "$model" ] && args+=(--model "$model")
    ;;
  claude)
    cli="${cli:-claude}"
    args=(-p --output-format json)
    [ -n "$model" ] && args+=(--model "$model")
    ;;
  codex)
    cli="${cli:-codex}"
    args=(exec --json)
    [ -n "$model" ] && args+=(--model "$model")
    ;;
  copilot)
    cli="${cli:-copilot}"
    args=(--prompt --allow-all --silent)
    [ -n "$model" ] && args+=(--model "$model")
    ;;
  custom)
    [ -n "$cli" ] || { echo "AUTOMATION_CLI is required for a custom harness" >&2; exit 64; }
    args=()
    ;;
  *) echo "Unknown automation harness: $harness" >&2; exit 64 ;;
esac
if [ -n "${AUTOMATION_ARGUMENTS:-}" ]; then
  while IFS= read -r arg; do args+=("$arg"); done <<<"$AUTOMATION_ARGUMENTS"
fi
"$cli" "${args[@]}" "$prompt" >"$out" 2>&1
code=$?
cat "$out"
sid="$(grep -oE 'ses_[A-Za-z0-9]+|[0-9a-f-]{36}' "$out" | head -n 1)"
rm -f "$out"
printf '{"sessionID":"%s","startedAt":"%s","finishedAt":"%s","exitCode":%s,"harness":"%s","model":"%s"}\n' \
  "$sid" "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code" "$harness" "$model" >"$logdir/$id.last.json"
exit "$code"

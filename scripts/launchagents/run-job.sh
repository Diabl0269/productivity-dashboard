#!/bin/bash
# Runs one OpenCode automation and records its session in <log dir>/<id>.last.json.
# Usage: run-job.sh <id> <prompt>
# Env: OPENCODE_CLI (default: the OpenCode.app binary), AUTOMATION_HARNESS (opencode/claude/copilot),
#      OPENCODE_MODEL and OPENCODE_AGENT (optional OpenCode selections), OPENCODE_EFFORT (low/medium/high/xhigh),
#      AUTOMATION_LOG_DIR (default ~/Library/Logs/opencode-automations)
id="$1"; prompt="$2"
[ -n "$id" ] && [ -n "$prompt" ] || { echo "usage: run-job.sh <id> <prompt>" >&2; exit 64; }
cli="${OPENCODE_CLI:-/Applications/OpenCode.app/Contents/Resources/opencode-cli}"
logdir="${AUTOMATION_LOG_DIR:-$HOME/Library/Logs/opencode-automations}"
mkdir -p "$logdir"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="$(mktemp "$logdir/.run.XXXXXX")"
harness="${AUTOMATION_HARNESS:-opencode}"
case "$harness" in
  opencode)
    args=(run --auto --format json --title "$id $(date +%Y-%m-%d)")
    model="$OPENCODE_MODEL"
    [ -n "$model" ] && [ -n "$OPENCODE_EFFORT" ] && [[ "$model" != *'#'* ]] && model="$model#$OPENCODE_EFFORT"
    [ -n "$model" ] && args+=(--model "$model")
    [ -n "$OPENCODE_AGENT" ] && args+=(--agent "$OPENCODE_AGENT")
    "$cli" "${args[@]}" "$prompt" >"$out" 2>&1
    ;;
  claude)
    cli="${CLAUDE_CLI:-claude}"; args=(-p --permission-mode auto --output-format json --name "$id $(date +%Y-%m-%d)")
    [ -n "$CLAUDE_MODEL" ] && args+=(--model "$CLAUDE_MODEL")
    [ -n "$CLAUDE_AGENT" ] && args+=(--agent "$CLAUDE_AGENT")
    [ -n "$CLAUDE_EFFORT" ] && args+=(--effort "$CLAUDE_EFFORT")
    "$cli" "${args[@]}" "$prompt" >"$out" 2>&1
    ;;
  copilot)
    cli="${COPILOT_CLI:-copilot}"; args=(-p "$prompt" --allow-all)
    [ -n "$COPILOT_MODEL" ] && args+=(--model "$COPILOT_MODEL")
    [ -n "$COPILOT_AGENT" ] && args+=(--agent "$COPILOT_AGENT")
    "$cli" "${args[@]}" >"$out" 2>&1
    ;;
  *) echo "unsupported automation harness: $harness" >&2; exit 64 ;;
esac
code=$?
cat "$out"
sid="$(grep -oE 'ses_[A-Za-z0-9]+|[0-9a-f]{8}-[0-9a-f-]{27,}' "$out" | head -n 1)"
rm -f "$out"
finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
record="$(printf '{"sessionID":"%s","startedAt":"%s","finishedAt":"%s","exitCode":%s,"harness":"%s","model":"%s","agent":"%s","effort":"%s"}\n' \
  "$sid" "$started" "$finished" "$code" "$harness" "${OPENCODE_MODEL:-${CLAUDE_MODEL:-$COPILOT_MODEL}}" \
  "${OPENCODE_AGENT:-${CLAUDE_AGENT:-$COPILOT_AGENT}}" "${OPENCODE_EFFORT:-$CLAUDE_EFFORT}")"
printf '%s\n' "$record" >"$logdir/$id.last.json"
printf '%s\n' "$record" >>"$logdir/$id.runs.jsonl"
exit "$code"

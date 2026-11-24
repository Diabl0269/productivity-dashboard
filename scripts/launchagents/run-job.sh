#!/bin/bash
# Runs one unattended coding-agent automation and records its result in <id>.last.json and <id>.runs.jsonl.
# Usage: run-job.sh <id> <prompt>
id="$1"; prompt="$2"
[ -n "$id" ] && [ -n "$prompt" ] || { echo "usage: run-job.sh <id> <prompt>" >&2; exit 64; }
harness="${AUTOMATION_HARNESS:-}"
cli="${AUTOMATION_CLI:-}"
model="${AUTOMATION_MODEL:-}"
effort="${AUTOMATION_EFFORT:-}"
agent="${AUTOMATION_AGENT:-}"
logdir="${AUTOMATION_LOG_DIR:-$HOME/Library/Logs/agent-automations}"
mkdir -p "$logdir"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="$(mktemp "$logdir/.run.XXXXXX")"
prompt_args=("$prompt")
case "$harness" in
  opencode)
    cli="${cli:-${OPENCODE_CLI:-opencode}}"
    if ! command -v "$cli" >/dev/null 2>&1 && [ -x "/Applications/OpenCode.app/Contents/Resources/opencode-cli" ]; then
      cli="/Applications/OpenCode.app/Contents/Resources/opencode-cli"
    fi
    model="${model:-${OPENCODE_MODEL:-}}"
    agent="${agent:-${OPENCODE_AGENT:-}}"
    args=(run --auto --format json --title "$id $(date +%Y-%m-%d)")
    [ -n "$model" ] && args+=(--model "$model")
    [ -n "$agent" ] && args+=(--agent "$agent")
    ;;
  claude)
    cli="${cli:-${CLAUDE_CLI:-claude}}"
    model="${model:-${CLAUDE_MODEL:-}}"
    effort="${effort:-${CLAUDE_EFFORT:-}}"
    agent="${agent:-${CLAUDE_AGENT:-}}"
    args=(-p --output-format json)
    [ -n "$model" ] && args+=(--model "$model")
    [ -n "$effort" ] && args+=(--effort "$effort")
    [ -n "$agent" ] && args+=(--agent "$agent")
    ;;
  codex)
    cli="${cli:-${CODEX_CLI:-codex}}"
    model="${model:-${CODEX_MODEL:-}}"
    args=(exec --json)
    [ -n "$model" ] && args+=(--model "$model")
    ;;
  copilot)
    cli="${cli:-${COPILOT_CLI:-copilot}}"
    model="${model:-${COPILOT_MODEL:-}}"
    effort="${effort:-${COPILOT_EFFORT:-}}"
    agent="${agent:-${COPILOT_AGENT:-}}"
    args=(--allow-all --output-format json)
    [ -n "$model" ] && args+=(--model "$model")
    [ -n "$effort" ] && args+=(--reasoning-effort "$effort")
    [ -n "$agent" ] && args+=(--agent "$agent")
    prompt_args=(-p "$prompt")
    ;;
  gemini|agy|antigravity)
    harness="gemini"
    cli="${cli:-${GEMINI_CLI:-${AGY_CLI:-agy}}}"
    model="${model:-${GEMINI_MODEL:-}}"
    effort="${effort:-${GEMINI_EFFORT:-}}"
    agent="${agent:-${GEMINI_AGENT:-}}"
    args=(--output-format json --dangerously-skip-permissions)
    [ -n "$model" ] && args+=(--model "$model")
    [ -n "$effort" ] && args+=(--effort "$effort")
    [ -n "$agent" ] && args+=(--agent "$agent")
    prompt_args=(-p "$prompt")
    ;;
  custom)
    [ -n "$cli" ] || { echo "AUTOMATION_CLI is required for a custom harness" >&2; exit 64; }
    args=()
    ;;
  *) echo "Unknown automation harness: $harness" >&2; exit 64 ;;
esac
if [ -n "${AUTOMATION_ARGUMENTS:-}" ]; then
  while IFS= read -r arg; do [ -n "$arg" ] && args+=("$arg"); done <<<"$AUTOMATION_ARGUMENTS"
fi
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
running_file="$logdir/$id.running.json"
trap 'rm -f "$out" "$running_file"' EXIT
printf '{"startedAt":"%s","pid":%s,"harness":"%s","model":"%s"}\n' \
  "$started" "$$" "$(esc "$harness")" "$(esc "$model")" >"$running_file"
"$cli" "${args[@]}" "${prompt_args[@]}" 2>&1 | tee "$out"
code=${PIPESTATUS[0]}
sid="$(sed -nE 's/.*"(conversation_id|conversationId|session_id|sessionID|thread_id)"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_.-]+)".*/\2/p' "$out" | head -n 1)"
if [ -z "$sid" ]; then
  sid="$(grep -oE 'ses_[A-Za-z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$out" | head -n 1)"
fi
if [ "$harness" = "gemini" ] && [ -z "$model" ] && [ -n "$sid" ]; then
  tfile="$HOME/.gemini/antigravity-cli/brain/$sid/.system_generated/logs/transcript.jsonl"
  if [ -f "$tfile" ]; then
    model="$(sed -nE 's/.*"model"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$tfile" | head -n 1)"
  fi
fi
err_msg=""
if [ "$code" != "0" ]; then
  err_msg="$(sed -nE 's/.*"error"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$out" | tail -n 1)"
fi
rm -f "$out" "$running_file"
finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
err_field=""
[ -n "$err_msg" ] && err_field="$(printf ',"error":"%s"' "$(esc "$err_msg")")"
rec="$(printf '{"sessionID":"%s","startedAt":"%s","finishedAt":"%s","exitCode":%s,"harness":"%s","model":"%s"%s}' \
  "$(esc "$sid")" "$started" "$finished" "$code" "$(esc "$harness")" "$(esc "$model")" "$err_field")"
printf '%s\n' "$rec" >"$logdir/$id.last.json"
if [ -n "$sid" ] || [ "$code" != "0" ]; then
  printf '%s\n' "$rec" >>"$logdir/$id.runs.jsonl"
fi
exit "$code"

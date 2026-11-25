#!/bin/bash
# Generic unattended coding-agent runner. Records live state in <id>.running.json and results in <id>.last.json + <id>.runs.jsonl.
# Usage: run-job.sh <id> <prompt>
#
# Driven by generic AUTOMATION_* env vars, with compact declarative presets per harness name so both
# standard harnesses and arbitrary custom CLIs use one unified argv/logging pipeline.
id="$1"; prompt="$2"
[ -n "$id" ] && [ -n "$prompt" ] || { echo "usage: run-job.sh <id> <prompt>" >&2; exit 64; }

raw_harness="$(printf '%s' "${AUTOMATION_HARNESS:-}" | tr '[:upper:]' '[:lower:]')"
case "$raw_harness" in
  agy|antigravity) harness="gemini" ;;
  *) harness="$raw_harness" ;;
esac

# Declarative preset defaults (overridable via AUTOMATION_* env vars, including for "custom").
p_cli=""; p_alt_cli=""; p_base=""; p_model_flag="--model"; p_effort_flag="--effort"; p_agent_flag="--agent"; p_prompt_flag=""; p_title_flag=""
case "$harness" in
  opencode) p_cli="opencode"; p_alt_cli="/Applications/OpenCode.app/Contents/Resources/opencode-cli"; p_base=$'run\n--auto\n--format\njson'; p_effort_flag=""; p_title_flag="--title" ;;
  claude)   p_cli="claude";   p_base=$'-p\n--output-format\njson' ;;
  codex)    p_cli="codex";    p_base=$'exec\n--json'; p_effort_flag=""; p_agent_flag="" ;;
  copilot)  p_cli="copilot";  p_base=$'--allow-all\n--output-format\njson'; p_effort_flag="--reasoning-effort"; p_prompt_flag="-p" ;;
  gemini)   p_cli="agy";      p_base=$'--output-format\njson\n--dangerously-skip-permissions'; p_prompt_flag="-p" ;;
  custom)   ;;
  *)
    if [ -z "${AUTOMATION_CLI:-}" ] || [ -z "$harness" ]; then
      echo "Unknown automation harness: $harness" >&2
      exit 64
    fi
    ;;
esac

# Resolve <PREFIX>_* fallbacks generically (e.g. GEMINI_MODEL, CLAUDE_EFFORT, OPENCODE_CLI).
prefix="$(printf '%s' "$harness" | tr '[:lower:]-' '[:upper:]_')"
env_val() { eval "printf '%s' \"\${${1}:-}\""; }

cli="${AUTOMATION_CLI:-$(env_val "${prefix}_CLI")}"
[ -z "$cli" ] && [ "$harness" = "gemini" ] && cli="${AGY_CLI:-}"
cli="${cli:-$p_cli}"
[ -n "$cli" ] || { echo "AUTOMATION_CLI is required for harness: $harness" >&2; exit 64; }
if ! command -v "$cli" >/dev/null 2>&1 && [ -n "${AUTOMATION_FALLBACK_CLI:-$p_alt_cli}" ] && [ -x "${AUTOMATION_FALLBACK_CLI:-$p_alt_cli}" ]; then
  cli="${AUTOMATION_FALLBACK_CLI:-$p_alt_cli}"
fi

model="${AUTOMATION_MODEL:-$(env_val "${prefix}_MODEL")}"
effort="${AUTOMATION_EFFORT:-$(env_val "${prefix}_EFFORT")}"
agent="${AUTOMATION_AGENT:-$(env_val "${prefix}_AGENT")}"
base_args="${AUTOMATION_BASE_ARGS:-$p_base}"
model_flag="${AUTOMATION_MODEL_FLAG-$p_model_flag}"
effort_flag="${AUTOMATION_EFFORT_FLAG-$p_effort_flag}"
agent_flag="${AUTOMATION_AGENT_FLAG-$p_agent_flag}"
prompt_flag="${AUTOMATION_PROMPT_FLAG-$p_prompt_flag}"
title_flag="${AUTOMATION_TITLE_FLAG-$p_title_flag}"

args=()
if [ -n "$base_args" ]; then
  while IFS= read -r a; do [ -n "$a" ] && args+=("$a"); done <<<"$base_args"
fi
[ -n "$title_flag" ] && args+=("$title_flag" "$id $(date +%Y-%m-%d)")
[ -n "$model" ]  && [ -n "$model_flag" ]  && args+=("$model_flag" "$model")
[ -n "$effort" ] && [ -n "$effort_flag" ] && args+=("$effort_flag" "$effort")
[ -n "$agent" ]  && [ -n "$agent_flag" ]  && args+=("$agent_flag" "$agent")
if [ -n "${AUTOMATION_ARGUMENTS:-}" ]; then
  while IFS= read -r a; do [ -n "$a" ] && args+=("$a"); done <<<"$AUTOMATION_ARGUMENTS"
fi
prompt_args=("$prompt")
[ -n "$prompt_flag" ] && prompt_args=("$prompt_flag" "$prompt")

logdir="${AUTOMATION_LOG_DIR:-$HOME/Library/Logs/agent-automations}"
mkdir -p "$logdir"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="$(mktemp "$logdir/.run.XXXXXX")"
running_file="$logdir/$id.running.json"
esc() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
trap 'rm -f "$out" "$running_file"' EXIT

printf '{"startedAt":"%s","pid":%s,"harness":"%s","model":"%s"}\n' \
  "$started" "$$" "$(esc "$harness")" "$(esc "$model")" >"$running_file"
"$cli" "${args[@]}" "${prompt_args[@]}" 2>&1 | tee "$out"
code=${PIPESTATUS[0]}

sid="$(sed -nE 's/.*"(conversation_id|conversationId|session_id|sessionID|thread_id)"[[:space:]]*:[[:space:]]*"([A-Za-z0-9_.-]+)".*/\2/p' "$out" | head -n 1)"
if [ -z "$sid" ]; then
  sid="$(grep -oE 'ses_[A-Za-z0-9]+|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$out" | head -n 1)"
fi
if [ -z "$model" ]; then
  model="$(sed -nE 's/.*"model"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' "$out" | head -n 1)"
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

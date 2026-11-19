#!/bin/bash
# Runs one OpenCode automation and records its session in <log dir>/<id>.last.json.
# Usage: run-job.sh <id> <prompt>
# Env: OPENCODE_CLI (default: the OpenCode.app binary), OPENCODE_MODEL (optional, provider/model#variant),
#      AUTOMATION_LOG_DIR (default ~/Library/Logs/opencode-automations)
id="$1"; prompt="$2"
[ -n "$id" ] && [ -n "$prompt" ] || { echo "usage: run-job.sh <id> <prompt>" >&2; exit 64; }
cli="${OPENCODE_CLI:-/Applications/OpenCode.app/Contents/Resources/opencode-cli}"
logdir="${AUTOMATION_LOG_DIR:-$HOME/Library/Logs/opencode-automations}"
mkdir -p "$logdir"
started="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
out="$(mktemp "$logdir/.run.XXXXXX")"
args=(run --auto --format json --title "$id $(date +%Y-%m-%d)")
[ -n "$OPENCODE_MODEL" ] && args+=(--model "$OPENCODE_MODEL")
"$cli" "${args[@]}" "$prompt" >"$out" 2>&1
code=$?
cat "$out"
sid="$(grep -o 'ses_[A-Za-z0-9]*' "$out" | head -n 1)"
rm -f "$out"
printf '{"sessionID":"%s","startedAt":"%s","finishedAt":"%s","exitCode":%s}\n' \
  "$sid" "$started" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$code" >"$logdir/$id.last.json"
exit "$code"

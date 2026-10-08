#!/usr/bin/env bash
# Try ClaudeWhip in simulate mode without installing anything:
# Claude Code (this plugin + the whip status line, for this session only) on
# top, a slap pad below. Press t / s / w in the pad. Needs tmux.
set -euo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v tmux >/dev/null || { echo "try.sh needs tmux (brew install tmux)"; exit 1; }
SETTINGS="{\"statusLine\":{\"type\":\"command\",\"command\":\"node \\\"$REPO/statusline/statusline.js\\\"\",\"refreshInterval\":1}}"
exec tmux new-session -s whip-try \
  "claude --plugin-dir '$REPO' --settings '$SETTINGS' $*" \; \
  split-window -v -l 4 "node '$REPO/bin/whip' pad" \; \
  select-pane -t 0

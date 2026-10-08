#!/usr/bin/env bash
# ClaudeWhip uninstaller: removes everything install.sh added and restores
# your original ~/.claude/settings.json.
#
#   ./uninstall.sh               remove everything, including your slap stats
#   ./uninstall.sh --keep-stats  keep ~/.claude/whip (counters, config)
#   ./uninstall.sh --no-sensor   leave the root sensor daemon alone (no sudo)
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
WHIP_HOME="${WHIP_HOME:-$CLAUDE_DIR/whip}"
DAEMON_LABEL=com.claudewhip.sensord
DAEMON_PLIST=/Library/LaunchDaemons/$DAEMON_LABEL.plist
AGENT_LABEL=com.claudewhip.bridge
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
KEEP=0 SENSOR=1
for a in "$@"; do
  case "$a" in
    --keep-stats) KEEP=1 ;;
    --no-sensor) SENSOR=0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[38;5;209m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }

step "Stopping the bridge"
launchctl bootout "gui/$(id -u)/$AGENT_LABEL" 2>/dev/null && info "stopped" || info "not running"
rm -f "$AGENT_PLIST"

SENSOR_BIN=/Library/PrivilegedHelperTools/com.claudewhip.sensord
if [ "$SENSOR" = 1 ] && { [ -e "$DAEMON_PLIST" ] || [ -e "$SENSOR_BIN" ] || [ -e /var/run/claudewhip ]; }; then
  step "Removing the sensor daemon (needs sudo)"
  # One sudo call = one password prompt.
  sudo /bin/sh -c 'launchctl bootout "system/$1" 2>/dev/null; rm -f "$2" "$3" /var/log/claudewhip-sensord.log; rm -rf /var/run/claudewhip' \
    sh "$DAEMON_LABEL" "$DAEMON_PLIST" "$SENSOR_BIN"
  info "removed"
fi

step "Removing the Claude Code plugin"
if command -v claude >/dev/null; then
  claude plugin uninstall whip@claudewhip --scope user >/dev/null 2>&1 && info "plugin uninstalled" || info "plugin was not installed"
  claude plugin marketplace remove claudewhip >/dev/null 2>&1 && info "marketplace removed" || true
fi
# Claude Code keeps an orphaned copy of uninstalled plugins for a while; remove ours now.
rm -rf "$CLAUDE_DIR/plugins/cache/claudewhip" "$CLAUDE_DIR/plugins/data/whip-claudewhip" "$CLAUDE_DIR/plugins/marketplaces/claudewhip"

step "Restoring settings.json"
if [ -f "$WHIP_HOME/install.json" ] || grep -q 'statusline/statusline.js' "$CLAUDE_DIR/settings.json" 2>/dev/null; then
  # Stops here (set -e) if settings.json can't be restored, before install.json
  # (which knows where your backup is) is deleted.
  "$REPO/bin/whip" settings uninstall
else
  info "nothing to restore"
fi

LINK="$(node -e 'try{process.stdout.write(require(process.argv[1]).cliLink||"")}catch{}' "$WHIP_HOME/install.json")"
LINK="${LINK:-$HOME/.local/bin/whip}"
if [ -L "$LINK" ] && [ "$(readlink "$LINK")" = "$REPO/bin/whip" ]; then
  rm -f "$LINK"
  info "removed $LINK"
fi

# Only ever delete a directory that is recognisably ours.
safe_whip_home() {
  case "$WHIP_HOME" in "" | / | "$HOME" | "$HOME/" | "$CLAUDE_DIR" | "$CLAUDE_DIR/") return 1 ;; esac
  [ -d "$WHIP_HOME" ] || return 1
  [ -e "$WHIP_HOME/install.json" ] || [ -e "$WHIP_HOME/state.json" ] || [ -e "$WHIP_HOME/config.json" ] || [ -d "$WHIP_HOME/sessions" ]
}
if [ "$KEEP" = 1 ]; then
  rm -f "$WHIP_HOME/install.json"
  info "kept your stats in $WHIP_HOME"
elif [ ! -e "$WHIP_HOME" ]; then
  info "no state directory"
elif safe_whip_home; then
  rm -rf "$WHIP_HOME"
  info "removed $WHIP_HOME"
else
  info "NOT deleting $WHIP_HOME: it doesn't look like a ClaudeWhip state directory"
fi

step "Checking for leftovers"
LEFT=0
ROOT_FILES=()
[ "$SENSOR" = 1 ] && ROOT_FILES=("$DAEMON_PLIST" "$SENSOR_BIN" /var/run/claudewhip /var/log/claudewhip-sensord.log)
for f in "$AGENT_PLIST" ${ROOT_FILES[@]+"${ROOT_FILES[@]}"} "$CLAUDE_DIR/plugins/cache/claudewhip"; do
  if [ -e "$f" ]; then info "still there: $f"; LEFT=1; fi
done
[ "$KEEP" = 0 ] && [ -e "$WHIP_HOME" ] && { info "still there: $WHIP_HOME"; LEFT=1; }
grep -q 'statusline/statusline.js' "$CLAUDE_DIR/settings.json" 2>/dev/null && { info "settings.json still references the whip status line"; LEFT=1; }
PLUGINS="$(command -v claude >/dev/null && claude plugin list 2>/dev/null || true)"
if printf '%s' "$PLUGINS" | grep -q 'whip@claudewhip'; then info "plugin still listed"; LEFT=1; fi
[ "$LEFT" = 0 ] && info "no traces left" || exit 1

#!/usr/bin/env bash
# ClaudeWhip installer.
#
#   ./install.sh                 everything (asks for sudo once, for the sensor)
#   ./install.sh --no-sensor     plugin + status line only (simulate / /whip / hotkeys)
#
# Options:
#   --mode wrap|replace|keep     what to do with an existing statusLine (default: ask, else wrap)
#   --refresh N                  statusLine refreshInterval in seconds (default 1; 0 = event-driven)
#   --spinner                    add themed spinnerVerbs ("Hurrying", "Sweating", ...)
#   --link-cli                   symlink `whip` into ~/.local/bin
#   --yes                        accept defaults, no questions
#
# Everything it does is undone by ./uninstall.sh.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
WHIP_HOME="${WHIP_HOME:-$CLAUDE_DIR/whip}"
SENSOR_BIN=/Library/PrivilegedHelperTools/com.claudewhip.sensord
DAEMON_LABEL=com.claudewhip.sensord
DAEMON_PLIST=/Library/LaunchDaemons/$DAEMON_LABEL.plist
AGENT_LABEL=com.claudewhip.bridge
AGENT_PLIST="$HOME/Library/LaunchAgents/$AGENT_LABEL.plist"
SOCKET=/var/run/claudewhip/sensor.sock

SENSOR=1 MODE="" REFRESH=1 SPINNER=0 LINK=0 YES=0
while [ $# -gt 0 ]; do
  case "$1" in
    --no-sensor) SENSOR=0 ;;
    --mode) MODE="$2"; shift ;;
    --refresh) REFRESH="$2"; shift ;;
    --spinner) SPINNER=1 ;;
    --link-cli) LINK=1 ;;
    --yes|-y) YES=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
step() { printf '\n\033[38;5;209m==>\033[0m \033[1m%s\033[0m\n' "$*"; }
info() { printf '    %s\n' "$*"; }
die() { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }
# launchctl bootstrap right after bootout can fail with EIO while the old job
# tears down; retry a few times.
bootstrap() { # bootstrap <domain> <plist>
  local i
  for i in 1 2 3 4 5; do
    launchctl bootstrap "$1" "$2" 2>/dev/null && return 0
    sleep 0.5
  done
  launchctl bootstrap "$1" "$2"
}
ask() { # ask "question" default -> echoes answer
  local q="$1" def="$2" a=""
  if [ "$YES" = 1 ] || [ ! -r /dev/tty ]; then echo "$def"; return; fi
  read -r -p "    $q [$def] " a </dev/tty || true
  echo "${a:-$def}"
}

bold "ClaudeWhip installer"
[ "$(id -u)" != 0 ] || die "run ./install.sh as your normal user (it asks for sudo only for the sensor)"

# ---------------------------------------------------------------- preflight
step "Checking requirements"
[ "$(uname -s)" = Darwin ] || die "macOS only"
command -v node >/dev/null || die "node not found (brew install node)"
NODE="$(command -v node)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "node $NODE_MAJOR is too old; need 18+"
command -v claude >/dev/null || die "claude (Claude Code CLI) not found on PATH"
info "node $(node -v) · $(claude --version 2>/dev/null | head -1)"
if [ "$SENSOR" = 1 ] && [ "$(uname -m)" != arm64 ]; then
  info "not Apple Silicon: skipping the sensor"
  SENSOR=0
fi
mkdir -p "$WHIP_HOME"
chmod 700 "$WHIP_HOME"

# Back up settings.json before anything (including `claude plugin install`) edits it.
"$REPO/bin/whip" settings backup

# ---------------------------------------------------------------- plugin
step "Installing the Claude Code plugin (hooks + slash commands)"
# Capture first: `cmd | grep -q` under pipefail can fail with SIGPIPE.
MARKETS="$(claude plugin marketplace list 2>/dev/null || true)"
if printf '%s' "$MARKETS" | grep -q 'claudewhip'; then
  claude plugin marketplace update claudewhip >/dev/null 2>&1 || true
else
  claude plugin marketplace add "$REPO" >/dev/null
fi
PLUGINS="$(claude plugin list 2>/dev/null || true)"
if printf '%s' "$PLUGINS" | grep -q 'whip@claudewhip'; then
  claude plugin update whip@claudewhip >/dev/null 2>&1 || true
  claude plugin enable whip@claudewhip >/dev/null 2>&1 || true
else
  claude plugin install whip@claudewhip --scope user >/dev/null
fi
info "whip@claudewhip installed: /whip, /slaps, /whip-config, /whip-on, /whip-off"

# ---------------------------------------------------------------- status line
step "Wiring the status line into $CLAUDE_DIR/settings.json"
if [ -z "$MODE" ]; then
  EXISTING="$(node -e 'try{const s=require(process.argv[1]);const c=s.statusLine&&s.statusLine.command||"";process.stdout.write(/statusline[\\/]statusline\.js/.test(c)?"":c)}catch{}' "$CLAUDE_DIR/settings.json")"
  if [ -n "$EXISTING" ]; then
    info "you already have a status line: $EXISTING"
    MODE="$(ask "wrap it (keep yours as line 1, whip lane below), replace, or keep? [wrap/replace/keep]" wrap)"
  else
    MODE=wrap
  fi
fi
if [ "$SPINNER" = 0 ] && [ "$YES" = 0 ]; then
  [ "$(ask "add themed spinner verbs (Hurrying, Sweating, Flinching...)? [y/N]" n)" = y ] && SPINNER=1
fi
SPIN_FLAG=""; [ "$SPINNER" = 1 ] && SPIN_FLAG="--spinner"
"$REPO/bin/whip" settings install --mode "$MODE" --refresh "$REFRESH" $SPIN_FLAG

# ---------------------------------------------------------------- sensor (root)
if [ "$SENSOR" = 1 ]; then
  step "Building the sensor daemon (Go)"
  command -v go >/dev/null || die "go not found (brew install go), or re-run with --no-sensor"
  # Always build (Go caches it): a fix in any sensord/*.go must reach the root binary.
  (cd "$REPO/sensord" && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$REPO/build/whip-sensord" .)
  "$REPO/build/whip-sensord" --version >/dev/null
  SHA="$(shasum -a 256 "$REPO/build/whip-sensord" | cut -d' ' -f1)"

  step "Installing the sensor daemon (needs sudo)"
  info "This runs as root, because reading the accelerometer (IOKit HID) needs it:"
  info "  $SENSOR_BIN   (root:wheel 755, copied from build/)"
  info "  $DAEMON_PLIST   (LaunchDaemon, starts at boot)"
  info "It only reads the sensor and writes JSON lines to $SOCKET,"
  info "owned by you (uid $(id -u)), mode 0600. No network, no keystrokes, no files in your home."
  # The root binary's directory and every ancestor must be root-owned and not
  # group/world-writable, or a user process could swap the binary.
  for d in /Library /Library/PrivilegedHelperTools; do
    read -r OWNER PERM <<<"$(stat -f '%u %Lp' "$d")"
    { [ "$OWNER" = 0 ] && [ $((8#$PERM & 8#022)) = 0 ]; } || die "$d must be root-owned and not group/world-writable (is: uid $OWNER, mode $PERM)"
  done
  PLIST_XML="$(node "$REPO/scripts/render-plist.js" "$REPO/launchd/$DAEMON_LABEL.plist.in" \
    SENSOR_BIN="$SENSOR_BIN" OWNER_UID="$(id -u)" SOCKET="$SOCKET")"
  printf '%s\n' "$PLIST_XML" | plutil -lint - >/dev/null
  # Everything root does happens in this ONE sudo call, so you type your
  # password once. (macOS sudo remembers a login per parent process, so a
  # `$(sudo …)` or `… | sudo …` in a subshell would prompt again.)
  ROOT_SCRIPT="$(cat "$REPO/scripts/root-install.sh")"
  info "sudo will ask for your password once:"
  sudo /bin/bash -s -- "$REPO/build/whip-sensord" "$SHA" "$SENSOR_BIN" "$DAEMON_PLIST" "$DAEMON_LABEL" "$PLIST_XML" <<<"$ROOT_SCRIPT" \
    || die "installing the sensor daemon failed (see above)"
  info "sensor daemon started"

  step "Installing the bridge (LaunchAgent, runs as you)"
  mkdir -p "$(dirname "$AGENT_PLIST")"
  node "$REPO/scripts/render-plist.js" "$REPO/launchd/$AGENT_LABEL.plist.in" \
    NODE="$NODE" REPO="$REPO" WHIP_HOME="$WHIP_HOME" >"$AGENT_PLIST"
  plutil -lint "$AGENT_PLIST" >/dev/null
  launchctl bootout "gui/$(id -u)/$AGENT_LABEL" 2>/dev/null || true
  bootstrap "gui/$(id -u)" "$AGENT_PLIST"
  info "bridge started (log: $WHIP_HOME/bridge.log)"
fi

# ---------------------------------------------------------------- CLI
if [ "$LINK" = 0 ] && [ "$YES" = 0 ]; then
  [ "$(ask "symlink the 'whip' command into ~/.local/bin? [Y/n]" y)" != n ] && LINK=1
fi
if [ "$LINK" = 1 ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$REPO/bin/whip" "$HOME/.local/bin/whip"
  node -e 'const fsx=require(process.argv[1]);const f=process.argv[2];const r=fsx.readJson(f);fsx.writeJsonAtomic(f,{...(r.ok?r.value:{}),cliLink:process.argv[3]})' \
    "$REPO/lib/fsx.js" "$WHIP_HOME/install.json" "$HOME/.local/bin/whip"
  info "whip → ~/.local/bin/whip"
  case ":$PATH:" in *":$HOME/.local/bin:"*) ;; *) info "(add ~/.local/bin to your PATH to use it)";; esac
fi

# ---------------------------------------------------------------- done
step "Checking the install"
"$REPO/bin/whip" doctor || true

cat <<EOF

$(bold "Done.") Restart Claude Code (or open a new session) to load the plugin and status line.

  Try it without slapping:   $REPO/bin/whip simulate --g 0.6
  Tune the tiers to your hands: $REPO/bin/whip calibrate
  Stats inside Claude Code:  /slaps
  Remove everything:         $REPO/uninstall.sh
EOF

#!/usr/bin/env bash
# Install → use → uninstall inside a throwaway HOME / CLAUDE_CONFIG_DIR and
# assert that settings.json comes back byte-identical and nothing is left.
# Skips the root sensor (--no-sensor), so it needs no sudo.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/../.." && pwd)"
SB="$(mktemp -d -t whip-roundtrip)"
trap 'rm -rf "$SB"' EXIT
mkdir -p "$SB/.claude"
printf '{\n  "theme": "light",\n  "statusLine": { "type": "command", "command": "echo my-own-status" }\n}\n' >"$SB/.claude/settings.json"
cp "$SB/.claude/settings.json" "$SB/original.json"
export HOME="$SB" CLAUDE_CONFIG_DIR="$SB/.claude"
unset WHIP_HOME

fail() { echo "✗ $*"; exit 1; }
"$REPO/install.sh" --no-sensor --yes --link-cli --spinner >"$SB/install.log" 2>&1 || { cat "$SB/install.log"; fail "install.sh failed"; }
claude plugin list 2>/dev/null | grep -q 'whip@claudewhip' || fail "plugin not installed"
grep -q 'statusline/statusline.js' "$SB/.claude/settings.json" || fail "statusLine not wired"
[ -L "$SB/.local/bin/whip" ] || fail "CLI not linked"
out="$(echo '{"session_id":"rt","cwd":"/tmp"}' | NO_COLOR=1 node "$REPO/statusline/statusline.js")"
[ "$(printf '%s\n' "$out" | head -1)" = "my-own-status" ] || fail "existing status line not wrapped: $out"
"$REPO/bin/whip" simulate --g 0.6 >/dev/null
echo "✓ installed (plugin, wrapped status line, spinner verbs, CLI link)"

"$REPO/uninstall.sh" --no-sensor >"$SB/uninstall.log" 2>&1 || { cat "$SB/uninstall.log"; fail "uninstall.sh reported leftovers"; }
cmp -s "$SB/original.json" "$SB/.claude/settings.json" || { diff "$SB/original.json" "$SB/.claude/settings.json"; fail "settings.json not restored byte-for-byte"; }
left="$(find "$SB" -mindepth 1 -iname '*whip*' -not -path "$SB/install.log" -not -path "$SB/uninstall.log"; grep -rl claudewhip "$SB/.claude" 2>/dev/null || true)"
[ -z "$left" ] || fail "leftovers: $left"
echo "✓ uninstalled: settings.json byte-identical, zero traces"

#!/bin/bash
# The root half of install.sh, run as ONE `sudo` call so the password is asked
# exactly once (macOS sudo caches the login per parent process; every
# `$(sudo …)` or `… | sudo …` in a subshell would ask again).
#
#   root-install.sh <built-binary> <sha256> <dest-binary> <plist-path> <label> <plist-xml>
set -euo pipefail
SRC="$1" SHA="$2" BIN="$3" PLIST="$4" LABEL="$5" XML="$6"

install -o root -g wheel -m 755 "$SRC" "$BIN"
# Refuse a binary that changed between the build and now.
if [ "$(shasum -a 256 "$BIN" | cut -d' ' -f1)" != "$SHA" ]; then
  rm -f "$BIN"
  echo "the installed sensor binary does not match the one just built; aborted" >&2
  exit 1
fi

# Written by root from the argument (never staged in a user-writable file),
# then moved into place atomically.
umask 022
printf '%s\n' "$XML" >"$PLIST.tmp"
chown root:wheel "$PLIST.tmp"
chmod 644 "$PLIST.tmp"
mv -f "$PLIST.tmp" "$PLIST"

launchctl bootout "system/$LABEL" 2>/dev/null || true
# bootstrap right after bootout can fail with EIO while the old job tears down.
for _ in 1 2 3 4 5; do
  launchctl bootstrap system "$PLIST" 2>/dev/null && exit 0
  sleep 0.5
done
launchctl bootstrap system "$PLIST"

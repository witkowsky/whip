---
description: ClaudeWhip settings — an interactive menu, or set <key> <value> | get <key> | unset <key>
argument-hint: "[set <key> <value> | get <key> | unset <key>]"
allowed-tools: Bash(node:*), AskUserQuestion
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/whip" config $ARGUMENTS`

Arguments: "$ARGUMENTS"

If the arguments are not empty, show me the output above verbatim inside a ```text fenced code block, confirm a changed setting in one short line after it, and stop.

If they are empty, give me a settings menu instead of the dump. Use one AskUserQuestion call with these four single-select questions, putting the current value (from the output above) first and marking it "(current)":
1. header "Sound": Whip crack sound — on / off (key `sound`)
2. header "In chat": What a whip adds to the chat — "Banner + emoji reaction" (banner true, reaction true) / "Banner only" (banner true, reaction false) / "Reaction only" (banner false, reaction true) / "Nothing" (both false)
3. header "Personality": classic / rough / timid / kawaii (butler and custom ones via Other; key `personality`)
4. header "Lane": Show the whip lane and keep whipping / Pause (sensor ignored, lane stays) / Hide and pause everything

For each answer that differs from the current value, run `node "${CLAUDE_PLUGIN_ROOT}/bin/whip" config set <key> <value>`; for Lane use `whip show`, `whip off` or `whip hide` through the same node path. Then reply with one short line listing what changed (or "nothing changed"). Mention once that every other key (thresholds, volume, voice, hardWhip…) is `/whip:config set <key> <value>`.

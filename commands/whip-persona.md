---
description: List or switch ClaudeWhip personalities (classic, rough, timid, kawaii, butler, your own)
argument-hint: "[classic|rough|timid|kawaii|butler|<yours>]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/whip" persona $ARGUMENTS --plain`

Show me the output above verbatim inside a ```text fenced code block. Only if it contains "SWITCHED:" did the personality change; then confirm it in one short line in that personality's voice. Otherwise add nothing, and never claim a switch the output doesn't show.

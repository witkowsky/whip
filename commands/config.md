---
description: Show or change ClaudeWhip settings (tiers, sensitivity, cooldown, sound, target, hard-whip mode)
argument-hint: "[set <key> <value> | get <key> | unset <key>]"
allowed-tools: Bash(node:*)
disable-model-invocation: true
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/whip" config $ARGUMENTS`

Show me the output above verbatim inside a ```text fenced code block. If I changed a setting, confirm it in one short line after the block; otherwise add nothing.

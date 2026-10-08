---
description: Whip Claude by hand — tell it to hurry up (optional message)
argument-hint: "[message]"
allowed-tools: Bash(node:*)
---
!`node "${CLAUDE_PLUGIN_ROOT}/bin/whip" manual --for-prompt --session "${CLAUDE_SESSION_ID}"`

My own words to go with the whip (may be empty): $ARGUMENTS

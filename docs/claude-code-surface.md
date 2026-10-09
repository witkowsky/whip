# Claude Code surface used by ClaudeWhip

Researched 2026-10-08 against the official docs at code.claude.com, then
verified against a real Claude Code **2.1.286** session in tmux (see
`test/e2e/e2e-tmux.js`). "Verified" below means we watched it happen; the rest
is from the docs.

## Status line

Docs: <https://code.claude.com/docs/en/statusline>,
<https://code.claude.com/docs/en/settings-reference#statusline>

- Config: `"statusLine": { "type": "command", "command": "...", "padding": 0, "refreshInterval": 1 }`.
- **Refresh:** event-driven by default (new assistant message, `/compact`,
  permission/vim mode change, ...), debounced 300 ms. `refreshInterval`
  (seconds, minimum 1, since 2.1.97) adds a timer. ClaudeWhip sets it to 1 so a
  slap shows up even while Claude is idle. *Verified: the lane changes within
  ~1 s of `whip simulate` on an idle session.*
- **Multi-line:** each printed line is a row. *Verified: two rows.*
- **ANSI colours:** supported. OSC 8 links also work, but we don't use them.
- **stdin JSON:** `session_id`, `transcript_path`, `cwd`, `model.{id,display_name}`,
  `workspace.{current_dir,project_dir,added_dirs,git_worktree,repo}`, `version`,
  `output_style`, `cost`, `context_window`, `rate_limits`, `effort`, `vim`, ...
  We use `session_id`, `cwd`/`workspace.current_dir`, `model`, `transcript_path`
  and `version`. We record `version` to choose the Stop-hook mechanism (see below).
- **Environment:** the command inherits Claude Code's env, so `TMUX`/`TMUX_PANE`
  tell us whether the session can be hard-whipped.
- Output shows only on exit 0 with non-empty stdout. The line is blank until
  workspace trust is accepted, and hidden during permission prompts.
- **Plugins cannot ship a `statusLine`.** Plugin `settings.json` honours only
  `agent` and `subagentStatusLine`
  (<https://code.claude.com/docs/en/plugins/components#default-settings>). So
  `install.sh` merges `statusLine` into `~/.claude/settings.json` (after a
  byte-exact backup) and offers to *wrap* an existing one.

## Hooks

Docs: <https://code.claude.com/docs/en/hooks>, <https://code.claude.com/docs/en/hooks-guide>

| Event | What ClaudeWhip does | Output used |
|---|---|---|
| `SessionStart` | heartbeat `sessions/<id>.json` (cwd, tmux pane/socket) | none |
| `UserPromptSubmit` | mark busy; deliver a whip that landed while idle (skipped for `/slash` prompts) | `hookSpecificOutput.additionalContext` + `systemMessage` |
| `PreToolUse` | mark "working" (face `(•̀ᴗ•́)و`); deliver a pending whip | slap: `additionalContext` (non-blocking); WALLOP or `softMode: deny`: `permissionDecision: "deny"` + `permissionDecisionReason` |
| `PostToolUse` / `PostToolUseFailure` | clear "working"; deliver a pending whip | `additionalContext` + `systemMessage` |
| `Stop` | deliver once, respecting `stop_hook_active` | ≥ 2.1.163: `hookSpecificOutput.additionalContext` (continues the turn, labelled "Stop hook feedback"); older: `decision: "block"` + `reason` (labelled "Stop hook error") |
| `Notification` (`permission_prompt`, `idle_prompt`, `elicitation_dialog`) | disarm the hard whip while a dialog or idle prompt is up | none |
| `SessionEnd` | delete the session file | none |

Facts we rely on:

- **Exit codes:** 0 means JSON on stdout is parsed. 2 blocks. Anything else is
  a non-blocking error. Our hook always exits 0 and prints at most one JSON
  object. A crash never blocks Claude.
- **`additionalContext` on `PreToolUse`** (since 2.1.9) arrives as a system
  reminder next to the tool result, *without* blocking the call, as long as no
  `permissionDecision` is set. *Verified: the model receives "PostToolUse:Bash
  hook additional context: ⚡ WHIP ...".*
- **`systemMessage`** is shown to the user and is not sent to the model. It
  renders in the transcript as `<Event> says: <text>`, including multi-line text.
  *Verified.* This is the transcript banner.
- **Stop:** `stop_hook_active` is true while Claude is already continuing
  because of a Stop hook. We never block twice in a row. Claude Code also caps
  consecutive continuations at 8.
- **Injected text should read as facts, not system-style imperatives.** The
  docs warn that the latter can trip prompt-injection defences. So the message
  says what the user did and what they want, not "SYSTEM: obey".
- **Timeouts:** the default is 600 s. We set 5 s. *Measured: ~31 ms median end to end per hook, including ~21 ms of Node startup.*
- **Env:** `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA` are available to plugin
  hooks. Hooks inherit Claude Code's environment, including `TMUX_PANE`.
- **UserPromptSubmit** receives the raw `/whip:slaps` text for slash commands.
  *Verified via the `slash: true` hook-log field.*

## Plugins and slash commands

Docs: <https://code.claude.com/docs/en/plugins/manifest-reference>,
<https://code.claude.com/docs/en/plugins/components>,
<https://code.claude.com/docs/en/plugins/marketplace-reference>,
<https://code.claude.com/docs/en/skills#frontmatter-reference>

- **Layout:** `.claude-plugin/plugin.json`, `hooks/hooks.json` (top-level
  `"hooks"`), `commands/*.md`. The repo root is the plugin, and
  `.claude-plugin/marketplace.json` makes it its own local marketplace
  (`claude plugin marketplace add <repo>` then `claude plugin install whip@claudewhip`).
- **Plugin install copies the plugin** into
  `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`, without `.git`.
  `claude plugin uninstall` leaves that copy behind (marked `.orphaned_at`)
  and leaves empty `enabledPlugins` / `extraKnownMarketplaces` objects in
  settings.json. `uninstall.sh` cleans up both. *Verified in a sandboxed HOME.*
- **Commands are namespaced** `/<plugin>:<file>`, so ours are `/whip:whip`,
  `/whip:slaps`, `/whip:config`, `/whip:on`, `/whip:off`, `/whip:persona`, `/whip:hide`, `/whip:show`.
  Typing `/slaps` + Enter autocompletes to `/whip:slaps`. *Verified.*
- **Command bodies** support `` !`cmd` `` bash injection, `$ARGUMENTS`,
  `${CLAUDE_PLUGIN_ROOT}` and `${CLAUDE_SESSION_ID}`. Frontmatter `allowed-tools`
  and `disable-model-invocation` are honoured.
- **Plugin `bin/`** is added to the Bash tool's PATH, not to your shell, so
  `install.sh --link-cli` symlinks `whip` into `~/.local/bin` instead.
- **Development:** `claude --plugin-dir <repo>` loads the plugin without
  installing it. `claude --settings <file>` merges extra settings for one
  session. We use both in the e2e test so `~/.claude` is untouched.

## Spinner

Docs: <https://code.claude.com/docs/en/settings-reference#spinnerverbs>

`"spinnerVerbs": { "mode": "append" | "replace", "verbs": [...] }` (since
2.1.23). Plugins can't set it. `install.sh --spinner` adds a static,
append-mode list ("Hurrying", "Sweating", "Flinching", "Shipping it", ...) and
the uninstaller removes it. We never rewrite settings at runtime.

## Interrupts (hard whip)

Docs: <https://code.claude.com/docs/en/interactive-mode>

- **Esc** stops the current response or tool call and keeps work done so far.
  There are no official docs for driving the TUI via tmux.
  *Verified: `tmux send-keys Escape` interrupts a running Bash tool ("Interrupted
  · What should Claude do instead?"), and the text typed with `send-keys -l` +
  Enter is submitted as the next prompt.*
- **Don't send Esc twice.** A double Esc opens the rewind menu.
- **Claude Code 2.1.286 refuses long foreground `sleep`** commands ("blocks long
  foreground sleeps by design"). The e2e test uses `ping -c 30` as its slow
  command instead.

## Not used, but worth knowing

- **Mods** (function-hook plugins with `hooks/register.tsx`, live panes and
  bands above the prompt) need Claude Code **2.1.287+** in the terminal. This
  machine has 2.1.286. A future version could draw the whip lane as a band
  above the prompt instead of in the status line.
- **`terminalSequence`** in hook output can emit OSC 9 desktop notifications
  (interactive sessions only).
- **`asyncRewake`** hooks could wake Claude from idle. We deliberately don't
  wake an idle Claude for a slap.

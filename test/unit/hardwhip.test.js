'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpHome, cfg } = require('../helpers');
const hw = require('../../lib/hardwhip');
const { reallyBusy } = require('../../lib/deliver');

// A fake tmux that records its argv, so we can assert the exact key sequence.
function fakeTmux(dir) {
  const logFile = path.join(dir, 'tmux.calls');
  const bin = path.join(dir, 'tmux');
  fs.writeFileSync(bin, `#!/bin/sh\nprintf '%s\\n' "$*" >> "${logFile}"\ncase "$*" in *display-message*) echo "%9";; esac\n`, { mode: 0o755 });
  return { bin, calls: () => fs.readFileSync(logFile, 'utf8').trim().split('\n') };
}

test('tmux hard whip: Escape, pause, literal text, Enter, on the right socket and pane', () => {
  const dir = tmpHome();
  const t = fakeTmux(dir);
  process.env.WHIP_TMUX = t.bin;
  const pauses = [];
  const r = hw.hardWhip({ id: 's', busy: true, tmuxPane: '%9', tmuxSocket: '/tmp/tmux-501/default' }, 'hurry "up"\nnow', cfg(), { sleep: (ms) => pauses.push(ms) });
  delete process.env.WHIP_TMUX;
  assert.deepEqual(r, { ok: true, via: 'tmux', pane: '%9' });
  assert.deepEqual(t.calls(), [
    '-S /tmp/tmux-501/default display-message -p -t %9 #{pane_id}',
    '-S /tmp/tmux-501/default send-keys -t %9 Escape',
    '-S /tmp/tmux-501/default send-keys -t %9 -l hurry "up" now',
    '-S /tmp/tmux-501/default send-keys -t %9 Enter',
  ]);
  assert.ok(pauses[0] >= 300, 'waits for the TUI to settle after Escape');
});

test('hard whip refuses idle sessions, missing panes and "off"', () => {
  assert.match(hw.hardWhip({ busy: false, tmuxPane: '%1' }, 'x', cfg()).why, /idle/);
  assert.match(hw.hardWhip({ busy: true }, 'x', cfg()).why, /not in tmux/);
  assert.match(hw.hardWhip({ busy: true, tmuxPane: '%1' }, 'x', cfg({ hardWhip: 'off' })).why, /off/);
  assert.match(hw.hardWhip(null, 'x', cfg()).why, /no target/);
});

test('osascript fallback only types into a known terminal that shows Claude Code', () => {
  assert.equal(hw.isClaudeTerminal({ app: 'iTerm2', title: '✳ Fix login bug' }).ok, true);
  assert.equal(hw.isClaudeTerminal({ app: 'Terminal', title: 'claude — 120×40' }).ok, true);
  assert.equal(hw.isClaudeTerminal({ app: 'ghostty', title: 'claude' }).ok, true);
  assert.equal(hw.isClaudeTerminal({ app: 'kitty', title: 'claude code' }).ok, true);
  assert.equal(hw.isClaudeTerminal({ app: 'WezTerm', title: '✳ refactor' }).ok, true);
  assert.match(hw.isClaudeTerminal({ app: 'Slack', title: 'claude' }).why, /not a supported terminal/);
  assert.match(hw.isClaudeTerminal({ app: 'iTerm2', title: 'vim notes.md' }).why, /does not look like Claude Code/);
});

test('AppleScript strings are escaped', () => {
  assert.equal(hw.asString('say "hi" \\ bye'), '"say \\"hi\\" \\\\ bye"');
});

test('hard-whip text names the WALLOP and asks for a concrete status', () => {
  const t = hw.hardText({ slapNo: 9, g: 1.234, combo: 3, line: 'Halt and summarise.' });
  assert.match(t, /^💥 WALLOP #9 \(1\.23g, combo x3\)/);
  assert.match(t, /three bullets: done, left, fastest way to finish/);
});

test('busy detection: stale busy flags and permission prompts disarm the hard whip', () => {
  const now = Date.now();
  assert.equal(reallyBusy({ busy: true, lastActive: now - 1000 }, now), true);
  assert.equal(reallyBusy({ busy: true, lastActive: now - 10 * 60000 }, now), false, 'Esc skipped Stop long ago');
  assert.equal(reallyBusy({ busy: true, lastActive: now - 10 * 60000, tool: { since: now - 5 * 60000 } }, now), true, 'long tool still running');
  assert.equal(reallyBusy({ busy: true, lastActive: now, awaiting: 'permission_prompt' }, now), false);
});

test('osascript: with a known session tty, Terminal/iTerm2 must show that exact tab', () => {
  const s = { tty: '/dev/ttys003' };
  const front = { app: 'iTerm2', title: '✳ Fix login' };
  assert.equal(hw.osascriptTarget(front, s, () => '/dev/ttys003').ok, true);
  assert.match(hw.osascriptTarget(front, s, () => '/dev/ttys009').why, /Claude session is on \/dev\/ttys003/);
  assert.match(hw.osascriptTarget({ app: 'Terminal', title: 'claude' }, s, () => null).why, /unknown/);
  // terminals without a tty API fall back to the title check
  assert.equal(hw.osascriptTarget({ app: 'kitty', title: 'claude' }, s, () => { throw new Error('not called'); }).ok, true);
  assert.equal(hw.osascriptTarget({ app: 'Slack', title: 'claude' }, s).ok, false);
});

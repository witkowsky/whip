'use strict';
// Hard whip = a real interrupt. Only for WALLOPs, only when the target session
// is mid-turn (an idle prompt might hold the user's half-typed draft), and only
// into a terminal we can positively identify as running Claude Code.
const { spawnSync } = require('child_process');
const fs = require('fs');

const TMUX_CANDIDATES = ['/opt/homebrew/bin/tmux', '/usr/local/bin/tmux', '/usr/bin/tmux'];
// Frontmost-app names (as System Events reports them) we are willing to type into.
const TERMINALS = ['iTerm2', 'Terminal', 'Ghostty', 'ghostty', 'WezTerm', 'wezterm-gui', 'kitty'];

function findTmux() {
  if (process.env.WHIP_TMUX) return process.env.WHIP_TMUX;
  for (const p of TMUX_CANDIDATES) if (fs.existsSync(p)) return p;
  const r = spawnSync('/bin/sh', ['-c', 'command -v tmux'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

function oneLine(text) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 600);
}

function tmuxArgs(session) {
  return session.tmuxSocket ? ['-S', session.tmuxSocket] : [];
}

function tmuxPaneAlive(tmux, session) {
  const r = spawnSync(tmux, [...tmuxArgs(session), 'display-message', '-p', '-t', session.tmuxPane, '#{pane_id}'], { encoding: 'utf8', timeout: 1500 });
  return r.status === 0 && r.stdout.trim() === session.tmuxPane;
}

/**
 * Escape (Claude Code's documented interrupt), a short pause so the TUI
 * settles, then the message typed literally (-l) and Enter.
 */
function viaTmux(session, text, { sleep } = {}) {
  if (!session.tmuxPane) return { ok: false, why: 'session is not in tmux' };
  const tmux = findTmux();
  if (!tmux) return { ok: false, why: 'tmux not found' };
  if (!tmuxPaneAlive(tmux, session)) return { ok: false, why: `tmux pane ${session.tmuxPane} not found` };
  const base = [...tmuxArgs(session), 'send-keys', '-t', session.tmuxPane];
  const run = (args) => spawnSync(tmux, [...base, ...args], { timeout: 1500 });
  if (run(['Escape']).status !== 0) return { ok: false, why: 'send-keys Escape failed' };
  (sleep || require('./fsx').sleepSync)(600);
  run(['-l', oneLine(text)]);
  (sleep || require('./fsx').sleepSync)(150);
  run(['Enter']);
  return { ok: true, via: 'tmux', pane: session.tmuxPane };
}

function osa(script, timeout = 2500) {
  return spawnSync('/usr/bin/osascript', ['-e', script], { encoding: 'utf8', timeout });
}

function frontmost() {
  const r = osa(
    'tell application "System Events"\n' +
      'set p to first application process whose frontmost is true\n' +
      'set n to name of p\n' +
      'set t to ""\n' +
      'try\n set t to name of front window of p\n end try\n' +
      'return n & "\\t" & t\n' +
      'end tell',
  );
  if (r.status !== 0) return { ok: false, why: (r.stderr || '').trim() || 'osascript failed' };
  const [app, title = ''] = r.stdout.replace(/\n$/, '').split('\t');
  return { ok: true, app, title };
}

// AppleScript string literal.
function asString(s) {
  return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
}

// Terminal.app and iTerm2 expose the front tab's tty over AppleScript; with
// the session's tty (recorded at SessionStart) we can insist on the exact tab.
const TTY_SCRIPTS = {
  Terminal: 'tell application "Terminal" to get tty of selected tab of front window',
  iTerm2: 'tell application "iTerm2" to get tty of current session of current window',
};

function frontTty(app) {
  const script = TTY_SCRIPTS[app];
  if (!script) return null;
  const r = osa(script);
  return r.status === 0 ? r.stdout.trim() : null;
}

/** Pure decision: may we type into this frontmost window for this session? */
function osascriptTarget(front, session, getTty = frontTty) {
  const check = isClaudeTerminal(front);
  if (!check.ok) return check;
  if (session && session.tty && TTY_SCRIPTS[front.app]) {
    const tty = getTty(front.app);
    if (tty !== session.tty) return { ok: false, why: `front ${front.app} tab is ${tty || 'unknown'}, the Claude session is on ${session.tty}` };
  }
  return { ok: true };
}

function isClaudeTerminal(front) {
  if (!TERMINALS.includes(front.app)) return { ok: false, why: `frontmost app is ${front.app}, not a supported terminal` };
  // Claude Code sets the terminal title (e.g. "✳ Fix login bug"); some setups show "claude".
  if (!/claude|✳/i.test(front.title)) return { ok: false, why: `front window "${front.title}" does not look like Claude Code` };
  return { ok: true };
}

/** Needs Accessibility permission for the process running this (the bridge's node). */
function viaOsascript(text, session) {
  const front = frontmost();
  if (!front.ok) return front;
  const check = osascriptTarget(front, session);
  if (!check.ok) return check;
  const r = osa(
    'tell application "System Events"\n' +
      'key code 53\n' + // Escape
      'delay 0.6\n' +
      `keystroke ${asString(oneLine(text))}\n` +
      'delay 0.15\n' +
      'key code 36\n' + // Return
      'end tell',
    6000,
  );
  if (r.status !== 0) return { ok: false, why: (r.stderr || '').trim() || 'keystroke failed (Accessibility permission?)' };
  return { ok: true, via: 'osascript', app: front.app };
}

function hardWhip(session, text, cfg, opts = {}) {
  if (cfg.hardWhip === 'off') return { ok: false, why: 'hardWhip is off' };
  if (!session) return { ok: false, why: 'no target session' };
  if (!session.busy) return { ok: false, why: 'session is idle (would clobber your draft)' };
  if (cfg.hardWhip === 'tmux') return viaTmux(session, text, opts);
  if (cfg.hardWhip === 'osascript') return viaOsascript(text, session);
  return { ok: false, why: `unknown hardWhip mode ${cfg.hardWhip}` };
}

function hardText(w) {
  const combo = w.combo >= 2 ? `, combo x${w.combo}` : '';
  return `💥 WALLOP #${w.slapNo} (${w.g.toFixed(2)}g${combo}) — "${w.line}" I hit the laptop because this is taking too long. Stop and give me three bullets: done, left, fastest way to finish. Then continue with only that plan.`;
}

module.exports = { hardWhip, hardText, viaTmux, viaOsascript, frontmost, isClaudeTerminal, osascriptTarget, findTmux, TERMINALS, asString };

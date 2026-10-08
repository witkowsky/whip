#!/usr/bin/env node
'use strict';
// End-to-end: start a real Claude Code session inside tmux with this plugin
// (--plugin-dir) and the whip status line (--settings), simulate hits, and
// assert on the hook log, the session state and the rendered screen.
//
//   node test/e2e/e2e-tmux.js [--model haiku] [--keep]
//
// Uses your Claude Code login (a handful of short turns on the chosen model).
// Touches nothing in ~/.claude except trusting one temp folder.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const args = process.argv.slice(2);
const MODEL = args.includes('--model') ? args[args.indexOf('--model') + 1] : process.env.WHIP_E2E_MODEL || 'haiku';
const KEEP = args.includes('--keep');
const SOCK = `whip-e2e-${process.pid}`; // tmux -L name: short socket path

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-e2e-'));
const whipHome = path.join(dir, 'whip');
const proj = path.join(dir, 'proj');
const LOG = path.join(whipHome, 'hooks.log');
fs.mkdirSync(proj, { recursive: true });
fs.mkdirSync(whipHome, { recursive: true });
spawnSync('git', ['init', '-q'], { cwd: proj });
fs.writeFileSync(path.join(proj, 'README.md'), '# scratch project for the ClaudeWhip e2e test\n');
const settingsFile = path.join(dir, 'settings.json');
fs.writeFileSync(settingsFile, JSON.stringify({ statusLine: { type: 'command', command: `node "${ROOT}/statusline/statusline.js"`, refreshInterval: 1 } }));

let failures = 0;
const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => {
  failures++;
  console.log(`\x1b[31m✗\x1b[0m ${m}`);
};
const check = (cond, m) => (cond ? ok(m) : bad(m));

function tmux(...a) {
  return spawnSync('tmux', ['-L', SOCK, ...a], { encoding: 'utf8' });
}
function screen(history = 0) {
  return tmux('capture-pane', '-p', '-t', 'e2e', ...(history ? ['-S', `-${history}`] : [])).stdout || '';
}
function type(text) {
  tmux('send-keys', '-t', 'e2e', '-l', text);
  sleep(400);
  tmux('send-keys', '-t', 'e2e', 'Enter');
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
function log() {
  try {
    return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  } catch {
    return [];
  }
}
function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    sleep(250);
  }
  bad(`timed out waiting for ${what}`);
  console.log(screen().split('\n').filter((l) => l.trim()).slice(-15).map((l) => `    | ${l}`).join('\n'));
  return null;
}
function whip(...a) {
  return spawnSync(process.execPath, [path.join(ROOT, 'bin/whip'), ...a], { encoding: 'utf8', env: { ...process.env, WHIP_HOME: whipHome, NO_COLOR: '1' } }).stdout.trim();
}
function since(n, pred) {
  return log().slice(n).find(pred);
}

function cleanup() {
  tmux('kill-server');
  if (!KEEP && !failures) fs.rmSync(dir, { recursive: true, force: true });
  else console.log(`artifacts kept in ${dir}`);
}

function main() {
  if (spawnSync('tmux', ['-V']).status !== 0) {
    console.log('tmux not installed; skipping');
    return;
  }
  console.log(`ClaudeWhip e2e · model ${MODEL} · ${dir}`);
  const cmd = `claude --plugin-dir "${ROOT}" --settings "${settingsFile}" --allowedTools Bash --model ${MODEL}`;
  tmux('new-session', '-d', '-s', 'e2e', '-x', '170', '-y', '50', '-e', `WHIP_HOME=${whipHome}`, '-e', 'WHIP_LOG=all', '-c', proj, cmd);

  // Folder trust dialog for the fresh temp project ("❯ No, exit" is preselected).
  const first = waitFor(() => (/Yes, I trust this folder/.test(screen()) || /^❯ /m.test(screen())) && screen(), 30000, 'Claude Code to start');
  if (first && /Yes, I trust this folder/.test(first)) {
    sleep(500);
    tmux('send-keys', '-t', 'e2e', 'Down');
    sleep(500);
    tmux('send-keys', '-t', 'e2e', 'Enter');
  }

  // 1. SessionStart + status line
  const start = waitFor(() => log().find((l) => l.ev === 'SessionStart'), 30000, 'SessionStart hook');
  if (!start) return;
  const SID = start.session;
  ok(`SessionStart hook fired (${start.ms} ms)`);
  check(waitFor(() => /no slaps yet/.test(screen()), 15000, 'status line'), 'status line shows the whip lane (2 lines)');

  // 2. Phase 2 demo: whip simulate --g 0.3 / 0.6 / 1.2 visibly changes the status line
  whip('simulate', '--g', '0.3', '--no-hard');
  check(waitFor(() => /tap!/.test(screen()), 4000, 'tap on status line'), 'simulate --g 0.3 → status line flashes a tap');
  sleep(500);
  whip('simulate', '--g', '0.6', '--no-hard');
  check(waitFor(() => /WHACK!|whoosh/.test(screen()), 4000, 'slap on status line'), 'simulate --g 0.6 → whip travels on the status line');
  sleep(500);
  whip('simulate', '--g', '1.2', '--no-hard');
  check(waitFor(() => /WALLOP!!|whoosh/.test(screen()) && /combo x3/.test(screen()), 4000, 'wallop'), 'simulate --g 1.2 → WALLOP with combo x3');
  check(waitFor(() => /whip queued/.test(screen()), 4000, 'queued marker'), 'idle session shows "whip queued"');

  // 3. The queued whip arrives with the next prompt; a slap mid tool-chain lands on the next tool hook.
  let n = log().length;
  type('Run these three shell commands one at a time, as three separate Bash tool calls: `sleep 3; echo one`, `sleep 3; echo two`, `sleep 3; echo three`. After that, say what you did in one short sentence.');
  const ups = waitFor(() => since(n, (l) => l.ev === 'UserPromptSubmit'), 20000, 'UserPromptSubmit');
  check(ups && ups.delivered, 'idle whip delivered with the next prompt (UserPromptSubmit additionalContext)');
  waitFor(() => since(n, (l) => l.ev === 'PreToolUse'), 60000, 'first tool call');
  sleep(800);
  const n2 = log().length;
  whip('simulate', '--g', '0.62', '--session', SID);
  const tooled = waitFor(() => since(n2, (l) => (l.ev === 'PostToolUse' || l.ev === 'PreToolUse') && l.delivered), 30000, 'tool hook delivery');
  check(tooled, `slap delivered on ${tooled ? tooled.ev : '?'} (non-blocking)`);
  check(waitFor(() => /says: ⟿～+💥\s+WHACK!/.test(screen(200)), 8000, 'banner'), 'transcript banner rendered (systemMessage)');
  waitFor(() => since(n2, (l) => l.ev === 'Stop'), 90000, 'turn end');

  // 4. Stop: a slap during a no-tool answer blocks the stop once; Claude reacts.
  n = log().length;
  type('Without using any tools, write a numbered list of 30 animals, one per line, each with a short habitat note.');
  waitFor(() => since(n, (l) => l.ev === 'UserPromptSubmit'), 20000, 'prompt');
  sleep(1500);
  whip('simulate', '--g', '0.7', '--session', SID);
  const stop = waitFor(() => since(n, (l) => l.ev === 'Stop' && l.delivered), 90000, 'Stop delivery');
  check(stop, 'Stop hook delivered the whip and continued the turn');
  const stop2 = waitFor(() => since(n, (l) => l.ev === 'Stop' && l.stopActive), 60000, 'second Stop');
  check(stop2 && !stop2.delivered, 'second Stop saw stop_hook_active and did not force another continuation');
  sleep(1500);
  const s = screen(400);
  check(/Stop hook feedback: ⚡ WHIP|Stop hook error: ⚡ WHIP/.test(s), 'Claude received the whip as Stop hook feedback');
  /ok ok|\(×﹏×\)|\(@_@\)/.test(s) ? ok('Claude flinched ("ok ok")') : console.log('  (Claude did not flinch this time; model-dependent, not a failure)');

  // 5. Hard whip: a WALLOP while a foreground tool runs → Esc + typed message via tmux.
  n = log().length;
  type('Run this exact command with the Bash tool in the foreground and wait for it to finish: ping -c 30 -i 1 127.0.0.1 > /dev/null; echo finished');
  waitFor(() => since(n, (l) => l.ev === 'PreToolUse'), 60000, 'ping tool call');
  sleep(3000);
  const hard = whip('simulate', '--g', '1.3', '--session', SID);
  check(/hard whip via tmux/.test(hard), `WALLOP sent a hard whip (${hard.replace(/\s+/g, ' ')})`);
  check(waitFor(() => /Interrupted/.test(screen(200)), 8000, 'interrupt'), 'Claude was interrupted (Esc)');
  const typed = waitFor(() => since(n, (l) => l.ev === 'UserPromptSubmit' && l.delivered), 15000, 'typed WALLOP prompt');
  check(typed, 'typed WALLOP message submitted; UserPromptSubmit showed the banner only');
  check(waitFor(() => /W A L L O P/.test(screen(200)), 8000, 'big banner'), 'big WALLOP banner rendered');
  waitFor(() => since(n, (l) => l.ev === 'Stop'), 90000, 'turn end');

  // 6. Slash commands: /whip with a message, then /slaps
  n = log().length;
  type('/whip:whip no tools, just answer in one short line');
  const manual = waitFor(() => since(n, (l) => l.ev === 'UserPromptSubmit' && l.delivered), 20000, '/whip delivery');
  check(manual && manual.slash, '/whip recorded a manual whip and the hook showed its banner');
  check(waitFor(() => /manual · "/.test(screen(120)), 8000, 'manual banner'), 'manual whip banner rendered');
  waitFor(() => since(n, (l) => l.ev === 'Stop'), 60000, 'turn end');
  check(!since(n, (l) => l.ev === 'Stop' && l.delivered), 'no double delivery of the /whip whip at Stop');
  type('/slaps');
  check(waitFor(() => /slap stats/.test(screen(120)) && /all time/.test(screen(120)), 40000, '/slaps output'), '/slaps (→ /whip:slaps) shows the stats screen');
  const slapsLog = log().reverse().find((l) => l.ev === 'UserPromptSubmit');
  check(slapsLog && slapsLog.slash && !slapsLog.delivered, 'slash commands never carry a whip');

  // 7. Exit
  type('/exit');
  check(waitFor(() => log().some((l) => l.ev === 'SessionEnd'), 15000, 'SessionEnd'), 'SessionEnd hook fired');
  const { sessionFile } = (process.env.WHIP_HOME = whipHome, require('../../lib/paths'));
  check(!fs.existsSync(sessionFile(SID)), 'session file cleaned up');

  const slow = log().filter((l) => l.ms > 200);
  check(!slow.length, `every hook finished in < 200 ms (max ${Math.max(...log().map((l) => l.ms || 0))} ms)`);
}

try {
  main();
} catch (err) {
  bad(String(err && err.stack));
} finally {
  cleanup();
}
console.log(failures ? `\n${failures} e2e check(s) failed` : '\nall e2e checks passed');
process.exit(failures ? 1 : 0);

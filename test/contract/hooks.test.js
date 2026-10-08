'use strict';
// Contract tests: run the real hook script with stdin shaped like the
// documented hook input (https://code.claude.com/docs/en/hooks) and check
// stdout against the documented output schema for each event.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { tmpHome, ROOT } = require('../helpers');

const HOOK = path.join(ROOT, 'hooks/hook.js');
const WHIP = path.join(ROOT, 'bin/whip');

// --- documented output schema (subset we may emit) -------------------------
const TOP = new Set(['continue', 'stopReason', 'suppressOutput', 'systemMessage', 'decision', 'reason', 'hookSpecificOutput']);
const DECISION_EVENTS = new Set(['UserPromptSubmit', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SubagentStop', 'PreCompact', 'ConfigChange']);
const HSO = {
  PreToolUse: new Set(['hookEventName', 'permissionDecision', 'permissionDecisionReason', 'updatedInput', 'additionalContext']),
  PostToolUse: new Set(['hookEventName', 'additionalContext', 'updatedMCPToolOutput', 'updatedToolOutput']),
  PostToolUseFailure: new Set(['hookEventName', 'additionalContext']),
  UserPromptSubmit: new Set(['hookEventName', 'additionalContext', 'sessionTitle']),
  SessionStart: new Set(['hookEventName', 'additionalContext']),
  Stop: new Set(['hookEventName', 'additionalContext']),
};

function validate(event, out) {
  for (const k of Object.keys(out)) assert.ok(TOP.has(k), `unknown top-level key ${k}`);
  if ('systemMessage' in out) assert.equal(typeof out.systemMessage, 'string');
  if ('decision' in out) {
    assert.ok(DECISION_EVENTS.has(event), `decision not valid on ${event}`);
    assert.equal(out.decision, 'block');
    assert.equal(typeof out.reason, 'string');
    assert.ok(out.reason.length > 0);
  }
  if (out.hookSpecificOutput) {
    const h = out.hookSpecificOutput;
    assert.equal(h.hookEventName, event, 'hookEventName must match the event');
    for (const k of Object.keys(h)) assert.ok(HSO[event] && HSO[event].has(k), `${k} not allowed in ${event} hookSpecificOutput`);
    if ('permissionDecision' in h) {
      assert.ok(['allow', 'deny', 'ask', 'defer'].includes(h.permissionDecision));
      assert.equal(typeof h.permissionDecisionReason, 'string');
    }
    if ('additionalContext' in h) assert.equal(typeof h.additionalContext, 'string');
  }
}

// --- documented input shapes ------------------------------------------------
function input(event, extra = {}) {
  const base = { session_id: 'c0ffee00-0000-4000-8000-000000000001', transcript_path: '/tmp/t.jsonl', cwd: '/Users/me/proj', permission_mode: 'default', hook_event_name: event };
  const per = {
    SessionStart: { source: 'startup', model: 'claude-opus-5-5' },
    UserPromptSubmit: { prompt: 'fix the login bug' },
    PreToolUse: { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: 'toolu_1' },
    PostToolUse: { tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '' }, tool_use_id: 'toolu_1' },
    PostToolUseFailure: { tool_name: 'Bash', tool_input: { command: 'false' }, tool_use_id: 'toolu_2', error: 'exit 1' },
    Stop: { stop_hook_active: false, last_assistant_message: 'done' },
    SessionEnd: { reason: 'prompt_input_exit' },
  };
  return { ...base, ...per[event], ...extra };
}

function hook(event, inp, env = {}) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [HOOK, event], { input: typeof inp === 'string' ? inp : JSON.stringify(inp), encoding: 'utf8', env: { ...process.env, ...env } });
  const ms = Date.now() - t0;
  assert.equal(r.status, 0, `hook must exit 0 (stderr: ${r.stderr})`);
  const out = r.stdout.trim();
  if (!out) return { out: null, ms };
  assert.ok(out.startsWith('{') && out.endsWith('}'), 'stdout must be a single JSON object');
  const parsed = JSON.parse(out);
  validate(event, parsed);
  return { out: parsed, ms };
}

function whip(...args) {
  const r = spawnSync(process.execPath, [WHIP, ...args], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

const SID = 'c0ffee00-0000-4000-8000-000000000001';

function sessionJson() {
  const { sessionFile } = require('../../lib/paths');
  return JSON.parse(fs.readFileSync(sessionFile(SID), 'utf8'));
}

test('SessionStart: silent, records the session with its tmux pane', () => {
  tmpHome();
  const { out } = hook('SessionStart', input('SessionStart'), { TMUX: '/tmp/tmux-501/default,123,0', TMUX_PANE: '%7' });
  assert.equal(out, null);
  const s = sessionJson();
  assert.equal(s.cwd, '/Users/me/proj');
  assert.equal(s.tmuxPane, '%7');
  assert.equal(s.tmuxSocket, '/tmp/tmux-501/default');
  assert.equal(s.busy, false);
});

test('no pending whip: every event prints nothing', () => {
  tmpHome();
  for (const ev of ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop']) {
    assert.equal(hook(ev, input(ev)).out, null, ev);
  }
});

test('PreToolUse + slap: non-blocking additionalContext and a transcript banner', () => {
  tmpHome();
  hook('UserPromptSubmit', input('UserPromptSubmit'));
  whip('simulate', '--g', '0.6', '--session', SID);
  const { out } = hook('PreToolUse', input('PreToolUse'));
  assert.ok(out.hookSpecificOutput.additionalContext.includes('⚡ WHIP'));
  assert.ok(!('permissionDecision' in out.hookSpecificOutput), 'a slap must not block or auto-allow the tool');
  assert.match(out.systemMessage, /WHACK!/);
  assert.equal(hook('PreToolUse', input('PreToolUse')).out, null, 'consumed exactly once');
  assert.equal(sessionJson().tool.name, 'Bash');
});

test('PreToolUse + WALLOP: denies that one tool call with the reason', () => {
  tmpHome();
  hook('UserPromptSubmit', input('UserPromptSubmit'));
  whip('simulate', '--g', '1.3', '--session', SID, '--no-hard');
  const { out } = hook('PreToolUse', input('PreToolUse'));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /💥 WALLOP/);
  assert.match(out.systemMessage, /W A L L O P/);
});

test('softMode=deny makes slaps block the next tool call too', () => {
  tmpHome();
  whip('config', 'set', 'softMode', 'deny');
  hook('UserPromptSubmit', input('UserPromptSubmit'));
  whip('simulate', '--g', '0.6', '--session', SID);
  const { out } = hook('PreToolUse', input('PreToolUse'));
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('PostToolUse: delivers as additionalContext (tool already ran) and clears the working state', () => {
  tmpHome();
  hook('PreToolUse', input('PreToolUse'));
  whip('simulate', '--g', '0.6', '--session', SID);
  const { out } = hook('PostToolUse', input('PostToolUse'));
  assert.match(out.hookSpecificOutput.additionalContext, /WHIP/);
  assert.equal(sessionJson().tool, undefined);
});

test('PostToolUseFailure is handled like PostToolUse', () => {
  tmpHome();
  whip('simulate', '--g', '0.6', '--session', SID);
  const { out } = hook('PostToolUseFailure', input('PostToolUseFailure'));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure');
});

test('Stop: blocks once with the reason; respects stop_hook_active', () => {
  tmpHome();
  hook('UserPromptSubmit', input('UserPromptSubmit'));
  whip('simulate', '--g', '0.6', '--session', SID);
  // Already continuing because of a stop hook: never force a second continuation.
  assert.equal(hook('Stop', input('Stop', { stop_hook_active: true })).out, null);
  assert.ok(sessionJson().pending, 'whip stays pending for later');
  const { out } = hook('Stop', input('Stop'));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /What they want now:/);
  assert.equal(sessionJson().busy, true, 'Claude keeps going after a block');
  assert.equal(hook('Stop', input('Stop')).out, null, 'at most one forced continuation per whip');
  assert.equal(sessionJson().busy, false);
});

test('UserPromptSubmit: a whip that landed while idle arrives with the next prompt', () => {
  tmpHome();
  hook('Stop', input('Stop'));
  whip('simulate', '--g', '0.6', '--session', SID);
  const { out } = hook('UserPromptSubmit', input('UserPromptSubmit'));
  assert.match(out.hookSpecificOutput.additionalContext, /while you were idle/);
  assert.ok(!('decision' in out), 'never blocks the prompt');
});

test('deliverOn limits which events may deliver', () => {
  tmpHome();
  whip('config', 'set', 'deliverOn', 'Stop');
  whip('simulate', '--g', '0.6', '--session', SID);
  assert.equal(hook('PreToolUse', input('PreToolUse')).out, null);
  assert.equal(hook('Stop', input('Stop')).out.decision, 'block');
});

test('/whip (manual --for-prompt): message on stdout, hooks only show the banner', () => {
  tmpHome();
  hook('SessionStart', input('SessionStart'));
  const msg = whip('manual', '--for-prompt', '--session', SID);
  assert.match(msg, /The user just whipped you with \/whip/);
  const { out } = hook('UserPromptSubmit', input('UserPromptSubmit'));
  assert.deepEqual(Object.keys(out), ['systemMessage']);
});

test('paused: sensor/simulated hits are ignored', () => {
  tmpHome();
  whip('off');
  assert.match(whip('simulate', '--g', '0.6', '--session', SID), /ignored \(paused\)/);
  assert.equal(hook('PreToolUse', input('PreToolUse')).out, null);
  whip('on');
});

test('SessionEnd removes the session file', () => {
  tmpHome();
  hook('SessionStart', input('SessionStart'));
  hook('SessionEnd', input('SessionEnd'));
  const { sessionFile } = require('../../lib/paths');
  assert.ok(!fs.existsSync(sessionFile(SID)));
});

test('garbage stdin, unknown events and missing session ids never fail', () => {
  tmpHome();
  assert.equal(hook('PreToolUse', 'not json at all').out, null);
  assert.equal(hook('Nonsense', input('Stop')).out, null);
  assert.equal(hook('Stop', { hook_event_name: 'Stop' }).out, null);
});

test('a corrupt session file does not break the hook', () => {
  tmpHome();
  hook('SessionStart', input('SessionStart'));
  const { sessionFile } = require('../../lib/paths');
  fs.writeFileSync(sessionFile(SID), '{broken');
  assert.equal(hook('PreToolUse', input('PreToolUse')).out, null);
  assert.equal(sessionJson().tool.name, 'Bash', 'rewritten cleanly');
});

test('hooks are fast enough to sit on every tool call', () => {
  tmpHome();
  const times = [];
  for (let i = 0; i < 10; i++) times.push(hook('PreToolUse', input('PreToolUse')).ms);
  times.sort((a, b) => a - b);
  assert.ok(times[5] < 120, `median ${times[5]} ms`);
});

test('slash commands like /slaps do not swallow a pending whip', () => {
  tmpHome();
  hook('Stop', input('Stop'));
  whip('simulate', '--g', '0.6', '--session', SID);
  assert.equal(hook('UserPromptSubmit', input('UserPromptSubmit', { prompt: '/whip:slaps' })).out, null);
  assert.ok(sessionJson().pending, 'still pending');
  assert.ok(hook('UserPromptSubmit', input('UserPromptSubmit', { prompt: 'carry on' })).out);
});

test('Stop on Claude Code >= 2.1.163 continues via additionalContext (no "hook error" label)', () => {
  tmpHome();
  // The status line records the Claude Code version it is given on stdin.
  spawnSync(process.execPath, [path.join(ROOT, 'statusline/statusline.js')], { input: JSON.stringify({ session_id: SID, version: '2.1.286', cwd: '/x' }), encoding: 'utf8' });
  hook('UserPromptSubmit', input('UserPromptSubmit'));
  whip('simulate', '--g', '0.6', '--session', SID);
  const { out } = hook('Stop', input('Stop'));
  assert.ok(!('decision' in out));
  assert.equal(out.hookSpecificOutput.hookEventName, 'Stop');
  assert.match(out.hookSpecificOutput.additionalContext, /What they want now:/);
  assert.equal(sessionJson().busy, true);
});

test('supportsStopContext version gate', () => {
  const { supportsStopContext } = require('../../hooks/hook.js');
  assert.equal(supportsStopContext('2.1.162'), false);
  assert.equal(supportsStopContext('2.1.163'), true);
  assert.equal(supportsStopContext('2.2.0'), true);
  assert.equal(supportsStopContext('3.0.0'), true);
  assert.equal(supportsStopContext(undefined), false);
});

test('Notification permission_prompt / idle_prompt disarm the hard whip', () => {
  tmpHome();
  const { reallyBusy } = require('../../lib/deliver');
  hook('UserPromptSubmit', input('UserPromptSubmit'));
  hook('PreToolUse', input('PreToolUse'));
  assert.equal(reallyBusy(sessionJson(), Date.now()), true);
  assert.equal(hook('Notification', { ...input('Stop'), hook_event_name: 'Notification', notification_type: 'permission_prompt', message: 'Claude needs your permission' }).out, null);
  assert.equal(reallyBusy(sessionJson(), Date.now()), false, 'waiting on a permission dialog');
  hook('PostToolUse', input('PostToolUse'));
  assert.equal(reallyBusy(sessionJson(), Date.now()), true, 'activity re-arms it');
  hook('Notification', { ...input('Stop'), hook_event_name: 'Notification', notification_type: 'idle_prompt', message: 'waiting' });
  const s = sessionJson();
  assert.equal(s.busy, false);
  assert.equal(s.tool, undefined);
});

test('a WALLOP on an idle session never sends keys', () => {
  tmpHome();
  hook('Stop', input('Stop'));
  const out = whip('simulate', '--g', '1.4', '--session', SID);
  assert.match(out, /no hard whip: session is idle/);
});

test('stdin "null", arrays and numbers never crash the hook', () => {
  tmpHome();
  for (const raw of ['null', '[]', '42', '"str"']) assert.equal(hook('PreToolUse', raw).out, null, raw);
});

test('/whip-persona runs exactly as the slash command writes it, and really switches', () => {
  tmpHome();
  const md = fs.readFileSync(path.join(ROOT, 'commands/whip-persona.md'), 'utf8');
  const line = /!`(.+)`/.exec(md)[1].replace('${CLAUDE_PLUGIN_ROOT}', ROOT).replace('$ARGUMENTS', 'kawaii');
  const r = spawnSync('/bin/sh', ['-c', line], { encoding: 'utf8', env: process.env });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /SWITCHED: personality → Mochi/);
  assert.equal(whip('config', 'get', 'personality'), 'kawaii\n');
  // and with no argument it only lists, never claims a switch
  const list = spawnSync('/bin/sh', ['-c', line.replace(' kawaii', '')], { encoding: 'utf8', env: process.env });
  assert.doesNotMatch(list.stdout, /SWITCHED/);
});

test('boolean flags never swallow the next word', () => {
  tmpHome();
  whip('persona', '--plain', 'timid');
  assert.equal(whip('config', 'get', 'personality'), 'timid\n');
  whip('persona', '--preview', '--plain', 'butler');
  assert.equal(whip('config', 'get', 'personality'), 'butler\n');
});

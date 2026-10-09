#!/usr/bin/env node
'use strict';
// One entry point for every hook event: `node hook.js <EventName>`.
// Contract: read the event JSON on stdin, always exit 0, print at most one JSON
// object on stdout. A broken whip must never break Claude Code.
const fs = require('fs');
const { loadConfig } = require('../lib/config');
const store = require('../lib/store');

function readInput() {
  try {
    const v = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

// The controlling tty we inherited from Claude Code (e.g. /dev/ttys003), so
// the osascript hard whip can insist on the exact terminal tab. SessionStart only.
function controllingTty() {
  try {
    const r = require('child_process').spawnSync('/bin/ps', ['-o', 'tty=', '-p', String(process.pid)], { encoding: 'utf8', timeout: 1000 });
    const t = (r.stdout || '').trim();
    return t && t !== '??' ? `/dev/${t}` : null;
  } catch {
    return null;
  }
}

function sessionInfo(input) {
  return {
    cwd: input.cwd,
    transcript: input.transcript_path,
    tmuxPane: process.env.TMUX_PANE,
    tmuxSocket: process.env.TMUX ? process.env.TMUX.split(',')[0] : undefined,
    termProgram: process.env.TERM_PROGRAM,
    model: typeof input.model === 'string' ? input.model : input.model && input.model.id,
  };
}

function via(event, cfg) {
  return cfg.deliverOn.includes(event) ? event : null;
}

/** Pure-ish: turns (event, input, pending whip) into the hook's JSON output. */
function respond(event, input, w, cfg) {
  if (!w) return null;
  const { banner, messageForClaude } = require('../lib/render'); // only needed when a whip lands
  const sys = banner(w, cfg);
  if (w.bannerOnly) return { systemMessage: sys };
  const idle = event === 'UserPromptSubmit';
  const msg = messageForClaude(w, cfg, { idle });
  switch (event) {
    case 'PreToolUse': {
      const deny = w.tier === 'wallop' || cfg.softMode === 'deny';
      const out = { systemMessage: sys, hookSpecificOutput: { hookEventName: 'PreToolUse' } };
      if (deny) {
        out.hookSpecificOutput.permissionDecision = 'deny';
        out.hookSpecificOutput.permissionDecisionReason = `${msg} (This ${input.tool_name || 'tool'} call was held back once by the whip; re-issue it only if it is still the fastest path.)`;
      } else {
        out.hookSpecificOutput.additionalContext = msg;
      }
      return out;
    }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { systemMessage: sys, hookSpecificOutput: { hookEventName: event, additionalContext: msg } };
    case 'UserPromptSubmit':
      return { systemMessage: sys, hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: msg } };
    case 'Stop':
      // 2.1.163+ continues the turn on additionalContext and labels it "Stop
      // hook feedback"; older builds need decision:block (shown as an error).
      if (supportsStopContext(input.claudeVersion)) return { systemMessage: sys, hookSpecificOutput: { hookEventName: 'Stop', additionalContext: msg } };
      return { systemMessage: sys, decision: 'block', reason: msg };
    default:
      return { systemMessage: sys };
  }
}

function handle(event, input, cfg, now = Date.now()) {
  const id = input.session_id;
  if (!id) return { out: null };
  let w = null;
  const t = (opts) => store.touchAndTake(id, opts, cfg, now).whip;
  switch (event) {
    case 'SessionStart':
      store.heartbeat(id, sessionInfo(input), now, { active: true });
      t({ patch: { busy: false, tool: undefined, source: input.source, tty: controllingTty() || undefined } });
      if (input.source === 'startup' && Math.random() < 0.05) store.pruneSessions(now);
      break;
    case 'UserPromptSubmit':
      w = t({
        patch: { busy: true, tool: undefined, ...pick(sessionInfo(input), ['tmuxPane', 'tmuxSocket', 'termProgram', 'cwd']) },
        via: via(event, cfg),
        // Slash commands (/slaps, /whip:config...) never carry a whip; the
        // banner-only marker left by /whip itself is the exception.
        canTake: (s) => !isSlashCommand(input.prompt) || !!s.pending.bannerOnly,
      });
      break;
    case 'PreToolUse':
      w = t({ patch: { busy: true, tool: { name: input.tool_name || 'tool', since: now } }, via: via(event, cfg) });
      break;
    case 'PostToolUse':
    case 'PostToolUseFailure':
      w = t({ patch: { busy: true, tool: undefined }, via: via('PostToolUse', cfg) });
      break;
    case 'Stop': {
      let version;
      w = t({
        patch: { tool: undefined },
        // Respect stop_hook_active: never force a second continuation in a row.
        via: input.stop_hook_active ? null : via(event, cfg),
        after: (s, whip) => {
          s.busy = !!(whip && !whip.bannerOnly); // Claude keeps going only if we continue the turn
          version = s.claudeVersion;
        },
      });
      input = { ...input, claudeVersion: version };
      break;
    }
    case 'Notification':
      // A permission dialog or an idle prompt means nobody is mid-turn: the
      // hard whip must not press Esc / type into it.
      if (input.notification_type === 'permission_prompt' || input.notification_type === 'idle_prompt' || input.notification_type === 'elicitation_dialog') {
        store.updateSession(id, (s) => {
          s.awaiting = input.notification_type;
          if (input.notification_type === 'idle_prompt') {
            s.busy = false;
            delete s.tool;
          }
          return s;
        });
      }
      break;
    case 'SessionEnd':
      store.removeSession(id);
      break;
    default:
      break;
  }
  return { out: w ? respond(event, input, w, cfg) : null, whip: w };
}

function supportsStopContext(version) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version || '');
  if (!m) return false;
  const [a, b, c] = m.slice(1).map(Number);
  return a > 2 || (a === 2 && (b > 1 || (b === 1 && c >= 163)));
}

function isSlashCommand(prompt) {
  return typeof prompt === 'string' && /^\s*\/[A-Za-z]/.test(prompt);
}

function pick(o, keys) {
  const r = {};
  for (const k of keys) if (o[k] !== undefined) r[k] = o[k];
  return r;
}

function main() {
  const event = process.argv[2] || '';
  const t0 = Date.now();
  const input = readInput();
  let res = { out: null };
  try {
    const cfg = loadConfig();
    res = handle(event, input, cfg, t0);
  } catch (err) {
    res = { out: null, error: String(err && err.message) };
  }
  if (res.out) process.stdout.write(JSON.stringify(res.out));
  // Every file write costs a few ms on a Mac with endpoint security, and these
  // hooks sit on every tool call: routine tool events are only logged when they
  // deliver something (WHIP_LOG=all logs everything; the e2e test uses it).
  const routine = (event === 'PreToolUse' || event === 'PostToolUse' || event === 'PostToolUseFailure') && !res.whip && !res.error;
  if (routine && process.env.WHIP_LOG !== 'all') return;
  store.hookLog({
    ev: event,
    session: input.session_id,
    tool: input.tool_name,
    stopActive: input.stop_hook_active || undefined,
    slash: event === 'UserPromptSubmit' && isSlashCommand(input.prompt) ? true : undefined,
    delivered: res.whip ? res.whip.id : undefined,
    error: res.error,
    tier: res.whip ? res.whip.tier : undefined,
    ms: Date.now() - t0,
  });
}

if (require.main === module) {
  try {
    main();
  } catch {
    // Contract: always exit 0. Output (if any) was already written.
  }
}

module.exports = { handle, respond, supportsStopContext };

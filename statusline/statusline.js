#!/usr/bin/env node
'use strict';
// Claude Code status line: line 1 = model · dir · branch (or your previous
// status line, wrapped), line 2 = the whip lane. Budget: < 50 ms, no network,
// no child processes unless you asked us to wrap another status line.
const fs = require('fs');
const path = require('path');
const { paths } = require('../lib/paths');
const { loadConfig } = require('../lib/config');
const { readStateFast, readSession, heartbeat } = require('../lib/store');
const { painter, colorEnabled, detectTheme } = require('../lib/ansi');
const { whipLane, infoLine, face } = require('../lib/render');

const HEARTBEAT_EVERY_MS = 5000;

function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

// Reads .git/HEAD walking up from cwd. Handles worktrees (.git file) too.
function gitBranch(dir) {
  for (let d = dir, i = 0; d && i < 25; i++) {
    const g = path.join(d, '.git');
    try {
      let head;
      const st = fs.statSync(g);
      if (st.isDirectory()) head = fs.readFileSync(path.join(g, 'HEAD'), 'utf8');
      else {
        const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(g, 'utf8'));
        if (!m) return null;
        head = fs.readFileSync(path.join(path.resolve(d, m[1].trim()), 'HEAD'), 'utf8');
      }
      const ref = /ref: refs\/heads\/(.+)/.exec(head);
      return ref ? ref[1].trim() : head.trim().slice(0, 7);
    } catch {}
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}

function runWrapped(cmd, raw) {
  const { spawnSync } = require('child_process');
  const r = spawnSync('/bin/sh', ['-c', cmd], { input: raw, encoding: 'utf8', timeout: 2000 });
  return (r.stdout || '').replace(/\n+$/, '');
}

function main() {
  const now = Date.now();
  const raw = readStdin();
  let input = {};
  try {
    input = raw ? JSON.parse(raw) : {};
  } catch {}
  const cfg = loadConfig();
  const p = painter(colorEnabled(cfg, null), detectTheme(cfg, paths().settings));
  const state = readStateFast();
  const sid = input.session_id;
  let session = sid ? readSession(sid) : null;

  if (sid && (!session || now - (session.lastSeen || 0) > HEARTBEAT_EVERY_MS)) {
    try {
      session = heartbeat(sid, {
        cwd: input.cwd || (input.workspace && input.workspace.current_dir),
        transcript: input.transcript_path,
        tmuxPane: process.env.TMUX_PANE,
        tmuxSocket: process.env.TMUX ? process.env.TMUX.split(',')[0] : undefined,
        termProgram: process.env.TERM_PROGRAM,
        model: input.model && input.model.id,
        claudeVersion: input.version,
      }, now);
    } catch {}
  }

  const lane = whipLane(state, session, cfg, p, now);
  let top = '';
  if (cfg.wrapStatusLine) top = runWrapped(cfg.wrapStatusLine, raw);
  else {
    const dir = input.cwd || (input.workspace && input.workspace.current_dir) || '';
    top = infoLine(input, dir ? gitBranch(dir) : null, p, cfg.ascii);
  }

  if (cfg.hidden) process.stdout.write(top);
  else if (cfg.statusLines === 1 || !top) process.stdout.write(top ? `${top} ${p.muted('│')} ${lane}` : lane);
  else process.stdout.write(`${top}\n${lane}`);
}

try {
  main();
} catch (err) {
  // Never break the status line; show a neutral face and the error class.
  process.stdout.write(`${face('idle', false)} whip: ${err && err.code ? err.code : 'error'}`);
  if (process.env.WHIP_DEBUG) process.stderr.write(String(err && err.stack));
}

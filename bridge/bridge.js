#!/usr/bin/env node
'use strict';
// whip-bridge: runs as you (LaunchAgent). Connects to the root sensor daemon's
// unix socket, reads one JSON object per line ({"ts":ms,"g":0.63,"tier":"slap"})
// and turns each into a whip. It never needs root and the daemon never needs
// to know anything about Claude Code.
const net = require('net');
const { paths } = require('../lib/paths');
const { loadConfig } = require('../lib/config');
const { deliver } = require('../lib/deliver');

function log(...args) {
  process.stdout.write(`[${new Date().toISOString()}] ${args.join(' ')}\n`);
}

function parseEvent(line, now) {
  let ev;
  try {
    ev = JSON.parse(line);
  } catch {
    return null;
  }
  if (!ev || typeof ev !== 'object' || ev.type === 'hello') return null;
  const g = Number(ev.g);
  if (!Number.isFinite(g) || g < 0 || g > 16) return null;
  // Same machine, but don't trust a skewed or replayed timestamp.
  const ts = Number(ev.ts);
  return { g, ts: Number.isFinite(ts) && Math.abs(now - ts) < 5000 ? ts : now, sensorTier: ev.tier };
}

function onEvent(ev) {
  const cfg = loadConfig(); // re-read every time: /whip-config edits apply instantly
  const r = deliver({ g: ev.g, source: 'sensor' }, cfg, { now: ev.ts });
  if (!r.result.accepted) return log(`ignored ${ev.g.toFixed(2)}g (${r.result.reason})`);
  const hard = (r.hard || []).map((h) => (h.ok ? `hard:${h.via}` : `hard-skip:${h.why}`)).join(' ');
  log(`${r.result.tier} ${ev.g.toFixed(2)}g combo x${r.result.combo} -> ${r.targets.map((t) => t.id.slice(0, 8)).join(',') || 'no session'} ${hard}`);
}

function run(socketPath) {
  let backoff = 500;
  const connect = () => {
    const sock = net.createConnection(socketPath);
    let buf = '';
    sock.setEncoding('utf8');
    sock.on('connect', () => {
      backoff = 500;
      log(`connected to ${socketPath}`);
    });
    sock.on('data', (chunk) => {
      buf += chunk;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const ev = parseEvent(line, Date.now());
        if (!ev) continue;
        try {
          onEvent(ev);
        } catch (err) {
          log('error handling event:', err && err.stack);
        }
      }
      if (buf.length > 65536) buf = ''; // garbage protection
    });
    sock.on('error', (err) => {
      if (backoff <= 500 || backoff >= 10000) log(`sensor socket: ${err.code || err.message} (retrying)`);
    });
    sock.on('close', () => {
      setTimeout(connect, backoff);
      backoff = Math.min(10000, backoff * 2);
    });
  };
  connect();
}

if (require.main === module) {
  const i = process.argv.indexOf('--socket');
  const socketPath = i > 0 ? process.argv[i + 1] : paths().sensorSocket;
  // launchd appends stdout to bridge.log forever; keep it bounded.
  try {
    const f = require('path').join(paths().home, 'bridge.log');
    if (require('fs').statSync(f).size > 1 << 20) require('fs').truncateSync(f, 0);
  } catch {}
  log(`whip-bridge starting (pid ${process.pid}), state in ${paths().home}`);
  process.on('SIGTERM', () => process.exit(0));
  run(socketPath);
}

module.exports = { parseEvent, run };

'use strict';
// Integration: the real Go daemon (in --simulate mode, no root) → unix socket
// → the real bridge → state.json / session pending whip.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const { tmpHome, ROOT } = require('../helpers');

const SENSORD = path.join(ROOT, 'build', 'whip-sensord');

function ensureSensord() {
  if (fs.existsSync(SENSORD)) return true;
  const go = spawnSync('go', ['version']);
  if (go.status !== 0) return false;
  const r = spawnSync('go', ['build', '-o', SENSORD, '.'], { cwd: path.join(ROOT, 'sensord'), env: { ...process.env, CGO_ENABLED: '0' } });
  return r.status === 0;
}

function waitFor(fn, ms = 5000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      let v;
      try {
        v = fn();
      } catch {}
      if (v) return resolve(v);
      if (Date.now() - start > ms) return reject(new Error('timed out'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

test('sensord --simulate → socket → bridge → whip queued on the active session', { skip: !ensureSensord() && 'needs Go to build build/whip-sensord' }, async () => {
  const dir = tmpHome();
  const env = { ...process.env, NO_COLOR: '1' };
  const { paths, sessionFile } = require('../../lib/paths');
  const SID = 'bridge-test-session';
  // An active Claude Code session to target.
  spawnSync(process.execPath, [path.join(ROOT, 'hooks/hook.js'), 'SessionStart'], { input: JSON.stringify({ session_id: SID, cwd: '/work/repo', source: 'startup' }), env });

  // Relative socket path: macOS caps sun_path at 104 bytes and temp dirs are long.
  const sensord = spawn(SENSORD, ['--simulate', '--socket', 's.sock'], { cwd: dir, env, stdio: ['pipe', 'ignore', 'pipe'] });
  await waitFor(() => fs.existsSync(path.join(dir, 's.sock')));
  const mode = fs.statSync(path.join(dir, 's.sock')).mode & 0o777;
  assert.equal(mode, 0o600, 'socket is private to its owner');

  let bridgeOut = '';
  const bridge = spawn(process.execPath, [path.join(ROOT, 'bridge/bridge.js'), '--socket', 's.sock'], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  bridge.stdout.on('data', (d) => (bridgeOut += d));
  try {
    await waitFor(() => bridgeOut.includes('connected to s.sock'));

    sensord.stdin.write('0.6\n');
    await waitFor(() => /slap 0\.60g combo x1 -> bridge-t/.test(bridgeOut));
    const state = JSON.parse(fs.readFileSync(paths().state, 'utf8'));
    assert.equal(state.total, 1);
    assert.deepEqual(state.repos, { repo: 1 });
    assert.equal(JSON.parse(fs.readFileSync(sessionFile(SID), 'utf8')).pending.tier, 'slap');

    await new Promise((r) => setTimeout(r, 400)); // past the cooldown
    sensord.stdin.write('wallop\n');
    await waitFor(() => /wallop 1\.20g combo x2/.test(bridgeOut));
    assert.match(bridgeOut, /hard-skip:session is idle/);

    spawnSync(process.execPath, [path.join(ROOT, 'bin/whip'), 'off'], { env });
    await new Promise((r) => setTimeout(r, 400));
    sensord.stdin.write('0.7\n');
    await waitFor(() => /ignored 0\.70g \(paused\)/.test(bridgeOut));

    sensord.stdin.write('not-a-number\n');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(JSON.parse(fs.readFileSync(paths().state, 'utf8')).total, 2);
  } finally {
    bridge.kill('SIGTERM');
    sensord.kill('SIGTERM');
  }
  await waitFor(() => !fs.existsSync(path.join(dir, 's.sock')), 3000);
});

test('bridge rejects malformed or absurd events', () => {
  const { parseEvent } = require('../../bridge/bridge');
  const now = 1_800_000_000_000;
  assert.equal(parseEvent('nope', now), null);
  assert.equal(parseEvent('{"type":"hello"}', now), null);
  assert.equal(parseEvent('{"g":-1}', now), null);
  assert.equal(parseEvent('{"g":99}', now), null);
  assert.deepEqual(parseEvent(`{"g":0.5,"ts":${now - 100}}`, now), { g: 0.5, ts: now - 100, sensorTier: undefined });
  assert.equal(parseEvent('{"g":0.5,"ts":1}', now).ts, now, 'skewed timestamps are replaced');
});

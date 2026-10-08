'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { tmpHome, cfg, ROOT } = require('../helpers');

function fresh() {
  tmpHome();
  // Modules read env lazily, so a re-require is not needed.
  return { store: require('../../lib/store'), paths: require('../../lib/paths').paths() };
}

test('recordHit writes state atomically, logs the event and queues a pending whip on the target', () => {
  const { store, paths } = fresh();
  const c = cfg();
  const now = Date.now();
  store.heartbeat('s1', { cwd: '/w/proj' }, now - 1000, { active: true });
  const r = store.recordHit({ ts: now, g: 0.6, source: 'simulate' }, c, now);
  assert.equal(r.result.tier, 'slap');
  assert.deepEqual(r.targets.map((t) => t.id), ['s1']);
  const state = JSON.parse(fs.readFileSync(paths.state, 'utf8'));
  assert.equal(state.total, 1);
  assert.deepEqual(state.repos, { proj: 1 });
  const ev = fs.readFileSync(paths.events, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].tier, 'slap');
  assert.equal(store.readSession('s1').pending.tier, 'slap');
  // no temp files left behind
  assert.deepEqual(fs.readdirSync(paths.home).filter((f) => f.includes('.tmp.')), []);
});

test('consumePending hands the whip out exactly once and records delivery', () => {
  const { store } = fresh();
  const c = cfg();
  const now = Date.now();
  store.heartbeat('s1', {}, now, { active: true });
  store.recordHit({ ts: now, g: 0.6 }, c, now);
  const w = store.consumePending('s1', 'PreToolUse', c, now + 10);
  assert.equal(w.tier, 'slap');
  assert.equal(store.consumePending('s1', 'PreToolUse', c, now + 20), null);
  assert.equal(store.readSession('s1').delivered[0].via, 'PreToolUse');
});

test('expired pending whips are dropped, not delivered', () => {
  const { store } = fresh();
  const c = cfg({ pendingTtlMs: 1000 });
  const now = Date.now();
  store.heartbeat('s1', {}, now, { active: true });
  store.recordHit({ ts: now, g: 0.6 }, c, now);
  assert.equal(store.consumePending('s1', 'Stop', c, now + 5000), null);
  assert.equal(store.readSession('s1').delivered[0].expired, true);
});

test('target: most recently active wins, busy beats idle, stale sessions are skipped', () => {
  const { store } = fresh();
  const now = Date.now();
  const sessions = [
    { id: 'old', lastActive: now - 3600e3, lastSeen: now - 3600e3 },
    { id: 'recent', lastActive: now - 5000, lastSeen: now - 1000 },
    { id: 'busy', busy: true, lastActive: now - 60000, lastSeen: now - 60000 },
  ];
  assert.deepEqual(store.pickTargets(sessions, cfg(), now).map((s) => s.id), ['busy']);
  assert.deepEqual(store.pickTargets(sessions.filter((s) => s.id !== 'busy'), cfg(), now).map((s) => s.id), ['recent']);
  assert.deepEqual(store.pickTargets(sessions, cfg({ target: 'all' }), now).map((s) => s.id).sort(), ['busy', 'recent']);
  assert.deepEqual(store.pickTargets([sessions[0]], cfg(), now), []);
});

test('target all queues the whip on every live session', () => {
  const { store } = fresh();
  const now = Date.now();
  store.heartbeat('a', {}, now, { active: true });
  store.heartbeat('b', {}, now, { active: true });
  store.recordHit({ ts: now, g: 0.6 }, cfg({ target: 'all' }), now);
  assert.ok(store.readSession('a').pending);
  assert.ok(store.readSession('b').pending);
});

test('a corrupted state.json self-heals from events.jsonl', () => {
  const { store, paths } = fresh();
  const c = cfg();
  const now = Date.now();
  store.recordHit({ ts: now, g: 0.6 }, c, now);
  store.recordHit({ ts: now + 10000, g: 1.2 }, c, now + 10000);
  fs.writeFileSync(paths.state, '{"v":1,"total": 2, "paused": true, broken');
  const healed = store.loadState(c);
  assert.equal(healed.total, 2);
  assert.equal(healed.bestG, 1.2);
  assert.equal(healed.paused, true, 'pause flag survives healing');
  assert.ok(fs.existsSync(paths.state + '.corrupt'));
  assert.equal(JSON.parse(fs.readFileSync(paths.state, 'utf8')).total, 2);
  // and once unpaused, the next hit continues from the healed counters
  store.setPaused(false, c);
  const r = store.recordHit({ ts: now + 20000, g: 0.6 }, c, now + 20000);
  assert.equal(r.result.slapNo, 3);
});

test('readStateFast never throws on garbage', () => {
  const { store, paths } = fresh();
  fs.mkdirSync(paths.home, { recursive: true });
  fs.writeFileSync(paths.state, 'not json');
  assert.equal(store.readStateFast(), null);
  fs.writeFileSync(paths.state, '[]');
  assert.equal(store.readStateFast(), null);
});

test('session ids cannot escape the sessions directory', () => {
  fresh();
  const { sessionFile, paths } = require('../../lib/paths');
  const f = sessionFile('../../etc/passwd');
  assert.equal(path.dirname(f), paths().sessions);
});

test('concurrent writers do not lose hits (lockfile)', async () => {
  const { store } = fresh();
  const c = cfg({ cooldownMs: 0 });
  const script = `
    const store = require(${JSON.stringify(path.join(ROOT, 'lib/store'))});
    const { DEFAULTS, clone } = require(${JSON.stringify(path.join(ROOT, 'lib/config'))});
    const c = clone(DEFAULTS); c.cooldownMs = 0; c.comboWindowMs = 0;
    for (let i = 0; i < 25; i++) store.recordHit({ ts: Date.now() + i, g: 0.3, source: 'manual' }, c);
  `;
  const run = () =>
    new Promise((res, rej) => {
      const ch = spawn(process.execPath, ['-e', script], { env: process.env, stdio: 'inherit' });
      ch.on('exit', (code) => (code === 0 ? res() : rej(new Error('child failed ' + code))));
    });
  await Promise.all([run(), run(), run(), run()]);
  assert.equal(store.loadState(c).total, 100);
});

test('setPaused round-trips', () => {
  const { store } = fresh();
  const c = cfg();
  store.setPaused(true, c);
  assert.equal(store.loadState(c).paused, true);
  store.setPaused(false, c);
  assert.equal(store.loadState(c).paused, false);
});

test('lock: a stale lock is broken once, and a holder never deletes a successor\'s lock', () => {
  const dir = tmpHome();
  const { withLock } = require('../../lib/fsx');
  const lockFile = path.join(dir, 'x.lock');
  // stale lock from a "crashed" process
  fs.writeFileSync(lockFile, '');
  const old = (Date.now() - 5000) / 1000;
  fs.utimesSync(lockFile, old, old);
  let ran = false;
  withLock(lockFile, () => {
    ran = true;
    // simulate our lock being broken and replaced by another process mid-way
    fs.unlinkSync(lockFile);
    fs.writeFileSync(lockFile, '');
  });
  assert.ok(ran);
  assert.ok(fs.existsSync(lockFile), "the successor's lock survives our release");
  fs.unlinkSync(lockFile);
  assert.ok(!fs.existsSync(lockFile + '.break'));
});

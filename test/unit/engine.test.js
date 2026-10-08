'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyHit, emptyState, classify, replay, mergePending, hitsWithin, dayKey } = require('../../lib/engine');
const { cfg } = require('../helpers');

const T0 = new Date(2026, 9, 8, 16, 0, 0).getTime(); // local 16:00

function hits(seq, c = cfg()) {
  let s = emptyState();
  const results = [];
  for (const h of seq) {
    const r = applyHit(s, h, c);
    s = r.state;
    results.push(r.result);
  }
  return { state: s, results };
}

test('classify: tiers by thresholds, null below tapMinG', () => {
  const c = cfg();
  assert.equal(classify(0.01, c), null);
  assert.equal(classify(0.3, c), 'tap');
  assert.equal(classify(0.45, c), 'slap'); // inclusive lower bound
  assert.equal(classify(0.6, c), 'slap');
  assert.equal(classify(0.9, c), 'wallop');
  assert.equal(classify(1.2, c), 'wallop');
  assert.equal(classify(NaN, c), null);
});

test('below threshold hits are rejected and change nothing', () => {
  const s = emptyState();
  const r = applyHit(s, { ts: T0, g: 0.01 }, cfg());
  assert.equal(r.result.accepted, false);
  assert.equal(r.result.reason, 'below-threshold');
  assert.equal(r.state, s);
});

test('cooldown drops a second detection of the same physical slap', () => {
  const { state, results } = hits([
    { ts: T0, g: 0.6 },
    { ts: T0 + 100, g: 0.7 },
  ]);
  assert.equal(results[1].accepted, false);
  assert.equal(results[1].reason, 'cooldown');
  assert.equal(state.total, 1);
});

test('manual whips bypass cooldown and pause', () => {
  let s = { ...emptyState(), paused: true };
  let r = applyHit(s, { ts: T0, g: 0.6, source: 'manual' }, cfg());
  assert.equal(r.result.accepted, true);
  r = applyHit(r.state, { ts: T0 + 10, g: 0.6, source: 'manual' }, cfg());
  assert.equal(r.result.accepted, true);
  r = applyHit(r.state, { ts: T0 + 5000, g: 0.6, source: 'sensor' }, cfg());
  assert.equal(r.result.reason, 'paused');
});

test('combo builds within the window and resets after it', () => {
  const { results, state } = hits([
    { ts: T0, g: 0.3 },
    { ts: T0 + 1000, g: 0.3 },
    { ts: T0 + 2000, g: 0.3 },
    { ts: T0 + 2000 + 4001, g: 0.3 },
  ]);
  assert.deepEqual(results.map((r) => r.combo), [1, 2, 3, 1]);
  assert.equal(state.longestCombo, 3);
});

test('3 slaps within 5 s escalate to a WALLOP; taps do not count', () => {
  const { results } = hits([
    { ts: T0, g: 0.6 },
    { ts: T0 + 500, g: 0.3 }, // tap
    { ts: T0 + 1000, g: 0.6 },
    { ts: T0 + 2000, g: 0.6 },
  ]);
  assert.deepEqual(results.map((r) => r.tier), ['slap', 'tap', 'slap', 'wallop']);
  assert.equal(results[3].escalated, true);
  assert.equal(results[3].baseTier, 'slap');
});

test('slaps spread over more than 5 s do not escalate', () => {
  const { results } = hits([
    { ts: T0, g: 0.6 },
    { ts: T0 + 3000, g: 0.6 },
    { ts: T0 + 6000, g: 0.6 },
  ]);
  assert.deepEqual(results.map((r) => r.tier), ['slap', 'slap', 'slap']);
});

test('counters: total, tiers, best g, days, hours, repos, sessions, calmest gap', () => {
  const { state } = hits([
    { ts: T0, g: 0.6, cwd: '/x/repo-a', session: 's1' },
    { ts: T0 + 60000, g: 0.91, cwd: '/x/repo-a/', session: 's1' },
    { ts: T0 + 600000, g: 0.3, cwd: '/y/repo-b', session: 's2' },
  ]);
  assert.equal(state.total, 3);
  assert.deepEqual(state.tiers, { tap: 1, slap: 1, wallop: 1 });
  assert.equal(state.bestG, 0.91);
  assert.equal(state.days[dayKey(T0)], 3);
  assert.equal(state.hours[16], 3);
  assert.deepEqual(state.repos, { 'repo-a': 2, 'repo-b': 1 });
  assert.deepEqual(state.sessions, { s1: 2, s2: 1 });
  assert.equal(state.calmestMs, 540000);
  assert.equal(state.lastHit.slapNo, 3);
});

test('milestones fire exactly at combo 5, 10, 25', () => {
  const seq = Array.from({ length: 11 }, (_, i) => ({ ts: T0 + i * 1000, g: 0.3 }));
  const { results } = hits(seq);
  assert.deepEqual(results.filter((r) => r.milestone).map((r) => r.milestone), [5, 10]);
});

test('taps produce no whip; slaps carry a line and a concrete instruction', () => {
  const { results } = hits([
    { ts: T0, g: 0.3 },
    { ts: T0 + 5000, g: 0.6 },
  ]);
  assert.equal(results[0].whip, null);
  assert.ok(results[1].whip.line.length > 5);
  assert.ok(results[1].whip.instruction.length > 20);
});

test('a custom message replaces the pool line', () => {
  const { results } = hits([{ ts: T0, g: 0.6, message: 'Ship the login fix now' }]);
  assert.equal(results[0].whip.line, 'Ship the login fix now');
});

test('lines rotate without repeats across a full pool', () => {
  const seq = Array.from({ length: 20 }, (_, i) => ({ ts: T0 + i * 10000, g: 0.6 }));
  const { results } = hits(seq);
  const lines = results.map((r) => r.whip.line);
  assert.equal(new Set(lines).size, 20);
});

test('replay of the event log rebuilds the counters', () => {
  const c = cfg();
  const seq = [
    { ts: T0, g: 0.6, cwd: '/r/a' },
    { ts: T0 + 1000, g: 0.3, cwd: '/r/a' },
    { ts: T0 + 90000, g: 1.2, cwd: '/r/b' },
  ];
  const { state } = hits(seq, c);
  const events = seq.map((h, i) => ({ kind: 'hit', ts: h.ts, g: h.g, cwd: h.cwd, tier: [ 'slap', 'tap', 'wallop' ][i] }));
  const rebuilt = replay(events, c);
  for (const k of ['total', 'tiers', 'bestG', 'days', 'hours', 'repos', 'longestCombo']) assert.deepEqual(rebuilt[k], state[k], k);
});

test('mergePending keeps the strongest tier and counts stacked whips', () => {
  const a = { id: 'a', tier: 'slap', g: 0.6, combo: 1, slapNo: 1, ts: 1 };
  const b = { id: 'b', tier: 'wallop', g: 1.1, combo: 2, slapNo: 2, ts: 2 };
  const c = { id: 'c', tier: 'slap', g: 0.5, combo: 3, slapNo: 3, ts: 3 };
  const m = mergePending(mergePending(mergePending(null, a), b), c);
  assert.equal(m.tier, 'wallop');
  assert.equal(m.combo, 3);
  assert.equal(m.g, 1.1);
  assert.equal(m.stacked, 3);
  assert.equal(m.id, 'c');
});

test('hitsWithin counts non-tap hits in a window', () => {
  const { state } = hits([
    { ts: T0, g: 0.6 },
    { ts: T0 + 1000, g: 0.3 },
    { ts: T0 + 400000, g: 0.6 },
  ]);
  assert.equal(hitsWithin(state, T0 + 400000, 10 * 60000), 2);
  assert.equal(hitsWithin(state, T0 + 400000, 60000), 1);
});

test('recent buffer is bounded', () => {
  const seq = Array.from({ length: 100 }, (_, i) => ({ ts: T0 + i * 10000, g: 0.3 }));
  const { state } = hits(seq);
  assert.equal(state.recent.length, 64);
});

test('mergePending: banner-only only when both whips are banner-only', () => {
  const full = { id: 'a', tier: 'slap', g: 0.6, combo: 1, slapNo: 1, ts: 1 };
  const banner = { id: 'b', tier: 'slap', g: 0.6, combo: 1, slapNo: 2, ts: 2, bannerOnly: true };
  assert.equal(mergePending(mergePending(null, full), banner).bannerOnly, undefined);
  assert.equal(mergePending(mergePending(null, banner), { ...banner, id: 'c' }).bannerOnly, true);
});

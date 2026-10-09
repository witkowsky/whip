'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { applyHit, emptyState } = require('../../lib/engine');
const render = require('../../lib/render');
const stats = require('../../lib/stats');
const { painter, width } = require('../../lib/ansi');
const { cfg, tmpHome, ROOT } = require('../helpers');

const plain = painter(false);
const T0 = new Date(2026, 9, 8, 16, 0, 0).getTime();

function stateWith(seq, c = cfg()) {
  let s = emptyState();
  for (const h of seq) s = applyHit(s, h, c).state;
  return s;
}

test('mood priority: hit > stunned > recovering > sweating > working > calm > idle', () => {
  const one = stateWith([{ ts: T0, g: 0.6 }]);
  assert.equal(render.mood(one, null, T0 + 500), 'hit');
  assert.equal(render.mood(one, null, T0 + 5000), 'recovering');
  assert.equal(render.mood(one, null, T0 + 30000), 'idle');
  assert.equal(render.mood(one, { tool: { name: 'Bash', since: T0 + 29000 } }, T0 + 30000), 'working');
  assert.equal(render.mood(one, null, T0 + 2 * 3600e3), 'calm');
  const combo3 = stateWith([0, 1000, 2000].map((d) => ({ ts: T0 + d, g: 0.3 })));
  assert.equal(render.mood({ ...combo3, lastHit: { ...combo3.lastHit, tier: 'slap' } }, null, T0 + 2100), 'stunned');
  const combo5 = stateWith([0, 1, 2, 3, 4].map((i) => ({ ts: T0 + i * 1000, g: 0.6 })));
  assert.equal(render.mood(combo5, null, T0 + 4500), 'wrecked');
  const sweat = stateWith([0, 1, 2, 3, 4].map((i) => ({ ts: T0 + i * 60000, g: 0.6 })));
  assert.equal(render.mood(sweat, null, T0 + 4 * 60000 + 30000), 'sweating');
  assert.equal(render.mood({ ...one, paused: true }, null, T0 + 100), 'paused');
  const tap = stateWith([{ ts: T0, g: 0.2 }]);
  assert.equal(render.mood(tap, null, T0 + 300), 'tap');
  assert.equal(render.mood(tap, null, T0 + 5000), 'idle', 'taps do not trigger recovering');
});

test('whip frames advance with time and every frame has the same width', () => {
  const frames = [0, 400, 1000].map((dt) => render.whipFrame(dt, false));
  assert.ok(frames[0].text.trim().length < frames[1].text.trim().length);
  assert.ok(frames[1].text.trim().length < frames[2].text.trim().length);
  assert.equal(new Set(frames.map((f) => width(f.text))).size, 1);
  assert.equal(frames[2].final, true);
  // ascii frames too
  const a = [0, 400, 1000].map((dt) => render.whipFrame(dt, true).text);
  assert.equal(new Set(a.map((s) => s.length)).size, 1);
});

test('each skipped-frame render still reads as a hit (status line re-renders on events)', () => {
  const s = stateWith([{ ts: T0, g: 0.6 }]);
  for (const dt of [50, 400, 900, 1900]) {
    const lane = render.whipLane(s, null, cfg(), plain, T0 + dt);
    assert.match(lane, /\(×﹏×\)/);
    assert.match(lane, /⟿/);
    assert.match(lane, /0\.60g/);
  }
  assert.match(render.whipLane(s, null, cfg(), plain, T0 + 1000), /WHACK!/);
});

test('lanes for each state contain what the spec shows', () => {
  const c = cfg();
  const s = stateWith([{ ts: T0, g: 0.62 }, { ts: T0 + 1000, g: 0.6 }, { ts: T0 + 2000, g: 0.62 }]);
  assert.match(render.whipLane(s, null, c, plain, T0 + 3000), /combo x3/);
  assert.match(render.whipLane(s, null, c, plain, T0 + 6000), /"[^"]+"\s+👋 \d+ today · 3 total/);
  const idle = render.whipLane(s, null, c, plain, T0 + 600000 + 1);
  assert.match(idle, /\(•ᴗ•\)\s+👋 \d+ today · 3 total · best 0\.62g/);
  const calm = render.whipLane(s, null, c, plain, T0 + 2 * 3600e3 + 3000);
  assert.match(calm, /\(ᵔᴥᵔ\)\s+2h without a slap — on best behaviour/);
  assert.match(render.whipLane(null, null, c, plain, T0), /no slaps yet/);
  assert.match(render.whipLane(s, { pending: { tier: 'slap' } }, c, plain, T0 + 2500), /whip queued/);
});

test('ascii mode emits only ASCII in the lane and the banner', () => {
  const c = cfg({ ascii: true });
  const s = stateWith([{ ts: T0, g: 1.2 }]);
  for (const dt of [100, 1000, 5000, 600000]) assert.match(render.whipLane(s, null, c, plain, T0 + dt), /^[\x20-\x7e]*$/);
  assert.match(render.banner({ ...s.lastHit, stacked: 1 }, c), /^[\x20-\x7e\n]*$/);
});

test('NO_COLOR / disabled painter emits no escape codes', () => {
  const s = stateWith([{ ts: T0, g: 0.6 }]);
  assert.ok(!render.whipLane(s, null, cfg(), plain, T0 + 500).includes('\x1b['));
  const colored = render.whipLane(s, null, cfg(), painter(true), T0 + 500);
  assert.ok(colored.includes('\x1b[38;5;'));
});

test('force bar is scaled to the tier thresholds', () => {
  const c = cfg();
  const lit = (g) => (render.forceBar(g, c, plain, true).match(/#/g) || []).length;
  assert.ok(lit(0.1) < lit(0.6));
  assert.ok(lit(0.6) < lit(1.2));
  assert.equal(lit(5), 10);
});

test('banner: WALLOP is bigger than a slap and milestones add a line', () => {
  const c = cfg();
  const slap = render.banner({ tier: 'slap', g: 0.74, combo: 3, slapNo: 42, line: 'Stop overthinking. Ship it.' }, c);
  assert.equal(slap.split('\n').length, 2);
  assert.match(slap, /⟿～+💥\s+WHACK!/);
  assert.match(slap, /slap #42 · 0\.74g · combo x3 · "Stop overthinking\. Ship it\."/);
  const wallop = render.banner({ tier: 'wallop', g: 1.2, combo: 5, slapNo: 43, line: 'x', milestone: 5 }, c);
  assert.ok(wallop.split('\n').length >= 5);
  assert.match(wallop, /W A L L O P/);
  assert.match(wallop, /COMBO x5/);
});

test('message for Claude: facts + the concrete instruction, never just abuse', () => {
  const w = { tier: 'slap', g: 0.6, combo: 3, slapNo: 7, line: 'Cut the preamble.', instruction: 'Summarise your plan in one sentence and execute it without detours.', source: 'sensor' };
  const m = render.messageForClaude(w, cfg());
  assert.match(m, /^⚡ WHIP/);
  assert.match(m, /slap #7 · 0\.60g · combo x3/);
  assert.match(m, /What they want now: Summarise your plan/);
  assert.match(m, /3 hits in a row/);
});

test('stats screen: totals, sparkline, hour peak, repo leaderboard', () => {
  const s = stateWith([
    { ts: T0, g: 0.6, cwd: '/a/api', session: 's' },
    { ts: T0 + 86400e3, g: 0.9, cwd: '/a/api', session: 's' },
    { ts: T0 + 86400e3 + 60000, g: 0.3, cwd: '/a/web', session: 's' },
  ]);
  const out = stats.render(s, T0 + 86400e3 + 120000, { session: 's', p: plain, cfg: cfg() });
  assert.match(out, /all time\s+3/);
  assert.match(out, /this session\s+3/);
  assert.match(out, /best force\s+0\.90g/);
  assert.match(out, /you slap most at 16:00/);
  assert.match(out, /1\. api\s+█+ 2/);
  assert.match(out, /last 14 days\s+[·▁▂▃▄▅▆▇█]{14}/);
});

test('status line script: renders two lines and stays under the 50 ms budget', () => {
  const dir = tmpHome();
  const env = { ...process.env, NO_COLOR: '1' };
  const script = path.join(ROOT, 'statusline/statusline.js');
  spawnSync(process.execPath, [path.join(ROOT, 'bin/whip'), 'simulate', '--g', '0.6'], { env });
  const input = JSON.stringify({ session_id: 'bench', cwd: ROOT, model: { display_name: 'Opus' }, workspace: { current_dir: ROOT } });
  const times = [];
  let out = '';
  for (let i = 0; i < 15; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [script], { input, env, encoding: 'utf8' });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
    out = r.stdout;
    assert.equal(r.status, 0, r.stderr);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  assert.equal(out.split('\n').length, 2, out);
  assert.match(out, /Opus/);
  const budget = Number(process.env.WHIP_PERF_BUDGET_MS) || 50; // CI runners get more room
  assert.ok(median < budget, `median ${median.toFixed(1)} ms (budget ${budget})`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the lane names the personality on duty and shows when it is muted', () => {
  const personas = require('../../lib/personas');
  const s = stateWith([{ ts: T0, g: 0.6 }]);
  const c = cfg();
  Object.defineProperty(c, 'persona', { value: personas.get('timid'), enumerable: false });
  const lane = render.whipLane(s, null, c, plain, T0 + 600000 + 1);
  assert.match(lane, /· 🎭 Pip$/);
  assert.match(render.whipLane(s, null, Object.assign(c, { muted: true }), plain, T0 + 600000 + 1), /🎭 Pip 🔇$/);
  assert.match(render.whipLane(s, null, Object.assign(c, { ascii: true }), plain, T0 + 600000 + 1), /\| Pip \[muted\]$/);
});

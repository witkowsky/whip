#!/usr/bin/env node
'use strict';
// Measures the status line end to end (process spawn included), the way
// Claude Code runs it. Usage: node scripts/bench-statusline.js [runs]
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const runs = Number(process.argv[2]) || 50;
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-bench-'));
const env = { ...process.env, WHIP_HOME: home, FORCE_COLOR: '1' };
spawnSync(process.execPath, [path.join(ROOT, 'bin/whip'), 'simulate', '--g', '0.6'], { env });
const input = JSON.stringify({ session_id: 'bench', cwd: ROOT, model: { id: 'claude-opus-5-5', display_name: 'Opus' }, workspace: { current_dir: ROOT }, version: '2.1.286' });

const times = [];
for (let i = 0; i < runs + 3; i++) {
  const t0 = process.hrtime.bigint();
  const r = spawnSync(process.execPath, [path.join(ROOT, 'statusline/statusline.js')], { input, env });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (r.status !== 0) throw new Error(String(r.stderr));
  if (i >= 3) times.push(ms); // skip warm-up
}
const base = [];
for (let i = 0; i < 20; i++) {
  const t0 = process.hrtime.bigint();
  spawnSync(process.execPath, ['-e', '']);
  base.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
times.sort((a, b) => a - b);
base.sort((a, b) => a - b);
const pct = (a, p) => a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))].toFixed(1);
console.log(`status line, ${runs} runs (node ${process.versions.node}, ${os.cpus()[0].model}):`);
console.log(`  median ${pct(times, 50)} ms · p95 ${pct(times, 95)} ms · max ${times[times.length - 1].toFixed(1)} ms`);
console.log(`  (bare \`node -e ''\` startup: median ${pct(base, 50)} ms)`);
fs.rmSync(home, { recursive: true, force: true });
process.exitCode = Number(pct(times, 50)) < 50 ? 0 : 1;

'use strict';
// `whip calibrate`: tap, slap and WALLOP a few times; we place the tier
// thresholds between what your hands and your laptop actually produce.
const net = require('net');
const readline = require('readline');
const store = require('./store');
const { loadConfig, saveUserConfig } = require('./config');
const { forceBar, fmtG } = require('./render');

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function round2(x) {
  return Math.round(x * 100) / 100;
}

// Boundary between two groups: midway between the top of the lower group and
// the bottom of the upper one when they separate cleanly, otherwise the
// geometric mean of the medians (force spreads multiplicatively).
function boundary(lower, upper) {
  const lo = Math.max(...lower);
  const hi = Math.min(...upper);
  if (hi > lo) return (lo + hi) / 2;
  return Math.sqrt(median(lower) * median(upper));
}

/** Pure: arrays of g values -> { tapMinG, slapG, wallopG, warnings } */
function computeThresholds(taps, slaps, wallops) {
  const warnings = [];
  if (taps.length < 2 || slaps.length < 2 || wallops.length < 1) throw new Error('need at least 2 taps, 2 slaps and 1 WALLOP');
  let slapG = boundary(taps, slaps);
  let wallopG = boundary(slaps, wallops);
  if (median(slaps) <= median(taps) * 1.2) warnings.push('your slaps were barely stronger than your taps; tiers may blur');
  if (median(wallops) <= median(slaps) * 1.2) warnings.push('your WALLOPs were barely stronger than your slaps; tiers may blur');
  const tapMinG = Math.max(0.02, Math.min(...taps) * 0.6);
  if (slapG <= tapMinG) slapG = tapMinG * 1.5;
  if (wallopG <= slapG) wallopG = slapG * 1.5;
  return { tapMinG: round2(tapMinG) || 0.02, slapG: round2(slapG), wallopG: round2(wallopG), warnings };
}

const PHASES = [
  { key: 'taps', want: 3, prompt: 'Tap the palm rest gently, 3 times' },
  { key: 'slaps', want: 3, prompt: 'Now SLAP it like Claude is being slow, 3 times' },
  { key: 'wallops', want: 2, prompt: 'Now a WALLOP, 2 times (mind your coffee)' },
];

function run({ socket, p, yes = false }) {
  const cfg = loadConfig();
  const wasPaused = store.loadState(cfg).paused;
  store.setPaused(true, cfg); // don't whip Claude while you're practising
  const restore = () => store.setPaused(wasPaused, loadConfig());
  const results = { taps: [], slaps: [], wallops: [] };
  let phase = -1;
  let timer = null;

  const sock = net.createConnection(socket);
  let buf = '';
  sock.setEncoding('utf8');
  sock.on('error', (e) => {
    restore();
    console.error(p.red(`cannot reach the sensor at ${socket} (${e.code}).`));
    console.error('Install the sensor daemon first (./install.sh), or check `whip doctor`.');
    process.exit(1);
  });

  const next = () => {
    clearTimeout(timer);
    phase++;
    if (phase >= PHASES.length) return finish();
    const ph = PHASES[phase];
    console.log(`\n${p.bold(`${phase + 1}/3`)}  ${ph.prompt}… ${p.muted('(15 s)')}`);
    timer = setTimeout(() => {
      if (results[ph.key].length < (ph.key === 'wallops' ? 1 : 2)) {
        console.log(p.yellow(`  only ${results[ph.key].length} detected; let's try that again`));
        phase--;
      }
      next();
    }, 15000);
  };

  sock.on('connect', () => {
    console.log(p.bold('ClaudeWhip calibration') + p.muted('  (whip paused while calibrating)'));
    setTimeout(next, 300);
  });

  sock.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let ev;
      try {
        ev = JSON.parse(line);
      } catch {
        continue;
      }
      if (phase < 0 || phase >= PHASES.length || !Number.isFinite(ev.g)) continue;
      const ph = PHASES[phase];
      results[ph.key].push(ev.g);
      console.log(`  ${fmtG(ev.g).padStart(6)} ${forceBar(ev.g, cfg, p, cfg.ascii)}`);
      if (results[ph.key].length === ph.want) setTimeout(next, 600);
    }
  });

  function finish() {
    sock.destroy();
    let t;
    try {
      t = computeThresholds(results.taps, results.slaps, results.wallops);
    } catch (e) {
      restore();
      console.error(p.red(e.message));
      process.exit(1);
    }
    console.log(`\n${p.bold('Suggested tiers')}`);
    console.log(`  tap    ≥ ${fmtG(t.tapMinG)}   ${p.muted(`(yours: ${results.taps.map(fmtG).join(' ')})`)}`);
    console.log(`  slap   ≥ ${fmtG(t.slapG)}   ${p.muted(`(yours: ${results.slaps.map(fmtG).join(' ')})`)}`);
    console.log(`  WALLOP ≥ ${fmtG(t.wallopG)}   ${p.muted(`(yours: ${results.wallops.map(fmtG).join(' ')})`)}`);
    for (const w of t.warnings) console.log(p.yellow(`  ! ${w}`));
    const save = () => {
      saveUserConfig({ thresholds: { tapMinG: t.tapMinG, slapG: t.slapG, wallopG: t.wallopG } });
      restore();
      console.log(p.green('saved to config.json — whip is live again'));
      process.exit(0);
    };
    if (yes) return save();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Save these thresholds? [Y/n] ', (a) => {
      rl.close();
      if (/^n/i.test(a.trim())) {
        restore();
        console.log('not saved');
        process.exit(0);
      }
      save();
    });
  }

  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });
}

module.exports = { run, computeThresholds, boundary, median };

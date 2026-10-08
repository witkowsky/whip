#!/usr/bin/env node
'use strict';
// `whip demo`: a scripted tour of every state, rendered the way Claude Code's
// footer shows it. Uses the real engine and renderers in memory with a virtual
// clock (so it can show "2h without a slap" without waiting two hours).
const { applyHit, emptyState } = require('../lib/engine');
const { DEFAULTS, clone } = require('../lib/config');
const render = require('../lib/render');
const { painter, padRight } = require('../lib/ansi');

function run(args = {}) {
  const cfg = clone(DEFAULTS);
  if (args.ascii) cfg.ascii = true;
  Object.defineProperty(cfg, 'persona', { value: require('../lib/personas').get(args.persona || 'classic'), enumerable: false });
  const p = painter(!args.plain && !process.env.NO_COLOR, args.light ? 'light' : 'dark');
  const W = Math.min(process.stdout.columns || 100, 100);
  let state = emptyState();
  let vnow = Date.now();
  let session = { id: 'demo', cwd: '/Users/you/acme-api', tool: null, pending: null };
  const transcript = [
    p.muted('> fix the flaky login test'),
    '',
    `${p.accent('⏺')} Reading ${p.bold('src/auth/login.ts')}…`,
  ];
  let caption = '';
  const rule = p.muted('─'.repeat(W));

  const draw = () => {
    const body = transcript.slice(-9);
    while (body.length < 9) body.unshift('');
    const lines = [
      p.bold(padRight(` ${caption}`, W)),
      '',
      ...body,
      rule,
      `${p.accent('❯')} `,
      rule,
      `  ${render.infoLine({ model: { display_name: 'Opus 5.5' }, cwd: session.cwd }, 'main', p, cfg.ascii)}`,
      `  ${render.whipLane(state, session, cfg, p, vnow)}`,
    ];
    process.stdout.write('\x1b[H' + lines.map((l) => l + '\x1b[K').join('\n') + '\x1b[J');
  };

  const steps = [];
  const at = (ms, fn) => steps.push({ ms, fn });
  const hit = (g, label) => () => {
    caption = label;
    const r = applyHit(state, { ts: vnow, g, source: 'simulate', session: 'demo', cwd: session.cwd }, cfg);
    state = r.state;
    if (r.result.whip) session = { ...session, pending: r.result.whip };
  };
  const deliver = (via) => () => {
    const w = session.pending;
    if (!w) return;
    session = { ...session, pending: null };
    transcript.push(`  ${p.muted('⎿')}  ${p.muted(`${via} says:`)} ${render.banner(w, cfg).split('\n').join('\n     ')}`);
    transcript.push(`${p.accent('⏺')} ${render.face(w.combo >= 3 || w.tier === 'wallop' ? 'stunned' : 'hit', cfg.ascii, cfg.persona)} ${cfg.persona.flinch} ${w.tier === 'wallop' ? 'stopping. Done: parser fix. Left: one test. Fastest: patch the fixture.' : 'skipping the refactor, patching the test directly.'}`);
  };
  const tool = (name, text) => () => {
    session = { ...session, tool: name ? { name, since: vnow } : null };
    if (text) transcript.push(text);
  };

  // timeline (ms of real time)
  at(0, () => (caption = 'Claude is working…  (status line: idle face, counters)'));
  at(1500, tool('Bash', `${p.accent('⏺')} Bash(npm test -- login)`));
  at(2600, hit(0.22, '👋 a light tap → nudge only (no interrupt)'));
  at(4600, hit(0.62, '✋ SLAP 0.62g → the whip travels across the status line'));
  at(6400, deliver('PostToolUse:Bash'));
  at(6400, tool(null));
  at(8400, () => (caption = 'Claude flinched and got to the point; the face recovers'));
  at(11000, tool('Edit', `${p.accent('⏺')} Update(${p.bold('test/login.test.ts')})`));
  at(11500, hit(0.55, '✋✋✋ three slaps in 5 s → combo + escalation to a WALLOP'));
  at(12300, hit(0.6, '✋✋✋ three slaps in 5 s → combo + escalation to a WALLOP'));
  at(13100, hit(0.7, '✋✋✋ three slaps in 5 s → combo + escalation to a WALLOP'));
  at(15200, deliver('PreToolUse:Edit'));
  at(15200, tool(null));
  at(18500, () => {
    caption = '…10 minutes and a few more slaps later';
    for (let i = 0; i < 3; i++) {
      vnow += 60000;
      state = applyHit(state, { ts: vnow, g: 0.5, source: 'simulate', session: 'demo', cwd: session.cwd }, cfg).state;
    }
    vnow += 30000;
  });
  at(21500, () => {
    caption = '…and after two quiet hours';
    vnow += 2 * 3600 * 1000;
  });
  at(24500, () => (caption = 'ClaudeWhip — slap your MacBook, whip Claude Code'));
  const END = 27000;

  process.stdout.write('\x1b[?25l\x1b[2J');
  const t0 = Date.now();
  let last = t0;
  let i = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    vnow += now - last;
    last = now;
    while (i < steps.length && now - t0 >= steps[i].ms) steps[i++].fn();
    draw();
    if (now - t0 > END) {
      clearInterval(timer);
      process.stdout.write('\x1b[?25h\n');
    }
  }, 80);
  process.on('SIGINT', () => {
    process.stdout.write('\x1b[?25h\n');
    process.exit(0);
  });
}

if (require.main === module) {
  const i = process.argv.indexOf('--persona');
  run({ ascii: process.argv.includes('--ascii'), light: process.argv.includes('--light'), plain: process.argv.includes('--plain'), persona: i > 0 ? process.argv[i + 1] : undefined });
}
module.exports = { run };

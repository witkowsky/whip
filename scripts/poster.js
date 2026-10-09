#!/usr/bin/env node
'use strict';
// A static, dark-mode poster frame for sharing (vhs docs/poster.tape).
const { applyHit, emptyState } = require('../lib/engine');
const { DEFAULTS, clone } = require('../lib/config');
const personas = require('../lib/personas');
const render = require('../lib/render');
const { painter } = require('../lib/ansi');

const cfg = clone(DEFAULTS);
Object.defineProperty(cfg, 'persona', { value: personas.classic, enumerable: false });
const p = painter(true, 'dark');
const T = Date.now();
let s = emptyState();
for (const [dt, g] of [[-2600, 0.55], [-1700, 0.6], [-1000, 1.21]]) s = applyHit(s, { ts: T + dt, g, cwd: '/x/acme-api' }, cfg).state;
const w = { tier: 'slap', g: 0.74, combo: 3, slapNo: 42, line: 'Stop overthinking. Ship it.' };
const rule = p.muted('─'.repeat(72));
// Faces that render cleanly in common monospace fonts.
const faces = [['(×﹏×)', 'Classic'], ['ᕦ(ò_óˇ)ᕤ', 'Iron'], ['(>_<)', 'Pip'], ['(≧﹏≦)', 'Mochi'], ['(-_-)7', 'Sterling']]
  .map(([f, n]) => `${p.face(f)} ${p.muted(n)}`)
  .join('   ');
const out = [
  '',
  `  ${p.bold(p.accent('ClaudeWhip'))}  ${p.bold('slap your MacBook, whip Claude Code')}`,
  '',
  `  ${p.accent('⏺')} Bash(npm test -- login)`,
  `    ${p.muted('⎿')}  ${p.muted('PostToolUse:Bash says:')} ${render.banner(w, cfg).split('\n').join('\n       ')}`,
  `  ${p.accent('⏺')} ${render.face('stunned', false)} ok ok — skipping the refactor, patching the test directly.`,
  `  ${rule}`,
  `  ${p.accent('❯')}`,
  `  ${rule}`,
  `    ${render.infoLine({ model: { display_name: 'Opus 5.5' }, cwd: '/x/acme-api' }, 'main', p, false)}`,
  `    ${render.whipLane(s, { pending: true }, cfg, p, T)}`,
  '',
  `  ${faces}`,
  '',
  `  ${p.muted('accelerometer → hooks → status line · WALLOP interrupts')}`,
  '',
  `  ${p.bold(p.green('github.com/witkowsky/whip'))}`,
];
process.stdout.write('\x1b[2J\x1b[H\x1b[?25l' + out.join('\n'));
setTimeout(() => process.stdout.write('\x1b[?25h'), 60000);

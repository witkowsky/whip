'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { applyHit, emptyState } = require('../../lib/engine');
const sound = require('../../lib/sound');
const { cfg, tmpHome } = require('../helpers');

const T0 = Date.now();

test('slaps and WALLOPs get a spoken line; taps do not', () => {
  const tap = applyHit(emptyState(), { ts: T0, g: 0.2 }, cfg());
  assert.equal(tap.result.hit.say, null);
  const slap = applyHit(tap.state, { ts: T0 + 10000, g: 0.6 }, cfg());
  assert.ok(slap.result.hit.say.length > 3);
  const wallop = applyHit(slap.state, { ts: T0 + 20000, g: 1.2 }, cfg());
  assert.ok(wallop.result.hit.say.length > 3);
  assert.notEqual(slap.result.hit.say, wallop.result.hit.say);
});

test('spoken lines rotate without repeats', () => {
  let s = emptyState();
  const said = [];
  for (let i = 0; i < 12; i++) {
    const r = applyHit(s, { ts: T0 + i * 10000, g: 0.6 }, cfg());
    s = r.state;
    said.push(r.result.hit.say);
  }
  assert.equal(new Set(said).size, 12);
});

test('combo milestones are announced', () => {
  assert.equal(sound.spokenLine({ say: 'Hurrying!', milestone: 10 }), 'Combo ten! Hurrying!');
  assert.equal(sound.spokenLine({ say: 'Hurrying!', milestone: null }), 'Hurrying!');
  assert.equal(sound.spokenLine({ say: null }), null);
});

test('say argv: rate, optional voice, volume; text is one argument (no shell)', () => {
  assert.deepEqual(sound.sayArgs('Ow; rm -rf ~', cfg({ voiceRate: 230, volume: 0.4 })), ['-r', '230', '[[volm 0.40]] Ow; rm -rf ~']);
  assert.deepEqual(sound.sayArgs('Hi', cfg({ voiceName: 'Samantha' })).slice(2, 4), ['-v', 'Samantha']);
});

test('voice is off by default and rate-limited when on', () => {
  tmpHome();
  assert.equal(sound.speak('Ow', cfg()), false, 'muted by default');
  const on = cfg({ voice: true });
  const t = Date.now();
  // a blank line, so nothing is audible when `say` actually runs
  assert.equal(sound.speak(' ', on, { now: t }), true);
  assert.equal(sound.speak(' ', on, { now: t + 1000 }), false, 'within the cooldown');
  assert.equal(sound.speak(' ', on, { now: t + sound.VOICE_COOLDOWN_MS + 10 }), true);
});

// --- custom sounds -------------------------------------------------------

const fs = require('fs');
const path = require('path');
const personas = require('../../lib/personas');
const config = require('../../lib/config');
const { paths } = require('../../lib/paths');

function touch(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'x');
  return file;
}

function withPersona(id, over = {}) {
  const c = cfg(over);
  Object.defineProperty(c, 'persona', { value: personas.get(id, paths().home), enumerable: false });
  return c;
}

const BUILTIN_DIR = path.join(__dirname, '..', '..', 'sounds');

test('custom sounds: built-in WAVs when nothing is customised', () => {
  tmpHome();
  assert.equal(sound.resolveSound('slap', withPersona('classic')), path.join(BUILTIN_DIR, 'crack.wav'));
  assert.equal(sound.resolveSound('nonsense', withPersona('classic')), path.join(BUILTIN_DIR, 'crack.wav'));
});

test('custom sounds: drop-in folder, any afplay extension, per tier', () => {
  tmpHome();
  const slap = touch(path.join(paths().home, 'sounds', 'slap.mp3'));
  touch(path.join(paths().home, 'sounds', 'notes.txt'));
  assert.equal(sound.resolveSound('slap', withPersona('classic')), slap);
  assert.equal(sound.resolveSound('wallop', withPersona('classic')), path.join(BUILTIN_DIR, 'wallop.wav'), 'other tiers keep the built-in');
});

test('custom sounds: a per-personality folder beats the global drop-in', () => {
  tmpHome();
  touch(path.join(paths().home, 'sounds', 'slap.wav'));
  const pip = touch(path.join(paths().home, 'sounds', 'timid', 'slap.m4a'));
  assert.equal(sound.resolveSound('slap', withPersona('timid')), pip);
  assert.equal(sound.resolveSound('slap', withPersona('rough')), path.join(paths().home, 'sounds', 'slap.wav'));
});

test('custom sounds: a custom persona JSON can carry its own sounds', () => {
  tmpHome();
  const dir = personas.customDir(paths().home);
  const arr = touch(path.join(dir, 'arr.aiff'));
  fs.writeFileSync(path.join(dir, 'pirate.json'), JSON.stringify({ sounds: { slap: 'arr.aiff', wallop: 42, tap: '../../../etc/passwd' } }));
  const c = withPersona('pirate');
  assert.equal(sound.resolveSound('slap', c), arr, 'relative to the personas folder');
  assert.equal(sound.resolveSound('wallop', c), path.join(BUILTIN_DIR, 'wallop.wav'), 'junk is ignored');
  assert.equal(sound.resolveSound('tap', c), path.join(BUILTIN_DIR, 'tap.wav'), 'no audio extension, ignored');
});

test('custom sounds: an explicit sounds.<tier> path wins; a missing file falls back', () => {
  tmpHome();
  touch(path.join(paths().home, 'sounds', 'timid', 'slap.wav'));
  const bonk = touch(path.join(paths().home, 'bonk.mp3'));
  assert.equal(sound.resolveSound('slap', withPersona('timid', { sounds: { tap: '', slap: 'bonk.mp3', wallop: '' } })), bonk, 'relative to the whip folder');
  assert.equal(sound.resolveSound('slap', withPersona('classic', { sounds: { tap: '', slap: bonk, wallop: '' } })), bonk);
  const gone = withPersona('classic', { sounds: { tap: '', slap: '/nope/gone.wav', wallop: '' } });
  assert.equal(sound.resolveSound('slap', gone), path.join(BUILTIN_DIR, 'crack.wav'));
  assert.deepEqual(sound.missingSounds(gone), ['sounds.slap: /nope/gone.wav']);
});

test('custom sounds: whip config set sounds.slap stores a path; "sounds on" still means sound', () => {
  tmpHome();
  assert.deepEqual(config.parseSetting('sounds.slap', '~/bonk.mp3'), { sounds: { slap: '~/bonk.mp3' } });
  assert.deepEqual(config.parseSetting('sounds', 'on'), { sound: true });
  assert.throws(() => config.parseSetting('sounds.boing', 'x'), /unknown setting/);
});

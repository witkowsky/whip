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

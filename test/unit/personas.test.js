'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const personas = require('../../lib/personas');
const render = require('../../lib/render');
const sound = require('../../lib/sound');
const { applyHit, emptyState } = require('../../lib/engine');
const { painter } = require('../../lib/ansi');
const { cfg, tmpHome } = require('../helpers');

const plain = painter(false);
const T0 = Date.now();

function withPersona(id, over = {}) {
  const c = cfg(over);
  Object.defineProperty(c, 'persona', { value: personas.get(id), enumerable: false });
  return c;
}

test('every built-in personality is complete, and its ASCII faces are ASCII', () => {
  for (const p of Object.values(personas.BUILTIN)) {
    for (const k of personas.FACE_KEYS) {
      assert.ok(Array.isArray(p.faces[k]) && p.faces[k].length === 2, `${p.id}.${k}`);
      assert.match(p.faces[k][1], /^[\x20-\x7e]+$/, `${p.id}.${k} ascii`);
    }
    for (const k of ['apology', 'tap', 'voiceSlap', 'voiceWallop']) assert.ok(p[k].length >= 5, `${p.id}.${k}`);
    for (const line of [...p.voiceSlap, ...p.voiceWallop]) assert.match(line, /^[\x20-\x7e]+$/, `${p.id} spoken line is plain text: ${line}`);
    assert.ok(p.whack && p.flinch && p.lines.empty && p.lines.calm.includes('{t}') && p.lines.sweating.includes('{n}'), p.id);
  }
});

test('the personality changes faces, banner word, lane text and what Claude is invited to say', () => {
  let s = emptyState();
  s = applyHit(s, { ts: T0, g: 0.6 }, withPersona('rough')).state;
  const rough = withPersona('rough');
  assert.match(render.whipLane(s, null, rough, plain, T0 + 1000), /^\(ง •̀_•́\)ง .*YEAH!/);
  assert.match(render.whipLane(null, null, withPersona('timid'), plain, T0), /please keep it that way/);
  const w = s.lastHit;
  assert.match(render.banner(w, withPersona('kawaii')), /BONK!\s+\(≧﹏≦\)/);
  const msg = render.messageForClaude(w, withPersona('butler'));
  assert.match(msg, /personality is "Sterling"/);
  assert.match(msg, /Most regrettable\. At once —/);
  assert.match(msg, /keep everything after that line normal and on task/);
  assert.match(msg, /What they want now: /, 'the useful instruction is unchanged');
  assert.doesNotMatch(render.messageForClaude(w, withPersona('classic')), /personality is/);
});

test('apologies and spoken lines come from the active personality', () => {
  const r = applyHit(emptyState(), { ts: T0, g: 0.6 }, withPersona('timid'));
  assert.ok(personas.BUILTIN.timid.apology.includes(r.result.hit.apology));
  assert.ok(personas.BUILTIN.timid.voiceSlap.includes(r.result.hit.say));
  assert.equal(r.result.hit.persona, 'timid');
  const tap = applyHit(emptyState(), { ts: T0, g: 0.2 }, withPersona('kawaii'));
  assert.ok(personas.BUILTIN.kawaii.tap.includes(tap.result.hit.line));
});

test('each personality speaks with its own voice unless you pick one', () => {
  assert.deepEqual(sound.sayArgs('Yeah!', withPersona('rough')).slice(0, 4), ['-r', '230', '-v', 'Ralph']);
  assert.deepEqual(sound.sayArgs('Hi', withPersona('rough', { voiceName: 'Samantha', voiceRate: 180 })).slice(0, 4), ['-r', '180', '-v', 'Samantha']);
  assert.deepEqual(sound.sayArgs('Hi', withPersona('classic')).slice(0, 2), ['-r', '210']);
});

test('custom personalities load from ~/.claude/whip/personas/*.json; junk is ignored', () => {
  tmpHome();
  const { paths } = require('../../lib/paths');
  const dir = personas.customDir(paths().home);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'pirate.json'),
    JSON.stringify({ name: 'Captain', whack: 'ARRR!', faces: { hit: ['(╬ಠ益ಠ)', '(>_<)'], idle: '(=^.^=)' }, voiceSlap: ['Arr! Faster!'], apology: 42, bogus: true }),
  );
  fs.writeFileSync(path.join(dir, 'broken.json'), '{nope');
  fs.writeFileSync(path.join(dir, 'classic.json'), JSON.stringify({ whack: 'HIJACK' }));
  const all = personas.all(paths().home);
  assert.ok(all.pirate && all.pirate.custom);
  assert.equal(all.pirate.whack, 'ARRR!');
  assert.deepEqual(all.pirate.faces.hit, ['(╬ಠ益ಠ)', '(>_<)']);
  assert.equal(all.pirate.faces.idle[0], '(=^.^=)');
  assert.deepEqual(all.pirate.voiceSlap, ['Arr! Faster!']);
  assert.deepEqual(all.pirate.apology, personas.classic.apology, 'bad field falls back');
  assert.ok(!all.broken, 'unparseable file skipped');
  assert.equal(all.classic.whack, 'WHACK!', 'built-ins cannot be shadowed');
  // config validation knows about it
  const config = require('../../lib/config');
  assert.deepEqual(config.parseSetting('personality', 'pirate'), { personality: 'pirate' });
  assert.throws(() => config.parseSetting('personality', 'nope'), /one of: classic, rough, timid, kawaii, butler/);
  config.saveUserConfig({ personality: 'pirate' });
  assert.equal(config.loadConfig().persona.name, 'Captain');
  assert.ok(!('persona' in JSON.parse(fs.readFileSync(paths().config, 'utf8'))), 'the resolved object is never saved');
});

test('an unknown personality in config falls back to classic', () => {
  tmpHome();
  const config = require('../../lib/config');
  config.saveUserConfig({ personality: 'deleted-one' });
  assert.equal(config.loadConfig().persona.id, 'classic');
});

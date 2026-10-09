'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-opts-'));
process.env.WHIP_HOME = home;
const config = require('../../lib/config');
const { messageForClaude } = require('../../lib/render');

test('plugin settings write through; "whip config" leaves config.json alone', () => {
  const settings = path.join(home, 'settings.json');
  fs.writeFileSync(settings, JSON.stringify({ pluginConfigs: { 'whip@claudewhip': { options: { sound: 'on', banner: 'whip config', personality: 'kawaii', lane: 'hide' } } } }));
  const changed = config.applyPluginOptions({ CLAUDE_PLUGIN_OPTION_REACTION: 'off' }, settings);
  assert.deepEqual(changed.sort(), ['hidden', 'personality', 'reaction', 'sound']);
  const cfg = config.loadConfig();
  assert.equal(cfg.sound, true);
  assert.equal(cfg.reaction, false);
  assert.equal(cfg.banner, true);
  assert.equal(cfg.personality, 'kawaii');
  assert.equal(cfg.hidden, true);
  assert.deepEqual(config.applyPluginOptions({ CLAUDE_PLUGIN_OPTION_REACTION: 'off' }, settings), []);
});

test('sounds is accepted as sound', () => {
  assert.deepEqual(config.parseSetting('sounds', 'true'), { sound: true });
});

test('reaction off drops the in-character line', () => {
  const w = { tier: 'slap', slapNo: 1, g: 0.5, combo: 1, line: 'Go.', instruction: 'Hurry.' };
  const cfg = config.loadConfig();
  assert.match(messageForClaude(w, { ...cfg, reaction: true, persona: cfg.persona }), /in-character reaction like/);
  assert.match(messageForClaude(w, { ...cfg, reaction: false, persona: cfg.persona }), /Skip any in-character reaction/);
});

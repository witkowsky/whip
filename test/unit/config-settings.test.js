'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tmpHome } = require('../helpers');
const config = require('../../lib/config');
const settings = require('../../lib/settings');
const { computeThresholds } = require('../../lib/calibrate');

test('config: user values merge over defaults, bad types and enums are ignored', () => {
  tmpHome();
  const { paths } = require('../../lib/paths');
  fs.mkdirSync(paths().home, { recursive: true });
  fs.writeFileSync(paths().config, JSON.stringify({ cooldownMs: 500, hardWhip: 'nuke', sound: 'yes', thresholds: { slapG: 0.3 }, bogus: 1 }));
  const c = config.loadConfig();
  assert.equal(c.cooldownMs, 500);
  assert.equal(c.hardWhip, 'tmux');
  assert.equal(c.sound, false);
  assert.equal(c.thresholds.slapG, 0.3);
  assert.equal(c.thresholds.wallopG, 0.9);
  assert.ok(!('bogus' in c));
});

test('config: unordered thresholds are repaired', () => {
  tmpHome();
  const { paths } = require('../../lib/paths');
  fs.mkdirSync(paths().home, { recursive: true });
  fs.writeFileSync(paths().config, JSON.stringify({ thresholds: { slapG: 1.5, wallopG: 0.5 } }));
  const t = config.loadConfig().thresholds;
  assert.ok(t.tapMinG < t.slapG && t.slapG < t.wallopG);
});

test('config: corrupt config.json falls back to defaults', () => {
  tmpHome();
  const { paths } = require('../../lib/paths');
  fs.mkdirSync(paths().home, { recursive: true });
  fs.writeFileSync(paths().config, '{oops');
  assert.equal(config.loadConfig().cooldownMs, config.DEFAULTS.cooldownMs);
});

test('config: parseSetting type-checks and rejects unknown keys', () => {
  assert.deepEqual(config.parseSetting('thresholds.slapG', '0.4'), { thresholds: { slapG: 0.4 } });
  assert.deepEqual(config.parseSetting('sound', 'on'), { sound: true });
  assert.deepEqual(config.parseSetting('hardWhip', 'off'), { hardWhip: 'off' });
  assert.deepEqual(config.parseSetting('deliverOn', 'Stop, PreToolUse'), { deliverOn: ['Stop', 'PreToolUse'] });
  assert.throws(() => config.parseSetting('hardWhip', 'nuke'), /one of/);
  assert.throws(() => config.parseSetting('nope', '1'), /unknown/);
  assert.throws(() => config.parseSetting('thresholds', '1'), /group/);
  assert.throws(() => config.parseSetting('cooldownMs', '-3'), /non-negative/);
});

test('config: saveUserConfig persists only user keys', () => {
  tmpHome();
  const { paths } = require('../../lib/paths');
  config.saveUserConfig({ thresholds: { slapG: 0.4 } });
  config.saveUserConfig({ sound: true });
  assert.deepEqual(JSON.parse(fs.readFileSync(paths().config, 'utf8')), { thresholds: { slapG: 0.4 }, sound: true });
});

function writeSettings(obj, raw) {
  const { paths } = require('../../lib/paths');
  fs.writeFileSync(paths().settings, raw || JSON.stringify(obj, null, 4));
  return paths().settings;
}

test('settings: install into a settings.json without statusLine, uninstall restores it byte-for-byte', () => {
  tmpHome();
  const raw = '{\n    "theme": "dark",\n    "model": "opus"\n}\n'; // 4-space indent, custom formatting
  const file = writeSettings(null, raw);
  settings.install({ repoRoot: '/opt/whip', refreshInterval: 1, spinner: true });
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(after.statusLine.command, 'node "/opt/whip/statusline/statusline.js"');
  assert.equal(after.statusLine.refreshInterval, 1);
  assert.equal(after.spinnerVerbs.mode, 'append');
  assert.equal(after.theme, 'dark');
  const res = settings.uninstall();
  assert.equal(res.restored, true);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.includes('whip-backup')), []);
});

test('settings: an existing statusLine is wrapped and restored on uninstall', () => {
  tmpHome();
  const mine = { type: 'command', command: '~/.claude/my-status.sh', padding: 1 };
  const file = writeSettings({ statusLine: mine });
  const res = settings.install({ repoRoot: '/opt/whip', mode: 'wrap' });
  assert.equal(res.wrapped, '~/.claude/my-status.sh');
  assert.ok(settings.isOurs(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine));
  settings.uninstall();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine, mine);
});

test('settings: keep mode leaves an existing statusLine alone', () => {
  tmpHome();
  const mine = { type: 'command', command: 'echo hi' };
  const file = writeSettings({ statusLine: mine });
  settings.install({ repoRoot: '/opt/whip', mode: 'keep' });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine, mine);
});

test('settings: other changes made after install survive uninstall', () => {
  tmpHome();
  const file = writeSettings({ theme: 'dark' });
  settings.install({ repoRoot: '/opt/whip' });
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  cur.enabledPlugins = { 'x@y': true };
  fs.writeFileSync(file, JSON.stringify(cur));
  const res = settings.uninstall();
  assert.equal(res.restored, false);
  const after = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(after, { theme: 'dark', enabledPlugins: { 'x@y': true } });
});

test('settings: no settings.json before install means none after uninstall', () => {
  tmpHome();
  const { paths } = require('../../lib/paths');
  settings.install({ repoRoot: '/opt/whip' });
  assert.ok(fs.existsSync(paths().settings));
  settings.uninstall();
  assert.ok(!fs.existsSync(paths().settings));
});

test('settings: refuses to touch invalid JSON', () => {
  tmpHome();
  writeSettings(null, '{ nope');
  assert.throws(() => settings.install({ repoRoot: '/opt/whip' }), /not valid JSON/);
});

test('calibrate: thresholds land between your tiers', () => {
  const t = computeThresholds([0.08, 0.1, 0.12], [0.35, 0.4, 0.5], [1.0, 1.3]);
  assert.ok(t.slapG > 0.12 && t.slapG < 0.35, `slapG ${t.slapG}`);
  assert.ok(t.wallopG > 0.5 && t.wallopG < 1.0, `wallopG ${t.wallopG}`);
  assert.ok(t.tapMinG <= 0.08 && t.tapMinG >= 0.02);
  assert.deepEqual(t.warnings, []);
});

test('calibrate: overlapping groups still produce ordered tiers and a warning', () => {
  const t = computeThresholds([0.2, 0.3], [0.25, 0.32], [0.3, 0.33]);
  assert.ok(t.tapMinG < t.slapG && t.slapG < t.wallopG);
  assert.ok(t.warnings.length >= 1);
  assert.throws(() => computeThresholds([0.1], [0.4], [1]), /at least/);
});

test('settings: empty containers left by `claude plugin uninstall` do not block a byte-exact restore', () => {
  tmpHome();
  const raw = '{\n  "theme": "light"\n}\n';
  const file = writeSettings(null, raw);
  settings.install({ repoRoot: '/opt/whip' });
  // what `claude plugin install` + `uninstall` + `marketplace remove` leave behind
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  cur.enabledPlugins = {};
  cur.extraKnownMarketplaces = {};
  fs.writeFileSync(file, JSON.stringify(cur, null, 2));
  assert.equal(settings.uninstall().restored, true);
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
});

test('settings: re-install after changing your own status line restores the new one', () => {
  tmpHome();
  const file = writeSettings({ theme: 'dark' });
  settings.install({ repoRoot: '/opt/whip' });
  const cur = JSON.parse(fs.readFileSync(file, 'utf8'));
  cur.statusLine = { type: 'command', command: 'my-new-status' };
  fs.writeFileSync(file, JSON.stringify(cur));
  settings.install({ repoRoot: '/opt/whip' }); // re-run install.sh
  settings.uninstall();
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).statusLine, { type: 'command', command: 'my-new-status' });
});

test('settings: a symlinked settings.json stays a symlink', () => {
  const dir = tmpHome();
  const { paths } = require('../../lib/paths');
  const real = path.join(dir, 'dotfiles-settings.json');
  fs.writeFileSync(real, '{\n  "theme": "dark"\n}\n');
  fs.symlinkSync(real, paths().settings);
  settings.install({ repoRoot: '/opt/whip' });
  assert.ok(fs.lstatSync(paths().settings).isSymbolicLink());
  assert.ok(JSON.parse(fs.readFileSync(real, 'utf8')).statusLine);
  settings.uninstall();
  assert.ok(fs.lstatSync(paths().settings).isSymbolicLink());
  assert.equal(fs.readFileSync(real, 'utf8'), '{\n  "theme": "dark"\n}\n');
});

test('settings: invalid JSON at uninstall time is reported as a failure', () => {
  tmpHome();
  const file = writeSettings({ theme: 'dark' });
  settings.install({ repoRoot: '/opt/whip' });
  fs.writeFileSync(file, '{ broken');
  const res = settings.uninstall();
  assert.equal(res.failed, true);
  assert.equal(fs.readFileSync(file, 'utf8'), '{ broken');
});

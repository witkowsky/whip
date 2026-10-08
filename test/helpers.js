'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DEFAULTS, clone } = require('../lib/config');

// Fresh WHIP_HOME + CLAUDE_CONFIG_DIR per test so nothing touches ~/.claude.
function tmpHome() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whip-test-'));
  process.env.WHIP_HOME = path.join(dir, 'whip');
  process.env.CLAUDE_CONFIG_DIR = path.join(dir, 'claude');
  fs.mkdirSync(process.env.CLAUDE_CONFIG_DIR, { recursive: true });
  return dir;
}

function cfg(over = {}) {
  return { ...clone(DEFAULTS), ...over, thresholds: { ...DEFAULTS.thresholds, ...(over.thresholds || {}) }, escalate: { ...DEFAULTS.escalate, ...(over.escalate || {}) } };
}

const ROOT = path.resolve(__dirname, '..');

module.exports = { tmpHome, cfg, ROOT };

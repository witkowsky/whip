'use strict';
// Where everything lives. WHIP_HOME overrides the whole tree (tests, e2e, demos);
// otherwise we follow CLAUDE_CONFIG_DIR like Claude Code itself does.
const path = require('path');
const os = require('os');

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

function whipHome() {
  return process.env.WHIP_HOME || path.join(claudeDir(), 'whip');
}

function paths() {
  const home = whipHome();
  return {
    home,
    state: path.join(home, 'state.json'),
    config: path.join(home, 'config.json'),
    events: path.join(home, 'events.jsonl'),
    eventsOld: path.join(home, 'events.jsonl.1'),
    sessions: path.join(home, 'sessions'),
    log: path.join(home, 'hooks.log'),
    lock: path.join(home, 'state.lock'),
    // The root sensor daemon owns this directory; the bridge only connects.
    sensorSocket: process.env.WHIP_SENSOR_SOCKET || '/var/run/claudewhip/sensor.sock',
    settings: path.join(claudeDir(), 'settings.json'),
  };
}

function sessionFile(id) {
  // Session ids come from Claude Code (UUIDs) but never trust a path segment.
  const safe = String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'unknown';
  return path.join(paths().sessions, safe + '.json');
}

module.exports = { paths, sessionFile, claudeDir, whipHome };

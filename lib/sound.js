'use strict';
// Optional, muted by default. The WAVs in sounds/ are synthesised by
// scripts/gen-sounds.js (original, CC0); no third-party clips. Speech uses the
// macOS `say` voice with original lines from lib/pools.js.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { paths } = require('./paths');

const FILES = { tap: 'tap.wav', slap: 'crack.wav', wallop: 'wallop.wav' };
const VOICE_COOLDOWN_MS = 2500; // a 10-slap combo shouldn't become a 10-voice choir
const MILESTONE_WORDS = { 5: 'Combo five!', 10: 'Combo ten!', 25: 'Combo twenty five!' };

function detached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function play(tier, cfg) {
  if (!cfg.sound) return false;
  const file = path.join(__dirname, '..', 'sounds', FILES[tier] || FILES.slap);
  if (!fs.existsSync(file) || !fs.existsSync('/usr/bin/afplay')) return false;
  detached('/usr/bin/afplay', ['-v', String(cfg.volume), file]);
  return true;
}

/** Pure: what Claude says for this hit, or null. */
function spokenLine(hit) {
  if (!hit || !hit.say) return null;
  const milestone = MILESTONE_WORDS[hit.milestone];
  return milestone ? `${milestone} ${hit.say}` : hit.say;
}

/** Pure: argv for /usr/bin/say. Text goes in as one argument, never through a shell. */
function sayArgs(text, cfg) {
  const pv = (cfg.persona && cfg.persona.voice) || {};
  const args = ['-r', String(Math.round(cfg.voiceRate || pv.rate) || 210)];
  const voice = cfg.voiceName || pv.name;
  if (voice) args.push('-v', voice);
  args.push(`[[volm ${Math.min(1, Math.max(0, cfg.volume)).toFixed(2)}]] ${text}`);
  return args;
}

// Cooldown shared by the bridge and `whip simulate`: the marker file's mtime.
function voiceAllowed(now) {
  const marker = path.join(paths().home, '.voice');
  try {
    if (now - fs.statSync(marker).mtimeMs < VOICE_COOLDOWN_MS) return false;
  } catch {}
  try {
    fs.mkdirSync(paths().home, { recursive: true });
    fs.closeSync(fs.openSync(marker, 'w'));
    fs.utimesSync(marker, now / 1000, now / 1000);
  } catch {}
  return true;
}

function speak(text, cfg, { now = Date.now(), delayMs = 0 } = {}) {
  if (!cfg.voice || !text || !fs.existsSync('/usr/bin/say')) return false;
  if (!voiceAllowed(now)) return false;
  const args = sayArgs(text, cfg);
  if (delayMs > 0) detached('/bin/sh', ['-c', 'sleep "$1"; shift; exec /usr/bin/say "$@"', 'sh', String(delayMs / 1000), ...args]);
  else detached('/usr/bin/say', args);
  return true;
}

/** Crack first, then Claude yelps (taps stay silent apart from the tap sound). */
function react(result, cfg, now = Date.now()) {
  const played = play(result.tier, cfg);
  const spoke = result.tier !== 'tap' && speak(spokenLine(result.hit), cfg, { now, delayMs: played ? 350 : 0 });
  return { played, spoke };
}

module.exports = { play, speak, react, spokenLine, sayArgs, FILES, VOICE_COOLDOWN_MS };

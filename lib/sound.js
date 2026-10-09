'use strict';
// Optional, muted by default. The WAVs in sounds/ are synthesised by
// scripts/gen-sounds.js (original, CC0); no third-party clips. Speech uses the
// macOS `say` voice with original lines from lib/pools.js.
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');
const { paths } = require('./paths');
const personas = require('./personas');

const FILES = { tap: 'tap.wav', slap: 'crack.wav', wallop: 'wallop.wav' };
const BUILTIN_DIR = path.join(__dirname, '..', 'sounds');
const AUDIO_EXT = ['.wav', '.mp3', '.m4a', '.aiff', '.aif', '.caf']; // what afplay plays
const VOICE_COOLDOWN_MS = 2500; // a 10-slap combo shouldn't become a 10-voice choir
const MILESTONE_WORDS = { 5: 'Combo five!', 10: 'Combo ten!', 25: 'Combo twenty five!' };

function detached(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// "~/x", absolute, or relative to `base`.
function expand(p, base) {
  if (p === '~' || p.startsWith('~/')) return path.join(os.homedir(), p.slice(1));
  return path.resolve(base, p);
}

// <dir>/<tier>.<any audio extension>, first match in AUDIO_EXT order.
function dropIn(dir, tier) {
  for (const ext of AUDIO_EXT) {
    const file = path.join(dir, tier + ext);
    if (isFile(file)) return file;
  }
  return null;
}

/**
 * Which file a hit plays. Most specific wins:
 * config sounds.<tier> → ~/.claude/whip/sounds/<persona>/<tier>.* → the custom
 * persona's own `sounds` → ~/.claude/whip/sounds/<tier>.* → the built-in WAV.
 */
function resolveSound(tier, cfg) {
  if (!FILES[tier]) tier = 'slap';
  const home = paths().home;
  const persona = cfg.persona || personas.classic;
  const fromConfig = cfg.sounds && cfg.sounds[tier] && expand(cfg.sounds[tier], home);
  const fromPersona = persona.sounds && persona.sounds[tier] && expand(persona.sounds[tier], personas.customDir(home));
  return (
    (fromConfig && isFile(fromConfig) && fromConfig) ||
    dropIn(path.join(home, 'sounds', persona.id), tier) ||
    (fromPersona && isFile(fromPersona) && fromPersona) ||
    dropIn(path.join(home, 'sounds'), tier) ||
    path.join(BUILTIN_DIR, FILES[tier])
  );
}

/** For `whip doctor`: custom sounds that are set but can't be played. */
function missingSounds(cfg) {
  const out = [];
  const home = paths().home;
  const persona = cfg.persona || personas.classic;
  for (const tier of Object.keys(FILES)) {
    const set = cfg.sounds && cfg.sounds[tier];
    if (set && !isFile(expand(set, home))) out.push(`sounds.${tier}: ${set}`);
    const own = persona.sounds && persona.sounds[tier];
    if (own && !isFile(expand(own, personas.customDir(home)))) out.push(`${persona.id} persona sounds.${tier}: ${own}`);
  }
  return out;
}

function play(tier, cfg) {
  if (!cfg.sound) return false;
  const file = resolveSound(tier, cfg);
  if (!isFile(file) || !fs.existsSync('/usr/bin/afplay')) return false;
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

module.exports = { resolveSound, missingSounds, AUDIO_EXT, play, speak, react, spokenLine, sayArgs, FILES, VOICE_COOLDOWN_MS };

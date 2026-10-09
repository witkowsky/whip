'use strict';
// ~/.claude/whip/config.json is user-owned. We only ever read it, merge it over
// defaults, and (from /whip-config or `whip calibrate`) write it atomically.
const { paths } = require('./paths');
const { readJson, writeJsonAtomic } = require('./fsx');
const personas = require('./personas');

const DEFAULTS = Object.freeze({
  thresholds: { tapMinG: 0.05, slapG: 0.45, wallopG: 0.9 },
  cooldownMs: 350, // one physical slap can ring for a few hundred ms
  comboWindowMs: 4000, // hits closer than this build `combo xN`
  escalate: { count: 3, windowMs: 5000 }, // 3+ slaps within 5 s count as a WALLOP
  personality: 'classic', // classic | rough | timid | kawaii | butler | your own (whip persona)
  target: 'recent', // 'recent' | 'all'
  hardWhip: 'tmux', // 'tmux' | 'osascript' | 'off'
  softMode: 'context', // 'context' (add a note to Claude) | 'deny' (block the next tool call once)
  deliverOn: ['PreToolUse', 'PostToolUse', 'Stop', 'UserPromptSubmit'],
  pendingTtlMs: 15 * 60 * 1000,
  sound: false, // synthesised whip crack via afplay
  voice: false, // Claude yelps a line out loud via macOS `say`
  voiceName: '', // a `say -v` voice, e.g. "Samantha"; empty = system voice
  voiceRate: 0, // words per minute; 0 = the personality's own pace
  volume: 0.5,
  ascii: false,
  color: 'auto', // 'auto' | 'always' | 'never'
  theme: 'auto', // 'auto' | 'dark' | 'light'
  statusLines: 2, // 1 squeezes the whip lane onto the info line
  wrapStatusLine: '', // your previous statusLine command; its output becomes line 1
});

const ENUMS = {
  target: ['recent', 'all'],
  hardWhip: ['tmux', 'osascript', 'off'],
  softMode: ['context', 'deny'],
  color: ['auto', 'always', 'never'],
  theme: ['auto', 'dark', 'light'],
};

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

// Deep-merge `over` onto `base`, keeping only keys and types that exist in base.
function mergeTyped(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  if (!isPlainObject(over)) return out;
  for (const [k, v] of Object.entries(over)) {
    if (!(k in base)) continue;
    const b = base[k];
    if (isPlainObject(b)) out[k] = mergeTyped(b, v);
    else if (Array.isArray(b)) {
      if (Array.isArray(v)) out[k] = v.filter((x) => typeof x === 'string');
    } else if (typeof v === typeof b) {
      if (ENUMS[k] && !ENUMS[k].includes(v)) continue;
      if (typeof v === 'number' && !(Number.isFinite(v) && v >= 0)) continue;
      out[k] = v;
    }
  }
  return out;
}

function normalize(cfg) {
  const t = cfg.thresholds;
  // Keep the tiers ordered even if someone hand-edits nonsense.
  if (!(t.slapG > t.tapMinG)) t.slapG = t.tapMinG + 0.01;
  if (!(t.wallopG > t.slapG)) t.wallopG = t.slapG + 0.01;
  cfg.escalate.count = Math.max(2, Math.round(cfg.escalate.count));
  cfg.volume = Math.min(1, cfg.volume);
  return cfg;
}

function loadConfig() {
  const r = readJson(paths().config);
  const cfg = normalize(mergeTyped(clone(DEFAULTS), r.ok ? r.value : {}));
  // Resolved persona object; non-enumerable so it never ends up in config.json.
  Object.defineProperty(cfg, 'persona', { value: personas.get(cfg.personality, paths().home), enumerable: false });
  return cfg;
}

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// Only the user-provided keys are persisted, so defaults can evolve.
function saveUserConfig(partial) {
  const file = paths().config;
  const r = readJson(file);
  const current = r.ok ? r.value : {};
  writeJsonAtomic(file, deepAssign(current, partial));
}

function deepAssign(target, src) {
  for (const [k, v] of Object.entries(src)) {
    if (isPlainObject(v) && isPlainObject(target[k])) deepAssign(target[k], v);
    else target[k] = v;
  }
  return target;
}

// Spellings people reach for that mean an existing key.
const ALIASES = { sounds: 'sound', voices: 'voice', persona: 'personality', hardwhip: 'hardWhip' };

function resolveKey(key) {
  return ALIASES[key] || ALIASES[String(key).toLowerCase()] || key;
}

// "thresholds.slapG" + "0.5" -> { thresholds: { slapG: 0.5 } }, type-checked against defaults.
function parseSetting(key, raw) {
  key = resolveKey(key);
  const parts = key.split('.');
  let base = DEFAULTS;
  for (const p of parts) {
    if (!isPlainObject(base) || !(p in base)) throw new Error(`unknown setting: ${key}`);
    base = base[p];
  }
  let value;
  if (typeof base === 'number') {
    value = Number(raw);
    if (!Number.isFinite(value) || value < 0) throw new Error(`${key} must be a non-negative number`);
  } else if (typeof base === 'boolean') {
    if (!/^(true|false|on|off|yes|no|1|0)$/i.test(raw)) throw new Error(`${key} must be true or false`);
    value = /^(true|on|yes|1)$/i.test(raw);
  } else if (Array.isArray(base)) {
    value = String(raw).split(',').map((s) => s.trim()).filter(Boolean);
  } else if (key === 'personality') {
    const ids = Object.keys(personas.all(paths().home));
    if (!ids.includes(raw)) throw new Error(`personality must be one of: ${ids.join(', ')}`);
    value = raw;
  } else if (typeof base === 'string') {
    const last = parts[parts.length - 1];
    if (ENUMS[last] && !ENUMS[last].includes(raw)) throw new Error(`${key} must be one of: ${ENUMS[last].join(', ')}`);
    value = String(raw);
  } else {
    throw new Error(`${key} is a group; set one of its fields`);
  }
  const out = {};
  let cur = out;
  parts.forEach((p, i) => {
    if (i === parts.length - 1) cur[p] = value;
    else cur = cur[p] = {};
  });
  return out;
}

module.exports = { DEFAULTS, ENUMS, ALIASES, resolveKey, loadConfig, saveUserConfig, parseSetting, mergeTyped, normalize, clone };

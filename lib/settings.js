'use strict';
// Merging our statusLine (and optional spinnerVerbs) into ~/.claude/settings.json
// and undoing exactly that on uninstall. Plugins cannot ship a statusLine, so
// this is the one place we touch Claude Code's own settings.
const fs = require('fs');
const path = require('path');
const { paths } = require('./paths');
const { readJson, writeAtomic, writeJsonAtomic } = require('./fsx');

const SPINNER_VERBS = ['Hurrying', 'Sweating', 'Flinching', 'Shipping it', 'Speed-running', 'Cutting scope', 'Not overthinking', 'Bracing', 'Moving faster', 'Wincing'];

// Dotfiles setups symlink settings.json; write to the real file so the link survives.
function settingsTarget() {
  const file = paths().settings;
  try {
    return fs.realpathSync(file);
  } catch {
    return file;
  }
}

function installRecordPath() {
  return path.join(paths().home, 'install.json');
}

function statusCommand(repoRoot) {
  const script = path.join(repoRoot, 'statusline', 'statusline.js');
  return `node "${script}"`;
}

function isOurs(statusLine) {
  return !!(statusLine && typeof statusLine.command === 'string' && /statusline[\\/]statusline\.js/.test(statusLine.command) && /whip/i.test(statusLine.command));
}

/**
 * First step of every install, before `claude plugin install` edits
 * settings.json too: keep a byte-exact copy to restore from. No-op when an
 * install record already exists (re-running install.sh keeps the first backup).
 */
function backup({ now = Date.now() } = {}) {
  const file = settingsTarget();
  const prev = readJson(installRecordPath());
  if (prev.ok) return prev.value;
  const r = readJson(file);
  if (!r.ok && !r.missing) throw new Error(`${file} is not valid JSON; fix it first (${r.error && r.error.message})`);
  const raw = r.ok ? fs.readFileSync(file, 'utf8') : null;
  const record = { installedAt: now, backup: null, settingsExisted: raw !== null, addedSpinner: false };
  if (raw !== null) {
    record.backup = `${file}.whip-backup-${new Date(now).toISOString().replace(/[:.]/g, '-')}`;
    writeAtomic(record.backup, raw);
  }
  record.previousStatusLine = r.ok && r.value.statusLine && !isOurs(r.value.statusLine) ? r.value.statusLine : null;
  writeJsonAtomic(installRecordPath(), record);
  return record;
}

/**
 * mode: 'wrap' (keep your status line as line 1), 'replace', or 'keep' (leave
 * settings alone; the whip lane then needs your own script to call ours).
 */
function install({ repoRoot, mode = 'wrap', refreshInterval = 1, spinner = false, now = Date.now() }) {
  const file = settingsTarget();
  const r = readJson(file);
  if (!r.ok && !r.missing) throw new Error(`${file} is not valid JSON; fix it first (${r.error && r.error.message})`);
  const original = r.ok ? r.value : {};
  const record = backup({ now });

  const next = { ...original };
  const notes = [];
  const existing = original.statusLine;
  if (existing && !isOurs(existing) && mode === 'keep') {
    notes.push('kept your existing statusLine untouched (whip lane not shown)');
  } else {
    // Re-install after you changed your own status line: remember the new one.
    if (existing && !isOurs(existing)) record.previousStatusLine = existing;
    if (existing && !isOurs(existing) && mode === 'wrap') {
      record.wrapped = existing.command;
      notes.push(`wrapping your existing status line: ${existing.command}`);
    }
    next.statusLine = { type: 'command', command: statusCommand(repoRoot), padding: 0 };
    if (refreshInterval > 0) next.statusLine.refreshInterval = refreshInterval;
  }
  if (spinner && !original.spinnerVerbs) {
    next.spinnerVerbs = { mode: 'append', verbs: SPINNER_VERBS };
    record.addedSpinner = true;
    notes.push('added themed spinnerVerbs (append mode)');
  }
  record.repoRoot = repoRoot;
  record.node = process.execPath; // the desktop mod runs `whip` with this
  record.mode = mode;
  writeJsonAtomic(file, next);
  writeJsonAtomic(installRecordPath(), record);
  return { notes, record, wrapped: record.wrapped || null };
}

function isEmptyContainer(v) {
  return v !== null && typeof v === 'object' && Object.keys(v).length === 0;
}

function sameJson(a, b) {
  return JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])]));
  return v;
}

/** Undo our keys; if the result matches the backup, restore the backup byte-for-byte. */
function uninstall() {
  const file = settingsTarget();
  const rec = readJson(installRecordPath());
  const record = rec.ok ? rec.value : {};
  const r = readJson(file);
  if (!r.ok && r.missing) return { restored: false, note: 'no settings.json' };
  if (!r.ok) return { restored: false, failed: true, note: `settings.json is not valid JSON; left alone (your backup: ${record.backup || 'none'})` };
  const cur = { ...r.value };
  if (isOurs(cur.statusLine)) {
    if (record.previousStatusLine) cur.statusLine = record.previousStatusLine;
    else delete cur.statusLine;
  }
  if (record.addedSpinner && cur.spinnerVerbs && cur.spinnerVerbs.mode === 'append' && sameJson(cur.spinnerVerbs.verbs, SPINNER_VERBS)) delete cur.spinnerVerbs;

  let restored = false;
  let note = 'removed whip keys from settings.json';
  if (record.backup && fs.existsSync(record.backup)) {
    const b = readJson(record.backup);
    // `claude plugin uninstall` / `marketplace remove` leave empty
    // enabledPlugins / extraKnownMarketplaces objects behind; drop the ones
    // your original file never had.
    if (b.ok) {
      for (const k of Object.keys(cur)) {
        if (!(k in b.value) && isEmptyContainer(cur[k])) delete cur[k];
      }
    }
    if (b.ok && sameJson(b.value, cur)) {
      writeAtomic(file, fs.readFileSync(record.backup, 'utf8'));
      fs.unlinkSync(record.backup);
      restored = true;
      note = 'restored your original settings.json byte-for-byte';
    } else {
      writeJsonAtomic(file, cur);
      note = `removed whip keys; other settings changed since install, so the backup was kept at ${record.backup}`;
    }
  } else if (record.settingsExisted === false && Object.keys(cur).every((k) => isEmptyContainer(cur[k]))) {
    fs.unlinkSync(file);
    restored = true;
    note = 'removed settings.json (it did not exist before install)';
  } else {
    writeJsonAtomic(file, cur);
  }
  return { restored, note };
}

function status() {
  const r = readJson(paths().settings);
  const sl = r.ok ? r.value.statusLine : null;
  return { ours: isOurs(sl), statusLine: sl || null, spinnerVerbs: r.ok ? r.value.spinnerVerbs || null : null };
}

module.exports = { backup, install, uninstall, status, isOurs, statusCommand, SPINNER_VERBS, installRecordPath };

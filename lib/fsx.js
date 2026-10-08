'use strict';
// Small file helpers with two promises: every write is atomic (temp + rename on
// the same directory), and read-modify-write sections are serialised by a
// lockfile created with O_EXCL. No npm, no native code.
const fs = require('fs');
const path = require('path');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}

// durable=false skips fsync: still atomic for readers (rename), just not
// guaranteed to survive a power cut. Fine for ephemeral session files.
function writeAtomic(file, data, mode = 0o600, { durable = true } = {}) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeSync(fd, data);
    if (durable) fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function writeJsonAtomic(file, value, mode, opts) {
  writeAtomic(file, JSON.stringify(value, null, 2) + '\n', mode, opts);
}

// Returns { ok: true, value } | { ok: false, missing: true } | { ok: false, error }
function readJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return { ok: false, missing: true };
    return { ok: false, error: err };
  }
  try {
    const value = JSON.parse(raw);
    if (value === null || typeof value !== 'object') throw new Error('not an object');
    return { ok: true, value };
  } catch (err) {
    return { ok: false, error: err, raw };
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Lock held for at most a few ms by any one writer. Ownership is the lock
// file's inode (no write needed: on a Mac with endpoint security every file
// write costs milliseconds). A lock older than staleMs belongs to a crashed
// process; breaking it is serialised through a second O_EXCL file so two
// waiters can never both break and both enter.
function withLock(lockFile, fn, { timeoutMs = 1500, staleMs = 1000 } = {}) {
  ensureDir(path.dirname(lockFile));
  const start = Date.now();
  let fd = null;
  let ino = null;
  for (;;) {
    try {
      fd = fs.openSync(lockFile, 'wx', 0o600);
      ino = fs.fstatSync(fd).ino;
      break;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      breakIfStale(lockFile, staleMs);
      if (Date.now() - start > timeoutMs) {
        // Better a rare lost update than a hook that hangs Claude Code.
        fd = null;
        break;
      }
      sleepSync(5);
    }
  }
  try {
    return fn();
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
      // Only remove the lock if it is still ours (it may have been broken as stale).
      try {
        if (fs.statSync(lockFile).ino === ino) fs.unlinkSync(lockFile);
      } catch {}
    }
  }
}

function breakIfStale(lockFile, staleMs) {
  const breaker = lockFile + '.break';
  let bfd;
  try {
    bfd = fs.openSync(breaker, 'wx', 0o600);
  } catch {
    // Someone else is breaking it; a breaker left by a crash is cleared later.
    try {
      if (Date.now() - fs.statSync(breaker).mtimeMs > staleMs * 5) fs.unlinkSync(breaker);
    } catch {}
    return;
  }
  try {
    // Re-check inside the breaker: the stale lock may already have been replaced.
    if (Date.now() - fs.statSync(lockFile).mtimeMs > staleMs) fs.unlinkSync(lockFile);
  } catch {
  } finally {
    fs.closeSync(bfd);
    try { fs.unlinkSync(breaker); } catch {}
  }
}

function appendLine(file, obj, { maxBytes = 1 << 20, rotateTo } = {}) {
  ensureDir(path.dirname(file));
  try {
    if (rotateTo && fs.statSync(file).size > maxBytes) fs.renameSync(file, rotateTo);
  } catch {}
  fs.appendFileSync(file, JSON.stringify(obj) + '\n', { mode: 0o600 });
}

function readLines(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch {}
  }
  return out;
}

module.exports = { ensureDir, writeAtomic, writeJsonAtomic, readJson, withLock, appendLine, readLines, sleepSync };

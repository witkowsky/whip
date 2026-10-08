'use strict';
// I/O around the pure engine. One lock (state.lock) serialises every
// read-modify-write of state.json and sessions/*.json; each critical section
// is a couple of small JSON reads and one atomic rename.
const fs = require('fs');
const path = require('path');
const { paths, sessionFile } = require('./paths');
const { readJson, writeJsonAtomic, withLock, appendLine, readLines, ensureDir } = require('./fsx');
const engine = require('./engine');

const ALIVE_MS = 30 * 60 * 1000; // a session heard from in the last 30 min is a target
const DELIVERED_KEEP = 8;

// ---------- state ----------

function loadState(cfg, { heal = true } = {}) {
  const p = paths();
  const r = readJson(p.state);
  if (r.ok && r.value.v === 1 && Array.isArray(r.value.recent)) return { ...engine.emptyState(), ...r.value };
  if (r.missing) return engine.emptyState();
  // EIO/EACCES/EMFILE are not corruption: fail this call instead of
  // resetting lifetime counters from a possibly partial event log.
  if (!r.ok && r.raw === undefined) throw r.error;
  if (!heal) return engine.emptyState();
  return healState(cfg, r);
}

// A corrupted state.json is moved aside and rebuilt from the event log.
function healState(cfg, bad) {
  const p = paths();
  try {
    fs.renameSync(p.state, p.state + '.corrupt');
  } catch {}
  const events = [...readLines(p.eventsOld), ...readLines(p.events)];
  const rebuilt = engine.replay(events, cfg);
  const prevPaused = bad && bad.raw && /"paused"\s*:\s*true/.test(bad.raw);
  rebuilt.paused = !!prevPaused;
  rebuilt.healedAt = Date.now();
  try {
    writeJsonAtomic(p.state, rebuilt);
  } catch {}
  return rebuilt;
}

function readStateFast() {
  // Status line path: no lock, no heal, never throws.
  const r = readJson(paths().state);
  return r.ok && r.value.v === 1 ? r.value : null;
}

function lock(fn) {
  return withLock(paths().lock, fn);
}

function saveState(state) {
  writeJsonAtomic(paths().state, { ...state, updatedAt: Date.now() });
}

function setPaused(paused, cfg) {
  return lock(() => {
    const s = loadState(cfg);
    s.paused = !!paused;
    saveState(s);
    return s;
  });
}

// ---------- sessions ----------

function readSession(id) {
  const r = readJson(sessionFile(id));
  return r.ok ? r.value : null;
}

function writeSession(sess) {
  writeJsonAtomic(sessionFile(sess.id), sess, undefined, { durable: false });
}

function listSessions() {
  const dir = paths().sessions;
  let names = [];
  try {
    names = fs.readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const n of names) {
    const r = readJson(path.join(dir, n));
    if (r.ok && r.value.id) out.push(r.value);
  }
  return out;
}

function updateSession(id, fn, { create = true } = {}) {
  if (!id) return null;
  return lock(() => {
    let s = readSession(id);
    if (!s) {
      if (!create) return null;
      s = { id, createdAt: Date.now() };
    }
    const next = fn(s) || s;
    writeSession(next);
    return next;
  });
}

// Called by SessionStart and (throttled) by the status line.
function heartbeat(id, info, now = Date.now(), { active = false } = {}) {
  return updateSession(id, (s) => {
    s.lastSeen = now;
    if (active) s.lastActive = now;
    if (info.cwd) s.cwd = info.cwd;
    if (info.transcript) s.transcript = info.transcript;
    if (info.tmuxPane !== undefined) s.tmuxPane = info.tmuxPane || null;
    if (info.tmuxSocket !== undefined) s.tmuxSocket = info.tmuxSocket || null;
    if (info.termProgram !== undefined) s.termProgram = info.termProgram || null;
    if (info.model) s.model = info.model;
    if (info.claudeVersion) s.claudeVersion = info.claudeVersion;
    if (s.lastActive == null) s.lastActive = now;
    return s;
  });
}

function removeSession(id) {
  lock(() => {
    try {
      fs.unlinkSync(sessionFile(id));
    } catch {}
  });
}

function pruneSessions(now = Date.now()) {
  for (const s of listSessions()) {
    const seen = Math.max(s.lastSeen || 0, s.lastActive || 0);
    if (now - seen > 7 * 86400000) removeSession(s.id);
  }
}

// Most recently *active* session wins (prompt/tool/stop activity), busy ones first.
function pickTargets(sessions, cfg, now = Date.now()) {
  const alive = sessions.filter((s) => s.busy || now - Math.max(s.lastSeen || 0, s.lastActive || 0) <= ALIVE_MS);
  if (!alive.length) return [];
  if (cfg.target === 'all') return alive;
  alive.sort((a, b) => (b.busy ? 1 : 0) - (a.busy ? 1 : 0) || (b.lastActive || 0) - (a.lastActive || 0));
  return [alive[0]];
}

// ---------- hits ----------

/**
 * Applies a hit, appends it to events.jsonl and queues a pending whip on the
 * target session(s). Returns { result, state, targets }.
 */
function recordHit(hit, cfg, now = Date.now()) {
  const p = paths();
  ensureDir(p.home);
  return lock(() => {
    const before = loadState(cfg);
    let targets = [];
    if (hit.session) {
      const s = readSession(hit.session);
      targets = s ? [s] : [{ id: hit.session }];
    } else {
      targets = pickTargets(listSessions(), cfg, now);
    }
    const primary = targets[0];
    const enriched = { ...hit, session: hit.session || (primary && primary.id) || null, cwd: hit.cwd || (primary && primary.cwd) || null };
    const { state, result } = engine.applyHit(before, enriched, cfg);
    if (!result.accepted) return { result, state: before, targets: [] };

    saveState(state);
    appendLine(
      p.events,
      { kind: 'hit', ts: enriched.ts, g: result.hit.g, tier: result.tier, combo: result.combo, session: enriched.session, cwd: enriched.cwd, source: enriched.source || 'sensor' },
      { rotateTo: p.eventsOld },
    );

    const queued = [];
    if (result.whip && !hit.noPending) {
      for (const t of targets) {
        const s = readSession(t.id) || { id: t.id, createdAt: now };
        const whip = hit.bannerOnly ? { ...result.whip, bannerOnly: true } : result.whip;
        s.pending = engine.mergePending(s.pending && now - s.pending.ts < cfg.pendingTtlMs ? s.pending : null, whip);
        s.lastHitAt = now;
        writeSession(s);
        queued.push(s);
      }
    }
    return { result, state, targets: queued.length ? queued : targets };
  });
}

/**
 * Atomically takes the pending whip of a session, if any and not expired.
 * `via` is the hook event name, recorded for the e2e test and /slaps.
 */
function consumePending(id, via, cfg, now = Date.now()) {
  if (!id) return null;
  return lock(() => {
    const s = readSession(id);
    if (!s || !s.pending) return null;
    const pending = s.pending;
    delete s.pending;
    const expired = now - pending.ts > cfg.pendingTtlMs;
    s.delivered = [...(s.delivered || []), { id: pending.id, via, ts: now, expired }].slice(-DELIVERED_KEEP);
    writeSession(s);
    return expired ? null : pending;
  });
}

/**
 * One locked read-modify-write per hook: mark activity, apply `patch`, and
 * take the pending whip when `via` is set and `canTake(session)` agrees.
 * `after(session, whip)` may adjust the session before it is written.
 * Returns { whip, session }.
 */
function touchAndTake(id, { patch = {}, via = null, canTake = () => true, after } = {}, cfg, now = Date.now()) {
  if (!id) return { whip: null, session: null };
  return lock(() => {
    const s = readSession(id) || { id, createdAt: now };
    s.lastActive = now;
    s.lastSeen = now;
    delete s.awaiting;
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete s[k];
      else s[k] = v;
    }
    let whip = null;
    if (via && s.pending && canTake(s)) {
      const pending = s.pending;
      delete s.pending;
      const expired = now - pending.ts > cfg.pendingTtlMs;
      s.delivered = [...(s.delivered || []), { id: pending.id, via, ts: now, expired }].slice(-DELIVERED_KEEP);
      if (!expired) whip = pending;
    }
    if (after) after(s, whip);
    writeSession(s);
    return { whip, session: s };
  });
}

function hookLog(entry) {
  try {
    appendLine(paths().log, { t: Date.now(), ...entry }, { maxBytes: 512 * 1024, rotateTo: paths().log + '.1' });
  } catch {}
}

module.exports = {
  loadState,
  readStateFast,
  saveState,
  setPaused,
  lock,
  readSession,
  writeSession,
  listSessions,
  updateSession,
  heartbeat,
  removeSession,
  pruneSessions,
  pickTargets,
  recordHit,
  consumePending,
  touchAndTake,
  hookLog,
  ALIVE_MS,
};

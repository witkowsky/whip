'use strict';
// "A hit happened" -> counters, pending whip, optional hard interrupt, optional
// sound. Shared by the bridge (sensor events) and `whip simulate`.
const store = require('./store');
const { hardWhip, hardText } = require('./hardwhip');
const sound = require('./sound');

const BUSY_STALE_MS = 3 * 60 * 1000;

// `busy` is set by UserPromptSubmit and cleared by Stop, but an Esc from the
// user skips Stop. Treat busy as stale unless a tool is running or Claude was
// active recently.
function reallyBusy(s, now) {
  if (!s || !s.busy || s.awaiting) return false;
  if (s.tool && now - s.tool.since < 30 * 60 * 1000) return true;
  return now - (s.lastActive || 0) < BUSY_STALE_MS;
}

function setBannerOnly(sessionId, whipId, value) {
  store.updateSession(
    sessionId,
    (s) => {
      if (s.pending && s.pending.id === whipId) s.pending = { ...s.pending, bannerOnly: value || undefined };
      return s;
    },
    { create: false },
  );
}

function deliver(hit, cfg, { now = Date.now(), hard = true, quiet = false, hardImpl = hardWhip } = {}) {
  const r = store.recordHit({ ts: now, ...hit }, cfg, now);
  if (!r.result.accepted) return r;
  if (!quiet) r.sound = sound.react(r.result, cfg, now);
  r.hard = [];
  const w = r.result.whip;
  if (w && w.tier === 'wallop' && hard && cfg.hardWhip !== 'off') {
    for (const s of r.targets) {
      const busy = reallyBusy(s, now);
      if (!busy) {
        r.hard.push({ session: s.id, ok: false, why: 'session is idle (would clobber your draft)' });
        continue;
      }
      // The typed message carries the whip; the hooks then only show the banner.
      setBannerOnly(s.id, w.id, true);
      const res = hardImpl({ ...s, busy }, hardText(w), cfg);
      if (!res.ok) setBannerOnly(s.id, w.id, false);
      r.hard.push({ session: s.id, ...res });
    }
  }
  store.hookLog({ ev: 'hit', tier: r.result.tier, g: r.result.hit.g, combo: r.result.combo, source: hit.source, targets: r.targets.map((t) => t.id), hard: r.hard.filter((h) => h.ok).map((h) => h.via) });
  return r;
}

module.exports = { deliver, reallyBusy };

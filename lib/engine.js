'use strict';
// The whole whip game as a pure reducer: applyHit(state, hit, config) returns
// the next state plus what happened. No clocks, no files, no randomness that
// isn't seeded from the hit itself. That makes it unit-testable, and it lets a
// corrupted state.json be rebuilt by replaying events.jsonl.
const { draw, MILESTONES } = require('./pools');
const personas = require('./personas');

const TIER_RANK = { tap: 1, slap: 2, wallop: 3 };
const RECENT_MAX = 64;
const DAY_KEEP = 400;

function emptyState() {
  return {
    v: 1,
    paused: false,
    total: 0,
    tiers: { tap: 0, slap: 0, wallop: 0 },
    bestG: 0,
    longestCombo: 0,
    calmestMs: 0,
    firstHitTs: null,
    lastHit: null,
    combo: 0,
    days: {},
    hours: new Array(24).fill(0),
    repos: {},
    sessions: {},
    recent: [],
    bags: {},
  };
}

function classify(g, cfg) {
  const t = cfg.thresholds;
  if (!(g >= t.tapMinG)) return null;
  if (g >= t.wallopG) return 'wallop';
  if (g >= t.slapG) return 'slap';
  return 'tap';
}

function dayKey(ts) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function repoName(cwd) {
  if (!cwd || typeof cwd !== 'string') return null;
  const parts = cwd.replace(/\/+$/, '').split('/');
  return parts[parts.length - 1] || null;
}

function pruneDays(days, ts) {
  const keys = Object.keys(days);
  if (keys.length <= DAY_KEEP) return days;
  const cutoff = dayKey(ts - DAY_KEEP * 86400000);
  const out = {};
  for (const k of keys) if (k >= cutoff) out[k] = days[k];
  return out;
}

function pruneSessions(sessions) {
  const keys = Object.keys(sessions);
  if (keys.length <= 200) return sessions;
  // Keep the most-whipped sessions; per-session counts are a curiosity, not a ledger.
  const out = {};
  keys.sort((a, b) => sessions[b] - sessions[a]).slice(0, 100).forEach((k) => (out[k] = sessions[k]));
  return out;
}

/**
 * hit: { ts, g, source: 'sensor'|'simulate'|'manual', tier?, session?, cwd?, message? }
 * returns { state, result }
 *   result.accepted=false with reason 'paused' | 'cooldown' | 'below-threshold'
 *   result.accepted=true with { tier, baseTier, combo, slapNo, escalated, milestone, whip }
 */
function applyHit(prev, hit, cfg) {
  const state = prev || emptyState();
  const ts = Number(hit.ts) || 0;
  const g = Math.max(0, Number(hit.g) || 0);
  const manual = hit.source === 'manual';

  if (state.paused && !manual) return { state, result: { accepted: false, reason: 'paused' } };

  const baseTier = hit.tier && TIER_RANK[hit.tier] ? hit.tier : classify(g, cfg);
  if (!baseTier) return { state, result: { accepted: false, reason: 'below-threshold' } };

  const last = state.lastHit;
  const sinceLast = last ? ts - last.ts : Infinity;
  if (!manual && sinceLast >= 0 && sinceLast < cfg.cooldownMs) {
    return { state, result: { accepted: false, reason: 'cooldown' } };
  }

  const combo = sinceLast >= 0 && sinceLast <= cfg.comboWindowMs ? (state.combo || 0) + 1 : 1;

  // Escalation: N non-tap hits inside the window turn this one into a WALLOP.
  let tier = baseTier;
  let escalated = false;
  if (baseTier === 'slap') {
    const windowStart = ts - cfg.escalate.windowMs;
    const recentSlaps = state.recent.filter((r) => r.ts >= windowStart && r.ts <= ts && r.tier !== 'tap').length;
    if (recentSlaps + 1 >= cfg.escalate.count) {
      tier = 'wallop';
      escalated = true;
    }
  }

  const total = state.total + 1;
  const d = new Date(ts);
  const day = dayKey(ts);
  const hours = state.hours.slice();
  hours[d.getHours()] = (hours[d.getHours()] || 0) + 1;
  const repo = repoName(hit.cwd);
  const repos = { ...state.repos };
  if (repo) repos[repo] = (repos[repo] || 0) + 1;
  const sessions = { ...state.sessions };
  if (hit.session) sessions[hit.session] = (sessions[hit.session] || 0) + 1;

  const seed = Math.floor(ts) ^ Math.floor(g * 1000) ^ total;
  const persona = cfg.persona || personas.classic;
  const pid = persona.id;
  let bags = state.bags || {};
  let line = null;
  let instruction = null;
  let say = null;
  if (tier !== 'tap') {
    const a = draw(bags, tier === 'wallop' ? 'wallop' : 'slap', seed);
    const b = draw(a.bags, tier === 'wallop' ? 'doWallop' : 'doSlap', seed + 1);
    const vk = tier === 'wallop' ? 'voiceWallop' : 'voiceSlap';
    const v = draw(b.bags, `${pid}:${vk}`, seed + 3, persona[vk]);
    bags = v.bags;
    line = hit.message ? String(hit.message).slice(0, 200) : a.line;
    instruction = b.line;
    say = v.line;
  } else {
    const a = draw(bags, `${pid}:tap`, seed, persona.tap);
    bags = a.bags;
    line = a.line;
  }
  const apology = draw(bags, `${pid}:apology`, seed + 2, persona.apology);
  bags = apology.bags;

  const milestone = MILESTONES[combo] ? combo : null;
  const id = `${ts.toString(36)}-${total.toString(36)}`;
  const lastHit = {
    id,
    ts,
    g: Math.round(g * 1000) / 1000,
    tier,
    baseTier,
    combo,
    slapNo: total,
    escalated,
    milestone,
    line,
    instruction,
    apology: apology.line,
    say,
    persona: pid,
    source: hit.source || 'sensor',
    session: hit.session || null,
  };

  const next = {
    ...state,
    total,
    tiers: { ...state.tiers, [tier]: (state.tiers[tier] || 0) + 1 },
    bestG: Math.max(state.bestG, lastHit.g),
    longestCombo: Math.max(state.longestCombo, combo),
    calmestMs: last && sinceLast > state.calmestMs ? sinceLast : state.calmestMs,
    firstHitTs: state.firstHitTs ?? ts,
    lastHit,
    combo,
    days: pruneDays({ ...state.days, [day]: (state.days[day] || 0) + 1 }, ts),
    hours,
    repos,
    sessions: pruneSessions(sessions),
    recent: [...state.recent, { ts, tier, g: lastHit.g }].slice(-RECENT_MAX),
    bags,
  };

  return {
    state: next,
    result: { accepted: true, tier, baseTier, combo, slapNo: total, escalated, milestone, whip: tier === 'tap' ? null : lastHit, hit: lastHit },
  };
}

// Rebuild counters from the append-only event log (self-heal path).
function replay(events, cfg) {
  let state = emptyState();
  for (const ev of events) {
    if (!ev || ev.kind !== 'hit') continue;
    state = applyHit(state, { ...ev, source: 'manual', tier: ev.tier }, cfg).state;
  }
  return state;
}

function hitsWithin(state, now, ms) {
  return state.recent.filter((r) => r.tier !== 'tap' && now - r.ts <= ms && now >= r.ts).length;
}

// Upgrade-merge: several whips before Claude's next tool call collapse into one
// that keeps the strongest tier and the latest combo.
function mergePending(existing, whip) {
  if (!existing) return { ...whip, stacked: 1 };
  const stronger = TIER_RANK[whip.tier] >= TIER_RANK[existing.tier] ? whip : existing;
  return {
    ...stronger,
    combo: Math.max(existing.combo, whip.combo),
    g: Math.max(existing.g, whip.g),
    slapNo: whip.slapNo,
    ts: whip.ts,
    id: whip.id,
    stacked: (existing.stacked || 1) + 1,
    // Banner-only (the message travels some other way) only if both were.
    bannerOnly: existing.bannerOnly && whip.bannerOnly ? true : undefined,
  };
}

module.exports = { emptyState, classify, applyHit, replay, hitsWithin, mergePending, dayKey, repoName, TIER_RANK };

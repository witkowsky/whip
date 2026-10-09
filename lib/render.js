'use strict';
// Everything the user sees: the face state machine, the status line whip lane,
// the transcript banner (hook systemMessage) and the note Claude receives.
const { width, padRight } = require('./ansi');
const { hitsWithin, dayKey } = require('./engine');
const { MILESTONES } = require('./pools');

const personas = require('./personas');

// Classic faces, kept for callers that don't care about personas.
const FACES = personas.classic.faces;

const HIT_MS = 2000;
const RECOVER_MS = 20000;
const SWEAT_WINDOW_MS = 10 * 60 * 1000;
const SWEAT_COUNT = 5;
const CALM_MS = 60 * 60 * 1000;

// ASCII mode: swap the few typographic characters our strings use.
const ASCII_MAP = { '—': '-', '–': '-', '·': '|', '…': '...', '“': '"', '”': '"', '’': "'", '→': '->', '×': 'x' };
function asciiSafe(s) {
  return String(s).replace(/[—–·…“”’→×]/g, (c) => ASCII_MAP[c]).replace(/[^\x00-\x7e]/g, '');
}

function face(name, ascii, persona = personas.classic) {
  const f = (persona.faces && persona.faces[name]) || personas.classic.faces[name];
  return f[ascii ? 1 : 0];
}

function fill(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : ''));
}

/** Decides the character's state. Ordered by priority. */
function mood(state, session, now) {
  if (!state) return 'idle';
  if (state.paused) return 'paused';
  const lh = state.lastHit;
  const dt = lh ? now - lh.ts : Infinity;
  if (lh && dt >= 0 && dt < HIT_MS) {
    if (lh.tier === 'tap') return 'tap';
    if (lh.combo >= 5) return 'wrecked';
    if (lh.combo >= 3) return 'stunned';
    return 'hit';
  }
  if (lh && lh.tier !== 'tap' && dt >= 0 && dt < RECOVER_MS) return 'recovering';
  if (hitsWithin(state, now, SWEAT_WINDOW_MS) >= SWEAT_COUNT) return 'sweating';
  if (session && session.tool && now - session.tool.since < 10 * 60 * 1000) return 'working';
  if (lh && dt >= CALM_MS) return 'calm';
  return 'idle';
}

// The whip travels: the frame is picked from the time since the hit, so each
// re-render shows a later frame. Every frame reads on its own, because Claude
// Code re-renders on events and may skip any of them.
const FRAMES = [
  { until: 350, u: '⟿～～', a: 'o~~' },
  { until: 800, u: '⟿～～～～～', a: 'o~~~~~' },
  { until: Infinity, u: '⟿～～～～～～～～💥', a: 'o~~~~~~~~*' },
];
const FRAME_W = { u: width(FRAMES[2].u), a: FRAMES[2].a.length };

function whipFrame(dt, ascii) {
  const f = FRAMES.find((x) => dt < x.until);
  const s = ascii ? f.a : f.u;
  return { text: padRight(s, ascii ? FRAME_W.a : FRAME_W.u), final: f.until === Infinity };
}

function forceBar(g, cfg, p, ascii) {
  const t = cfg.thresholds;
  const max = t.wallopG * 1.3;
  const cells = 10;
  let out = '';
  for (let i = 0; i < cells; i++) {
    const at = ((i + 0.5) / cells) * max;
    const lit = g >= ((i + 1) / cells) * max || (i === 0 && g > 0);
    const color = at < t.slapG ? p.green : at < t.wallopG ? p.yellow : p.red;
    out += lit ? color(ascii ? '#' : '▓') : p.dim(ascii ? '.' : '░');
  }
  return out;
}

function fmtG(g) {
  return `${(Math.round(g * 100) / 100).toFixed(2)}g`;
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`;
  return `${Math.floor(h / 24)}d`;
}

function counters(state, now, ascii, p, { best = false } = {}) {
  const today = state.days[dayKey(now)] || 0;
  const hand = ascii ? '' : '👋 ';
  let s = `${hand}${today} today · ${state.total} total`;
  if (best && state.bestG > 0) s += ` · best ${fmtG(state.bestG)}`;
  return p.muted(s);
}

/** Line 2 of the status line. */
function whipLane(state, session, cfg, p, now) {
  const persona = cfg.persona || personas.classic;
  const mute = cfg.muted ? (cfg.ascii ? ' [muted]' : ' 🔇') : '';
  const out = `${lane(state, session, cfg, p, now)}  ${p.muted(`· ${cfg.ascii ? '' : '🎭 '}${persona.name}${mute}`)}`;
  return cfg.ascii ? asciiSafe(out) : out;
}

function lane(state, session, cfg, p, now) {
  const ascii = !!cfg.ascii;
  const persona = cfg.persona || personas.classic;
  const m = mood(state, session, now);
  const fc = p.face(face(m, ascii, persona));
  if (!state) return `${fc}  ${p.muted(persona.lines.empty)}`;
  const lh = state.lastHit;
  const dt = lh ? now - lh.ts : Infinity;
  const queued = session && session.pending ? '  ' + p.orange(ascii ? '[whip queued]' : '⏳ whip queued') : '';

  switch (m) {
    case 'paused':
      return `${fc}  ${p.muted('whip paused · /whip:on to resume')}`;
    case 'tap':
      return `${fc}  ${p.green(ascii ? '*tap*' : '👋 tap!')} ${p.muted(lh.line)}  ${p.muted(fmtG(lh.g))} ${forceBar(lh.g, cfg, p, ascii)}`;
    case 'hit':
    case 'stunned':
    case 'wrecked': {
      const fr = whipFrame(dt, ascii);
      const wallop = lh.tier === 'wallop';
      const label = fr.final ? (wallop ? p.bold(p.red('WALLOP!!')) : p.bold(p.orange(persona.whack))) : p.dim('whoosh…');
      const combo = lh.combo >= 2 ? '  ' + p.bold(p.hot(`combo x${lh.combo}`)) : '';
      return `${fc}  ${p.accent(fr.text)} ${padRight(label, 8)}${combo}  ${p.muted(fmtG(lh.g))} ${forceBar(lh.g, cfg, p, ascii)}${queued}`;
    }
    case 'recovering':
      return `${fc}  ${p.italic(`"${lh.apology}"`)}   ${counters(state, now, ascii, p)}${queued}`;
    case 'sweating': {
      const n = hitsWithin(state, now, SWEAT_WINDOW_MS);
      return `${fc}  ${p.hot(`${ascii ? '' : '🔥 '}${fill(persona.lines.sweating, { n })}`)}${queued}`;
    }
    case 'working':
      return `${fc}  ${p.muted(`${session.tool.name}…`)}  ${counters(state, now, ascii, p)}${queued}`;
    case 'calm':
      return `${fc}  ${p.green(fill(persona.lines.calm, { t: fmtDuration(dt) }))}`;
    default:
      if (!state.total) return `${fc}  ${p.muted(persona.lines.empty)}`;
      return `${fc}  ${counters(state, now, ascii, p, { best: true })}${queued}`;
  }
}

// ---------- transcript banner (hook systemMessage, plain text) ----------

function banner(w, cfg) {
  const ascii = !!cfg.ascii;
  const persona = cfg.persona || personas.classic;
  const wallop = w.tier === 'wallop';
  const fc = face(w.combo >= 5 ? 'wrecked' : w.combo >= 3 || wallop ? 'stunned' : 'hit', ascii, persona);
  const parts = [`${wallop ? 'WALLOP' : 'slap'} #${w.slapNo}`, fmtG(w.g)];
  if (w.combo >= 2) parts.push(`combo x${w.combo}`);
  if (w.escalated) parts.push(`${cfg.escalate.count} slaps in ${Math.round(cfg.escalate.windowMs / 1000)}s`);
  if (w.stacked > 1) parts.push(`${w.stacked} whips stacked`);
  if (w.source === 'manual') parts.push('manual');
  const detail = `${parts.join(' · ')} · "${w.line}"`;
  const lines = [];
  if (wallop) {
    const whip = ascii ? 'o~~~~~~~~~~~~~**' : '⟿～～～～～～～～～～～～～💥💥';
    const head = ascii ? `!! ${whip}  W A L L O P !!   ${fc} !!` : `🟥 ${whip}  W A L L O P !!   ${fc} 🟥`;
    const rule = (ascii ? '=' : '━').repeat(Math.max(40, Math.min(72, width(head))));
    lines.push(rule, head, rule, detail);
  } else {
    const whip = ascii ? 'o~~~~~~~~~~*' : '⟿～～～～～～～～～～💥';
    lines.push(`${whip}  ${persona.whack}   ${fc}`, detail);
  }
  const milestone = Object.keys(MILESTONES)
    .map(Number)
    .filter((n) => w.combo >= n)
    .pop();
  if (milestone && w.milestone) lines.push(MILESTONES[milestone]);
  return ascii ? asciiSafe(lines.join('\n')) : lines.join('\n');
}

// ---------- what Claude is told ----------

// Phrased as facts about what the user did and wants (the hooks docs warn that
// system-style imperatives in injected context can trip injection defences).
function messageForClaude(w, cfg, { idle = false } = {}) {
  const wallop = w.tier === 'wallop';
  const tag = wallop ? '💥 WALLOP' : '⚡ WHIP';
  const facts = [`${wallop ? 'WALLOP' : 'slap'} #${w.slapNo}`, fmtG(w.g)];
  if (w.combo >= 2) facts.push(`combo x${w.combo}`);
  const who =
    w.source === 'manual'
      ? 'The user just whipped you with /whip'
      : wallop
        ? 'The user just hit their MacBook HARD'
        : 'The user just slapped their MacBook';
  const out = [`${tag} from the user's ClaudeWhip plugin (${facts.join(' · ')}).`];
  out.push(`${who}${idle ? ' while you were idle' : ''}: their signal that you are taking too long. Their line: "${w.line}"`);
  if (w.combo >= 3) out.push(`That is ${w.combo} hits in a row, so their patience is gone.`);
  if (w.stacked > 1) out.push(`(${w.stacked} whips arrived since your last step.)`);
  out.push(`What they want now: ${w.instruction}`);
  const persona = cfg.persona || personas.classic;
  const flinch = `${face(w.combo >= 3 ? 'stunned' : 'hit', cfg.ascii, persona)} ${persona.flinch}`;
  if (cfg.reaction === false) {
    out.push('Skip any in-character reaction, face or emoji; just act on it.');
  } else if (persona.tone) {
    out.push(`Their whip personality is "${persona.name}": ${persona.tone}. They enjoy a one-line in-character reaction like "${flinch}" at the start of your next message; keep everything after that line normal and on task.`);
  } else {
    out.push(`A one-line flinch like "${flinch}" at the start of your next message tells them it landed; skip long apologies.`);
  }
  return out.join(' ');
}

// ---------- line 1 ----------

function infoLine(input, branch, p, ascii) {
  const model = input && input.model && (input.model.display_name || input.model.id);
  const dir = input && ((input.workspace && input.workspace.current_dir) || input.cwd);
  const parts = [];
  if (model) parts.push(p.bold(model));
  if (dir) parts.push(p.accent(dir.split('/').filter(Boolean).pop() || dir));
  if (branch) parts.push(p.green(`${ascii ? '' : '⎇ '}${branch}`));
  return parts.join(p.muted(' · '));
}

module.exports = { FACES, FRAMES, face, asciiSafe, mood, whipFrame, forceBar, whipLane, banner, messageForClaude, infoLine, fmtG, fmtDuration, HIT_MS, RECOVER_MS };

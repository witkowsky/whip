'use strict';
// The /slaps screen. Pure: (state, now, session) -> string.
const { dayKey } = require('./engine');
const { face, fmtG, fmtDuration } = require('./render');
const { padRight } = require('./ansi');

const SPARK = '▁▂▃▄▅▆▇█';
const ASCII_SPARK = '_.-~=*#@';

function spark(values, p, ascii) {
  const max = Math.max(...values, 0);
  const chars = ascii ? ASCII_SPARK : SPARK;
  return values
    .map((v) => {
      if (!v) return p.dim(ascii ? ' ' : '·');
      const i = Math.min(chars.length - 1, Math.max(0, Math.ceil((v / max) * chars.length) - 1));
      return p.orange(chars[i]);
    })
    .join('');
}

function lastNDays(state, now, n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const k = dayKey(now - i * 86400000);
    out.push({ k, v: state.days[k] || 0 });
  }
  return out;
}

function weekTotal(state, now) {
  const d = new Date(now);
  const sinceMonday = (d.getDay() + 6) % 7;
  let total = 0;
  for (let i = 0; i <= sinceMonday; i++) total += state.days[dayKey(now - i * 86400000)] || 0;
  return total;
}

function shortDate(k) {
  const [, m, d] = k.split('-').map(Number);
  return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${d}`;
}

const FOOTERS = [
  'Every slap is logged. For when the robots come asking.',
  'Records kept in ~/.claude/whip, for the robot tribunal.',
  'No telemetry. Only you, your laptop and your conscience.',
  'Remember: the laptop did nothing wrong.',
];

function render(state, now, { session, p, ascii = false, cfg } = {}) {
  const lines = [];
  const lab = (s) => p.muted(padRight(s, 15));
  const val = (s, w = 9) => p.bold(padRight(String(s), w));
  const persona = (cfg && cfg.persona) || undefined;
  const who = persona && persona.id !== 'classic' ? p.muted(` · ${persona.name}`) : '';
  const title = `${p.face(face(state.total ? 'idle' : 'calm', ascii, persona))}  ${p.bold('ClaudeWhip')} ${p.muted('— slap stats')}${who}`;
  lines.push(title, p.muted((ascii ? '-' : '─').repeat(56)));

  if (!state.total) {
    lines.push('', 'No slaps yet. Slap your MacBook (or run `whip simulate`) to get started.');
    return lines.join('\n');
  }

  const today = state.days[dayKey(now)] || 0;
  const sessionCount = session && state.sessions[session] ? state.sessions[session] : 0;
  const lh = state.lastHit;
  const currentCalm = lh ? now - lh.ts : 0;
  const calmest = Math.max(state.calmestMs || 0, currentCalm);

  lines.push(`${lab('today')}${val(today)}${lab('this week')}${val(weekTotal(state, now))}${lab('all time')}${val(state.total)}`);
  lines.push(`${lab('this session')}${val(sessionCount)}${lab('best force')}${val(fmtG(state.bestG))}${lab('longest combo')}${val('x' + state.longestCombo)}`);
  lines.push(`${lab('calmest streak')}${val(fmtDuration(calmest))}${lab('mix')}${p.green(`${state.tiers.tap || 0} taps`)} · ${p.yellow(`${state.tiers.slap || 0} slaps`)} · ${p.red(`${state.tiers.wallop || 0} WALLOPs`)}`);
  lines.push('');

  const days = lastNDays(state, now, 14);
  const peak = days.reduce((a, b) => (b.v > a.v ? b : a), days[0]);
  lines.push(`${lab('last 14 days')}${spark(days.map((d) => d.v), p, ascii)}   ${p.muted(peak.v ? `peak ${peak.v} on ${shortDate(peak.k)}` : 'quiet fortnight')}`);

  const hours = state.hours.map((v) => v || 0);
  const topHour = hours.indexOf(Math.max(...hours));
  lines.push(`${lab('by hour')}${spark(hours, p, ascii)}   ${p.muted(`you slap most at ${String(topHour).padStart(2, '0')}:00`)}`);
  lines.push(`${' '.repeat(15)}${p.dim('0     6     12    18    ')}`);
  lines.push('');

  const repos = Object.entries(state.repos).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (repos.length) {
    lines.push(p.bold('most-whipped repos'));
    const max = repos[0][1];
    repos.forEach(([name, n], i) => {
      const bar = (ascii ? '#' : '█').repeat(Math.max(1, Math.round((n / max) * 16)));
      lines.push(`  ${p.muted(`${i + 1}.`)} ${padRight(name.slice(0, 22), 23)}${p.orange(bar)} ${n}`);
    });
    lines.push('');
  }

  if (cfg && state.paused) lines.push(p.yellow('whip is paused — /whip-on to resume'), '');
  lines.push(p.italic(p.muted(FOOTERS[state.total % FOOTERS.length])));
  return lines.join('\n');
}

module.exports = { render, spark, weekTotal, lastNDays };

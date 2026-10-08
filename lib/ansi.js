'use strict';
// ANSI 256-colour helpers with a NO_COLOR fallback. The palette uses mid-tone
// colours that stay readable on both dark and light terminals; the light
// theme only darkens the two that wash out on white (yellow, grey).
const fs = require('fs');

const PALETTES = {
  dark: { red: 196, orange: 208, yellow: 220, green: 41, muted: 245, face: 216, accent: 209, hot: 202 },
  light: { red: 160, orange: 166, yellow: 136, green: 28, muted: 242, face: 130, accent: 166, hot: 160 },
};

function detectTheme(cfg, settingsPath) {
  if (cfg.theme === 'dark' || cfg.theme === 'light') return cfg.theme;
  // COLORFGBG="15;0" -> light text on dark background.
  const fgbg = process.env.COLORFGBG;
  if (fgbg) {
    const bg = Number(fgbg.split(';').pop());
    if (Number.isFinite(bg)) return bg === 7 || bg === 15 ? 'light' : 'dark';
  }
  // Fall back to Claude Code's own theme setting ("dark", "light", "light-daltonized"...).
  if (settingsPath) {
    try {
      const m = /"theme"\s*:\s*"([^"]+)"/.exec(fs.readFileSync(settingsPath, 'utf8'));
      if (m && m[1].startsWith('light')) return 'light';
    } catch {}
  }
  return 'dark';
}

function colorEnabled(cfg, stream) {
  if ('NO_COLOR' in process.env && process.env.NO_COLOR !== '') return false;
  if (cfg.color === 'never') return false;
  if (cfg.color === 'always' || process.env.FORCE_COLOR) return true;
  // The status line writes to a pipe but Claude Code renders ANSI, so callers
  // that know better pass stream=null.
  return stream ? !!stream.isTTY : true;
}

function painter(enabled, theme = 'dark') {
  const pal = PALETTES[theme] || PALETTES.dark;
  const wrap = (open, close) => (s) => (enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s));
  const fg = (n) => wrap(`38;5;${n}`, '39');
  const p = {
    enabled,
    theme,
    bold: wrap('1', '22'),
    dim: wrap('2', '22'),
    italic: wrap('3', '23'),
    fg256: fg,
  };
  for (const [name, code] of Object.entries(pal)) p[name] = fg(code);
  return p;
}

// Visible width, good enough for our own strings: strips ANSI, counts East
// Asian wide/fullwidth chars and emoji as 2, combining marks as 0.
function width(s) {
  const plain = String(s).replace(/\x1b\[[0-9;]*m/g, '');
  let w = 0;
  for (const ch of plain) {
    const c = ch.codePointAt(0);
    if (c === 0x200d || (c >= 0x300 && c <= 0x36f) || (c >= 0xfe00 && c <= 0xfe0f)) continue;
    if (
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1faff)
    )
      w += 2;
    else w += 1;
  }
  return w;
}

function padRight(s, n) {
  const w = width(s);
  return w >= n ? s : s + ' '.repeat(n - w);
}

module.exports = { painter, colorEnabled, detectTheme, width, padRight, PALETTES };

// Pure logic for the ClaudeWhip band: the same moods, frames and lines as the
// terminal status line (lib/render.js), as coloured segments a surface draws.
import type { WhipFaceKey, WhipHit, WhipPersona, WhipSnap, WhipTier } from '../types'
import { CLASSIC, PERSONAS } from './personas'

export const HIT_MS = 2000
export const RECOVER_MS = 20000
export const SWEAT_MS = 10 * 60 * 1000
export const CALM_MS = 60 * 60 * 1000

export type Mood = WhipFaceKey
const FACE_KEYS: WhipFaceKey[] = ['idle', 'working', 'hit', 'stunned', 'wrecked', 'recovering', 'sweating', 'calm', 'tap', 'paused']

/** A run of text and how to draw it; colors are theme keys, so light and dark both work. */
export type Seg = { text: string; color?: 'claude' | 'success' | 'warning' | 'error' | 'subtle' | 'inactive'; bold?: boolean; dim?: boolean; italic?: boolean }

export function sanitizeId(id: string): string {
  return String(id).replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 128) || 'unknown'
}

export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

/** Digest of state.json, sessions/<id>.json and config.json (any may be null). */
export function toSnap(st: any, se: any, cf: any, now: number): WhipSnap {
  const t = (cf && cf.thresholds) || {}
  const lh = st && st.lastHit
  const lastHit: WhipHit | null = lh
    ? {
        id: String(lh.id),
        ts: num(lh.ts, 0),
        g: num(lh.g, 0),
        tier: (['tap', 'slap', 'wallop'].includes(lh.tier) ? lh.tier : 'slap') as WhipTier,
        combo: num(lh.combo, 1),
        slapNo: num(lh.slapNo, 0),
        line: typeof lh.line === 'string' ? lh.line : null,
        apology: typeof lh.apology === 'string' ? lh.apology : null,
      }
    : null
  return {
    total: num(st && st.total, 0),
    today: num(st && st.days && st.days[dayKey(now)], 0),
    bestG: num(st && st.bestG, 0),
    paused: !!(st && st.paused),
    recent: Array.isArray(st && st.recent) ? st.recent.slice(-64) : [],
    lastHit,
    pending: !!(se && se.pending),
    tool: se && se.tool && typeof se.tool.name === 'string' ? { name: se.tool.name, since: num(se.tool.since, 0) } : null,
    personality: cf && typeof cf.personality === 'string' ? cf.personality : 'classic',
    ascii: !!(cf && cf.ascii),
    tapMinG: num(t.tapMinG, 0.05),
    slapG: num(t.slapG, 0.45),
    wallopG: num(t.wallopG, 0.9),
  }
}

/** A custom persona JSON file, merged over classic (faces, whack, name, lines). */
export function customPersona(id: string, json: any): WhipPersona {
  const base = CLASSIC
  const p: WhipPersona = { ...base, id, name: typeof json.name === 'string' ? json.name.slice(0, 40) : id, faces: { ...base.faces }, lines: { ...base.lines } }
  if (typeof json.blurb === 'string') p.blurb = json.blurb.slice(0, 120)
  if (typeof json.whack === 'string') p.whack = json.whack.slice(0, 60)
  if (json.faces && typeof json.faces === 'object') {
    for (const k of FACE_KEYS) {
      const f = json.faces[k]
      if (typeof f === 'string') p.faces[k] = [f, base.faces[k][1]]
      else if (Array.isArray(f) && typeof f[0] === 'string') p.faces[k] = [f[0], typeof f[1] === 'string' ? f[1] : base.faces[k][1]]
    }
  }
  if (json.lines && typeof json.lines === 'object') {
    for (const k of ['empty', 'calm', 'sweating'] as const) if (typeof json.lines[k] === 'string') p.lines[k] = json.lines[k].slice(0, 120)
  }
  return p
}

export function personaOf(snap: WhipSnap, customs: Record<string, WhipPersona>): WhipPersona {
  return PERSONAS[snap.personality] ?? customs[snap.personality] ?? CLASSIC
}

export function personaIds(customs: Record<string, WhipPersona>): string[] {
  return [...Object.keys(PERSONAS), ...Object.keys(customs).filter(k => !PERSONAS[k])]
}

export function nextPersonaId(current: string, customs: Record<string, WhipPersona>): string {
  const ids = personaIds(customs)
  return ids[(ids.indexOf(current) + 1) % ids.length] ?? 'classic'
}

export function face(p: WhipPersona, m: Mood, ascii: boolean): string {
  const f = p.faces[m] ?? CLASSIC.faces[m]
  return f[ascii ? 1 : 0]
}

function slapsWithin(snap: WhipSnap, now: number, ms: number): number {
  return snap.recent.filter(r => r.tier !== 'tap' && now >= r.ts && now - r.ts <= ms).length
}

export function mood(snap: WhipSnap, now: number): Mood {
  if (snap.paused) return 'paused'
  const lh = snap.lastHit
  const dt = lh ? now - lh.ts : Infinity
  if (lh && dt >= 0 && dt < HIT_MS) {
    if (lh.tier === 'tap') return 'tap'
    if (lh.combo >= 5) return 'wrecked'
    if (lh.combo >= 3) return 'stunned'
    return 'hit'
  }
  if (lh && lh.tier !== 'tap' && dt >= 0 && dt < RECOVER_MS) return 'recovering'
  if (slapsWithin(snap, now, SWEAT_MS) >= 5) return 'sweating'
  if (snap.tool && now - snap.tool.since < 10 * 60 * 1000) return 'working'
  if (lh && dt >= CALM_MS) return 'calm'
  return 'idle'
}

// The whip travels: each redraw shows a later frame; every frame reads alone.
const FINAL = { until: Infinity, u: '⟿～～～～～～～～💥', a: 'o~~~~~~~~*' }
const FRAMES = [{ until: 350, u: '⟿～～', a: 'o~~' }, { until: 800, u: '⟿～～～～～', a: 'o~~~~~' }, FINAL]

export function frame(dt: number, ascii: boolean): { text: string; isFinal: boolean } {
  const f = FRAMES.find(x => dt < x.until) ?? FINAL
  return { text: ascii ? f.a : f.u, isFinal: f.until === Infinity }
}

export function fmtG(g: number): string {
  return `${(Math.round(g * 100) / 100).toFixed(2)}g`
}

export function fmtDuration(ms: number): string {
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h${m % 60 ? ` ${m % 60}m` : ''}`
  return `${Math.floor(h / 24)}d`
}

/** Ten cells scaled to the tier thresholds: green, then yellow, then red. */
export function forceBar(g: number, snap: WhipSnap, ascii: boolean): Seg[] {
  const max = snap.wallopG * 1.3
  const out: Seg[] = []
  for (let i = 0; i < 10; i++) {
    const at = ((i + 0.5) / 10) * max
    const lit = g >= ((i + 1) / 10) * max || (i === 0 && g > 0)
    const color = at < snap.slapG ? 'success' : at < snap.wallopG ? 'warning' : 'error'
    out.push(lit ? { text: ascii ? '#' : '▓', color } : { text: ascii ? '.' : '░', color: 'inactive' })
  }
  return out
}

function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ''))
}

function counters(snap: WhipSnap, ascii: boolean, best: boolean): Seg {
  let s = `${ascii ? '' : '👋 '}${snap.today} today · ${snap.total} total`
  if (best && snap.bestG > 0) s += ` · best ${fmtG(snap.bestG)}`
  return { text: s, color: 'subtle' }
}

/** The band's first row, as segments. */
export function lane(snap: WhipSnap, now: number, p: WhipPersona): Seg[] {
  const ascii = snap.ascii
  const m = mood(snap, now)
  const segs: Seg[] = [{ text: face(p, m, ascii), color: 'claude', bold: true }, { text: '  ' }]
  const lh = snap.lastHit
  const queued: Seg[] = snap.pending ? [{ text: '  ' }, { text: ascii ? '[whip queued]' : '⏳ whip queued', color: 'warning' }] : []
  if (snap.total === 0 && !lh) return [...segs, { text: p.lines.empty, color: 'subtle' }]
  switch (m) {
    case 'paused':
      return [...segs, { text: 'whip paused · /whip-on to resume', color: 'subtle' }]
    case 'tap':
      return [...segs, { text: ascii ? '*tap* ' : '👋 tap! ', color: 'success' }, { text: `${lh!.line || ''}  ${fmtG(lh!.g)} `, color: 'subtle' }, ...forceBar(lh!.g, snap, ascii)]
    case 'hit':
    case 'stunned':
    case 'wrecked': {
      const fr = frame(now - lh!.ts, ascii)
      const wallop = lh!.tier === 'wallop'
      const label: Seg = fr.isFinal ? { text: wallop ? 'WALLOP!!' : p.whack, color: wallop ? 'error' : 'warning', bold: true } : { text: 'whoosh…', dim: true }
      const combo: Seg[] = lh!.combo >= 2 ? [{ text: '  ' }, { text: `combo x${lh!.combo}`, color: 'error', bold: true }] : []
      return [...segs, { text: `${fr.text} `, color: 'claude' }, label, ...combo, { text: `  ${fmtG(lh!.g)} `, color: 'subtle' }, ...forceBar(lh!.g, snap, ascii), ...queued]
    }
    case 'recovering':
      return [...segs, { text: `"${lh!.apology || 'ok ok'}"`, italic: true }, { text: '   ' }, counters(snap, ascii, false), ...queued]
    case 'sweating':
      return [...segs, { text: `${ascii ? '' : '🔥 '}${fill(p.lines.sweating, { n: slapsWithin(snap, now, SWEAT_MS) })}`, color: 'warning' }, ...queued]
    case 'working':
      return [...segs, { text: `${snap.tool!.name}…  `, color: 'subtle' }, counters(snap, ascii, false), ...queued]
    case 'calm':
      return [...segs, { text: fill(p.lines.calm, { t: fmtDuration(now - lh!.ts) }), color: 'success' }]
    default:
      return [...segs, counters(snap, ascii, true), ...queued]
  }
}

/** Force values for the buttons, inside the user's own calibrated tiers. */
export function buttonG(snap: WhipSnap, tier: WhipTier): number {
  const g = tier === 'tap' ? (snap.tapMinG + snap.slapG) / 2 : tier === 'slap' ? (snap.slapG + snap.wallopG) / 2 : snap.wallopG * 1.25
  return Math.round(g * 100) / 100
}

export function toastText(hit: WhipHit, p: WhipPersona, ascii: boolean): string {
  const wallop = hit.tier === 'wallop'
  const fc = face(p, hit.combo >= 5 ? 'wrecked' : hit.combo >= 3 || wallop ? 'stunned' : 'hit', ascii)
  const combo = hit.combo >= 2 ? ` · combo x${hit.combo}` : ''
  return `${fc} ${wallop ? 'WALLOP!!' : p.whack} ${wallop ? 'WALLOP' : 'slap'} #${hit.slapNo} · ${fmtG(hit.g)}${combo}`
}

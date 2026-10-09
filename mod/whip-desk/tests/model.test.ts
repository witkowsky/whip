import { expect, test } from 'claude-code/testing'

import { buttonG, customPersona, frame, lane, mood, nextPersonaId, personaOf, toSnap, toastText } from '../hooks/model'
import { PERSONAS } from '../hooks/personas'

const T0 = new Date(2026, 9, 8, 16, 0, 0).getTime()

function snapAt(hit: Record<string, unknown> | null, extra: Record<string, unknown> = {}) {
  const st = {
    total: 3,
    bestG: 1.2,
    days: {},
    recent: hit ? [{ ts: T0, tier: hit.tier }] : [],
    lastHit: hit ? { id: 'h1', ts: T0, g: 0.62, combo: 1, slapNo: 3, line: 'Ship it.', apology: 'ok ok, hurrying…', ...hit } : null,
    ...extra,
  }
  return toSnap(st, { pending: true }, { personality: 'classic' }, T0)
}

const text = (segs: { text: string }[]) => segs.map(s => s.text).join('')

test('mood follows the hit timeline like the status line', async () => {
  const s = snapAt({ tier: 'slap' })
  expect(mood(s, T0 + 500)).toBe('hit')
  expect(mood(s, T0 + 5000)).toBe('recovering')
  expect(mood(s, T0 + 30000)).toBe('idle')
  expect(mood(s, T0 + 2 * 3600e3)).toBe('calm')
  expect(mood(snapAt({ tier: 'slap', combo: 5 }), T0 + 100)).toBe('wrecked')
  expect(mood(snapAt({ tier: 'tap' }), T0 + 100)).toBe('tap')
  expect(mood({ ...s, paused: true }, T0)).toBe('paused')
})

test('the whip travels and lands; every frame reads alone', async () => {
  expect(frame(0, false).isFinal).toBe(false)
  expect(frame(1000, false).text).toContain('💥')
  const s = snapAt({ tier: 'slap', combo: 3 })
  const at = text(lane(s, T0 + 1000, PERSONAS.classic!))
  expect(at).toContain('WHACK!')
  expect(at).toContain('combo x3')
  expect(at).toContain('⏳ whip queued')
  expect(text(lane(s, T0 + 100, PERSONAS.classic!))).toContain('whoosh')
})

test('personas change faces and banner words, not the facts', async () => {
  const s = { ...snapAt({ tier: 'slap' }), personality: 'kawaii' }
  const p = personaOf(s, {})
  expect(p.name).toBe('Mochi')
  expect(text(lane(s, T0 + 1000, p))).toContain('BONK!')
  expect(toastText(s.lastHit!, p, false)).toBe('(≧﹏≦) BONK! slap #3 · 0.62g')
  expect(nextPersonaId('butler', {})).toBe('classic')
  expect(nextPersonaId('butler', { pirate: customPersona('pirate', {}) })).toBe('pirate')
})

test('custom personas merge over classic and ignore junk', async () => {
  const p = customPersona('pirate', { name: 'Captain', whack: 'ARRR!', faces: { hit: '(╬ಠ益ಠ)' }, lines: 42 })
  expect(p.whack).toBe('ARRR!')
  expect(p.faces.hit[0]).toBe('(╬ಠ益ಠ)')
  expect(p.faces.idle[0]).toBe(PERSONAS.classic!.faces.idle[0])
  expect(p.lines.empty).toBe(PERSONAS.classic!.lines.empty)
})

test('buttons hit inside your calibrated tiers', async () => {
  const s = toSnap(null, null, { thresholds: { tapMinG: 0.03, slapG: 0.13, wallopG: 0.35 } }, T0)
  expect(buttonG(s, 'tap')).toBeLessThan(0.13)
  expect(buttonG(s, 'slap')).toBeGreaterThan(0.13)
  expect(buttonG(s, 'slap')).toBeLessThan(0.35)
  expect(buttonG(s, 'wallop')).toBeGreaterThan(0.35)
})

test('garbage files never break the digest', async () => {
  const s = toSnap('nope', 42, null, T0)
  expect(s.total).toBe(0)
  expect(s.lastHit).toBe(null)
  expect(text(lane(s, T0, PERSONAS.classic!))).toContain('no slaps yet')
})

test('muted comes from config.json', async () => {
  expect(toSnap(null, null, { muted: true }, T0).muted).toBe(true)
  expect(toSnap(null, null, {}, T0).muted).toBe(false)
})

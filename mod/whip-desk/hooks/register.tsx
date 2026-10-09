// ClaudeWhip for Claude Desktop (and the terminal, if you ask): the whip lane as
// a band above the prompt, a toast when a whip lands, slap buttons and a stats
// pane. It reads the same ~/.claude/whip files the status line does and runs
// the `whip` CLI for anything that changes state, so the engine stays one.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WhipPersona, WhipSnap, WhipTier } from '../types'
import { RECOVER_MS, buttonG, customPersona, lane, nextPersonaId, personaOf, sanitizeId, toSnap, toastText } from './model'

const snapA = atom({ plugin: 'whip-desk', key: 'snap' } as const, null)
const nowA = atom({ plugin: 'whip-desk', key: 'now' } as const, 0)
const statsA = atom({ plugin: 'whip-desk', key: 'stats' } as const, '')
const customsA = atom({ plugin: 'whip-desk', key: 'customs' } as const, {})
// The ✕ on the band; kept in $.store too so it survives new sessions.
const hiddenA = atom({ plugin: 'whip-desk', key: 'hidden' } as const, false)

const PANE = 'whip-stats'
const POLL_MS = 200

type $T = EngineInterface

// Bookkeeping only (a reload starts it over); everything drawn lives in $.state.
const S = {
  home: '',
  sid: '',
  cli: null as string[] | null,
  stamps: '',
  snap: null as WhipSnap | null,
  customs: {} as Record<string, WhipPersona>,
  shownHit: '',
  lastNow: 0,
  terminalBand: false,
  show: true,
  sound: 'whip config',
  voice: 'whip config',
}

const HIDDEN_KEY = 'hidden'

async function readJson($: $T, path: string): Promise<any> {
  try {
    return JSON.parse(await $.fs.read(path))
  } catch {
    return null
  }
}

async function mtime($: $T, path: string): Promise<number> {
  try {
    return (await $.fs.stat(path)).mtimeMs
  } catch {
    return 0
  }
}

// Same resolution as lib/paths.js: WHIP_HOME, else CLAUDE_CONFIG_DIR/whip, else ~/.claude/whip.
async function findHome($: $T): Promise<string> {
  const wh = await $.env.get('WHIP_HOME')
  if (wh) return wh
  const cd = await $.env.get('CLAUDE_CONFIG_DIR')
  if (cd) return `${cd}/whip`
  return `${(await $.env.get('HOME')) || ''}/.claude/whip`
}

// node + bin/whip, from what install.sh recorded (or the bridge's LaunchAgent).
async function findCli($: $T): Promise<string[] | null> {
  const rec = await readJson($, `${S.home}/install.json`)
  if (!rec || typeof rec.repoRoot !== 'string') return null
  let node = typeof rec.node === 'string' ? rec.node : ''
  if (!node) {
    try {
      const plist = await $.fs.read(`${await $.env.get('HOME')}/Library/LaunchAgents/com.claudewhip.bridge.plist`)
      const m = /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]+)<\/string>/.exec(plist)
      if (m && m[1]) node = m[1]
    } catch {}
  }
  return node ? [node, `${rec.repoRoot}/bin/whip`] : ['/usr/bin/env', 'node', `${rec.repoRoot}/bin/whip`]
}

async function loadCustoms($: $T): Promise<void> {
  const out: Record<string, WhipPersona> = {}
  try {
    for (const f of await $.fs.list(`${S.home}/personas`)) {
      const m = /^([a-z0-9][a-z0-9_-]{0,31})\.json$/i.exec(f.name)
      if (!m || f.kind !== 'file') continue
      const json = await readJson($, `${S.home}/personas/${f.name}`)
      const id = (m[1] ?? '').toLowerCase()
      if (json && typeof json === 'object') out[id] = customPersona(id, json)
    }
  } catch {}
  S.customs = out
  await update($, customsA, () => out)
}

/** Re-reads the three files only when one of them changed; drives the animation clock. */
async function poll($: $T, force = false): Promise<void> {
  const now = await $.clock.now()
  const files = [`${S.home}/state.json`, `${S.home}/sessions/${sanitizeId(S.sid)}.json`, `${S.home}/config.json`]
  const times = await Promise.all(files.map(f => mtime($, f)))
  const stamp = times.join(':')
  if (force || stamp !== S.stamps) {
    S.stamps = stamp
    const [st, se, cf] = await Promise.all(files.map(f => readJson($, f)))
    const next = toSnap(st, se, cf, now)
    const lh = next.lastHit
    if (lh && S.shownHit && lh.id !== S.shownHit && lh.tier !== 'tap' && now - lh.ts < 4000 && S.show && !(await read($, hiddenA))) {
      $.ui.toast(toastText(lh, personaOf(next, S.customs), next.ascii), { timeoutMs: 3000 })
    }
    S.shownHit = lh ? lh.id : S.shownHit || 'none'
    S.snap = next
    await update($, snapA, () => next)
  }
  // Animate quickly around a hit; otherwise a slow tick keeps "2h without a slap" honest.
  const since = S.snap && S.snap.lastHit ? now - S.snap.lastHit.ts : Infinity
  if (since < RECOVER_MS + 1000 || now - S.lastNow > 5000) {
    S.lastNow = now
    await update($, nowA, () => now)
  }
}

async function whip($: $T, args: string[]): Promise<string | null> {
  S.cli = S.cli || (await findCli($))
  if (!S.cli) {
    $.ui.toast('ClaudeWhip is not installed: run ./install.sh in the repo first')
    return null
  }
  const r = await $.process.run([...S.cli, ...args], { timeoutMs: 15000 })
  if (r.exitCode !== 0) $.ui.toast(`whip ${args[0] ?? ''} failed: ${(r.stderr || r.stdout).trim().split('\n')[0] ?? ''}`)
  return r.exitCode === 0 ? r.stdout : null
}

async function hit($: $T, tier: WhipTier): Promise<void> {
  const s = S.snap || toSnap(null, null, null, await $.clock.now())
  await whip($, ['simulate', '--g', String(buttonG(s, tier)), '--tier', tier, '--session', S.sid])
  await poll($, true)
}

async function openStats($: $T): Promise<void> {
  const out = await whip($, ['stats', '--plain'])
  if (out !== null) await update($, statsA, () => out.trimEnd())
  await $.ui.open({ id: PANE, title: 'ClaudeWhip — slap stats' })
}

async function cyclePersona($: $T): Promise<void> {
  if (!S.snap) return
  const next = nextPersonaId(S.snap.personality, S.customs)
  const out = await whip($, ['persona', next, '--plain'])
  if (out !== null) $.ui.toast((out.split('\n')[0] ?? '').replace(/^SWITCHED: /, ''), { timeoutMs: 2500 })
  await poll($, true)
}

async function setHidden($: $T, hidden: boolean): Promise<void> {
  await $.store.set(HIDDEN_KEY, hidden)
  await update($, hiddenA, () => hidden)
  if (hidden) $.ui.toast('ClaudeWhip hidden. /whip-desk-show brings it back.', { timeoutMs: 3000 })
}

// The plugin settings' on/off pickers write through to ~/.claude/whip/config.json,
// so the bridge (which plays the sounds) sees them; 'whip config' leaves the file alone.
async function applySettings($: $T): Promise<void> {
  const cf = (await readJson($, `${S.home}/config.json`)) || {}
  for (const key of ['sound', 'voice'] as const) {
    const want = S[key]
    if (want !== 'on' && want !== 'off') continue
    if ((cf[key] === true) === (want === 'on') && key in cf) continue
    await whip($, ['config', 'set', key, want === 'on' ? 'true' : 'false'])
  }
}

async function start($: $T): Promise<void> {
  S.home = await findHome($)
  S.sid = await $.session.id()
  await update($, hiddenA, () => false)
  if ((await $.store.get(HIDDEN_KEY)) === true) await update($, hiddenA, () => true)
  await applySettings($)
  await loadCustoms($)
  await poll($, true)
  $.clock.every(POLL_MS, () => poll($))
  $.clock.every(10000, () => loadCustoms($))
  await $.command.register({ name: 'whip-stats', description: 'ClaudeWhip: slap stats in a pane (no model turn)' })
  await $.command.register({ name: 'whip-desk-show', description: 'ClaudeWhip: show the whip band again after ✕' })
  await $.command.register({ name: 'whip-desk-hide', description: 'ClaudeWhip: hide the whip band and toasts' })
}

export const register: Register = (on, options) => {
  S.terminalBand = !!(options && options.terminalBand)
  S.show = !(options && options.show === false)
  S.sound = String((options && options.sound) || 'whip config')
  S.voice = String((options && options.voice) || 'whip config')

  on('session.start', async ($, e, next) => {
    await start($)
    return next(e)
  })

  on('command.run', { command: 'whip-stats' }, async $ => {
    await openStats($)
    return { text: 'Opened the ClaudeWhip stats pane.' }
  })

  on('command.run', { command: 'whip-desk-show' }, async $ => {
    await setHidden($, false)
    return { text: S.show ? 'ClaudeWhip band is back.' : 'Unhidden, but "Show the whip band and toasts" is off in the plugin settings.' }
  })

  on('command.run', { command: 'whip-desk-hide' }, async $ => {
    await setHidden($, true)
    return { text: 'ClaudeWhip band hidden. /whip-desk-show brings it back.' }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !S.show) return next(e)
    if (await read($, hiddenA)) return next(e)
    if (e.surface === 'terminal' && !S.terminalBand) return next(e) // the status line has it
    const s = await read($, snapA)
    if (!s) return next(e)
    const now = Math.max(await read($, nowA), s.lastHit ? s.lastHit.ts : 0)
    const p = personaOf(s, await read($, customsA))
    const segs = lane(s, now, p)
    const { Box, Text, Button } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          {segs.map(seg => (
            <Text color={seg.color} bold={seg.bold} dimColor={seg.dim} italic={seg.italic} wrap="truncate-end">
              {seg.text}
            </Text>
          ))}
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button key="tap" label="👋 tap" hotkey="t" onPress={() => hit($, 'tap')} />
          <Button key="slap" label="✋ slap" hotkey="s" onPress={() => hit($, 'slap')} />
          <Button key="wallop" label="💥 WALLOP" hotkey="w" variant="primary" onPress={() => hit($, 'wallop')} />
          <Button key="stats" label="📊 stats" hotkey="g" onPress={() => openStats($)} />
          <Button key="persona" label={`🎭 ${p.name}`} hotkey="p" onPress={() => cyclePersona($)} />
          <Button key="hide" label="✕" hotkey="x" role="dismiss" onPress={() => setHidden($, true)} />
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code } = $.ui.resolve(e)
    const text = await read($, statsA)
    return (
      <Box flexDirection="column">
        <Code source={text || 'No stats yet. Slap your MacBook (or press ✋ slap).'} language="text" />
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => openStats($)} />
          <Button key="close" label="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}

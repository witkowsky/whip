// ClaudeWhip for Claude Desktop (and the terminal, if you ask): the whip lane as
// a band above the prompt, a toast when a whip lands and a stats pane
// (/whip:stats, /whip:slaps). It reads the same ~/.claude/whip files the status line does and runs
// the `whip` CLI for anything that changes state, so the engine stays one.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { WhipPersona, WhipSnap } from '../types'
import { RECOVER_MS, customPersona, lane, nextPersonaId, personaOf, sanitizeId, toSnap, toastText } from './model'

const snapA = atom({ plugin: 'whip-desk', key: 'snap' } as const, null)
const nowA = atom({ plugin: 'whip-desk', key: 'now' } as const, 0)
const statsA = atom({ plugin: 'whip-desk', key: 'stats' } as const, '')
const customsA = atom({ plugin: 'whip-desk', key: 'customs' } as const, {})

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
}

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
    if (lh && S.shownHit && lh.id !== S.shownHit && lh.tier !== 'tap' && now - lh.ts < 4000 && !next.hidden && S.show) {
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

async function toggleMute($: $T): Promise<void> {
  if (!S.snap) return
  const out = await whip($, [S.snap.muted ? 'unmute' : 'mute'])
  if (out !== null) $.ui.toast((out.split('\n')[0] ?? '').replace(/ — .*/, ''), { timeoutMs: 2000 })
  await poll($, true)
}

// The ✕ on the band: the same as /whip:hide (pause, hide the lane everywhere).
async function close($: $T): Promise<void> {
  if ((await whip($, ['hide'])) !== null) $.ui.toast('ClaudeWhip closed. /whip:show brings it back.', { timeoutMs: 3000 })
  await poll($, true)
}

async function start($: $T): Promise<void> {
  S.home = await findHome($)
  S.sid = await $.session.id()
  await loadCustoms($)
  await poll($, true)
  $.clock.every(POLL_MS, () => poll($))
  $.clock.every(10000, () => loadCustoms($))
}

export const register: Register = (on, options) => {
  S.terminalBand = !!(options && options.terminalBand)
  S.show = !(options && options.show === false)

  on('session.start', async ($, e, next) => {
    await start($)
    return next(e)
  })

  // /whip:slaps and /whip:stats (the whip plugin's commands) open the stats pane instead of a model turn.
  on('command.run', { command: ['whip:slaps', 'whip:stats'] }, async $ => {
    await openStats($)
    return { text: 'Opened the ClaudeWhip stats pane.' }
  })

  // /whip:hide and /whip:show already hide the band through config.json; refresh at once.
  on('command.run', { command: ['whip:hide', 'whip:show'] }, async ($, e, next) => {
    const r = await next(e)
    await poll($, true)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || !S.show) return next(e)
    if (e.surface === 'terminal' && !S.terminalBand) return next(e) // the status line has it
    const s = await read($, snapA)
    if (!s || s.hidden) return next(e)
    const now = Math.max(await read($, nowA), s.lastHit ? s.lastHit.ts : 0)
    const p = personaOf(s, await read($, customsA))
    const segs = lane(s, now, p)
    const { Box, Text, Button } = $.ui.resolve(e)
    // Its own framed card: the band is one shared slot, so another plugin's bar
    // (Rizk's, say) draws in the same panel; the border keeps the two apart.
    return (
      <Box flexDirection="row" gap={1} borderStyle="round" borderDimColor paddingX={1}>
        <Box flexDirection="row" flexGrow={1}>
          {segs.map(seg => (
            <Text color={seg.color} bold={seg.bold} dimColor={seg.dim} italic={seg.italic} wrap="truncate-end">
              {seg.text}
            </Text>
          ))}
        </Box>
        <Button key="persona" label={`🎭 ${p.name}`} hotkey="p" onPress={() => cyclePersona($)} />
        <Button key="mute" label={s.muted ? '🔇' : '🔊'} hotkey="m" onPress={() => toggleMute($)} />
        <Button key="hide" label="✕" role="dismiss" onPress={() => close($)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Code } = $.ui.resolve(e)
    const text = await read($, statsA)
    return (
      <Box flexDirection="column">
        <Code source={text || 'No stats yet. Slap your MacBook.'} language="text" />
        <Box flexDirection="row" gap={1}>
          <Button key="refresh" label="refresh" hotkey="r" onPress={() => openStats($)} />
          <Button key="close" label="close" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}

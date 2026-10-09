export type WhipTier = 'tap' | 'slap' | 'wallop'

export type WhipHit = {
  id: string
  ts: number
  g: number
  tier: WhipTier
  combo: number
  slapNo: number
  line: string | null
  apology: string | null
}

/** What the band draws from: a digest of ~/.claude/whip state, session and config. */
export type WhipSnap = {
  total: number
  today: number
  bestG: number
  paused: boolean
  recent: { ts: number; tier: string }[]
  lastHit: WhipHit | null
  pending: boolean
  tool: { name: string; since: number } | null
  personality: string
  ascii: boolean
  /** `whip hide` in config.json */
  hidden: boolean
  tapMinG: number
  slapG: number
  wallopG: number
}

export type WhipFaceKey = 'idle' | 'working' | 'hit' | 'stunned' | 'wrecked' | 'recovering' | 'sweating' | 'calm' | 'tap' | 'paused'

export type WhipPersona = {
  id: string
  name: string
  blurb: string
  whack: string
  /** [unicode, ascii] per mood */
  faces: Record<WhipFaceKey, [string, string]>
  lines: { empty: string; calm: string; sweating: string }
}

declare module 'claude-code' {
  interface PluginState {
    'whip-desk': {
      snap: WhipSnap | null
      now: number
      stats: string
      customs: Record<string, WhipPersona>
    }
  }
}

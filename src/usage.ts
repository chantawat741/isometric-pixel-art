// Usage shown in the USAGE dock: two separate things.
//
// 1. Plan limits (percent used and reset time of the 5-hour and weekly windows), as Orca's own Usage
//    panel shows them. Orca's plugin API does not carry them, so the plugin worker reads them from
//    Orca's command-line tool (`orca account list --json`).
// 2. Tokens used on this computer: the token count of each past agent session (Agent Session
//    History, `agent.listSessions`, needs the history:read permission). This is NOT a quota.

export interface KindUsage {
  agent: string
  today: number
  week: number
  sessions: number
  running: number
}

export interface UsageData {
  today: number
  week: number
  sessions: number
  kinds: KindUsage[]
  /** The session list was cut inside the 7-day window, so the sums are a lower bound. */
  partial: boolean
  at: number
}

export type UsageState = 'loading' | 'ok' | 'demo' | 'denied' | 'unavailable' | 'error'

export interface LimitWindow {
  usedPercent: number
  windowMinutes: number
  /** Epoch milliseconds, 0 when unknown. */
  resetsAt: number
}

export interface ProviderLimits {
  provider: string
  planType: string
  session: LimitWindow | null
  weekly: LimitWindow | null
  updatedAt: number
}

export interface LimitsData {
  providers: ProviderLimits[]
  at: number
}

/** `unavailable` carries a reason from the worker (cli_not_found, cli_failed, unreadable). */
export type LimitsState = 'loading' | 'ok' | 'demo' | 'unavailable' | 'error'

const PROVIDER_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  cursor: 'Cursor',
  grok: 'Grok',
  kimi: 'Kimi',
  minimax: 'MiniMax',
  antigravity: 'Antigravity',
  opencodeGo: 'OpenCode Go',
  zcode: 'Z Code',
  muse: 'Muse'
}

export function providerName(provider: string): string {
  return PROVIDER_NAMES[provider] ?? kindLabel(provider)
}

/** "resets in 2d 22h", "resets in 2h 10m", "resets in 9m", or "resets soon". */
export function formatReset(resetsAt: number, now: number): string {
  if (!resetsAt) return ''
  const mins = Math.ceil((resetsAt - now) / 60000)
  if (mins <= 0) return 'resets soon'
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `resets in ${d}d ${h}h`
  if (h > 0) return `resets in ${h}h ${m}m`
  return `resets in ${m}m`
}

export function windowLabel(w: LimitWindow, fallback: string): string {
  if (w.windowMinutes === 300) return '5h'
  if (w.windowMinutes === 10080) return 'Weekly'
  return fallback
}

/** 1.2k, 3.4M, 1.1B: short enough for a narrow panel. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n < 1000) return String(Math.round(n))
  const unit = (v: number, suffix: string): string => `${v >= 100 ? Math.round(v) : parseFloat(v.toFixed(v >= 10 ? 1 : 2))}${suffix}`
  if (n < 1e6) return unit(n / 1e3, 'k')
  if (n < 1e9) return unit(n / 1e6, 'M')
  return unit(n / 1e9, 'B')
}

export function kindLabel(agent: string): string {
  if (!agent) return 'Agent'
  return agent.charAt(0).toUpperCase() + agent.slice(1)
}

/** Ask the plugin worker for the sums (the panel itself cannot call `agent.listSessions`). */
export async function loadUsage(request: (name: string, input?: unknown) => Promise<unknown>): Promise<UsageData> {
  const raw = (await request('pixel.usage', {})) as Partial<UsageData> | null
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.kinds)) throw Object.assign(new Error('unexpected answer'), { code: 'invalid_response' })
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  return {
    today: num(raw.today),
    week: num(raw.week),
    sessions: num(raw.sessions),
    partial: raw.partial === true,
    at: num(raw.at),
    kinds: raw.kinds.slice(0, 8).map((k) => ({
      agent: String((k as KindUsage).agent ?? 'agent'),
      today: num((k as KindUsage).today),
      week: num((k as KindUsage).week),
      sessions: num((k as KindUsage).sessions),
      running: num((k as KindUsage).running)
    }))
  }
}

export type LimitsAnswer = { state: 'ok'; data: LimitsData } | { state: 'unavailable'; reason: string }

/** Ask the plugin worker for the plan limits (it runs Orca's CLI; the panel itself cannot). */
export async function loadLimits(request: (name: string, input?: unknown) => Promise<unknown>): Promise<LimitsAnswer> {
  const raw = (await request('pixel.limits', {})) as { available?: unknown; reason?: unknown; providers?: unknown; at?: unknown } | null
  if (!raw || typeof raw !== 'object') throw Object.assign(new Error('unexpected answer'), { code: 'invalid_response' })
  if (raw.available !== true) return { state: 'unavailable', reason: typeof raw.reason === 'string' ? raw.reason : 'unreadable' }
  if (!Array.isArray(raw.providers)) throw Object.assign(new Error('unexpected answer'), { code: 'invalid_response' })
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const win = (v: unknown): LimitWindow | null => {
    if (!v || typeof v !== 'object') return null
    const w = v as Partial<LimitWindow>
    if (typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) return null
    return { usedPercent: Math.max(0, Math.min(100, w.usedPercent)), windowMinutes: num(w.windowMinutes), resetsAt: num(w.resetsAt) }
  }
  const providers = (raw.providers as Array<Partial<ProviderLimits>>).slice(0, 4).map((p) => ({
    provider: String(p.provider ?? 'agent'),
    planType: String(p.planType ?? ''),
    session: win(p.session),
    weekly: win(p.weekly),
    updatedAt: num(p.updatedAt)
  }))
  return { state: 'ok', data: { providers, at: num(raw.at) } }
}

/** Simulated limits for demo mode (relative to now, always labelled as simulated). */
export function demoLimits(now: number): LimitsData {
  return {
    at: now,
    providers: [
      {
        provider: 'claude',
        planType: 'team',
        session: { usedPercent: 16, windowMinutes: 300, resetsAt: now + (2 * 60 + 10) * 60000 },
        weekly: { usedPercent: 18, windowMinutes: 10080, resetsAt: now + ((2 * 24 + 22) * 60 + 5) * 60000 },
        updatedAt: now
      }
    ]
  }
}

/** Shown only in demo mode, always labelled as simulated. */
export const DEMO_USAGE: UsageData = {
  today: 1_540_000,
  week: 11_200_000,
  sessions: 20,
  partial: false,
  at: 0,
  kinds: [
    { agent: 'claude', today: 1_240_000, week: 8_900_000, sessions: 14, running: 2 },
    { agent: 'codex', today: 300_000, week: 2_300_000, sessions: 6, running: 0 }
  ]
}

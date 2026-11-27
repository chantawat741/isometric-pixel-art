// Token usage shown in the USAGE dock.
//
// What Orca can tell a plugin is the token count of each past agent session (Agent Session History,
// `agent.listSessions`, needs the history:read permission). It does NOT expose plan limits, the
// percentage left or reset times, so Pixel Base shows tokens *used* and never invents a quota.

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

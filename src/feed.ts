// Live agent data from Orca (Phase 4).
//
// Rules this module follows (from the Pixel Base plan):
//  - Only what Orca reports is shown: no invented agents and no guessed "thinking" state.
//  - `agents.list` is the source of truth; `agent.status.changed` / `workspace.changed` events only
//    tell us *when* to look again (and carry the outcome of a finished run).
//  - No AI/API calls of any kind: this is a read-only mirror of Orca's own agent runtime.

import type { VisualStatus } from './character'

export type OrcaState = 'working' | 'blocked' | 'waiting' | 'done'

export interface RawAgent {
  terminalId: string | null
  title: string | null
  agent: string | null
  state: OrcaState
  stateStartedAt: number
  sessionId?: string | null
  task?: { title: string } | null
}

/** The slice of `window.orca` Pixel Base uses. */
export interface HostLike {
  host: {
    has(method: string): boolean
    call(method: string, params?: unknown): Promise<unknown>
  }
  on(event: string, handler: (payload: never) => unknown): { dispose(): void } | void
  /** Talks to this plugin's own worker (`plugin.request`); absent in a plain browser. */
  plugin?: { request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<unknown> }
}

/** The focused workspace as Orca last reported it. */
export interface WorkspaceContext {
  workspaceId?: string
  displayName: string
  branch: string
}

export interface AgentView {
  key: string
  /** The terminal Orca says the agent runs in (needed to focus it), if reported. */
  terminalId: string | null
  name: string
  kind: string
  title: string
  task: string
  raw: OrcaState
  since: number
  status: VisualStatus
  /** Index into DESKS, or -1 when every desk is taken. */
  deskIndex: number
}

const COMPLETED_FOR = 3 // seconds a finished agent shows the check mark
const CELEBRATE_FOR = 2.5 // seconds of celebration after a successful run

/**
 * Orca only reports working / blocked / waiting / done. Pixel Base adds two *illustrative* states
 * derived from `done`: a short "completed" beat, a celebration after a clean run, then idle.
 */
export function visualStatus(raw: OrcaState, since: number, outcome: string | undefined, now: number): VisualStatus {
  switch (raw) {
    case 'working':
      return 'working'
    case 'blocked':
      return 'blocked'
    case 'waiting':
      return 'waiting'
    case 'done': {
      const age = (now - since) / 1000
      // Only an outcome Orca explicitly reports as a failure makes the character cry.
      if (age < COMPLETED_FOR) return outcome === 'failure' ? 'failed' : 'completed'
      const clean = outcome === undefined || outcome === 'success' || outcome === 'unconfirmed'
      if (clean && age < COMPLETED_FOR + CELEBRATE_FOR) return 'celebrating'
      return 'idle'
    }
  }
}

interface Rec {
  key: string
  terminalId: string | null
  order: number
  kind: string
  title: string
  task: string
  raw: OrcaState
  since: number
  deskIndex: number
}

const POLL_MS = 15000 // safety net; events normally trigger refreshes much sooner

export class AgentFeed {
  /** Called whenever the agent list, a state or the workspace label changed. */
  onChange: () => void = () => {}
  workspaceLabel: string | null = null
  /** The focused workspace's id, name and branch (for "Open workspace"). */
  context: WorkspaceContext | null = null
  /** The last failure to read agents (cleared by the next successful read). */
  error: string | null = null
  /** False when Orca refused the event subscription: we then poll every few seconds instead. */
  eventsOk = true
  live = false

  private readonly recs = new Map<string, Rec>()
  private readonly outcomes = new Map<string, string>()
  private readonly disposers: Array<() => void> = []
  private timer: ReturnType<typeof setTimeout> | undefined
  private poll: ReturnType<typeof setInterval> | undefined
  private busy = false
  private again = false
  private counter = 0

  constructor(
    private readonly orca: HostLike,
    private readonly deskCount: number
  ) {}

  /** Subscribes and loads the first list. Resolves false when this Orca cannot list agents. */
  async start(): Promise<boolean> {
    if (!this.orca.host.has('agents.list')) {
      this.error = 'This Orca version cannot list agents'
      return false
    }
    this.live = true
    try {
      const sub = this.orca.on('agent.status.changed', ((e: { terminalId?: string; mainAgent?: { outcome?: string } }) => {
        if (e.terminalId && e.mainAgent?.outcome) this.outcomes.set(e.terminalId, e.mainAgent.outcome)
        this.scheduleRefresh()
      }) as never)
      if (sub) this.disposers.push(() => sub.dispose())
      const ws = this.orca.on('workspace.changed', ((e: { context?: WorkspaceContext | null }) => {
        this.workspaceLabel = e?.context?.displayName ?? null
        this.context = e?.context ?? null
        this.scheduleRefresh()
      }) as never)
      if (ws) this.disposers.push(() => ws.dispose())
    } catch {
      // No agent:read approval for events: fall back to polling faster.
      this.eventsOk = false
      for (const d of this.disposers.splice(0)) d()
    }
    this.poll = setInterval(() => {
      if (!document.hidden) this.scheduleRefresh()
    }, this.eventsOk ? POLL_MS : 4000)
    await this.refresh()
    return true
  }

  stop(): void {
    for (const d of this.disposers.splice(0)) d()
    clearTimeout(this.timer)
    clearInterval(this.poll)
    this.live = false
    this.recs.clear()
  }

  scheduleRefresh(): void {
    clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.refresh(), 150)
  }

  async refresh(): Promise<void> {
    if (this.busy) {
      this.again = true
      return
    }
    this.busy = true
    try {
      const res = (await this.orca.host.call('agents.list', {})) as { agents: RawAgent[] }
      this.error = null
      this.reconcile(res.agents ?? [])
    } catch (error) {
      this.error = describe(error)
    } finally {
      this.busy = false
      this.onChange()
      if (this.again) {
        this.again = false
        this.scheduleRefresh()
      }
    }
  }

  private reconcile(list: RawAgent[]): void {
    const seen = new Set<string>()
    for (const a of list) {
      const key = a.terminalId ?? a.sessionId ?? `${a.agent ?? 'agent'}:${a.title ?? ''}`
      seen.add(key)
      let rec = this.recs.get(key)
      if (!rec) {
        rec = { key, terminalId: null, order: this.counter++, kind: '', title: '', task: '', raw: a.state, since: a.stateStartedAt, deskIndex: -1 }
        this.recs.set(key, rec)
      }
      rec.terminalId = a.terminalId
      rec.kind = a.agent ?? 'agent'
      rec.title = a.title ?? ''
      rec.task = a.task?.title ?? ''
      rec.raw = a.state
      rec.since = a.stateStartedAt
      if (a.state !== 'done') this.outcomes.delete(key)
    }
    for (const key of [...this.recs.keys()]) {
      if (!seen.has(key)) this.recs.delete(key)
    }
    this.assignDesks()
  }

  /** Stable desks: an agent keeps its desk while it exists; the lowest free desk goes to newcomers. */
  private assignDesks(): void {
    const used = new Set<number>()
    for (const r of this.recs.values()) if (r.deskIndex >= 0) used.add(r.deskIndex)
    for (const r of [...this.recs.values()].sort((a, b) => a.order - b.order)) {
      if (r.deskIndex >= 0) continue
      for (let i = 0; i < this.deskCount; i++) {
        if (!used.has(i)) {
          r.deskIndex = i
          used.add(i)
          break
        }
      }
    }
  }

  get count(): number {
    return this.recs.size
  }

  /** Agents that did not get a desk because the office is full. */
  get overflow(): number {
    let n = 0
    for (const r of this.recs.values()) if (r.deskIndex < 0) n++
    return n
  }

  views(now: number): AgentView[] {
    const recs = [...this.recs.values()].sort((a, b) => a.order - b.order)
    const seenNames = new Map<string, number>()
    return recs.map((r) => {
      const base = (r.kind || 'agent').toUpperCase().replace(/[^A-Z0-9]/g, '') || 'AGENT'
      const n = (seenNames.get(base) ?? 0) + 1
      seenNames.set(base, n)
      const name = (n > 1 ? `${base.slice(0, 7)} ${n}` : base).slice(0, 9)
      return {
        key: r.key,
        terminalId: r.terminalId,
        name,
        kind: r.kind,
        title: r.title,
        task: r.task,
        raw: r.raw,
        since: r.since,
        status: visualStatus(r.raw, r.since, this.outcomes.get(r.key), now),
        deskIndex: r.deskIndex
      }
    })
  }
}

function describe(error: unknown): string {
  if (error && typeof error === 'object') {
    const e = error as { code?: string; message?: string }
    return e.code ? `${e.code}${e.message ? `: ${e.message}` : ''}` : (e.message ?? 'unknown error')
  }
  return String(error)
}

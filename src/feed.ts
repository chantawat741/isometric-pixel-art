// Live agent data from Orca (Phase 4).
//
// Rules this module follows (from the Pixel Base plan):
//  - Only what Orca reports is shown: no invented agents and no guessed "thinking" state.
//  - `agents.list` is the source of truth; `agent.status.changed` / `workspace.changed` events only
//    tell us *when* to look again (and carry the outcome of a finished run).
//  - No AI/API calls of any kind: this is a read-only mirror of Orca's own agent runtime.

import { STATUS_COLOR } from './character'
import type { VisualStatus } from './character'

export type OrcaState = 'working' | 'blocked' | 'waiting' | 'done'

/** One line of the ACTIVITY dock: a state change Orca reported (or, in demo mode, a simulated one). */
export interface ActivityItem {
  /** Epoch milliseconds: for real agents the time Orca says the state began. */
  t: number
  label: string
  text: string
  color: string
}

export const ACTIVITY_MAX = 30

/** Newest first, capped. */
export function pushActivity(list: ActivityItem[], item: ActivityItem): void {
  list.push(item)
  list.sort((a, b) => b.t - a.t)
  if (list.length > ACTIVITY_MAX) list.length = ACTIVITY_MAX
}

function activityFor(raw: OrcaState, task: string, outcome: string | undefined): { text: string; status: VisualStatus } {
  switch (raw) {
    case 'working':
      return { text: task ? `is working on: ${task}` : 'started working', status: 'working' }
    case 'waiting':
      return { text: 'is waiting for you', status: 'waiting' }
    case 'blocked':
      return { text: 'is blocked', status: 'blocked' }
    case 'done':
      return outcome === 'failure'
        ? { text: `failed${task ? `: ${task}` : ''}`, status: 'failed' }
        : { text: `finished${task ? `: ${task}` : ''}`, status: 'completed' }
  }
}

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

/** A workspace (worktree, folder or bot home) as the plugin worker lists it. */
export interface WorkspaceInfo {
  id: string
  name: string
  kind: string
  branch: string | null
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
  /** The workspace the agent belongs to, when known. */
  workspaceId: string | null
  workspaceName: string
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
  workspaceId: string | null
  workspaceName: string
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
  /** State changes Orca reported, newest first. */
  readonly activity: ActivityItem[] = []
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

  /** Workspaces known to Orca (via the worker); null when the worker cannot be reached. */
  workspaces: WorkspaceInfo[] | null = null

  private async loadWorkspaces(): Promise<WorkspaceInfo[] | null> {
    if (!this.orca.plugin?.request) return null
    try {
      const out = (await this.orca.plugin.request('pixel.listWorkspaces', {}, { timeoutMs: 6000 })) as { workspaces?: WorkspaceInfo[] }
      return Array.isArray(out?.workspaces) ? out.workspaces : null
    } catch {
      return null // no worker (e.g. workspace access not approved): fall back to the focused workspace
    }
  }

  async refresh(): Promise<void> {
    if (this.busy) {
      this.again = true
      return
    }
    this.busy = true
    try {
      this.workspaces = await this.loadWorkspaces()
      const found: Array<{ raw: RawAgent; ws: WorkspaceInfo | null }> = []
      let successes = 0
      let lastError: unknown = null
      const read = async (ws: WorkspaceInfo | null): Promise<void> => {
        try {
          const res = (await this.orca.host.call('agents.list', ws ? { workspaceId: ws.id } : {})) as { agents?: RawAgent[] }
          successes++
          for (const raw of res.agents ?? []) found.push({ raw, ws })
        } catch (error) {
          lastError = error // one workspace failing must not hide the others
        }
      }
      // Every workspace (bots included), plus the focused one as a safety net; duplicates merge by key.
      const focused = this.workspaces?.find((w) => w.name === this.context?.displayName) ?? null
      await Promise.all([...(this.workspaces ?? []).slice(0, 20).map((w) => read(w)), read(null)])
      if (successes === 0) throw lastError ?? new Error('could not read agents')
      this.error = null
      this.reconcile(found, focused)
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

  private reconcile(list: Array<{ raw: RawAgent; ws: WorkspaceInfo | null }>, focused: WorkspaceInfo | null): void {
    const seen = new Set<string>()
    // Workspace-specific reads come first so a duplicate from the unscoped (focused) read never wins.
    const ordered = [...list].sort((a, b) => Number(!!b.ws) - Number(!!a.ws))
    for (const { raw: a, ws: known } of ordered) {
      const ws = known ?? focused
      const key = a.terminalId ?? a.sessionId ?? `${ws?.id ?? ''}:${a.agent ?? 'agent'}:${a.title ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      let rec = this.recs.get(key)
      let created = false
      if (!rec) {
        created = true
        rec = {
          key,
          terminalId: null,
          workspaceId: null,
          workspaceName: '',
          order: this.counter++,
          kind: '',
          title: '',
          task: '',
          raw: a.state,
          since: a.stateStartedAt,
          deskIndex: -1
        }
        this.recs.set(key, rec)
      }
      const changed = !created && rec.raw !== a.state
      rec.workspaceId = ws?.id ?? null
      rec.workspaceName = ws?.name ?? ''
      rec.terminalId = a.terminalId
      rec.kind = a.agent ?? 'agent'
      rec.title = a.title ?? ''
      rec.task = a.task?.title ?? ''
      rec.raw = a.state
      rec.since = a.stateStartedAt
      if (created || changed) {
        const what = activityFor(a.state, rec.task, this.outcomes.get(key))
        const label = (rec.workspaceName || rec.kind || 'agent').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim().slice(0, 9) || 'AGENT'
        pushActivity(this.activity, { t: a.stateStartedAt, label, text: what.text, color: STATUS_COLOR[what.status] })
      }
      if (a.state !== 'done') this.outcomes.delete(key)
    }
    for (const key of [...this.recs.keys()]) {
      if (!seen.has(key)) this.recs.delete(key)
    }
    this.assignDesks()
  }

  /**
   * Stable desks: an agent keeps its desk while it exists and the lowest free desk goes to newcomers.
   * When the office is full, an agent that is busy (working / waiting / blocked) takes the desk of
   * the agent that has been idle the longest, so the people doing something are always visible.
   */
  private assignDesks(): void {
    const used = new Set<number>()
    for (const r of this.recs.values()) if (r.deskIndex >= 0) used.add(r.deskIndex)
    const busy = (r: Rec): boolean => r.raw !== 'done'
    const waiting = [...this.recs.values()].filter((r) => r.deskIndex < 0).sort((a, b) => Number(busy(b)) - Number(busy(a)) || a.order - b.order)
    for (const r of waiting) {
      let desk = -1
      for (let i = 0; i < this.deskCount; i++) {
        if (!used.has(i)) {
          desk = i
          break
        }
      }
      if (desk < 0 && busy(r)) {
        const victim = [...this.recs.values()].filter((o) => o.deskIndex >= 0 && !busy(o)).sort((a, b) => a.since - b.since)[0]
        if (victim) {
          desk = victim.deskIndex
          victim.deskIndex = -1
        }
      }
      if (desk >= 0) {
        r.deskIndex = desk
        used.add(desk)
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
      // Named after the workspace the agent belongs to ("JACKIE"), else after the agent's kind.
      const label = r.workspaceName || r.kind || 'agent'
      const base = label.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'AGENT'
      const n = (seenNames.get(base) ?? 0) + 1
      seenNames.set(base, n)
      const name = (n > 1 ? `${base.slice(0, 7)} ${n}` : base).slice(0, 9)
      return {
        key: r.key,
        terminalId: r.terminalId,
        workspaceId: r.workspaceId,
        workspaceName: r.workspaceName,
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

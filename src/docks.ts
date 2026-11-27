// The three collapsible docks around the office: AGENTS (left), USAGE (right) and ACTIVITY (bottom).
// They only draw what main.ts hands them; nothing here talks to Orca.

import { drawCharacter, LOOKS, STATUS_COLOR } from './character'
import type { VisualStatus } from './character'
import type { ActivityItem } from './feed'
import { formatReset, formatTokens, kindLabel, providerName, windowLabel } from './usage'
import type { LimitsData, LimitsState, UsageData, UsageState } from './usage'

export interface AgentRow {
  id: string
  name: string
  kind: string
  status: VisualStatus
  statusLabel: string
  task: string
  lookId: number
  /** Has a character in the office to select. */
  selectable: boolean
  /** Reported by Orca but the office has no free desk for it. */
  deskless: boolean
}

export interface WorkspaceRow {
  id: string
  name: string
  branch: string | null
  agents: number
}

export interface DockHandlers {
  selectAgent(id: string): void
  openWorkspace(w: WorkspaceRow): void
  /** The user folded or unfolded a dock (main refreshes data polled only while visible, and re-fits the camera). */
  toggled(name: DockName, open: boolean): void
}

export type DockName = 'agents' | 'usage' | 'activity'

const STORE = 'pixelbase.dock.'

function stored(name: DockName): boolean | null {
  try {
    const v = localStorage.getItem(STORE + name)
    return v === null ? null : v === '1'
  } catch {
    return null // sandboxed frames may have no storage
  }
}

function remember(name: DockName, open: boolean): void {
  try {
    localStorage.setItem(STORE + name, open ? '1' : '0')
  } catch {
    // no storage: the choice just lasts until the panel is closed
  }
}

function html(parent: Element, tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  parent.appendChild(node)
  return node
}

function clock(t: number): string {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** "updated just now", "updated 5m ago" (minute resolution, so the card does not redraw every second). */
function ago(t: number, now: number): string {
  const mins = Math.floor((now - t) / 60000)
  if (mins < 1) return 'updated just now'
  if (mins < 60) return `updated ${mins}m ago`
  return `updated ${Math.floor(mins / 60)}h ago`
}

export class Docks {
  private readonly dock: Record<DockName, HTMLElement>
  private readonly count: Record<DockName, HTMLElement>
  private readonly keys: Record<DockName, string> = { agents: '', usage: '', activity: '' }

  constructor(
    private readonly handlers: DockHandlers,
    stageWidth: number
  ) {
    const names: DockName[] = ['agents', 'usage', 'activity']
    this.dock = {} as Record<DockName, HTMLElement>
    this.count = {} as Record<DockName, HTMLElement>
    // A narrow Orca sidebar starts with every dock folded to its header; a wide one with all open.
    const wide = stageWidth >= 860
    for (const name of names) {
      const root = document.getElementById(`dock-${name}`)
      const count = document.getElementById(`count-${name}`)
      const head = root?.querySelector<HTMLButtonElement>('.dock-head')
      if (!root || !count || !head) throw new Error(`missing dock ${name}`)
      this.dock[name] = root
      this.count[name] = count
      this.set(name, stored(name) ?? wide, false)
      head.addEventListener('click', () => this.set(name, root.classList.contains('collapsed'), true))
    }
  }

  isOpen(name: DockName): boolean {
    return !this.dock[name].classList.contains('collapsed')
  }

  private set(name: DockName, open: boolean, user: boolean): void {
    const root = this.dock[name]
    root.classList.toggle('collapsed', !open)
    root.querySelector('.dock-head')?.setAttribute('aria-expanded', String(open))
    if (user) {
      remember(name, open)
      this.handlers.toggled(name, open)
    }
  }

  // --- AGENTS --------------------------------------------------------------------------------

  renderAgents(rows: AgentRow[], selectedId: string | null, workspaces: WorkspaceRow[] | null, live: boolean): void {
    const noDesk = rows.filter((r) => r.deskless).length
    this.count.agents.textContent = rows.length === 0 ? '0' : noDesk ? `${rows.length} · ${noDesk} no desk` : String(rows.length)
    const key = JSON.stringify([rows.map((r) => [r.id, r.name, r.kind, r.status, r.task, r.lookId, r.selectable, r.deskless]), selectedId, workspaces, live])
    if (key === this.keys.agents) return
    this.keys.agents = key

    const list = document.getElementById('agentList') as HTMLElement
    list.replaceChildren()
    if (rows.length === 0) html(list, 'li', 'empty', live ? 'No agents running' : 'No agents')
    for (const r of rows) {
      const li = html(list, 'li')
      const btn = html(li, 'button', 'row') as HTMLButtonElement
      btn.type = 'button'
      if (r.id === selectedId) btn.classList.add('sel')
      btn.disabled = !r.selectable
      btn.title = r.deskless ? 'Orca reports this agent, but every desk is taken' : `Show ${r.name}`
      const art = html(btn, 'canvas', 'face') as HTMLCanvasElement
      art.width = 20
      art.height = 28
      const g = art.getContext('2d')
      if (g) drawCharacter(g, 10, 27, LOOKS[r.lookId % LOOKS.length], { pose: 'stand', view: 'front', flip: false, t: 0, mood: 'none', lift: 0 })
      const info = html(btn, 'span', 'info')
      const top = html(info, 'span', 'top')
      html(top, 'b', 'nm', r.name)
      if (r.kind) html(top, 'span', 'badge', kindLabel(r.kind))
      const st = html(info, 'span', 'st', r.statusLabel)
      st.style.setProperty('--dot', STATUS_COLOR[r.status])
      if (r.task) html(info, 'span', 'tk', r.task).title = r.task
      if (r.selectable) btn.addEventListener('click', () => this.handlers.selectAgent(r.id))
    }

    const block = document.getElementById('wsBlock') as HTMLElement
    const wl = document.getElementById('wsList') as HTMLElement
    wl.replaceChildren()
    block.hidden = !workspaces || workspaces.length === 0
    for (const w of workspaces ?? []) {
      const li = html(wl, 'li')
      const btn = html(li, 'button', 'ws') as HTMLButtonElement
      btn.type = 'button'
      btn.title = `Open ${w.name} in Orca`
      html(btn, 'span', 'wn', w.name)
      if (w.branch) html(btn, 'span', 'wb', w.branch).title = w.branch
      html(btn, 'span', 'wc', w.agents ? String(w.agents) : '')
      btn.addEventListener('click', () => this.handlers.openWorkspace(w))
    }
  }

  // --- USAGE ---------------------------------------------------------------------------------

  renderUsage(
    tokens: { data: UsageData | null; state: UsageState },
    limits: { data: LimitsData | null; state: LimitsState; reason: string },
    now: number
  ): void {
    const { data, state } = tokens
    const ok = (state === 'ok' || state === 'demo') && data
    // Header chip: the plan limits when Orca gave them (like Orca's own "5h 16% wk 18%"), else tokens.
    const first = limits.data?.providers[0]
    const planChip = first ? [first.session && `5h ${Math.round(first.session.usedPercent)}%`, first.weekly && `wk ${Math.round(first.weekly.usedPercent)}%`].filter(Boolean).join(' · ') : ''
    this.count.usage.textContent = planChip || (ok ? `${formatTokens(data.today)} tokens today` : state === 'loading' ? '…' : '—')
    this.count.usage.title = planChip ? 'Share of your plan limit used (5-hour and weekly windows)' : 'Tokens counted on this computer, not your plan limit'

    // What the plan-limit cards say right now (resets count down, so they are part of the cache key).
    const cards = (limits.data?.providers ?? []).map((p) => ({
      name: providerName(p.provider),
      plan: p.planType ? p.planType.charAt(0).toUpperCase() + p.planType.slice(1) : '',
      rows: ([p.session, p.weekly] as const).flatMap((w, i) =>
        w ? [{ label: windowLabel(w, i === 0 ? 'Session' : 'Weekly'), pct: Math.round(w.usedPercent), reset: formatReset(w.resetsAt, now) }] : []
      ),
      updated: p.updatedAt ? ago(p.updatedAt, now) : ''
    }))
    const key = JSON.stringify([state, data, limits.state, limits.reason, cards])
    if (key === this.keys.usage) return
    this.keys.usage = key

    const body = document.getElementById('usageBody') as HTMLElement
    body.replaceChildren()
    if (state === 'demo' || limits.state === 'demo') html(body, 'p', 'tag', 'DEMO · simulated numbers')

    // --- plan limits: the share of the plan used and when each window resets ---
    html(body, 'div', 'sub', 'PLAN LIMITS')
    if (limits.state === 'ok' || limits.state === 'demo') {
      if (cards.length === 0) html(body, 'p', 'note', 'Orca has no plan limits to show yet. Sign in to Claude or Codex in Orca.')
      for (const c of cards) {
        const card = html(body, 'div', 'plan')
        const head = html(card, 'div', 'ph')
        html(head, 'b', 'kn', c.name)
        if (c.plan) html(head, 'span', 'badge', c.plan)
        if (c.updated) html(head, 'span', 'kv', c.updated)
        for (const r of c.rows) {
          const row = html(card, 'div', 'lim')
          const line = html(row, 'div', 'lt')
          html(line, 'b', undefined, r.label)
          if (r.reset) html(line, 'span', 'rs', r.reset)
          html(line, 'span', 'lp', `${r.pct}% used`)
          const bar = html(row, 'div', 'bar')
          const fill = html(bar, 'i', r.pct >= 90 ? 'hot' : r.pct >= 70 ? 'warn' : 'good')
          fill.style.width = `${Math.max(2, r.pct)}%`
        }
      }
    } else {
      const msg: Record<string, string> = {
        loading: 'Reading plan limits…',
        cli_not_found: "Plan limits come from Orca's command-line tool (orca), which Pixel Base could not find on this computer.",
        cli_failed: "Orca's command-line tool did not answer, so plan limits are not available right now.",
        unreadable: "Orca's command-line tool gave an answer Pixel Base could not read.",
        error: 'Could not read plan limits right now.'
      }
      html(body, 'p', 'note', msg[limits.state === 'loading' || limits.state === 'error' ? limits.state : limits.reason] ?? msg.error)
    }

    // --- tokens used on this computer (not a quota) ---
    html(body, 'div', 'sub', 'TOKENS USED ON THIS COMPUTER')
    if (!ok) {
      const msg: Record<Exclude<UsageState, 'ok' | 'demo'>, string> = {
        loading: 'Reading token history…',
        denied: 'Token history needs the history:read permission. Approve it in Orca, then reload the plugin.',
        unavailable: 'This Orca cannot read token history here (it needs a newer Orca, or the Pixel Base worker is not running).',
        error: 'Could not read token history right now.'
      }
      html(body, 'p', 'note', msg[state as keyof typeof msg])
      return
    }

    const totals = html(body, 'div', 'totals')
    for (const [label, value] of [
      ['USED TODAY', data.today],
      ['USED · 7 DAYS', data.week]
    ] as const) {
      const cell = html(totals, 'div', 'total')
      html(cell, 'span', 'lbl', label)
      html(cell, 'span', 'big', formatTokens(value))
      html(cell, 'span', 'unit', 'tokens')
    }
    if (data.kinds.length === 0) html(body, 'p', 'note', 'No agent sessions in the last 7 days.')
    const max = Math.max(1, ...data.kinds.map((k) => k.week))
    for (const k of data.kinds) {
      const row = html(body, 'div', 'kind')
      const head = html(row, 'div', 'kh')
      html(head, 'b', 'kn', kindLabel(k.agent))
      if (k.running) html(head, 'span', 'run', `${k.running} running`)
      html(head, 'span', 'kv', `${formatTokens(k.today)} today · ${formatTokens(k.week)} / 7d`)
      const bar = html(row, 'div', 'bar')
      const fill = html(bar, 'i')
      fill.style.width = `${Math.max(2, Math.round((k.week / max) * 100))}%`
    }
    const foot = data.partial ? 'Partial: Orca returned only the newest sessions. ' : ''
    html(
      body,
      'p',
      'note',
      `${foot}${data.sessions} session${data.sessions === 1 ? '' : 's'}, counted in the period they were last active. This is a count of tokens, not a share of your plan.`
    )
  }

  // --- ACTIVITY ------------------------------------------------------------------------------

  renderActivity(items: ActivityItem[], live: boolean): void {
    this.count.activity.textContent = String(items.length)
    const key = JSON.stringify(items)
    if (key === this.keys.activity) return
    this.keys.activity = key
    const list = document.getElementById('actList') as HTMLElement
    list.replaceChildren()
    if (items.length === 0) html(list, 'li', 'empty', live ? 'Nothing yet' : 'Nothing yet')
    for (const it of items) {
      const li = html(list, 'li', 'act')
      html(li, 'span', 'at', clock(it.t))
      const line = html(li, 'span', 'al')
      line.style.setProperty('--dot', it.color)
      html(line, 'b', undefined, it.label)
      line.appendChild(document.createTextNode(` ${it.text}`))
      line.title = `${it.label} ${it.text}`
    }
  }
}

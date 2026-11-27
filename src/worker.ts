// Pixel Base's own worker (Phase 5: agent actions).
//
// Orca only lets a *worker* call `terminal.focus` and `workspace.open`, so the panel asks this file
// with `plugin.request(name, input)`. Orca transpiles it as it loads: no build step, and it is
// kept self-contained on purpose (local types, no imports).
//
// Safety rules (from the Pixel Base plan):
//  - Every action goes through Orca's host API; nothing clicks, types or sends terminal input.
//  - Only the two view-only actions below plus two read-only lists (workspaces, token usage) exist.
//    Nothing here starts, stops or writes to an agent.
//  - Inputs are validated; failures are thrown with a host error code so the panel can explain them.

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

interface WorkerHost {
  call(method: string, params?: unknown): Promise<unknown>
}

interface WorkerApi {
  host: WorkerHost
  panels: { handle(name: string, handler: (input: Json | undefined) => unknown): unknown }
  log(message: string): void
}

interface CodedError extends Error {
  code?: string
}

function fail(code: string, message: string): never {
  const error = new Error(message) as CodedError
  error.code = code
  throw error
}

function text(input: Json | undefined, key: string): string {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const v = input[key]
    if (typeof v === 'string') return v
  }
  return ''
}

export default function activate(orca: WorkerApi): void {
  // List the workspaces (including bot folders) so the panel can read each one's agents.
  // `workspace.list` is worker-only. Only what the panel needs is returned: no paths.
  orca.panels.handle('pixel.listWorkspaces', async () => {
    const list = (await orca.host.call('workspace.list', {})) as {
      workspaces: Array<{ id: string; name: string; kind: string; branch: string | null; project?: string | null }>
    }
    return {
      workspaces: list.workspaces.slice(0, 40).map((w) => ({ id: w.id, name: w.name, kind: w.kind, branch: w.branch, project: w.project ?? null }))
    }
  })

  // Tokens used, from Orca's Agent Session History (`agent.listSessions`, worker-only, needs
  // history:read). Only sums leave this worker: no titles, no workspaces, no paths. A session's
  // whole token count is counted in the period of its last activity, and Orca does not expose
  // plan limits, remaining quota or reset times, so none of those are reported.
  orca.panels.handle('pixel.usage', async () => {
    type Session = { agent: string | null; updatedAt: number; totalTokens: number; running: boolean }
    // 200 is the most Orca returns per call (a bigger limit is refused as invalid_params).
    const res = (await orca.host.call('agent.listSessions', { limit: 200 })) as { sessions: Session[]; truncated: boolean }
    const now = Date.now()
    const midnight = new Date(now)
    midnight.setHours(0, 0, 0, 0)
    const startOfToday = midnight.getTime()
    const weekAgo = now - 7 * 24 * 3600 * 1000
    const kinds = new Map<string, { agent: string; today: number; week: number; sessions: number; running: number }>()
    let today = 0
    let week = 0
    let sessions = 0
    let oldest = now
    for (const s of res.sessions) {
      // Orca reports epoch milliseconds; tolerate seconds.
      const at = s.updatedAt < 1e11 ? s.updatedAt * 1000 : s.updatedAt
      oldest = Math.min(oldest, at)
      const inToday = s.running || at >= startOfToday
      const inWeek = inToday || at >= weekAgo
      if (!inWeek) continue
      const tokens = Number.isFinite(s.totalTokens) && s.totalTokens > 0 ? s.totalTokens : 0
      const name = (s.agent ?? '').trim().toLowerCase() || 'agent'
      const k = kinds.get(name) ?? { agent: name, today: 0, week: 0, sessions: 0, running: 0 }
      k.week += tokens
      k.sessions += 1
      week += tokens
      sessions += 1
      if (inToday) {
        k.today += tokens
        today += tokens
      }
      if (s.running) k.running += 1
      kinds.set(name, k)
    }
    return {
      today,
      week,
      sessions,
      kinds: [...kinds.values()].sort((a, b) => b.week - a.week).slice(0, 8),
      // Sessions come newest first: if the list was cut inside the 7-day window the sums are incomplete.
      partial: res.truncated && oldest >= weekAgo,
      at: now
    }
  })

  // Show the terminal an agent runs in (also brings its workspace forward).
  orca.panels.handle('pixel.focusTerminal', async (input) => {
    const terminalId = text(input, 'terminalId')
    if (!terminalId) fail('invalid_params', 'terminalId is required')
    const res = (await orca.host.call('terminal.focus', { terminalId })) as { focused: boolean }
    orca.log(`focus terminal ${terminalId}: ${res.focused ? 'ok' : 'not moved'}`)
    return { focused: res.focused }
  })

  // Show a workspace, as clicking it in the sidebar does. The panel passes the id Orca gave for
  // the focused workspace; if Orca does not know that id for `workspace.open`, fall back to
  // matching the workspace list by name/branch rather than guessing.
  orca.panels.handle('pixel.openWorkspace', async (input) => {
    const workspaceId = text(input, 'workspaceId')
    const name = text(input, 'name')
    const branch = text(input, 'branch')
    if (!workspaceId && !name) fail('invalid_params', 'workspaceId or name is required')

    if (workspaceId) {
      try {
        await orca.host.call('workspace.open', { workspaceId })
        return { opened: true }
      } catch (error) {
        const code = (error as CodedError).code
        if (code !== 'invalid_params' && code !== 'action_failed') throw error
      }
    }
    const list = (await orca.host.call('workspace.list', {})) as {
      workspaces: Array<{ id: string; name: string; branch: string | null }>
    }
    const match = list.workspaces.find((w) => w.id === workspaceId) ?? list.workspaces.find((w) => w.name === name && (!branch || w.branch === branch))
    if (!match) fail('action_failed', 'Orca could not find that workspace')
    await orca.host.call('workspace.open', { workspaceId: match.id })
    return { opened: true }
  })
}

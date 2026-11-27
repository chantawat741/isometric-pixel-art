// Pixel Base's own worker (Phase 5: agent actions).
//
// Orca only lets a *worker* call `terminal.focus` and `workspace.open`, so the panel asks this file
// with `plugin.request(name, input)`. Orca transpiles it as it loads: no build step, and it is
// kept self-contained on purpose (local types, only Node built-ins as imports).
//
// Safety rules (from the Pixel Base plan):
//  - Every action goes through Orca's host API; nothing clicks, types or sends terminal input.
//  - Only the two view-only actions below plus four read-only lists (workspaces, token usage, plan
//    limits, what each agent's last run did) exist. Nothing here starts, stops or writes to an agent.
//  - Plan limits come from Orca's own command-line tool (`orca account list --json`): no network
//    request, no credentials read by this plugin. Its output also lists account emails, which are
//    dropped here: only percentages, reset times and the plan name leave this file.
//  - Inputs are validated; failures are thrown with a host error code so the panel can explain them.

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

interface WorkerHost {
  call(method: string, params?: unknown): Promise<unknown>
}

interface WorkerApi {
  host: WorkerHost
  panels: { handle(name: string, handler: (input: Json | undefined) => unknown): unknown }
  hooks: { on(hook: string, handler: (event: unknown) => unknown): unknown }
  events: { on(event: string, handler: (payload: unknown) => void): unknown }
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

interface LimitWindow {
  usedPercent: number
  windowMinutes: number
  resetsAt: number
}

interface ProviderLimits {
  provider: string
  planType: string
  session: LimitWindow | null
  weekly: LimitWindow | null
  updatedAt: number
}

/** Where Orca's command-line tool lives, best guess first; the bare name relies on PATH. */
function orcaCliCandidates(): string[] {
  const win = process.platform === 'win32'
  const exe = win ? 'orca.exe' : 'orca'
  const here = dirname(process.execPath)
  const guesses = [join(here, 'resources', 'bin', exe), join(here, '..', 'Resources', 'bin', exe)]
  if (win && process.env.LOCALAPPDATA) guesses.push(join(process.env.LOCALAPPDATA, 'Programs', 'orca', 'resources', 'bin', exe))
  return [...guesses.filter((p) => existsSync(p)), exe]
}

/**
 * The environment for Orca's CLI. Orca keeps APPDATA out of a worker's environment on Windows, but the CLI
 * needs it to find the file that says where the running Orca listens (the same file it reads from a terminal).
 */
function cliEnv(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...process.env }
  if (process.platform === 'win32' && !env.APPDATA) {
    if (env.LOCALAPPDATA) env.APPDATA = join(env.LOCALAPPDATA, '..', 'Roaming')
    else if (env.USERPROFILE) env.APPDATA = join(env.USERPROFILE, 'AppData', 'Roaming')
  }
  return env
}

/** Runs Orca's CLI (replaceable in tests). Fixed arguments, no shell, a timeout, a size cap. */
export const cli = {
  async run(args: string[]): Promise<string> {
    let lastError: unknown = null
    for (const bin of orcaCliCandidates()) {
      try {
        return await new Promise<string>((resolve, reject) => {
          execFile(bin, args, { timeout: 8000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: cliEnv() }, (error, stdout) => {
            if (!error) return resolve(String(stdout))
            // With --json the CLI explains a failure on stdout as {error:{code,message}}; keep that for the log.
            ;(error as CodedError & { detail?: string }).detail = String(stdout ?? '').slice(0, 4000)
            reject(error)
          })
        })
      } catch (error) {
        lastError = error
        if ((error as CodedError).code !== 'ENOENT') break // found it but it failed: do not try another copy
      }
    }
    throw lastError ?? new Error('orca CLI not found')
  }
}

function windowOf(v: unknown): LimitWindow | null {
  if (!v || typeof v !== 'object') return null
  const w = v as { usedPercent?: unknown; windowMinutes?: unknown; resetsAt?: unknown }
  if (typeof w.usedPercent !== 'number' || !Number.isFinite(w.usedPercent)) return null
  const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : 0)
  return { usedPercent: Math.max(0, Math.min(100, w.usedPercent)), windowMinutes: finite(w.windowMinutes), resetsAt: finite(w.resetsAt) }
}

/** Keeps only the numbers the panel shows, for providers Orca could read (never emails or account ids). */
export function limitsFrom(parsed: unknown): ProviderLimits[] | null {
  const rl = (parsed as { result?: { rateLimits?: Record<string, unknown> } } | null)?.result?.rateLimits
  if (!rl || typeof rl !== 'object') return null
  const out: ProviderLimits[] = []
  for (const [key, value] of Object.entries(rl)) {
    if (!value || typeof value !== 'object') continue
    const p = value as { status?: unknown; session?: unknown; weekly?: unknown; planType?: unknown; updatedAt?: unknown }
    if (p.status !== 'ok') continue
    const session = windowOf(p.session)
    const weekly = windowOf(p.weekly)
    if (!session && !weekly) continue
    out.push({
      provider: key,
      planType: typeof p.planType === 'string' ? p.planType.slice(0, 24) : '',
      session,
      weekly,
      updatedAt: typeof p.updatedAt === 'number' && Number.isFinite(p.updatedAt) ? p.updatedAt : 0
    })
  }
  const rank = (name: string): number => (name === 'claude' ? 0 : name === 'codex' ? 1 : 2)
  return out.sort((a, b) => rank(a.provider) - rank(b.provider) || a.provider.localeCompare(b.provider)).slice(0, 4)
}

// --- runs: what an agent did between starting work and finishing ----------------------------------
//
// Fed by Orca's `agent.tool.after` hook (only agents running in an Orca terminal are hooked) and the
// `agent.status.changed` event (all agents). It keeps counts and one pass/fail flag per agent run and
// nothing else: file paths are reduced to a hash to count distinct files, and no command, output or
// path is stored, logged or sent to the panel.

export type TestResult = 'pass' | 'fail' | null

/** Commands that run a test suite. Anything else never produces a test result. */
const TEST_COMMAND =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:vitest|jest|mocha|pytest|phpunit|rspec)\b|\bpython\d?\s+-m\s+(?:pytest|unittest)\b|\bcargo\s+test\b|\bgo\s+test\b|\bdotnet\s+test\b|\bnode\s+--test\b|\bplugin\s+test\b/i

/**
 * Reads a test runner's own summary line (Node's TAP, Jest/Vitest, pytest, cargo, go, dotnet).
 * Returns null unless the command is a test run AND a known summary line is present: Orca's hook gives
 * no exit code, and scanning for words like "fail" is not reliable, so an unknown format means "unknown".
 */
export function testResult(command: string, stdout: string): TestResult {
  if (!TEST_COMMAND.test(command)) return null
  const out = stdout.replace(/\u001b\[[0-9;]*m/g, '').slice(-60000) // colour codes off; summaries come last
  let pass = false
  let fail = false
  const tapPass = /^# pass (\d+)/m.exec(out)
  const tapFail = /^# fail (\d+)/m.exec(out)
  if (tapPass || tapFail) {
    if (tapFail && Number(tapFail[1]) > 0) fail = true
    else if (tapPass && Number(tapPass[1]) > 0) pass = true
  }
  const js = /^\s*Tests:?\s+(.*)$/m.exec(out) // Jest "Tests:  1 failed, 13 passed" / Vitest "Tests  1 failed | 13 passed"
  if (js) {
    if (/\b[1-9]\d* failed\b/.test(js[1])) fail = true
    else if (/\b[1-9]\d* passed\b/.test(js[1])) pass = true
  }
  if (/\b[1-9]\d* (?:failed|errors?)\b[^\n]* in [\d.]+s/.test(out)) fail = true // pytest
  else if (/\b[1-9]\d* passed\b[^\n]* in [\d.]+s/.test(out)) pass = true
  for (const m of out.matchAll(/^test result: (ok|FAILED)\./gm)) {
    if (m[1] === 'FAILED') fail = true
    else pass = true
  } // cargo
  if (/^(?:FAIL\b|--- FAIL)/m.test(out)) fail = true // go
  else if (/^ok\s+\S+/m.test(out)) pass = true
  const dn = /^(Passed|Failed)!\s+-\s+Failed:\s+(\d+),\s+Passed:\s+(\d+)/m.exec(out) // dotnet
  if (dn) {
    if (dn[1] === 'Failed' || Number(dn[2]) > 0) fail = true
    else if (Number(dn[3]) > 0) pass = true
  }
  return fail ? 'fail' : pass ? 'pass' : null
}

function fnv(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16)
}

function pathOf(v: unknown): string {
  let p: unknown = v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    p = o.path ?? o.filePath ?? o.file_path ?? o.file ?? o.name
  }
  return typeof p === 'string' ? p.replace(/\\/g, '/').toLowerCase() : ''
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Claude Code's file-writing and file-reading tools (the names Orca's hook reports for it). */
const EDIT_TOOLS = new Set(['edit', 'write', 'multiedit', 'notebookedit'])
const READ_TOOLS = new Set(['read', 'notebookread'])
const SHELL_TOOLS = new Set(['bash', 'powershell'])

interface RunState {
  edited: Set<string>
  read: Set<string>
  tools: number
  test: TestResult
  /** Epoch ms the run began (0 when only its end was seen) and ended (0 while it is still going). */
  startedAt: number
  doneAt: number
  touchedAt: number
  outcome: string
}

export interface RunSummary {
  key: string
  files: number
  reads: number
  tools: number
  test: TestResult
  startedAt: number
  doneAt: number
  outcome: string
}

const RUN_KEEP_MS = 20 * 60 * 1000
const RUN_MAX = 60

export class RunTracker {
  private readonly runs = new Map<string, RunState>()

  private blank(now: number, startedAt: number): RunState {
    return { edited: new Set(), read: new Set(), tools: 0, test: null, startedAt, doneAt: 0, touchedAt: now, outcome: '' }
  }

  /** The agent's running run; a finished one is replaced (its agent started working again). */
  private begin(key: string, now: number): RunState {
    const old = this.runs.get(key)
    if (old && old.doneAt === 0) return old
    const run = this.blank(now, now)
    this.runs.delete(key)
    this.runs.set(key, run)
    if (this.runs.size > RUN_MAX) this.runs.delete(this.runs.keys().next().value as string)
    return run
  }

  /** One finished tool call (`agent.tool.after`). */
  tool(key: string, tool: string, input: unknown, output: unknown, callId: string, now: number): void {
    const run = this.begin(key, now)
    run.tools += 1
    run.touchedAt = now
    const name = tool.toLowerCase()
    const inp = asRecord(input)
    const out = asRecord(output)
    if (EDIT_TOOLS.has(name)) {
      const p = pathOf(inp.file_path ?? inp.notebook_path ?? inp.path ?? inp.filePath)
      if (p) run.edited.add(fnv(p))
    } else if (READ_TOOLS.has(name)) {
      const p = pathOf(inp.file_path ?? inp.notebook_path ?? inp.path ?? inp.filePath)
      if (p) run.read.add(fnv(p))
    }
    // Orca itself lists the files a shell command changed (e.g. sed, a formatter) in `bashEditDiff`.
    const diff = asRecord(out.bashEditDiff)
    const changed = Array.isArray(diff.changedFiles) ? diff.changedFiles : Array.isArray(diff.files) ? diff.files : []
    changed.slice(0, 200).forEach((f) => {
      // A path when Orca gives one; otherwise the entry's own content, so the same file is not counted twice.
      const p = pathOf(f)
      let same = p
      if (!same) {
        try {
          same = JSON.stringify(f) ?? ''
        } catch {
          same = ''
        }
      }
      run.edited.add(same ? fnv(same) : `${callId || run.tools}:${run.edited.size}`)
    })
    const more = typeof diff.moreFiles === 'number' && diff.moreFiles > 0 ? Math.min(diff.moreFiles, 1000) : 0
    for (let i = 0; i < more; i++) run.edited.add(`${callId || run.tools}:more:${i}`)
    // Claude Code's shell tools answer with `stdout`, `stderr` and `interrupted` (checked on a real run).
    if (SHELL_TOOLS.has(name) && typeof inp.command === 'string' && typeof out.stdout === 'string' && out.interrupted !== true) {
      const t = testResult(inp.command, out.stdout)
      if (t) run.test = t // the last test run of the run is the one that counts
    }
  }

  /** An agent's state changed (`agent.status.changed`). */
  status(key: string, state: string, outcome: string, now: number): void {
    if (state === 'working') {
      this.begin(key, now)
    } else if (state === 'done') {
      let run = this.runs.get(key)
      if (!run) {
        run = this.blank(now, 0) // only the end was seen: no start time, no counts
        this.runs.set(key, run)
      }
      if (run.doneAt === 0) {
        run.doneAt = now
        run.touchedAt = now
        run.outcome = outcome
      }
    }
  }

  snapshot(now: number): RunSummary[] {
    for (const [key, run] of this.runs) if (now - run.touchedAt > RUN_KEEP_MS) this.runs.delete(key)
    return [...this.runs.entries()].slice(-40).map(([key, r]) => ({
      key,
      files: r.edited.size,
      reads: r.read.size,
      tools: r.tools,
      test: r.test,
      startedAt: r.startedAt,
      doneAt: r.doneAt,
      outcome: r.outcome
    }))
  }
}

export default function activate(orca: WorkerApi): void {
  const tracker = new RunTracker()

  // Every finished tool call of an agent running in an Orca terminal. Observe only; it never throws.
  orca.hooks.on('agent.tool.after', (event) => {
    try {
      const e = asRecord(event)
      if (typeof e.terminalId !== 'string' || !e.terminalId) return
      tracker.tool(e.terminalId, String(e.tool ?? ''), e.input, e.output, typeof e.callId === 'string' ? e.callId : '', Date.now())
    } catch {
      // a surprise in the payload must never disturb the agent
    }
  })

  // Start and end of each agent run (all agents, chats included).
  orca.events.on('agent.status.changed', (payload) => {
    try {
      const e = asRecord(payload)
      const key = typeof e.terminalId === 'string' && e.terminalId ? e.terminalId : typeof e.sessionId === 'string' ? e.sessionId : ''
      if (!key) return
      const main = asRecord(e.mainAgent)
      const state = typeof main.state === 'string' ? main.state : String(e.state ?? '')
      tracker.status(key, state, typeof main.outcome === 'string' ? main.outcome : '', Date.now())
    } catch {
      // ignore
    }
  })

  // What each agent's latest run did, for the message above its character. Counts only.
  orca.panels.handle('pixel.runs', () => ({ runs: tracker.snapshot(Date.now()), now: Date.now() }))

  // Plan limits (percent used and reset time of the 5-hour and weekly windows), as Orca's own
  // Usage panel shows them. Reported in-band as `available: false` + a reason when they cannot be read.
  orca.panels.handle('pixel.limits', async () => {
    let raw: string
    try {
      raw = await cli.run(['account', 'list', '--json'])
    } catch (error) {
      // Log why, never what: the CLI's own error code and message, and nothing from a successful answer.
      let why = String((error as Error).message ?? error).split('\n')[0].slice(0, 160)
      try {
        const e = (JSON.parse((error as { detail?: string }).detail ?? '') as { error?: { code?: unknown; message?: unknown } }).error
        if (e && typeof e.message === 'string') why = `${typeof e.code === 'string' ? e.code : 'error'}: ${e.message.slice(0, 200)}`
      } catch {
        // not JSON: keep the first line above
      }
      orca.log(`limits: ${why}`)
      return { available: false, reason: (error as CodedError).code === 'ENOENT' ? 'cli_not_found' : 'cli_failed' }
    }
    let providers: ProviderLimits[] | null = null
    try {
      providers = limitsFrom(JSON.parse(raw))
    } catch {
      providers = null
    }
    if (providers === null) return { available: false, reason: 'unreadable' }
    return { available: true, providers, at: Date.now() }
  })

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

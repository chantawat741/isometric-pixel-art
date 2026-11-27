// Run with `orca plugin test .` (Node, over a mock Orca host). Not part of the panel bundle.
import { assert, hostError, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const CAPS = ['workspace:read', 'agent:read', 'workspace:write', 'history:read']

const HOUR = 3600 * 1000
const DAY = 24 * HOUR

/** A session row shaped like Orca's `agent.listSessions` answer. */
function session(id: string, agent: string, ageMs: number, totalTokens: number, running = false) {
  return {
    sessionId: id,
    agent,
    title: 'Secret first message that must never leave the worker',
    workspaceId: 'w1',
    hostId: 'local',
    branch: null,
    createdAt: Date.now() - ageMs - HOUR,
    updatedAt: Date.now() - ageMs,
    messageCount: 4,
    totalTokens,
    running
  }
}

/** A workspace row shaped like Orca's `workspace.list` answer. */
function row(id: string, name: string, branch: string | null) {
  return { id, kind: 'worktree' as const, name, project: null, projectId: null, path: `D:\\work\\${name}`, branch, hostId: 'local' }
}

async function rejection(promise: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await promise
  } catch (error) {
    return error as { code?: string; message: string }
  }
  throw new Error('expected a rejection')
}

test('list workspaces returns ids and names only (no paths)', async () => {
  const host = mockHost({
    capabilities: CAPS,
    results: { 'workspace.list': () => ({ workspaces: [row('w1', 'Jackie', null), row('w2', 'ECustom', 'main')], truncated: false }) }
  })
  const worker = await mountWorker(main, { host })
  const out = (await worker.request('pixel.listWorkspaces')) as { workspaces: Array<Record<string, unknown>> }
  assert.deepEqual(
    out.workspaces.map((w) => w.name),
    ['Jackie', 'ECustom']
  )
  assert.equal(out.workspaces.some((w) => 'path' in w), false)
  await worker.deactivate()
})

test('usage sums tokens per agent for today and the last 7 days, and drops everything else', async () => {
  const host = mockHost({
    capabilities: CAPS,
    results: {
      'agent.listSessions': () => ({
        sessions: [
          session('a', 'claude', 0.01 * HOUR, 1000), // just now: today
          session('b', 'claude', 3 * DAY, 4000), // this week, not today
          session('c', 'codex', 0.02 * HOUR, 500),
          session('d', 'claude', 20 * DAY, 99999), // too old
          session('e', 'codex', 5 * DAY, 250, true) // old but still running: counts as today
        ],
        truncated: false
      })
    }
  })
  const worker = await mountWorker(main, { host })
  const out = (await worker.request('pixel.usage')) as {
    today: number
    week: number
    sessions: number
    partial: boolean
    kinds: Array<{ agent: string; today: number; week: number; sessions: number; running: number }>
  }
  assert.equal(out.today, 1000 + 500 + 250)
  assert.equal(out.week, 1000 + 4000 + 500 + 250)
  assert.equal(out.sessions, 4)
  assert.equal(out.partial, false)
  assert.deepEqual(out.kinds, [
    { agent: 'claude', today: 1000, week: 5000, sessions: 2, running: 0 },
    { agent: 'codex', today: 750, week: 750, sessions: 2, running: 1 }
  ])
  assert.equal(JSON.stringify(out).includes('Secret'), false)
  assert.deepEqual(host.callsOf('agent.listSessions'), [{ limit: 200 }])
  await worker.deactivate()
})

test('usage says when the session list was cut inside the 7-day window', async () => {
  const host = mockHost({
    capabilities: CAPS,
    results: { 'agent.listSessions': () => ({ sessions: [session('a', 'claude', HOUR, 10), session('b', 'claude', 2 * DAY, 10)], truncated: true }) }
  })
  const worker = await mountWorker(main, { host })
  assert.equal(((await worker.request('pixel.usage')) as { partial: boolean }).partial, true)
  await worker.deactivate()
})

test('usage is refused without the history:read capability', async () => {
  const host = mockHost({ capabilities: ['workspace:read', 'agent:read', 'workspace:write'], results: { 'agent.listSessions': () => ({ sessions: [], truncated: false }) } })
  const worker = await mountWorker(main, { host })
  const error = await rejection(worker.request('pixel.usage'))
  assert.equal(error.code, 'capability_denied')
  await worker.deactivate()
})

// --- runs: files changed, tests, start and end of an agent's work ---------------------------------

test('test results come only from a test command and a known summary line', () => {
  const node = '# tests 14\n# pass 14\n# fail 0\n'
  assert.equal(main.testResult('npm test', node), 'pass')
  assert.equal(main.testResult('"C:\\x\\orca.exe" plugin test .', node), 'pass')
  assert.equal(main.testResult('npm test', '# pass 11\n# fail 3\n'), 'fail')
  assert.equal(main.testResult('npx vitest run', ' Tests  1 failed | 13 passed (14)\n'), 'fail')
  assert.equal(main.testResult('npx jest', 'Tests:       14 passed, 14 total\n'), 'pass')
  assert.equal(main.testResult('pytest -q', '2 failed, 12 passed in 1.20s\n'), 'fail')
  assert.equal(main.testResult('python -m pytest', '14 passed in 0.52s\n'), 'pass')
  assert.equal(main.testResult('cargo test', 'test result: ok. 14 passed; 0 failed;\n'), 'pass')
  assert.equal(main.testResult('cargo test', 'test result: FAILED. 1 passed; 1 failed;\n'), 'fail')
  assert.equal(main.testResult('go test ./...', 'ok  \texample.com/x\t0.2s\n'), 'pass')
  assert.equal(main.testResult('go test ./...', '--- FAIL: TestX (0.00s)\nFAIL\n'), 'fail')
  assert.equal(main.testResult('dotnet test', 'Passed!  - Failed:     0, Passed:    14, Skipped:     0\n'), 'pass')
  // colour codes do not hide the summary
  assert.equal(main.testResult('npm test', '\u001b[32m# pass 3\u001b[0m\n# fail 0\n'), 'pass')
  // never guessed: not a test command, an unknown format, or a file that merely mentions the words
  assert.equal(main.testResult('cat results.txt', node), null)
  assert.equal(main.testResult('npm run typecheck', '# pass 14\n# fail 0\n'), null)
  assert.equal(main.testResult('npm test', 'everything looked fine, tests pass\n'), null)
  assert.equal(main.testResult('npm test', 'Error: something failed to start\n'), null)
})

test('a run counts distinct files, reads, shell edits and the last test result, and starts afresh', () => {
  const t = new main.RunTracker()
  t.status('t1', 'working', '', 1000)
  t.tool('t1', 'Edit', { file_path: 'D:\\x\\a.ts' }, {}, 'c1', 1100)
  t.tool('t1', 'Edit', { file_path: 'd:/x/A.ts' }, {}, 'c2', 1200) // the same file again
  t.tool('t1', 'Write', { file_path: 'D:\\x\\b.ts' }, {}, 'c3', 1300)
  t.tool('t1', 'Read', { file_path: 'D:\\x\\c.ts' }, {}, 'c4', 1400)
  t.tool('t1', 'Bash', { command: 'sed -i s/a/b/ d.ts e.ts' }, { stdout: '', bashEditDiff: { files: [], moreFiles: 0, changedFiles: ['D:\\x\\d.ts', 'D:\\x\\e.ts'] } }, 'c5', 1500)
  t.tool('t1', 'Bash', { command: 'npm test' }, { stdout: '# pass 3\n# fail 1\n', interrupted: false }, 'c6', 1600)
  t.tool('t1', 'Bash', { command: 'npm test' }, { stdout: '# pass 4\n# fail 0\n', interrupted: false }, 'c7', 1700)
  t.status('t1', 'done', 'success', 2000)
  assert.deepEqual(t.snapshot(2100), [{ key: 't1', files: 4, reads: 1, tools: 7, test: 'pass', startedAt: 1000, doneAt: 2000, outcome: 'success' }])
  // the agent starts working again: a new run, nothing carried over
  t.status('t1', 'working', '', 3000)
  const next = t.snapshot(3100)[0]
  assert.deepEqual([next.files, next.test, next.startedAt, next.doneAt], [0, null, 3000, 0])
})

test("Claude Code's PowerShell tool is read like its Bash tool, and other tools never give a test result", () => {
  const t = new main.RunTracker()
  t.status('t1', 'working', '', 1000)
  t.tool('t1', 'PowerShell', { command: 'node --test sample.test.js' }, { stdout: 'ok 1 - adds\n# tests 1\n# pass 1\n# fail 0\n', stderr: '', interrupted: false, isImage: false }, 'c1', 1100)
  assert.equal(t.snapshot(1200)[0].test, 'pass')
  t.tool('t1', 'Write', { file_path: 'x.js', content: '# pass 1\n# fail 9\n' }, { stdout: '# fail 9\n' }, 'c2', 1300) // not a shell tool
  assert.equal(t.snapshot(1400)[0].test, 'pass')
})

test('waiting or blocked does not split a run, and an interrupted test run is ignored', () => {
  const t = new main.RunTracker()
  t.status('t1', 'working', '', 1000)
  t.tool('t1', 'Edit', { file_path: 'a.ts' }, {}, 'c1', 1100)
  t.status('t1', 'waiting', '', 1200)
  t.status('t1', 'working', '', 1300)
  t.tool('t1', 'Bash', { command: 'npm test' }, { stdout: '# pass 1\n# fail 0\n', interrupted: true }, 'c2', 1400)
  const run = t.snapshot(1500)[0]
  assert.deepEqual([run.files, run.test, run.startedAt, run.doneAt], [1, null, 1000, 0])
})

test('an agent seen only finishing has no start time and no counts; shell edits without paths still count', () => {
  const t = new main.RunTracker()
  t.status('chat-1', 'done', 'success', 5000)
  assert.deepEqual(t.snapshot(5100), [{ key: 'chat-1', files: 0, reads: 0, tools: 0, test: null, startedAt: 0, doneAt: 5000, outcome: 'success' }])
  t.status('t2', 'working', '', 6000)
  t.tool('t2', 'Bash', { command: 'prettier -w .' }, { stdout: '', bashEditDiff: { files: [{ weird: 1 }], moreFiles: 2, changedFiles: [{ weird: 1 }] } }, 'c9', 6100)
  assert.equal(t.snapshot(6200).find((r) => r.key === 't2')?.files, 3)
})

test('a shell edit entry without a path is not counted twice when it repeats', () => {
  const t = new main.RunTracker()
  t.status('t1', 'working', '', 1000)
  const diff = { files: [], moreFiles: 0, changedFiles: [{ weird: 1 }, { weird: 2 }] }
  t.tool('t1', 'Bash', { command: 'prettier -w .' }, { stdout: '', bashEditDiff: diff }, 'c1', 1100)
  t.tool('t1', 'Bash', { command: 'prettier -w .' }, { stdout: '', bashEditDiff: diff }, 'c2', 1200) // the same two files again
  assert.equal(t.snapshot(1300)[0].files, 2)
  t.tool('t1', 'Bash', { command: 'prettier -w .' }, { stdout: '', bashEditDiff: { changedFiles: [{ weird: 3 }] } }, 'c3', 1400)
  assert.equal(t.snapshot(1500)[0].files, 3)
})

test('the worker turns hook calls and status events into runs for the panel, and keeps no paths or commands', async () => {
  const host = mockHost({ capabilities: CAPS })
  const worker = await mountWorker(main, { host })
  const base = { workspaceId: null, paneKey: 'pane-1', terminalId: 'term-1', receivedAt: Date.now() }
  await worker.emit('agent.status.changed', { ...base, state: 'working', mainAgent: { state: 'working', stateStartedAt: Date.now() } })
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, terminalId: 'term-1', tool: 'Edit', input: { file_path: 'D:\\secret\\plans.ts' }, callId: 'c1' })
  await worker.hooks.fire('agent.tool.after', {
    agent: 'claude',
    workspaceId: null,
    terminalId: 'term-1',
    tool: 'Bash',
    input: { command: 'npm test' },
    callId: 'c2',
    output: { stdout: '# pass 5\n# fail 0\n', stderr: '', interrupted: false }
  })
  // a tool call with no terminal (a chat agent) is ignored
  await worker.hooks.fire('agent.tool.after', { agent: 'claude', workspaceId: null, tool: 'Edit', input: { file_path: 'x.ts' }, callId: 'c3' })
  await worker.emit('agent.status.changed', { ...base, state: 'done', mainAgent: { state: 'done', outcome: 'success', stateStartedAt: Date.now() } })
  const out = (await worker.request('pixel.runs')) as { runs: Array<Record<string, unknown>> }
  assert.equal(out.runs.length, 1)
  assert.equal(out.runs[0].key, 'term-1')
  assert.equal(out.runs[0].files, 1)
  assert.equal(out.runs[0].test, 'pass')
  assert.equal(out.runs[0].outcome, 'success')
  assert.equal(Number(out.runs[0].doneAt) > 0, true)
  const text = JSON.stringify(out)
  assert.equal(text.includes('secret'), false)
  assert.equal(text.includes('npm test'), false)
  await worker.deactivate()
})

/** What `orca account list --json` prints (trimmed), including data this plugin must never forward. */
const ACCOUNT_LIST = JSON.stringify({
  ok: true,
  result: {
    claude: { accounts: [{ id: 'acc1', email: 'someone@example.com' }], activeAccountId: 'acc1' },
    rateLimits: {
      claude: {
        provider: 'claude',
        session: { usedPercent: 16, windowMinutes: 300, resetsAt: 1795763399516, resetDescription: '2:09 PM' },
        weekly: { usedPercent: 18, windowMinutes: 10080, resetsAt: 1796007599516, resetDescription: 'Mon 9:59 AM' },
        updatedAt: 1795755510597,
        error: null,
        status: 'ok',
        planType: 'team',
        usageMetadata: { credentialSource: 'keychain-secret-source' }
      },
      codex: { provider: 'codex', session: null, weekly: null, updatedAt: 1, error: 'Codex not signed in', status: 'unavailable' },
      gemini: { provider: 'gemini', session: { usedPercent: 250, windowMinutes: 60, resetsAt: -5 }, weekly: null, updatedAt: 2, error: null, status: 'ok' }
    }
  }
})

test('limits keep only percentages, reset times and the plan, never emails or sources', async () => {
  const host = mockHost({ capabilities: CAPS })
  const worker = await mountWorker(main, { host })
  const calls: string[][] = []
  main.cli.run = async (args) => {
    calls.push(args)
    return ACCOUNT_LIST
  }
  const out = (await worker.request('pixel.limits')) as {
    available: boolean
    providers: Array<{ provider: string; planType: string; session: { usedPercent: number; windowMinutes: number; resetsAt: number } | null; weekly: { usedPercent: number } | null }>
  }
  assert.equal(out.available, true)
  assert.deepEqual(calls, [['account', 'list', '--json']])
  // claude is read; codex ("not signed in") is left out; gemini is read but clamped and sanitised
  assert.deepEqual(
    out.providers.map((p) => p.provider),
    ['claude', 'gemini']
  )
  assert.equal(out.providers[0].planType, 'team')
  assert.deepEqual(out.providers[0].session, { usedPercent: 16, windowMinutes: 300, resetsAt: 1795763399516 })
  assert.equal(out.providers[0].weekly?.usedPercent, 18)
  assert.deepEqual(out.providers[1].session, { usedPercent: 100, windowMinutes: 60, resetsAt: 0 })
  const text = JSON.stringify(out)
  assert.equal(text.includes('example.com'), false)
  assert.equal(text.includes('keychain'), false)
  assert.equal(text.includes('acc1'), false)
  await worker.deactivate()
})

test('limits log the CLI error code but never its output, and report why they failed', async () => {
  const host = mockHost({ capabilities: CAPS })
  const worker = await mountWorker(main, { host })
  main.cli.run = async () => {
    throw Object.assign(new Error('Command failed: orca account list --json'), {
      code: 1,
      detail: JSON.stringify({ ok: false, error: { code: 'runtime_unavailable', message: 'Orca is not running.' }, secret: 'someone@example.com' })
    })
  }
  assert.deepEqual(await worker.request('pixel.limits'), { available: false, reason: 'cli_failed' })
  assert.deepEqual(worker.logs, ['limits: runtime_unavailable: Orca is not running.'])
  await worker.deactivate()
})

test('limits explain why they are unavailable instead of throwing', async () => {
  const host = mockHost({ capabilities: CAPS })
  const worker = await mountWorker(main, { host })
  main.cli.run = async () => {
    throw Object.assign(new Error('spawn orca ENOENT'), { code: 'ENOENT' })
  }
  assert.deepEqual(await worker.request('pixel.limits'), { available: false, reason: 'cli_not_found' })
  main.cli.run = async () => {
    throw Object.assign(new Error('exit 1'), { code: 1 })
  }
  assert.deepEqual(await worker.request('pixel.limits'), { available: false, reason: 'cli_failed' })
  main.cli.run = async () => 'not json at all'
  assert.deepEqual(await worker.request('pixel.limits'), { available: false, reason: 'unreadable' })
  main.cli.run = async () => JSON.stringify({ ok: true, result: {} })
  assert.deepEqual(await worker.request('pixel.limits'), { available: false, reason: 'unreadable' })
  await worker.deactivate()
})

test('focus terminal asks Orca to focus exactly that terminal', async () => {
  const host = mockHost({ capabilities: CAPS, results: { 'terminal.focus': () => ({ focused: true }) } })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('pixel.focusTerminal', { terminalId: 't1' }), { focused: true })
  assert.deepEqual(host.callsOf('terminal.focus'), [{ terminalId: 't1' }])
  assert.deepEqual(host.refusals, [])
  await worker.deactivate()
})

test('focus terminal rejects missing input and never calls Orca', async () => {
  const host = mockHost({ capabilities: CAPS, results: { 'terminal.focus': () => ({ focused: true }) } })
  const worker = await mountWorker(main, { host })
  const error = await rejection(worker.request('pixel.focusTerminal', {}))
  assert.equal(error.code, 'invalid_params')
  assert.deepEqual(host.callsOf('terminal.focus'), [])
  await worker.deactivate()
})

test('focus terminal is refused without the workspace:write capability', async () => {
  const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: { 'terminal.focus': () => ({ focused: true }) } })
  const worker = await mountWorker(main, { host })
  const error = await rejection(worker.request('pixel.focusTerminal', { terminalId: 't1' }))
  assert.equal(error.code, 'capability_denied')
  await worker.deactivate()
})

test('open workspace uses the reported id when Orca accepts it', async () => {
  const host = mockHost({ capabilities: CAPS, results: { 'workspace.open': () => ({ opened: true }) } })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('pixel.openWorkspace', { workspaceId: 'w1', name: 'ECustom', branch: 'main' }), { opened: true })
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'w1' }])
  assert.deepEqual(host.callsOf('workspace.list'), [])
  await worker.deactivate()
})

test('open workspace falls back to matching the workspace list by name and branch', async () => {
  const host = mockHost({
    capabilities: CAPS,
    results: {
      'workspace.open': (params: { workspaceId: string }) => {
        if (params.workspaceId === 'ctx-id') throw hostError('invalid_params', 'unknown workspace')
        return { opened: true }
      },
      'workspace.list': () => ({
        workspaces: [row('other', 'Other', 'main'), row('list-id', 'ECustom', 'main')],
        truncated: false
      })
    }
  })
  const worker = await mountWorker(main, { host })
  assert.deepEqual(await worker.request('pixel.openWorkspace', { workspaceId: 'ctx-id', name: 'ECustom', branch: 'main' }), { opened: true })
  assert.deepEqual(host.callsOf('workspace.open'), [{ workspaceId: 'ctx-id' }, { workspaceId: 'list-id' }])
  await worker.deactivate()
})

test('open workspace reports an unknown workspace instead of guessing', async () => {
  const host = mockHost({
    capabilities: CAPS,
    results: {
      'workspace.open': () => {
        throw hostError('invalid_params', 'unknown workspace')
      },
      'workspace.list': () => ({ workspaces: [row('other', 'Other', null)], truncated: false })
    }
  })
  const worker = await mountWorker(main, { host })
  const error = await rejection(worker.request('pixel.openWorkspace', { workspaceId: 'ctx-id', name: 'ECustom', branch: 'main' }))
  assert.equal(error.code, 'action_failed')
  assert.equal(host.callsOf('workspace.open').length, 1)
  await worker.deactivate()
})

test('open workspace never swallows a permission error', async () => {
  const host = mockHost({ capabilities: ['workspace:read'], results: { 'workspace.open': () => ({ opened: true }) } })
  const worker = await mountWorker(main, { host })
  const error = await rejection(worker.request('pixel.openWorkspace', { workspaceId: 'w1', name: 'X', branch: '' }))
  assert.equal(error.code, 'capability_denied')
  await worker.deactivate()
})

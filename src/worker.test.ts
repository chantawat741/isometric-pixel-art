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

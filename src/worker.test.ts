// Run with `orca plugin test .` (Node, over a mock Orca host). Not part of the panel bundle.
import { assert, hostError, mockHost, mountWorker, test } from 'orca/testing'
import * as main from './worker'

const CAPS = ['workspace:read', 'agent:read', 'workspace:write']

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

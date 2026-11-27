// Run with `orca plugin test .` (Node). Pure logic of the message above a character's head.
import { assert, test } from 'orca/testing'
import { LOUD_MS, QUIET_MS, formatDuration, noteFor } from './notes'
import type { RunInfo } from './notes'

const T0 = 1_000_000

function run(over: Partial<RunInfo>): RunInfo {
  return { key: 'k', files: 0, reads: 0, test: null, startedAt: T0 - 30_000, doneAt: T0, outcome: 'success', ...over }
}

test('a run that changed files gets a bright card with the test result', () => {
  assert.deepEqual(noteFor(run({ files: 14, test: 'pass' }), T0 + 1000), { tone: 'pass', lead: 'Done.', body: '14 files,', tests: '✓ tests pass', testsTone: 'pass' })
  assert.deepEqual(noteFor(run({ files: 3, test: 'fail' }), T0 + 1000), { tone: 'fail', lead: 'Done.', body: '3 files,', tests: '✗ tests fail', testsTone: 'fail' })
  assert.deepEqual(noteFor(run({ files: 1 }), T0 + 1000), { tone: 'files', lead: 'Done.', body: '1 file', tests: '', testsTone: '' })
})

test('the bright card lasts 90 seconds, a quiet one 20', () => {
  assert.notEqual(noteFor(run({ files: 2 }), T0 + LOUD_MS), null)
  assert.equal(noteFor(run({ files: 2 }), T0 + LOUD_MS + 1), null)
  assert.notEqual(noteFor(run({ reads: 2 }), T0 + QUIET_MS), null)
  assert.equal(noteFor(run({ reads: 2 }), T0 + QUIET_MS + 1), null)
})

test('a run without file changes gets a quiet card with what is really known', () => {
  assert.equal(noteFor(run({}), T0 + 1000)?.lead, 'Done · 30s')
  assert.equal(noteFor(run({ reads: 6, startedAt: T0 - 21_000 }), T0 + 1000)?.lead, 'Done · read 6 files · 21s')
  assert.equal(noteFor(run({ reads: 1, startedAt: 0 }), T0 + 1000)?.lead, 'Done · read 1 file')
  assert.equal(noteFor(run({}), T0 + 1000)?.tone, 'quiet')
})

test('nothing is said when there is nothing worth saying', () => {
  assert.equal(noteFor(run({ doneAt: 0 }), T0), null) // still running
  assert.equal(noteFor(run({ startedAt: T0 - 1000 }), T0 + 100), null) // a 1 second reply
  assert.equal(noteFor(run({ startedAt: 0 }), T0 + 100), null) // no start time, nothing counted
  assert.equal(noteFor(run({ files: 5, outcome: 'cancellation' }), T0 + 100), null)
  assert.equal(noteFor(run({ files: 5, outcome: 'interruption' }), T0 + 100), null)
})

test('a failed run says so', () => {
  assert.deepEqual(noteFor(run({ files: 2, outcome: 'failure' }), T0 + 100), { tone: 'fail', lead: 'Failed.', body: '2 files', tests: '', testsTone: '' })
  assert.equal(noteFor(run({ outcome: 'failure' }), T0 + 100)?.body, '')
})

test('durations are short and readable', () => {
  assert.equal(formatDuration(8_000), '8s')
  assert.equal(formatDuration(60_000), '1m')
  assert.equal(formatDuration(125_000), '2m 5s')
  assert.equal(formatDuration(3_660_000), '1h 1m')
})

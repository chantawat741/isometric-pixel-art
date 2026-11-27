// The message above a character's head once its agent has finished a run.
//
// Real data only: what the plugin worker counted for that agent's last run (files changed, a test
// run's pass/fail when a known summary line was seen, when it started and ended). The icon bubbles
// are separate and unchanged. Nothing here is a summary of what the agent said.
//
//  - A run that changed files gets a bright card:   "Done. 14 files, ✓ tests pass"
//  - Any other run gets a quiet one (shorter-lived): "Done · read 6 files · 21s"
//  - A run that was cancelled or interrupted gets none.

export type TestResult = 'pass' | 'fail' | null

/** What the worker knows about an agent's latest run (counts only). */
export interface RunInfo {
  key: string
  files: number
  reads: number
  test: TestResult
  /** Epoch ms; 0 when unknown (the run started before the plugin saw it). */
  startedAt: number
  /** Epoch ms; 0 while the run is still going. */
  doneAt: number
  outcome: string
}

export type NoteTone = 'pass' | 'fail' | 'files' | 'quiet'

export interface Note {
  tone: NoteTone
  lead: string
  body: string
  /** The coloured part ("✓ tests pass"), or '' when no test run was recognised. */
  tests: string
  testsTone: 'pass' | 'fail' | ''
}

/** How long a card stays after the run ended. */
export const LOUD_MS = 90_000
export const QUIET_MS = 20_000
/** A quiet card for a run shorter than this says nothing worth reading. */
const MIN_QUIET_MS = 3_000

const SILENT_OUTCOMES = new Set(['cancellation', 'interruption', 'superseded'])

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? `${m}m ${s % 60}s` : `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** The card for a finished run right now, or null when there is nothing to say (or its time is up). */
export function noteFor(run: RunInfo, now: number): Note | null {
  if (run.doneAt <= 0 || SILENT_OUTCOMES.has(run.outcome)) return null
  const age = now - run.doneAt
  const failed = run.outcome === 'failure'
  if (run.files > 0 || failed) {
    if (age > LOUD_MS) return null
    const tests = run.test === 'pass' ? '✓ tests pass' : run.test === 'fail' ? '✗ tests fail' : ''
    return {
      tone: failed || run.test === 'fail' ? 'fail' : run.test === 'pass' ? 'pass' : 'files',
      lead: failed ? 'Failed.' : 'Done.',
      body: run.files > 0 ? `${plural(run.files, 'file')}${tests ? ',' : ''}` : '',
      tests,
      testsTone: run.test ?? ''
    }
  }
  if (age > QUIET_MS) return null
  const took = run.startedAt > 0 ? run.doneAt - run.startedAt : 0
  if (run.reads === 0 && took < MIN_QUIET_MS) return null
  const parts = ['Done']
  if (run.reads > 0) parts.push(`read ${plural(run.reads, 'file')}`)
  if (took >= MIN_QUIET_MS) parts.push(formatDuration(took))
  return { tone: 'quiet', lead: parts.join(' · '), body: '', tests: '', testsTone: '' }
}

/** Ask the plugin worker for its runs (the panel cannot see Orca's tool hook itself). */
export async function loadRuns(request: (name: string, input?: unknown) => Promise<unknown>): Promise<Map<string, RunInfo>> {
  const raw = (await request('pixel.runs', {})) as { runs?: unknown } | null
  if (!raw || !Array.isArray(raw.runs)) throw Object.assign(new Error('unexpected answer'), { code: 'invalid_response' })
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)
  const out = new Map<string, RunInfo>()
  for (const r of raw.runs.slice(0, 60) as Array<Partial<RunInfo>>) {
    if (typeof r.key !== 'string' || !r.key) continue
    out.set(r.key, {
      key: r.key,
      files: num(r.files),
      reads: num(r.reads),
      test: r.test === 'pass' || r.test === 'fail' ? r.test : null,
      startedAt: num(r.startedAt),
      doneAt: num(r.doneAt),
      outcome: typeof r.outcome === 'string' ? r.outcome : ''
    })
  }
  return out
}

/** Simulated runs for the demo agents, in the order demo-1 ... demo-6 (always labelled as a demo). */
const DEMO_RUNS: Array<{ files: number; reads: number; test: TestResult; seconds: number }> = [
  { files: 5, reads: 0, test: null, seconds: 34 },
  { files: 14, reads: 0, test: 'pass', seconds: 92 },
  { files: 3, reads: 0, test: 'fail', seconds: 51 },
  { files: 0, reads: 0, test: null, seconds: 8 },
  { files: 0, reads: 6, test: null, seconds: 21 },
  { files: 7, reads: 0, test: 'pass', seconds: 66 }
]

export function demoRun(id: string, now: number): RunInfo {
  const n = Math.max(1, Number(id.replace(/\D/g, '')) || 1)
  const d = DEMO_RUNS[(n - 1) % DEMO_RUNS.length]
  return { key: id, files: d.files, reads: d.reads, test: d.test, startedAt: now - d.seconds * 1000, doneAt: now, outcome: 'success' }
}

// Simulated agents for the prototype. They are clearly labelled "demo" in the UI and are removed
// as soon as real Orca agents are wired in (Phase 4): Pixel Base never invents real agents.

import { DESKS } from './rooms'
import { rng } from './gfx'
import { STATUS_COLOR } from './character'
import type { VisualStatus } from './character'
import { pushActivity } from './feed'
import type { ActivityItem } from './feed'
import type { Sim } from './sim'

const NAMES = ['ALEX', 'BEA', 'CODY', 'DANA', 'ECHO', 'FINN']

/** [status, minSeconds, maxSeconds] - a believable day in the life of an agent. */
const CYCLE: Array<[VisualStatus, number, number]> = [
  ['working', 9, 15],
  ['thinking', 3, 5],
  ['working', 6, 10],
  ['blocked', 3, 5],
  ['working', 5, 8],
  ['completed', 2.5, 2.5],
  ['celebrating', 2.5, 2.5],
  ['idle', 8, 13]
]

/** Where in the cycle each demo agent starts, so the office is varied from the first frame. */
const START_STEP = [0, 1, 7, 2, 7, 3]

interface Runner {
  id: string
  step: number
  left: number
}

/** What a simulated agent "says" when it enters a status (celebrating is just the tail of completed). */
const DEMO_TEXT: Partial<Record<VisualStatus, string>> = {
  working: 'is working on a task',
  thinking: 'is thinking…',
  blocked: 'is blocked',
  completed: 'finished a task',
  idle: 'is taking a break'
}

export class DemoDirector {
  private runners: Runner[] = []
  private readonly rand = rng(42)
  /** Simulated activity, newest first (cleared with the simulation). */
  readonly activity: ActivityItem[] = []

  constructor(private readonly sim: Sim) {}

  private note(name: string, status: VisualStatus): void {
    const text = DEMO_TEXT[status]
    if (text) pushActivity(this.activity, { t: Date.now(), label: name, text, color: STATUS_COLOR[status] })
  }

  get running(): boolean {
    return this.runners.length > 0
  }

  get count(): number {
    return this.runners.length
  }

  start(): void {
    this.stop()
    const n = Math.min(NAMES.length, DESKS.length)
    for (let i = 0; i < n; i++) {
      const step = START_STEP[i % START_STEP.length]
      const id = `demo-${i + 1}`
      this.sim.upsert({ id, name: NAMES[i], status: CYCLE[step][0], deskId: DESKS[i].id })
      this.runners.push({ id, step, left: this.duration(step) * (0.4 + this.rand() * 0.6) })
      this.note(NAMES[i], CYCLE[step][0])
    }
  }

  stop(): void {
    this.sim.clear()
    this.runners = []
    this.activity.length = 0
  }

  update(dt: number): void {
    for (const r of this.runners) {
      r.left -= dt
      if (r.left > 0) continue
      r.step = (r.step + 1) % CYCLE.length
      r.left = this.duration(r.step)
      this.sim.setStatus(r.id, CYCLE[r.step][0])
      this.note(this.sim.chars.get(r.id)?.info.name ?? r.id, CYCLE[r.step][0])
    }
  }

  private duration(step: number): number {
    const [, lo, hi] = CYCLE[step]
    return lo + this.rand() * (hi - lo)
  }
}

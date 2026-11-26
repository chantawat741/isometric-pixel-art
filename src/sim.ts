// Agent characters and their behaviour. The simulation only needs a list of agents with a visual
// status; where that status comes from (demo data now, Orca events in Phase 4) is not its concern.

import { rng } from './gfx'
import { LOOKS } from './character'
import type { Mood, Pose, VisualStatus } from './character'
import type { DeskSlot } from './rooms'
import type { NavGrid, Pos } from './nav'

export type Mode = 'seated' | 'standing' | 'walking' | 'sitting' | 'rising'

/** Extra facts about a real Orca agent, shown on the profile card. */
export interface AgentDetails {
  /** Terminal the agent runs in, when Orca reports one. */
  terminalId: string | null
  /** Workspace the agent belongs to (id as the workspace list gives it), when known. */
  workspaceId: string | null
  workspaceName: string
  kind: string
  title: string
  task: string
  /** Orca's own state name, shown next to the illustrative one. */
  orcaState: string
  /** Epoch ms when Orca says this state began. */
  since: number
}

export interface AgentInfo {
  id: string
  name: string
  status: VisualStatus
  deskId: string
  details?: AgentDetails
}

const SPEED = 2.4 // tiles per second
const TRANSITION = 0.35 // seconds to sit down / stand up

export function wantsDesk(status: VisualStatus): boolean {
  return (
    status === 'working' ||
    status === 'thinking' ||
    status === 'waiting' ||
    status === 'blocked' ||
    status === 'completed' ||
    status === 'failed'
  )
}

export class Character {
  gx = 0
  gy = 0
  mode: Mode = 'standing'
  path: Pos[] = []
  target: 'desk' | 'spot' | null = null
  spot = -1
  view: 'front' | 'back' = 'front'
  flip = false
  t = 0
  /** Seconds since this character appeared (for the "new agent" sprout bubble). */
  age = 0
  waitT = 0
  rerouted = false
  idleT = 0
  moveT = 0
  from: Pos = { gx: 0, gy: 0 }
  to: Pos = { gx: 0, gy: 0 }

  constructor(
    public info: AgentInfo,
    public lookId: number,
    readonly desk: DeskSlot
  ) {
    this.t = Math.random() * 10 // desynchronise idle animations
  }

  /** Depth key just after the chair, used while sitting down / seated / getting up. */
  get seatKey(): number {
    return this.desk.gx + this.desk.gy + 1.7 + 0.005
  }

  get seated(): boolean {
    return this.mode === 'seated' || this.mode === 'sitting' || this.mode === 'rising'
  }

  get pose(): Pose {
    if (this.mode === 'walking') return 'walk'
    if (this.mode === 'seated' || this.mode === 'sitting') return 'sit'
    return 'stand'
  }

  get mood(): Mood {
    switch (this.info.status) {
      case 'thinking':
        return 'think'
      case 'waiting':
        return 'wait'
      case 'blocked':
        return 'blocked'
      case 'completed':
        return 'done'
      case 'failed':
        return 'fail'
      case 'celebrating':
        return 'celebrate'
      default:
        return 'none'
    }
  }
}

export class Sim {
  readonly chars = new Map<string, Character>()
  private readonly spotOwner: Array<string | null>
  private readonly spots: Pos[]
  private readonly rand: () => number

  constructor(
    private readonly nav: NavGrid,
    private readonly desks: DeskSlot[],
    hangouts: Pos[],
    seed = 7
  ) {
    this.rand = rng(seed)
    this.spots = hangouts.map((h) => nav.nearestFree(h.gx, h.gy) ?? h)
    this.spotOwner = this.spots.map(() => null)
  }

  get deskCount(): number {
    return this.desks.length
  }

  /** Add or update an agent. New agents appear instantly where their status says they should be. */
  upsert(info: AgentInfo, lookId?: number): Character | null {
    const existing = this.chars.get(info.id)
    if (existing) {
      existing.info = info
      return existing
    }
    const desk = this.desks.find((d) => d.id === info.deskId)
    if (!desk) return null
    const used = new Set([...this.chars.values()].map((c) => c.lookId))
    const free = LOOKS.findIndex((_, i) => !used.has(i))
    const ch = new Character(info, lookId ?? (free >= 0 ? free : this.chars.size % LOOKS.length), desk)
    this.chars.set(info.id, ch)
    if (wantsDesk(info.status)) {
      this.seat(ch)
    } else {
      const spot = this.pickSpot(ch)
      const p = spot >= 0 ? this.spots[spot] : (this.nav.nearestFree(desk.seat.gx, desk.seat.gy - 1) ?? desk.seat)
      ch.gx = p.gx
      ch.gy = p.gy
      ch.mode = 'standing'
      ch.idleT = 2 + this.rand() * 6
    }
    return ch
  }

  remove(id: string): void {
    const ch = this.chars.get(id)
    if (!ch) return
    this.releaseSpot(ch)
    this.chars.delete(id)
  }

  clear(): void {
    this.chars.clear()
    this.spotOwner.fill(null)
  }

  setStatus(id: string, status: VisualStatus): void {
    const ch = this.chars.get(id)
    if (ch) ch.info = { ...ch.info, status }
  }

  /** Give an agent a different look; if another agent has it, they swap so looks stay unique. */
  setLook(id: string, lookId: number): void {
    const ch = this.chars.get(id)
    if (!ch) return
    const next = ((lookId % LOOKS.length) + LOOKS.length) % LOOKS.length
    for (const other of this.chars.values()) {
      if (other !== ch && other.lookId === next) other.lookId = ch.lookId
    }
    ch.lookId = next
  }

  update(dt: number): void {
    for (const ch of this.chars.values()) this.step(ch, dt)
  }

  // --- behaviour -----------------------------------------------------------------------------

  private step(ch: Character, dt: number): void {
    ch.t += dt
    ch.age += dt
    const status = ch.info.status
    switch (ch.mode) {
      case 'seated':
        if (status === 'idle') this.beginRise(ch)
        break
      case 'standing':
        if (wantsDesk(status)) this.goToDesk(ch)
        else if (status === 'idle') {
          ch.idleT -= dt
          if (ch.spot < 0 || ch.idleT <= 0) this.goToSpot(ch)
        }
        break
      case 'walking':
        if (ch.target === 'spot' && wantsDesk(status)) this.goToDesk(ch)
        else if (ch.target === 'desk' && status === 'idle') this.goToSpot(ch)
        else this.walk(ch, dt)
        break
      case 'sitting':
      case 'rising': {
        ch.moveT += dt
        const k = Math.min(1, ch.moveT / TRANSITION)
        ch.gx = ch.from.gx + (ch.to.gx - ch.from.gx) * k
        ch.gy = ch.from.gy + (ch.to.gy - ch.from.gy) * k
        if (k >= 1) {
          if (ch.mode === 'sitting') ch.mode = 'seated'
          else {
            ch.mode = 'standing'
            ch.idleT = 0.4
          }
        }
        break
      }
    }
  }

  private seat(ch: Character): void {
    ch.gx = ch.desk.seat.gx
    ch.gy = ch.desk.seat.gy
    ch.mode = 'seated'
    ch.view = 'front'
    ch.flip = true
    ch.target = null
  }

  private approach(ch: Character): Pos {
    return this.nav.nearestFree(ch.desk.seat.gx, ch.desk.seat.gy - 1.0) ?? ch.desk.seat
  }

  private goToDesk(ch: Character): void {
    this.releaseSpot(ch)
    const path = this.nav.findPath(ch, this.approach(ch))
    if (!path) {
      this.seat(ch) // unreachable: never leave an agent stranded
      return
    }
    ch.path = path
    ch.target = 'desk'
    ch.mode = 'walking'
    if (!path.length) this.arrive(ch)
  }

  private goToSpot(ch: Character): void {
    this.releaseSpot(ch)
    const spot = this.pickSpot(ch)
    if (spot < 0) {
      ch.mode = 'standing'
      ch.idleT = 3
      return
    }
    const path = this.nav.findPath(ch, this.spots[spot])
    if (!path) {
      this.releaseSpot(ch)
      ch.mode = 'standing'
      ch.idleT = 3
      return
    }
    ch.path = path
    ch.target = 'spot'
    ch.mode = 'walking'
    if (!path.length) this.arrive(ch)
  }

  private beginRise(ch: Character): void {
    const exit = this.approach(ch)
    // Stay in the chair while someone is walking through the spot we would step into.
    for (const o of this.chars.values()) {
      if (o !== ch && !o.seated && Math.hypot(o.gx - exit.gx, o.gy - exit.gy) < 0.8) return
    }
    ch.from = { gx: ch.gx, gy: ch.gy }
    ch.to = exit
    ch.moveT = 0
    ch.mode = 'rising'
    ch.view = 'back'
    ch.flip = false
  }

  private arrive(ch: Character): void {
    if (ch.target === 'desk') {
      ch.from = { gx: ch.gx, gy: ch.gy }
      ch.to = ch.desk.seat
      ch.moveT = 0
      ch.mode = 'sitting'
      ch.view = 'front'
      ch.flip = true
    } else {
      ch.mode = 'standing'
      ch.idleT = 6 + this.rand() * 8
      ch.view = 'front'
    }
    ch.target = null
    ch.path = []
  }

  private walk(ch: Character, dt: number): void {
    let remaining = SPEED * dt
    while (remaining > 0 && ch.path.length) {
      const next = ch.path[0]
      const dx = next.gx - ch.gx
      const dy = next.gy - ch.gy
      const dist = Math.hypot(dx, dy)
      if (dist < 1e-6) {
        ch.path.shift()
        continue
      }
      const step = Math.min(remaining, dist)
      const nx = ch.gx + (dx / dist) * step
      const ny = ch.gy + (dy / dist) * step
      if (this.blockedByOther(ch, nx, ny)) {
        ch.waitT += dt
        if (ch.waitT > 0.25 && !ch.rerouted) {
          // Try to go around whoever is in the way (e.g. use the other lane of an aisle).
          ch.rerouted = true
          const goal = ch.path[ch.path.length - 1]
          const others = [...this.chars.values()].filter((o) => o !== ch && !o.seated)
          const alt = this.nav.findPath(ch, goal, others)
          if (alt && alt.length) ch.path = alt
          return
        }
        if (ch.waitT < 1.6) return // otherwise wait for them to pass, and only then push through
      } else {
        ch.waitT = 0
        ch.rerouted = false
      }
      ch.gx = nx
      ch.gy = ny
      remaining -= step
      // isometric facing: screen dx = dgx - dgy, screen dy = dgx + dgy
      const sdx = dx - dy
      const sdy = dx + dy
      ch.view = sdy < -1e-6 ? 'back' : 'front'
      if (Math.abs(sdx) > 1e-6) ch.flip = sdx < 0
      if (step >= dist - 1e-6) ch.path.shift()
    }
    if (!ch.path.length) this.arrive(ch)
  }

  private blockedByOther(ch: Character, nx: number, ny: number): boolean {
    for (const o of this.chars.values()) {
      if (o === ch || o.seated) continue
      const dNew = Math.hypot(o.gx - nx, o.gy - ny)
      if (dNew < 0.5 && dNew < Math.hypot(o.gx - ch.gx, o.gy - ch.gy)) return true
    }
    return false
  }

  private pickSpot(ch: Character): number {
    const free: number[] = []
    this.spotOwner.forEach((owner, i) => {
      if (owner === null) free.push(i)
    })
    if (!free.length) return -1
    const i = free[Math.floor(this.rand() * free.length)]
    this.spotOwner[i] = ch.info.id
    ch.spot = i
    return i
  }

  private releaseSpot(ch: Character): void {
    if (ch.spot >= 0 && this.spotOwner[ch.spot] === ch.info.id) this.spotOwner[ch.spot] = null
    ch.spot = -1
  }
}

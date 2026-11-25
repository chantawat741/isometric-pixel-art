// Walkable-area grid and A* path finding. Cells are 0.5 tile; a cell is blocked when its centre
// lies within `radius` of any solid footprint (so a character body fits through gaps).

import { GRID_H, GRID_W } from './rooms'
import type { Footprint } from './scene'

export const CELL = 0.5

export interface Pos {
  gx: number
  gy: number
}

export class NavGrid {
  readonly cols = Math.round(GRID_W / CELL)
  readonly rows = Math.round(GRID_H / CELL)
  private readonly blocked: Uint8Array

  constructor(solids: Footprint[], radius = 0.18) {
    this.blocked = new Uint8Array(this.cols * this.rows)
    for (let cy = 0; cy < this.rows; cy++) {
      for (let cx = 0; cx < this.cols; cx++) {
        const gx = (cx + 0.5) * CELL
        const gy = (cy + 0.5) * CELL
        let b = gx < 0.3 || gy < 0.3 || gx > GRID_W - 0.3 || gy > GRID_H - 0.3
        if (!b) {
          for (const s of solids) {
            if (gx > s.gx - radius && gx < s.gx + s.w + radius && gy > s.gy - radius && gy < s.gy + s.d + radius) {
              b = true
              break
            }
          }
        }
        this.blocked[cy * this.cols + cx] = b ? 1 : 0
      }
    }
  }

  cellX(gx: number): number {
    return Math.max(0, Math.min(this.cols - 1, Math.floor(gx / CELL)))
  }

  cellY(gy: number): number {
    return Math.max(0, Math.min(this.rows - 1, Math.floor(gy / CELL)))
  }

  isFree(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows && this.blocked[cy * this.cols + cx] === 0
  }

  isFreeAt(gx: number, gy: number): boolean {
    return this.isFree(this.cellX(gx), this.cellY(gy))
  }

  center(cx: number, cy: number): Pos {
    return { gx: (cx + 0.5) * CELL, gy: (cy + 0.5) * CELL }
  }

  /** Closest free cell centre to a position (ring search). */
  nearestFree(gx: number, gy: number): Pos | null {
    const x0 = this.cellX(gx)
    const y0 = this.cellY(gy)
    for (let r = 0; r < Math.max(this.cols, this.rows); r++) {
      let best: Pos | null = null
      let bestD = Infinity
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          if (!this.isFree(x0 + dx, y0 + dy)) continue
          const c = this.center(x0 + dx, y0 + dy)
          const d = (c.gx - gx) ** 2 + (c.gy - gy) ** 2
          if (d < bestD) {
            bestD = d
            best = c
          }
        }
      }
      if (best) return best
    }
    return null
  }

  /**
   * Shortest path (8 directions, no corner cutting) as cell centres, excluding the start cell.
   * `avoid` lists positions (other characters) whose cell is treated as blocked for this search.
   */
  findPath(from: Pos, to: Pos, avoid: Pos[] = []): Pos[] | null {
    const start = this.nearestFree(from.gx, from.gy)
    const goal = this.nearestFree(to.gx, to.gy)
    if (!start || !goal) return null
    const sx = this.cellX(start.gx)
    const sy = this.cellY(start.gy)
    const tx = this.cellX(goal.gx)
    const ty = this.cellY(goal.gy)
    if (sx === tx && sy === ty) return []

    const extra = new Set<number>()
    for (const a of avoid) extra.add(this.cellY(a.gy) * this.cols + this.cellX(a.gx))
    extra.delete(sy * this.cols + sx)
    extra.delete(ty * this.cols + tx)
    const ok = (x: number, y: number): boolean => this.isFree(x, y) && !extra.has(y * this.cols + x)

    const n = this.cols * this.rows
    const g = new Float32Array(n).fill(Infinity)
    const came = new Int32Array(n).fill(-1)
    const closed = new Uint8Array(n)
    const open: number[] = []
    const idx = (x: number, y: number): number => y * this.cols + x
    const h = (x: number, y: number): number => {
      const dx = Math.abs(x - tx)
      const dy = Math.abs(y - ty)
      return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy)
    }
    const f = new Float32Array(n).fill(Infinity)
    g[idx(sx, sy)] = 0
    f[idx(sx, sy)] = h(sx, sy)
    open.push(idx(sx, sy))

    while (open.length) {
      let bi = 0
      for (let i = 1; i < open.length; i++) if (f[open[i]] < f[open[bi]]) bi = i
      const cur = open[bi]
      open[bi] = open[open.length - 1]
      open.pop()
      if (closed[cur]) continue
      closed[cur] = 1
      const cx = cur % this.cols
      const cy = Math.floor(cur / this.cols)
      if (cx === tx && cy === ty) {
        const out: Pos[] = []
        for (let c = cur; c !== -1 && c !== idx(sx, sy); c = came[c]) out.push(this.center(c % this.cols, Math.floor(c / this.cols)))
        return out.reverse()
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = cx + dx
          const ny = cy + dy
          if (!ok(nx, ny)) continue
          if (dx !== 0 && dy !== 0 && (!ok(cx + dx, cy) || !ok(cx, cy + dy))) continue
          const ni = idx(nx, ny)
          if (closed[ni]) continue
          const ng = g[cur] + (dx !== 0 && dy !== 0 ? Math.SQRT2 : 1)
          if (ng < g[ni]) {
            g[ni] = ng
            f[ni] = ng + h(nx, ny)
            came[ni] = cur
            open.push(ni)
          }
        }
      }
    }
    return null
  }
}

// Builds the isometric office.
//
// Layers (all in "bitmap" coordinates = office pixel coordinates minus the bounds origin):
//   base   - floor, walls, wall decor, floor shadows. Rendered once.
//   props  - every piece of furniture as its own cached sprite plus its footprint, so characters
//            can be depth-sorted between them every frame without re-rasterising furniture.
//   solids - footprints of everything a character cannot walk through (feeds the nav grid).

import {
  TILE_W,
  TILE_H,
  project,
  shade,
  fillFloorRect,
  fillWallX,
  fillWallY,
  drawBox,
  palette,
  dot,
  rng
} from './gfx'
import { DESKS, DOORS, GRID_H, GRID_W, PARTITION_H, ROOMS, WALL_H, roomAt } from './rooms'
import type { DeskSlot } from './rooms'

export interface Footprint {
  gx: number
  gy: number
  w: number
  d: number
}

export interface Prop {
  key: number
  rect: Footprint
  sprite: HTMLCanvasElement
  /** Where the sprite goes in the office bitmap. */
  sx: number
  sy: number
}

export interface Office {
  width: number
  height: number
  /** Office pixel coordinates of the bitmap's top-left corner. */
  minX: number
  minY: number
  base: HTMLCanvasElement
  props: Prop[]
  solids: Footprint[]
}

interface Drawable {
  key: number
  rect: Footprint
  /** Tallest point of the prop in pixels (used to size its cached sprite). */
  h: number
  draw: (ctx: CanvasRenderingContext2D) => void
}

class Collector {
  drawables: Drawable[] = []
  shadows: Footprint[] = []

  add(rect: Footprint, h: number, draw: (ctx: CanvasRenderingContext2D) => void, gz = 0): void {
    this.drawables.push({ key: rect.gx + rect.w + rect.gy + rect.d + gz * 0.01, rect, h, draw })
  }
}

// --- props ---------------------------------------------------------------------------------

function box(c: Collector, gx: number, gy: number, gz: number, w: number, d: number, h: number, color: string, shadow = false): void {
  const cols = palette(color)
  c.add({ gx, gy, w, d }, gz + h, (ctx) => drawBox(ctx, gx, gy, gz, w, d, h, cols), gz)
  if (shadow) c.shadows.push({ gx, gy, w, d })
}

/** Desk with the monitor on the left half; the occupant sits behind the right half. */
function desk(c: Collector, gx: number, gy: number): void {
  c.shadows.push({ gx: gx - 0.05, gy: gy - 0.05, w: 2.15, d: 1.15 })
  c.add({ gx, gy, w: 2, d: 1 }, 18, (ctx) => {
    const wood = palette('#8a5f3a')
    const top = palette('#d0a36b')
    const dark = palette('#2b2f3a')
    drawBox(ctx, gx + 0.2, gy + 0.05, 2.5, 1.6, 0.1, 4.5, wood) // modesty panel
    drawBox(ctx, gx + 0.05, gy + 0.05, 0, 0.2, 0.9, 7, wood) // left leg panel
    drawBox(ctx, gx + 1.75, gy + 0.05, 0, 0.2, 0.9, 7, wood) // right leg panel
    drawBox(ctx, gx, gy, 7, 2, 1, 2, top) // desk top
    drawBox(ctx, gx + 0.5, gy + 0.4, 9, 0.35, 0.3, 1, dark) // monitor stand
    drawBox(ctx, gx + 0.15, gy + 0.35, 10, 1.0, 0.14, 7, dark) // monitor bezel
    const sy = gy + 0.35 + 0.14
    fillWallY(ctx, sy, gx + 0.21, gx + 1.09, 10.9, 16.2, '#3fb2dc')
    fillWallY(ctx, sy, gx + 0.21, gx + 1.09, 14.2, 16.2, '#62cbed')
    fillWallY(ctx, sy, gx + 0.3, gx + 0.8, 13.4, 14.0, '#c8f1fd')
    fillWallY(ctx, sy, gx + 0.3, gx + 0.6, 12.2, 12.8, '#c8f1fd')
    fillWallY(ctx, sy, gx + 0.3, gx + 0.9, 11.2, 11.8, '#c8f1fd')
    drawBox(ctx, gx + 0.3, gy + 0.68, 9, 0.8, 0.22, 0.6, palette('#e6e9f0')) // keyboard
    drawBox(ctx, gx + 1.15, gy + 0.7, 9, 0.16, 0.16, 0.7, palette('#e6e9f0')) // mouse
    drawBox(ctx, gx + 1.65, gy + 0.55, 9, 0.2, 0.2, 1.6, palette('#e8eef5')) // mug
    drawBox(ctx, gx + 1.25, gy + 0.2, 9, 0.4, 0.32, 0.5, palette('#f4f6fa')) // notebook
  })
}

function chair(c: Collector, gx: number, gy: number, color: string, face: 'down' | 'up' = 'down'): void {
  c.shadows.push({ gx: gx + 0.05, gy: gy + 0.05, w: 0.8, d: 0.8 })
  c.add({ gx, gy, w: 0.8, d: 0.8 }, 15.2, (ctx) => {
    const col = palette(color)
    const dark = palette('#2b2f3a')
    if (face === 'down') drawBox(ctx, gx, gy - 0.02, 6, 0.8, 0.14, 9, col)
    drawBox(ctx, gx + 0.3, gy + 0.3, 0, 0.2, 0.2, 5, dark)
    drawBox(ctx, gx, gy, 5, 0.8, 0.8, 1.6, col)
    if (face === 'up') drawBox(ctx, gx, gy + 0.68, 6, 0.8, 0.14, 9, col)
  })
}

function plant(c: Collector, gx: number, gy: number): void {
  c.shadows.push({ gx, gy, w: 0.7, d: 0.7 })
  c.add({ gx: gx - 0.12, gy: gy - 0.12, w: 0.84, d: 0.84 }, 19, (ctx) => {
    drawBox(ctx, gx, gy, 0, 0.6, 0.6, 4.5, palette('#b5654a'))
    drawBox(ctx, gx + 0.05, gy + 0.05, 4.5, 0.5, 0.5, 5, palette('#3f9a4f'))
    drawBox(ctx, gx - 0.12, gy - 0.12, 8.5, 0.84, 0.84, 6, palette('#4fb35e'))
    drawBox(ctx, gx + 0.04, gy + 0.04, 14.5, 0.52, 0.52, 4, palette('#6bd07a'))
  })
}

function bookshelf(c: Collector, gx: number, gy: number, d: number): void {
  c.shadows.push({ gx, gy, w: 0.9, d })
  c.add({ gx, gy, w: 0.8, d }, 32, (ctx) => {
    drawBox(ctx, gx, gy, 0, 0.8, d, 32, palette('#7a5230'))
    const X = gx + 0.8
    const rand = rng(Math.floor(gy * 10) + 7)
    const colors = ['#d9534f', '#f0ad4e', '#5cb85c', '#5bc0de', '#9b6bd3', '#e8e2d6', '#3d6fb4']
    for (let s = 0; s < 3; s++) {
      const z0 = 2.5 + s * 9.5
      fillWallX(ctx, X, gy + 0.1, gy + d - 0.1, z0, z0 + 8.5, '#45301f')
      let p = gy + 0.14
      while (p < gy + d - 0.3) {
        const bw = 0.09 + rand() * 0.1
        const bh = 5 + rand() * 3
        fillWallX(ctx, X, p, p + bw, z0 + 0.4, z0 + 0.4 + bh, colors[Math.floor(rand() * colors.length)])
        p += bw + 0.02
      }
    }
  })
}

function rack(c: Collector, gx: number, gy: number): void {
  c.shadows.push({ gx, gy, w: 1, d: 1.1 })
  c.add({ gx, gy, w: 0.9, d: 1.1 }, 36, (ctx) => {
    drawBox(ctx, gx, gy, 0, 0.9, 1.1, 36, palette('#313744'))
    const X = gx + 0.9
    const rand = rng(Math.floor(gy * 17) + 3)
    const leds = ['#6df08a', '#6df08a', '#ffc857', '#ff6b6b']
    for (let i = 0; i < 6; i++) {
      const z0 = 3 + i * 5.3
      fillWallX(ctx, X, gy + 0.1, gy + 1.0, z0, z0 + 4.2, '#171a22')
      fillWallX(ctx, X, gy + 0.45, gy + 0.95, z0 + 1.6, z0 + 2.4, '#3d4557')
      for (let k = 0; k < 3; k++) dot(ctx, project(X, gy + 0.18 + k * 0.1, z0 + 2.6), leds[Math.floor(rand() * leds.length)])
    }
  })
}

function sofa(c: Collector, gx: number, gy: number, w: number, color: string): void {
  c.shadows.push({ gx, gy, w, d: 1.2 })
  c.add({ gx, gy, w, d: 1.15 }, 13, (ctx) => {
    drawBox(ctx, gx, gy, 0, w, 0.35, 13, palette(color))
    drawBox(ctx, gx + 0.3, gy + 0.35, 0, w - 0.6, 0.8, 6, palette(color))
    drawBox(ctx, gx, gy + 0.35, 0, 0.3, 0.8, 9, palette(color))
    drawBox(ctx, gx + w - 0.3, gy + 0.35, 0, 0.3, 0.8, 9, palette(color))
  })
}

function poolTable(c: Collector, gx: number, gy: number): void {
  const w = 3.2
  const d = 1.8
  c.shadows.push({ gx, gy, w: w + 0.1, d: d + 0.1 })
  c.add({ gx, gy, w, d }, 8, (ctx) => {
    drawBox(ctx, gx + 0.15, gy + 0.15, 0, w - 0.3, d - 0.3, 5, palette('#3f2a1a'))
    drawBox(ctx, gx, gy, 5, w, d, 2.5, palette('#6a4429'))
    fillFloorRect(ctx, gx + 0.22, gy + 0.22, w - 0.44, d - 0.44, '#2f9a62', 7.5)
    const balls = ['#ffffff', '#ffd23f', '#e63946', '#1d6fe0', '#222222']
    for (let i = 0; i < 5; i++) dot(ctx, project(gx + 2 + (i % 3) * 0.16, gy + 0.7 + Math.floor(i / 3) * 0.3, 7.5), balls[i], 2)
  })
}

function meetingTable(c: Collector, gx: number, gy: number): void {
  const w = 5
  const d = 2.2
  c.shadows.push({ gx, gy, w: w + 0.1, d: d + 0.1 })
  c.add({ gx, gy, w, d }, 13, (ctx) => {
    const leg = palette('#4a4f5c')
    drawBox(ctx, gx + 0.4, gy + 0.5, 0, 0.4, 1.2, 6, leg)
    drawBox(ctx, gx + w - 0.8, gy + 0.5, 0, 0.4, 1.2, 6, leg)
    drawBox(ctx, gx, gy, 6, w, d, 2, palette('#ece6d9'))
    for (const x of [0.8, 2.3, 3.8]) {
      drawBox(ctx, gx + x, gy + 0.55, 8, 0.7, 0.5, 0.5, palette('#aab2c2'))
      drawBox(ctx, gx + x, gy + 0.5, 8.5, 0.7, 0.06, 3.2, palette('#2b2f3a'))
      fillWallY(ctx, gy + 0.56, gx + x + 0.06, gx + x + 0.64, 8.9, 11.2, '#4fb8e0')
    }
    drawBox(ctx, gx + 2.2, gy + 1.5, 8, 0.5, 0.5, 0.8, palette('#2b2f3a'))
  })
}

function table(c: Collector, gx: number, gy: number, w: number, d: number, h: number, color: string): void {
  c.shadows.push({ gx, gy, w: w + 0.1, d: d + 0.1 })
  c.add({ gx, gy, w, d }, h, (ctx) => {
    drawBox(ctx, gx + w / 2 - 0.15, gy + d / 2 - 0.15, 0, 0.3, 0.3, h - 1.5, palette('#4a4f5c'))
    drawBox(ctx, gx, gy, h - 1.5, w, d, 1.5, palette(color))
  })
}

function stool(c: Collector, gx: number, gy: number, color: string): void {
  c.shadows.push({ gx, gy, w: 0.55, d: 0.55 })
  c.add({ gx, gy, w: 0.55, d: 0.55 }, 5.4, (ctx) => {
    drawBox(ctx, gx + 0.18, gy + 0.18, 0, 0.2, 0.2, 4, palette('#4a4f5c'))
    drawBox(ctx, gx, gy, 4, 0.55, 0.55, 1.4, palette(color))
  })
}

function counter(c: Collector, gx: number, gy: number, w: number): void {
  c.shadows.push({ gx, gy, w, d: 1 })
  c.add({ gx, gy, w, d: 0.9 }, 20, (ctx) => {
    drawBox(ctx, gx, gy, 0, w, 0.9, 10, palette('#8a93a8'))
    drawBox(ctx, gx - 0.03, gy - 0.03, 10, w + 0.06, 0.96, 1.2, palette('#e8ebf2'))
    drawBox(ctx, gx + 0.2, gy + 0.15, 11.2, 0.65, 0.6, 8, palette('#3a3f4c')) // coffee machine
    fillWallY(ctx, gy + 0.75, gx + 0.3, gx + 0.8, 14.5, 17.5, '#ff7a59')
    drawBox(ctx, gx + 0.38, gy + 0.3, 11.2, 0.25, 0.25, 2.2, palette('#f4f6fa'))
    drawBox(ctx, gx + w - 0.55, gy + 0.3, 11.2, 0.3, 0.3, 2, palette('#5bc0de')) // mug jar
  })
}

function fridge(c: Collector, gx: number, gy: number): void {
  c.shadows.push({ gx, gy, w: 1, d: 1 })
  c.add({ gx, gy, w: 0.9, d: 0.9 }, 36, (ctx) => {
    drawBox(ctx, gx, gy, 0, 0.9, 0.9, 36, palette('#d8dee9'))
    fillWallY(ctx, gy + 0.9, gx + 0.05, gx + 0.85, 21, 22, '#8d94a6')
    fillWallY(ctx, gy + 0.9, gx + 0.7, gx + 0.78, 24, 31, '#8d94a6')
    fillWallY(ctx, gy + 0.9, gx + 0.7, gx + 0.78, 9, 18, '#8d94a6')
  })
}

// --- walls & partitions ----------------------------------------------------------------------

const WALL_COLOR = '#d6dae5'

function drawOuterWalls(ctx: CanvasRenderingContext2D): void {
  const wall = palette(WALL_COLOR)
  drawBox(ctx, -0.5, 0, 0, 0.5, GRID_H, WALL_H, wall) // left wall (plane gx = 0)
  drawBox(ctx, -0.5, -0.5, 0, 0.5, 0.5, WALL_H, wall) // corner post
  drawBox(ctx, 0, -0.5, 0, GRID_W, 0.5, WALL_H, wall) // right wall (plane gy = 0)

  for (const r of ROOMS) {
    if (r.y0 === 0) fillWallY(ctx, 0, r.x0, r.x1, 0, 4, shade(r.accent, 0.55))
    if (r.x0 === 0) fillWallX(ctx, 0, r.y0, r.y1, 0, 4, shade(r.accent, 0.4))
  }
  fillWallY(ctx, 0, 0, GRID_W, 4, 5, '#a9b0c0')
  fillWallX(ctx, 0, 0, GRID_H, 4, 5, '#7e869a')
}

function windowY(ctx: CanvasRenderingContext2D, a: number, b: number): void {
  const frame = '#eef1f7'
  fillWallY(ctx, 0, a, b, 16, 35, frame)
  fillWallY(ctx, 0, a + 0.12, b - 0.12, 17.5, 33.5, '#6fb9e6')
  fillWallY(ctx, 0, a + 0.12, b - 0.12, 26, 33.5, '#8ccdf2')
  fillWallY(ctx, 0, a + 0.12, a + 0.5, 17.5, 33.5, '#b6e2fa')
  const mid = (a + b) / 2
  fillWallY(ctx, 0, mid - 0.05, mid + 0.05, 17.5, 33.5, frame)
  fillWallY(ctx, 0, a + 0.12, b - 0.12, 25.2, 26.2, frame)
}

function windowX(ctx: CanvasRenderingContext2D, a: number, b: number): void {
  const frame = '#c4cad8'
  fillWallX(ctx, 0, a, b, 16, 35, frame)
  fillWallX(ctx, 0, a + 0.12, b - 0.12, 17.5, 33.5, '#5aa6d6')
  fillWallX(ctx, 0, a + 0.12, b - 0.12, 26, 33.5, '#76bbe6')
  const mid = (a + b) / 2
  fillWallX(ctx, 0, mid - 0.05, mid + 0.05, 17.5, 33.5, frame)
  fillWallX(ctx, 0, a + 0.12, b - 0.12, 25.2, 26.2, frame)
}

function posterY(ctx: CanvasRenderingContext2D, a: number, b: number, color: string): void {
  fillWallY(ctx, 0, a, b, 15, 31, '#f4f6fa')
  fillWallY(ctx, 0, a + 0.1, b - 0.1, 16.5, 29.5, color)
  fillWallY(ctx, 0, a + 0.25, b - 0.25, 22, 25, shade(color, 1.35))
  fillWallY(ctx, 0, a + 0.25, b - 0.45, 18, 19.2, '#fdfdfd')
}

function posterX(ctx: CanvasRenderingContext2D, a: number, b: number, color: string): void {
  fillWallX(ctx, 0, a, b, 15, 31, '#e8ecf4')
  fillWallX(ctx, 0, a + 0.1, b - 0.1, 16.5, 29.5, color)
  fillWallX(ctx, 0, a + 0.25, b - 0.25, 22, 25, shade(color, 1.35))
}

function whiteboard(ctx: CanvasRenderingContext2D, a: number, b: number): void {
  fillWallY(ctx, 0, a, b, 13, 32, '#9aa3b5')
  fillWallY(ctx, 0, a + 0.1, b - 0.1, 14.5, 30.5, '#f6f8fc')
  const lines: Array<[number, number, number, string]> = [
    [0.4, 2.4, 27.5, '#e86d5a'],
    [0.4, 3.4, 24.5, '#3d6fb4'],
    [0.4, 2.8, 21.5, '#3d6fb4'],
    [0.4, 1.8, 18.5, '#5cb85c'],
    [2.8, 3.8, 27.5, '#f0ad4e']
  ]
  for (const [s, e, z, col] of lines) fillWallY(ctx, 0, a + s, a + e, z, z + 0.9, col)
  fillWallY(ctx, 0, b - 1.0, b - 0.55, 25, 28.5, '#ffd23f')
  fillWallY(ctx, 0, b - 0.5, b - 0.2, 19, 22.5, '#ff9ecb')
}

function drawWallDecor(ctx: CanvasRenderingContext2D): void {
  windowY(ctx, 1.1, 3.5)
  posterY(ctx, 4.8, 6.0, '#e86d5a')
  windowY(ctx, 7.2, 9.6)
  windowY(ctx, 11.5, 12.9)
  whiteboard(ctx, 13.4, 17.8)
  windowY(ctx, 18.2, 19.6)
  windowX(ctx, 3.9, 6.1)
  posterX(ctx, 6.6, 7.6, '#6fb9e6')
  fillWallX(ctx, 0, 8.4, 13.8, 31, 38, '#2a2f3b') // cable duct above the racks
  for (let i = 0; i < 5; i++) fillWallX(ctx, 0, 8.7 + i * 1.05, 9.3 + i * 1.05, 32.5, 36.5, '#3d4557')
}

function partitionSegments(from: number, to: number, doors: Array<[number, number]>): Array<[number, number]> {
  const marks = new Set<number>()
  for (let p = Math.ceil(from); p <= Math.floor(to); p++) marks.add(p)
  marks.add(from)
  marks.add(to)
  for (const [a, b] of doors) {
    marks.add(a)
    marks.add(b)
  }
  const pts = [...marks].filter((p) => p >= from && p <= to).sort((a, b) => a - b)
  const out: Array<[number, number]> = []
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const mid = (a + b) / 2
    if (doors.some(([s, e]) => mid > s && mid < e)) continue
    out.push([a, b])
  }
  return out
}

function addPartition(c: Collector, axis: 'x' | 'y', fixed: number, from: number, to: number, doors: Array<[number, number]>): void {
  const body = palette('#b9c0cf')
  const post = palette('#8a93a8')
  const T = 0.2
  for (const [a, b] of partitionSegments(from, to, doors)) {
    if (axis === 'y') {
      c.add({ gx: a, gy: fixed - T / 2, w: b - a, d: T }, PARTITION_H, (ctx) => drawBox(ctx, a, fixed - T / 2, 0, b - a, T, PARTITION_H, body))
    } else {
      c.add({ gx: fixed - T / 2, gy: a, w: T, d: b - a }, PARTITION_H, (ctx) => drawBox(ctx, fixed - T / 2, a, 0, T, b - a, PARTITION_H, body))
    }
  }
  for (const [a, b] of doors) {
    for (const p of [a, b]) {
      const rect = axis === 'y' ? { gx: p - 0.12, gy: fixed - 0.12, w: 0.24, d: 0.24 } : { gx: fixed - 0.12, gy: p - 0.12, w: 0.24, d: 0.24 }
      c.add(rect, 22, (ctx) => drawBox(ctx, rect.gx, rect.gy, 0, 0.24, 0.24, 22, post))
    }
  }
}

// --- scene assembly --------------------------------------------------------------------------

const DESK_CHAIRS = ['#e86d5a', '#4f8fe0', '#6bbf6f', '#b07be0', '#f0b35a', '#4cc3c9']

export const CHAIR_OFFSET = { gx: 1.0, gy: -0.9 }

function buildProps(c: Collector): void {
  DESKS.forEach((slot: DeskSlot, i) => {
    desk(c, slot.gx, slot.gy)
    chair(c, slot.gx + CHAIR_OFFSET.gx, slot.gy + CHAIR_OFFSET.gy, DESK_CHAIRS[i % DESK_CHAIRS.length])
  })
  bookshelf(c, 0.1, 1.0, 2.2)
  plant(c, 0.45, 3.2)
  plant(c, 10.0, 0.5)
  plant(c, 0.4, 7.0)

  meetingTable(c, 13.2, 2.4)
  for (const gx of [14.0, 15.5, 17.0]) {
    chair(c, gx, 1.35, '#4f8fe0', 'down')
    chair(c, gx, 4.75, '#4f8fe0', 'up')
  }
  plant(c, 18.9, 0.6)
  plant(c, 11.6, 6.9)

  for (const gy of [9.0, 10.3, 11.6, 12.9]) rack(c, 0.1, gy)
  desk(c, 3.0, 12.4)
  chair(c, 4.0, 11.5, '#7be08a')

  sofa(c, 7.2, 8.4, 3.2, '#e0735c')
  box(c, 8.6, 10.5, 0, 1.4, 0.8, 3.5, '#d9c9a8', true)
  poolTable(c, 11.6, 10.6)
  sofa(c, 12.4, 8.4, 1.5, '#4f8fe0')
  plant(c, 6.4, 13.0)
  plant(c, 15.2, 13.1)

  fridge(c, 16.3, 8.35)
  counter(c, 17.35, 8.35, 1.4)
  table(c, 17.3, 11.0, 1.6, 1.6, 7, '#f0e4c8')
  stool(c, 16.5, 11.5, '#ff7a59')
  stool(c, 19.0, 11.4, '#5bc0de')
  stool(c, 17.9, 12.9, '#f0b35a')
  plant(c, 19.2, 13.0)

  addPartition(c, 'y', 8, 0, GRID_W, DOORS.gy8)
  addPartition(c, 'x', 11, 0, 8, DOORS.gx11)
  addPartition(c, 'x', 6, 8, GRID_H, DOORS.gx6)
  addPartition(c, 'x', 16, 8, GRID_H, DOORS.gx16)
}

function drawFloor(ctx: CanvasRenderingContext2D): void {
  for (let gy = 0; gy < GRID_H; gy++) {
    for (let gx = 0; gx < GRID_W; gx++) {
      const room = roomAt(gx + 0.5, gy + 0.5)
      fillFloorRect(ctx, gx, gy, 1, 1, (gx + gy) % 2 === 0 ? room.floorA : room.floorB)
    }
  }
  fillFloorRect(ctx, 7.0, 9.9, 4.2, 2.8, '#8a6fb8')
  fillFloorRect(ctx, 7.25, 10.15, 3.7, 2.3, '#a38ad2')
  fillFloorRect(ctx, 7.5, 10.4, 3.2, 1.8, '#8a6fb8')
  fillFloorRect(ctx, 12.4, 1.5, 6.6, 4.8, '#3d747c')
  fillFloorRect(ctx, 12.6, 1.7, 6.2, 4.4, '#44818a')
  fillFloorRect(ctx, 2.0, 8.2, 0.35, 5.8, '#2b303d')
  fillFloorRect(ctx, 3.85, 0.2, 0.7, 7.6, '#c9a171') // runner rug down the dev room aisle
  for (const [a, b] of DOORS.gy8) fillFloorRect(ctx, a + 0.1, 7.55, b - a - 0.2, 0.9, 'rgba(255,255,255,0.18)')
}

function drawShadows(ctx: CanvasRenderingContext2D, shadows: Footprint[]): void {
  for (const s of shadows) fillFloorRect(ctx, s.gx + 0.12, s.gy + 0.12, s.w, s.d, 'rgba(10,12,24,0.22)')
}

function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas is not available')
  ctx.imageSmoothingEnabled = false
  return { canvas, ctx }
}

export function buildOffice(): Office {
  const margin = 24
  const minX = Math.floor(project(0, GRID_H).x) - margin - TILE_W / 2
  const maxX = Math.ceil(project(GRID_W, 0).x) + margin + TILE_W / 2
  const minY = Math.floor(project(0, -0.5, WALL_H).y) - margin
  const maxY = Math.ceil(project(GRID_W, GRID_H).y) + margin + TILE_H
  const width = maxX - minX
  const height = maxY - minY

  const c = new Collector()
  buildProps(c)

  // Base layer: floor, walls, decor, shadows and the room plates are drawn by the world later.
  const { canvas: base, ctx } = makeCanvas(width, height)
  ctx.translate(-minX, -minY)
  drawFloor(ctx)
  drawOuterWalls(ctx)
  drawWallDecor(ctx)
  drawShadows(ctx, c.shadows)

  // Furniture: one cached sprite per prop.
  c.drawables.sort((a, b) => a.key - b.key)
  const props: Prop[] = c.drawables.map((d) => {
    const pad = 0.35
    const r = d.rect
    const x0 = Math.floor(project(r.gx - pad, r.gy + r.d + pad).x) - 4
    const x1 = Math.ceil(project(r.gx + r.w + pad, r.gy - pad).x) + 4
    const y0 = Math.floor(project(r.gx - pad, r.gy - pad, d.h + 2).y) - 4
    const y1 = Math.ceil(project(r.gx + r.w + pad, r.gy + r.d + pad, 0).y) + 4
    const { canvas, ctx: pctx } = makeCanvas(x1 - x0, y1 - y0)
    pctx.translate(-x0, -y0)
    d.draw(pctx)
    return { key: d.key, rect: d.rect, sprite: canvas, sx: x0 - minX, sy: y0 - minY }
  })

  return { width, height, minX, minY, base, props, solids: c.drawables.map((d) => d.rect) }
}

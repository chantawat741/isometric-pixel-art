// Low-level pixel-art drawing helpers. Everything is drawn with integer fillRect calls so the
// result has hard pixel edges (no anti-aliasing) and tiles together without gaps.

export interface Pt {
  x: number
  y: number
}

export const TILE_W = 32
export const TILE_H = 16

/** Grid (gx, gy) + height gz -> world pixel position (2:1 isometric). */
export function project(gx: number, gy: number, gz = 0): Pt {
  return { x: (gx - gy) * (TILE_W / 2), y: (gx + gy) * (TILE_H / 2) - gz }
}

/** Fill a convex polygon with a scanline rasteriser that samples pixel centres. */
export function fillPoly(ctx: CanvasRenderingContext2D, pts: Pt[], color: string): void {
  ctx.fillStyle = color
  let minY = Infinity
  let maxY = -Infinity
  for (const p of pts) {
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  const y0 = Math.round(minY)
  const y1 = Math.round(maxY)
  for (let y = y0; y < y1; y++) {
    const sy = y + 0.5
    let xl = Infinity
    let xr = -Infinity
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if (a.y === b.y) continue
      const lo = a.y < b.y ? a : b
      const hi = a.y < b.y ? b : a
      if (sy < lo.y || sy >= hi.y) continue
      const x = lo.x + ((hi.x - lo.x) * (sy - lo.y)) / (hi.y - lo.y)
      if (x < xl) xl = x
      if (x > xr) xr = x
    }
    if (xr > xl) {
      const l = Math.round(xl)
      const r = Math.round(xr)
      if (r > l) ctx.fillRect(l, y, r - l, 1)
    }
  }
}

export function shade(hex: string, factor: number): string {
  const n = parseInt(hex.slice(1), 16)
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * factor)))
  const r = c((n >> 16) & 255)
  const g = c((n >> 8) & 255)
  const b = c(n & 255)
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`
}

export interface BoxColors {
  top: string
  left: string // face looking towards +gy (lower-left on screen)
  right: string // face looking towards +gx (lower-right on screen)
}

/** Light comes from the upper-left: top is brightest, right face is darkest. */
export function palette(base: string): BoxColors {
  return { top: shade(base, 1.22), left: shade(base, 0.96), right: shade(base, 0.74) }
}

/** Solid isometric box with footprint (w x d) tiles and height h pixels, standing at height gz. */
export function drawBox(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  gz: number,
  w: number,
  d: number,
  h: number,
  colors: BoxColors
): void {
  const zt = gz + h
  fillPoly(ctx, [project(gx, gy, zt), project(gx + w, gy, zt), project(gx + w, gy + d, zt), project(gx, gy + d, zt)], colors.top)
  fillPoly(ctx, [project(gx, gy + d, zt), project(gx + w, gy + d, zt), project(gx + w, gy + d, gz), project(gx, gy + d, gz)], colors.left)
  fillPoly(ctx, [project(gx + w, gy + d, zt), project(gx + w, gy, zt), project(gx + w, gy, gz), project(gx + w, gy + d, gz)], colors.right)
}

/** Flat patch on the floor (or any horizontal plane at height z). */
export function fillFloorRect(
  ctx: CanvasRenderingContext2D,
  gx: number,
  gy: number,
  w: number,
  d: number,
  color: string,
  z = 0
): void {
  fillPoly(ctx, [project(gx, gy, z), project(gx + w, gy, z), project(gx + w, gy + d, z), project(gx, gy + d, z)], color)
}

/** Rectangle on the vertical plane gy = const (a wall that faces +gy), spanning gx a..b, z z0..z1. */
export function fillWallY(ctx: CanvasRenderingContext2D, gy: number, a: number, b: number, z0: number, z1: number, color: string): void {
  fillPoly(ctx, [project(a, gy, z1), project(b, gy, z1), project(b, gy, z0), project(a, gy, z0)], color)
}

/** Rectangle on the vertical plane gx = const (a wall that faces +gx), spanning gy a..b, z z0..z1. */
export function fillWallX(ctx: CanvasRenderingContext2D, gx: number, a: number, b: number, z0: number, z1: number, color: string): void {
  fillPoly(ctx, [project(gx, a, z1), project(gx, b, z1), project(gx, b, z0), project(gx, a, z0)], color)
}

export function dot(ctx: CanvasRenderingContext2D, p: Pt, color: string, size = 1): void {
  ctx.fillStyle = color
  ctx.fillRect(Math.round(p.x), Math.round(p.y), size, size)
}

/** Deterministic pseudo random generator so the office always looks the same. */
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- 3x5 pixel font (letters, digits and a few symbols) -------------------------------------

const FONT: Record<string, string[]> = {
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['###', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '###', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  '2': ['##.', '..#', '.#.', '#..', '###'],
  '3': ['##.', '..#', '.#.', '..#', '##.'],
  '-': ['...', '...', '###', '...', '...'],
  ' ': ['...', '...', '...', '...', '...']
}

export function textWidth(text: string): number {
  return text.length * 4 - 1
}

export function drawPixelText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string): void {
  ctx.fillStyle = color
  let cx = Math.round(x)
  const cy = Math.round(y)
  for (const ch of text.toUpperCase()) {
    const glyph = FONT[ch] ?? FONT[' ']
    for (let r = 0; r < 5; r++) {
      for (let c = 0; c < 3; c++) {
        if (glyph[r][c] === '#') ctx.fillRect(cx + c, cy + r, 1, 1)
      }
    }
    cx += 4
  }
}

/** Small dark name plate with pixel text, centred on (cx, cy). */
export function drawPlate(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, accent: string): void {
  const w = textWidth(text) + 8
  const h = 11
  const x = Math.round(cx - w / 2)
  const y = Math.round(cy - h / 2)
  ctx.fillStyle = '#0d1018'
  ctx.fillRect(x, y, w, h)
  ctx.fillStyle = accent
  ctx.fillRect(x, y, w, 1)
  ctx.fillRect(x, y + h - 1, w, 1)
  ctx.fillRect(x, y + 1, 1, h - 2)
  ctx.fillRect(x + w - 1, y + 1, 1, h - 2)
  drawPixelText(ctx, text, x + 4, y + 3, '#f2f4fa')
}

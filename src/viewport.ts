// Camera for the office bitmap: zoom, pan and fit-to-view.
// (cx, cy) is the world pixel shown at the centre of the screen.

export const MIN_ZOOM = 0.3
export const MAX_ZOOM = 8

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

export class Viewport {
  zoom = 1
  cx = 0
  cy = 0
  vw = 1
  vh = 1

  constructor(
    readonly worldW: number,
    readonly worldH: number
  ) {
    this.cx = worldW / 2
    this.cy = worldH / 2
  }

  resize(vw: number, vh: number): void {
    this.vw = Math.max(1, vw)
    this.vh = Math.max(1, vh)
    this.clampCenter()
  }

  /** Screen pixels at the left / right edge covered by docks: `fit` centres the office between them. */
  insetL = 0
  insetR = 0

  /**
   * Largest zoom that fits: whole numbers (crisp pixels), plus a half step when the free strip is too
   * narrow for the next whole number (the docks take space); below 1x the exact fractional fit.
   */
  fit(): void {
    const free = Math.max(1, this.vw - this.insetL - this.insetR)
    const z = Math.min(free / this.worldW, this.vh / this.worldH) * 0.97
    const whole = Math.floor(z)
    // A quarter of a step is enough for the half step: a corner may slip a little under a dock,
    // which beats leaving the office small, and the docks fold away.
    this.zoom = clamp(z < 1 ? z : z - whole >= 0.25 ? whole + 0.5 : whole, MIN_ZOOM, MAX_ZOOM)
    // The office centre should land in the middle of the free strip, not of the whole screen.
    this.cx = this.worldW / 2 - (this.insetL - this.insetR) / 2 / this.zoom
    this.cy = this.worldH / 2
  }

  actualSize(): void {
    this.zoom = 1
    this.cx = this.worldW / 2
    this.cy = this.worldH / 2
    this.clampCenter()
  }

  /** Zoom by a factor while keeping the world point under screen position (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const next = clamp(this.zoom * factor, MIN_ZOOM, MAX_ZOOM)
    if (next === this.zoom) return
    const wx = this.cx + (sx - this.vw / 2) / this.zoom
    const wy = this.cy + (sy - this.vh / 2) / this.zoom
    this.zoom = next
    this.cx = wx - (sx - this.vw / 2) / this.zoom
    this.cy = wy - (sy - this.vh / 2) / this.zoom
    this.clampCenter()
  }

  /** Step to the next whole zoom level (used by the +/- buttons). */
  step(direction: 1 | -1): void {
    const z = this.zoom
    const next = direction > 0 ? (Number.isInteger(z) ? z + 1 : Math.ceil(z)) : Number.isInteger(z) ? z - 1 : Math.floor(z)
    const target = clamp(next < 1 ? (direction < 0 ? z / 1.25 : 1) : next, MIN_ZOOM, MAX_ZOOM)
    this.zoomAt(target / this.zoom, this.vw / 2, this.vh / 2)
  }

  panBy(dxScreen: number, dyScreen: number): void {
    this.cx -= dxScreen / this.zoom
    this.cy -= dyScreen / this.zoom
    this.clampCenter()
  }

  /** Keep at least a sliver of the office on screen. */
  private clampCenter(): void {
    this.cx = clamp(this.cx, 0, this.worldW)
    this.cy = clamp(this.cy, 0, this.worldH)
  }

  /** Top-left of the world bitmap in screen pixels. */
  originX(): number {
    return Math.round(this.vw / 2 - this.cx * this.zoom)
  }

  originY(): number {
    return Math.round(this.vh / 2 - this.cy * this.zoom)
  }
}

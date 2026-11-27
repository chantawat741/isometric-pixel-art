// Composites one frame of the office: base layer + furniture sprites + characters, depth sorted.
// The result lives in `canvas` (office bitmap coordinates); the camera just blits it.

import { bubbleFor, drawBubble, drawCharacter, drawConfetti, drawRing, drawTag, LOOKS, STATUS_COLOR } from './character'
import type { BubbleKind } from './character'
import { drawPlate, project } from './gfx'
import { ROOMS } from './rooms'
import type { Character, Sim } from './sim'
import type { Office, Prop } from './scene'

export class World {
  readonly canvas: HTMLCanvasElement
  private readonly ctx: CanvasRenderingContext2D
  selectedId: string | null = null

  constructor(
    readonly office: Office,
    readonly sim: Sim
  ) {
    this.canvas = document.createElement('canvas')
    this.canvas.width = office.width
    this.canvas.height = office.height
    const ctx = this.canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas is not available')
    ctx.imageSmoothingEnabled = false
    this.ctx = ctx
  }

  /** Feet position of a character in bitmap coordinates. */
  feet(ch: Character): { x: number; y: number } {
    const p = project(ch.gx, ch.gy, 0)
    return { x: p.x - this.office.minX, y: p.y - this.office.minY }
  }

  /** The character under a bitmap-space point, nearest to the camera first. */
  hitTest(wx: number, wy: number): string | null {
    let best: Character | null = null
    for (const ch of this.sim.chars.values()) {
      const f = this.feet(ch)
      if (wx >= f.x - 8 && wx <= f.x + 8 && wy >= f.y - 28 && wy <= f.y + 3) {
        if (!best || ch.gx + ch.gy > best.gx + best.gy) best = ch
      }
    }
    return best ? best.info.id : null
  }

  compose(): void {
    const { ctx, office } = this
    ctx.clearRect(0, 0, office.width, office.height)
    ctx.drawImage(office.base, 0, 0)

    // Selection ring goes on the floor, under everything standing on it.
    const sel = this.selectedId ? this.sim.chars.get(this.selectedId) : undefined
    if (sel) {
      const f = this.feet(sel)
      drawRing(ctx, f.x, f.y, '#fdfdfd')
    }

    const props = office.props
    const slots: Character[][] = Array.from({ length: props.length + 1 }, () => [])
    for (const ch of this.sim.chars.values()) slots[slotFor(props, ch)].push(ch)

    for (let i = 0; i <= props.length; i++) {
      slots[i].sort((a, b) => a.gx + a.gy - (b.gx + b.gy))
      for (const ch of slots[i]) this.drawChar(ch)
      if (i < props.length) ctx.drawImage(props[i].sprite, props[i].sx, props[i].sy)
    }

    // Overlays: room plates, bubbles, name tags and confetti stay readable on top.
    for (const r of ROOMS) {
      const p = project(r.label.gx, r.label.gy, 0)
      drawPlate(ctx, r.name, p.x - office.minX, p.y - office.minY, r.accent)
    }
    for (const ch of this.sim.chars.values()) {
      const f = this.feet(ch)
      const top = f.y - (ch.pose === 'sit' ? 24 : 26) - this.lift(ch)
      // A sprout marks an agent Orca just reported (live mode only), until it has something to say.
      const kind: BubbleKind | null = bubbleFor(ch.mood) ?? (ch.info.details && ch.age < 6 ? 'new' : null)
      if (kind) drawBubble(ctx, f.x, top, kind, ch.t)
      if (ch.mood === 'celebrate') drawConfetti(ctx, f.x, f.y - this.lift(ch), ch.t)
      drawTag(ctx, ch.info.name, f.x, f.y + 4, STATUS_COLOR[ch.info.status], ch.info.id === this.selectedId)
    }
  }

  /**
   * Where the message above a character's head is anchored, in world pixels: just above the icon
   * bubble when it has one, else just above the head.
   */
  noteAnchor(ch: Character): { x: number; y: number } {
    const f = this.feet(ch)
    const top = f.y - (ch.pose === 'sit' ? 24 : 26) - this.lift(ch)
    const bubble = bubbleFor(ch.mood) ?? (ch.info.details && ch.age < 6 ? 'new' : null)
    return { x: f.x, y: top - (bubble ? 18 : 3) }
  }

  private lift(ch: Character): number {
    if (ch.info.status !== 'celebrating' || ch.seated || ch.mode === 'walking') return 0
    return Math.round(Math.abs(Math.sin(ch.t * 7)) * 5)
  }

  private drawChar(ch: Character): void {
    const f = this.feet(ch)
    drawCharacter(this.ctx, f.x, f.y, LOOKS[ch.lookId], {
      pose: ch.pose,
      view: ch.view,
      flip: ch.flip,
      t: ch.t,
      mood: ch.mood,
      lift: this.lift(ch)
    })
  }
}

/**
 * Index of the prop this character must be drawn *before* (props.length = in front of everything).
 * Seated characters sort by the chair's depth key; walkers go behind the first prop whose far
 * corner is beyond them on both axes.
 */
function slotFor(props: Prop[], ch: Character): number {
  if (ch.seated) {
    const k = ch.seatKey
    for (let i = 0; i < props.length; i++) if (props[i].key > k) return i
    return props.length
  }
  for (let i = 0; i < props.length; i++) {
    const r = props[i].rect
    if (ch.gx < r.gx + r.w && ch.gy < r.gy + r.d) return i
  }
  return props.length
}

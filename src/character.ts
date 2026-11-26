// Procedural pixel-art characters in a chibi office-worker style (big head, suit / blouse):
// 14 looks (6 men, 8 women; suit, hoodie, lab coat, sweater or safety vest), front/back views,
// six facial expressions and icon speech bubbles.
// Everything is a handful of integer fillRect calls (no image assets), anchored at the feet.

import { shade, drawPixelText, textWidth } from './gfx'

export type Pose = 'stand' | 'walk' | 'sit'
/** What the character feels like: picks the face, arms and bubble icon. */
export type Mood = 'none' | 'think' | 'wait' | 'blocked' | 'done' | 'celebrate' | 'fail'
export type HairStyle = 'short' | 'side' | 'spiky' | 'ponytail' | 'bob' | 'bun' | 'long'
export type Accessory = 'none' | 'glasses' | 'headset' | 'beanie' | 'beret' | 'cap'
export type Body = 'm' | 'f'
/** What they wear on top: the default suit / blouse, or a work outfit for another kind of job. */
export type Outfit = 'suit' | 'hoodie' | 'labcoat' | 'sweater' | 'vest'

export interface Look {
  name: string
  body: Body
  skin: string
  hair: string
  hairStyle: HairStyle
  /** Suit jacket / blouse / hoodie / sweater colour (the shirt under a vest). */
  jacket: string
  /** Tie (men) or neck bow (women); the shirt under a lab coat; the vest colour. */
  accent: string
  pants: string
  shoes: string
  accessory: Accessory
  /** Defaults to 'suit'. */
  outfit?: Outfit
  /** Colour of a beanie, beret or cap. */
  hat?: string
}

export const LOOKS: Look[] = [
  { name: 'Ken', body: 'm', skin: '#f1c9a5', hair: '#6b3f26', hairStyle: 'short', jacket: '#4b5160', accent: '#d64550', pants: '#3a3f4c', shoes: '#1d2230', accessory: 'none' },
  { name: 'Yuki', body: 'f', skin: '#f6d6bd', hair: '#7a4a2a', hairStyle: 'ponytail', jacket: '#d9c3a0', accent: '#b5704a', pants: '#b89a72', shoes: '#6b4a2f', accessory: 'none' },
  { name: 'Ray', body: 'm', skin: '#d9a47a', hair: '#1a1a22', hairStyle: 'spiky', jacket: '#2f5fa8', accent: '#f4f6fa', pants: '#2b2f3a', shoes: '#1d2230', accessory: 'glasses' },
  { name: 'Mina', body: 'f', skin: '#e6b48a', hair: '#26211f', hairStyle: 'bob', jacket: '#e86d9a', accent: '#fff3f8', pants: '#5a3a52', shoes: '#2b2f3a', accessory: 'headset' },
  { name: 'Leo', body: 'm', skin: '#a96f4b', hair: '#2a1a12', hairStyle: 'side', jacket: '#3f7d5c', accent: '#ffd23f', pants: '#2f3b52', shoes: '#f4f6fa', accessory: 'none' },
  { name: 'Sora', body: 'f', skin: '#f1c9a5', hair: '#8a3fc0', hairStyle: 'bun', jacket: '#7a5fb8', accent: '#f4f6fa', pants: '#3a3f6a', shoes: '#2b2f3a', accessory: 'glasses' },
  { name: 'Dan', body: 'm', skin: '#c98e62', hair: '#d9a441', hairStyle: 'spiky', jacket: '#d98a3d', accent: '#2b2f3a', pants: '#3a3f4c', shoes: '#1d2230', accessory: 'headset' },
  { name: 'Hana', body: 'f', skin: '#7a4f35', hair: '#101014', hairStyle: 'long', jacket: '#4cc3c9', accent: '#f4f6fa', pants: '#2f4a5a', shoes: '#f4f6fa', accessory: 'none' },
  // work outfits for other kinds of jobs: developer, data scientist, ops, designer
  { name: 'Kai', body: 'm', skin: '#e9bd96', hair: '#3b2a20', hairStyle: 'short', jacket: '#3d4a63', accent: '#f4f6fa', pants: '#23283a', shoes: '#f4f6fa', accessory: 'beanie', outfit: 'hoodie', hat: '#e0674a' },
  { name: 'Nova', body: 'f', skin: '#f2cdb0', hair: '#1c2a4a', hairStyle: 'long', jacket: '#f4f6fa', accent: '#4cb6a8', pants: '#3a4a64', shoes: '#2b2f3a', accessory: 'glasses', outfit: 'labcoat' },
  { name: 'Max', body: 'm', skin: '#b87d57', hair: '#1a1410', hairStyle: 'short', jacket: '#5a6272', accent: '#f08a24', pants: '#2f3340', shoes: '#4a3a2a', accessory: 'cap', outfit: 'vest', hat: '#2f6fb0' },
  { name: 'Ivy', body: 'f', skin: '#d9a47a', hair: '#5a2a1f', hairStyle: 'bob', jacket: '#e9d5b8', accent: '#d9486a', pants: '#2b2f3a', shoes: '#8a4a3a', accessory: 'beret', outfit: 'sweater', hat: '#d9486a' },
  // support desk and analyst
  { name: 'Pim', body: 'f', skin: '#a9714d', hair: '#2b1d3a', hairStyle: 'ponytail', jacket: '#58b89a', accent: '#f4f6fa', pants: '#3a4a64', shoes: '#f4f6fa', accessory: 'headset', outfit: 'hoodie' },
  { name: 'Dara', body: 'f', skin: '#fbe0cc', hair: '#c9772e', hairStyle: 'bun', jacket: '#d9a43a', accent: '#6a4a9a', pants: '#3a3f4c', shoes: '#6b4a2f', accessory: 'glasses', outfit: 'sweater' }
]

export interface SpriteState {
  pose: Pose
  view: 'front' | 'back'
  flip: boolean
  /** Seconds, drives every animation. */
  t: number
  mood: Mood
  /** Pixels the character is lifted off the ground (jumping). */
  lift: number
}

const INK = '#1d2230'
const MOUTH = '#8a2f3a'

/** Draw a character with its feet at (x, y) in the context's pixel space. About 23 px tall. */
export function drawCharacter(ctx: CanvasRenderingContext2D, x: number, y: number, look: Look, s: SpriteState): void {
  const fx = Math.round(x)
  const ground = Math.round(y)
  const fy = ground - Math.round(s.lift)
  const sgn = s.flip ? -1 : 1
  const R = (color: string, px: number, z: number, w: number, h: number): void => {
    ctx.fillStyle = color
    ctx.fillRect(fx + (sgn > 0 ? px : -(px + w)), fy - (z + h), w, h)
  }

  const frame = Math.floor(s.t * 8) % 4
  const seated = s.pose === 'sit'
  const walking = s.pose === 'walk'
  const front = s.view === 'front'
  const woman = look.body === 'f'

  if (!seated) {
    ctx.fillStyle = 'rgba(10,12,24,0.28)'
    ctx.fillRect(fx - 4, ground - 1, 8, 1)
    ctx.fillRect(fx - 3, ground, 6, 1)
  }

  const hip = seated ? 4 : 5
  const bob = walking && frame % 2 === 1 ? 1 : 0
  const base = hip + bob
  const headZ = base + 8

  // head sway: nervous shake when blocked, small fidget when idle
  let hdx = 0
  if (s.mood === 'blocked') hdx = Math.floor(s.t * 12) % 2 === 0 ? -1 : 1
  else if (s.pose === 'stand' && s.mood === 'none' && Math.floor(s.t * 0.8) % 4 === 3) hdx = 1
  const blink = Math.floor(s.t * 3.3) % 11 === 0

  // --- legs / skirt ---------------------------------------------------------------------
  if (!seated) {
    const liftL = walking && frame === 1 ? 2 : 0
    const liftR = walking && frame === 3 ? 2 : 0
    if (woman) {
      R(look.skin, -3, 1 + liftL, 2, 2)
      R(look.skin, 1, 1 + liftR, 2, 2)
      R(look.shoes, -3, liftL, 2, 1)
      R(look.shoes, 1, liftR, 2, 1)
      R(look.pants, -4, 3, 8, 3 + bob) // skirt
      R(shade(look.pants, 0.8), -4, 3, 8, 1)
    } else {
      R(look.pants, -3, 1 + liftL, 3, 4 - liftL + bob)
      R(look.pants, 0, 1 + liftR, 3, 4 - liftR + bob)
      R(look.shoes, -3, liftL, 3, 1)
      R(look.shoes, 0, liftR, 3, 1)
    }
  } else if (woman) {
    R(look.pants, -4, base - 1, 8, 2)
  }

  // --- torso ----------------------------------------------------------------------------
  R(look.jacket, -4, base, 8, 8)
  R(shade(look.jacket, 0.78), -4, base, 8, 1)
  R(shade(look.jacket, 1.15), -4, base + 7, 8, 1)
  const outfit = look.outfit ?? 'suit'
  if (outfit !== 'suit') {
    drawOutfit(R, look, outfit, front, base)
  } else if (front) {
    if (woman) {
      R('#fbf6ee', -2, base + 6, 4, 2) // collar
      R(look.accent, -1, base + 5, 2, 2) // bow
    } else {
      R('#fbf6ee', -2, base + 4, 4, 4) // shirt front
      R(shade(look.jacket, 0.85), -3, base + 3, 1, 5) // lapels
      R(shade(look.jacket, 0.85), 2, base + 3, 1, 5)
      R(look.accent, -1, base + 1, 2, 6) // tie
      R(shade(look.accent, 0.7), -1, base + 1, 2, 1)
    }
  } else if (woman) {
    R(shade(look.jacket, 0.9), -4, base + 4, 8, 1)
  }

  // --- arms -----------------------------------------------------------------------------
  const sleeve = shade(look.jacket, 0.9)
  const armsUp = s.mood === 'done' || s.mood === 'celebrate'
  if (armsUp) {
    const alt = s.mood === 'celebrate' && frame % 2 === 0
    const lh = alt ? 9 : 6
    const rh = alt ? 6 : 9
    R(sleeve, -5, base + 3, 1, lh)
    R(look.skin, -5, base + 3 + lh, 1, 1)
    R(sleeve, 4, base + 3, 1, rh)
    R(look.skin, 4, base + 3 + rh, 1, 1)
  } else if (s.mood === 'fail') {
    // hands over the eyes
    R(sleeve, -5, base + 2, 1, 7)
    R(look.skin, -5, base + 9, 1, 2)
    R(sleeve, 4, base + 2, 1, 7)
    R(look.skin, 4, base + 9, 1, 2)
  } else if (s.mood === 'blocked') {
    // fists up, shouting
    const up = Math.floor(s.t * 6) % 2
    R(sleeve, -5, base + 2, 1, 5 + up)
    R(look.skin, -5, base + 7 + up, 1, 1)
    R(sleeve, 4, base + 2, 1, 5 + (1 - up))
    R(look.skin, 4, base + 7 + (1 - up), 1, 1)
  } else if (s.mood === 'think' || s.mood === 'wait') {
    R(sleeve, -5, base + 1, 1, 6)
    R(look.skin, -5, base, 1, 1)
    R(sleeve, 4, base + 1, 1, 4)
    R(look.skin, 4, base + 5, 1, 1)
  } else {
    const swing = walking ? [0, 1, 0, -1][frame] : 0
    const typing = seated ? (Math.floor(s.t * 6) % 2 === 0 ? 1 : 0) : 0
    R(sleeve, -5, base + 1 + swing - typing, 1, 6)
    R(look.skin, -5, base + swing - typing, 1, 1)
    R(sleeve, 4, base + 1 - swing, 1, 6)
    R(look.skin, 4, base - swing, 1, 1)
  }

  // --- head -----------------------------------------------------------------------------
  const hx = hdx
  const faceSkin = s.mood === 'blocked' ? mix(look.skin, '#ff6b5a', 0.55) : look.skin
  R(faceSkin, -4 + hx, headZ, 8, 9)
  R(faceSkin, -5 + hx, headZ + 1, 10, 7)

  if (front) drawFace(R, look, s.mood, hx, headZ, blink, s.t)

  drawHair(R, look, front, hx, headZ)

  // --- accessories ----------------------------------------------------------------------
  if (front && look.accessory === 'glasses') {
    const f = '#7b8499'
    for (const lx of [-4, 1]) {
      R(f, lx + hx, headZ + 5, 3, 1)
      R(f, lx + hx, headZ + 2, 3, 1)
      R(f, lx + hx, headZ + 3, 1, 2)
      R(f, lx + 2 + hx, headZ + 3, 1, 2)
      R('rgba(210,235,250,0.55)', lx + 1 + hx, headZ + 3, 1, 2)
    }
    R(f, -1 + hx, headZ + 4, 2, 1)
  }
  drawHat(R, look, front, hx, headZ)
  if (look.accessory === 'headset') {
    const hs = '#2b2f3a'
    R(hs, -6 + hx, headZ + 3, 1, 4)
    R(hs, 5 + hx, headZ + 3, 1, 4)
    R(hs, -5 + hx, headZ + 9, 10, 1)
    if (front) {
      R(hs, -5 + hx, headZ + 1, 4, 1)
      R('#e86d5a', -5 + hx, headZ + 1, 1, 1)
    }
  }

  // --- sparkles on a happy face ---------------------------------------------------------
  if (s.mood === 'done' || s.mood === 'celebrate') {
    const on = Math.floor(s.t * 4) % 2 === 0
    const c = on ? '#ffe45c' : '#fff3a8'
    sparkle(R, c, -9, headZ + 7)
    sparkle(R, on ? '#fff3a8' : '#ffe45c', 8, headZ + 3)
  }
}

type Rect = (color: string, px: number, z: number, w: number, h: number) => void

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16)
  const pb = parseInt(b.slice(1), 16)
  const ch = (shift: number): number => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t)
  return `#${((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1)}`
}

function sparkle(R: Rect, color: string, px: number, z: number): void {
  R(color, px, z - 1, 1, 3)
  R(color, px - 1, z, 3, 1)
}

function drawFace(R: Rect, look: Look, mood: Mood, hx: number, z: number, blink: boolean, t: number): void {
  const eyeL = -3 + hx
  const eyeR = 2 + hx
  const cheek = mix(look.skin, '#ff8a8a', 0.5)
  switch (mood) {
    case 'done':
    case 'celebrate': {
      // happy closed-eye arcs and a wide open smile
      for (const ex of [eyeL, eyeR]) {
        R(INK, ex - 1, z + 3, 1, 1)
        R(INK, ex, z + 4, 1, 1)
        R(INK, ex + 1, z + 3, 1, 1)
      }
      R(cheek, -4 + hx, z + 2, 1, 1)
      R(cheek, 3 + hx, z + 2, 1, 1)
      if (mood === 'celebrate') {
        R(MOUTH, -2 + hx, z, 4, 3)
        R('#e8788a', -1 + hx, z, 2, 1)
      } else {
        R(MOUTH, -2 + hx, z + 1, 4, 1)
        R(MOUTH, -3 + hx, z + 2, 1, 1)
        R(MOUTH, 2 + hx, z + 2, 1, 1)
      }
      break
    }
    case 'blocked': {
      // angry: slanted brows, red face, shouting mouth
      R(INK, eyeL, z + 3, 1, 2)
      R(INK, eyeR, z + 3, 1, 2)
      R(INK, -4 + hx, z + 6, 1, 1)
      R(INK, -3 + hx, z + 5, 2, 1)
      R(INK, 3 + hx, z + 6, 1, 1)
      R(INK, 1 + hx, z + 5, 2, 1)
      R(MOUTH, -2 + hx, z + 1, 4, 2)
      R('#fbf6ee', -1 + hx, z + 2, 2, 1)
      break
    }
    case 'fail': {
      // crying: closed eyes, falling tears, sad mouth
      R(INK, eyeL - 1, z + 3, 2, 1)
      R(INK, eyeR, z + 3, 2, 1)
      const drop = Math.floor(t * 6) % 3
      R('#6fb9e6', eyeL - 1, z - 1 + drop, 1, 4 - drop)
      R('#6fb9e6', eyeR + 1, z - 1 + drop, 1, 4 - drop)
      R(INK, -1 + hx, z + 1, 2, 1)
      R(INK, -2 + hx, z, 1, 1)
      R(INK, 1 + hx, z, 1, 1)
      break
    }
    case 'wait': {
      // worried: raised brows, small mouth, sweat drop
      R(INK, eyeL, z + 3, 1, blink ? 1 : 2)
      R(INK, eyeR, z + 3, 1, blink ? 1 : 2)
      R(INK, -4 + hx, z + 5, 2, 1)
      R(INK, 2 + hx, z + 5, 2, 1)
      R(INK, -1 + hx, z + 1, 2, 1)
      R('#6fb9e6', 4 + hx, z + 5, 1, 2)
      break
    }
    default: {
      // focused / thinking
      R(INK, eyeL, z + 3, 1, blink ? 1 : 2)
      R(INK, eyeR, z + 3, 1, blink ? 1 : 2)
      R('#b5654a', -1 + hx, z + 1, 2, 1)
      if (mood === 'think') R(look.skin, 1 + hx, z, 3, 2) // hand at the chin
    }
  }
}

/** The torso details of a non-suit outfit (the plain jacket-coloured torso is drawn by the caller). */
function drawOutfit(R: Rect, look: Look, outfit: Outfit, front: boolean, base: number): void {
  const dark = shade(look.jacket, 0.85)
  switch (outfit) {
    case 'hoodie':
      R(dark, -4, base + 7, 8, 1) // hood bunched at the neck
      if (front) {
        R(dark, -2, base + 1, 4, 2) // front pocket
        R('#f4f6fa', -2, base + 3, 1, 4) // drawstrings
        R('#f4f6fa', 1, base + 3, 1, 4)
      } else {
        R(dark, -3, base + 3, 6, 4) // hood hanging down the back
      }
      break
    case 'labcoat':
      if (front) {
        R(look.accent, -1, base + 4, 2, 4) // shirt under the coat
        R(shade(look.jacket, 0.8), 0, base, 1, 4) // centre seam
        R(shade(look.jacket, 0.85), -3, base + 2, 2, 2) // pocket
        R('#5a6a88', -3, base + 3, 1, 1) // pen
      } else {
        R(shade(look.jacket, 0.88), 0, base, 1, 8)
      }
      break
    case 'sweater':
      R(shade(look.jacket, 1.1), -3, base + 7, 6, 1) // turtleneck
      R(look.accent, -4, base + 4, 8, 1) // stripe
      R(look.accent, -4, base + 2, 8, 1)
      break
    case 'vest':
      if (front) {
        R(look.accent, -4, base, 3, 7) // vest panels over the shirt
        R(look.accent, 1, base, 3, 7)
        R('#f4f6fa', -4, base + 2, 3, 1) // reflective stripes
        R('#f4f6fa', 1, base + 2, 3, 1)
        R('#fbf6ee', -1, base + 6, 2, 1) // collar
      } else {
        R(look.accent, -4, base, 8, 7)
        R('#f4f6fa', -4, base + 2, 8, 1)
      }
      break
  }
}

/** Beanie, beret or cap, drawn over the hair (looks that wear one use short hair). */
function drawHat(R: Rect, look: Look, front: boolean, hx: number, z: number): void {
  const c = look.hat ?? '#c0392b'
  switch (look.accessory) {
    case 'beanie':
      R(c, -5 + hx, z + 7, 10, 4)
      R(shade(c, 0.8), -5 + hx, z + 7, 10, 1) // folded cuff
      R('#f4f6fa', -1 + hx, z + 11, 2, 2) // pom-pom
      break
    case 'beret':
      R(c, -5 + hx, z + 7, 10, 2)
      R(c, -4 + hx, z + 9, 8, 1)
      R(c, -3 + hx, z + 10, 5, 1)
      R(c, 0 + hx, z + 11, 1, 1) // stalk
      R(c, -6 + hx, z + 7, 1, 1)
      break
    case 'cap':
      if (front) {
        R(c, -5 + hx, z + 8, 10, 2)
        R(c, -4 + hx, z + 10, 8, 1)
        R(shade(c, 0.7), -6 + hx, z + 7, 12, 1) // brim
      } else {
        R(c, -5 + hx, z + 7, 10, 3)
        R(c, -4 + hx, z + 10, 8, 1)
      }
      break
  }
}

function drawHair(R: Rect, look: Look, front: boolean, hx: number, z: number): void {
  const h = look.hair
  const top = (): void => {
    R(h, -5 + hx, z + 7, 10, 2)
    R(h, -4 + hx, z + 9, 8, 1)
  }
  if (!front) {
    R(h, -4 + hx, z, 8, 9)
    R(h, -5 + hx, z + 1, 10, 8)
    R(h, -4 + hx, z + 9, 8, 1)
    if (look.hairStyle === 'bob') R(h, -5 + hx, z - 1, 10, 3)
    if (look.hairStyle === 'long') R(h, -5 + hx, z - 4, 10, 6)
    if (look.hairStyle === 'ponytail') R(h, 0 + hx, z - 3, 3, 5)
    if (look.hairStyle === 'bun') R(h, -2 + hx, z + 10, 4, 2)
    if (look.hairStyle === 'spiky') {
      R(h, -4 + hx, z + 10, 2, 1)
      R(h, -1 + hx, z + 10, 3, 2)
      R(h, 3 + hx, z + 10, 1, 1)
    }
    return
  }
  top()
  switch (look.hairStyle) {
    case 'short':
      R(h, -5 + hx, z + 6, 4, 1)
      R(h, 1 + hx, z + 6, 4, 1)
      R(h, -5 + hx, z + 4, 1, 3)
      R(h, 4 + hx, z + 4, 1, 3)
      break
    case 'side':
      R(h, -5 + hx, z + 6, 6, 1)
      R(h, 2 + hx, z + 6, 3, 1)
      R(h, -5 + hx, z + 4, 1, 3)
      R(h, 4 + hx, z + 4, 1, 3)
      break
    case 'spiky':
      R(h, -5 + hx, z + 6, 3, 1)
      R(h, 2 + hx, z + 6, 3, 1)
      R(h, -5 + hx, z + 4, 1, 3)
      R(h, 4 + hx, z + 4, 1, 3)
      R(h, -4 + hx, z + 10, 2, 1)
      R(h, -1 + hx, z + 10, 3, 2)
      R(h, 3 + hx, z + 10, 1, 1)
      break
    case 'ponytail':
      R(h, -5 + hx, z + 6, 4, 1)
      R(h, 1 + hx, z + 6, 4, 1)
      R(h, -5 + hx, z + 4, 1, 3)
      R(h, 4 + hx, z + 3, 1, 4)
      R(h, 5 + hx, z + 1, 2, 7)
      R(look.accent, 5 + hx, z + 7, 2, 1)
      break
    case 'bob':
      R(h, -5 + hx, z + 6, 10, 1)
      R(h, -5 + hx, z + 1, 2, 6)
      R(h, 3 + hx, z + 1, 2, 6)
      break
    case 'bun':
      R(h, -5 + hx, z + 6, 4, 1)
      R(h, 1 + hx, z + 6, 4, 1)
      R(h, -5 + hx, z + 4, 1, 3)
      R(h, 4 + hx, z + 4, 1, 3)
      R(h, -2 + hx, z + 10, 4, 2)
      break
    case 'long':
      R(h, -5 + hx, z + 6, 10, 1)
      R(h, -5 + hx, z - 3, 2, 10)
      R(h, 3 + hx, z - 3, 2, 10)
      break
  }
}

// --- icon speech bubbles ------------------------------------------------------------------

export type BubbleKind = 'think' | 'wait' | 'blocked' | 'done' | 'celebrate' | 'new'

/** Which bubble (if any) a mood shows. */
export function bubbleFor(mood: Mood): BubbleKind | null {
  switch (mood) {
    case 'think':
    case 'wait':
    case 'blocked':
    case 'done':
    case 'celebrate':
      return mood
    default:
      return null
  }
}

// 7x7 icon bitmaps; each letter maps to a colour in the icon's palette.
const ICONS: Record<BubbleKind, { rows: string[]; colors: Record<string, string> }> = {
  wait: {
    rows: ['.AAAAA.', 'AA...AA', '.....AA', '...AAA.', '...A...', '.......', '...A...'],
    colors: { A: '#2b6fd6' }
  },
  blocked: {
    rows: ['...AA..', '...AA..', '...AA..', '...AA..', '...AA..', '.......', '...AA..'],
    colors: { A: '#e03a3a' }
  },
  think: {
    rows: ['.AAAAA.', 'A.....A', 'A.AAA.A', 'A.A.A.A', 'A.A.AAA', 'A.AAA..', '.A.....'],
    colors: { A: '#4a4f66' }
  },
  done: {
    rows: ['..BBB..', '.BBBBB.', '.BBBBB.', '.BBBBB.', '..BBB..', '..CCC..', '...C...'],
    colors: { B: '#ffc933', C: '#8d94a6' }
  },
  celebrate: {
    rows: ['...AAAA', '...A..A', '...A...', '...A...', '.AAA...', 'AAAA...', '.AA....'],
    colors: { A: '#3a3f55' }
  },
  new: {
    rows: ['AA...AA', 'AAA.AAA', '.AAAAA.', '..AAA..', '...B...', '...B...', '...B...'],
    colors: { A: '#3fae4f', B: '#8a5a2f' }
  }
}

/** Round speech bubble with a pixel icon, above a head (x = head centre, y = top of the head). */
export function drawBubble(ctx: CanvasRenderingContext2D, x: number, y: number, kind: BubbleKind, t: number): void {
  const size = 13
  const bx = Math.round(x) - 6
  const by = Math.round(y) - size - 3 + (Math.floor(t * 2) % 2 === 0 ? 0 : 1)
  const bg = kind === 'blocked' ? '#ffe1e1' : '#ffffff'
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const d = Math.hypot(px - 6, py - 6)
      if (d >= 6.5) continue
      ctx.fillStyle = d >= 5.4 ? INK : bg
      ctx.fillRect(bx + px, by + py, 1, 1)
    }
  }
  // tail
  ctx.fillStyle = INK
  ctx.fillRect(bx + 5, by + size - 1, 3, 1)
  ctx.fillRect(bx + 6, by + size, 1, 2)
  ctx.fillStyle = bg
  ctx.fillRect(bx + 6, by + size - 1, 1, 1)

  const icon = ICONS[kind]
  icon.rows.forEach((row, ry) => {
    for (let rx = 0; rx < 7; rx++) {
      const c = row[rx]
      if (c === '.') continue
      ctx.fillStyle = icon.colors[c]
      ctx.fillRect(bx + 3 + rx, by + 3 + ry, 1, 1)
    }
  })
  if (kind === 'think') {
    // the swirl "spins": a bright pixel travels along it
    const ring = [
      [1, 0],
      [2, 0],
      [3, 0],
      [4, 0],
      [5, 0],
      [6, 1]
    ]
    const [rx, ry] = ring[Math.floor(t * 8) % ring.length]
    ctx.fillStyle = '#f0b35a'
    ctx.fillRect(bx + 3 + rx, by + 3 + ry, 1, 1)
  }
}

const CONFETTI = ['#ff6b6b', '#ffd23f', '#6df08a', '#6fb9e6', '#c9a2ff', '#ff9ecb']

export function drawConfetti(ctx: CanvasRenderingContext2D, x: number, y: number, t: number): void {
  for (let i = 0; i < 14; i++) {
    const phase = (t * 16 + i * 7) % 28
    const px = Math.round(x) + ((i * 37) % 25) - 12 + Math.round(Math.sin(t * 3 + i) * 2)
    const py = Math.round(y) - 32 + Math.round(phase)
    ctx.fillStyle = CONFETTI[i % CONFETTI.length]
    ctx.fillRect(px, py, i % 3 === 0 ? 2 : 1, 1 + (i % 2))
  }
}

/**
 * What a character looks like doing. `waiting`/`working`/`blocked` mirror Orca's reported states;
 * `completed`/`celebrating`/`failed`/`idle` are derived from `done`; `thinking` exists only in demo mode.
 */
export type VisualStatus = 'idle' | 'working' | 'thinking' | 'waiting' | 'blocked' | 'completed' | 'celebrating' | 'failed'

export const STATUS_COLOR: Record<VisualStatus, string> = {
  idle: '#9aa3b8',
  working: '#f0b35a',
  thinking: '#6fb9e6',
  waiting: '#ffd23f',
  blocked: '#ff6b6b',
  completed: '#6df08a',
  celebrating: '#c9a2ff',
  failed: '#ff8a5a'
}

/** Small name tag under a character. */
export function drawTag(ctx: CanvasRenderingContext2D, text: string, cx: number, y: number, color: string, selected: boolean): void {
  const w = textWidth(text) + 5
  const x = Math.round(cx - w / 2)
  const top = Math.round(y)
  ctx.fillStyle = selected ? '#fdfdfd' : INK
  ctx.fillRect(x - (selected ? 1 : 0), top - (selected ? 1 : 0), w + (selected ? 2 : 0), 7 + (selected ? 2 : 0))
  ctx.fillStyle = INK
  ctx.fillRect(x, top, w, 7)
  ctx.fillStyle = color
  ctx.fillRect(x, top, 1, 7)
  drawPixelText(ctx, text, x + 3, top + 1, '#f2f4fa')
}

/** Selection ring on the floor (isometric diamond outline) centred on the character's feet. */
export function drawRing(ctx: CanvasRenderingContext2D, x: number, y: number, color: string): void {
  const rx = 11
  ctx.fillStyle = color
  for (let i = 0; i <= rx; i++) {
    const dy = Math.round((rx - i) / 2)
    ctx.fillRect(Math.round(x) + i, Math.round(y) - dy, 1, 1)
    ctx.fillRect(Math.round(x) - i, Math.round(y) - dy, 1, 1)
    ctx.fillRect(Math.round(x) + i, Math.round(y) + dy, 1, 1)
    ctx.fillRect(Math.round(x) - i, Math.round(y) + dy, 1, 1)
  }
}

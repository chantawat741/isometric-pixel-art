// Pixel Base - panel entry point.
// Phase 3: isometric office + animated characters driven by simulated (demo) agents.

import { bubbleFor, drawBubble, drawCharacter, LOOKS, STATUS_COLOR } from './character'
import { DemoDirector } from './demo'
import { AgentFeed } from './feed'
import type { HostLike } from './feed'
import { NavGrid } from './nav'
import { DESKS, HANGOUTS, roomAt } from './rooms'
import { buildOffice } from './scene'
import { Sim } from './sim'
import { Viewport } from './viewport'
import { World } from './world'

const BG = '#141821'

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id}`)
  return node as T
}

const stage = el<HTMLDivElement>('stage')
const canvas = el<HTMLCanvasElement>('view')
const zoomLabel = el<HTMLSpanElement>('zoom')
const statusText = el<HTMLSpanElement>('statusText')
const statusDot = el<HTMLElement>('statusDot')
const demoBtn = el<HTMLButtonElement>('demo')
const ctx = canvas.getContext('2d')
if (!ctx) throw new Error('2D canvas is not available')

const office = buildOffice()
const nav = new NavGrid(office.solids)
const sim = new Sim(nav, DESKS, HANGOUTS)
const world = new World(office, sim)
const demo = new DemoDirector(sim)
const view = new Viewport(office.width, office.height)

// --- drawing ---------------------------------------------------------------------------------

let drawQueued = false
function requestDraw(): void {
  if (drawQueued) return
  drawQueued = true
  requestAnimationFrame(() => {
    drawQueued = false
    draw()
  })
}

function draw(): void {
  const c = ctx as CanvasRenderingContext2D
  const dpr = window.devicePixelRatio || 1
  const w = Math.max(1, Math.round(view.vw * dpr))
  const h = Math.max(1, Math.round(view.vh * dpr))
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w
    canvas.height = h
  }
  c.setTransform(dpr, 0, 0, dpr, 0, 0)
  c.fillStyle = BG
  c.fillRect(0, 0, view.vw, view.vh)
  // Hard pixels when magnified, smooth resampling when shrunk below 1x.
  c.imageSmoothingEnabled = view.zoom < 1
  c.imageSmoothingQuality = 'high'
  c.drawImage(world.canvas, view.originX(), view.originY(), office.width * view.zoom, office.height * view.zoom)
  zoomLabel.textContent = `${Math.round(view.zoom * 100)}%`
}

// --- animation loop (runs only while there are characters and the panel is visible) -----------

const FRAME_MS = 50 // 20 fps is plenty for pixel art
const SYNC_MS = 250 // how often live statuses are re-derived (done -> completed -> celebrating -> idle)
let rafId = 0
let lastNow = 0
let lastCompose = 0
let lastSync = 0
let dirty = true

function loop(now: number): void {
  rafId = 0
  const dt = Math.min(0.1, Math.max(0, (now - lastNow) / 1000))
  lastNow = now
  const active = sim.chars.size > 0 && !document.hidden
  if (active) {
    if (demoOn) demo.update(dt)
    else if (now - lastSync >= SYNC_MS) {
      lastSync = now
      syncLive()
    }
    sim.update(dt)
  }
  if (dirty || (active && now - lastCompose >= FRAME_MS)) {
    dirty = false
    lastCompose = now
    world.compose()
    refreshCard()
    draw()
  }
  if (active) rafId = requestAnimationFrame(loop)
}

function kick(): void {
  dirty = true
  if (!rafId) {
    lastNow = performance.now()
    rafId = requestAnimationFrame(loop)
  }
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden) kick()
})

function resize(): void {
  const rect = stage.getBoundingClientRect()
  const first = view.vw === 1 && view.vh === 1
  view.resize(rect.width, rect.height)
  if (first) view.fit()
  requestDraw()
}
new ResizeObserver(resize).observe(stage)
resize()

// --- camera interaction ----------------------------------------------------------------------

let drag: { id: number; x: number; y: number; startX: number; startY: number; moved: boolean } | null = null

canvas.addEventListener('pointerdown', (e) => {
  drag = { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, moved: false }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (!drag || drag.id !== e.pointerId) return
  if (!drag.moved && Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) > 4) {
    drag.moved = true
    canvas.classList.add('drag')
  }
  if (!drag.moved) return
  view.panBy(e.clientX - drag.x, e.clientY - drag.y)
  drag.x = e.clientX
  drag.y = e.clientY
  requestDraw()
})
canvas.addEventListener('pointerup', (e) => {
  if (!drag || drag.id !== e.pointerId) return
  const wasClick = !drag.moved
  drag = null
  canvas.classList.remove('drag')
  if (wasClick) {
    const rect = canvas.getBoundingClientRect()
    const wx = (e.clientX - rect.left - view.originX()) / view.zoom
    const wy = (e.clientY - rect.top - view.originY()) / view.zoom
    select(world.hitTest(wx, wy))
  }
})
canvas.addEventListener('pointercancel', () => {
  drag = null
  canvas.classList.remove('drag')
})

canvas.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault()
    const rect = canvas.getBoundingClientRect()
    view.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top)
    requestDraw()
  },
  { passive: false }
)
canvas.addEventListener('dblclick', () => {
  view.fit()
  requestDraw()
})

function bind(id: string, action: () => void): void {
  el<HTMLButtonElement>(id).addEventListener('click', () => {
    action()
    requestDraw()
  })
}
bind('zin', () => view.step(1))
bind('zout', () => view.step(-1))
bind('fit', () => view.fit())
bind('one', () => view.actualSize())

window.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') view.step(1)
  else if (e.key === '-') view.step(-1)
  else if (e.key === '0') view.fit()
  else if (e.key === 'Escape') select(null)
  else return
  requestDraw()
})

// --- selection & profile card ----------------------------------------------------------------

const card = el<HTMLDivElement>('card')
const avatar = el<HTMLCanvasElement>('avatar')
const cName = el<HTMLDivElement>('cname')
const cStatus = el<HTMLDivElement>('cstatus')
const cWhere = el<HTMLDivElement>('cwhere')
const cDesk = el<HTMLDivElement>('cdesk')
const cKind = el<HTMLDivElement>('ckind')
const cTask = el<HTMLDivElement>('ctask')
const cLook = el<HTMLSpanElement>('clook')
const avatarCtx = avatar.getContext('2d') as CanvasRenderingContext2D

const STATUS_LABEL = {
  idle: 'Idle',
  working: 'Working',
  thinking: 'Thinking',
  waiting: 'Waiting',
  blocked: 'Blocked',
  completed: 'Completed',
  celebrating: 'Celebrating',
  failed: 'Failed'
} as const

const MODE_LABEL = {
  seated: 'at desk',
  sitting: 'sitting down',
  rising: 'getting up',
  walking: 'walking',
  standing: 'standing'
} as const

function select(id: string | null): void {
  world.selectedId = id && sim.chars.has(id) ? id : null
  card.hidden = world.selectedId === null
  kick()
}

let cardKey = ''
function refreshCard(): void {
  const ch = world.selectedId ? sim.chars.get(world.selectedId) : undefined
  if (!ch) {
    card.hidden = true
    return
  }
  card.hidden = false
  const status = ch.info.status
  const d = ch.info.details
  const ageSec = d ? Math.max(0, Math.floor((Date.now() + clockOffset - d.since) / 1000)) : 0
  const key = `${ch.info.name}|${status}|${ch.mode}|${roomAt(ch.gx, ch.gy).id}|${ch.lookId}|${d?.task ?? ''}|${d ? ageSec : ''}`
  if (key !== cardKey) {
    cardKey = key
    cName.textContent = ch.info.name
    cStatus.textContent = STATUS_LABEL[status]
    cStatus.style.setProperty('--dot', STATUS_COLOR[status])
    cWhere.textContent = `${roomAt(ch.gx, ch.gy).name} · ${MODE_LABEL[ch.mode]}`
    cDesk.textContent = ch.desk.id.toUpperCase()
    cLook.textContent = LOOKS[ch.lookId].name
    // Facts reported by Orca itself (live mode only).
    cKind.textContent = d ? `Orca: ${d.orcaState} for ${formatAge(ageSec)}` : 'Simulated agent'
    cTask.textContent = d?.task ? `Task: ${d.task}` : d?.title ? d.title : ''
    cTask.hidden = !cTask.textContent
    refreshActions()
  }
  avatarCtx.setTransform(1, 0, 0, 1, 0, 0)
  avatarCtx.clearRect(0, 0, avatar.width, avatar.height)
  avatarCtx.setTransform(3, 0, 0, 3, 0, 0)
  avatarCtx.imageSmoothingEnabled = false
  drawCharacter(avatarCtx, 9, 29, LOOKS[ch.lookId], { pose: 'stand', view: 'front', flip: false, t: ch.t, mood: 'none', lift: 0 })
}

// --- agent actions (Phase 5): view-only, routed through the plugin's worker ----------------------

const cActions = el<HTMLDivElement>('cactions')
const cFocus = el<HTMLButtonElement>('cfocus')
const cOpen = el<HTMLButtonElement>('copen')
const cMsg = el<HTMLDivElement>('cmsg')
let msgTimer: ReturnType<typeof setTimeout> | undefined

function showMessage(text: string, tone: 'ok' | 'error'): void {
  cMsg.textContent = text
  cMsg.dataset.tone = tone
  cMsg.hidden = false
  clearTimeout(msgTimer)
  msgTimer = setTimeout(() => (cMsg.hidden = true), 4500)
}

/** Ask this plugin's worker to act (Orca only lets workers focus terminals / open workspaces). */
async function callWorker(name: string, input: unknown): Promise<unknown> {
  if (!host) throw Object.assign(new Error('Not running inside Orca'), { code: 'unavailable' })
  if (host.plugin?.request) return host.plugin.request(name, input, { timeoutMs: 8000 })
  const res = (await host.host.call('plugin.request', { name, input, timeoutMs: 8000 })) as { output: unknown }
  return res.output
}

function explain(error: unknown): string {
  const e = (error ?? {}) as { code?: string; message?: string }
  switch (e.code) {
    case 'capability_denied':
    case 'consent_required':
      return 'Pixel Base needs the workspace:write permission (approve it in Orca).'
    case 'unknown_method':
      return 'The Pixel Base worker is not running yet (reload the plugin).'
    case 'not_permitted':
      return 'Orca does not allow this from here.'
    case 'timeout':
      return 'Orca did not answer in time.'
    default:
      return e.message ? `Could not do that: ${e.message}` : 'Could not do that.'
  }
}

async function runAction(button: HTMLButtonElement, action: () => Promise<string>): Promise<void> {
  button.disabled = true
  try {
    showMessage(await action(), 'ok')
  } catch (error) {
    showMessage(explain(error), 'error')
  } finally {
    button.disabled = false
    refreshActions()
  }
}

cFocus.addEventListener('click', () => {
  const ch = world.selectedId ? sim.chars.get(world.selectedId) : undefined
  const terminalId = ch?.info.details?.terminalId
  if (!terminalId) return
  void runAction(cFocus, async () => {
    const res = (await callWorker('pixel.focusTerminal', { terminalId })) as { focused?: boolean }
    return res.focused === false ? 'Orca could not move to that terminal.' : 'Showing the terminal in Orca.'
  })
})

cOpen.addEventListener('click', () => {
  const ctx = feed?.context
  if (!ctx) return
  void runAction(cOpen, async () => {
    await callWorker('pixel.openWorkspace', { workspaceId: ctx.workspaceId ?? '', name: ctx.displayName, branch: ctx.branch })
    return 'Showing the workspace in Orca.'
  })
})

/** Buttons only exist for real Orca agents (never for demo characters). */
function refreshActions(): void {
  const ch = world.selectedId ? sim.chars.get(world.selectedId) : undefined
  const live = !!ch?.info.details && !demoOn && !!host
  cActions.hidden = !live
  if (!live) return
  const hasTerminal = !!ch?.info.details?.terminalId
  cFocus.disabled = !hasTerminal
  cFocus.title = hasTerminal ? 'Show this agent’s terminal in Orca' : 'Orca did not report a terminal for this agent'
  const canOpen = !!feed?.context && (!!feed.context.workspaceId || !!feed.context.displayName)
  cOpen.disabled = !canOpen
  cOpen.title = canOpen ? 'Show this agent’s workspace in Orca' : 'Orca has not reported the workspace yet'
}

function changeLook(delta: number): void {
  if (!world.selectedId) return
  const ch = sim.chars.get(world.selectedId)
  if (ch) sim.setLook(ch.info.id, ch.lookId + delta)
  kick()
}
el<HTMLButtonElement>('lprev').addEventListener('click', () => changeLook(-1))
el<HTMLButtonElement>('lnext').addEventListener('click', () => changeLook(1))
el<HTMLButtonElement>('cclose').addEventListener('click', () => select(null))

function formatAge(sec: number): string {
  if (sec < 60) return `${sec}s`
  if (sec < 3600) return `${Math.floor(sec / 60)}m`
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`
}

// --- data sources: live Orca agents or simulated demo agents ----------------------------------

let demoOn = false
let host: HostLike | null = null
let feed: AgentFeed | null = null
/** Test hook: lets a debug session fast-forward the clock used for live status timing. */
let clockOffset = 0

/** Mirror the feed into the simulation: add/update agents that have a desk, drop the rest. */
function syncLive(): void {
  if (!feed) return
  const now = Date.now() + clockOffset
  const seen = new Set<string>()
  for (const v of feed.views(now)) {
    if (v.deskIndex < 0) continue
    seen.add(v.key)
    sim.upsert({
      id: v.key,
      name: v.name,
      status: v.status,
      deskId: DESKS[v.deskIndex].id,
      details: { terminalId: v.terminalId, kind: v.kind, title: v.title, task: v.task, orcaState: v.raw, since: v.since }
    })
  }
  for (const id of [...sim.chars.keys()]) {
    if (seen.has(id)) continue
    sim.remove(id)
    if (world.selectedId === id) select(null)
  }
  updateStatus()
}

function updateStatus(): void {
  let text: string
  let color = '#6b7388'
  if (demoOn) {
    text = `Demo mode · ${demo.count} simulated agents`
    color = '#f0b35a'
  } else if (!host) {
    text = 'No Orca host · open inside Orca for live agents'
  } else if (!feed || !feed.live) {
    text = feed?.error ?? 'Connecting to Orca…'
  } else {
    const ws = feed.workspaceLabel ? ` · ${feed.workspaceLabel}` : ''
    const n = feed.count
    const extra = feed.overflow ? ` (${feed.overflow} without a desk)` : ''
    if (feed.error) {
      // Never claim "no agents" when the truth is that Orca would not tell us.
      text = `Can't read agents · ${feed.error}`
      color = '#ff6b6b'
    } else {
      text = n === 0 ? `Live${ws} · no agents running` : `Live${ws} · ${n} agent${n === 1 ? '' : 's'}${extra}`
      if (!feed.eventsOk) text += ' · polling'
      color = feed.eventsOk ? '#6df08a' : '#ffd23f'
    }
  }
  statusText.textContent = text
  statusText.title = text
  statusDot.style.background = color
}

async function startLive(h: HostLike): Promise<void> {
  host = h
  feed?.stop()
  const f = new AgentFeed(h, DESKS.length)
  feed = f
  f.onChange = () => {
    if (demoOn) return updateStatus()
    syncLive()
    kick()
  }
  await f.start()
  updateStatus()
}

function setDemo(on: boolean): void {
  demoOn = on
  demo.stop() // also clears the simulation
  world.selectedId = null
  card.hidden = true
  if (on) demo.start()
  else syncLive()
  demoBtn.setAttribute('aria-pressed', String(on))
  demoBtn.classList.toggle('on', on)
  updateStatus()
  kick()
}
demoBtn.addEventListener('click', () => setDemo(!demoOn))

// Inside Orca `window.orca` exists: show real agents. In a plain browser fall back to the demo.
const detected = (window as unknown as { orca?: HostLike }).orca
if (detected && detected.host) {
  setDemo(false)
  void startLive(detected)
} else {
  setDemo(true)
}

// Test hook (preview only, `?debug`): advance the simulation by hand, e.g. when the browser
// throttles requestAnimationFrame for a hidden pane.
if (location.search.includes('debug')) {
  const tickOnce = (dt: number): void => {
    if (demoOn) demo.update(dt)
    else syncLive()
    sim.update(dt)
  }
  ;(window as unknown as Record<string, unknown>).pixelBase = {
    sim,
    world,
    view,
    sprites: { drawCharacter, drawBubble, bubbleFor, LOOKS },
    advance(seconds: number, stepMs = 50): void {
      for (let t = 0; t < seconds; t += stepMs / 1000) {
        tickOnce(stepMs / 1000)
      }
      world.compose()
      refreshCard()
      draw()
    },
    /** Advance simulation time without rendering (fast, for soak tests). */
    tick: tickOnce,
    /** Fast-forward the clock used to derive completed/celebrating/idle from `done`. */
    skip(seconds: number): void {
      clockOffset += seconds * 1000
    },
    /** The (possibly fast-forwarded) clock live statuses are derived from. */
    now: (): number => Date.now() + clockOffset,
    startLive,
    feed: () => feed,
    select
  }
}

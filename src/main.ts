// Pixel Base - panel entry point.
// Phase 3: isometric office + animated characters driven by simulated (demo) agents.

import { bubbleFor, drawBubble, drawCharacter, LOOKS, STATUS_COLOR } from './character'
import { DemoDirector } from './demo'
import { Docks } from './docks'
import type { AgentRow, WorkspaceRow } from './docks'
import { AgentFeed } from './feed'
import type { HostLike } from './feed'
import { loadRuns, noteFor } from './notes'
import type { RunInfo } from './notes'
import { DEMO_USAGE, demoLimits, loadLimits, loadUsage } from './usage'
import type { LimitsData, LimitsState, UsageData, UsageState } from './usage'
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
  placeNotes()
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
    const forced = dirty
    dirty = false
    lastCompose = now
    world.compose()
    refreshCard()
    refreshDocks(forced)
    refreshNotes()
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

/** True until the user pans or zooms: then resizing and folding docks re-fit the office. */
let autoFit = true
let docksReady = false

function resize(): void {
  const rect = stage.getBoundingClientRect()
  // A hidden or not yet laid out panel has no size: wait for a real one instead of fitting to nothing.
  if (rect.width < 8 || rect.height < 8) return
  const first = view.vw === 1 && view.vh === 1
  view.resize(rect.width, rect.height)
  if (first) view.fit()
  else if (autoFit && docksReady) applyInsets()
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
  autoFit = false
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
    autoFit = false
    const rect = canvas.getBoundingClientRect()
    view.zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - rect.left, e.clientY - rect.top)
    requestDraw()
  },
  { passive: false }
)
/** Fit the office between the docks and keep it fitted while docks fold and the panel resizes. */
function fitView(): void {
  autoFit = true
  if (docksReady) applyInsets()
  else view.fit()
}
canvas.addEventListener('dblclick', () => {
  fitView()
  requestDraw()
})

function bind(id: string, action: () => void): void {
  el<HTMLButtonElement>(id).addEventListener('click', () => {
    action()
    requestDraw()
  })
}
bind('zin', () => {
  autoFit = false
  view.step(1)
})
bind('zout', () => {
  autoFit = false
  view.step(-1)
})
bind('fit', fitView)
bind('one', () => {
  autoFit = false
  view.actualSize()
})

window.addEventListener('keydown', (e) => {
  if (e.key === '+' || e.key === '=') {
    autoFit = false
    view.step(1)
  } else if (e.key === '-') {
    autoFit = false
    view.step(-1)
  } else if (e.key === '0') fitView()
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
    cKind.textContent = d ? `${d.kind || 'agent'} · Orca: ${d.orcaState} for ${formatAge(ageSec)}` : 'Simulated agent'
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

/** The workspace to open for the selected agent: its own, else the focused one. */
function targetWorkspace(): { workspaceId: string; name: string; branch: string } | null {
  const ch = world.selectedId ? sim.chars.get(world.selectedId) : undefined
  const d = ch?.info.details
  if (d?.workspaceId) return { workspaceId: d.workspaceId, name: d.workspaceName, branch: '' }
  const ctx = feed?.context
  if (ctx && (ctx.workspaceId || ctx.displayName)) return { workspaceId: ctx.workspaceId ?? '', name: ctx.displayName, branch: ctx.branch }
  return null
}

cOpen.addEventListener('click', () => {
  const target = targetWorkspace()
  if (!target) return
  void runAction(cOpen, async () => {
    await callWorker('pixel.openWorkspace', target)
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
  const canOpen = targetWorkspace() !== null
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

// --- docks: AGENTS, USAGE, ACTIVITY ------------------------------------------------------------

let usage: UsageData | null = null
let usageState: UsageState = 'loading'
let limits: LimitsData | null = null
let limitsState: LimitsState = 'loading'
let limitsReason = ''
let usageBusy = false
let usageTimer: ReturnType<typeof setInterval> | undefined

const docks = new Docks(
  {
    selectAgent: (id) => select(id),
    openWorkspace: (w) => void openWorkspaceRow(w),
    toggled: (name, open) => {
      if (name === 'usage' && open) void refreshUsage()
      applyInsets()
      kick()
    }
  },
  stage.getBoundingClientRect().width
)

/** While the camera is still "fitted", keep the office centred in the strip the docks leave free. */
function applyInsets(): void {
  const wide = view.vw >= 860 // in a narrow sidebar the docks simply float over the office
  view.insetL = wide && docks.isOpen('agents') ? 240 : 0
  view.insetR = wide && docks.isOpen('usage') ? 240 : 0
  if (autoFit) view.fit()
  requestDraw()
}
docksReady = true
applyInsets()

async function openWorkspaceRow(w: WorkspaceRow): Promise<void> {
  try {
    await callWorker('pixel.openWorkspace', { workspaceId: w.id, name: w.name, branch: w.branch ?? '' })
    toast(`Showing ${w.name} in Orca.`)
  } catch (error) {
    toast(explain(error), true)
  }
}

/** Plan limits and token usage, read through the plugin worker (demo mode shows labelled, simulated numbers). */
async function refreshUsage(): Promise<void> {
  if (demoOn) {
    usage = DEMO_USAGE
    usageState = 'demo'
    limits = demoLimits(Date.now() + clockOffset)
    limitsState = 'demo'
    return refreshDocks(true)
  }
  if (!host) {
    usage = null
    usageState = 'unavailable'
    limits = null
    limitsState = 'unavailable'
    limitsReason = 'cli_not_found'
    return refreshDocks(true)
  }
  if (usageBusy) return
  usageBusy = true
  const request = (name: string, input?: unknown): Promise<unknown> => callWorker(name, input)
  const [tokens, plan] = await Promise.allSettled([loadUsage(request), loadLimits(request)])
  if (tokens.status === 'fulfilled') {
    usage = tokens.value
    usageState = 'ok'
  } else {
    const code = (tokens.reason as { code?: string }).code
    if (code === 'capability_denied' || code === 'consent_required') usageState = 'denied'
    else if (code === 'unknown_method' || code === 'not_permitted') usageState = 'unavailable'
    else if (!usage) usageState = 'error' // a failed refresh keeps the numbers already shown
    if (usageState !== 'ok') usage = null
  }
  if (plan.status === 'fulfilled') {
    limitsReason = ''
    if (plan.value.state === 'ok') {
      limits = plan.value.data
      limitsState = 'ok'
    } else {
      limits = null
      limitsState = 'unavailable'
      limitsReason = plan.value.reason
    }
  } else {
    const code = (plan.reason as { code?: string }).code
    limits = limitsState === 'ok' ? limits : null // a failed refresh keeps the numbers already shown
    if (limitsState !== 'ok') {
      limitsState = code === 'unknown_method' || code === 'not_permitted' ? 'unavailable' : 'error'
      limitsReason = limitsState === 'unavailable' ? 'cli_failed' : ''
    }
  }
  usageBusy = false
  refreshDocks(true)
}

let lastDocks = 0
function refreshDocks(force = false): void {
  const t = performance.now()
  if (!force && t - lastDocks < 400) return
  lastDocks = t
  const live = !demoOn && !!feed?.live
  const views = !demoOn && feed ? feed.views(Date.now() + clockOffset) : []
  const rows: AgentRow[] = demoOn
    ? [...sim.chars.values()].map((ch) => ({
        id: ch.info.id,
        name: ch.info.name,
        kind: 'demo',
        status: ch.info.status,
        statusLabel: STATUS_LABEL[ch.info.status],
        task: '',
        lookId: ch.lookId,
        selectable: true,
        deskless: false
      }))
    : views.map((v) => ({
        id: v.key,
        name: v.name,
        kind: v.kind,
        status: v.status,
        statusLabel: STATUS_LABEL[v.status],
        // Orca's terminal title is often just the agent's own name: don't repeat the badge.
        task: v.task || (v.title.toLowerCase() === v.kind.toLowerCase() ? '' : v.title),
        lookId: sim.chars.get(v.key)?.lookId ?? 0,
        selectable: sim.chars.has(v.key),
        deskless: v.deskIndex < 0
      }))
  const workspaces: WorkspaceRow[] | null = live
    ? (feed?.workspaces ?? []).map((w) => ({ id: w.id, name: w.name, branch: w.branch, agents: views.filter((v) => v.workspaceId === w.id).length }))
    : null
  docks.renderAgents(rows, world.selectedId, workspaces, live)
  docks.renderUsage({ data: usage, state: usageState }, { data: limits, state: limitsState, reason: limitsReason }, Date.now() + clockOffset)
  docks.renderActivity(demoOn ? demo.activity : (feed?.activity ?? []), !demoOn)
}

// --- messages above heads: what an agent's last run did -----------------------------------------

const notesLayer = el<HTMLDivElement>('notes')
let runs = new Map<string, RunInfo>()
let runsBusy = false
let lastRuns = 0
let runsTimer: ReturnType<typeof setInterval> | undefined
const noteEls = new Map<string, { el: HTMLElement; key: string }>()
let notes: Array<{ id: string; ax: number; ay: number }> = []

/** Ask the worker what each agent's latest run did (live mode only). */
async function refreshRuns(): Promise<void> {
  if (demoOn || !host || runsBusy) return
  const t = performance.now()
  if (t - lastRuns < 800) return
  lastRuns = t
  runsBusy = true
  try {
    runs = await loadRuns((name, input) => callWorker(name, input))
    kick()
  } catch {
    // no worker (an older Orca, or not running yet): there are simply no messages
  } finally {
    runsBusy = false
  }
}

/** Create, update and drop the message cards to match the agents' runs; placeNotes() positions them. */
function refreshNotes(): void {
  const now = Date.now() + clockOffset
  const source = demoOn ? demo.runs : runs
  const next: typeof notes = []
  for (const ch of sim.chars.values()) {
    const id = ch.info.id
    const run = source.get(id)
    const working = ch.info.status === 'working' || ch.info.status === 'thinking' // already on the next run
    const note = run && !working ? noteFor(run, now) : null
    if (!note) continue
    const a = world.noteAnchor(ch)
    next.push({ id, ax: a.x, ay: a.y })
    const key = `${note.tone}|${note.lead}|${note.body}|${note.tests}`
    let rec = noteEls.get(id)
    if (!rec) {
      const el = document.createElement('div')
      notesLayer.appendChild(el)
      rec = { el, key: '' }
      noteEls.set(id, rec)
    }
    if (rec.key !== key) {
      rec.key = key
      rec.el.className = `note ${note.tone}`
      rec.el.replaceChildren()
      const lead = document.createElement('b')
      lead.textContent = note.lead
      rec.el.append(lead)
      if (note.body) rec.el.append(document.createTextNode(` ${note.body}`))
      if (note.tests) {
        const tests = document.createElement('span')
        tests.className = `nt ${note.testsTone}`
        tests.textContent = ` ${note.tests}`
        rec.el.append(tests)
      }
      const tail = document.createElement('i')
      tail.className = 'tail'
      rec.el.append(tail)
    }
  }
  const live = new Set(next.map((n) => n.id))
  for (const [id, rec] of noteEls) {
    if (live.has(id)) continue
    rec.el.remove()
    noteEls.delete(id)
  }
  notes = next
}

/**
 * Put each card above its character's head for the current camera (cheap: a few elements). When two
 * cards would cover each other (several agents finishing together), the one further back moves up.
 */
function placeNotes(): void {
  const placed: Array<{ l: number; r: number; t: number; b: number }> = []
  const order = [...notes].sort((a, b) => b.ay - a.ay) // front-most character first
  for (const n of order) {
    const rec = noteEls.get(n.id)
    if (!rec) continue
    const w = rec.el.offsetWidth
    const h = rec.el.offsetHeight
    const sx = view.originX() + n.ax * view.zoom
    const sy = view.originY() + n.ay * view.zoom - 6
    const half = w / 2 + 6
    const x = Math.min(Math.max(sx, half), Math.max(half, view.vw - half)) // keep it inside the panel
    let bottom = Math.max(sy, h + 4)
    for (let pass = 0; pass < placed.length; pass++) {
      const hit = placed.find((p) => x - w / 2 < p.r && x + w / 2 > p.l && bottom - h < p.b && bottom > p.t)
      if (!hit) break
      bottom = Math.max(h + 4, hit.t - 6) // just above the card it would cover
    }
    placed.push({ l: x - w / 2, r: x + w / 2, t: bottom - h, b: bottom })
    rec.el.style.left = `${Math.round(x)}px`
    rec.el.style.top = `${Math.round(bottom)}px`
    rec.el.style.setProperty('--tx', `${Math.round(Math.max(-w / 2 + 12, Math.min(w / 2 - 12, sx - x)))}px`)
  }
}

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
      details: {
        terminalId: v.terminalId,
        workspaceId: v.workspaceId,
        workspaceName: v.workspaceName,
        kind: v.kind,
        title: v.title,
        task: v.task,
        orcaState: v.raw,
        since: v.since
      }
    })
  }
  for (const id of [...sim.chars.keys()]) {
    if (seen.has(id)) continue
    sim.remove(id)
    if (world.selectedId === id) select(null)
  }
  updateStatus()
}

/** A short message in the status chip (e.g. after opening a workspace); the normal status returns after. */
let toastUntil = 0
function toast(text: string, error = false): void {
  toastUntil = Date.now() + 3500
  statusText.textContent = text
  statusText.title = text
  statusDot.style.background = error ? '#ff6b6b' : '#6df08a'
  setTimeout(updateStatus, 3600)
}

function updateStatus(): void {
  if (Date.now() < toastUntil) return
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
    const wsCount = feed.workspaces?.length
    const ws = wsCount ? ` · ${wsCount} workspace${wsCount === 1 ? '' : 's'}` : feed.workspaceLabel ? ` · ${feed.workspaceLabel}` : ''
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
    void refreshRuns() // a state change usually means a run just started or ended
    kick()
  }
  await f.start()
  updateStatus()
  void refreshUsage()
  clearInterval(usageTimer)
  usageTimer = setInterval(() => {
    if (!document.hidden && !demoOn) void refreshUsage()
  }, 60000)
  void refreshRuns()
  clearInterval(runsTimer)
  runsTimer = setInterval(() => {
    if (!document.hidden && !demoOn) void refreshRuns()
  }, 3000)
}

function setDemo(on: boolean): void {
  demoOn = on
  demo.stop() // also clears the simulation
  world.selectedId = null
  card.hidden = true
  if (on) demo.start()
  else syncLive()
  if (!on) {
    usage = null
    usageState = 'loading'
    limits = null
    limitsState = 'loading'
  } else {
    runs = new Map()
  }
  void refreshUsage()
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
      refreshNotes()
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
    docks,
    demo,
    refreshUsage,
    refreshRuns,
    runs: () => runs,
    select
  }
}

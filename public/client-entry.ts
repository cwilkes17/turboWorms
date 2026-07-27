import { GameRenderer, parseGameSnapshot } from '../renderer.ts'

const canvasEl = document.getElementById('c')
if (!(canvasEl instanceof HTMLCanvasElement)) throw new Error('#c canvas missing')
const canvas = canvasEl

const scoreEl = document.getElementById('hud-score')
const massEl = document.getElementById('hud-mass')
const drainEl = document.getElementById('hud-drain')

/** Updates the bottom-right HUD stats for the local player from the latest snapshot. Purely
 *  cosmetic client-side formatting — score, mass, and drainPerSec are all authoritative server
 *  values (`mass` already reflects this tick's drain and food pickups; nothing computed here). */
function updateHudStats(snap: ReturnType<typeof parseGameSnapshot>, localPlayerId: string | null): void {
  if (!snap || !localPlayerId) return
  const mine = snap.snakes.find((s) => s.id === localPlayerId)
  if (!mine) return

  if (scoreEl) scoreEl.textContent = `SCORE: ${mine.score ?? 0}`
  if (massEl) massEl.textContent = `MASS: ${mine.mass}`

  if (drainEl) {
    const drain = mine.drainPerSec ?? 0
    drainEl.textContent = drain > 0 ? `DRAIN: -${drain.toFixed(1)}/s` : 'DRAIN: 0/s'
    drainEl.classList.toggle('active', drain > 0)
  }
}

function fitCanvas(el: HTMLCanvasElement): void {
  const rect = el.getBoundingClientRect()
  const dpr = Math.min(window.devicePixelRatio ?? 1, 2)
  const w = Math.max(1, Math.floor(rect.width * dpr))
  const h = Math.max(1, Math.floor(rect.height * dpr))
  if (el.width !== w || el.height !== h) {
    el.width = w
    el.height = h
  }
}

fitCanvas(canvas)
window.addEventListener('resize', () => fitCanvas(canvas))

const params = new URLSearchParams(window.location.search)
const debugFood = params.get('debugFood') === '1' || params.get('debug') === 'food'
const wsHref =
  params.get('ws') ??
  (window.location.hostname
    ? `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
    : 'ws://localhost:8765')

const keys = new Set<string>()
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') e.preventDefault()
  keys.add(e.code)
})
window.addEventListener('keyup', (e) => keys.delete(e.code))

let lastNonZeroDir = { x: 1, y: 0 }

function directionFromKeys(): { x: number; y: number } {
  let x = 0
  let y = 0
  if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1
  if (x === 0 && y === 0) return lastNonZeroDir
  const len = Math.hypot(x, y)
  const out = { x: x / len, y: y / len }
  lastNonZeroDir = out
  return out
}

let renderer: GameRenderer | undefined
let ws!: WebSocket
let localPlayerId: string | null = null

function scheduleReconnect(): void {
  window.setTimeout(() => {
    ws = connectSocket()
  }, 800)
}

function connectSocket(): WebSocket {
  const socket = new WebSocket(wsHref)

  socket.addEventListener('message', (ev) => {
    let raw: unknown
    try {
      raw = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (!raw || typeof raw !== 'object') return
    const msg = raw as Record<string, unknown>
    if (msg.t === 'welcome' && typeof msg.id === 'string') {
      localPlayerId = msg.id
      renderer?.stop()
      renderer = new GameRenderer({
        canvas,
        followPlayerId: msg.id,
        scale: 1.05,
        debugFood,
      })
      renderer.start()
      return
    }
    const snap = parseGameSnapshot(raw)
    if (snap && renderer) renderer.pushSnapshot(snap)
    updateHudStats(snap, localPlayerId)
  })

  socket.addEventListener('close', scheduleReconnect)

  return socket
}

ws = connectSocket()

const sendHz = 45
window.setInterval(() => {
  if (!ws || ws.readyState !== WebSocket.OPEN) return
  const dir = directionFromKeys()
  ws.send(
    JSON.stringify({
      t: 'input',
      d: {
        direction: dir,
        fire: keys.has('Space'),
        shield: keys.has('KeyQ'),
        boost: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        turbo: keys.has('KeyE'),
      },
    })
  )
}, 1000 / sendHz)

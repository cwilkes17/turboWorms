/**
 * Authoritative WebSocket host: clients send `PlayerInput` only; server runs `tick` and broadcasts snapshots.
 *
 * Run: `npm install && npm start` (builds `public/client.bundle.js` via `prestart`, serves `GET /`).
 * Requires Node 20+ with `--experimental-strip-types`, or compile to JS.
 */

import { createReadStream } from 'node:fs'
import fs from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WebSocketServer, type WebSocket } from 'ws'

import type { PlayerInput } from './contracts/input.ts'
import type { Snake, Vec2 } from './contracts/snake.ts'
import type { World } from './contracts/world.ts'
import { generateSpawnFields } from './food.ts'
import { createEmptyWorld, tick, type TickInputs } from './gameLoop.ts'

const DEFAULT_PORT = Number(process.env.PORT ?? 8765)

const SPAWN_STEP = 35
const DEFAULT_SNAKE_SPEED = 120
const DEFAULT_START_MASS = 20
const MAX_VISIBLE_SEGMENTS = 1000
/** Max food orbs per snapshot; `MAX_FOOD_IN_SNAPSHOT<=0` means send all (watch bandwidth). */
const DEFAULT_MAX_FOOD_IN_SNAPSHOT = 400

type ClientSession = {
  ws: WebSocket
  id: string
  /** Latest client payload; `fire` is cleared after each sim tick (one-shot unless resent). */
  input: PlayerInput
}

const idleInput = (): PlayerInput => ({
  direction: { x: 1, y: 0 },
  fire: false,
  shield: false,
  boost: false,
  turbo: false,
})

function normalizeDirectionRad(v: Vec2): number {
  if (!Number.isFinite(v.x) || !Number.isFinite(v.y)) return 0
  return Math.atan2(v.y, v.x)
}

function mergePlayerInput(base: PlayerInput, patch: Partial<PlayerInput>): PlayerInput {
  return {
    direction:
      patch.direction && Number.isFinite(patch.direction.x) && Number.isFinite(patch.direction.y)
        ? { x: patch.direction.x, y: patch.direction.y }
        : { ...base.direction },
    fire: patch.fire ?? base.fire,
    shield: patch.shield ?? base.shield,
    boost: patch.boost ?? base.boost,
    turbo: patch.turbo ?? base.turbo,
  }
}

function buildTickInputs(sessions: Iterable<ClientSession>): TickInputs {
  const out: TickInputs = {}
  for (const s of sessions) {
    const p = s.input
    out[s.id] = {
      direction: normalizeDirectionRad(p.direction),
      abilities: {
        fireballTriggered: p.fire,
        shieldHeld: p.shield,
        boostHeld: p.boost,
        turboHeld: p.turbo,
      },
    }
  }
  return out
}

export type SnapshotFoodWire = { id: string; x: number; y: number; r: number }

function maxFoodSnapshotCount(): number {
  const raw = Number(process.env.MAX_FOOD_IN_SNAPSHOT ?? DEFAULT_MAX_FOOD_IN_SNAPSHOT)
  if (!Number.isFinite(raw) || raw <= 0) return 0
  return Math.floor(raw)
}

/**
 * Snapshot food list: when capped, prefer orbs nearest any alive head so consumables near players stay visible.
 * (Lexicographic `slice(0,N)` hid nearby orbs with late-sorting ids.)
 */
export function selectFoodForSnapshot(world: World, maxCount: number): SnapshotFoodWire[] {
  const foods = world.food
  const toWire = (o: (typeof foods)[number]): SnapshotFoodWire => ({
    id: o.id,
    x: Math.round(o.position.x),
    y: Math.round(o.position.y),
    r: o.radius,
  })

  if (maxCount === 0 || foods.length <= maxCount) {
    return foods.map(toWire)
  }

  const heads: Vec2[] = []
  for (const s of world.snakes) {
    if (s.alive && s.segments[0]) heads.push(s.segments[0])
  }

  if (heads.length === 0) {
    return [...foods]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, maxCount)
      .map(toWire)
  }

  const scored = foods.map((o) => {
    let d2 = Infinity
    for (const h of heads) {
      const dx = o.position.x - h.x
      const dy = o.position.y - h.y
      const t = dx * dx + dy * dy
      if (t < d2) d2 = t
    }
    return { o, d2 }
  })
  scored.sort((a, b) => {
    if (a.d2 !== b.d2) return a.d2 - b.d2
    return a.o.id < b.o.id ? -1 : 1
  })
  return scored.slice(0, maxCount).map(({ o }) => toWire(o))
}

/** Bandwidth-friendly snapshot (plan: compressed / subset; no full world secrets). */
export function buildSnapshot(world: World) {
  const foodCap = maxFoodSnapshotCount()
  const food = selectFoodForSnapshot(world, foodCap)

  return {
    tick: world.tick,
    snakes: world.snakes.map((s) => ({
      id: s.id,
      alive: s.alive,
      head: {
        x: Math.round(s.segments[0]?.x ?? 0),
        y: Math.round(s.segments[0]?.y ?? 0),
      },
      dir: Number(s.direction.toFixed(5)),
      length: s.segments.length,
      mass: Math.round(world.snakeMassById[s.id] ?? 0),
      visibleSegments: s.alive
        ? s.segments.slice(0, MAX_VISIBLE_SEGMENTS).map((p) => ({
            x: Math.round(p.x),
            y: Math.round(p.y),
          }))
        : [],
    })),
    food,
    /** Total consumable orbs in sim (may exceed `food.length` when snapshot is capped). */
    foodTotal: world.food.length,
    fireballs: world.fireballs.map((fb) => ({
      id: fb.id,
      ownerId: fb.ownerId,
      x: Math.round(fb.position.x),
      y: Math.round(fb.position.y),
      r: fb.radius,
    })),
  }
}

function spawnPlayerSnake(world: World, playerId: string, spawnIndex: number): World {
  const x = spawnIndex * SPAWN_STEP
  const snake: Snake = {
    id: playerId,
    segments: [{ x, y: 0 }],
    mass: DEFAULT_START_MASS,
    direction: 0,
    speed: DEFAULT_SNAKE_SPEED,
    alive: true,
    state: { shield: false, fireballCooldown: 0 },
  }
  return {
    ...world,
    snakes: [...world.snakes, snake],
    snakeMassById: { ...world.snakeMassById, [playerId]: DEFAULT_START_MASS },
  }
}

function removePlayer(world: World, playerId: string): World {
  const nextMass = { ...world.snakeMassById }
  delete nextMass[playerId]
  return {
    ...world,
    snakes: world.snakes.filter((s) => s.id !== playerId),
    snakeMassById: nextMass,
  }
}

export type GameServerOptions = {
  port?: number
  tickHz?: number
}

const thisDir = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(thisDir, 'public')

/** GET static files under `public/` only; pathname must stay inside that folder. */
function servePublicFile(pathnameResolved: string, res: ServerResponse): void {
  const ext = path.extname(pathnameResolved).toLowerCase()
  const mime: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.png': 'image/png',
    '.webp': 'image/webp',
  }
  res.writeHead(200, { 'content-type': mime[ext] ?? 'application/octet-stream' })
  createReadStream(pathnameResolved).pipe(res)
}

export function startServer(options: GameServerOptions = {}): WebSocketServer {
  const port = options.port ?? DEFAULT_PORT
  const hz = Math.min(30, Math.max(20, options.tickHz ?? Number(process.env.TICK_HZ ?? 25)))
  const dt = 1 / hz

  const httpServer = createServer((req, res) => {
    if (req.method === 'GET') {
      const rawUrl = req.url ?? '/'
      let pathname: string
      try {
        pathname = new URL(rawUrl, 'http://127.0.0.1').pathname
      } catch {
        pathname = '/'
      }
      if (pathname === '/') pathname = '/index.html'

      const rel = pathname.startsWith('/') ? pathname.slice(1) : pathname
      const decoded = decodeURIComponent(rel)
      const full = path.resolve(publicDir, decoded)

      const insidePublic = full.startsWith(publicDir + path.sep)
      if (insidePublic && fs.existsSync(full) && fs.statSync(full).isFile()) {
        servePublicFile(full, res)
        return
      }

      // Avoid silent 404 when the bundle was never built
      if (pathname === '/client.bundle.js' || pathname.endsWith('/client.bundle.js')) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('Missing public/client.bundle.js — run npm run build:client (prestart normally does this)\n')
        return
      }
    }

    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('turboWorms authoritative server · open GET / for the static client · WebSocket ws://this-host\n')
  })

  const wss = new WebSocketServer({ server: httpServer })

  let world = createEmptyWorld({
    bounds: { center: { x: 0, y: 0 }, radius: 6_000 },
  })
  const { fields } = generateSpawnFields(world.bounds, 28, 0x00c0ffee)
  world = { ...world, spawnFields: fields }

  const sessions = new Map<WebSocket, ClientSession>()
  let nextPlayer = 1

  const broadcast = (payload: unknown) => {
    const raw = JSON.stringify(payload)
    for (const { ws } of sessions.values()) {
      if (ws.readyState === WebSocket.OPEN) ws.send(raw)
    }
  }

  wss.on('connection', (ws) => {
    const id = `p-${nextPlayer++}`
    sessions.set(ws, { ws, id, input: idleInput() })
    world = spawnPlayerSnake(world, id, sessions.size - 1)

    ws.send(
      JSON.stringify({
        t: 'welcome',
        id,
        tickHz: hz,
        bounds: world.bounds,
      })
    )

    ws.on('message', (buf) => {
      let msg: unknown
      try {
        msg = JSON.parse(buf.toString())
      } catch {
        return
      }
      if (!msg || typeof msg !== 'object') return
      const body = msg as Record<string, unknown>
      if (body.t !== 'input') return
      const slot = sessions.get(ws)
      if (!slot) return
      const d = body.d
      if (!d || typeof d !== 'object') return
      const patch = d as Partial<PlayerInput>
      slot.input = mergePlayerInput(slot.input, {
        direction:
          patch.direction &&
          typeof patch.direction === 'object' &&
          patch.direction !== null &&
          'x' in patch.direction &&
          'y' in patch.direction
            ? {
                x: Number((patch.direction as Vec2).x),
                y: Number((patch.direction as Vec2).y),
              }
            : undefined,
        fire: typeof patch.fire === 'boolean' ? patch.fire : undefined,
        shield: typeof patch.shield === 'boolean' ? patch.shield : undefined,
        boost: typeof patch.boost === 'boolean' ? patch.boost : undefined,
        turbo: typeof patch.turbo === 'boolean' ? patch.turbo : undefined,
      })
    })

    ws.on('close', () => {
      const slot = sessions.get(ws)
      if (slot) {
        world = removePlayer(world, slot.id)
        sessions.delete(ws)
      }
    })
  })

  let simAcc = 0
  let last = performance.now()

  const loop = () => {
    const now = performance.now()
    simAcc += (now - last) / 1000
    last = now
    while (simAcc >= dt) {
      const inputs = buildTickInputs(sessions.values())
      world = tick(world, inputs, dt)
      for (const s of sessions.values()) {
        s.input.fire = false
      }
      broadcast({ t: 'snap', ...buildSnapshot(world) })
      simAcc -= dt
    }
  }

  const timer = setInterval(loop, 1000 / 128)
  httpServer.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`turboWorms ws://0.0.0.0:${port}  (${hz}Hz sim)`)
  })

  wss.on('close', () => clearInterval(timer))

  return wss
}

const thisFile = fileURLToPath(import.meta.url)
const invoked = process.argv[1] && path.resolve(process.argv[1])
if ((invoked && invoked === thisFile) || process.argv[1]?.endsWith('server.ts')) {
  startServer()
}

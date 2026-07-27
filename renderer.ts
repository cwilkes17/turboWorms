import { FIREBALL_MAX_RANGE_PX } from './abilities.ts'

/**
 * Canvas 2D view: server snapshots + linear interpolation between packets.
 * Procedural glow only — no game simulation.
 */

export type SnapshotSegment = { x: number; y: number }

export type SnapshotSnake = {
  id: string
  alive: boolean
  head: SnapshotSegment
  dir: number
  length: number
  mass: number
  visibleSegments: SnapshotSegment[]
}

export type SnapshotFood = { id: string; x: number; y: number; r: number }

export type SnapshotFireball = {
  id: string
  ownerId: string
  x: number
  y: number
  r: number
  /** Spawn point (world space) — used client-side to fade the projectile out as it
   *  approaches FIREBALL_MAX_RANGE_PX. Falls back to current position if absent. */
  sx?: number
  sy?: number
}

export type GameSnapshot = {
  tick: number
  snakes: SnapshotSnake[]
  food: SnapshotFood[]
  fireballs: SnapshotFireball[]
  /** Authoritative sim food count (snapshot `food` may be a proximity subset when capped). */
  foodTotal?: number
}

export type GameRendererOptions = {
  canvas: HTMLCanvasElement
  scale?: number
  followPlayerId?: string | null
  defaultSnapshotSpacingMs?: number
  backgroundCss?: string
  segmentRadius?: number
  headScale?: number
  /** Draw high-visibility rings/crosshairs on every food orb in the snapshot (debug sync). */
  debugFood?: boolean
}

type Pt = { x: number; y: number }

function clamp01(t: number): number {
  return Math.min(1, Math.max(0, t))
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) }
}

function snakePoints(s: SnapshotSnake): Pt[] {
  return s.visibleSegments.length ? s.visibleSegments.map((p) => ({ x: p.x, y: p.y })) : [{ x: s.head.x, y: s.head.y }]
}

function hashHue(id: string): number {
  let h = 0

  for (let i = 0; i < id.length; i++) h = ((h << 5) - h + id.charCodeAt(i)) >>> 0
  return h % 360
}

/** Wire JSON: `GameSnapshot` or `{ t: 'snap', …same fields }` (snapshot fields live on root). */

export function parseGameSnapshot(raw: unknown): GameSnapshot | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.t !== undefined && r.t !== 'snap') return null
  if (
    typeof r.tick !== 'number' ||
    !Array.isArray(r.snakes) ||
    !Array.isArray(r.food) ||
    !Array.isArray(r.fireballs)
  )
    return null
  return {
    tick: r.tick,
    snakes: r.snakes as SnapshotSnake[],
    food: r.food as SnapshotFood[],
    fireballs: r.fireballs as SnapshotFireball[],
    foodTotal: typeof r.foodTotal === 'number' ? r.foodTotal : undefined,
  }
}

function interpSnakePts(prev: SnapshotSnake | undefined, curr: SnapshotSnake, t: number): Pt[] {
  const b = snakePoints(curr)
  if (!prev) return b
  const a = snakePoints(prev)
  const n = Math.max(a.length, b.length)
  const tt = clamp01(t)
  const out: Pt[] = []
  const pick = (arr: Pt[], i: number) => arr[Math.min(i, arr.length - 1)]!
  for (let i = 0; i < n; i++) out.push(lerpPt(pick(a, i), pick(b, i), tt))
  return out
}

function mapSnakes(list: SnapshotSnake[]): Map<string, SnapshotSnake> {
  const m = new Map<string, SnapshotSnake>()
  for (const s of list) m.set(s.id, s)
  return m
}

function interpFood(prev: SnapshotFood | undefined, curr: SnapshotFood, t: number) {
  if (!prev) return { x: curr.x, y: curr.y, r: curr.r }
  const tt = clamp01(t)
  return { x: lerp(prev.x, curr.x, tt), y: lerp(prev.y, curr.y, tt), r: lerp(prev.r, curr.r, tt) }
}

function interpFb(prev: SnapshotFireball | undefined, curr: SnapshotFireball, t: number) {
  if (!prev) return { x: curr.x, y: curr.y, r: curr.r }
  const tt = clamp01(t)
  return { x: lerp(prev.x, curr.x, tt), y: lerp(prev.y, curr.y, tt), r: lerp(prev.r, curr.r, tt) }
}

function drawSegmentDiscs(
  ctx: CanvasRenderingContext2D,
  pts: Pt[],
  fill: string,
  stroke: string,
  bodyR: number,
  headR: number
) {
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!
    const rad = i === 0 ? headR : bodyR
    ctx.beginPath()
    ctx.arc(p.x, p.y, rad, 0, Math.PI * 2)
    ctx.fillStyle = fill
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

function drawFoodDot(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, hue: number) {
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 4)
  glow.addColorStop(0, `hsla(${hue},100%,72%,1)`)
  glow.addColorStop(0.45, `hsla(${hue},100%,50%,0.28)`)
  glow.addColorStop(1, `hsla(${hue},100%,45%,0)`)
  ctx.save()
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, r * 4, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
  ctx.beginPath()
  ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.fillStyle = `hsl(${hue},92%,62%)`
  ctx.fill()
}

/** High-contrast overlay so every snapshot food entity is unmistakable (world space). */
function drawDebugFoodMarker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  const R = Math.max(r, 2) + 8
  ctx.save()
  ctx.strokeStyle = 'rgba(0,255,140,0.92)'
  ctx.lineWidth = 2
  ctx.setLineDash([4, 4])
  ctx.beginPath()
  ctx.arc(x, y, R, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
  ctx.strokeStyle = 'rgba(255,80,220,0.95)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x - R, y)
  ctx.lineTo(x + R, y)
  ctx.moveTo(x, y - R)
  ctx.lineTo(x, y + R)
  ctx.stroke()
  ctx.restore()
}

/** Fraction of range already traveled where the fade begins (rest of the range fades to 0). */
const FIREBALL_FADE_START_FRACTION = 0.7

/** 1 near spawn, ramping down to 0 as the projectile nears `FIREBALL_MAX_RANGE_PX`.
 *  Purely cosmetic — the server is what actually despawns the fireball at max range;
 *  this just avoids a jarring pop right before that happens. */
function fireballFadeAlpha(traveledPx: number): number {
  const fadeStart = FIREBALL_MAX_RANGE_PX * FIREBALL_FADE_START_FRACTION
  if (traveledPx <= fadeStart) return 1
  const t = (traveledPx - fadeStart) / (FIREBALL_MAX_RANGE_PX - fadeStart)
  return clamp01(1 - t)
}

function drawFireball(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, alpha = 1) {
  ctx.save()
  ctx.globalAlpha = clamp01(alpha)
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r * 5)
  glow.addColorStop(0, 'rgba(255,248,220,1)')
  glow.addColorStop(0.2, 'rgba(255,140,50,0.75)')
  glow.addColorStop(1, 'rgba(200,40,10,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(x, y, r * 5, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(x, y, Math.max(r, 2), 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,210,120,0.95)'
  ctx.fill()
  ctx.restore()
}

export class GameRenderer {
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private scale: number
  private followId: string | null | undefined
  private defaultDt: number
  private bg: string
  private segR: number
  private headMul: number
  private debugFood: boolean

  private prev: GameSnapshot | null = null
  private curr: GameSnapshot | null = null
  private lastRecv = 0
  private ewmaMs = 1000 / 25
  private raf = 0

  constructor(opts: GameRendererOptions) {
    const ctx = opts.canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas 2D context unavailable')

    this.canvas = opts.canvas
    this.ctx = ctx
    this.scale = opts.scale ?? 1.2
    this.followId = opts.followPlayerId
    this.defaultDt = opts.defaultSnapshotSpacingMs ?? 40
    this.bg = opts.backgroundCss ?? '#0b0f14'
    this.segR = opts.segmentRadius ?? 5
    this.headMul = opts.headScale ?? 1.35
    this.debugFood = opts.debugFood ?? false
  }

  pushSnapshot(snap: GameSnapshot): void {
    this.prev = this.curr
    this.curr = snap
    const now = performance.now()
    if (this.lastRecv > 0) {
      const gap = Math.max(8, now - this.lastRecv)

      this.ewmaMs = this.ewmaMs * 0.82 + gap * 0.18
    }
    this.lastRecv = now

  }



  private blendAlpha(now: number): number {


    if (!this.curr) return 0




    const span = Math.max(12, this.ewmaMs, this.defaultDt)


    return clamp01((now - this.lastRecv) / span)


  }




  private cameraTarget(headBySnake: Map<string, Pt[]>): Pt {


    const id = this.followId ?? this.curr?.snakes[0]?.id


    if (id) {


      const h = headBySnake.get(id)


      if (h?.length) return h[0]!




    }




    return { x: 0, y: 0 }


  }




  private renderFrame(now: number): void {


    const ctx = this.ctx


    const w = this.canvas.width


    const h = this.canvas.height


    const s = this.scale


    const alpha = this.blendAlpha(now)



    ctx.setTransform(1, 0, 0, 1, 0, 0)


    ctx.fillStyle = this.bg


    ctx.fillRect(0, 0, w, h)



    if (!this.curr) return



    const pmap = this.prev ? mapSnakes(this.prev.snakes) : null


    const cmap = mapSnakes(this.curr.snakes)


    const ids = [...new Set([...this.curr.snakes.map((x) => x.id), ...(this.prev?.snakes ?? []).map((x) => x.id)])]

      .filter((id) => cmap.has(id))

      .sort()



    const interpPts = new Map<string, Pt[]>()


    for (const id of ids) {


      const c = cmap.get(id)!


      interpPts.set(id, interpSnakePts(pmap?.get(id), c, alpha))


    }



    const cam = this.cameraTarget(interpPts)


    ctx.setTransform(s, 0, 0, s, w / 2 - cam.x * s, h / 2 - cam.y * s)



    const foodPrev = new Map((this.prev?.food ?? []).map((f) => [f.id, f]))


    for (const f of this.curr.food) {
      const q = interpFood(foodPrev.get(f.id), f, alpha)
      drawFoodDot(ctx, q.x, q.y, q.r, hashHue(f.id))
      if (this.debugFood) drawDebugFoodMarker(ctx, q.x, q.y, q.r)
    }



    const fbPrev = new Map((this.prev?.fireballs ?? []).map((fb) => [fb.id, fb]))



    for (const fb of this.curr.fireballs) {


      const q = interpFb(fbPrev.get(fb.id), fb, alpha)
      const sx = fb.sx ?? fb.x
      const sy = fb.sy ?? fb.y
      const traveled = Math.hypot(q.x - sx, q.y - sy)
      drawFireball(ctx, q.x, q.y, q.r, fireballFadeAlpha(traveled))



    }



    for (const id of ids) {
      const pts = interpPts.get(id)
      const snake = cmap.get(id)
      if (!snake || !pts?.length || !snake.alive) continue
      const hue = hashHue(id)
      drawSegmentDiscs(ctx, pts, `hsl(${hue},52%,44%)`, `hsl(${hue},65%,18%)`, this.segR, this.segR * this.headMul)
    }

    if (this.debugFood && this.curr) {
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      const sent = this.curr.food.length
      const tot = this.curr.foodTotal
      let msg = `food in snapshot: ${sent}`
      if (tot !== undefined) msg += `  ·  sim total: ${tot}`
      if (tot !== undefined && tot > sent) msg += '  (subset)'
      ctx.font = '12px ui-monospace, system-ui, sans-serif'
      ctx.fillStyle = 'rgba(200,255,220,0.95)'
      ctx.fillText(msg, 10, 22)
      if (tot !== undefined && tot > sent) {
        ctx.fillStyle = 'rgba(255,210,120,0.9)'
        ctx.font = '11px ui-monospace, system-ui, sans-serif'
        ctx.fillText('distant orbs exist but are omitted from wire cap — raise MAX_FOOD_IN_SNAPSHOT', 10, 40)
      }
    }
  }



  start(): void {


    const loop = (now: number) => {


      this.renderFrame(now)


      this.raf = requestAnimationFrame(loop)


    }


    this.raf = requestAnimationFrame(loop)


  }



  stop(): void {


    cancelAnimationFrame(this.raf)


  }


}


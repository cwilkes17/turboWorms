*Paired doc: `docs/ARCHITECTURE.md` (how this is built). Root `AGENTS.md` is
the entry point for any coding agent. If you change a number/rule here,
add a line to `docs/DECISIONS.md` explaining why.*

## **Vision**

**turboWorms** is a fast, chaotic multiplayer worm arena: eat floating food, grow thicker and longer, spend mass on abilities, kill others, claim their corpse food. Feel is twitchy PvP with a soft turn cap (not instant 180s).

**Long-term goal:** large rooms (100–200). **This PRODUCT’s MVP** is a small playable room that nails rules and feel first.

## **Core loop**

1. Move constantly forward; steer with WASD.
2. Eat food → mass up → body thicker + longer; camera zooms out.
3. Spend mass → fireball / shield / boost / turbo.
4. Kill others → they vanish; **corpse food** appears under their last pose.
5. Die → same corpse rules for you.

## **Feel & input**


| **Input**     | **Behavior**                                                 |
| ------------- | ------------------------------------------------------------ |
| WASD / arrows | Desired facing                                               |
| Turning       | **Hard angular rate cap** (prototype-style); no instant snap |
| Space         | Fireball (subject to cooldown)                               |
| Q             | Shield hold                                                  |
| Shift         | Boost hold                                                   |
| E             | Turbo hold                                                   |


Client may send inputs often; **server is authoritative** for all outcomes.

## **World & camera**

- **Map:** finite **circle**.
- **Camera:** centered on local worm; starts **zoomed in** when small.
- **Zoom:** as mass grows, zoom **out**; player **never** sees the whole map. Upper zoom is intentionally limited (target ~≤15% of map diameter — tune in playtest).
- **Body representation (slither-like):**
  - Mass increases **segment diameter** and **segment count**.
  - Thicker segments → fewer discs needed for the same “size.”
  - Renderer **must not** draw unbounded thousands of discs; truncate / budget visible body as you grow (far tail omitted when needed).
- **Minimap:** small semi-transparent overlay; each worm = head dot; local player highlighted.

## **Mass & growth**

- **Resource = mass** (also drives length/thickness).
- **Start mass: 20.**
- Eating food increases mass; abilities decrease mass.
- **Mass HUD:** visible number for the local player; **animates up/down** as mass changes (eat / ability spend / drain).
- Length/thickness sync from mass (exact formula is architecture/tuning; product rule: **more mass ⇒ bigger head/body discs and more length**).
- using abilities, which lose mass, should shrink you back down, growing and shrinking should be noticeable but not jerky or sudden, theres a light softness to the shrinking or the growing
- segment growth and segment addition should be reasonably scaled for browser performance, this should also dictate the zoom curve 

## **Movement & boost**

- Constant forward motion at intrinsic speed.
- **Boost:** +50% speed while held; costs **2 mass/sec** (equiv. 2 normal orbs/sec); only if affordable that tick.
- **Turbo:** ×3 speed while held; costs **10% of current mass per second**; **suppresses boost** if both held.
- Releasing boost/turbo **stops** the speed effect immediately.

## **Combat**


| **Event**                 | **Result**                                               |
| ------------------------- | -------------------------------------------------------- |
| Head ↔ enemy head         | Both die                                                 |
| Your head ↔ enemy body    | You die                                                  |
| Your head ↔ your own body | **No death**                                             |
| Fireball ↔ enemy **head** | Target dies; projectile removed                          |
| Fireball ↔ **body** (any) | Projectile removed; **snake does not die** from body hit |
| Fireball ↔ **shield**     | See Shield                                               |


## **Abilities**

### **Fireball**

- Spends **10% of current mass** on fire.
- Spawns at head, travels straight along facing; radius scales with head size.
- **5 second cooldown** after a successful fire.
- Lethal **only on head**, and **only on enemies** — a fireball can never kill its
  own owner, even if it's still overlapping their head the instant it spawns
  (see Combat).
- **Range:** despawns after traveling **900px** from where it fired (roughly
  half a screen at default zoom) — real range, but can't snipe across the
  map. Fades out over the last ~30% of that distance rather than popping.

### **Shield**

- Hold to activate.
- Drains **1% of current mass per second** while active (and mass remains).
- **Blocks fireballs only** (does not block head/body collision death).
- **VFX:** blue glowing force field around **each** body segment.
- On fireball hit while shielded:
  1. Fireball **bounces** off the shield.
  2. After bounce it is **no longer deadly**.
  3. It **fades to black** and **despawns** a short distance after the bounce.

### **Boost / Turbo**

- hold space to activate
- see boost/turbo above





## **Food**

- Spawn in **fields** biased toward map center; center fields can spawn slightly larger “double” orbs (still worth 1 mass unless PRODUCT later changes).
- **Fewer** orbs than the dense prototype; fields/drift regions are **larger**.
- Motion: **floaty Brownian** — motes of dust in sunlight — soft containment, **not** hard bounce off invisible walls.
- **Head vacuum:** nearby orbs are gently pulled toward alive heads (keep prototype feel).
- Normal orb size = baseline; death orbs are separate (below).

## **Death & corpse food**

- On death, worm vanishes.
- Spawn **dead worms mass/5 corpse food orbs** at death, placed roughly along the **exact segment positions** at death (pretzel shape ⇒ pretzel food trail “under” the body). give a small random vector from segment starting position to give it some "interestingness"
- Corpse orbs are **5×** the radius of normal food. have a much tighter brownian motion, and are exrta glowy
- Mass value of corpse orbs: **5 each** unless playtest says otherwise (tunable; call out in ARCHITECTURE).
- Even a small worm still drops orbs the mass it has.

## **UI (MVP)**

- Canvas world view + mass number HUD.
- Ability feedback can be minimal (cooldown feel via can’t-fire).
- Minimap as above.
- Optional debug flags allowed for development; not part of product feel.

## **MVP in / out**

**In**

- Multiplayer WebSocket room + canvas client.
- Rules above (turn cap, combat, abilities, food feel, vacuum, corpse layout, zoom/thickness growth, mass HUD, minimap).

**Out (v1)**

- 100–200 CCU, matchmaking, accounts.
- Binary/compressed net protocol.
- Perfect zoom curve on first ship (tune after playtest).
- Non-canvas / React entity rendering.

## **Open tuning (not rule conflicts)**

These may change numbers without a PRODUCT rewrite, but behavior stays:

- Exact turn-rate (rad/s), vacuum range/strength.
- Zoom curve coefficients; max visible segment count.
- Shield bounce angle, fade distance/time.
- Food field count/size/spawn interval; Brownian strength.
- Corpse orb mass per orb.


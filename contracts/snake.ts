export type Vec2 = {
x: number
y: number
}

export type Snake = {
id: string
segments: Vec2[]
mass: number
direction: number
speed: number
alive: boolean
state: {
    shield: boolean
    fireballCooldown: number
  }
}

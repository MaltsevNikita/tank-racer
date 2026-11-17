'use client'

import { useEffect, useRef } from 'react'
import * as THREE from 'three'

const DEG = Math.PI / 180

const CONFIG = {
  WORLD: 1600,
  TERRAIN_EXCESS: 2000,
  TANK_W: 40,
  TANK_H: 30,
  BULLET_SPEED: 6,
  BULLET_RADIUS: 4,
  BULLET_Y: 15,
  PLAYER_SPEED: 3,
  REVERSE_MULT: 1,
  PLAYER_TURN_DEG: 1.5,
  ENEMY_TURN_DEG: 3,
  PLAYER_RELOAD: 0.4,
  PLAYER_HP: 10,
  INVULN: 0.5,
  KNOCKBACK: 30,
  BASE_GROUND: 5,
  ENEMY_HP: 5,
  ENEMY_SPEED: 2.2,
  ENEMY_FIRE_RANGE: 300,
  ENEMY_VIEW_RANGE: 450,
  ENEMY_FIRE_MIN: 1.5,
  ENEMY_FIRE_MAX: 2.0,
  ENEMY_ACCURACY: 0.4,
  ENEMY_DEVIATION: 15,
  FEAR_HP: 2,
  OBSTACLE_SIZE: 60,
  OBSTACLE_HEIGHT: 20,
  OBSTACLE_HP: 3,
  STEP: 1 / 60,
}

const HILLS = [
  { x: 400, z: 1000, r: 130, h: 7 },
  { x: 1200, z: 1000, r: 130, h: 7 },
  { x: 1000, z: 400, r: 130, h: 7 },
  { x: 1000, z: 1200, r: 130, h: 7 },
  { x: 600, z: 600, r: 110, h: 6 },
  { x: 1000, z: 1000, r: 110, h: 6 },
  { x: 500, z: 1350, r: 100, h: 5 },
  { x: 1350, z: 500, r: 100, h: 5 },
  { x: 1350, z: 1000, r: 90, h: 4 },
  { x: 250, z: 1100, r: 90, h: 4 },
  { x: 1100, z: 250, r: 90, h: 4 },
  { x: 250, z: 500, r: 90, h: 4 },
]

function terrainHeight(x: number, z: number): number {
  let h = CONFIG.BASE_GROUND
  for (const hill of HILLS) {
    const dx = x - hill.x
    const dz = z - hill.z
    const bump = CONFIG.BASE_GROUND + hill.h * Math.exp(-(dx * dx + dz * dz) / (2 * hill.r * hill.r))
    if (bump > h) h = bump
  }
  return h
}

type Owner = 'player' | 'enemy'
type Status = 'playing' | 'victory' | 'gameover'

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min)
}

const OBSTACLE_POS: Array<[number, number]> = [
  [400, 400],
  [1200, 400],
  [400, 1200],
  [1200, 1200],
  [800, 300],
  [800, 1300],
]

const MEDKIT_POS: Array<[number, number]> = [
  [800, 180],
  [800, 1420],
  [180, 800],
  [1420, 800],
  [500, 500],
  [1100, 1100],
]

class Obstacle {
  x: number
  y: number
  w = CONFIG.OBSTACLE_SIZE
  h = CONFIG.OBSTACLE_SIZE
  hp = CONFIG.OBSTACLE_HP
  alive = true

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }

  get left() {
    return this.x - this.w / 2
  }

  get right() {
    return this.x + this.w / 2
  }

  get top() {
    return this.y - this.h / 2
  }

  get bottom() {
    return this.y + this.h / 2
  }
}

class Tank {
  x: number
  y: number
  angle: number
  hp: number
  isPlayer: boolean
  alive = true
  reload = 0
  invuln = 0

  constructor(x: number, y: number, angle: number, hp: number, isPlayer: boolean) {
    this.x = x
    this.y = y
    this.angle = angle
    this.hp = hp
    this.isPlayer = isPlayer
  }

  get halfW() {
    return CONFIG.TANK_W / 2
  }

  get halfH() {
    return CONFIG.TANK_H / 2
  }
}

class Enemy extends Tank {
  fireCooldown: number
  fearAngle: number
  fearTimer: number
  patrolX: number
  patrolY: number
  patrolTimer: number

  constructor(x: number, y: number) {
    super(x, y, Math.random() * Math.PI * 2, CONFIG.ENEMY_HP, false)
    this.fireCooldown = rand(CONFIG.ENEMY_FIRE_MIN, CONFIG.ENEMY_FIRE_MAX)
    this.fearAngle = Math.random() * Math.PI * 2
    this.fearTimer = rand(0.8, 1.5)
    this.patrolX = rand(80, CONFIG.WORLD - 80)
    this.patrolY = rand(80, CONFIG.WORLD - 80)
    this.patrolTimer = rand(2, 4)
  }

  get inFear() {
    return this.hp <= CONFIG.FEAR_HP
  }
}

class Bullet {
  x: number
  y: number
  vx: number
  vy: number
  owner: Owner
  radius = CONFIG.BULLET_RADIUS

  constructor(x: number, y: number, angle: number, owner: Owner) {
    this.x = x
    this.y = y
    this.vx = Math.cos(angle) * CONFIG.BULLET_SPEED
    this.vy = Math.sin(angle) * CONFIG.BULLET_SPEED
    this.owner = owner
  }

  update() {
    this.x += this.vx
    this.y += this.vy
  }
}

class Medkit {
  x: number
  y: number
  taken = false

  constructor(x: number, y: number) {
    this.x = x
    this.y = y
  }
}

class Game {
  player!: Tank
  enemies: Enemy[] = []
  bullets: Bullet[] = []
  obstacles: Obstacle[] = []
  medkits: Medkit[] = []
  status: Status = 'playing'
  keys = new Set<string>()
  activeAttacker: Enemy | null = null
  deathEvents: Array<{ x: number; y: number }> = []

  constructor() {
    this.reset()
  }

  reset() {
    this.status = 'playing'
    this.bullets = []
    this.deathEvents = []
    this.keys.clear()
    this.player = new Tank(800, 800, -90 * DEG, CONFIG.PLAYER_HP, true)
    this.enemies = []
    for (let i = 0; i < 5; i++) {
      const [x, y] = this.randomSpawnPoint()
      this.enemies.push(new Enemy(x, y))
    }
    this.obstacles = OBSTACLE_POS.map(([x, y]) => new Obstacle(x, y))
    this.medkits = MEDKIT_POS.map(([x, y]) => new Medkit(x, y))
  }

  randomSpawnPoint(): [number, number] {
    const margin = 140
    for (let attempt = 0; attempt < 60; attempt++) {
      const x = rand(margin, CONFIG.WORLD - margin)
      const y = rand(margin, CONFIG.WORLD - margin)
      const dxp = x - this.player.x
      const dyp = y - this.player.y
      if (Math.hypot(dxp, dyp) < 380) continue
      let ok = true
      for (const e of this.enemies) {
        if (Math.hypot(x - e.x, y - e.y) < 320) {
          ok = false
          break
        }
      }
      if (ok) return [x, y]
    }
    return [rand(margin, CONFIG.WORLD - margin), rand(margin, CONFIG.WORLD - margin)]
  }

  tryShoot() {
    if (this.status !== 'playing') return
    const p = this.player
    if (p.reload > 0) return
    p.reload = CONFIG.PLAYER_RELOAD
    this.fire(p.x + Math.cos(p.angle) * 24, p.y + Math.sin(p.angle) * 24, p.angle, 'player')
  }

  fire(x: number, y: number, angle: number, owner: Owner) {
    this.bullets.push(new Bullet(x, y, angle, owner))
  }

  clamp(t: Tank) {
    const w = CONFIG.WORLD
    t.x = Math.min(Math.max(t.x, t.halfW), w - t.halfW)
    t.y = Math.min(Math.max(t.y, t.halfH), w - t.halfH)
  }

  resolveTankObstacle(t: Tank, o: Obstacle) {
    const ox = t.halfW + o.w / 2 - Math.abs(t.x - o.x)
    const oy = t.halfH + o.h / 2 - Math.abs(t.y - o.y)
    if (ox <= 0 || oy <= 0) return
    if (ox < oy) {
      t.x += (t.x < o.x ? -1 : 1) * ox
    } else {
      t.y += (t.y < o.y ? -1 : 1) * oy
    }
  }

  moveTank(t: Tank, dx: number, dy: number) {
    t.x += dx
    this.clamp(t)
    for (const o of this.obstacles) this.resolveTankObstacle(t, o)
    t.y += dy
    this.clamp(t)
    for (const o of this.obstacles) this.resolveTankObstacle(t, o)
  }

  turnToward(t: Tank, target: number) {
    let diff = target - t.angle
    while (diff > Math.PI) diff -= Math.PI * 2
    while (diff < -Math.PI) diff += Math.PI * 2
    const step = CONFIG.ENEMY_TURN_DEG * DEG
    t.angle += Math.max(-step, Math.min(step, diff))
  }

  update() {
    if (this.status !== 'playing') return
    this.updatePlayer()
    this.selectAttacker()
    for (const e of this.enemies) this.updateEnemy(e)
    this.updateBullets()
    this.updateMedkits()

    this.player.reload = Math.max(0, this.player.reload - CONFIG.STEP)
    this.player.invuln = Math.max(0, this.player.invuln - CONFIG.STEP)
    this.resolveTankCollisions()

    if (this.enemies.length === 0) this.status = 'victory'
    if (this.player.hp <= 0) {
      this.deathEvents.push({ x: this.player.x, y: this.player.y })
      this.status = 'gameover'
    }
  }

  updateMedkits() {
    const p = this.player
    for (const m of this.medkits) {
      if (m.taken || p.hp >= CONFIG.PLAYER_HP) continue
      if (Math.hypot(p.x - m.x, p.y - m.y) < 32) {
        p.hp = CONFIG.PLAYER_HP
        m.taken = true
      }
    }
  }

  selectAttacker() {
    let best: Enemy | null = null
    let bestDist = Infinity
    for (const e of this.enemies) {
      if (!this.canSeePlayer(e)) continue
      const d = Math.hypot(e.x - this.player.x, e.y - this.player.y)
      if (d < bestDist) {
        bestDist = d
        best = e
      }
    }
    this.activeAttacker = best
  }

  updatePlayer() {
    const p = this.player
    const k = this.keys

    if (k.has('KeyD') || k.has('ArrowRight')) p.angle += CONFIG.PLAYER_TURN_DEG * DEG
    if (k.has('KeyA') || k.has('ArrowLeft')) p.angle -= CONFIG.PLAYER_TURN_DEG * DEG

    let move = 0
    if (k.has('KeyW') || k.has('ArrowUp')) move += 1
    if (k.has('KeyS') || k.has('ArrowDown')) move -= 1

    if (move !== 0) {
      const speed = move > 0 ? CONFIG.PLAYER_SPEED : CONFIG.PLAYER_SPEED * CONFIG.REVERSE_MULT
      const sign = Math.sign(move)
      this.moveTank(p, Math.cos(p.angle) * speed * sign, Math.sin(p.angle) * speed * sign)
    }
  }

  updateEnemy(e: Enemy) {
    const p = this.player
    const dx = p.x - e.x
    const dy = p.y - e.y
    const dist = Math.hypot(dx, dy)
    const toPlayer = Math.atan2(dy, dx)

    if (e.inFear) {
      e.fireCooldown = CONFIG.ENEMY_FIRE_MAX
      e.fearTimer -= CONFIG.STEP
      if (e.fearTimer <= 0) {
        e.fearTimer = rand(0.8, 1.5)
        e.fearAngle = toPlayer + Math.PI + rand(-30, 30) * DEG
      }
      this.turnToward(e, e.fearAngle)
      this.moveTank(e, Math.cos(e.angle) * CONFIG.ENEMY_SPEED, Math.sin(e.angle) * CONFIG.ENEMY_SPEED)
      return
    }

    if (e === this.activeAttacker) {
      this.turnToward(e, toPlayer)
      if (dist < CONFIG.ENEMY_FIRE_RANGE) {
        if (e.fireCooldown <= 0) {
          this.enemyShoot(e)
          e.fireCooldown = rand(CONFIG.ENEMY_FIRE_MIN, CONFIG.ENEMY_FIRE_MAX)
        }
      } else {
        this.moveTank(e, Math.cos(e.angle) * CONFIG.ENEMY_SPEED, Math.sin(e.angle) * CONFIG.ENEMY_SPEED)
      }
    } else {
      e.patrolTimer -= CONFIG.STEP
      const wpdx = e.patrolX - e.x
      const wpdy = e.patrolY - e.y
      if (e.patrolTimer <= 0 || Math.hypot(wpdx, wpdy) < 20) {
        e.patrolX = rand(80, CONFIG.WORLD - 80)
        e.patrolY = rand(80, CONFIG.WORLD - 80)
        e.patrolTimer = rand(2, 4)
      }
      this.turnToward(e, Math.atan2(wpdy, wpdx))
      this.moveTank(e, Math.cos(e.angle) * CONFIG.ENEMY_SPEED, Math.sin(e.angle) * CONFIG.ENEMY_SPEED)
    }
    e.fireCooldown = Math.max(0, e.fireCooldown - CONFIG.STEP)
  }

  canSeePlayer(e: Enemy): boolean {
    const p = this.player
    const dx = p.x - e.x
    const dy = p.y - e.y
    if (dx * dx + dy * dy > CONFIG.ENEMY_VIEW_RANGE * CONFIG.ENEMY_VIEW_RANGE) return false
    for (const o of this.obstacles) {
      if (o.alive && segmentHitsRect(e.x, e.y, p.x, p.y, o)) return false
    }
    return true
  }

  enemyShoot(e: Enemy) {
    const p = this.player
    let aim = Math.atan2(p.y - e.y, p.x - e.x)
    if (Math.random() > CONFIG.ENEMY_ACCURACY) {
      aim += rand(-CONFIG.ENEMY_DEVIATION, CONFIG.ENEMY_DEVIATION) * DEG
    }
    this.fire(e.x + Math.cos(aim) * 24, e.y + Math.sin(aim) * 24, aim, 'enemy')
  }

  updateBullets() {
    const next: Bullet[] = []
    for (const b of this.bullets) {
      b.update()
      if (b.x < -10 || b.x > CONFIG.WORLD + 10 || b.y < -10 || b.y > CONFIG.WORLD + 10) continue

      let hit = false
      for (const o of this.obstacles) {
        if (o.alive && circleRect(b, o)) {
          o.hp -= 1
          if (o.hp <= 0) o.alive = false
          hit = true
          break
        }
      }
      if (hit) continue

      if (b.owner === 'player') {
        for (const e of this.enemies) {
          if (e.alive && circleRectTank(b, e)) {
            e.hp -= 1
            if (e.hp <= 0) {
              e.alive = false
              this.deathEvents.push({ x: e.x, y: e.y })
            }
            hit = true
            break
          }
        }
      } else {
        const p = this.player
        if (p.hp > 0 && p.invuln <= 0 && circleRectTank(b, p)) {
          p.hp -= 1
          p.invuln = CONFIG.INVULN
          const ba = Math.atan2(b.vy, b.vx)
          this.moveTank(p, Math.cos(ba) * CONFIG.KNOCKBACK, Math.sin(ba) * CONFIG.KNOCKBACK)
          hit = true
        }
      }
      if (hit) continue
      next.push(b)
    }

    this.bullets = next
    this.enemies = this.enemies.filter((e) => e.alive)
    this.obstacles = this.obstacles.filter((o) => o.alive)
  }

  resolveTankCollisions() {
    const tanks: Tank[] = [this.player, ...this.enemies]
    for (let i = 0; i < tanks.length; i++) {
      for (let j = i + 1; j < tanks.length; j++) {
        const a = tanks[i]
        const b = tanks[j]
        const ox = a.halfW + b.halfW - Math.abs(a.x - b.x)
        const oy = a.halfH + b.halfH - Math.abs(a.y - b.y)
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const dir = a.x < b.x ? -1 : 1
            a.x += (ox / 2) * dir
            b.x -= (ox / 2) * dir
          } else {
            const dir = a.y < b.y ? -1 : 1
            a.y += (oy / 2) * dir
            b.y -= (oy / 2) * dir
          }
        }
      }
    }
    for (const t of tanks) this.clamp(t)
  }
}

function circleRect(b: Bullet, o: Obstacle): boolean {
  const cx = Math.max(o.left, Math.min(b.x, o.right))
  const cy = Math.max(o.top, Math.min(b.y, o.bottom))
  const dx = b.x - cx
  const dy = b.y - cy
  return dx * dx + dy * dy < b.radius * b.radius
}

function circleRectTank(b: Bullet, t: Tank): boolean {
  const cx = Math.max(t.x - t.halfW, Math.min(b.x, t.x + t.halfW))
  const cy = Math.max(t.y - t.halfH, Math.min(b.y, t.y + t.halfH))
  const dx = b.x - cx
  const dy = b.y - cy
  return dx * dx + dy * dy < b.radius * b.radius
}

function segmentHitsRect(x1: number, y1: number, x2: number, y2: number, o: Obstacle): boolean {
  const dx = x2 - x1
  const dy = y2 - y1
  let tmin = 0
  let tmax = 1

  if (Math.abs(dx) < 1e-9) {
    if (x1 < o.left || x1 > o.right) return false
  } else {
    let t1 = (o.left - x1) / dx
    let t2 = (o.right - x1) / dx
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return false
  }

  if (Math.abs(dy) < 1e-9) {
    if (y1 < o.top || y1 > o.bottom) return false
  } else {
    let t1 = (o.top - y1) / dy
    let t2 = (o.bottom - y1) / dy
    if (t1 > t2) {
      const tmp = t1
      t1 = t2
      t2 = tmp
    }
    tmin = Math.max(tmin, t1)
    tmax = Math.min(tmax, t2)
    if (tmin > tmax) return false
  }

  return true
}

interface ExplosionParticle {
  mesh: THREE.Mesh
  vx: number
  vy: number
  vz: number
  life: number
  maxLife: number
  size: number
}

class Explosion {
  particles: ExplosionParticle[] = []
  flash: THREE.Mesh
  flashMat: THREE.MeshBasicMaterial
  life = 0
  duration = 0.7
  finished = false

  constructor(scene: THREE.Scene, x: number, y: number, z: number) {
    const geo = new THREE.SphereGeometry(1, 8, 8)
    const count = 22
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd54f,
        transparent: true,
        depthWrite: false,
      })
      const mesh = new THREE.Mesh(geo, mat)
      mesh.position.set(x, y, z)
      const a = Math.random() * Math.PI * 2
      const elev = (Math.random() - 0.5) * Math.PI
      const speed = rand(12, 44)
      const size = rand(4, 9)
      mesh.scale.setScalar(size)
      this.particles.push({
        mesh,
        vx: Math.cos(a) * Math.cos(elev) * speed,
        vy: Math.abs(Math.sin(elev)) * speed * 0.8 + 6,
        vz: Math.sin(a) * Math.cos(elev) * speed,
        life: rand(0.4, 0.7),
        maxLife: 0.7,
        size,
      })
      scene.add(mesh)
    }

    this.flashMat = new THREE.MeshBasicMaterial({
      color: 0xffaa33,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    })
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 16), this.flashMat)
    this.flash.position.set(x, y, z)
    scene.add(this.flash)
  }

  update(dt: number) {
    this.life += dt
    if (this.life >= this.duration) {
      this.finished = true
      return
    }
    const t = this.life / this.duration
    const fade = 1 - t

    for (const p of this.particles) {
      p.life -= dt
      if (p.life <= 0) continue
      p.vy -= 30 * dt
      p.mesh.position.x += p.vx * dt
      p.mesh.position.y += p.vy * dt
      p.mesh.position.z += p.vz * dt
      const lt = 1 - p.life / p.maxLife
      const mat = p.mesh.material as THREE.MeshBasicMaterial
      mat.color.setHSL(0.08 - lt * 0.05, 1, 0.5 - lt * 0.2)
      mat.opacity = fade
      p.mesh.scale.setScalar(p.size * (1 - lt * 0.6))
    }

    this.flash.scale.setScalar(1 + t * 18)
    this.flashMat.opacity = 0.9 * (1 - t)
  }

  dispose(scene: THREE.Scene) {
    for (const p of this.particles) {
      scene.remove(p.mesh)
      p.mesh.geometry.dispose()
      ;(p.mesh.material as THREE.Material).dispose()
    }
    scene.remove(this.flash)
    this.flash.geometry.dispose()
    this.flashMat.dispose()
  }
}

class Renderer3D {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  game: Game
  overlay: HTMLCanvasElement
  octx: CanvasRenderingContext2D
  clientW = 0
  clientH = 0
  tankGroups = new Map<Tank, THREE.Group>()
  obstacleMeshes = new Map<Obstacle, THREE.Mesh>()
  bulletMeshes = new Map<Bullet, THREE.Mesh>()
  bulletHalos = new Map<Bullet, THREE.LineSegments>()
  medkitMeshes = new Map<Medkit, THREE.Group>()
  tmpVec = new THREE.Vector3()
  sun!: THREE.DirectionalLight
  explosions: Explosion[] = []
  lastRenderTime = 0

  constructor(
    canvas: HTMLCanvasElement,
    overlay: HTMLCanvasElement,
    octx: CanvasRenderingContext2D,
    game: Game,
  ) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.scene = new THREE.Scene()
    this.scene.background = new THREE.Color(0x1b2a3a)
    this.scene.fog = new THREE.Fog(0x1b2a3a, 800, 3200)
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 9000)
    this.overlay = overlay
    this.octx = octx
    this.game = game
    this.setupLights()
    this.setupTerrain()
    this.setupWalls()
    this.rebuild()
  }

  setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.75)
    this.scene.add(ambient)

    this.sun = new THREE.DirectionalLight(0xffffff, 1.4)
    this.sun.castShadow = true
    this.sun.shadow.mapSize.set(2048, 2048)
    this.sun.shadow.camera.left = -1300
    this.sun.shadow.camera.right = 1300
    this.sun.shadow.camera.top = 1300
    this.sun.shadow.camera.bottom = -1300
    this.sun.shadow.camera.near = 1
    this.sun.shadow.camera.far = 2600
    this.scene.add(this.sun)
    const target = new THREE.Object3D()
    this.sun.target = target
    this.scene.add(target)
  }

  setupTerrain() {
    const seg = 200
    const size = CONFIG.WORLD + 2 * CONFIG.TERRAIN_EXCESS
    const geo = new THREE.PlaneGeometry(size, size, seg, seg)
    geo.rotateX(-Math.PI / 2)
    const pos = geo.attributes.position
    const colors: number[] = []
    let hMax = 0
    for (let i = 0; i < pos.count; i++) {
      const wx = pos.getX(i) + CONFIG.WORLD / 2
      const wz = pos.getZ(i) + CONFIG.WORLD / 2
      const h = terrainHeight(wx, wz)
      pos.setY(i, h)
      if (h > hMax) hMax = h
    }
    const base = new THREE.Color(0x3a6b46)
    const light = new THREE.Color(0x7fb069)
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getY(i) / (hMax || 1)
      const c = base.clone().lerp(light, t)
      colors.push(c.r, c.g, c.b)
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
    geo.computeVertexNormals()

    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      vertexColors: true,
      roughness: 1,
      metalness: 0,
    })
    const terrain = new THREE.Mesh(geo, mat)
    terrain.receiveShadow = true
    this.scene.add(terrain)
  }

  setupWalls() {
    const W = CONFIG.WORLD
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.85 })
    const xWallGeo = new THREE.BoxGeometry(6, 24, W)
    const zWallGeo = new THREE.BoxGeometry(W, 24, 6)

    const wallY = 12 + CONFIG.BASE_GROUND

    const west = new THREE.Mesh(xWallGeo, wallMat)
    west.position.set(-3, wallY, W / 2)
    const east = new THREE.Mesh(xWallGeo, wallMat)
    east.position.set(W + 3, wallY, W / 2)
    const south = new THREE.Mesh(zWallGeo, wallMat)
    south.position.set(W / 2, wallY, -3)
    const north = new THREE.Mesh(zWallGeo, wallMat)
    north.position.set(W / 2, wallY, W + 3)

    for (const wall of [west, east, south, north]) {
      wall.castShadow = true
      wall.receiveShadow = true
      this.scene.add(wall)
    }
  }

  obstacleColor(hp: number): number {
    return hp === CONFIG.OBSTACLE_HP ? 0x5a5f66 : hp === 2 ? 0x7a5c34 : 0x3c4046
  }

  buildTankMesh(t: Tank): THREE.Group {
    const group = new THREE.Group()
    const bodyMat = new THREE.MeshStandardMaterial({
      color: t.isPlayer ? 0x4caf50 : 0xf44336,
      roughness: 0.7,
      metalness: 0.1,
    })
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.9 })
    const turretMat = new THREE.MeshStandardMaterial({
      color: t.isPlayer ? 0x388e3c : 0xc62828,
      roughness: 0.7,
      metalness: 0.1,
    })

    const barrel = new THREE.Mesh(new THREE.BoxGeometry(22, 5, 5), darkMat)
    barrel.position.set(11, 5, 0)
    barrel.castShadow = true
    group.add(barrel)

    const trackGeo = new THREE.BoxGeometry(40, 4, 5)
    const trackL = new THREE.Mesh(trackGeo, darkMat)
    trackL.position.set(0, -3, -12.5)
    const trackR = new THREE.Mesh(trackGeo, darkMat)
    trackR.position.set(0, -3, 12.5)
    trackL.castShadow = true
    trackR.castShadow = true
    group.add(trackL, trackR)

    const body = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 30), bodyMat)
    body.castShadow = true
    group.add(body)

    const turret = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 5, 24), turretMat)
    turret.position.y = 6.5
    turret.castShadow = true
    group.add(turret)

    group.position.set(t.x, terrainHeight(t.x, t.y) + 3, t.y)
    group.rotation.y = -t.angle
    this.scene.add(group)
    return group
  }

  buildObstacleMesh(o: Obstacle): THREE.Mesh {
    const mat = new THREE.MeshStandardMaterial({ color: this.obstacleColor(o.hp), roughness: 0.85 })
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(o.w, CONFIG.OBSTACLE_HEIGHT, o.h), mat)
    mesh.position.set(o.x, terrainHeight(o.x, o.y) + CONFIG.OBSTACLE_HEIGHT / 2, o.y)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.scene.add(mesh)
    return mesh
  }

  buildBulletMeshes(): { mesh: THREE.Mesh; halo: THREE.LineSegments } {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(CONFIG.BULLET_RADIUS, 14, 14),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    )
    const haloGeo = new THREE.WireframeGeometry(new THREE.SphereGeometry(CONFIG.BULLET_RADIUS + 0.8, 10, 10))
    const halo = new THREE.LineSegments(haloGeo, new THREE.LineBasicMaterial({ color: 0xff0000 }))
    this.scene.add(mesh)
    this.scene.add(halo)
    return { mesh, halo }
  }

  buildMedkitMesh(): THREE.Group {
    const group = new THREE.Group()
    const white = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
    const red = new THREE.MeshStandardMaterial({ color: 0xd32f2f, roughness: 0.4 })

    const box = new THREE.Mesh(new THREE.BoxGeometry(12, 12, 12), white)
    box.castShadow = true
    group.add(box)

    const barY = new THREE.Mesh(new THREE.BoxGeometry(4, 10, 3), red)
    barY.position.set(0, 0, 4.5)
    const barX = new THREE.Mesh(new THREE.BoxGeometry(10, 4, 3), red)
    barX.position.set(0, 0, 4.5)
    group.add(barY, barX)

    this.scene.add(group)
    return group
  }

  rebuild() {
    for (const g of this.tankGroups.values()) {
      this.scene.remove(g)
      this.disposeObject(g)
    }
    for (const m of this.obstacleMeshes.values()) {
      this.scene.remove(m)
      this.disposeObject(m)
    }
    for (const b of this.bulletMeshes.values()) {
      this.scene.remove(b)
      this.disposeObject(b)
    }
    for (const h of this.bulletHalos.values()) {
      this.scene.remove(h)
      this.disposeObject(h)
    }
    for (const k of this.medkitMeshes.values()) {
      this.scene.remove(k)
      this.disposeObject(k)
    }
    for (const ex of this.explosions) ex.dispose(this.scene)
    this.explosions = []
    this.tankGroups.clear()
    this.obstacleMeshes.clear()
    this.bulletMeshes.clear()
    this.bulletHalos.clear()
    this.medkitMeshes.clear()

    this.tankGroups.set(this.game.player, this.buildTankMesh(this.game.player))
    for (const e of this.game.enemies) this.tankGroups.set(e, this.buildTankMesh(e))
    for (const o of this.game.obstacles) this.obstacleMeshes.set(o, this.buildObstacleMesh(o))
    for (const k of this.game.medkits) this.medkitMeshes.set(k, this.buildMedkitMesh())
  }

  disposeObject(obj: THREE.Object3D) {
    obj.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const mat = mesh.material
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
        else mat.dispose()
      }
    })
  }

  syncBullets() {
    for (const [b, mesh] of [...this.bulletMeshes]) {
      if (!this.game.bullets.includes(b)) {
        this.scene.remove(mesh)
        this.disposeObject(mesh)
        const halo = this.bulletHalos.get(b)
        if (halo) {
          this.scene.remove(halo)
          this.disposeObject(halo)
        }
        this.bulletMeshes.delete(b)
        this.bulletHalos.delete(b)
      }
    }
    for (const b of this.game.bullets) {
      if (!this.bulletMeshes.has(b)) {
        const { mesh, halo } = this.buildBulletMeshes()
        this.bulletMeshes.set(b, mesh)
        this.bulletHalos.set(b, halo)
      }
    }
  }

  syncTanks() {
    for (const [t, g] of [...this.tankGroups]) {
      if (t !== this.game.player && !this.game.enemies.includes(t as Enemy)) {
        this.scene.remove(g)
        this.disposeObject(g)
        this.tankGroups.delete(t)
      }
    }
    for (const e of this.game.enemies) {
      if (!this.tankGroups.has(e)) {
        this.tankGroups.set(e, this.buildTankMesh(e))
      }
    }
  }

  syncObstacles() {
    for (const [o, m] of [...this.obstacleMeshes]) {
      if (!this.game.obstacles.includes(o)) {
        this.scene.remove(m)
        this.disposeObject(m)
        this.obstacleMeshes.delete(o)
      }
    }
  }

  syncMedkits() {
    for (const [k, g] of [...this.medkitMeshes]) {
      if (k.taken) {
        this.scene.remove(g)
        this.disposeObject(g)
        this.medkitMeshes.delete(k)
      }
    }
    for (const k of this.game.medkits) {
      if (!k.taken && !this.medkitMeshes.has(k)) {
        this.medkitMeshes.set(k, this.buildMedkitMesh())
      }
    }
  }

  updateCamera() {
    const p = this.game.player
    const fx = Math.cos(p.angle)
    const fz = Math.sin(p.angle)
    this.camera.position.set(p.x - fx * 190, 170, p.y - fz * 190)
    this.camera.lookAt(p.x + fx * 60, 12, p.y + fz * 60)
  }

  project(wx: number, wy: number, wz: number): { x: number; y: number; z: number } {
    this.tmpVec.set(wx, wy, wz).project(this.camera)
    return {
      x: (this.tmpVec.x * 0.5 + 0.5) * this.clientW,
      y: (-this.tmpVec.y * 0.5 + 0.5) * this.clientH,
      z: this.tmpVec.z,
    }
  }

  resize() {
    const canvas = this.renderer.domElement
    const parent = canvas.parentElement
    if (!parent) return
    const w = parent.clientWidth
    const h = parent.clientHeight
    const dpr = window.devicePixelRatio || 1
    this.renderer.setPixelRatio(dpr)
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.overlay.width = Math.round(w * dpr)
    this.overlay.height = Math.round(h * dpr)
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.clientW = w
    this.clientH = h
  }

  render() {
    this.syncBullets()
    this.syncTanks()
    this.syncObstacles()
    this.syncMedkits()

    const time = performance.now() / 1000
    const dt = this.lastRenderTime ? Math.min(0.05, time - this.lastRenderTime) : 1 / 60
    this.lastRenderTime = time

    for (const ev of this.game.deathEvents) {
      this.explosions.push(new Explosion(this.scene, ev.x, terrainHeight(ev.x, ev.y) + 3, ev.y))
    }
    this.game.deathEvents.length = 0

    for (const ex of this.explosions) {
      ex.update(dt)
    }
    this.explosions = this.explosions.filter((ex) => {
      if (ex.finished) {
        ex.dispose(this.scene)
        return false
      }
      return true
    })

    for (const [t, g] of this.tankGroups) {
      g.position.set(t.x, terrainHeight(t.x, t.y) + 3, t.y)
      g.rotation.y = -t.angle
      if (t.isPlayer && t.invuln > 0) {
        g.visible = Math.floor(t.invuln * 20) % 2 === 1
      } else {
        g.visible = true
      }
    }

    for (const [o, m] of this.obstacleMeshes) {
      const mat = m.material as THREE.MeshStandardMaterial
      mat.color.setHex(this.obstacleColor(o.hp))
    }

    for (const [b, mesh] of this.bulletMeshes) {
      mesh.position.set(b.x, CONFIG.BULLET_Y, b.y)
      const halo = this.bulletHalos.get(b)
      if (halo) halo.position.set(b.x, CONFIG.BULLET_Y, b.y)
    }

    for (const [k, g] of this.medkitMeshes) {
      g.position.set(k.x, terrainHeight(k.x, k.y) + 14 + Math.sin(time * 2 + k.x * 0.01) * 2, k.y)
      g.rotation.y = time
    }

    this.updateCamera()

    const p = this.game.player
    this.sun.position.set(p.x + 500, 900, p.y + 300)
    this.sun.target.position.set(p.x, 0, p.y)
    this.renderer.render(this.scene, this.camera)
    this.drawHud()
  }

  drawHud() {
    const ctx = this.octx
    const w = this.clientW
    const h = this.clientH
    ctx.clearRect(0, 0, w, h)

    ctx.font = '14px sans-serif'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = '#ffffff'
    ctx.fillText('❤️'.repeat(Math.max(0, this.game.player.hp)), 12, 10)

    ctx.font = '13px sans-serif'
    ctx.fillStyle = 'rgba(255,255,255,0.55)'
    ctx.textAlign = 'right'
    ctx.fillText('WASD / стрелки — движение, SPACE — огонь, R — рестарт', w - 16, 14)

    for (const e of this.game.enemies) {
      const s = this.project(e.x, terrainHeight(e.x, e.y) + 42, e.y)
      if (s.z > 1 || s.z < -1) continue
      const seg = 11
      const gap = 3
      const total = CONFIG.ENEMY_HP * seg + (CONFIG.ENEMY_HP - 1) * gap
      const x0 = s.x - total / 2
      const y0 = s.y - 10
      for (let i = 0; i < CONFIG.ENEMY_HP; i++) {
        ctx.fillStyle = i < e.hp ? '#F44336' : 'rgba(255,255,255,0.15)'
        ctx.fillRect(x0 + i * (seg + gap), y0, seg, 7)
      }
    }

    const mapSize = 180
    const mapX = 16
    const mapY = h - mapSize - 16
    const scale = mapSize / CONFIG.WORLD
    ctx.save()
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(mapX, mapY, mapSize, mapSize)
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = 1
    ctx.strokeRect(mapX, mapY, mapSize, mapSize)

    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    for (const o of this.game.obstacles) {
      ctx.fillRect(mapX + o.left * scale, mapY + o.top * scale, o.w * scale, o.h * scale)
    }

    ctx.fillStyle = '#F44336'
    for (const e of this.game.enemies) {
      ctx.fillRect(mapX + e.x * scale - 2.5, mapY + e.y * scale - 2.5, 5, 5)
    }

    ctx.fillStyle = '#81C784'
    for (const k of this.game.medkits) {
      if (k.taken) continue
      ctx.fillRect(mapX + k.x * scale - 2, mapY + k.y * scale - 2, 4, 4)
    }

    ctx.save()
    ctx.translate(mapX + this.game.player.x * scale, mapY + this.game.player.y * scale)
    ctx.rotate(this.game.player.angle)
    ctx.fillStyle = '#4CAF50'
    ctx.fillRect(-3.5, -2.5, 7, 5)
    ctx.fillStyle = '#d8ffd8'
    ctx.fillRect(0, -1, 6, 2)
    ctx.restore()

    ctx.restore()

    if (this.game.status !== 'playing') {
      ctx.fillStyle = 'rgba(0,0,0,0.6)'
      ctx.fillRect(0, 0, w, h)
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      const win = this.game.status === 'victory'
      ctx.font = 'bold 76px sans-serif'
      ctx.fillStyle = win ? '#4CAF50' : '#F44336'
      ctx.fillText(win ? 'VICTORY!' : 'GAME OVER', w / 2, h / 2 - 24)
      ctx.font = '24px sans-serif'
      ctx.fillStyle = '#ffffff'
      ctx.fillText('Нажми R для рестарта', w / 2, h / 2 + 42)
    }
  }

  dispose() {
    this.rebuild()
    this.renderer.dispose()
  }
}

export default function Page() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const overlay = overlayRef.current
    if (!canvas || !overlay) return
    const octx = overlay.getContext('2d')
    if (!octx) return

    const game = new Game()
    const renderer = new Renderer3D(canvas, overlay, octx, game)
    renderer.resize()

    const onResize = () => renderer.resize()
    window.addEventListener('resize', onResize)

    const keydown = (e: KeyboardEvent) => {
      const k = e.code
      if (k === 'Space') {
        e.preventDefault()
        if (!e.repeat) game.tryShoot()
      } else if (k === 'KeyR') {
        if (game.status !== 'playing') {
          game.reset()
          renderer.rebuild()
        }
      } else if (
        k === 'KeyW' ||
        k === 'KeyS' ||
        k === 'KeyA' ||
        k === 'KeyD' ||
        k === 'ArrowUp' ||
        k === 'ArrowDown' ||
        k === 'ArrowLeft' ||
        k === 'ArrowRight'
      ) {
        e.preventDefault()
        game.keys.add(k)
      }
    }

    const keyup = (e: KeyboardEvent) => {
      game.keys.delete(e.code)
    }

    window.addEventListener('keydown', keydown)
    window.addEventListener('keyup', keyup)

    let raf = 0
    let last = performance.now()
    let acc = 0

    const loop = (now: number) => {
      let dt = (now - last) / 1000
      last = now
      if (dt > 0.1) dt = 0.1
      acc += dt
      while (acc >= CONFIG.STEP) {
        game.update()
        acc -= CONFIG.STEP
      }
      renderer.render()
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('keydown', keydown)
      window.removeEventListener('keyup', keyup)
      renderer.dispose()
    }
  }, [])

  return (
    <main
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        background: '#0d1117',
        overflow: 'hidden',
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          display: 'block',
          userSelect: 'none',
          touchAction: 'none',
        }}
      />
      <canvas
        ref={overlayRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          userSelect: 'none',
          touchAction: 'none',
        }}
      />
    </main>
  )
}

import type { Box, Level, Rail } from '../core/Level.ts';
import { v3 } from '../core/Vec.ts';
import type { Vec3 } from '../core/Vec.ts';
import { SURFACES } from '../hazards/TileHazardGrid.ts';
import type { TileHazardGrid } from '../hazards/TileHazardGrid.ts';
import { GrappleWire } from './GrappleWire.ts';
import { findWall, raycast } from './WallRunDetector.ts';

export const HALF_WIDTH = 0.3;
export const STAND_HEIGHT = 1.8;
export const SLIDE_HEIGHT = 0.9;

const GRAVITY = 22;
const MAX_FALL = 40;
const RUN_SPEED = 9.5;
const OVERSPEED_FRICTION = 0.22;
const AIR_ACCEL = 16;
const JUMP_SPEED = 8;
export const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;
const MANTLE_HEIGHT = 1.1;

const SLIDE_MIN_SPEED = 4;
const SLIDE_END_SPEED = 2.5;
const SLIDE_FRICTION = 0.9;
const SLIDE_COOLDOWN = 0.5;

const WALL_MIN_SPEED = 11;
const WALL_ENTRY_RISE = 2.5;
const WALL_RISE_DECAY = 7;
const WALL_STICK = 1.05;
const WALL_KICK_OUT = 8;
const WALL_KICK_UP = 8;
const WALL_LOCK = 0.35;

const RAIL_REACH = 1.05;
const RAIL_MIN_SPEED = 12;
const RAIL_COOLDOWN = 0.4;

const DASH_TIME = 0.14;
const DASH_SPEED = 30;
const DASH_EXIT_SPEED = 14;
const DASH_COOLDOWN = 0.5;
/** Ten frames at 60 fps. */
export const DASH_IFRAMES = 10 / 60;

export type NinjaState = 'move' | 'slide' | 'wallrun' | 'grind' | 'dash';

export interface NinjaIntent {
  /** Strafe right and walk forward, each from -1 to 1. */
  moveX: number;
  moveZ: number;
  yaw: number;
  pitch: number;
  jumpPressed: boolean;
  slide: boolean;
  dashPressed: boolean;
  wireHeld: boolean;
  /** The anchor under the crosshair, chosen by the game. */
  wireTarget: Vec3 | null;
}

export const IDLE_INTENT: NinjaIntent = {
  moveX: 0, moveZ: 0, yaw: 0, pitch: 0, jumpPressed: false, slide: false, dashPressed: false, wireHeld: false, wireTarget: null,
};

export interface NinjaEvents {
  jumped: boolean;
  wallKick: boolean;
  landed: number;
  slideStart: boolean;
  wallStart: boolean;
  wallSlip: boolean;
  railStart: boolean;
  dashed: boolean;
  wireAttached: boolean;
}

/** Kinematic movement against axis-aligned level geometry. `pos` is the centre of the feet. */
export class NinjaController {
  pos = v3();
  vel = v3();
  yaw = 0;
  pitch = 0;
  state: NinjaState = 'move';
  grounded = false;
  height = STAND_HEIGHT;
  groundBox: Box | null = null;
  airDashes = 1;
  iframes = 0;
  /** Which side the wall is on, for camera lean. */
  wallSide = 0;
  readonly wire = new GrappleWire();
  readonly events: NinjaEvents = {
    jumped: false, wallKick: false, landed: 0, slideStart: false, wallStart: false, wallSlip: false, railStart: false, dashed: false, wireAttached: false,
  };

  private coyote = 0;
  private wallCoyote = 0;
  private jumpBuffer = 0;
  private slideCooldown = 0;
  private dashTime = 0;
  private dashCooldown = 0;
  private railCooldown = 0;
  private wallBox: Box | null = null;
  private lockedWall: Box | null = null;
  private lockTime = 0;
  private wallNormal = v3();
  private wallTangent = v3();
  private wallHeld = 0;
  private wallSpeed = 0;
  private rail: Rail | null = null;
  private railIndex = 0;
  private railDir = 1;
  private railSpeed = 0;
  private wireWasHeld = false;

  reset(spawn: Vec3, yaw: number): void {
    this.pos = v3(spawn.x, spawn.y, spawn.z);
    this.vel = v3();
    this.yaw = yaw;
    this.pitch = 0;
    this.state = 'move';
    this.grounded = false;
    this.height = STAND_HEIGHT;
    this.groundBox = null;
    this.airDashes = 1;
    this.iframes = 0;
    this.wallSide = 0;
    this.wire.release();
    this.coyote = this.wallCoyote = this.jumpBuffer = 0;
    this.slideCooldown = this.dashTime = this.dashCooldown = this.railCooldown = this.lockTime = 0;
    this.rail = this.wallBox = this.lockedWall = null;
    this.wireWasHeld = false;
  }

  get center(): Vec3 {
    return v3(this.pos.x, this.pos.y + this.height / 2, this.pos.z);
  }

  get eye(): Vec3 {
    return v3(this.pos.x, this.pos.y + this.height - 0.15, this.pos.z);
  }

  get airborne(): boolean {
    return !this.grounded && this.state !== 'grind' && this.state !== 'wallrun';
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  get boxMin(): Vec3 {
    return v3(this.pos.x - HALF_WIDTH, this.pos.y, this.pos.z - HALF_WIDTH);
  }

  get boxMax(): Vec3 {
    return v3(this.pos.x + HALF_WIDTH, this.pos.y + this.height, this.pos.z + HALF_WIDTH);
  }

  refillAirDash(): void {
    this.airDashes = 1;
    this.dashCooldown = Math.min(this.dashCooldown, 0.1);
  }

  bounce(power: number): void {
    this.vel.y = power;
    this.grounded = false;
    this.state = 'move';
    this.height = STAND_HEIGHT;
    this.airDashes = 1;
  }

  step(dt: number, intent: NinjaIntent, level: Level, grid: TileHazardGrid): NinjaEvents {
    const ev = this.events;
    ev.jumped = ev.wallKick = ev.slideStart = ev.wallStart = ev.wallSlip = ev.railStart = ev.dashed = ev.wireAttached = false;
    ev.landed = 0;

    this.yaw = intent.yaw;
    this.pitch = intent.pitch;
    this.iframes = Math.max(0, this.iframes - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.railCooldown = Math.max(0, this.railCooldown - dt);
    this.lockTime = Math.max(0, this.lockTime - dt);
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    this.wallCoyote = this.state === 'wallrun' ? COYOTE_TIME : Math.max(0, this.wallCoyote - dt);
    this.jumpBuffer = intent.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);

    if (this.grounded && this.groundBox && this.groundBox.motion) {
      this.pos.x += this.groundBox.dx;
      this.pos.y += this.groundBox.dy;
      this.pos.z += this.groundBox.dz;
    }
    this.depenetrate(level);
    this.updateWire(intent);
    this.tryDash(intent);

    switch (this.state) {
      case 'dash':
        this.stepDash(dt, level);
        break;
      case 'grind':
        this.stepGrind(dt);
        break;
      case 'wallrun':
        this.stepWallRun(dt, intent, level, grid);
        break;
      default:
        this.stepMove(dt, intent, level, grid);
        break;
    }
    return ev;
  }

  private wish(intent: NinjaIntent): { x: number; z: number; len: number } {
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    let x = -s * intent.moveZ + c * intent.moveX;
    let z = -c * intent.moveZ - s * intent.moveX;
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    return { x, z, len: Math.min(1, len) };
  }

  private updateWire(intent: NinjaIntent): void {
    if (intent.wireHeld && !this.wireWasHeld && intent.wireTarget && !this.wire.attached) {
      this.wire.attach(intent.wireTarget, this.center);
      this.events.wireAttached = true;
      if (this.state === 'wallrun' || this.state === 'grind' || this.state === 'slide') this.leaveToAir();
    }
    if (!intent.wireHeld && this.wire.attached) this.wire.release();
    this.wireWasHeld = intent.wireHeld;
  }

  private leaveToAir(): void {
    this.state = 'move';
    this.rail = null;
    this.wallBox = null;
    this.wallSide = 0;
  }

  private tryDash(intent: NinjaIntent): void {
    if (!intent.dashPressed || this.dashCooldown > 0 || this.state === 'dash') return;
    if (!this.grounded && this.airDashes <= 0) return;
    if (!this.grounded) this.airDashes--;
    this.wire.release();
    this.leaveToAir();
    this.height = STAND_HEIGHT;
    const wish = this.wish(intent);
    const useLook = wish.len < 0.01 || intent.moveZ > 0;
    const dx = useLook ? -Math.sin(this.yaw) : wish.x;
    const dz = useLook ? -Math.cos(this.yaw) : wish.z;
    const l = Math.hypot(dx, dz) || 1;
    this.vel.x = (dx / l) * DASH_SPEED;
    this.vel.z = (dz / l) * DASH_SPEED;
    this.vel.y = 0;
    this.state = 'dash';
    this.dashTime = DASH_TIME;
    this.dashCooldown = DASH_COOLDOWN + DASH_TIME;
    this.iframes = Math.max(this.iframes, DASH_IFRAMES);
    this.events.dashed = true;
  }

  private stepDash(dt: number, level: Level): void {
    this.dashTime -= dt;
    this.moveAndCollide(dt, level, true);
    if (this.dashTime <= 0) {
      const k = DASH_EXIT_SPEED / DASH_SPEED;
      this.vel.x *= k;
      this.vel.z *= k;
      this.state = 'move';
    }
  }

  private jumpOff(): void {
    this.vel.y = JUMP_SPEED;
    this.grounded = false;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.events.jumped = true;
  }

  private stepMove(dt: number, intent: NinjaIntent, level: Level, grid: TileHazardGrid): void {
    const wish = this.wish(intent);
    const wasGrounded = this.grounded;
    const props = SURFACES[this.groundBox && wasGrounded ? grid.surfaceAt(this.groundBox, this.pos, 1) : 'dry'];

    if (this.jumpBuffer > 0) {
      if (this.coyote > 0 || wasGrounded) {
        this.jumpOff();
        if (this.state === 'slide') this.endSlide(level);
      } else if (this.wallCoyote > 0) {
        this.wallKick();
      }
    }

    if (this.state === 'slide') {
      if (this.grounded) this.stepSlideFriction(dt, intent, wish, props, level);
      else this.endSlide(level);
    } else if (this.grounded) {
      if (intent.slide && this.speed >= SLIDE_MIN_SPEED && this.slideCooldown <= 0) this.startSlide(props);
      else this.groundAccel(dt, wish, props);
    } else {
      this.airAccel(dt, wish);
    }

    if (this.wire.attached) {
      this.wire.apply(this.center, this.vel, dt);
      if (this.vel.y > 0.5) this.grounded = false;
    }
    this.vel.y = Math.max(-MAX_FALL, this.vel.y - GRAVITY * dt);

    this.moveAndCollide(dt, level, intent.moveZ > 0);

    if (!this.grounded && this.state === 'move') {
      if (this.tryRail(level)) return;
      if (intent.moveZ > 0 && !this.wire.attached) this.tryWallRun(level, grid);
    }
  }

  private groundAccel(dt: number, wish: { x: number; z: number; len: number }, props: { accel: number; friction: number }): void {
    const speed = this.speed;
    if (speed > 0.001) {
      const friction = speed > RUN_SPEED ? props.friction * OVERSPEED_FRICTION : props.friction;
      const keep = wish.len > 0.01 && speed <= RUN_SPEED ? 1 : Math.exp(-friction * dt);
      this.vel.x *= keep;
      this.vel.z *= keep;
    }
    if (wish.len > 0.01) {
      const ux = wish.x / wish.len;
      const uz = wish.z / wish.len;
      // Steering scrubs off velocity that isn't going where you want, faster on grippier tile.
      const along = this.vel.x * ux + this.vel.z * uz;
      const scrub = 1 - Math.exp(-props.friction * dt);
      this.vel.x -= (this.vel.x - ux * along) * scrub;
      this.vel.z -= (this.vel.z - uz * along) * scrub;
      const add = Math.min(props.accel * dt, RUN_SPEED * wish.len - (this.vel.x * ux + this.vel.z * uz));
      if (add > 0) {
        this.vel.x += ux * add;
        this.vel.z += uz * add;
      }
    }
  }

  private airAccel(dt: number, wish: { x: number; z: number; len: number }): void {
    if (wish.len < 0.01) return;
    const ux = wish.x / wish.len;
    const uz = wish.z / wish.len;
    const add = Math.min(AIR_ACCEL * dt, RUN_SPEED - (this.vel.x * ux + this.vel.z * uz));
    if (add > 0) {
      this.vel.x += ux * add;
      this.vel.z += uz * add;
    }
  }

  private startSlide(props: { slideBoost: number }): void {
    const speed = this.speed || 1;
    const boosted = speed + props.slideBoost;
    this.vel.x *= boosted / speed;
    this.vel.z *= boosted / speed;
    this.state = 'slide';
    this.height = SLIDE_HEIGHT;
    this.events.slideStart = true;
  }

  private stepSlideFriction(dt: number, intent: NinjaIntent, wish: { x: number; z: number; len: number }, props: { slideSteer: number }, level: Level): void {
    const keep = Math.exp(-SLIDE_FRICTION * dt);
    this.vel.x *= keep;
    this.vel.z *= keep;
    if (wish.len > 0.01) {
      const speed = this.speed;
      const current = Math.atan2(this.vel.x, this.vel.z);
      const target = Math.atan2(wish.x, wish.z);
      const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
      const turn = Math.sign(delta) * Math.min(Math.abs(delta), props.slideSteer * dt);
      this.vel.x = Math.sin(current + turn) * speed;
      this.vel.z = Math.cos(current + turn) * speed;
    }
    if (!intent.slide || this.speed < SLIDE_END_SPEED) this.endSlide(level);
  }

  /** Stands back up, unless there is a ceiling in the way. */
  private endSlide(level: Level): void {
    if (this.grounded && this.blockedAbove(level)) return;
    this.state = 'move';
    this.height = STAND_HEIGHT;
    this.slideCooldown = SLIDE_COOLDOWN;
  }

  private blockedAbove(level: Level): boolean {
    const top = this.pos.y + STAND_HEIGHT;
    for (const b of level.boxes) {
      if (
        this.pos.x + HALF_WIDTH > b.min.x && this.pos.x - HALF_WIDTH < b.max.x &&
        this.pos.z + HALF_WIDTH > b.min.z && this.pos.z - HALF_WIDTH < b.max.z &&
        top > b.min.y && this.pos.y + 0.05 < b.min.y
      ) return true;
    }
    return false;
  }

  private tryWallRun(level: Level, grid: TileHazardGrid): void {
    const wall = findWall(level, this.center, this.vel, this.lockTime > 0 ? this.lockedWall : null);
    if (!wall) return;
    const surface = grid.surfaceAt(wall.box, this.center, Math.abs(wall.normal.x) > 0.5 ? 0 : 2);
    if (SURFACES[surface].wallHold <= 0) return;
    this.state = 'wallrun';
    this.wallBox = wall.box;
    this.wallNormal = wall.normal;
    this.wallTangent = wall.tangent;
    this.wallHeld = 0;
    this.wallSpeed = Math.max(this.speed, WALL_MIN_SPEED);
    this.vel.y = Math.max(this.vel.y, WALL_ENTRY_RISE);
    this.airDashes = 1;
    this.events.wallStart = true;
    this.wallSide = this.wallTangent.x * this.wallNormal.z - this.wallTangent.z * this.wallNormal.x;
  }

  private stepWallRun(dt: number, intent: NinjaIntent, level: Level, grid: TileHazardGrid): void {
    if (this.jumpBuffer > 0) {
      this.wallKick();
      this.moveAndCollide(dt, level, false);
      return;
    }
    const box = this.wallBox!;
    this.wallHeld += dt;
    const center = this.center;
    const inward = v3(-this.wallNormal.x, 0, -this.wallNormal.z);
    const hit = raycast(level, center, inward, WALL_STICK);
    const axis = Math.abs(this.wallNormal.x) > 0.5 ? 0 : 2;
    const hold = SURFACES[grid.surfaceAt(box, center, axis)].wallHold;
    if (!hit || hit.box !== box || intent.moveZ <= 0) {
      this.leaveToAir();
      return;
    }
    if (this.wallHeld > hold) {
      // Wet tile lets go: you drop away from the wall and can't re-latch at once.
      this.lockedWall = box;
      this.lockTime = WALL_LOCK;
      this.events.wallSlip = true;
      this.vel.x += this.wallNormal.x * 1.5;
      this.vel.z += this.wallNormal.z * 1.5;
      this.leaveToAir();
      return;
    }
    this.vel.x = this.wallTangent.x * this.wallSpeed;
    this.vel.z = this.wallTangent.z * this.wallSpeed;
    this.vel.y = Math.max(0, this.vel.y - WALL_RISE_DECAY * dt);
    this.moveAndCollide(dt, level, false);
    if (this.grounded) this.leaveToAir();
  }

  private wallKick(): void {
    const box = this.wallBox;
    const normal = this.wallNormal;
    const speed = Math.max(this.speed, 7);
    const tx = this.wallTangent.x;
    const tz = this.wallTangent.z;
    this.vel.x = tx * speed * 0.8 + normal.x * WALL_KICK_OUT;
    this.vel.z = tz * speed * 0.8 + normal.z * WALL_KICK_OUT;
    this.vel.y = WALL_KICK_UP;
    this.jumpBuffer = 0;
    this.wallCoyote = 0;
    this.lockedWall = box;
    this.lockTime = WALL_LOCK;
    this.leaveToAir();
    this.events.wallKick = true;
    this.events.jumped = true;
  }

  private tryRail(level: Level): boolean {
    if (this.railCooldown > 0) return false;
    for (const rail of level.rails) {
      for (let i = 0; i + 1 < rail.points.length; i++) {
        const a = rail.points[i];
        const b = rail.points[i + 1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const abz = b.z - a.z;
        const l2 = abx * abx + aby * aby + abz * abz;
        const t = Math.max(0, Math.min(1, ((this.pos.x - a.x) * abx + (this.pos.y - a.y) * aby + (this.pos.z - a.z) * abz) / l2));
        const px = a.x + abx * t;
        const py = a.y + aby * t;
        const pz = a.z + abz * t;
        if (Math.hypot(this.pos.x - px, this.pos.y - py, this.pos.z - pz) > RAIL_REACH) continue;
        const l = Math.sqrt(l2);
        const along = (this.vel.x * abx + this.vel.y * aby + this.vel.z * abz) / l;
        this.rail = rail;
        this.railIndex = i;
        this.railDir = along >= 0 ? 1 : -1;
        this.railSpeed = Math.max(Math.abs(along), RAIL_MIN_SPEED);
        this.pos = v3(px, py, pz);
        this.state = 'grind';
        this.airDashes = 1;
        this.events.railStart = true;
        return true;
      }
    }
    return false;
  }

  private stepGrind(dt: number): void {
    const rail = this.rail!;
    if (this.jumpBuffer > 0) {
      this.railCooldown = RAIL_COOLDOWN;
      this.leaveToAir();
      this.jumpOff();
      return;
    }
    const target = rail.points[this.railDir > 0 ? this.railIndex + 1 : this.railIndex];
    const dx = target.x - this.pos.x;
    const dy = target.y - this.pos.y;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    const stepLen = this.railSpeed * dt;
    const ux = dx / d;
    const uy = dy / d;
    const uz = dz / d;
    this.vel = v3(ux * this.railSpeed, uy * this.railSpeed, uz * this.railSpeed);
    if (stepLen >= d) {
      this.pos = v3(target.x, target.y, target.z);
      const next = this.railIndex + this.railDir;
      if (next < 0 || next + 1 >= rail.points.length) {
        this.railCooldown = RAIL_COOLDOWN;
        this.leaveToAir();
      } else {
        this.railIndex = next;
      }
      return;
    }
    this.pos.x += ux * stepLen;
    this.pos.y += uy * stepLen;
    this.pos.z += uz * stepLen;
  }

  private overlap(b: Box): boolean {
    return (
      this.pos.x + HALF_WIDTH > b.min.x && this.pos.x - HALF_WIDTH < b.max.x &&
      this.pos.y + this.height > b.min.y && this.pos.y < b.max.y &&
      this.pos.z + HALF_WIDTH > b.min.z && this.pos.z - HALF_WIDTH < b.max.z
    );
  }

  /** Moving boxes can drift into the player. Pushes out along the shallowest axis. */
  private depenetrate(level: Level): void {
    for (const b of level.boxes) {
      if (!b.motion || !this.overlap(b)) continue;
      const px0 = this.pos.x + HALF_WIDTH - b.min.x;
      const px1 = b.max.x - (this.pos.x - HALF_WIDTH);
      const pz0 = this.pos.z + HALF_WIDTH - b.min.z;
      const pz1 = b.max.z - (this.pos.z - HALF_WIDTH);
      const py1 = b.max.y - this.pos.y;
      const least = Math.min(px0, px1, pz0, pz1, py1);
      if (least === py1) this.pos.y += py1;
      else if (least === px0) this.pos.x -= px0;
      else if (least === px1) this.pos.x += px1;
      else if (least === pz0) this.pos.z -= pz0;
      else this.pos.z += pz1;
    }
  }

  private moveAndCollide(dt: number, level: Level, canMantle: boolean): void {
    this.pos.x += this.vel.x * dt;
    this.resolveHorizontal('x', level, canMantle);
    this.pos.z += this.vel.z * dt;
    this.resolveHorizontal('z', level, canMantle);

    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    this.pos.y += this.vel.y * dt;
    this.grounded = false;
    for (const b of level.boxes) {
      if (!this.overlap(b)) continue;
      if (this.vel.y <= 0) {
        this.pos.y = b.max.y;
        this.grounded = true;
        this.groundBox = b;
        this.vel.y = 0;
      } else {
        this.pos.y = b.min.y - this.height;
        this.vel.y = 0;
      }
    }
    if (this.grounded && !wasGrounded) this.events.landed = fallSpeed;
  }

  private resolveHorizontal(axis: 'x' | 'z', level: Level, canMantle: boolean): void {
    for (const b of level.boxes) {
      if (!this.overlap(b)) continue;
      // Vault up small lips rather than stopping dead against them.
      if (canMantle && b.max.y - this.pos.y <= MANTLE_HEIGHT && b.max.y - this.pos.y > 0) {
        this.pos.y = b.max.y;
        this.vel.y = Math.max(this.vel.y, 0);
        continue;
      }
      this.pos[axis] = this.vel[axis] > 0 ? b.min[axis] - HALF_WIDTH - 0.001 : b.max[axis] + HALF_WIDTH + 0.001;
      this.vel[axis] = 0;
    }
  }
}

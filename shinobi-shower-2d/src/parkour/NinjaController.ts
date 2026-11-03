import type { Box, Level, Rail } from '../core/Level.ts';
import { v3 } from '../core/Vec.ts';
import type { Vec3 } from '../core/Vec.ts';
import { SURFACES } from '../hazards/TileHazardGrid.ts';
import type { TileHazardGrid } from '../hazards/TileHazardGrid.ts';
import { GrappleWire } from './GrappleWire.ts';
import { findWall } from './WallRunDetector.ts';

export const HALF_WIDTH = 0.3;
export const STAND_HEIGHT = 1.8;
export const SLIDE_HEIGHT = 0.9;

const GRAVITY = 26;
const MAX_FALL = 42;
const RUN_SPEED = 9.5;
const OVERSPEED_FRICTION = 0.22;
const AIR_ACCEL = 24;
const JUMP_SPEED = 11;
/** Letting go of jump early cuts the rise, so hop height is under your finger. */
const JUMP_CUT_GRAVITY = 2.4;
export const COYOTE_TIME = 0.12;
const JUMP_BUFFER = 0.12;
const MANTLE_HEIGHT = 1.1;

const SLIDE_MIN_SPEED = 4;
const SLIDE_END_SPEED = 2.5;
const SLIDE_FRICTION = 0.9;
const SLIDE_COOLDOWN = 0.4;

const WALL_RUN_SPEED = 8;
const WALL_KICK_OUT = 9;
const WALL_KICK_UP = 10.5;
const WALL_LOCK = 0.3;

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
  /** -1 left to 1 right. */
  moveX: number;
  /** Unit vector from the ninja toward the reticle. */
  aimX: number;
  aimY: number;
  jumpPressed: boolean;
  jumpHeld: boolean;
  slide: boolean;
  dashPressed: boolean;
  wireHeld: boolean;
  /** The anchor nearest the reticle, chosen by the game. */
  wireTarget: Vec3 | null;
}

export const IDLE_INTENT: NinjaIntent = {
  moveX: 0, aimX: 1, aimY: 0, jumpPressed: false, jumpHeld: false, slide: false, dashPressed: false, wireHeld: false, wireTarget: null,
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

/** Side-on kinematic movement against rectangles. `pos` is the centre of the feet. */
export class NinjaController {
  pos = v3();
  vel = v3();
  facing = 1;
  state: NinjaState = 'move';
  grounded = false;
  height = STAND_HEIGHT;
  groundBox: Box | null = null;
  airDashes = 1;
  iframes = 0;
  /** While wall-running: the side the wall is on. */
  wallSide = 0;
  readonly wire = new GrappleWire();
  readonly events: NinjaEvents = {
    jumped: false, wallKick: false, landed: 0, slideStart: false, wallStart: false, wallSlip: false, railStart: false, dashed: false, wireAttached: false,
  };

  private coyote = 0;
  private wallCoyote = 0;
  private lastWallSide = 0;
  private jumpBuffer = 0;
  private slideCooldown = 0;
  private dashTime = 0;
  private dashCooldown = 0;
  private railCooldown = 0;
  private wallBox: Box | null = null;
  private lockedWall: Box | null = null;
  private lockTime = 0;
  private wallHeld = 0;
  private rail: Rail | null = null;
  private railIndex = 0;
  private railDir = 1;
  private railSpeed = 0;
  private wireWasHeld = false;

  reset(spawn: Vec3, facing: number): void {
    this.pos = v3(spawn.x, spawn.y, 0);
    this.vel = v3();
    this.facing = facing;
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
    return v3(this.pos.x, this.pos.y + this.height / 2, 0);
  }

  /** Where the blade cuts from: chest height. */
  get eye(): Vec3 {
    return v3(this.pos.x, this.pos.y + this.height * 0.62, 0);
  }

  get airborne(): boolean {
    return !this.grounded && this.state !== 'grind' && this.state !== 'wallrun';
  }

  get speed(): number {
    return Math.abs(this.vel.x);
  }

  get boxMin(): Vec3 {
    return v3(this.pos.x - HALF_WIDTH, this.pos.y, -HALF_WIDTH);
  }

  get boxMax(): Vec3 {
    return v3(this.pos.x + HALF_WIDTH, this.pos.y + this.height, HALF_WIDTH);
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

    this.iframes = Math.max(0, this.iframes - dt);
    this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.railCooldown = Math.max(0, this.railCooldown - dt);
    this.lockTime = Math.max(0, this.lockTime - dt);
    this.coyote = this.grounded ? COYOTE_TIME : Math.max(0, this.coyote - dt);
    this.wallCoyote = this.state === 'wallrun' ? COYOTE_TIME : Math.max(0, this.wallCoyote - dt);
    this.jumpBuffer = intent.jumpPressed ? JUMP_BUFFER : Math.max(0, this.jumpBuffer - dt);
    if (intent.moveX !== 0 && this.state !== 'dash') this.facing = Math.sign(intent.moveX);

    if (this.grounded && this.groundBox && this.groundBox.motion) {
      this.pos.x += this.groundBox.dx;
      this.pos.y += this.groundBox.dy;
    }
    if (this.state !== 'grind') this.depenetrate(level);
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

  private updateWire(intent: NinjaIntent): void {
    if (intent.wireHeld && !this.wireWasHeld && intent.wireTarget && !this.wire.attached) {
      this.wire.attach(intent.wireTarget, this.center);
      this.events.wireAttached = true;
      if (this.state !== 'move') this.leaveToAir();
    }
    if (!intent.wireHeld && this.wire.attached) this.wire.release();
    this.wireWasHeld = intent.wireHeld;
  }

  private leaveToAir(): void {
    this.state = 'move';
    this.rail = null;
    this.wallBox = null;
    this.wallSide = 0;
    this.height = STAND_HEIGHT;
  }

  private tryDash(intent: NinjaIntent): void {
    if (!intent.dashPressed || this.dashCooldown > 0 || this.state === 'dash') return;
    if (!this.grounded && this.airDashes <= 0) return;
    if (!this.grounded) this.airDashes--;
    this.wire.release();
    this.leaveToAir();
    const dir = intent.moveX !== 0 ? Math.sign(intent.moveX) : this.facing;
    this.facing = dir;
    this.vel.x = dir * DASH_SPEED;
    this.vel.y = 0;
    this.state = 'dash';
    this.dashTime = DASH_TIME;
    this.dashCooldown = DASH_COOLDOWN + DASH_TIME;
    this.iframes = Math.max(this.iframes, DASH_IFRAMES);
    this.events.dashed = true;
  }

  private stepDash(dt: number, level: Level): void {
    this.dashTime -= dt;
    this.moveAndCollide(dt, level, this.facing);
    if (this.dashTime <= 0) {
      this.vel.x *= DASH_EXIT_SPEED / DASH_SPEED;
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
    const wasGrounded = this.grounded;
    const props = SURFACES[this.groundBox && wasGrounded ? grid.surfaceAt(this.groundBox, this.pos, 1) : 'dry'];

    if (this.jumpBuffer > 0) {
      if (this.coyote > 0 || wasGrounded) {
        if (this.state === 'slide') this.endSlide(level);
        if (this.state !== 'slide') this.jumpOff();
      } else if (this.wallCoyote > 0) {
        this.wallKick();
      }
    }

    if (this.state === 'slide') {
      if (this.grounded) this.stepSlide(dt, intent, props, level);
      else this.endSlide(level);
    } else if (this.grounded) {
      if (intent.slide && this.speed >= SLIDE_MIN_SPEED && this.slideCooldown <= 0) this.startSlide(props);
      else this.groundAccel(dt, intent.moveX, props);
    } else {
      this.airAccel(dt, intent.moveX);
    }

    if (this.wire.attached) {
      this.wire.apply(this.center, this.vel, dt);
      if (this.vel.y > 0.5) this.grounded = false;
    }
    const rising = this.vel.y > 2 && !intent.jumpHeld && !this.wire.attached && this.events.jumped === false;
    this.vel.y = Math.max(-MAX_FALL, this.vel.y - GRAVITY * (rising && this.cutJump ? JUMP_CUT_GRAVITY : 1) * dt);
    if (this.events.jumped) this.cutJump = true;
    if (this.grounded || this.vel.y <= 0) this.cutJump = false;

    this.moveAndCollide(dt, level, intent.moveX);

    if (!this.grounded && this.state === 'move') {
      if (this.tryRail(level)) return;
      if (intent.moveX !== 0 && !this.wire.attached) this.tryWallRun(Math.sign(intent.moveX), level, grid);
    }
  }

  /** Only a real jump can be cut short, not a bounce or a wall kick. */
  private cutJump = false;

  private groundAccel(dt: number, moveX: number, props: { accel: number; friction: number }): void {
    const speed = this.speed;
    if (speed > RUN_SPEED || moveX === 0 || Math.sign(moveX) !== Math.sign(this.vel.x)) {
      const friction = speed > RUN_SPEED ? props.friction * OVERSPEED_FRICTION : props.friction;
      this.vel.x *= Math.exp(-friction * dt);
    }
    if (moveX !== 0) {
      const add = Math.min(props.accel * dt, RUN_SPEED - this.vel.x * Math.sign(moveX));
      if (add > 0) this.vel.x += Math.sign(moveX) * add;
    }
  }

  private airAccel(dt: number, moveX: number): void {
    if (moveX === 0) return;
    const add = Math.min(AIR_ACCEL * dt, RUN_SPEED - this.vel.x * Math.sign(moveX));
    if (add > 0) this.vel.x += Math.sign(moveX) * add;
  }

  private startSlide(props: { slideBoost: number }): void {
    this.vel.x += Math.sign(this.vel.x) * props.slideBoost;
    this.state = 'slide';
    this.height = SLIDE_HEIGHT;
    this.events.slideStart = true;
  }

  private stepSlide(dt: number, intent: NinjaIntent, props: { slideSteer: number }, level: Level): void {
    this.vel.x *= Math.exp(-SLIDE_FRICTION * dt);
    // Wet tile hydroplanes: pressing against the slide brakes it hard, for tight control.
    if (intent.moveX !== 0 && Math.sign(intent.moveX) !== Math.sign(this.vel.x)) this.vel.x *= Math.exp(-props.slideSteer * dt);
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
      if (this.pos.x + HALF_WIDTH > b.min.x && this.pos.x - HALF_WIDTH < b.max.x && top > b.min.y && this.pos.y + 0.05 < b.min.y) return true;
    }
    return false;
  }

  private tryWallRun(side: number, level: Level, grid: TileHazardGrid): void {
    const box = findWall(level, this.center, side, this.lockTime > 0 ? this.lockedWall : null);
    if (!box || SURFACES[grid.surfaceAt(box, this.center, 0)].wallHold <= 0) return;
    this.state = 'wallrun';
    this.wallBox = box;
    this.wallSide = side;
    this.lastWallSide = side;
    this.wallHeld = 0;
    this.airDashes = 1;
    this.events.wallStart = true;
  }

  private stepWallRun(dt: number, intent: NinjaIntent, level: Level, grid: TileHazardGrid): void {
    if (this.jumpBuffer > 0) {
      this.wallKick();
      this.moveAndCollide(dt, level, this.vel.x);
      return;
    }
    const box = this.wallBox!;
    this.wallHeld += dt;
    const side = this.wallSide;
    if (Math.sign(intent.moveX) !== side) {
      this.leaveToAir();
      return;
    }
    const wall = findWall(level, this.center, side, null);
    if (wall !== box) {
      // Past the top of the wall: keep rising so the ninja can vault onto it.
      this.leaveToAir();
      this.vel.y = Math.max(this.vel.y, WALL_RUN_SPEED * 0.8);
      return;
    }
    if (this.wallHeld > SURFACES[grid.surfaceAt(box, this.center, 0)].wallHold) {
      // Wet tile lets go: the ninja slips away from the wall and can't re-latch at once.
      this.lockedWall = box;
      this.lockTime = WALL_LOCK;
      this.events.wallSlip = true;
      this.vel.x = -side * 1.5;
      this.leaveToAir();
      return;
    }
    this.facing = side;
    this.vel.x = side * 2;
    this.vel.y = WALL_RUN_SPEED;
    this.moveAndCollide(dt, level, 0);
    if (this.grounded) this.leaveToAir();
  }

  private wallKick(): void {
    const side = this.lastWallSide;
    this.vel.x = -side * WALL_KICK_OUT;
    this.vel.y = WALL_KICK_UP;
    this.facing = -side;
    this.jumpBuffer = 0;
    this.wallCoyote = 0;
    this.lockedWall = this.wallBox;
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
        const l2 = abx * abx + aby * aby;
        const t = Math.max(0, Math.min(1, ((this.pos.x - a.x) * abx + (this.pos.y - a.y) * aby) / l2));
        const px = a.x + abx * t;
        const py = a.y + aby * t;
        if (Math.hypot(this.pos.x - px, this.pos.y - py) > RAIL_REACH) continue;
        // Rising through the middle of a rail doesn't grab it, so you can jump past one. Only its start catches you going up.
        if (this.vel.y > 1 && t > 0.1) continue;
        const l = Math.sqrt(l2);
        const along = (this.vel.x * abx + this.vel.y * aby) / l;
        this.rail = rail;
        this.railIndex = i;
        // Rails always carry you up the way they're built, which also rescues a missed jump.
        this.railDir = 1;
        this.railSpeed = Math.max(Math.abs(along), RAIL_MIN_SPEED);
        this.pos = v3(px, py, 0);
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
    const d = Math.hypot(dx, dy) || 1;
    const stepLen = this.railSpeed * dt;
    const ux = dx / d;
    const uy = dy / d;
    this.vel = v3(ux * this.railSpeed, uy * this.railSpeed, 0);
    this.facing = ux >= 0 ? 1 : -1;
    if (stepLen >= d) {
      this.pos = v3(target.x, target.y, 0);
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
  }

  private overlap(b: Box): boolean {
    return (
      this.pos.x + HALF_WIDTH > b.min.x && this.pos.x - HALF_WIDTH < b.max.x &&
      this.pos.y + this.height > b.min.y && this.pos.y < b.max.y
    );
  }

  /** Moving boxes can drift into the player. Pushes out along the shallowest axis. */
  private depenetrate(level: Level): void {
    for (const b of level.boxes) {
      if (!b.motion || !this.overlap(b)) continue;
      const left = this.pos.x + HALF_WIDTH - b.min.x;
      const right = b.max.x - (this.pos.x - HALF_WIDTH);
      const up = b.max.y - this.pos.y;
      const least = Math.min(left, right, up);
      if (least === up) this.pos.y += up;
      else if (least === left) this.pos.x -= left;
      else this.pos.x += right;
    }
  }

  private moveAndCollide(dt: number, level: Level, moveX: number): void {
    this.pos.x += this.vel.x * dt;
    for (const b of level.boxes) {
      if (!this.overlap(b)) continue;
      const lip = b.max.y - this.pos.y;
      // Vault small lips rather than stopping dead against them.
      if (moveX !== 0 && Math.sign(moveX) === Math.sign(this.vel.x || moveX) && lip > 0 && lip <= MANTLE_HEIGHT) {
        this.pos.y = b.max.y;
        this.vel.y = Math.max(this.vel.y, 0);
        continue;
      }
      this.pos.x = this.vel.x > 0 ? b.min.x - HALF_WIDTH - 0.001 : b.max.x + HALF_WIDTH + 0.001;
      this.vel.x = 0;
    }

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
}

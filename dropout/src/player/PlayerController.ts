import { STALL_HALF } from './FloorInteraction.ts';
import type { SurfaceProps } from './FloorInteraction.ts';

export const PLAYER_RADIUS = 0.34;
const STAND_HEIGHT = 0.72;
const SLIDE_HEIGHT = 0.3;
const WALL_LIMIT = STALL_HALF - PLAYER_RADIUS;
const WALL_RESTITUTION = 0.72;

const GRAVITY = 18;
const HOP_SPEED = 6;
/** Grace after leaving the floor during which hop and dash still count as grounded. */
export const COYOTE_TIME = 0.12;
/** A press this early still fires once the action becomes available. */
const INPUT_BUFFER = 0.12;

export const DASH_TIME = 0.16;
const DASH_SPEED = 15;
const DASH_EXIT_SPEED = 8.5;
export const DASH_COOLDOWN = 0.6;

const SLIDE_ACCEL = 0.55;
const SLIDE_DRAG = 0.45;
const SLIDE_GRIP = 0.55;
const SLIDE_MAX_SPEED = 1.35;
const SLIDE_KICK = 1.18;
const SLIDE_KICK_COOLDOWN = 0.6;
const AIR_ACCEL = 0.18;
const AIR_PULL = 0.3;
const OVERSPEED_BLEED = 4;
const FACING_TURN_RATE = 9;

const BUBBLE_MASH = 6;
const BUBBLE_DRAG = 0.9;
const BUBBLE_STEER = 1.5;
const BUBBLE_PULL = 1.6;

export interface PlayerIntent {
  /** Move direction in world space, length at most 1. */
  moveX: number;
  moveZ: number;
  slide: boolean;
  hopPressed: boolean;
  dashPressed: boolean;
  /** Button presses this step, used to burst out of a soap bubble. */
  mash: number;
}

export const NO_INTENT: PlayerIntent = {
  moveX: 0,
  moveZ: 0,
  slide: false,
  hopPressed: false,
  dashPressed: false,
  mash: 0,
};

export interface PlayerEvents {
  hopped: boolean;
  dashed: boolean;
  burst: boolean;
  /** Downward speed at touchdown, 0 if the player did not land this step. */
  landed: number;
  /** Speed into a wall, 0 if the player did not hit one this step. */
  wall: number;
}

/** Momentum physics for the player. It knows nothing about hazards or rendering. */
export class PlayerController {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  grounded = true;
  sliding = false;
  /** Direction the character is pointed, which lags velocity changes on slick tile. */
  facing = 0;
  /** Sideways speed relative to facing. Drives scoring, skid effects and audio. */
  drift = 0;
  dashTime = 0;
  dashCooldown = 0;
  /** Protection from hits that follow another hit. */
  iframes = 0;
  encased = false;
  mashLeft = 0;

  private airTime = 0;
  private hopUsed = false;
  private hopBuffer = 0;
  private dashBuffer = 0;
  private slideKickCooldown = 0;
  private readonly events: PlayerEvents = { hopped: false, dashed: false, burst: false, landed: 0, wall: 0 };

  reset(x: number, z: number): void {
    this.x = x;
    this.y = 0;
    this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.grounded = true;
    this.sliding = false;
    this.facing = Math.PI;
    this.drift = 0;
    this.dashTime = this.dashCooldown = this.iframes = 0;
    this.encased = false;
    this.mashLeft = 0;
    this.airTime = 0;
    this.hopUsed = false;
    this.hopBuffer = this.dashBuffer = this.slideKickCooldown = 0;
  }

  get dashing(): boolean {
    return this.dashTime > 0;
  }

  get height(): number {
    return this.sliding ? SLIDE_HEIGHT : STAND_HEIGHT;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Vertical cylinder against sphere, so sliding really does pass under low spray. */
  overlapsSphere(x: number, y: number, z: number, r: number): boolean {
    if (y + r < this.y || y - r > this.y + this.height) return false;
    const reach = PLAYER_RADIUS + r;
    const dx = x - this.x;
    const dz = z - this.z;
    return dx * dx + dz * dz < reach * reach;
  }

  applyImpulse(ix: number, iy: number, iz: number): void {
    this.vx += ix;
    this.vz += iz;
    if (iy > 0) {
      this.vy = Math.max(this.vy, iy);
      this.grounded = false;
    }
  }

  encase(): void {
    this.encased = true;
    this.mashLeft = BUBBLE_MASH;
    this.sliding = false;
    this.dashTime = 0;
  }

  /** Advances one fixed step. `pullX` and `pullZ` are external accelerations such as the drain. */
  step(dt: number, intent: PlayerIntent, floor: SurfaceProps, pullX: number, pullZ: number): PlayerEvents {
    const ev = this.events;
    ev.hopped = ev.dashed = ev.burst = false;
    ev.landed = ev.wall = 0;

    this.dashCooldown = Math.max(0, this.dashCooldown - dt);
    this.iframes = Math.max(0, this.iframes - dt);
    this.slideKickCooldown = Math.max(0, this.slideKickCooldown - dt);
    this.hopBuffer = intent.hopPressed ? INPUT_BUFFER : Math.max(0, this.hopBuffer - dt);
    this.dashBuffer = intent.dashPressed ? INPUT_BUFFER : Math.max(0, this.dashBuffer - dt);
    this.airTime = this.grounded ? 0 : this.airTime + dt;

    if (this.encased) {
      this.stepEncased(dt, intent, pullX, pullZ);
    } else {
      this.tryDash(intent);
      this.tryHop();
      if (this.dashing) this.stepDash(dt);
      else this.stepMove(dt, intent, floor, pullX, pullZ);
    }

    this.stepVertical(dt);
    this.collideWalls();
    this.updateFacing(dt, intent);
    return ev;
  }

  private canUseGroundAction(): boolean {
    return this.grounded || this.airTime <= COYOTE_TIME;
  }

  private tryDash(intent: PlayerIntent): void {
    if (this.dashBuffer <= 0 || this.dashCooldown > 0 || !this.canUseGroundAction()) return;
    let dx = intent.moveX;
    let dz = intent.moveZ;
    if (Math.hypot(dx, dz) < 0.01) {
      dx = this.vx;
      dz = this.vz;
    }
    if (Math.hypot(dx, dz) < 0.01) {
      dx = Math.sin(this.facing);
      dz = Math.cos(this.facing);
    }
    const len = Math.hypot(dx, dz);
    this.vx = (dx / len) * DASH_SPEED;
    this.vz = (dz / len) * DASH_SPEED;
    this.dashTime = DASH_TIME;
    this.dashCooldown = DASH_COOLDOWN;
    this.dashBuffer = 0;
    this.sliding = false;
    // A dash off a hop carries flat instead of falling.
    if (!this.grounded) this.vy = 0;
    this.events.dashed = true;
  }

  private tryHop(): void {
    if (this.hopBuffer <= 0 || this.hopUsed || this.dashing || !this.canUseGroundAction()) return;
    this.vy = HOP_SPEED;
    this.grounded = false;
    this.hopUsed = true;
    this.hopBuffer = 0;
    this.sliding = false;
    this.events.hopped = true;
  }

  private stepDash(dt: number): void {
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.dashTime -= dt;
    if (this.dashTime <= 0) {
      this.dashTime = 0;
      const k = DASH_EXIT_SPEED / DASH_SPEED;
      this.vx *= k;
      this.vz *= k;
    }
  }

  private stepMove(dt: number, intent: PlayerIntent, floor: SurfaceProps, pullX: number, pullZ: number): void {
    const wantsSlide = intent.slide && this.grounded;
    if (wantsSlide && !this.sliding && this.slideKickCooldown <= 0 && this.speed > 2) {
      this.vx *= SLIDE_KICK;
      this.vz *= SLIDE_KICK;
      this.slideKickCooldown = SLIDE_KICK_COOLDOWN;
    }
    this.sliding = wantsSlide;

    let { accel, drag, grip, maxSpeed } = floor;
    if (!this.grounded) {
      accel *= AIR_ACCEL;
      drag = 0;
      grip = 0;
    } else if (this.sliding) {
      accel *= SLIDE_ACCEL;
      drag *= SLIDE_DRAG;
      grip *= SLIDE_GRIP;
      maxSpeed *= SLIDE_MAX_SPEED;
    }

    this.vx += intent.moveX * accel * dt;
    this.vz += intent.moveZ * accel * dt;

    // Scrub velocity perpendicular to the steering direction. On low-grip tile
    // this happens slowly, so the character swings wide of where it is pointed.
    const wish = Math.hypot(intent.moveX, intent.moveZ);
    if (wish > 0.01 && grip > 0) {
      const ux = intent.moveX / wish;
      const uz = intent.moveZ / wish;
      const along = this.vx * ux + this.vz * uz;
      const k = 1 - Math.exp(-grip * wish * dt);
      this.vx -= (this.vx - ux * along) * k;
      this.vz -= (this.vz - uz * along) * k;
    }

    const keep = Math.exp(-drag * dt);
    this.vx *= keep;
    this.vz *= keep;

    if (this.grounded) {
      const speed = this.speed;
      if (speed > maxSpeed) {
        const next = maxSpeed + (speed - maxSpeed) * Math.exp(-OVERSPEED_BLEED * dt);
        this.vx *= next / speed;
        this.vz *= next / speed;
      }
    }

    const pull = this.grounded ? 1 : AIR_PULL;
    this.vx += pullX * pull * dt;
    this.vz += pullZ * pull * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  private stepEncased(dt: number, intent: PlayerIntent, pullX: number, pullZ: number): void {
    this.mashLeft -= intent.mash;
    if (this.mashLeft <= 0) {
      this.encased = false;
      this.iframes = 0.6;
      this.events.burst = true;
      this.applyImpulse(0, 3, 0);
    }
    const keep = Math.exp(-BUBBLE_DRAG * dt);
    this.vx = this.vx * keep + (intent.moveX * BUBBLE_STEER + pullX * BUBBLE_PULL) * dt;
    this.vz = this.vz * keep + (intent.moveZ * BUBBLE_STEER + pullZ * BUBBLE_PULL) * dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
  }

  private stepVertical(dt: number): void {
    if (this.grounded || this.dashing) return;
    this.vy -= GRAVITY * dt;
    this.y += this.vy * dt;
    if (this.y <= 0) {
      this.events.landed = -this.vy;
      this.y = 0;
      this.vy = 0;
      this.grounded = true;
      this.hopUsed = false;
    }
  }

  private collideWalls(): void {
    if (Math.abs(this.x) > WALL_LIMIT) {
      this.events.wall = Math.max(this.events.wall, Math.abs(this.vx));
      this.x = Math.sign(this.x) * WALL_LIMIT;
      this.vx *= -WALL_RESTITUTION;
    }
    if (Math.abs(this.z) > WALL_LIMIT) {
      this.events.wall = Math.max(this.events.wall, Math.abs(this.vz));
      this.z = Math.sign(this.z) * WALL_LIMIT;
      this.vz *= -WALL_RESTITUTION;
    }
  }

  private updateFacing(dt: number, intent: PlayerIntent): void {
    if (Math.hypot(intent.moveX, intent.moveZ) > 0.01 && !this.encased) {
      const target = Math.atan2(intent.moveX, intent.moveZ);
      const delta = Math.atan2(Math.sin(target - this.facing), Math.cos(target - this.facing));
      this.facing += delta * (1 - Math.exp(-FACING_TURN_RATE * dt));
    }
    this.drift = Math.abs(this.vx * Math.cos(this.facing) - this.vz * Math.sin(this.facing));
  }
}

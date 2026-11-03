import type { Stance } from '../progression/StanceModifiers.ts';
import { BRIDGE_LENGTH, LANE_MARGIN } from '../scene/SuspensionBridge.ts';
import type { SuspensionBridge } from '../scene/SuspensionBridge.ts';
import type { SnowAccumulator } from '../scene/SnowAccumulator.ts';

/**
 * Movement along the one lane. Running has momentum; the deck's pitch helps downhill and drags
 * uphill; snow underfoot slows the stride by up to half; a missing plank trips the warrior unless
 * they roll over it. The dash roll is untouchable while it lasts and costs stamina. The kick throws
 * snow off the deck in front.
 */

export const MAX_SPEED = 7.5;
export const ACCEL = 48;
export const DECEL = 40;
export const DASH_SPEED = 16;
export const DASH_TIME = 0.25;
export const DASH_COST = 30;
export const STAMINA_MAX = 100;
export const STAMINA_REGEN = 25;
export const HALF_WIDTH = 0.32;
export const STAND_HEIGHT = 1.75;
export const ROLL_HEIGHT = 0.85;
export const KICK_TIME = 0.22;
export const KICK_COOLDOWN = 0.5;
export const KICK_REACH = 1.3;
/** Deepest a single kick digs. */
export const KICK_DEPTH = 0.35;
export const STUMBLE_TIME = 0.32;
/** How strongly the deck's slope changes top speed: uphill at 0.2 slope costs about a quarter. */
const SLOPE_EFFECT = 1.3;

export interface WarriorInput {
  moveX: number;
  dash: boolean;
  kick: boolean;
}

export interface WarriorContext {
  stance: Stance;
  bridge: SuspensionBridge;
  snow: SnowAccumulator;
  /** Recovering from a missed slash: no dash, no kick. */
  exposed: boolean;
}

export interface StepResult {
  dashed: boolean;
  kicked: boolean;
  stumbled: boolean;
}

export class WarriorController {
  x = BRIDGE_LENGTH / 2;
  vx = 0;
  facing = 1;
  stamina = STAMINA_MAX;
  /** Seconds left in the current roll. */
  dashT = 0;
  dashDir = 1;
  /** Stunned by hail or a stumble: no input. */
  stun = 0;
  /** Seconds left in the current kick. */
  kickT = 0;
  kickCooldown = 0;
  /** Distance travelled, for the stride cycle. */
  stride = 0;
  /** Which plank the warrior stood on last step, so a stumble happens once per hole. */
  private lastPlank = -1;
  /** Speed limit in effect this step, for the HUD and tests. */
  topSpeed = MAX_SPEED;
  /** Snow slow factor at the warrior's feet this step (1 = none). */
  snowSlow = 1;

  get rolling(): boolean {
    return this.dashT > 0;
  }

  get kicking(): boolean {
    return this.kickT > 0;
  }

  get invulnerable(): boolean {
    return this.dashT > 0;
  }

  get height(): number {
    return this.rolling ? ROLL_HEIGHT : STAND_HEIGHT;
  }

  update(dt: number, input: WarriorInput, ctx: WarriorContext): StepResult {
    const out: StepResult = { dashed: false, kicked: false, stumbled: false };
    const { stance, bridge, snow } = ctx;
    this.stun = Math.max(0, this.stun - dt);
    this.kickT = Math.max(0, this.kickT - dt);
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    const free = this.stun <= 0 && !this.kicking;
    const want = free ? Math.sign(input.moveX) : 0;
    if (want !== 0 && !this.rolling) this.facing = want;

    if (input.dash && free && !this.rolling && !ctx.exposed && this.stamina >= DASH_COST) {
      this.stamina -= DASH_COST;
      this.dashT = DASH_TIME;
      this.dashDir = want || this.facing;
      this.facing = this.dashDir;
      out.dashed = true;
    }
    if (input.kick && free && !this.rolling && !ctx.exposed && this.kickCooldown <= 0) {
      this.kickT = KICK_TIME;
      this.kickCooldown = KICK_COOLDOWN;
      out.kicked = true;
    }

    // Speed limit: stance, snow underfoot, and the pitch of the deck in the direction of travel.
    this.snowSlow = this.rolling ? 1 : snow.slowAt(this.x);
    const dir = this.rolling ? this.dashDir : want || Math.sign(this.vx) || this.facing;
    const uphill = bridge.slope(this.x) * dir;
    const pitch = Math.max(0.72, Math.min(1.15, 1 - SLOPE_EFFECT * uphill));
    this.topSpeed = MAX_SPEED * stance.speedMul * this.snowSlow * pitch;

    if (this.rolling) {
      this.dashT = Math.max(0, this.dashT - dt);
      this.vx = this.dashDir * DASH_SPEED * stance.speedMul * Math.max(0.75, pitch);
      if (this.dashT === 0) this.vx = this.dashDir * Math.min(this.topSpeed, Math.abs(this.vx));
    } else if (want !== 0) {
      // Turning around bites harder than speeding up, so reversals feel crisp.
      const a = Math.sign(this.vx) === -want ? ACCEL + DECEL : ACCEL;
      this.vx += want * a * this.snowSlow * dt;
      if (Math.abs(this.vx) > this.topSpeed) {
        // Snow and slopes bleed speed off quickly rather than clamping it instantly.
        const over = Math.abs(this.vx) - this.topSpeed;
        this.vx -= Math.sign(this.vx) * Math.min(over, DECEL * 1.5 * dt);
      }
    } else {
      const slow = (this.kicking ? DECEL * 2 : this.stun > 0 ? DECEL * 0.5 : DECEL) * dt;
      this.vx = Math.abs(this.vx) <= slow ? 0 : this.vx - Math.sign(this.vx) * slow;
    }

    if (!this.rolling) this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);

    this.x += this.vx * dt;
    this.stride += Math.abs(this.vx) * dt;
    const min = LANE_MARGIN;
    const max = BRIDGE_LENGTH - LANE_MARGIN;
    if (this.x < min || this.x > max) {
      this.x = Math.max(min, Math.min(max, this.x));
      this.vx = 0;
    }

    // A missing plank underfoot trips the warrior, once per hole, unless they roll across it.
    const plank = bridge.plankIndex(this.x);
    if (plank !== this.lastPlank) {
      if (bridge.isOpen(this.x) && !this.rolling) {
        this.stun = Math.max(this.stun, STUMBLE_TIME);
        this.vx *= 0.25;
        out.stumbled = true;
      }
      this.lastPlank = plank;
    }
    return out;
  }

  /** The span the kick throws snow from. */
  kickSpan(): [number, number] {
    return this.facing > 0 ? [this.x, this.x + KICK_REACH] : [this.x - KICK_REACH, this.x];
  }
}

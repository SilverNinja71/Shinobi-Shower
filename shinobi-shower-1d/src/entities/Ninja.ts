import { WORLD_WIDTH } from '../engine/DropletPhysics.ts';
import type { Stance } from '../progression/StanceModifiers.ts';

export const MAX_SPEED = 10;
export const ACCEL = 85;
export const DECEL = 60;
export const DASH_SPEED = 26;
export const DASH_TIME = 0.22;
export const DASH_COST = 30;
export const STAMINA_MAX = 100;
export const STAMINA_REGEN = 28;
export const HALF_WIDTH = 0.35;
export const STAND_HEIGHT = 1.75;
export const ROLL_HEIGHT = 0.85;

/** Moves only along the lane: momentum on A/D, and a dash roll with invulnerable frames. */
export class Ninja {
  x = WORLD_WIDTH / 2;
  vx = 0;
  facing = 1;
  stamina = STAMINA_MAX;
  /** Seconds left in the current roll. */
  dashT = 0;
  dashDir = 1;
  stun = 0;
  /** Distance travelled, for the run cycle. */
  stride = 0;

  get rolling(): boolean {
    return this.dashT > 0;
  }

  get invulnerable(): boolean {
    return this.dashT > 0;
  }

  get height(): number {
    return this.rolling ? ROLL_HEIGHT : STAND_HEIGHT;
  }

  dashCost(stance: Stance): number {
    return DASH_COST * stance.dashCostMul;
  }

  /** Returns true when a roll starts this step. */
  update(dt: number, moveX: number, dashPressed: boolean, stance: Stance): boolean {
    let dashed = false;
    this.stun = Math.max(0, this.stun - dt);
    const input = this.stun > 0 ? 0 : Math.sign(moveX);
    if (input !== 0 && !this.rolling) this.facing = input;

    if (dashPressed && !this.rolling && this.stun <= 0 && this.stamina >= this.dashCost(stance)) {
      this.stamina -= this.dashCost(stance);
      this.dashT = DASH_TIME;
      this.dashDir = input || this.facing;
      this.facing = this.dashDir;
      dashed = true;
    }

    const top = MAX_SPEED * stance.speedMul;
    if (this.rolling) {
      this.dashT = Math.max(0, this.dashT - dt);
      this.vx = this.dashDir * DASH_SPEED * stance.speedMul;
      // Leave the roll at running speed rather than dash speed.
      if (this.dashT === 0) this.vx = this.dashDir * Math.min(top, Math.abs(this.vx));
    } else if (input !== 0) {
      // Turning around bites harder than speeding up, so reversals feel crisp.
      const a = Math.sign(this.vx) === -input ? ACCEL + DECEL : ACCEL;
      this.vx += input * a * dt;
      if (Math.abs(this.vx) > top) this.vx = Math.sign(this.vx) * top;
    } else {
      const slow = (this.stun > 0 ? DECEL * 0.5 : DECEL) * dt;
      this.vx = Math.abs(this.vx) <= slow ? 0 : this.vx - Math.sign(this.vx) * slow;
    }

    if (!this.rolling) this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);

    this.x += this.vx * dt;
    this.stride += Math.abs(this.vx) * dt;
    const min = HALF_WIDTH + 0.2;
    const max = WORLD_WIDTH - HALF_WIDTH - 0.2;
    if (this.x < min || this.x > max) {
      this.x = Math.max(min, Math.min(max, this.x));
      this.vx = 0;
    }
    return dashed;
  }
}

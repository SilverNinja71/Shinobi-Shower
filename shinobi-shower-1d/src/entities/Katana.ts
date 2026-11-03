import type { Stance } from '../progression/StanceModifiers.ts';

/** Startup before the edge is live, then the frames that cut. Recovery fills the rest of the cooldown. */
export const STARTUP = 0.04;
export const ACTIVE = 0.1;
export const BASE_REACH = 2.3;
export const ARC_LOW = 0.25;
export const ARC_HIGH = 3.4;
/** Hail only breaks at the arc's sweet spot: this far either side of it, and in this height band. */
export const SWEET_HALF_WIDTH = 0.42;
export const SWEET_LOW = 0.9;
export const SWEET_HIGH = 2.9;
/** A press this early is remembered and fires the moment the blade is ready. */
export const BUFFER = 0.12;

export interface Arc {
  side: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Centre of the sweet spot along x. */
  sweet: number;
}

/** A blade with a fixed rhythm: a slash cannot start until the previous one's cooldown is fully spent. */
export class Katana {
  /** Seconds since the current slash started; negative when idle. */
  t = -1;
  /** Seconds until the next slash may start. */
  cooldown = 0;
  /** Cooldown length of the slash in progress, for the HUD. */
  cooldownLength = 0.35;
  /** Increments on each slash so a drop is only met once per swing. */
  swing = 0;
  facing = 1;
  private buffered = 0;

  press(): void {
    this.buffered = BUFFER;
  }

  /** Returns true when a new slash starts this step. */
  update(dt: number, stance: Stance, facing: number, canSwing: boolean): boolean {
    if (this.t >= 0) {
      this.t += dt;
      if (this.t > STARTUP + ACTIVE) this.t = -1;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    // Float drift on a fixed step must not cost a whole step of waiting.
    if (this.cooldown < 1e-6) this.cooldown = 0;
    let started = false;
    if (this.buffered > 0 && this.cooldown === 0 && canSwing) {
      this.t = 0;
      this.cooldown = this.cooldownLength = stance.cooldown;
      this.facing = facing;
      this.swing++;
      this.buffered = 0;
      started = true;
    }
    this.buffered = Math.max(0, this.buffered - dt);
    return started;
  }

  get active(): boolean {
    return this.t >= STARTUP && this.t < STARTUP + ACTIVE;
  }

  /** 0 to 1 through the cutting frames, for the trail. */
  get sweep(): number {
    return this.t < 0 ? 0 : Math.max(0, Math.min(1, (this.t - STARTUP) / ACTIVE));
  }

  get ready(): boolean {
    return this.cooldown === 0;
  }

  /** The cutting regions for a ninja at x. Three blades cut both ways. */
  arcs(x: number, stance: Stance): Arc[] {
    const reach = BASE_REACH * stance.arcMul;
    const sides = stance.triple ? [this.facing, -this.facing] : [this.facing];
    return sides.map((side) => {
      const near = x - side * 0.3;
      const far = x + side * reach;
      return { side, x0: Math.min(near, far), x1: Math.max(near, far), y0: ARC_LOW, y1: ARC_HIGH, sweet: x + side * reach * 0.62 };
    });
  }
}

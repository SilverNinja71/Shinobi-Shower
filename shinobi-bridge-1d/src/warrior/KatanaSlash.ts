import type { Stance } from '../progression/StanceModifiers.ts';

/**
 * The blade's timing. A slash has a short startup, then cutting frames, then a wake: the air the
 * blade just passed through still cuts light water (rain, mist, small flakes) for a moment, which is
 * what lets a well-timed rhythm hold a rain curtain off. Hail only breaks during the cutting frames,
 * and only at the sweet spot. Nothing may start until the full cooldown has passed: 0.4 s, or 0.55 s
 * with a burning edge. A slash whose cutting frames meet nothing is a miss: the warrior is exposed
 * through the rest of its recovery, until the blade is ready again.
 */

export const STARTUP = 0.05;
export const ACTIVE = 0.12;
export const WAKE = 0.16;
/** A press this early is remembered and fires the moment the blade is ready. */
export const BUFFER = 0.12;
export const BASE_REACH = 2.4;
/** Arc height band above the warrior's feet. */
export const ARC_LOW = 0.2;
export const ARC_HIGH = 3.4;
/** Hail only breaks this close to the sweet spot, and in this height band. */
export const SWEET_HALF_WIDTH = 0.42;
export const SWEET_LOW = 0.9;
export const SWEET_HIGH = 2.9;
/** The wake only catches flakes and clumps smaller than this. */
export const WAKE_MAX_R = 0.3;

export type SlashPhase = 'idle' | 'startup' | 'active' | 'wake' | 'recovery';

export interface Arc {
  side: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Centre of the sweet spot along x. */
  sweet: number;
}

export class KatanaSlash {
  /** Seconds since the current slash began; negative when no slash is in flight. */
  t = -1;
  /** Seconds until the next slash may begin. */
  cooldown = 0;
  /** Cooldown length of the current slash, for the HUD. */
  cooldownLength = 0.4;
  /** Counts slashes so one swing meets a drop only once. */
  swing = 0;
  facing = 1;
  /** What this swing's cutting frames have cut or struck. The wake does not count. */
  hits = 0;
  /** Set when a finished swing cut nothing; cleared when the blade is ready. */
  whiffed = false;
  private buffered = 0;

  press(): void {
    this.buffered = BUFFER;
  }

  /** Advances timers. Returns 'start' when a slash begins and 'whiff' when its cutting frames end having met nothing. */
  update(dt: number, stance: Stance, facing: number, canSwing: boolean): 'start' | 'whiff' | null {
    let result: 'start' | 'whiff' | null = null;
    if (this.t >= 0) {
      const before = this.t;
      this.t += dt;
      if (before < STARTUP + ACTIVE && this.t >= STARTUP + ACTIVE && this.hits === 0) {
        this.whiffed = true;
        result = 'whiff';
      }
      if (this.t >= STARTUP + ACTIVE + WAKE) this.t = -1;
    }
    this.cooldown = Math.max(0, this.cooldown - dt);
    // Float drift on a fixed step must not cost a whole step of waiting.
    if (this.cooldown < 1e-6) this.cooldown = 0;
    if (this.cooldown === 0) this.whiffed = false;
    if (this.buffered > 0 && this.cooldown === 0 && canSwing) {
      this.t = 0;
      this.cooldown = this.cooldownLength = stance.cooldown;
      this.facing = facing;
      this.swing++;
      this.hits = 0;
      this.buffered = 0;
      result = 'start';
    }
    this.buffered = Math.max(0, this.buffered - dt);
    return result;
  }

  get phase(): SlashPhase {
    if (this.t < 0) return this.cooldown > 0 ? 'recovery' : 'idle';
    if (this.t < STARTUP) return 'startup';
    if (this.t < STARTUP + ACTIVE) return 'active';
    return 'wake';
  }

  get active(): boolean {
    return this.phase === 'active';
  }

  /** Active frames or wake: light water is cut. */
  get cutting(): boolean {
    const p = this.phase;
    return p === 'active' || p === 'wake';
  }

  /** 0 to 1 through the cutting frames, for drawing the swing. */
  get sweep(): number {
    return this.t < 0 ? 0 : Math.max(0, Math.min(1, (this.t - STARTUP) / ACTIVE));
  }

  get ready(): boolean {
    return this.cooldown === 0;
  }

  /** True while recovering from a swing that cut nothing. */
  get exposed(): boolean {
    return this.whiffed && this.cooldown > 0;
  }

  reach(stance: Stance): number {
    return BASE_REACH * stance.arcMul;
  }

  /** Cutting regions for a warrior standing at (x, feetY). Three blades cut both ways. */
  arcs(x: number, feetY: number, stance: Stance, facing = this.facing): Arc[] {
    const reach = this.reach(stance);
    const sides = stance.triple ? [facing, -facing] : [facing];
    return sides.map((side) => {
      const near = x - side * 0.3;
      const far = x + side * reach;
      return { side, x0: Math.min(near, far), x1: Math.max(near, far), y0: feetY + ARC_LOW, y1: feetY + ARC_HIGH, sweet: x + side * reach * 0.62 };
    });
  }

  reset(): void {
    this.t = -1;
    this.cooldown = 0;
    this.hits = 0;
    this.whiffed = false;
    this.buffered = 0;
  }
}

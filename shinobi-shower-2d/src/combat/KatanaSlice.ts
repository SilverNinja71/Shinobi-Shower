import { v3 } from '../core/Vec.ts';
import type { Vec3 } from '../core/Vec.ts';

const SWING_TIME = 0.16;
const RECOVER = 0.1;
export const RANGE = 3.8;
export const ARC = (100 * Math.PI) / 180;
const RAYS = 9;
const BLADE_WIDTH = 0.42;

/** The blade sweep as a fan of rays across the view, revealed as the swing progresses. */
export class KatanaSlice {
  time = 0;
  cooldown = 0;
  /** Alternates each swing, so cuts go right-to-left and back. */
  side = 1;

  get swinging(): boolean {
    return this.time > 0;
  }

  /** Swing progress from 0 to 1. */
  get progress(): number {
    return 1 - this.time / SWING_TIME;
  }

  swing(): boolean {
    if (this.cooldown > 0) return false;
    this.time = SWING_TIME;
    this.cooldown = SWING_TIME + RECOVER;
    this.side = -this.side;
    return true;
  }

  update(dt: number): void {
    this.time = Math.max(0, this.time - dt);
    this.cooldown = Math.max(0, this.cooldown - dt);
  }

  /**
   * Tests a circle against the part of the arc swept so far, as a fan of rays around the aim.
   * Returns the cut plane's normal if the blade reached it.
   */
  cuts(eye: Vec3, aim: Vec3, center: Vec3, radius: number): Vec3 | null {
    if (!this.swinging) return null;
    const swept = Math.max(1, Math.ceil(this.progress * RAYS));
    const reach = radius + BLADE_WIDTH;
    const ox = center.x - eye.x;
    const oy = center.y - eye.y;
    for (let i = 0; i < swept; i++) {
      const a = (i / (RAYS - 1) - 0.5) * ARC * this.side;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const rx = aim.x * c - aim.y * s;
      const ry = aim.x * s + aim.y * c;
      const along = ox * rx + oy * ry;
      if (along < 0 || along > RANGE + radius) continue;
      const px = ox - rx * along;
      const py = oy - ry * along;
      if (px * px + py * py < reach * reach) return v3(-ry, rx, 0);
    }
    return null;
  }

  /** A swing facing the stream parries it. */
  faces(look: Vec3, toPoint: Vec3): boolean {
    return this.swinging && look.x * toPoint.x + look.y * toPoint.y + look.z * toPoint.z > Math.cos(ARC / 2);
  }
}

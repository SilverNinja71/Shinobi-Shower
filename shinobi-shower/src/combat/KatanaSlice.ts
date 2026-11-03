import { cross, norm, v3 } from '../core/Vec.ts';
import type { Vec3 } from '../core/Vec.ts';

const SWING_TIME = 0.16;
const RECOVER = 0.1;
const RANGE = 3.8;
const ARC = (100 * Math.PI) / 180;
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
   * Tests a sphere against the part of the arc swept so far.
   * Returns the cut plane's normal if the blade reached it.
   */
  cuts(eye: Vec3, look: Vec3, center: Vec3, radius: number): Vec3 | null {
    if (!this.swinging) return null;
    const right = norm(cross(look, v3(0, 1, 0)));
    const up = cross(right, look);
    const swept = Math.max(1, Math.ceil(this.progress * RAYS));
    const reach = radius + BLADE_WIDTH;
    for (let i = 0; i < swept; i++) {
      const a = ((i / (RAYS - 1) - 0.5) * ARC) * this.side;
      const rx = look.x * Math.cos(a) + right.x * Math.sin(a);
      const ry = look.y * Math.cos(a) + right.y * Math.sin(a);
      const rz = look.z * Math.cos(a) + right.z * Math.sin(a);
      const ox = center.x - eye.x;
      const oy = center.y - eye.y;
      const oz = center.z - eye.z;
      const along = ox * rx + oy * ry + oz * rz;
      if (along < 0 || along > RANGE + radius) continue;
      const px = ox - rx * along;
      const py = oy - ry * along;
      const pz = oz - rz * along;
      if (px * px + py * py + pz * pz < reach * reach) return norm(up);
    }
    return null;
  }

  /** A swing facing the stream parries it. */
  faces(look: Vec3, toPoint: Vec3): boolean {
    return this.swinging && look.x * toPoint.x + look.y * toPoint.y + look.z * toPoint.z > Math.cos(ARC / 2);
  }
}

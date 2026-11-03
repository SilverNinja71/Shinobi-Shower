import { dist, dot, norm, sub } from '../core/Vec.ts';
import type { Vec3 } from '../core/Vec.ts';

const RANGE = 44;
const CONE = Math.cos((24 * Math.PI) / 180);
const SPRING = 34;
const DAMPING = 3.2;
const REEL_SPEED = 7.5;
const MIN_LENGTH = 3;

/** The anchor nearest the crosshair, if one is in range and in view. */
export function pickAnchor(eye: Vec3, look: Vec3, anchors: readonly Vec3[]): Vec3 | null {
  let best: Vec3 | null = null;
  let bestScore = CONE;
  for (const a of anchors) {
    if (dist(eye, a) > RANGE) continue;
    const score = dot(norm(sub(a, eye)), look);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** A one-sided spring: slack when close, pulling when stretched, and reeling itself in all the time. */
export class GrappleWire {
  anchor: Vec3 | null = null;
  length = 0;

  get attached(): boolean {
    return this.anchor !== null;
  }

  attach(anchor: Vec3, from: Vec3): void {
    this.anchor = anchor;
    this.length = dist(anchor, from);
  }

  release(): void {
    this.anchor = null;
  }

  /** Adds the wire's force to `vel`. */
  apply(pos: Vec3, vel: Vec3, dt: number): void {
    if (!this.anchor) return;
    this.length = Math.max(MIN_LENGTH, this.length - REEL_SPEED * dt);
    const toAnchor = sub(this.anchor, pos);
    const d = Math.hypot(toAnchor.x, toAnchor.y, toAnchor.z) || 1;
    const stretch = d - this.length;
    if (stretch <= 0) return;
    const nx = toAnchor.x / d;
    const ny = toAnchor.y / d;
    const nz = toAnchor.z / d;
    const closing = vel.x * nx + vel.y * ny + vel.z * nz;
    const force = SPRING * stretch - DAMPING * closing;
    if (force <= 0) return;
    vel.x += nx * force * dt;
    vel.y += ny * force * dt;
    vel.z += nz * force * dt;
  }
}

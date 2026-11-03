import type { Box, Level } from '../core/Level.ts';
import { v3 } from '../core/Vec.ts';
import type { Vec3 } from '../core/Vec.ts';

export interface RayHit {
  box: Box;
  t: number;
  normal: Vec3;
}

/** Slab test against one box. Returns the entry distance and face normal, or null. */
export function rayBox(o: Vec3, d: Vec3, box: Box, maxT: number): { t: number; normal: Vec3 } | null {
  let tMin = 0;
  let tMax = maxT;
  let normal: Vec3 | null = null;
  for (const axis of ['x', 'y', 'z'] as const) {
    if (Math.abs(d[axis]) < 1e-8) {
      if (o[axis] < box.min[axis] || o[axis] > box.max[axis]) return null;
      continue;
    }
    const inv = 1 / d[axis];
    let t0 = (box.min[axis] - o[axis]) * inv;
    let t1 = (box.max[axis] - o[axis]) * inv;
    const sign = inv > 0 ? -1 : 1;
    if (t0 > t1) [t0, t1] = [t1, t0];
    if (t0 > tMin) {
      tMin = t0;
      normal = v3(axis === 'x' ? sign : 0, axis === 'y' ? sign : 0, axis === 'z' ? sign : 0);
    }
    tMax = Math.min(tMax, t1);
    if (tMin > tMax) return null;
  }
  return normal ? { t: tMin, normal } : null;
}

export function raycast(level: Level, o: Vec3, d: Vec3, maxT: number): RayHit | null {
  let best: RayHit | null = null;
  for (const box of level.boxes) {
    const hit = rayBox(o, d, box, best ? best.t : maxT);
    if (hit) best = { box, t: hit.t, normal: hit.normal };
  }
  return best;
}

const REACH = 0.62;

/** Casts sideways from the chest. Returns a wall the ninja can run up, on the side given (-1 or 1). */
export function findWall(level: Level, chest: Vec3, side: number, ignore: Box | null): Box | null {
  const hit = raycast(level, chest, v3(side, 0, 0), REACH);
  return hit && hit.box.runnable && hit.box !== ignore ? hit.box : null;
}

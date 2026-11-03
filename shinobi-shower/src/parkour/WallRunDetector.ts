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

const REACH = 0.85;
const DIRECTIONS = [v3(1, 0, 0), v3(-1, 0, 0), v3(0, 0, 1), v3(0, 0, -1)];
/** Velocity must run within this angle of the wall's plane: 0 is parallel, 90 is head-on. */
const MAX_ENTRY_ANGLE = (75 * Math.PI) / 180;
const MIN_SPEED = 4.5;

export interface WallCandidate {
  box: Box;
  normal: Vec3;
  /** Unit direction of travel along the wall. */
  tangent: Vec3;
}

/** Casts from the ninja's chest in the four tile directions and picks a wall that can be run. */
export function findWall(level: Level, center: Vec3, vel: Vec3, ignore: Box | null): WallCandidate | null {
  const speed = Math.hypot(vel.x, vel.z);
  if (speed < MIN_SPEED) return null;
  let best: RayHit | null = null;
  for (const d of DIRECTIONS) {
    const hit = raycast(level, center, d, REACH);
    if (hit && hit.box.runnable && hit.box !== ignore && (!best || hit.t < best.t)) best = hit;
  }
  if (!best) return null;
  const { normal } = best;
  const into = -(vel.x * normal.x + vel.z * normal.z);
  if (Math.asin(Math.max(-1, Math.min(1, Math.abs(into) / speed))) > MAX_ENTRY_ANGLE) return null;
  let tx = -normal.z;
  let tz = normal.x;
  if (tx * vel.x + tz * vel.z < 0) {
    tx = -tx;
    tz = -tz;
  }
  return { box: best.box, normal, tangent: v3(tx, 0, tz) };
}

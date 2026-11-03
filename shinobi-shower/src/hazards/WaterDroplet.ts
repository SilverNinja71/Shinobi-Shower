import { v3 } from '../core/Vec.ts';
import type { Rng, Vec3 } from '../core/Vec.ts';

const GRAVITY = 22;
const SPLIT_SPEED = 3.2;
const HALF_LIFE = 0.55;

export interface Droplet {
  pos: Vec3;
  vel: Vec3;
  r: number;
  /** Where it will land, for the shadow on the floor. */
  landY: number;
}

/** One half of a cut droplet, drifting away from the cut plane as it evaporates. */
export interface DropletHalf {
  pos: Vec3;
  vel: Vec3;
  /** Direction the flat face looks. */
  axis: Vec3;
  r: number;
  age: number;
}

export interface MistMote {
  pos: Vec3;
  vel: Vec3;
  age: number;
  life: number;
}

export function makeDroplet(pos: Vec3, r: number, landY: number): Droplet {
  return { pos, vel: v3(0, -2, 0), r, landY };
}

export function stepDroplet(d: Droplet, dt: number): void {
  d.vel.y -= GRAVITY * dt;
  d.pos.x += d.vel.x * dt;
  d.pos.y += d.vel.y * dt;
  d.pos.z += d.vel.z * dt;
}

/** Splits a droplet across a plane into two harmless halves. */
export function cleave(d: Droplet, planeNormal: Vec3): [DropletHalf, DropletHalf] {
  const half = (sign: number): DropletHalf => ({
    pos: v3(d.pos.x, d.pos.y, d.pos.z),
    vel: v3(
      d.vel.x * 0.2 + planeNormal.x * SPLIT_SPEED * sign,
      d.vel.y * 0.2 + planeNormal.y * SPLIT_SPEED * sign,
      d.vel.z * 0.2 + planeNormal.z * SPLIT_SPEED * sign,
    ),
    axis: v3(planeNormal.x * -sign, planeNormal.y * -sign, planeNormal.z * -sign),
    r: d.r,
    age: 0,
  });
  return [half(1), half(-1)];
}

export function stepHalf(h: DropletHalf, dt: number): boolean {
  h.age += dt;
  h.pos.x += h.vel.x * dt;
  h.pos.y += h.vel.y * dt;
  h.pos.z += h.vel.z * dt;
  h.vel.y -= 3 * dt;
  return h.age < HALF_LIFE;
}

export function halfFade(h: DropletHalf): number {
  return 1 - h.age / HALF_LIFE;
}

export function burstMist(out: MistMote[], at: Vec3, count: number, rng: Rng): void {
  for (let i = 0; i < count && out.length < 240; i++) {
    const a = rng() * Math.PI * 2;
    const s = 0.6 + rng() * 2.2;
    out.push({
      pos: v3(at.x, at.y, at.z),
      vel: v3(Math.cos(a) * s, -0.4 + rng() * 1.6, Math.sin(a) * s),
      age: 0,
      life: 0.5 + rng() * 0.7,
    });
  }
}

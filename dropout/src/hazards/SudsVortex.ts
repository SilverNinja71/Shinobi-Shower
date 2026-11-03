import { range } from '../core/Rng.ts';
import type { Rng } from '../core/Rng.ts';
import { STALL_HALF } from '../player/FloorInteraction.ts';
import type { TileGrid } from '../player/FloorInteraction.ts';

export const DRAIN_RADIUS = 0.6;
const DRAIN_REACH = 5.5;
const DRAIN_SWIRL = 0.35;
const SHOWER_LENGTH = 180;

/** Drain pull in units/s² at full strength. It grows across the three-minute shower. */
export function drainStrength(time: number): number {
  const t = Math.max(0, Math.min(1, time / SHOWER_LENGTH));
  return 1 + 5 * Math.pow(t, 1.2);
}

export interface Pull {
  x: number;
  z: number;
}

/**
 * Radial drain gravity with a little swirl. Nothing past DRAIN_REACH is pulled.
 * Writes into `out` because this runs every physics step.
 */
export function drainPull(x: number, z: number, strength: number, out: Pull): Pull {
  const dist = Math.hypot(x, z);
  if (dist >= DRAIN_REACH || dist < 0.001) {
    out.x = out.z = 0;
    return out;
  }
  const closeness = 1 - dist / DRAIN_REACH;
  const force = strength * (0.25 + 0.75 * closeness * closeness);
  const nx = -x / dist;
  const nz = -z / dist;
  out.x = (nx - nz * DRAIN_SWIRL) * force;
  out.z = (nz + nx * DRAIN_SWIRL) * force;
  return out;
}

export interface FoamBubble {
  x: number;
  z: number;
  vx: number;
  vz: number;
  r: number;
  age: number;
  life: number;
}

const BUBBLE_SOAP_RATE = 2.2;

/** Rolling foam boulders. They soap every tile they cross. */
export class FoamBubbles {
  readonly items: FoamBubble[] = [];
  private readonly rng: Rng;
  private timer = 5;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  reset(): void {
    this.items.length = 0;
    this.timer = 5;
  }

  update(dt: number, interval: number, grid: TileGrid): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = interval;
      this.spawn();
    }
    for (let i = this.items.length - 1; i >= 0; i--) {
      const b = this.items[i];
      b.age += dt;
      if (b.age >= b.life) {
        this.items.splice(i, 1);
        continue;
      }
      b.x += b.vx * dt;
      b.z += b.vz * dt;
      const limit = STALL_HALF - b.r;
      if (Math.abs(b.x) > limit) {
        b.x = Math.sign(b.x) * limit;
        b.vx = -b.vx;
      }
      if (Math.abs(b.z) > limit) {
        b.z = Math.sign(b.z) * limit;
        b.vz = -b.vz;
      }
      const reach = b.r * 0.7;
      const soap = BUBBLE_SOAP_RATE * dt;
      grid.addSoap(b.x, b.z, soap);
      grid.addSoap(b.x + reach, b.z, soap);
      grid.addSoap(b.x - reach, b.z, soap);
      grid.addSoap(b.x, b.z + reach, soap);
      grid.addSoap(b.x, b.z - reach, soap);
    }
  }

  private spawn(): void {
    const r = range(this.rng, 0.95, 1.3);
    const limit = STALL_HALF - r;
    const along = range(this.rng, -limit, limit);
    const side = Math.floor(this.rng() * 4);
    const x = side === 0 ? -limit : side === 1 ? limit : along;
    const z = side === 2 ? -limit : side === 3 ? limit : along;
    // Roll toward a loose point near the middle of the stall.
    const dx = range(this.rng, -3.5, 3.5) - x;
    const dz = range(this.rng, -3.5, 3.5) - z;
    const len = Math.hypot(dx, dz);
    const speed = range(this.rng, 1.5, 2.4);
    this.items.push({ x, z, vx: (dx / len) * speed, vz: (dz / len) * speed, r, age: 0, life: 20 });
  }

  /** Bubbles bounce gently as they roll. */
  static heightOf(b: FoamBubble): number {
    return b.r + Math.abs(Math.sin(b.age * 2.4)) * 0.45;
  }
}

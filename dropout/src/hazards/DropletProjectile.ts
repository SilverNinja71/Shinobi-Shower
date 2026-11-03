import { STALL_HALF } from '../player/FloorInteraction.ts';

export type DropletKind = 'mist' | 'spray' | 'stream' | 'heavy' | 'bead';

export const DROPLET_KINDS: DropletKind[] = ['mist', 'spray', 'stream', 'heavy', 'bead'];

/** Time from the shadow decal appearing to a heavy drop landing. */
export const HEAVY_TELEGRAPH = 0.75;
export const HEAVY_HEIGHT = 9;
export const HEAVY_RADIUS = 0.85;
const HEAVY_GRAVITY = (2 * HEAVY_HEIGHT) / (HEAVY_TELEGRAPH * HEAVY_TELEGRAPH);

export const SPRAY_GRAVITY = 18;
const BEAD_GRAVITY = 14;
const BEAD_BOUNCE = 0.55;
const BEAD_ROLL_DRAG = 0.9;
const MIST_DRAG = 0.6;

export interface Droplet {
  kind: DropletKind;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  age: number;
  life: number;
  /** Mist drift phase, or the height a stream droplet flies at. */
  seed: number;
}

/** Fixed-capacity store with no per-frame allocation. Iterate `alive` backwards to remove safely. */
export class DropletPool {
  readonly alive: Droplet[] = [];
  private readonly free: Droplet[] = [];
  private readonly counts: Record<DropletKind, number> = { mist: 0, spray: 0, stream: 0, heavy: 0, bead: 0 };
  readonly capacity: number;

  constructor(capacity = 1000) {
    this.capacity = capacity;
  }

  spawn(kind: DropletKind): Droplet | null {
    if (this.alive.length >= this.capacity) return null;
    const d: Droplet = this.free.pop() ?? {
      kind, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 0.1, age: 0, life: 1, seed: 0,
    };
    d.kind = kind;
    d.age = 0;
    this.alive.push(d);
    this.counts[kind]++;
    return d;
  }

  /** Removes by index with a swap, so callers must walk `alive` from the end. */
  removeAt(index: number): void {
    const d = this.alive[index];
    this.counts[d.kind]--;
    this.free.push(d);
    const last = this.alive.pop()!;
    if (index < this.alive.length) this.alive[index] = last;
  }

  count(kind: DropletKind): number {
    return this.counts[kind];
  }

  clear(): void {
    for (let i = this.alive.length - 1; i >= 0; i--) this.removeAt(i);
  }
}

/** Advances a droplet. Returns true when it has hit the floor or wall and should be consumed. */
export function stepDroplet(d: Droplet, dt: number): boolean {
  d.age += dt;
  switch (d.kind) {
    case 'mist': {
      const keep = Math.exp(-MIST_DRAG * dt);
      d.vx = d.vx * keep + Math.sin(d.seed + d.age * 0.9) * 0.25 * dt;
      d.vz = d.vz * keep + Math.cos(d.seed * 1.7 + d.age * 0.7) * 0.25 * dt;
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.y += Math.sin(d.seed + d.age * 1.3) * 0.12 * dt;
      return false;
    }
    case 'spray':
      d.vy -= SPRAY_GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      return d.y <= d.r;
    case 'stream':
      d.x += d.vx * dt;
      d.z += d.vz * dt;
      d.y = d.seed + Math.sin(d.age * 7 + d.x + d.z) * 0.02;
      return Math.abs(d.x) > STALL_HALF + 0.3 || Math.abs(d.z) > STALL_HALF + 0.3;
    case 'heavy':
      // Height is a function of age, so the drop lands exactly as the decal closes.
      d.y = Math.max(0, HEAVY_HEIGHT - 0.5 * HEAVY_GRAVITY * d.age * d.age);
      d.vy = -HEAVY_GRAVITY * d.age;
      return d.age >= d.life;
    case 'bead': {
      d.vy -= BEAD_GRAVITY * dt;
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.z += d.vz * dt;
      if (d.y < d.r) {
        d.y = d.r;
        d.vy = Math.abs(d.vy) * BEAD_BOUNCE;
        const keep = Math.exp(-BEAD_ROLL_DRAG * dt);
        d.vx *= keep;
        d.vz *= keep;
      }
      const limit = STALL_HALF - d.r;
      if (Math.abs(d.x) > limit) {
        d.x = Math.sign(d.x) * limit;
        d.vx = -d.vx * 0.7;
      }
      if (Math.abs(d.z) > limit) {
        d.z = Math.sign(d.z) * limit;
        d.vz = -d.vz * 0.7;
      }
      return false;
    }
  }
}

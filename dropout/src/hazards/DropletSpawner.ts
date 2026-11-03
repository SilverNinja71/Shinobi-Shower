import { range } from '../core/Rng.ts';
import type { Rng } from '../core/Rng.ts';
import { STALL_HALF } from '../player/FloorInteraction.ts';
import { DropletPool, HEAVY_HEIGHT, HEAVY_TELEGRAPH, SPRAY_GRAVITY } from './DropletProjectile.ts';

/** Where the showerhead's spray leaves from. */
export const HEAD_POS = { x: 0, y: 5.3, z: -6.1 };

const CONE_MIN_FLIGHT = 0.8;
const CONE_MAX_FLIGHT = 1.15;
const FLOOR_MARGIN = 0.6;

const STREAM_WARNING = 0.7;
const STREAM_HEIGHT = 0.62;
const STREAM_SPEED = 6.5;
const STREAM_SPACING = 0.8;
const STREAM_GAP = 3;
const STREAM_VOLLEYS = 3;
const STREAM_VOLLEY_GAP = 0.16;

export interface WaveParams {
  /** Spray droplets per second from the showerhead. */
  coneRate: number;
  /** Radius of the patch of floor the cone covers. */
  coneRadius: number;
  /** Seconds between heavy drops. */
  heavyInterval: number;
  /** Chance that a heavy drop arrives as a barrage. */
  barrage: number;
  /** Seconds between low stream sweeps. */
  streamInterval: number;
  /** Seconds between foam bubbles. */
  bubbleInterval: number;
  mistCount: number;
  /** Moisture gained per second just from being in the room. */
  humidity: number;
  /** Water temperature in °C. */
  heat: number;
}

export interface Target {
  x: number;
  z: number;
  vx: number;
  vz: number;
}

export interface Ripple {
  x: number;
  z: number;
  r: number;
  speed: number;
  maxR: number;
  strength: number;
  /** A ripple shoves the player at most once. */
  spent: boolean;
}

export interface StreamWarning {
  /** 0 back, 1 front, 2 left, 3 right. */
  side: number;
  /** Seconds until it fires. */
  left: number;
  gapStart: number;
}

function clampFloor(v: number): number {
  const limit = STALL_HALF - FLOOR_MARGIN;
  return Math.max(-limit, Math.min(limit, v));
}

/** The showerhead's emission patterns. Decides what spawns and where, never what it does on contact. */
export class DropletSpawner {
  readonly pool = new DropletPool();
  readonly ripples: Ripple[] = [];
  streamWarning: StreamWarning | null = null;
  aimX = 0;
  aimZ = 0;

  private readonly rng: Rng;
  private time = 0;
  private coneDebt = 0;
  private heavyTimer = 2;
  private streamTimer = 7;
  private volleysLeft = 0;
  private volleyTimer = 0;
  private volley: StreamWarning | null = null;

  constructor(rng: Rng) {
    this.rng = rng;
  }

  reset(): void {
    this.pool.clear();
    this.ripples.length = 0;
    this.streamWarning = null;
    this.volley = null;
    this.volleysLeft = 0;
    this.time = 0;
    this.coneDebt = 0;
    this.heavyTimer = 2;
    this.streamTimer = 7;
  }

  update(dt: number, p: WaveParams, target: Target | null): void {
    this.time += dt;
    this.updateAim(dt, target);
    this.updateCone(dt, p);
    this.updateMist(p);
    this.updateHeavy(dt, p, target);
    this.updateStream(dt, p);
    this.updateRipples(dt);
  }

  /** The cone wanders on a slow curve and is tugged toward the player. */
  private updateAim(dt: number, target: Target | null): void {
    const t = this.time;
    let goalX = Math.sin(t * 0.37) * 4.5 + Math.sin(t * 0.91) * 1.2;
    let goalZ = Math.cos(t * 0.29) * 4 + Math.sin(t * 0.73) * 1.2;
    if (target) {
      goalX = goalX * 0.6 + target.x * 0.4;
      goalZ = goalZ * 0.6 + target.z * 0.4;
    }
    const k = 1 - Math.exp(-1.2 * dt);
    this.aimX += (goalX - this.aimX) * k;
    this.aimZ += (goalZ - this.aimZ) * k;
  }

  private updateCone(dt: number, p: WaveParams): void {
    this.coneDebt += p.coneRate * dt;
    while (this.coneDebt >= 1) {
      this.coneDebt -= 1;
      // Square root of a uniform spreads droplets evenly over the disc.
      const angle = this.rng() * Math.PI * 2;
      const dist = Math.sqrt(this.rng()) * p.coneRadius;
      this.spawnSpray(this.aimX + Math.cos(angle) * dist, this.aimZ + Math.sin(angle) * dist);
    }
  }

  /** Launches one ballistic droplet from the head that lands on the given floor point. */
  spawnSpray(tx: number, tz: number): void {
    const d = this.pool.spawn('spray');
    if (!d) return;
    const flight = range(this.rng, CONE_MIN_FLIGHT, CONE_MAX_FLIGHT);
    d.x = HEAD_POS.x + range(this.rng, -0.28, 0.28);
    d.y = HEAD_POS.y;
    d.z = HEAD_POS.z + range(this.rng, -0.12, 0.12);
    d.r = range(this.rng, 0.07, 0.11);
    d.vx = (clampFloor(tx) - d.x) / flight;
    d.vz = (clampFloor(tz) - d.z) / flight;
    d.vy = (d.r - d.y + 0.5 * SPRAY_GRAVITY * flight * flight) / flight;
    d.life = flight + 1;
  }

  private updateMist(p: WaveParams): void {
    if (this.pool.count('mist') >= p.mistCount) return;
    const d = this.pool.spawn('mist');
    if (!d) return;
    d.x = range(this.rng, -STALL_HALF, STALL_HALF);
    d.y = range(this.rng, 0.15, 1.1);
    d.z = range(this.rng, -STALL_HALF, STALL_HALF);
    d.vx = d.vy = d.vz = 0;
    d.r = range(this.rng, 0.03, 0.06);
    d.life = range(this.rng, 5, 10);
    d.seed = this.rng() * 100;
  }

  private updateHeavy(dt: number, p: WaveParams, target: Target | null): void {
    this.heavyTimer -= dt;
    if (this.heavyTimer > 0) return;
    this.heavyTimer = p.heavyInterval * range(this.rng, 0.8, 1.2);

    // Lead the target slightly, so running straight does not dodge everything.
    const lead = HEAVY_TELEGRAPH * 0.6;
    const cx = target ? target.x + target.vx * lead : range(this.rng, -5, 5);
    const cz = target ? target.z + target.vz * lead : range(this.rng, -5, 5);
    if (this.rng() < p.barrage) {
      this.spawnBarrage(cx, cz);
    } else {
      this.spawnHeavy(cx + range(this.rng, -0.7, 0.7), cz + range(this.rng, -0.7, 0.7));
    }
  }

  spawnHeavy(x: number, z: number): void {
    const d = this.pool.spawn('heavy');
    if (!d) return;
    d.x = clampFloor(x);
    d.y = HEAVY_HEIGHT;
    d.z = clampFloor(z);
    d.vx = d.vy = d.vz = 0;
    d.r = 0.34;
    d.life = HEAVY_TELEGRAPH;
  }

  /** A line of heavy drops at a random angle through the point. */
  private spawnBarrage(x: number, z: number): void {
    const angle = this.rng() * Math.PI;
    const count = 3 + Math.floor(this.rng() * 3);
    for (let i = 0; i < count; i++) {
      const offset = (i - (count - 1) / 2) * 2;
      this.spawnHeavy(x + Math.cos(angle) * offset, z + Math.sin(angle) * offset);
    }
  }

  /** A heavy drop's aftermath: 8 to 12 ricocheting beads and a ripple along the floor. */
  burst(x: number, z: number): void {
    const count = 8 + Math.floor(this.rng() * 5);
    const start = this.rng() * Math.PI * 2;
    for (let i = 0; i < count; i++) {
      const d = this.pool.spawn('bead');
      if (!d) break;
      const angle = start + (i / count) * Math.PI * 2 + range(this.rng, -0.2, 0.2);
      const speed = range(this.rng, 2.2, 4.6);
      d.x = x;
      d.y = 0.2;
      d.z = z;
      d.vx = Math.cos(angle) * speed;
      d.vy = range(this.rng, 2.5, 4.5);
      d.vz = Math.sin(angle) * speed;
      d.r = range(this.rng, 0.09, 0.14);
      d.life = range(this.rng, 1.2, 2.2);
    }
    this.ripples.push({ x, z, r: 0.4, speed: 6.5, maxR: 4.2, strength: 3.5, spent: false });
  }

  /** A hop's landing splash shoves nearby small droplets away. */
  pushRadial(x: number, z: number, radius: number, impulse: number): void {
    for (const d of this.pool.alive) {
      if (d.kind !== 'mist' && d.kind !== 'bead') continue;
      const dx = d.x - x;
      const dz = d.z - z;
      const dist = Math.hypot(dx, dz);
      if (dist > radius || dist < 0.001) continue;
      const k = (impulse * (1 - dist / radius)) / dist;
      d.vx += dx * k;
      d.vz += dz * k;
    }
  }

  private updateStream(dt: number, p: WaveParams): void {
    if (this.volleysLeft > 0 && this.volley) {
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0) {
        this.fireVolley(this.volley);
        this.volleysLeft--;
        this.volleyTimer = STREAM_VOLLEY_GAP;
      }
      return;
    }
    if (this.streamWarning) {
      this.streamWarning.left -= dt;
      if (this.streamWarning.left <= 0) {
        this.volley = this.streamWarning;
        this.volleysLeft = STREAM_VOLLEYS;
        this.volleyTimer = 0;
        this.streamWarning = null;
      }
      return;
    }
    this.streamTimer -= dt;
    if (this.streamTimer <= 0) {
      this.streamTimer = p.streamInterval;
      const nozzles = Math.floor((STALL_HALF * 2) / STREAM_SPACING);
      this.streamWarning = {
        side: Math.floor(this.rng() * 4),
        left: STREAM_WARNING,
        gapStart: Math.floor(this.rng() * (nozzles - STREAM_GAP)),
      };
    }
  }

  /** A wall-to-wall line at shin height with a small gap. Slide under, hop over or find the gap. */
  private fireVolley(w: StreamWarning): void {
    const nozzles = Math.floor((STALL_HALF * 2) / STREAM_SPACING);
    const horizontal = w.side < 2;
    const sign = w.side % 2 === 0 ? -1 : 1;
    for (let i = 0; i < nozzles; i++) {
      if (i >= w.gapStart && i < w.gapStart + STREAM_GAP) continue;
      const d = this.pool.spawn('stream');
      if (!d) return;
      const along = -STALL_HALF + (i + 0.5) * STREAM_SPACING;
      d.x = horizontal ? along : sign * STALL_HALF;
      d.z = horizontal ? sign * STALL_HALF : along;
      d.y = STREAM_HEIGHT;
      d.seed = STREAM_HEIGHT;
      d.vx = horizontal ? 0 : -sign * STREAM_SPEED;
      d.vy = 0;
      d.vz = horizontal ? -sign * STREAM_SPEED : 0;
      d.r = 0.13;
      d.life = 4;
    }
  }

  private updateRipples(dt: number): void {
    for (let i = this.ripples.length - 1; i >= 0; i--) {
      const ripple = this.ripples[i];
      ripple.r += ripple.speed * dt;
      if (ripple.r >= ripple.maxR) this.ripples.splice(i, 1);
    }
  }
}

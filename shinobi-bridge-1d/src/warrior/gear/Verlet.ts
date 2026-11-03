/**
 * A small position-based Verlet solver for cosmetic cloth: points, distance links, pinned points,
 * gravity, wind and spherical / capsule colliders. Everything lives in flat typed arrays and runs on
 * a fixed step, so a frame never allocates and a slow frame cannot blow it up.
 */

export interface Capsule {
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  r: number;
}

const STEP = 1 / 60;
const MAX_STEPS = 3;

export class VerletBody {
  readonly count: number;
  readonly pos: Float32Array;
  /**
   * Per point: where it sits along the body's flutter wave (radians) and how hard the gusts shake
   * it. Points with close phases move together, so a phase that grows from the pinned edge toward
   * the free one sends ripples running down the cloth instead of shaking each point on its own.
   */
  readonly phase: Float32Array;
  readonly flutter: Float32Array;
  private readonly prev: Float32Array;
  /** 1 for free points, 0 for pinned ones (moved by `pin`). */
  private readonly free: Float32Array;
  private readonly linkA: Uint16Array;
  private readonly linkB: Uint16Array;
  private readonly linkRest: Float32Array;
  private links = 0;
  private acc = 0;
  /** Per-point drag against the air: 0 none, 1 stops dead. */
  drag = 0.02;
  /** How strongly the wind pushes each point (m/s² per m/s of wind). */
  windGain = 1.2;
  gravity = -9.8;
  iterations = 4;
  /** Lowest a point may fall (the deck under the warrior). */
  floor = -1e9;
  readonly colliders: Capsule[] = [];

  constructor(count: number, maxLinks: number) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.prev = new Float32Array(count * 3);
    this.free = new Float32Array(count).fill(1);
    this.phase = new Float32Array(count);
    for (let i = 0; i < count; i++) this.phase[i] = i * 0.9;
    this.flutter = new Float32Array(count).fill(1);
    this.linkA = new Uint16Array(maxLinks);
    this.linkB = new Uint16Array(maxLinks);
    this.linkRest = new Float32Array(maxLinks);
  }

  link(a: number, b: number, rest?: number): void {
    const i = this.links++;
    this.linkA[i] = a;
    this.linkB[i] = b;
    const p = this.pos;
    this.linkRest[i] = rest ?? Math.hypot(p[a * 3] - p[b * 3], p[a * 3 + 1] - p[b * 3 + 1], p[a * 3 + 2] - p[b * 3 + 2]);
  }

  /** Places a point and its history (no velocity), e.g. when the body is first shown. */
  place(i: number, x: number, y: number, z: number): void {
    this.pos.set([x, y, z], i * 3);
    this.prev.set([x, y, z], i * 3);
  }

  /** Holds a point at a position each step (the shoulder seams, a ribbon's knot). */
  pin(i: number, x: number, y: number, z: number): void {
    this.free[i] = 0;
    const k = i * 3;
    this.pos[k] = x;
    this.pos[k + 1] = y;
    this.pos[k + 2] = z;
    this.prev[k] = x;
    this.prev[k + 1] = y;
    this.prev[k + 2] = z;
  }

  /** Teleports the whole body by an offset (keeps its shape and motion). */
  shift(dx: number, dy: number, dz: number): void {
    for (let i = 0; i < this.count; i++) {
      const k = i * 3;
      this.pos[k] += dx;
      this.pos[k + 1] += dy;
      this.pos[k + 2] += dz;
      this.prev[k] += dx;
      this.prev[k + 1] += dy;
      this.prev[k + 2] += dz;
    }
  }

  /** Advances by `dt` in fixed steps. `wind` is a velocity the air pushes toward; `gust` adds flutter. */
  update(dt: number, windX: number, windY: number, windZ: number, time: number, gust: number): void {
    this.acc = Math.min(this.acc + dt, STEP * MAX_STEPS);
    while (this.acc >= STEP) {
      this.acc -= STEP;
      this.integrate(windX, windY, windZ, time, gust);
      for (let it = 0; it < this.iterations; it++) this.solve();
    }
  }

  private integrate(wx: number, wy: number, wz: number, time: number, gust: number): void {
    const p = this.pos;
    const q = this.prev;
    const h2 = STEP * STEP;
    const keep = 1 - this.drag;
    for (let i = 0; i < this.count; i++) {
      if (this.free[i] === 0) continue;
      const k = i * 3;
      const vx = (p[k] - q[k]) * keep;
      const vy = (p[k + 1] - q[k + 1]) * keep;
      const vz = (p[k + 2] - q[k + 2]) * keep;
      // Air drags each point toward the wind's velocity, with gusts that run along the body as waves.
      const ph = this.phase[i];
      const f = (Math.sin(time * 6.1 - ph) * 0.65 + Math.sin(time * 2.3 - ph * 0.45 + 1.7) * 0.35) * gust * this.flutter[i];
      const ax = (wx + f - vx / STEP) * this.windGain;
      const ay = this.gravity + (wy + f * 0.5 - vy / STEP) * this.windGain * 0.5;
      const az = (wz + f * 0.6 - vz / STEP) * this.windGain;
      q[k] = p[k];
      q[k + 1] = p[k + 1];
      q[k + 2] = p[k + 2];
      p[k] += vx + ax * h2;
      p[k + 1] += vy + ay * h2;
      p[k + 2] += vz + az * h2;
    }
  }

  private solve(): void {
    const p = this.pos;
    const free = this.free;
    for (let l = 0; l < this.links; l++) {
      const a = this.linkA[l] * 3;
      const b = this.linkB[l] * 3;
      const dx = p[b] - p[a];
      const dy = p[b + 1] - p[a + 1];
      const dz = p[b + 2] - p[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const wa = free[this.linkA[l]];
      const wb = free[this.linkB[l]];
      const w = wa + wb;
      if (w === 0) continue;
      const diff = (d - this.linkRest[l]) / (d * w);
      p[a] += dx * diff * wa;
      p[a + 1] += dy * diff * wa;
      p[a + 2] += dz * diff * wa;
      p[b] -= dx * diff * wb;
      p[b + 1] -= dy * diff * wb;
      p[b + 2] -= dz * diff * wb;
    }
    for (let i = 0; i < this.count; i++) {
      if (free[i] === 0) continue;
      const k = i * 3;
      if (p[k + 1] < this.floor) p[k + 1] = this.floor;
      for (const c of this.colliders) this.pushOut(k, c);
    }
  }

  /** Pushes a point out of a capsule. */
  private pushOut(k: number, c: Capsule): void {
    const p = this.pos;
    const abx = c.bx - c.ax;
    const aby = c.by - c.ay;
    const abz = c.bz - c.az;
    const len = abx * abx + aby * aby + abz * abz;
    let t = len > 0 ? ((p[k] - c.ax) * abx + (p[k + 1] - c.ay) * aby + (p[k + 2] - c.az) * abz) / len : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = c.ax + abx * t;
    const cy = c.ay + aby * t;
    const cz = c.az + abz * t;
    const dx = p[k] - cx;
    const dy = p[k + 1] - cy;
    const dz = p[k + 2] - cz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= c.r || d < 1e-6) return;
    const s = c.r / d;
    p[k] = cx + dx * s;
    p[k + 1] = cy + dy * s;
    p[k + 2] = cz + dz * s;
  }
}

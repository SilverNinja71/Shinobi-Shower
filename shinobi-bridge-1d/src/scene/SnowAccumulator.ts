/**
 * Snow lying on the deck, as a height map along the lane. Flakes add to it where they land, steep
 * faces slump to the angle of repose so drifts form soft mounds, rain and time melt it, and a kick
 * or a flaming cut clears it.
 */

export const SNOW_CELL = 0.15;
export const MAX_SNOW_DEPTH = 0.8;
/** Depth at which the slowdown peaks. */
export const SNOW_SLOW_DEPTH = 0.4;
/** Deepest slowdown: half speed, at SNOW_SLOW_DEPTH and above. */
export const SNOW_MAX_SLOW = 0.5;
/** How much of a flake's cross-section ends up as packed snow. */
export const SNOW_PACKING = 0.3;
const REPOSE = Math.tan((34 * Math.PI) / 180) * SNOW_CELL;
const SLUMP_RATE = 6;
const BASE_MELT = 0.0015;

export class SnowAccumulator {
  readonly length: number;
  readonly cells: number;
  readonly depth: Float32Array;
  /** 1 where the deck below is missing; snow there falls into the gorge. */
  readonly open: Uint8Array;
  /** Bumped whenever depth changes, so the mesh only rebuilds when it must. */
  version = 0;

  constructor(length: number) {
    this.length = length;
    this.cells = Math.ceil(length / SNOW_CELL);
    this.depth = new Float32Array(this.cells);
    this.open = new Uint8Array(this.cells);
  }

  private cellOf(x: number): number {
    return Math.floor(x / SNOW_CELL);
  }

  /** Depth at x, interpolated between cell centres. */
  depthAt(x: number): number {
    const f = x / SNOW_CELL - 0.5;
    const i = Math.floor(f);
    const t = f - i;
    const a = this.depth[i] ?? 0;
    const b = this.depth[i + 1] ?? 0;
    if (i < 0) return b;
    if (i + 1 >= this.cells) return a;
    return a + (b - a) * t;
  }

  /** How much snow at x slows the warrior: 1 is free movement, 0.5 is the floor. */
  slowAt(x: number): number {
    const d = Math.max(this.depthAt(x - 0.15), this.depthAt(x), this.depthAt(x + 0.15));
    return 1 - SNOW_MAX_SLOW * Math.min(1, d / SNOW_SLOW_DEPTH);
  }

  /** Adds a landed flake's area (m², in the lane's cross-section) around x. */
  deposit(x: number, area: number): void {
    const i = this.cellOf(x);
    const amount = (area * SNOW_PACKING) / SNOW_CELL;
    const weights = [0.25, 0.5, 0.25];
    for (let k = -1; k <= 1; k++) {
      const j = i + k;
      if (j < 0 || j >= this.cells || this.open[j]) continue;
      this.depth[j] = Math.min(MAX_SNOW_DEPTH, this.depth[j] + amount * weights[k + 1]);
    }
    this.version++;
  }

  /** Removes up to `limit` metres of depth over [x0, x1]. Returns the area removed. */
  clear(x0: number, x1: number, limit = Infinity): number {
    const i0 = Math.max(0, this.cellOf(Math.min(x0, x1)));
    const i1 = Math.min(this.cells - 1, this.cellOf(Math.max(x0, x1)));
    let removed = 0;
    for (let i = i0; i <= i1; i++) {
      const take = Math.min(this.depth[i], limit);
      this.depth[i] -= take;
      removed += take * SNOW_CELL;
    }
    if (removed > 0) this.version++;
    return removed;
  }

  /** Rain melts a little of what it lands on. */
  meltAt(x: number, amount: number): void {
    const i = this.cellOf(x);
    if (i < 0 || i >= this.cells || this.depth[i] <= 0) return;
    this.depth[i] = Math.max(0, this.depth[i] - amount);
    this.version++;
  }

  /** Marks the deck over [x0, x1) open or closed. Snow over a new hole drops away; returns that area. */
  setOpen(x0: number, x1: number, open: boolean): number {
    const i0 = Math.max(0, this.cellOf(x0));
    const i1 = Math.min(this.cells - 1, this.cellOf(x1 - 1e-6));
    let lost = 0;
    for (let i = i0; i <= i1; i++) {
      this.open[i] = open ? 1 : 0;
      if (open) {
        lost += this.depth[i] * SNOW_CELL;
        this.depth[i] = 0;
      }
    }
    this.version++;
    return lost;
  }

  /** Steep faces slump toward the angle of repose; everything slowly melts. */
  update(dt: number, warm: number): void {
    const d = this.depth;
    let changed = false;
    const k = Math.min(0.5, SLUMP_RATE * dt);
    for (let i = 0; i < this.cells - 1; i++) {
      if (this.open[i] || this.open[i + 1]) continue;
      const diff = d[i] - d[i + 1];
      const excess = Math.abs(diff) - REPOSE;
      if (excess <= 0) continue;
      const move = (excess / 2) * k * Math.sign(diff);
      d[i] -= move;
      d[i + 1] += move;
      changed = true;
    }
    const melt = (BASE_MELT + warm) * dt;
    for (let i = 0; i < this.cells; i++) {
      if (d[i] <= 0) continue;
      d[i] = Math.max(0, d[i] - melt);
      changed = true;
    }
    if (changed) this.version++;
  }

  /** Total snow area on the deck (m²). */
  get total(): number {
    let s = 0;
    for (let i = 0; i < this.cells; i++) s += this.depth[i];
    return s * SNOW_CELL;
  }

  reset(): void {
    this.depth.fill(0);
    this.open.fill(0);
    this.version++;
  }
}

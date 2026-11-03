import type { Box, Surface } from '../core/Level.ts';
import type { Vec3 } from '../core/Vec.ts';

const CELL = 1.5;
const WET_TIME = 12;
const MAX_CELLS = 256;

export interface WetCell {
  x: number;
  y: number;
  z: number;
  /** Axis of the face the cell sits on: 0 x, 1 y, 2 z. */
  axis: number;
  sign: number;
  life: number;
}

export interface SurfaceProps {
  accel: number;
  friction: number;
  /** Multiplier on the slide's speed burst. Wet tile hydroplanes. */
  slideBoost: number;
  slideSteer: number;
  /** Seconds a wall-run holds. Infinity means it never slips. */
  wallHold: number;
}

export const SURFACES: Record<Surface, SurfaceProps> = {
  dry: { accel: 70, friction: 9, slideBoost: 3, slideSteer: 2.5, wallHold: Infinity },
  wet: { accel: 42, friction: 4, slideBoost: 6, slideSteer: 6, wallHold: 0.65 },
  soapy: { accel: 13, friction: 0.6, slideBoost: 4, slideSteer: 1, wallHold: 0 },
  chrome: { accel: 60, friction: 7, slideBoost: 3, slideSteer: 3, wallHold: 0 },
};

/** Surface tracking: authored wet bands on tile, plus cells that spray has wet and that dry out over time. */
export class TileHazardGrid {
  readonly cells = new Map<string, WetCell>();

  private key(p: Vec3, axis: number): string {
    return `${axis}:${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}:${Math.floor(p.z / CELL)}`;
  }

  reset(): void {
    this.cells.clear();
  }

  /** Marks the face a stream or droplet hit. `normal` is the face's outward normal. */
  wet(p: Vec3, normal: Vec3): void {
    const axis = Math.abs(normal.x) > 0.5 ? 0 : Math.abs(normal.y) > 0.5 ? 1 : 2;
    const key = this.key(p, axis);
    const existing = this.cells.get(key);
    if (existing) {
      existing.life = WET_TIME;
      return;
    }
    if (this.cells.size >= MAX_CELLS) return;
    const snap = (v: number, along: boolean) => (along ? v : (Math.floor(v / CELL) + 0.5) * CELL);
    this.cells.set(key, {
      x: snap(p.x, axis === 0),
      y: snap(p.y, axis === 1),
      z: snap(p.z, axis === 2),
      axis,
      sign: axis === 0 ? Math.sign(normal.x) : axis === 1 ? Math.sign(normal.y) : Math.sign(normal.z),
      life: WET_TIME,
    });
  }

  update(dt: number): void {
    for (const [key, cell] of this.cells) {
      cell.life -= dt;
      if (cell.life <= 0) this.cells.delete(key);
    }
  }

  surfaceAt(box: Box, p: Vec3, axis: number): Surface {
    if (box.surface !== 'dry') return box.surface;
    for (const [y0, y1] of box.wetBands) if (p.y >= y0 && p.y <= y1) return 'wet';
    return this.cells.has(this.key(p, axis)) ? 'wet' : 'dry';
  }
}

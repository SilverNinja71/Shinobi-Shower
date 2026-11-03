/** Half the stall's width in world units. Tiles are one unit square. */
export const STALL_HALF = 7;
export const GRID_SIZE = STALL_HALF * 2;

export type Surface = 'dry' | 'wet' | 'soapy';

export interface SurfaceProps {
  /** Thrust from input, units/s². */
  accel: number;
  /** Exponential velocity decay, 1/s. */
  drag: number;
  /** How fast sideways velocity is scrubbed when steering, 1/s. Low grip means drift. */
  grip: number;
  /** Speed above this bleeds off softly, so dashes and bounces can exceed it. */
  maxSpeed: number;
}

export const SURFACES: Record<Surface, SurfaceProps> = {
  dry: { accel: 46, drag: 7, grip: 16, maxSpeed: 6.2 },
  wet: { accel: 22, drag: 0.85, grip: 2.6, maxSpeed: 7.6 },
  soapy: { accel: 7, drag: 0.06, grip: 0.25, maxSpeed: 10 },
};

const WET_THRESHOLD = 0.25;
const SOAP_THRESHOLD = 0.5;
const EVAPORATION = 0.012;
const SOAP_FADE = 0.02;

/** The collision grid: per-tile water and soap, from which each tile's surface is derived. */
export class TileGrid {
  readonly wet = new Float32Array(GRID_SIZE * GRID_SIZE);
  readonly soap = new Float32Array(GRID_SIZE * GRID_SIZE);

  constructor() {
    this.reset();
  }

  /** Everything starts wet apart from a small dry patch in each corner. */
  reset(): void {
    this.soap.fill(0);
    for (let j = 0; j < GRID_SIZE; j++) {
      for (let i = 0; i < GRID_SIZE; i++) {
        const fromCorner = Math.min(i, GRID_SIZE - 1 - i) + Math.min(j, GRID_SIZE - 1 - j);
        this.wet[j * GRID_SIZE + i] = fromCorner <= 1 ? 0 : 0.7;
      }
    }
  }

  /** Tile index for a world position. Positions outside the stall clamp to the edge. */
  indexAt(x: number, z: number): number {
    const i = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(x + STALL_HALF)));
    const j = Math.max(0, Math.min(GRID_SIZE - 1, Math.floor(z + STALL_HALF)));
    return j * GRID_SIZE + i;
  }

  surfaceAt(x: number, z: number): Surface {
    const idx = this.indexAt(x, z);
    if (this.soap[idx] >= SOAP_THRESHOLD) return 'soapy';
    return this.wet[idx] >= WET_THRESHOLD ? 'wet' : 'dry';
  }

  propsAt(x: number, z: number): SurfaceProps {
    return SURFACES[this.surfaceAt(x, z)];
  }

  /** Water wets a tile and rinses some of its soap away. */
  addWater(x: number, z: number, amount: number): void {
    const idx = this.indexAt(x, z);
    this.wet[idx] = Math.min(1, this.wet[idx] + amount);
    this.soap[idx] = Math.max(0, this.soap[idx] - amount * 0.5);
  }

  addSoap(x: number, z: number, amount: number): void {
    const idx = this.indexAt(x, z);
    this.soap[idx] = Math.min(1, this.soap[idx] + amount);
    this.wet[idx] = Math.max(this.wet[idx], WET_THRESHOLD);
  }

  update(dt: number): void {
    for (let i = 0; i < this.wet.length; i++) {
      this.wet[i] = Math.max(0, this.wet[i] - EVAPORATION * dt);
      this.soap[i] = Math.max(0, this.soap[i] - SOAP_FADE * dt);
    }
  }
}

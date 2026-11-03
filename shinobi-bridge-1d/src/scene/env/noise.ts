import { mulberry32 } from '../../core/Rng.ts';
import type { Rng } from '../../core/Rng.ts';

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (t: number, a: number, b: number) => a + t * (b - a);

function grad(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/**
 * Seeded 3D gradient noise (improved Perlin), used only while building geometry at load time, so
 * the rock and the ridgelines come out the same on every run.
 */
export class Noise3 {
  private readonly p = new Uint8Array(512);

  constructor(seed: number) {
    const rng = mulberry32(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) this.p[i] = p[i & 255];
  }

  /** Roughly −1…1. */
  noise(x: number, y: number, z: number): number {
    const p = this.p;
    const fx = Math.floor(x);
    const fy = Math.floor(y);
    const fz = Math.floor(z);
    const X = fx & 255;
    const Y = fy & 255;
    const Z = fz & 255;
    x -= fx;
    y -= fy;
    z -= fz;
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    return lerp(
      w,
      lerp(v, lerp(u, grad(p[AA], x, y, z), grad(p[BA], x - 1, y, z)), lerp(u, grad(p[AB], x, y - 1, z), grad(p[BB], x - 1, y - 1, z))),
      lerp(
        v,
        lerp(u, grad(p[AA + 1], x, y, z - 1), grad(p[BA + 1], x - 1, y, z - 1)),
        lerp(u, grad(p[AB + 1], x, y - 1, z - 1), grad(p[BB + 1], x - 1, y - 1, z - 1)),
      ),
    );
  }

  /** Fractal sum, roughly −1…1. */
  fbm(x: number, y: number, z: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.noise(x, y, z);
      norm += amp;
      // Offset each octave so the lattices never line up.
      x = x * 2.03 + 17.1;
      y = y * 2.03 + 3.7;
      z = z * 2.03 + 9.3;
      amp *= 0.5;
    }
    return sum / norm;
  }

  /** Ridged multifractal, 0…1 with sharp crests: knife-edge ridgelines and gullies. */
  ridged(x: number, y: number, z: number, octaves = 4): number {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let n = 1 - Math.abs(this.noise(x, y, z));
      n *= n;
      n *= weight;
      weight = Math.min(1, n * 1.6);
      sum += amp * n;
      norm += amp;
      x = x * 2.1 + 5.3;
      y = y * 2.1 + 11.9;
      z = z * 2.1 + 2.1;
      amp *= 0.5;
    }
    return sum / norm;
  }
}

/** A seeded random stream with the helpers geometry builders keep reaching for. */
export class Random {
  readonly next: Rng;
  constructor(seed: number) {
    this.next = mulberry32(seed);
  }
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.next();
  }
  /** Symmetric: −r…r. */
  spread(r: number): number {
    return (this.next() * 2 - 1) * r;
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Hermite step, as in GLSL. */
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

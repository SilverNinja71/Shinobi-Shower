import * as THREE from 'three';
import { Random } from './noise.ts';

/**
 * A tileable noise texture baked once at load, so the fog layers (many of them, overlapping across
 * half the screen) pay a couple of texture fetches per pixel instead of dozens of noise hashes.
 * Channels: R broad fbm, G finer fbm, B billowy |fbm| for wisps, A fine grain.
 */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  const rng = new Random(0x0f09);
  const data = new Uint8Array(size * size * 4);
  const LATTICE = 64;
  const lattice = new Float32Array(LATTICE * LATTICE);
  const value = (period: number, u: number, v: number) => {
    // Value noise on a lattice that wraps every `period` cells, so the texture tiles seamlessly.
    const x = u * period;
    const y = v * period;
    const i = Math.floor(x);
    const j = Math.floor(y);
    const fx = x - i;
    const fy = y - j;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (a: number, b: number) => lattice[(b % period) * LATTICE + (a % period)];
    const top = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const bottom = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return top + (bottom - top) * sy;
  };
  const fbm = (base: number, octaves: number, u: number, v: number) => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * value(base << o, u, v);
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
  const channels: [number, number, boolean][] = [
    [4, 5, false],
    [8, 4, false],
    [6, 4, true],
    [32, 2, false],
  ];
  for (let c = 0; c < 4; c++) {
    for (let k = 0; k < lattice.length; k++) lattice[k] = rng.next();
    const [base, octaves, billow] = channels[c];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let n = fbm(base, octaves, x / size, y / size);
        if (billow) n = 1 - Math.abs(n * 2 - 1);
        // Stretch the contrast a little: fbm bunches up around one half.
        n = Math.min(1, Math.max(0, (n - 0.5) * 1.6 + 0.5));
        data[(y * size + x) * 4 + c] = Math.round(n * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  // One mip level per fetch: soft noise loses nothing to it, and it halves the texel reads.
  tex.minFilter = THREE.LinearMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

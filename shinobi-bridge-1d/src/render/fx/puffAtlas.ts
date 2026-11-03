import * as THREE from 'three';
import { mulberry32 } from '../../core/Rng.ts';

/** Size of one puff in the atlas (texels); the atlas holds 2 × 2 of them. */
const CELL = 64;
/** Lattice period of the noise (it tiles, so no seams anywhere in a cell). */
const PERIOD = 16;

/** Smooth 2D value noise on a tileable integer lattice, 0–1. */
function valueNoise(x: number, y: number, table: Float32Array): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number) => table[(((i % PERIOD) + PERIOD) % PERIOD) * PERIOD + (((j % PERIOD) + PERIOD) % PERIOD)];
  const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * ux;
  const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * ux;
  return a + (b - a) * uy;
}

function fbm(x: number, y: number, table: Float32Array, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * valueNoise(x, y, table);
    norm += amp;
    x = x * 2.03 + 5.2;
    y = y * 2.03 + 1.3;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * Four soft puffs of vapour in a 2 × 2 atlas (one channel: density 0–1), drawn once at startup. Each
 * is a few overlapping round billows whose sum saturates softly, broken up inside by domain-warped
 * fractal noise so it reads as a curl of steam or dust, thinning to wisps at the rim. The sprite
 * shader picks one by the particle's seed and samples it twice to light it from the moon's side.
 */
export function makePuffAtlas(): THREE.DataTexture {
  const size = CELL * 2;
  const data = new Uint8Array(size * size);
  const rng = mulberry32(0x9e3779b1);
  const table = new Float32Array(PERIOD * PERIOD);
  for (let i = 0; i < table.length; i++) table[i] = rng();

  for (let cell = 0; cell < 4; cell++) {
    const ox = (cell & 1) * CELL;
    const oy = (cell >> 1) * CELL;
    const billows: number[] = [];
    const count = 4 + Math.floor(rng() * 3);
    for (let b = 0; b < count; b++) {
      const a = rng() * Math.PI * 2;
      const d = b === 0 ? 0 : 0.15 + rng() * 0.25;
      billows.push(Math.cos(a) * d, Math.sin(a) * d, b === 0 ? 0.55 : 0.3 + rng() * 0.2);
    }
    const shift = rng() * PERIOD;
    for (let j = 0; j < CELL; j++) {
      for (let i = 0; i < CELL; i++) {
        // −1..1 across the cell.
        const x = ((i + 0.5) / CELL) * 2 - 1;
        const y = ((j + 0.5) / CELL) * 2 - 1;
        // Warp the coordinates a little, so the outline curls.
        const wx = x + (fbm(x * 1.6 + shift, y * 1.6, table, 2) - 0.5) * 0.35;
        const wy = y + (fbm(x * 1.6, y * 1.6 + shift + 3.1, table, 2) - 0.5) * 0.35;
        let body = 0;
        for (let b = 0; b < billows.length; b += 3) {
          const dx = wx - billows[b];
          const dy = wy - billows[b + 1];
          const r = billows[b + 2];
          body += Math.exp(((dx * dx + dy * dy) / (r * r)) * -2.2);
        }
        body = 1 - Math.exp(-body * 1.5);
        const turb = fbm(wx * 2.8 + shift, wy * 2.8 + shift * 0.5, table, 4);
        let density = body * (0.2 + 1.0 * turb) - 0.08;
        // Fade to nothing well inside the cell, so neighbours never bleed into each other.
        const rim = Math.hypot(x, y);
        density *= Math.min(1, Math.max(0, (0.98 - rim) / 0.25));
        density = Math.min(1, Math.max(0, density));
        data[(oy + j) * size + ox + i] = Math.round(255 * density);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.name = 'VFX.puffAtlas';
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

import * as THREE from 'three';

/** Integer lattice hash to 0–1 (deterministic, seedable). */
function lattice(x: number, y: number, z: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 2147483647) ^ Math.imul(seed, 144665);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Smooth 3D value noise, 0–1. */
export function noise3(x: number, y: number, z: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fy = fade(y - iy);
  const fz = fade(z - iz);
  const x0 = lerp(lattice(ix, iy, iz, seed), lattice(ix + 1, iy, iz, seed), fx);
  const x1 = lerp(lattice(ix, iy + 1, iz, seed), lattice(ix + 1, iy + 1, iz, seed), fx);
  const x2 = lerp(lattice(ix, iy, iz + 1, seed), lattice(ix + 1, iy, iz + 1, seed), fx);
  const x3 = lerp(lattice(ix, iy + 1, iz + 1, seed), lattice(ix + 1, iy + 1, iz + 1, seed), fx);
  return lerp(lerp(x0, x1, fy), lerp(x2, x3, fy), fz);
}

/** Fractal value noise, roughly 0–1. */
export function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3(x, y, z, seed + o * 31);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/**
 * A unit icosphere pushed in and out along each vertex's direction by `radius(x, y, z)` (a function of
 * the unit direction). three's polyhedra repeat each corner per face; every copy gets the same push,
 * so the surface stays closed. Variants built at the same detail share vertex order.
 */
export function displacedIcosphere(detail: number, radius: (x: number, y: number, z: number) => number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const len = Math.hypot(x, y, z) || 1;
    const r = radius(x / len, y / len, z / len);
    p.setXYZ(i, (x / len) * r, (y / len) * r, (z / len) * r);
  }
  return g;
}

/**
 * Smooth normals across the repeated corners of a non-indexed mesh, keeping its UVs (merging vertices
 * would split them again along the UV seam and leave a lit crease).
 */
export function smoothNormals(g: THREE.BufferGeometry): void {
  g.computeVertexNormals();
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const key = (i: number) => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  const sums = new Map<string, THREE.Vector3>();
  for (let i = 0; i < p.count; i++) {
    const k = key(i);
    const s = sums.get(k) ?? new THREE.Vector3();
    // Face normals are equal per triangle; weight each by its corner's share (equal weights suffice).
    s.x += n.getX(i);
    s.y += n.getY(i);
    s.z += n.getZ(i);
    sums.set(k, s);
  }
  for (let i = 0; i < p.count; i++) {
    const s = sums.get(key(i))!.clone().normalize();
    n.setXYZ(i, s.x, s.y, s.z);
  }
  n.needsUpdate = true;
}

/** Random unit vectors, deterministic for a seed. */
export function directions(count: number, rng: () => number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i < count; i++) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    out.push(new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, z));
  }
  return out;
}

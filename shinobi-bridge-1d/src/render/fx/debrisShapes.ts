import * as THREE from 'three';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { mulberry32 } from '../../core/Rng.ts';
import type { Rng } from '../../core/Rng.ts';
import debrisSource from '../../shaders/ParticleDebris.glsl';
import type { SharedUniforms } from '../RenderContext.ts';

/** The debris shapes, as DebrisPool variants. */
export const PIECE = { SHARD: 0, SPLINTER: 1, CHUNK: 2, CHIP: 3 } as const;

type Mover = (x: number, y: number, z: number, rng: Rng) => [number, number, number];

/**
 * A unit icosahedron reshaped corner by corner. three's polyhedra repeat each corner once per face;
 * every copy of a corner moves the same way, so the surface stays closed, and every shape built this
 * way keeps the same 60 corners in the same order, so they can share one instanced draw.
 */
function reshaped(seed: number, move: Mover, crease: number): THREE.BufferGeometry {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 0);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    let to = moved.get(key);
    if (!to) {
      to = move(p.getX(i), p.getY(i), p.getZ(i), rng);
      moved.set(key, to);
    }
    p.setXYZ(i, to[0], to[1], to[2]);
  }
  return toCreasedNormals(g, crease);
}

const jitter = (rng: Rng, k: number) => (rng() * 2 - 1) * k;

/** A long sliver of ice with sharp ends. */
const shard: Mover = (x, y, z, rng) => {
  const tip = Math.abs(y) > 0.5 ? 0.25 : 1;
  return [(x * 0.34 + jitter(rng, 0.08)) * tip, y * 1.3 + jitter(rng, 0.2), (z * 0.26 + jitter(rng, 0.06)) * tip];
};

/** A thin, ragged splinter of plank. */
const splinter: Mover = (x, y, z, rng) => {
  const tip = Math.abs(y) > 0.5 ? 0.3 + rng() * 0.3 : 1;
  return [(x * 0.14 + jitter(rng, 0.03)) * tip, y * 1.5 + jitter(rng, 0.25), (z * 0.07 + jitter(rng, 0.015)) * tip];
};

/** A soft lump of packed snow. */
const chunk: Mover = (x, y, z, rng) => {
  const k = 1 + jitter(rng, 0.22);
  return [x * k, y * 0.78 * k, z * 0.92 * k];
};

/** A small angular chip (ice or wood). */
const chip: Mover = (x, y, z, rng) => {
  const k = 1 + jitter(rng, 0.25);
  return [x * 0.85 * k, y * 0.42 * k, z * 0.7 * k];
};

/** Every debris shape in one geometry: the first in position/normal, the others as position1..3. */
export function debrisGeometry(): THREE.BufferGeometry {
  const flat = THREE.MathUtils.degToRad(1);
  const shapes = [reshaped(11, shard, flat), reshaped(23, splinter, flat), reshaped(37, chunk, THREE.MathUtils.degToRad(75)), reshaped(41, chip, flat)];
  const g = shapes[0];
  for (let v = 1; v < shapes.length; v++) {
    g.setAttribute(`position${v}`, shapes[v].getAttribute('position'));
    g.setAttribute(`normal${v}`, shapes[v].getAttribute('normal'));
  }
  g.deleteAttribute('uv');
  return g;
}

/**
 * Half a hailstone, cut flat at y = 0 with the stone above: a lumpy icosphere with a few blunt spikes
 * (like the storm's stones) whose lower half is pressed onto the cut plane, which leaves a flat face
 * exactly where the cut went. `aCut` is 1 on that face.
 */
export function hailHalfGeometry(detail: number): THREE.BufferGeometry {
  const rng = mulberry32(0x5eed);
  const spikes: THREE.Vector3[] = [];
  for (let i = 0; i < 7; i++) {
    const z = rng() * 2 - 1;
    const a = rng() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    spikes.push(new THREE.Vector3(Math.cos(a) * s, Math.sin(a) * s, z));
  }
  const heights = spikes.map(() => 0.15 + rng() * 0.3);
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  const dir = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    dir.set(p.getX(i), p.getY(i), p.getZ(i)).normalize();
    let r = 0.8 + 0.07 * Math.sin(dir.x * 5.1 + 1.3) * Math.sin(dir.y * 4.3 + 0.7) * Math.sin(dir.z * 4.7 + 2.1);
    for (let k = 0; k < spikes.length; k++) {
      const d = dir.dot(spikes[k]);
      if (d > 0.88) r += heights[k] * ((d - 0.88) / 0.12) ** 1.3;
    }
    p.setXYZ(i, dir.x * r, Math.max(0, dir.y * r), dir.z * r);
  }
  const cut = new Float32Array(p.count);
  for (let f = 0; f < p.count; f += 3) {
    const flatFace = p.getY(f) === 0 && p.getY(f + 1) === 0 && p.getY(f + 2) === 0;
    cut[f] = cut[f + 1] = cut[f + 2] = flatFace ? 1 : 0;
  }
  const out = toCreasedNormals(g, THREE.MathUtils.degToRad(35));
  out.setAttribute('aCut', new THREE.BufferAttribute(cut, 1));
  out.deleteAttribute('uv');
  return out;
}

/** Splits a GLSL file into its "// @@name" sections. */
function sections(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  const parts = source.split(/^\/\/ @@([\w-]+)[^\n]*$/m);
  for (let i = 1; i < parts.length; i += 2) out[parts[i]] = parts[i + 1];
  return out;
}

const DEBRIS = sections(debrisSource);

/**
 * The debris material: MeshStandardMaterial with ParticleDebris.glsl spliced in (variant shapes,
 * per-piece roughness, icy rims, glow). `halfStone` builds the split-hailstone version.
 */
export function debrisMaterial(uniforms: SharedUniforms, halfStone: boolean): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, envMapIntensity: halfStone ? 1.4 : 1 });
  if (halfStone) material.defines = { HAIL_HALF: '' };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uLightning = uniforms.uLightning;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${DEBRIS['vertex-common']}`)
      .replace('#include <beginnormal_vertex>', DEBRIS['vertex-normal'])
      .replace('#include <begin_vertex>', DEBRIS['vertex-position']);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${DEBRIS['fragment-common']}`)
      .replace('#include <roughnessmap_fragment>', DEBRIS['fragment-rough'])
      .replace('#include <opaque_fragment>', `${DEBRIS['fragment-final']}\n#include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => (halfStone ? 'vfx-hail-half' : 'vfx-debris');
  return material;
}

import * as THREE from 'three';
import mistFrag from '../../shaders/Mist.frag';
import mistVert from '../../shaders/Mist.vert';
import { fbm3 } from './lumpGeometry.ts';
import { particleBatches, particleDefines, spriteQuad, stormMaterial, wrapTravel } from './StormMaterial.ts';
import type { Shared } from './StormMaterial.ts';

/** Narrow enough that most banks are in view at once: each one costs a lot of fill. */
const HALF_X = 22;
const Y: [number, number] = [-9, 7];
/** Wisps in front of the bridge stay well clear of the lens; long banks hang behind it. */
const FRONT_Z: [number, number] = [4, 10];
const BACK_Z: [number, number] = [-26, -4];
/** Every this-many-th bank is a front wisp. */
const FRONT_EVERY = 4;
const NOISE_SIZE = 128;

/**
 * Tiling fractal noise for the mist, made once: two octaves in the red and green channels. Four copies
 * of the noise, shifted by a whole tile and cross-faded across it, make the texture repeat seamlessly.
 */
function mistNoise(): THREE.DataTexture {
  const data = new Uint8Array(NOISE_SIZE * NOISE_SIZE * 4);
  const tile = (u: number, v: number, cells: number, seed: number) => {
    // Sampling a 4D torus would be exact; the cross-fade softens contrast a little, which mist forgives.
    const x = u * cells;
    const y = v * cells;
    const a = fbm3(x, y, 0.5, seed, 4);
    const b = fbm3(x - cells, y, 0.5, seed, 4);
    const c = fbm3(x, y - cells, 0.5, seed, 4);
    const d = fbm3(x - cells, y - cells, 0.5, seed, 4);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  for (let j = 0; j < NOISE_SIZE; j++) {
    for (let i = 0; i < NOISE_SIZE; i++) {
      const u = i / NOISE_SIZE;
      const v = j / NOISE_SIZE;
      const k = (j * NOISE_SIZE + i) * 4;
      data[k] = Math.round(255 * Math.min(1, Math.max(0, (tile(u, v, 4, 3) - 0.2) / 0.6)));
      data[k + 1] = Math.round(255 * Math.min(1, Math.max(0, (tile(u, v, 8, 9) - 0.2) / 0.6)));
      data[k + 2] = 0;
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, NOISE_SIZE, NOISE_SIZE, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Mist fronts: drifting translucent banks around the bridge and in front of the camera (Mist.vert/
 * .frag), thickening with uMist. The fine drizzle that comes with them is a RainField.
 */
export class MistBanks {
  readonly mesh: THREE.Mesh;
  private readonly uDrift = { value: 0 };
  private readonly uBoxMin = { value: new THREE.Vector3(-HALF_X, Y[0], 0) };
  private readonly uBoxSize = { value: new THREE.Vector3(HALF_X * 2, Y[1] - Y[0], 1) };
  private readonly uStrength = { value: 0 };
  private drift = 0;

  constructor(scene: THREE.Scene, count: number, shared: { time: Shared<number>; lightning: Shared<number>; viewport: Shared<THREE.Vector2> }) {
    const geometry = particleBatches(spriteQuad(), count);
    const material = stormMaterial({
      vertexShader: mistVert,
      fragmentShader: mistFrag,
      defines: { ...particleDefines(count), FRONT_EVERY: FRONT_EVERY.toFixed(1) },
      uniforms: {
        uBoxMin: this.uBoxMin,
        uBoxSize: this.uBoxSize,
        uFrontZ: { value: new THREE.Vector2(...FRONT_Z) },
        uBackZ: { value: new THREE.Vector2(...BACK_Z) },
        uDrift: this.uDrift,
        uStrength: this.uStrength,
        uTime: shared.time,
        uLightning: shared.lightning,
        uViewport: shared.viewport,
        uNoise: { value: mistNoise() },
        uColor: { value: new THREE.Color(0.13, 0.155, 0.2) },
      },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt: number, wind: number, strength: number, cameraX: number): void {
    // Banks drift with the wind, and creep along a little even in a calm.
    this.drift = wrapTravel(this.drift + (wind * 0.8 + 0.25) * dt, this.uBoxSize.value.x);
    this.uDrift.value = this.drift;
    this.uBoxMin.value.x = cameraX - HALF_X;
    this.uStrength.value = strength;
    this.mesh.visible = strength > 0.003;
  }
}

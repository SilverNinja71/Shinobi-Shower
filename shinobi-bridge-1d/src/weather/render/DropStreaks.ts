import * as THREE from 'three';
import { worldX } from '../../render/RenderContext.ts';
import streakFrag from '../../shaders/StormStreak.frag';
import streakVert from '../../shaders/StormStreak.vert';
import type { Drop } from '../PrecipitationDroplet.ts';
import { stormMaterial, streakQuad } from './StormMaterial.ts';
import type { Shared } from './StormMaterial.ts';

const KIND_RAIN = 0;
const KIND_GLINT = 1;
const KIND_TRAIL = 2;

/**
 * The gameplay drops that streak: rain as bright screen-aligned quads along its velocity, mist as tiny
 * twinkling glints, and a cold smear behind each hailstone. One InstancedMesh; the instance matrix
 * carries each head (only its translation is written) and two attributes the velocity and look.
 */
export class DropStreaks {
  readonly mesh: THREE.InstancedMesh;
  private readonly matrices: Float32Array;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly look: THREE.InstancedBufferAttribute;
  private readonly buffers: THREE.BufferAttribute[];
  private readonly capacity: number;
  private n = 0;

  constructor(scene: THREE.Scene, capacity: number, shared: { time: Shared<number>; lightning: Shared<number>; viewport: Shared<THREE.Vector2> }) {
    this.capacity = capacity;
    const geometry = streakQuad();
    this.vel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.look = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('aVel', this.vel);
    geometry.setAttribute('aLook', this.look);
    const material = stormMaterial({
      vertexShader: streakVert,
      fragmentShader: streakFrag,
      uniforms: {
        uTime: shared.time,
        uLightning: shared.lightning,
        uViewport: shared.viewport,
        // Cyan-white, well past the cosmetic rain, so bloom gives the threats a halo.
        uRainColor: { value: new THREE.Color(0.8, 0.95, 1.25).multiplyScalar(2.6) },
        uGlintColor: { value: new THREE.Color(0.85, 0.95, 1.1).multiplyScalar(2.2) },
        uTrailColor: { value: new THREE.Color(0.45, 0.6, 0.85).multiplyScalar(0.55) },
      },
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.matrices = this.mesh.instanceMatrix.array as Float32Array;
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.buffers = [this.mesh.instanceMatrix, this.vel, this.look];
    scene.add(this.mesh);
  }

  begin(): void {
    this.n = 0;
  }

  private push(x: number, y: number, z: number, vx: number, vy: number, kind: number, width: number, length: number, brightness: number, phase: number): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    // Identity everywhere else was written when the mesh was made; only the translation changes.
    this.matrices[i * 16 + 12] = x;
    this.matrices[i * 16 + 13] = y;
    this.matrices[i * 16 + 14] = z;
    const v = this.vel.array as Float32Array;
    v[i * 4] = vx;
    v[i * 4 + 1] = vy;
    v[i * 4 + 2] = 0;
    v[i * 4 + 3] = kind;
    const l = this.look.array as Float32Array;
    l[i * 4] = width;
    l[i * 4 + 1] = length;
    l[i * 4 + 2] = brightness;
    l[i * 4 + 3] = phase;
  }

  rain(d: Drop): void {
    const speed = Math.hypot(d.vx, d.vy);
    this.push(worldX(d.x), d.y, d.z, d.vx, d.vy, KIND_RAIN, 0.03, Math.min(1.4, speed * 0.03), 1, d.phase);
  }

  glint(d: Drop): void {
    const speed = Math.hypot(d.vx, d.vy);
    this.push(worldX(d.x), d.y, d.z, d.vx, d.vy, KIND_GLINT, 0.03, 0.05 + speed * 0.03, 0.85, d.phase);
  }

  /** A smear behind a falling hailstone, from its centre back along its fall. */
  trail(d: Drop): void {
    const speed = Math.hypot(d.vx, d.vy);
    if (speed < 3) return;
    this.push(worldX(d.x), d.y, d.z, d.vx, d.vy, KIND_TRAIL, d.r * 1.3, Math.min(2.2, speed * 0.13), Math.min(1, (speed - 3) / 6), 0);
  }

  end(): void {
    const n = this.n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    for (const a of this.buffers) {
      a.updateRange.offset = 0;
      a.updateRange.count = n * a.itemSize;
      a.needsUpdate = n > 0;
    }
  }
}

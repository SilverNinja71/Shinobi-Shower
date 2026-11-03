import * as THREE from 'three';
import fragmentShader from '../../shaders/FlameParticles.frag';
import vertexShader from '../../shaders/FlameParticles.vert';
import { additiveMaterial } from './FxMaterial.ts';

/**
 * Real-time fire for the ember-etched blade: a ring buffer of flame licks emitted from the edge and
 * animated entirely on the GPU. The CPU only writes each new lick's birth (a handful per frame).
 */
export class FlameParticles {
  readonly mesh: THREE.Mesh;
  readonly heat: { value: number };
  private readonly spawn: THREE.InstancedBufferAttribute;
  private readonly motion: THREE.InstancedBufferAttribute;
  private readonly capacity: number;
  private next = 0;
  private dirtyFrom = -1;

  constructor(capacity: number, time: { value: number }, wind: { value: number }) {
    this.capacity = capacity;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.getAttribute('position'));
    const spawn = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) spawn[i * 4 + 3] = -1e4;
    const motion = new Float32Array(capacity * 4).fill(1);
    const seeds = new Float32Array(capacity);
    for (let i = 0; i < capacity; i++) seeds[i] = (i * 0.618034) % 1;
    this.spawn = new THREE.InstancedBufferAttribute(spawn, 4).setUsage(THREE.DynamicDrawUsage);
    this.motion = new THREE.InstancedBufferAttribute(motion, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aSpawn', this.spawn);
    g.setAttribute('aMotion', this.motion);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    g.instanceCount = capacity;
    this.heat = { value: 0 };
    const material = additiveMaterial(vertexShader, fragmentShader, { uTime: time, uWind: wind, uSize: { value: 0.07 }, uHeat: this.heat });
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.renderOrder = 6;
  }

  /** Births one lick at `p` (world), moving at `v`, living `life` seconds from `time`. */
  emit(p: THREE.Vector3, v: THREE.Vector3, life: number, time: number): void {
    const i = this.next;
    this.next = (this.next + 1) % this.capacity;
    const s = this.spawn.array as Float32Array;
    const m = this.motion.array as Float32Array;
    s[i * 4] = p.x;
    s[i * 4 + 1] = p.y;
    s[i * 4 + 2] = p.z;
    s[i * 4 + 3] = time;
    m[i * 4] = v.x;
    m[i * 4 + 1] = v.y;
    m[i * 4 + 2] = v.z;
    m[i * 4 + 3] = life;
    this.dirtyFrom = 0;
  }

  /** Uploads this frame's births. */
  flush(): void {
    if (this.dirtyFrom < 0) return;
    this.spawn.needsUpdate = true;
    this.motion.needsUpdate = true;
    this.dirtyFrom = -1;
  }

  /** Kills every lick at once (when the blade is put away). */
  clear(): void {
    const s = this.spawn.array as Float32Array;
    for (let i = 0; i < this.capacity; i++) s[i * 4 + 3] = -1e4;
    this.spawn.needsUpdate = true;
  }
}

import * as THREE from 'three';
import capeGlsl from '../../shaders/CapeCloth.glsl';
import { VerletBody } from './Verlet.ts';
import type { Capsule } from './Verlet.ts';
import { shadeWarrior } from './WarriorShading.ts';
import type { WarriorUniforms } from './WarriorShading.ts';

export interface CapeAnchor {
  bone: THREE.Object3D;
  /** Points across the shoulders, left to right, in the bone's space. */
  local: THREE.Vector3[];
}

/**
 * The Apex Sovereign's crimson cape: a Verlet cloth grid pinned along the shoulders, pushed by the
 * crosswind (uniforms.uWind) and dragged by the warrior's own motion, kept out of the body by
 * capsules and above the deck. Drawn as one double-sided mesh whose vertices follow the cloth.
 */
export class CrimsonCape {
  readonly mesh: THREE.Mesh;
  private readonly cloth: VerletBody;
  private readonly cols: number;
  private readonly rows: number;
  private readonly length: number;
  private readonly anchor: CapeAnchor;
  private readonly position: THREE.BufferAttribute;
  private readonly at = new THREE.Vector3();
  private placed = false;

  constructor(anchor: CapeAnchor, low: boolean, u: WarriorUniforms, colliders: Capsule[]) {
    this.anchor = anchor;
    this.cols = anchor.local.length;
    this.rows = low ? 8 : 13;
    this.length = 1.22;
    const n = this.cols * this.rows;
    const cloth = new VerletBody(n, n * 6);
    const seg = this.length / (this.rows - 1);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const p = anchor.local[c];
        cloth.place(r * this.cols + c, p.x, p.y - r * seg, p.z);
      }
    }
    const id = (r: number, c: number) => r * this.cols + c;
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        // The hem spreads a little wider than the shoulders.
        const spread = 1 + (r / (this.rows - 1)) * 0.35;
        if (c + 1 < this.cols) cloth.link(id(r, c), id(r, c + 1), anchor.local[c].distanceTo(anchor.local[c + 1]) * spread);
        if (r + 1 < this.rows) cloth.link(id(r, c), id(r + 1, c), seg);
        if (r + 2 < this.rows) cloth.link(id(r, c), id(r + 2, c), seg * 2);
        if (c + 1 < this.cols && r + 1 < this.rows) {
          const w = anchor.local[c].distanceTo(anchor.local[c + 1]) * spread;
          cloth.link(id(r, c), id(r + 1, c + 1), Math.hypot(w, seg));
          cloth.link(id(r, c + 1), id(r + 1, c), Math.hypot(w, seg));
        }
      }
    }
    // Gusts ripple down from the shoulders and across the back, shaking the hem hardest.
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        cloth.phase[id(r, c)] = r * 0.62 + c * 0.38;
        cloth.flutter[id(r, c)] = Math.pow(r / (this.rows - 1), 1.3);
      }
    }
    cloth.gravity = -9.8;
    cloth.windGain = 2.4;
    cloth.drag = 0.025;
    cloth.iterations = low ? 3 : 6;
    cloth.colliders.push(...colliders);
    this.cloth = cloth;

    const g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(n * 2);
    for (let r = 0; r < this.rows; r++) for (let c = 0; c < this.cols; c++) uv.set([c / (this.cols - 1), 1 - r / (this.rows - 1)], id(r, c) * 2);
    const index: number[] = [];
    for (let r = 0; r < this.rows - 1; r++) {
      for (let c = 0; c < this.cols - 1; c++) index.push(id(r, c), id(r + 1, c), id(r + 1, c + 1), id(r, c), id(r + 1, c + 1), id(r, c + 1));
    }
    g.setAttribute('position', this.position);
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(index);
    const material = shadeWarrior(
      new THREE.MeshStandardMaterial({ color: 0x7a0d14, roughness: 0.78, side: THREE.DoubleSide }),
      u,
      { key: 'cape', wet: 0.9, snow: true, main: capeGlsl },
    );
    material.defines = { ...material.defines, USE_UV: '' };
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.castShadow = !low;
  }

  reset(): void {
    this.placed = false;
  }

  /**
   * `side` is the rig's mirror (±1). The side view mirrors the body when it faces −x, which swaps
   * its shoulders in the world; reading the pins in reverse order then keeps every column of cloth
   * on the same side of the world, so a turn never twists the cape.
   */
  update(dt: number, wind: number, time: number, floor: number, side: number): void {
    const cloth = this.cloth;
    const a = this.anchor;
    const seg = this.length / (this.rows - 1);
    for (let c = 0; c < this.cols; c++) {
      this.at.copy(a.local[side > 0 ? c : this.cols - 1 - c]).applyMatrix4(a.bone.matrixWorld);
      if (!this.placed) for (let r = 0; r < this.rows; r++) cloth.place(r * this.cols + c, this.at.x, this.at.y - r * seg, this.at.z - r * 0.04);
      cloth.pin(c, this.at.x, this.at.y, this.at.z);
    }
    this.placed = true;
    cloth.floor = floor;
    cloth.update(dt, wind, 0, 0, time, 1.8 + Math.abs(wind) * 0.45);
    (this.position.array as Float32Array).set(cloth.pos);
    this.position.needsUpdate = true;
    this.gridNormals(cloth.pos);
  }

  /** Normals of the cloth grid from neighbouring points (central differences), without allocating. */
  private gridNormals(p: Float32Array): void {
    const n = this.mesh.geometry.getAttribute('normal') as THREE.BufferAttribute;
    const out = n.array as Float32Array;
    const cols = this.cols;
    for (let r = 0; r < this.rows; r++) {
      const r0 = Math.max(0, r - 1);
      const r1 = Math.min(this.rows - 1, r + 1);
      for (let c = 0; c < cols; c++) {
        const c0 = Math.max(0, c - 1);
        const c1 = Math.min(cols - 1, c + 1);
        const a = (r * cols + c1) * 3;
        const b = (r * cols + c0) * 3;
        const d = (r1 * cols + c) * 3;
        const e = (r0 * cols + c) * 3;
        // Across (u) × down (v), matching the triangles' winding.
        const ux = p[a] - p[b];
        const uy = p[a + 1] - p[b + 1];
        const uz = p[a + 2] - p[b + 2];
        const vx = p[d] - p[e];
        const vy = p[d + 1] - p[e + 1];
        const vz = p[d + 2] - p[e + 2];
        let nx = vy * uz - vz * uy;
        let ny = vz * ux - vx * uz;
        let nz = vx * uy - vy * ux;
        const l = Math.hypot(nx, ny, nz) || 1;
        nx /= l;
        ny /= l;
        nz /= l;
        const k = (r * cols + c) * 3;
        out[k] = nx;
        out[k + 1] = ny;
        out[k + 2] = nz;
      }
    }
    n.needsUpdate = true;
  }
}

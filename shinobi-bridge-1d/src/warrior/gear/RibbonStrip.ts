import * as THREE from 'three';

/**
 * Camera-facing ribbons built from polylines every frame, into preallocated buffers: each point
 * becomes two vertices spread across the line, perpendicular to both the line and the view.
 * `aStrip` carries (along 0 → 1, across 0 / 1, the line's seed, width scale) to the shader.
 * All lines share one geometry, so a whole family of ribbons is one draw call.
 */
export class RibbonStrip {
  readonly mesh: THREE.Mesh;
  private readonly position: THREE.BufferAttribute;
  private readonly strip: THREE.BufferAttribute;
  private readonly index: THREE.BufferAttribute;
  private readonly capacity: number;
  private vertices = 0;
  private indices = 0;
  private readonly cam = new THREE.Vector3();
  private readonly t = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly side = new THREE.Vector3();

  constructor(material: THREE.Material, capacity: number) {
    this.capacity = capacity;
    const g = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(capacity * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.strip = new THREE.BufferAttribute(new Float32Array(capacity * 2 * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.index = new THREE.BufferAttribute(new Uint16Array(capacity * 6), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.position);
    g.setAttribute('aStrip', this.strip);
    g.setIndex(this.index);
    g.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.matrixAutoUpdate = false;
  }

  begin(camera: THREE.Camera): void {
    this.vertices = 0;
    this.indices = 0;
    this.cam.setFromMatrixPosition(camera.matrixWorld);
  }

  /**
   * Adds a polyline of `count` points (xyz triples in `points`, from `offset`). Width runs from
   * `w0` at the first point to `w1` at the last.
   */
  line(points: Float32Array, count: number, w0: number, w1: number, seed: number, offset = 0): void {
    if (count < 2 || this.vertices / 2 + count > this.capacity) return;
    const pos = this.position.array as Float32Array;
    const st = this.strip.array as Float32Array;
    const idx = this.index.array as Uint16Array;
    const first = this.vertices;
    for (let i = 0; i < count; i++) {
      const k = offset + i * 3;
      const a = Math.max(0, i - 1);
      const b = Math.min(count - 1, i + 1);
      this.t.set(points[offset + b * 3] - points[offset + a * 3], points[offset + b * 3 + 1] - points[offset + a * 3 + 1], points[offset + b * 3 + 2] - points[offset + a * 3 + 2]);
      this.v.set(this.cam.x - points[k], this.cam.y - points[k + 1], this.cam.z - points[k + 2]);
      this.side.crossVectors(this.t, this.v);
      const len = this.side.length();
      if (len > 1e-6) this.side.multiplyScalar(1 / len);
      else this.side.set(0, 1, 0);
      const f = i / (count - 1);
      const w = (w0 + (w1 - w0) * f) * 0.5;
      const o = this.vertices * 3;
      pos[o] = points[k] - this.side.x * w;
      pos[o + 1] = points[k + 1] - this.side.y * w;
      pos[o + 2] = points[k + 2] - this.side.z * w;
      pos[o + 3] = points[k] + this.side.x * w;
      pos[o + 4] = points[k + 1] + this.side.y * w;
      pos[o + 5] = points[k + 2] + this.side.z * w;
      const s = this.vertices * 4;
      st[s] = f;
      st[s + 1] = 0;
      st[s + 2] = seed;
      st[s + 3] = w;
      st[s + 4] = f;
      st[s + 5] = 1;
      st[s + 6] = seed;
      st[s + 7] = w;
      if (i > 0) {
        const p = first + (i - 1) * 2;
        const n = this.indices;
        idx[n] = p;
        idx[n + 1] = p + 1;
        idx[n + 2] = p + 2;
        idx[n + 3] = p + 1;
        idx[n + 4] = p + 3;
        idx[n + 5] = p + 2;
        this.indices += 6;
      }
      this.vertices += 2;
    }
  }

  end(): void {
    this.position.needsUpdate = true;
    this.strip.needsUpdate = true;
    this.index.needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.indices);
    this.mesh.visible = this.indices > 0;
  }
}

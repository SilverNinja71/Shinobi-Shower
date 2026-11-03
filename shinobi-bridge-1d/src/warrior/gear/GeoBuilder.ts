import * as THREE from 'three';

/**
 * Accumulates hand-built and primitive geometry into one buffer, painting each vertex with a colour,
 * a metalness/roughness pair and a free `aInfo` vector. One gear mesh can then mix lacquer, gold,
 * leather and cloth in a single draw call (see `makeGearMaterial`).
 */
export class GeoBuilder {
  private readonly pos: number[] = [];
  private readonly nor: number[] = [];
  private readonly uv: number[] = [];
  private readonly col: number[] = [];
  private readonly pbr: number[] = [];
  private readonly info: number[] = [];
  private readonly idx: number[] = [];
  /** Current paint for new vertices. */
  readonly color = new THREE.Color(1, 1, 1);
  metal = 0;
  rough = 0.6;
  readonly infoValue = new THREE.Vector3();
  private readonly v = new THREE.Vector3();
  private readonly n = new THREE.Vector3();
  private readonly normalMatrix = new THREE.Matrix3();

  get count(): number {
    return this.pos.length / 3;
  }

  paint(color: THREE.ColorRepresentation, metal: number, rough: number, info?: [number, number, number]): this {
    this.color.set(color);
    this.metal = metal;
    this.rough = rough;
    if (info) this.infoValue.set(info[0], info[1], info[2]);
    return this;
  }

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u = 0, v = 0): number {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(this.color.r, this.color.g, this.color.b);
    this.pbr.push(this.metal, this.rough);
    this.info.push(this.infoValue.x, this.infoValue.y, this.infoValue.z);
    return this.count - 1;
  }

  /** Sets the info vector of the last vertex (for per-vertex data such as along/edge). */
  setInfo(i: number, x: number, y: number, z: number): void {
    this.info[i * 3] = x;
    this.info[i * 3 + 1] = y;
    this.info[i * 3 + 2] = z;
  }

  tri(a: number, b: number, c: number): void {
    this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number): void {
    this.idx.push(a, b, c, a, c, d);
  }

  /**
   * Merges geometry, transformed by `matrix`. Vertices keep their own paint when the geometry has
   * it (another builder's output); plain primitives take the current paint.
   */
  add(geometry: THREE.BufferGeometry, matrix?: THREE.Matrix4): this {
    const g = geometry;
    const p = g.getAttribute('position');
    const nrm = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    const col = g.getAttribute('color');
    const pbr = g.getAttribute('aPbr');
    const info = g.getAttribute('aInfo');
    const keep = col && pbr && info;
    if (matrix) this.normalMatrix.getNormalMatrix(matrix);
    const base = this.count;
    for (let i = 0; i < p.count; i++) {
      this.v.fromBufferAttribute(p, i);
      this.n.fromBufferAttribute(nrm, i);
      if (matrix) {
        this.v.applyMatrix4(matrix);
        this.n.applyMatrix3(this.normalMatrix).normalize();
      }
      const k = this.vertex(this.v.x, this.v.y, this.v.z, this.n.x, this.n.y, this.n.z, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0);
      if (keep) {
        this.col[k * 3] = col.getX(i);
        this.col[k * 3 + 1] = col.getY(i);
        this.col[k * 3 + 2] = col.getZ(i);
        this.pbr[k * 2] = pbr.getX(i);
        this.pbr[k * 2 + 1] = pbr.getY(i);
        this.setInfo(k, info.getX(i), info.getY(i), info.getZ(i));
      }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) this.idx.push(base + g.index.getX(i));
    } else {
      for (let i = 0; i < p.count; i++) this.idx.push(base + i);
    }
    geometry.dispose();
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPbr', new THREE.Float32BufferAttribute(this.pbr, 2));
    g.setAttribute('aInfo', new THREE.Float32BufferAttribute(this.info, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Matrix helper: translation, Euler rotation (XYZ) and scale in one call. */
export function mat(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(sx, sy, sz),
  );
}

import * as THREE from 'three';

/**
 * Parametric cloth shapes in the torso's own frame (x toward the warrior's left, y up from the deck,
 * z forward), later moved onto the rest pose and skinned. Angle θ is measured from straight ahead
 * toward the left: a point is (sin θ · rx, y, cos θ · rz + z).
 */

export interface Ring {
  y: number;
  rx: number;
  rz: number;
  /** Forward offset of the ring's centre. */
  z?: number;
}

export interface DrapeOptions {
  around: number;
  /** Angular span (radians), for open-front coats; default the full circle. */
  from?: number;
  to?: number;
  /** Rings interpolated between each pair of control rings. */
  subdiv?: number;
  /** Extra drop of the hem at angle θ (negative lowers it), faded in toward the bottom. */
  hem?: (theta: number) => number;
  /** Depth of vertical folds, growing toward the hem (fraction of the radius). */
  folds?: number;
  foldCount?: number;
  seed?: number;
}

const catmull = (p0: number, p1: number, p2: number, p3: number, t: number) =>
  0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);

/** A draped surface of revolution: collar at the top ring, hem at the last. UV v runs 1 (top) → 0 (hem). */
export function drape(rings: Ring[], o: DrapeOptions): THREE.BufferGeometry {
  const sub = o.subdiv ?? 3;
  const from = o.from ?? 0;
  const to = o.to ?? Math.PI * 2;
  const closed = o.from === undefined && o.to === undefined;
  const around = o.around;
  const rows: Ring[] = [];
  for (let i = 0; i < rings.length - 1; i++) {
    const r0 = rings[Math.max(0, i - 1)];
    const r1 = rings[i];
    const r2 = rings[i + 1];
    const r3 = rings[Math.min(rings.length - 1, i + 2)];
    for (let s = 0; s < sub; s++) {
      const t = s / sub;
      rows.push({
        y: catmull(r0.y, r1.y, r2.y, r3.y, t),
        rx: catmull(r0.rx, r1.rx, r2.rx, r3.rx, t),
        rz: catmull(r0.rz, r1.rz, r2.rz, r3.rz, t),
        z: catmull(r0.z ?? 0, r1.z ?? 0, r2.z ?? 0, r3.z ?? 0, t),
      });
    }
  }
  rows.push({ ...rings[rings.length - 1], z: rings[rings.length - 1].z ?? 0 });
  const cols = around + 1;
  const pos = new Float32Array(rows.length * cols * 3);
  const uv = new Float32Array(rows.length * cols * 2);
  const folds = o.folds ?? 0;
  const foldCount = o.foldCount ?? 9;
  const seed = o.seed ?? 0.7;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const v = i / (rows.length - 1);
    for (let j = 0; j < cols; j++) {
      const u = j / around;
      const theta = from + (to - from) * u;
      const fold = 1 + folds * v * (Math.sin(theta * foldCount + seed) * 0.7 + Math.sin(theta * foldCount * 2.3 + seed * 3.1) * 0.3);
      const drop = o.hem ? o.hem(theta) * v * v : 0;
      const k = (i * cols + j) * 3;
      pos[k] = Math.sin(theta) * r.rx * fold;
      pos[k + 1] = r.y + drop;
      pos[k + 2] = Math.cos(theta) * r.rz * fold + (r.z ?? 0);
      uv[(i * cols + j) * 2] = u;
      uv[(i * cols + j) * 2 + 1] = 1 - v;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < rows.length - 1; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols + 1;
      const d = a + cols;
      // Wound so normals face outward (θ runs left-to-right seen from outside, rows run down).
      index.push(a, c, b, a, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  if (closed) seamNormals(g, rows.length, cols);
  return g;
}

/** Averages the normals across the u = 0 / u = 1 seam of a closed drape, so no crease shows. */
function seamNormals(g: THREE.BufferGeometry, rows: number, cols: number): void {
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < rows; i++) {
    const a = i * cols;
    const b = a + cols - 1;
    const x = n.getX(a) + n.getX(b);
    const y = n.getY(a) + n.getY(b);
    const z = n.getZ(a) + n.getZ(b);
    const l = Math.hypot(x, y, z) || 1;
    n.setXYZ(a, x / l, y / l, z / l);
    n.setXYZ(b, x / l, y / l, z / l);
  }
}

/** Gives any geometry GeoBuilder's paint attributes, so it can merge with painted gear. */
export function painted(g: THREE.BufferGeometry, color: THREE.ColorRepresentation, metal: number, rough: number, info: [number, number, number] = [0, 0, 0]): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const pbr = new Float32Array(n * 2);
  const inf = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col.set([c.r, c.g, c.b], i * 3);
    pbr.set([metal, rough], i * 2);
    inf.set(info, i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aPbr', new THREE.BufferAttribute(pbr, 2));
  g.setAttribute('aInfo', new THREE.BufferAttribute(inf, 3));
  if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  return g;
}

/** A basis matrix whose z axis points along `dir` and whose y axis leans toward `up`. */
export function aim(origin: THREE.Vector3, dir: THREE.Vector3, up = new THREE.Vector3(0, 1, 0)): THREE.Matrix4 {
  const z = dir.clone().normalize();
  const y = up.clone().addScaledVector(z, -up.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(origin);
}

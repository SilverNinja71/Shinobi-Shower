import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeWetMaterial } from '../../render/Assets.ts';
import type { RenderContext, SharedUniforms } from '../../render/RenderContext.ts';
import type { EnvUniforms } from './EnvUniforms.ts';
import { Noise3, Random, smoothstep } from './noise.ts';
import { PALETTE, RENDER_ORDER } from './palette.ts';
import { RockBuilder } from './RockBuilder.ts';

/**
 * The two peaks of wet black slate the bridge hangs between.
 *
 * Each peak is built in its own frame, where `xl` is the distance outward from the gorge's centre
 * line (world x = side × xl), so the inner wall the deck meets stands at xl = 18:
 *   - a continuous core: a rounded-rectangle footprint extruded down into the gorge (widening as it
 *     goes, the inner wall leaning in), pushed in and out by ribs, gullies and stepped strata, with
 *     an undercut beneath the ledge; capped by a heightfield with the exact flat ledge for the posts;
 *   - flat-shaded slabs of slate layered over the walls the camera can see, so faces read as stacked,
 *     fractured bedding planes with crisp edges;
 *   - plates, fins and boulders on top, giving the summits their jagged skyline.
 */

/** The deck meets the rock at |x| = 18, y = 0. */
const ANCHOR_X = 18;
/** The flat ledge the anchor posts stand on (local frame). */
const LEDGE = { x0: ANCHOR_X, x1: 21.4, z0: -3.4, z1: 3.4, y: -0.05, blend: 1.4 };
/** Rock stays out of this space beside the deck so the deck, posts and ropes have room. */
const CLEAR = { x: 20.2, z: 2.4, y: -3.8 };
const BOTTOM = -215;
const STRATUM = 3.4;

interface PeakSpec {
  side: -1 | 1;
  seed: number;
  /** Footprint extent outward from the inner wall, and front/back z, at the top. */
  width: number;
  front: number;
  back: number;
  radius: number;
  summit: { x: number; z: number; h: number; rx: number; rz: number };
}

/**
 * Each summit rises beside its anchor and a little behind it, so it towers over the ledge at the
 * edge of the frame, while the top falls away behind: the gorge walls behind the bridge stay below
 * the deck and the far ranges stay in view.
 */
const PEAKS: PeakSpec[] = [
  { side: -1, seed: 11, width: 40, front: 8, back: -38, radius: 9, summit: { x: 30, z: -6, h: 16, rx: 6, rz: 6.5 } },
  { side: 1, seed: 23, width: 38, front: 7, back: -42, radius: 10, summit: { x: 29.5, z: -8, h: 13, rx: 5.5, rz: 7 } },
];

interface Footprint {
  xi: number;
  xo: number;
  zf: number;
  zb: number;
  r: number;
  length: number;
}

interface PerimeterPoint {
  x: number;
  z: number;
  nx: number;
  nz: number;
}

/** The peak's cross-section at height y: it widens with depth, and its inner wall leans in. */
function footprintAt(spec: PeakSpec, y: number): Footprint {
  const g = Math.max(0, -y);
  const xi = ANCHOR_X - 0.03 * g;
  const xo = ANCHOR_X + spec.width + 0.25 * g;
  const zf = spec.front + 0.12 * g;
  const zb = spec.back - 0.2 * g;
  const r = spec.radius + 0.05 * g;
  const length = 2 * (xo - xi - 2 * r) + 2 * (zf - zb - 2 * r) + 2 * Math.PI * r;
  return { xi, xo, zf, zb, r, length };
}

/**
 * The point at fraction u (0–1) around the footprint, with its outward normal. u = 0 is the middle
 * of the inner wall; the walk goes toward the front, outward along the front face, back along the
 * outer face, along the back and home along the inner wall.
 */
function perimeter(f: Footprint, u: number, out: PerimeterPoint): void {
  const { xi, xo, zf, zb, r } = f;
  const zm = (zf + zb) / 2;
  const arc = (Math.PI * r) / 2;
  let s = (((u % 1) + 1) % 1) * f.length;
  const corner = (cx: number, cz: number, a0: number, t: number) => {
    const a = a0 - (t / arc) * (Math.PI / 2);
    out.nx = Math.cos(a);
    out.nz = Math.sin(a);
    out.x = cx + r * out.nx;
    out.z = cz + r * out.nz;
  };
  const straight = (x: number, z: number, nx: number, nz: number) => {
    out.x = x;
    out.z = z;
    out.nx = nx;
    out.nz = nz;
  };
  const inUp = zf - r - zm;
  if (s < inUp) return straight(xi, zm + s, -1, 0);
  s -= inUp;
  if (s < arc) return corner(xi + r, zf - r, Math.PI, s);
  s -= arc;
  const across = xo - xi - 2 * r;
  if (s < across) return straight(xi + r + s, zf, 0, 1);
  s -= across;
  if (s < arc) return corner(xo - r, zf - r, Math.PI / 2, s);
  s -= arc;
  const along = zf - zb - 2 * r;
  if (s < along) return straight(xo, zf - r - s, 1, 0);
  s -= along;
  if (s < arc) return corner(xo - r, zb + r, 0, s);
  s -= arc;
  if (s < across) return straight(xo - r - s, zb, 0, -1);
  s -= across;
  if (s < arc) return corner(xi + r, zb + r, -Math.PI / 2, s);
  s -= arc;
  return straight(xi, zb + r + s, -1, 0);
}

/** How much a point lies within the ledge's span along the inner wall (1 inside, 0 well outside). */
const ledgeSpan = (z: number) => 1 - smoothstep(0, 1.2, Math.max(LEDGE.z0 - z, z - LEDGE.z1, 0));

/** One peak's generator: shape functions shared by the core, the slabs and the crags. */
class Peak {
  readonly spec: PeakSpec;
  private readonly noise: Noise3;
  private readonly rng: Random;
  /** Height of the top surface along the rim, sampled per perimeter column. */
  private rim: Float32Array = new Float32Array(0);
  private readonly p: PerimeterPoint = { x: 0, z: 0, nx: 0, nz: 0 };

  constructor(spec: PeakSpec) {
    this.spec = spec;
    this.noise = new Noise3(spec.seed);
    this.rng = new Random(spec.seed * 977 + 5);
  }

  /**
   * The top surface: the flat ledge, the summit crags beside it, and slopes falling away behind
   * (steeply at first), outward and in front.
   */
  capHeight(x: number, z: number): number {
    const n = this.noise;
    const s = this.spec.summit;
    // The ledge's outline wanders (it is broken rock, not a slab); the posts' footing stays inside.
    const dx = Math.max(0, x - LEDGE.x1 - 0.7 * n.noise(z * 0.45, 1.5, 2.5));
    const dzb = Math.max(0, LEDGE.z0 - 0.6 * n.noise(x * 0.5, 4.5, 0.5) - z);
    const dzf = Math.max(0, z - LEDGE.z1 - 0.6 * n.noise(x * 0.5, 7.5, 3.5));
    const away = Math.hypot(dx, dzb, dzf);
    let h = -0.22 * dx - 0.62 * dzb * (1 - 0.35 * smoothstep(10, 35, dzb)) - dzf * (1.7 + 0.9 * n.noise(x * 0.3, 2.2, 9.1));
    // The gorge edge behind the ledge dips, so nothing looms right behind the end of the deck.
    h -= 2.6 * (1 - smoothstep(1, 7, dx)) * smoothstep(0, 4, dzb);
    h += s.h * Math.exp(-(((x - s.x) / s.rx) ** 2 + ((z - s.z) / s.rz) ** 2) * 0.5);
    // Crags: ridged noise gives knife-edge crests, growing with distance from the ledge.
    h += 3.6 * (n.ridged(x * 0.09, 3.1, z * 0.09, 4) - 0.38) * smoothstep(1, 7, away);
    const ledge = 1 - smoothstep(0, LEDGE.blend, away);
    const flat = LEDGE.y + 0.012 * n.noise(x * 1.7, 0.5, z * 1.7);
    return h + (flat - h) * ledge;
  }

  /** Outward push of the core wall at fraction u around the footprint, height y. */
  wallOffset(u: number, x: number, y: number, z: number, nx: number, rimY: number): number {
    const n = this.noise;
    let d = 3.0 * n.fbm(x * 0.028, y * 0.02, z * 0.028, 3);
    // Vertical ribs and gullies, stretched down the face.
    d += 2.4 * (n.ridged(u * 15, y * 0.013, 0.5, 3) - 0.45);
    // Strata: each bed leans out a little and steps back at the bedding plane below it.
    const phase = (y + 2.2 * n.noise(x * 0.03, 7.7, z * 0.03)) / STRATUM;
    const id = Math.floor(phase);
    d += 0.55 * (phase - id) + 0.9 * (n.noise(id * 0.71, 1.3, this.spec.seed) * 1.4);
    d += 0.3 * n.noise(x * 0.32, y * 0.32, z * 0.32);
    const below = rimY - y;
    if (nx < -0.5) {
      const span = ledgeSpan(z);
      // The rim of the ledge is a clean edge right at the anchor line, undercut beneath.
      d *= 1 - span * (1 - smoothstep(0, 0.6, below));
      d -= 1.6 * span * smoothstep(0.3, 1.3, below) * (1 - smoothstep(3.5, 7, below));
      // Nothing may push into the space under the end of the deck.
      if (Math.abs(z) < CLEAR.z && y > CLEAR.y) d = Math.min(d, 0);
    }
    return d;
  }

  /** The continuous core: wall rings from the rim down into the gorge, then the cap. */
  buildCore(columns: number): THREE.BufferGeometry {
    const spec = this.spec;
    const p = this.p;
    const top = footprintAt(spec, 0);
    // The rim's height per column decides where each wall column starts.
    this.rim = new Float32Array(columns);
    for (let i = 0; i < columns; i++) {
      perimeter(top, i / columns, p);
      this.rim[i] = this.capHeight(p.x, p.z);
    }
    // Rings crowd near the rim, where the camera looks closely, and spread out into the fog.
    const offsets = [0];
    for (let o = 0; o < 240; ) {
      o += 0.6 + o * 0.055;
      offsets.push(o);
    }
    const rings = offsets.length;
    const pos: number[] = [];
    const index: number[] = [];
    // Wall: ring 0 at the bottom, the last ring at the rim.
    for (let j = rings - 1; j >= 0; j--) {
      for (let i = 0; i < columns; i++) {
        const u = i / columns;
        const rimY = this.rim[i];
        const y = Math.max(BOTTOM, rimY - offsets[j]);
        perimeter(footprintAt(spec, y), u, p);
        const d = this.wallOffset(u, p.x, y, p.z, p.nx, rimY);
        pos.push(p.x + p.nx * d, y, p.z + p.nz * d);
      }
    }
    this.grid(index, 0, rings, columns);
    // Cap: rings shrinking toward the footprint's centre, the first one a copy of the rim.
    const insets = [0, 0.012, 0.04, 0.08, 0.14, 0.21, 0.3, 0.4, 0.52, 0.65, 0.78, 0.9, 1];
    const cx = (top.xi + top.xo) / 2;
    const cz = (top.zf + top.zb) / 2;
    const capStart = pos.length / 3;
    const rimStart = (rings - 1) * columns * 3;
    for (let k = 0; k < insets.length; k++) {
      const s = 1 - insets[k];
      for (let i = 0; i < columns; i++) {
        const rx = pos[rimStart + i * 3];
        const ry = pos[rimStart + i * 3 + 1];
        const rz = pos[rimStart + i * 3 + 2];
        const x = cx + (rx - cx) * s;
        const z = cz + (rz - cz) * s;
        pos.push(x, k === 0 ? ry : this.capHeight(x, z), z);
      }
    }
    this.grid(index, capStart, insets.length, columns);

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.toWorld(pos), 3));
    g.setIndex(this.wind(index));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }

  /** Quads between consecutive rings, wound so faces point out of the rock. */
  private grid(index: number[], start: number, rings: number, columns: number): void {
    for (let j = 0; j < rings - 1; j++) {
      for (let i = 0; i < columns; i++) {
        const a = start + j * columns + i;
        const b = start + j * columns + ((i + 1) % columns);
        const c = b + columns;
        const d = a + columns;
        index.push(a, b, c, a, c, d);
      }
    }
  }

  /** Local (xl) to world x: the west peak is built as the mirror image of an east one. */
  private toWorld(pos: number[]): number[] {
    if (this.spec.side === 1) return pos;
    for (let i = 0; i < pos.length; i += 3) pos[i] = -pos[i];
    return pos;
  }

  /** Mirroring turns triangles inside out, so the west peak's winding is flipped back. */
  private wind(index: number[]): number[] {
    if (this.spec.side === 1) return index;
    for (let i = 0; i < index.length; i += 3) {
      const t = index[i + 1];
      index[i + 1] = index[i + 2];
      index[i + 2] = t;
    }
    return index;
  }

  /** Rim height at fraction u, interpolated between columns. */
  private rimAt(u: number): number {
    const n = this.rim.length;
    const f = (((u % 1) + 1) % 1) * n;
    const i = Math.floor(f);
    const t = f - i;
    return this.rim[i % n] * (1 - t) + this.rim[(i + 1) % n] * t;
  }

  /** Slabs of slate over the walls facing the gorge and the camera, plus the crags on top. */
  buildSlabs(rb: RockBuilder, density: number): void {
    const r = this.rng;
    const p = this.p;
    const t = new THREE.Vector3();
    const up = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const centre = new THREE.Vector3();
    const pool = Array.from({ length: 32 }, () => new THREE.Vector3());
    const pts: THREE.Vector3[] = [];

    /** Adds a point given in the current frame (t, up, nrm about centre). */
    const point = (a: number, b: number, c: number) => {
      const v = pool[pts.length].copy(centre).addScaledVector(t, a).addScaledVector(up, b).addScaledVector(nrm, c);
      v.x *= this.spec.side;
      pts.push(v);
    };
    // Rocks are written nearest-first as seen from where the camera usually is, so the GPU's depth
    // test throws away the hidden ones before the (expensive) wet slate shader runs on them.
    const eye = new THREE.Vector3(this.spec.side * 12, 1.5, 24);
    const hulls: { distance: number; points: THREE.Vector3[] }[] = [];
    const emit = () => {
      const points = pts.map((v) => v.clone());
      const mid = new THREE.Vector3();
      for (const v of points) mid.add(v);
      hulls.push({ distance: mid.multiplyScalar(1 / points.length).distanceToSquared(eye), points });
      pts.length = 0;
    };

    /**
     * A block of slate: a box with some corners knocked off, so its outline is an irregular
     * polygon of planar faces, never a clean rectangle.
     */
    const slab = (w: number, h: number, depth: number, jitter: number) => {
      for (let k = 0; k < 8; k++) {
        const sx = k & 1 ? 0.5 : -0.5;
        const sy = k & 2 ? 0.5 : -0.5;
        const sz = k & 4 ? 0.5 : -0.5;
        const x = sx * w * (1 + r.spread(jitter));
        const y = sy * h * (1 + r.spread(jitter));
        const z = sz * depth * (1 + r.spread(jitter));
        if (r.chance(0.45)) {
          // Chip the corner: three points pulled back along its edges.
          point(x * (1 - r.range(0.25, 0.75) * Math.min(1, depth / w)), y, z);
          point(x, y * (1 - r.range(0.2, 0.6)), z);
          point(x, y, z * (1 - r.range(0.2, 0.7)));
        } else {
          point(x, y, z);
        }
      }
      emit();
    };

    /** A blade of slate standing out of the crest: a wide base tapering to a ragged edge. */
    const blade = (w: number, h: number, depth: number) => {
      for (let k = 0; k < 4; k++) point((k & 1 ? 0.5 : -0.5) * w * r.range(0.8, 1.1), -h * 0.45, (k & 2 ? 0.5 : -0.5) * depth * r.range(0.8, 1.1));
      const lean = r.spread(w * 0.3);
      point(-w * r.range(0.05, 0.35) + lean, h * 0.55, r.spread(depth * 0.15));
      point(w * r.range(0.05, 0.3) + lean, h * r.range(0.3, 0.5), r.spread(depth * 0.15));
      point(lean + r.spread(w * 0.2), h * r.range(0.1, 0.3), depth * r.range(0.25, 0.45));
      point(lean + r.spread(w * 0.2), h * r.range(0.1, 0.3), -depth * r.range(0.25, 0.45));
      emit();
    };

    /** A loose, frost-split rock: random points on a squashed ellipsoid. */
    const chunk = (size: number) => {
      for (let k = 0; k < 11; k++) {
        const a = r.range(0, Math.PI * 2);
        const b = Math.acos(r.range(-1, 1));
        point(Math.sin(b) * Math.cos(a) * size, Math.cos(b) * size * 0.6, Math.sin(b) * Math.sin(a) * size * r.range(0.7, 1));
      }
      emit();
    };

    // Walls: beds from the summit down into the fog (below which the core's strata carry it), each a
    // row of blocks with its own setback.
    let bandTop = 20;
    let band = 0;
    while (bandTop > -62) {
      const depthBelow = Math.max(0, -bandTop);
      const T = r.range(1.1, 2.7) * (1 + depthBelow * 0.025);
      const yMid = bandTop - T / 2;
      const f = footprintAt(this.spec, yMid);
      let s = r.range(0, 3);
      while (s < f.length) {
        const w = r.range(1.6, 5.2) * (1 + depthBelow * 0.02);
        const u = (s + w / 2) / f.length;
        s += w * r.range(0.82, 1.0);
        perimeter(f, u, p);
        // Only the faces anyone sees: the gorge side, the front, and the corner between them.
        if (Math.max(-p.nx, p.nz) < 0.25) continue;
        const rimY = this.rimAt(u);
        if (yMid + T * 0.25 > rimY) continue;
        if (!r.chance(density * (depthBelow > 30 ? 0.55 : 0.92))) continue;
        const inner = p.nx < -0.5;
        if (inner && Math.abs(p.z) < CLEAR.z + w / 2 && yMid + T / 2 > CLEAR.y) continue;
        if (inner && ledgeSpan(p.z) > 0.01 && yMid + T / 2 > rimY - 0.6) continue;
        const d = this.wallOffset(u, p.x, yMid, p.z, p.nx, rimY);
        const out = 0.25 + 0.65 * this.noise.noise(u * 22, band * 0.37, 2.2) + r.spread(0.3);
        const depth = r.range(1.2, 3.0);
        nrm.set(p.nx, 0, p.nz);
        up.set(0, 1, 0);
        t.crossVectors(up, nrm);
        // Beds dip and blocks twist and skew, so the rows never look laid by a mason.
        nrm.applyAxisAngle(up, r.spread(0.24));
        t.applyAxisAngle(up, r.spread(0.2));
        up.applyAxisAngle(t, r.spread(0.16));
        nrm.applyAxisAngle(t, r.spread(0.16));
        t.applyAxisAngle(nrm, r.spread(0.12));
        centre.set(p.x + p.nx * (d + out - depth / 2), yMid, p.z + p.nz * (d + out - depth / 2));
        slab(w, T * r.range(0.85, 1.12), depth, 0.17);
      }
      bandTop -= T;
      band++;
    }

    // The top: plates of broken slate lying on the cap, and fins standing up out of it.
    const top = footprintAt(this.spec, 0);
    const grid = 2.7;
    for (let gx = top.xi + 1; gx < top.xo - 1; gx += grid) {
      for (let gz = top.zb + 1; gz < top.zf - 0.5; gz += grid) {
        const x = gx + r.spread(1.1);
        const z = gz + r.spread(1.1);
        const fromLedge = Math.hypot(Math.max(0, x - LEDGE.x1), Math.max(0, LEDGE.z0 - z), Math.max(0, z - LEDGE.z1));
        if (fromLedge < 1.8 || (x < CLEAR.x + 1.5 && Math.abs(z) < CLEAR.z + 1.5)) continue;
        if (!r.chance(0.62 * density)) continue;
        const h = this.capHeight(x, z);
        // Tilt the plate to the slope under it.
        const e = 0.6;
        nrm.set(this.capHeight(x - e, z) - this.capHeight(x + e, z), 2 * e, this.capHeight(x, z - e) - this.capHeight(x, z + e)).normalize();
        up.copy(nrm);
        t.set(1, 0, 0).applyAxisAngle(THREE.Object3D.DEFAULT_UP, r.range(0, Math.PI)).projectOnPlane(up).normalize();
        nrm.crossVectors(t, up);
        up.applyAxisAngle(t, r.spread(0.18));
        // Fins crowd the summit and thin out down its flanks.
        const crag = this.noise.ridged(x * 0.11, 9.1, z * 0.11, 2) + 0.25 * Math.min(1, h / 8);
        if (crag > 0.72 && fromLedge > 4 && r.chance(0.7)) {
          // A fin: a blade of slate leaning out of the crest, its foot buried in the rock.
          const height = r.range(2.2, 5.5) * (1 + fromLedge * 0.02);
          up.set(0, 1, 0).applyAxisAngle(t, r.spread(0.22));
          centre.set(x, h + height * 0.3, z);
          blade(r.range(1.6, 3.6), height, r.range(0.9, 2.0));
        } else {
          // A plate of broken bedding, mostly sunk into the slope.
          const thick = r.range(0.5, 1.3);
          centre.set(x, h - thick * 0.15, z);
          slab(r.range(2.0, 4.2), thick, r.range(2.0, 4.2), 0.18);
        }
      }
    }

    // Loose rock on and around the ledge, clear of where the posts stand.
    for (let k = 0; k < 64 * density; k++) {
      const where = r.next();
      const x = where < 0.35 ? r.range(LEDGE.x0 + 0.8, LEDGE.x1 + 1) : r.range(LEDGE.x1 - 1.2, LEDGE.x1 + 4);
      const z = where < 0.35 ? r.range(LEDGE.z0 - 2.5, LEDGE.z0 + 0.4) : r.range(LEDGE.z0 - 1, LEDGE.z1 + 1.5);
      if (x < CLEAR.x + 0.6 && Math.abs(z) < CLEAR.z + 0.4) continue;
      // Small scree on the ledge itself, bigger blocks off it.
      const onLedge = x < LEDGE.x1 && z > LEDGE.z0 && z < LEDGE.z1;
      const size = onLedge ? r.range(0.08, 0.28) : r.range(0.25, 1.1);
      nrm.set(0, 0, 1).applyAxisAngle(THREE.Object3D.DEFAULT_UP, r.range(0, Math.PI * 2));
      up.set(0, 1, 0).applyAxisAngle(nrm, r.spread(0.4));
      t.crossVectors(up, nrm);
      centre.set(x, this.capHeight(x, z) + size * 0.25, z);
      chunk(size);
    }

    hulls.sort((a, b) => a.distance - b.distance);
    for (const h of hulls) rb.hull(h.points);
  }
}

/**
 * Wet slate shader additions: old snow on the tops, and the gorge's fog swallowing the depths.
 * The wet shader's rain rings are switched off for the rock: at this distance they cannot be
 * seen, and they cost more than the rest of the shader on every puddle (the planks keep theirs).
 */
function dressCliffMaterial(material: THREE.MeshStandardMaterial, u: SharedUniforms, env: EnvUniforms): void {
  const wetCompile = material.onBeforeCompile;
  const uGorge = { value: PALETTE.gorgeFog };
  const noRings = { value: 0 };
  material.onBeforeCompile = (shader, renderer) => {
    wetCompile.call(material, shader, renderer);
    shader.uniforms.uRain = noRings;
    shader.uniforms.uSnowCover = env.uSnowCover;
    shader.uniforms.uLightning = u.uLightning;
    shader.uniforms.uGorgeFog = uGorge;
    shader.uniforms.uWindDrift = env.uWindDrift;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uSnowCover;\nuniform float uLightning;\nuniform vec3 uGorgeFog;\nuniform vec2 uWindDrift;\n',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Snow settles on the upward faces of the tops, thickest in hollows (low noise).
        float rockSnow = smoothstep(0.45, 0.85, wetN.y) * smoothstep(-16.0, -4.0, vWetPos.y);
        if (rockSnow > 0.0) {
          float drift = wetNoise(vWetPos.xz * 0.6) * 0.6 + wetN.y * 0.45;
          rockSnow *= smoothstep(1.05 - uSnowCover, 1.25 - uSnowCover, drift);
          diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.66, 0.74), rockSnow);
        }`,
      )
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.8, rockSnow);')
      .replace(
        '#include <opaque_fragment>',
        `#include <opaque_fragment>
        // Below the deck the rock sinks into the gorge fog, in drifting layers.
        if (vWetPos.y < 4.0) {
          float layers = wetNoise(vWetPos.xz * 0.025 + uWindDrift * 0.01) - 0.5;
          float sink = (1.0 - smoothstep(-95.0, -5.0, vWetPos.y + layers * 18.0));
          gl_FragColor.rgb = mix(gl_FragColor.rgb, uGorgeFog * (1.0 + uLightning * 3.0), sink * 0.94);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'wet-tri-cliff';
}

/**
 * The slate texture averages only ~1% linear albedo; this tint lifts it to a blue-black ~6–9% dry
 * (about half that once soaked), so lit faces show their texture instead of reading as a void.
 */
const SLATE_TINT = new THREE.Color(9.0, 5.8, 6.2);

/** Both peaks: two meshes each (core and slabs) sharing one wet slate material, plus the ledges' shadow layer. */
export class AnchorCliffs {
  readonly meshes: THREE.Mesh[] = [];

  constructor(ctx: RenderContext, env: EnvUniforms) {
    const high = ctx.quality === 'high';
    const set = ctx.assets.pbr('slate');
    // Every triplanar lookup is paid three times over, so the filtering is kept lean: one mip level
    // per fetch and no anisotropy. Mottled stone hides both (these are this module's own clones).
    for (const t of [set.map, set.normalMap, set.roughnessMap, set.aoMap]) {
      if (!t) continue;
      t.anisotropy = 1;
      t.minFilter = THREE.LinearMipmapNearestFilter;
    }
    const material = makeWetMaterial(
      { color: 0xffffff, roughness: 1, metalness: 0, triplanar: { set, scale: 0.24, tint: SLATE_TINT }, wet: 2.4 },
      ctx.uniforms,
    );
    dressCliffMaterial(material, ctx.uniforms, env);
    for (const spec of PEAKS) {
      const peak = new Peak(spec);
      const core = new THREE.Mesh(peak.buildCore(high ? 180 : 120), material);
      const rb = new RockBuilder();
      peak.buildSlabs(rb, high ? 1 : 0.7);
      const slabs = new THREE.Mesh(rb.build(), material);
      core.name = 'env-cliff-core';
      slabs.name = 'env-cliff-slabs';
      // After the bridge and warrior (order 0), which hide parts of them; slabs before the core
      // they cover, so the depth test rejects most of the core before it is shaded.
      slabs.renderOrder = RENDER_ORDER.slabs;
      core.renderOrder = RENDER_ORDER.core;
      for (const m of [core, slabs]) {
        ctx.scene.add(m);
        this.meshes.push(m);
      }
    }
    ctx.scene.add(this.shadowCatchers());
  }

  /**
   * The moon's shadows (posts, ropes, warrior) only ever fall on rock at the two ledges, so instead
   * of every cliff fragment paying for soft-shadow lookups, a thin shadow-only layer lies on each.
   * It keeps inside the part of the ledge that is flat whichever way its ragged outline wanders.
   */
  private shadowCatchers(): THREE.Mesh {
    const parts: THREE.BufferGeometry[] = [];
    const x0 = LEDGE.x0;
    const x1 = LEDGE.x1 - 0.8;
    const halfZ = (LEDGE.z1 - LEDGE.z0) / 2 - 0.8;
    for (const side of [-1, 1]) {
      const g = new THREE.PlaneGeometry(x1 - x0, halfZ * 2);
      g.rotateX(-Math.PI / 2);
      g.translate(side * (x0 + x1) * 0.5, LEDGE.y + 0.02, (LEDGE.z0 + LEDGE.z1) / 2);
      parts.push(g);
    }
    const geometry = mergeGeometries(parts);
    for (const p of parts) p.dispose();
    const mesh = new THREE.Mesh(geometry, new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.6 }));
    mesh.name = 'env-ledge-shadows';
    mesh.receiveShadow = true;
    return mesh;
  }
}

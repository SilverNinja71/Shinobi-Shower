import * as THREE from 'three';

/** Rope paths the rope shader knows how to follow (see Rope.glsl). */
export const RopePath = {
  HandFront: 0,
  HandBack: 1,
  EdgeFront: 2,
  EdgeBack: 3,
  SuspenderFront: 4,
  SuspenderBack: 5,
} as const;
export type RopePath = (typeof RopePath)[keyof typeof RopePath];

/**
 * Accumulates rope geometry for the rope shader, where `aRope` says which rope and where along it, so
 * one merged buffer, built once, can hold every rope of the bridge and still follow the deck each frame.
 */
export class RopeBuilder {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly rope: number[] = [];
  private readonly index: number[] = [];

  private get count(): number {
    return this.position.length / 3;
  }

  /**
   * A rope as a ribbon through the parameters `ss` (sorted): each station is a pair of vertices
   * (radius, side ±1) that the shader spreads across the rope, square to the viewer. The texture runs
   * `arc(s) / circumference` along, so the hemp's strands keep the same helical pitch whatever the
   * rope's thickness, and across the visible half of its circumference.
   */
  ribbon(path: RopePath, ss: number[], radius: (s: number) => number, arc: (s: number) => number, lane = 0): void {
    const base = this.count;
    const circumference = 2 * Math.PI * Math.max(radius(ss[0]), 0.008);
    for (const s of ss) {
      const r = radius(s);
      const u = arc(s) / circumference;
      for (const side of [-1, 1]) {
        this.position.push(r, side, 0);
        this.normal.push(0, 0, 1);
        this.uv.push(u, 0.5 + side * 0.25);
        this.rope.push(path, s, lane, 0);
      }
    }
    for (let k = 0; k < ss.length - 1; k++) {
      const a = base + k * 2;
      // Counter-clockwise seen by the viewer the strip is turned toward.
      this.index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  /**
   * A frayed tuft: a card of loose fibres sticking out of the rope at angle `around`, leaning `lean`
   * along it and drooping, `length` long. Its tip stirs in the wind.
   */
  card(path: RopePath, s: number, lane: number, ropeRadius: number, around: number, lean: number, length: number, width: number, spin: number): void {
    const base = this.count;
    const out = new THREE.Vector3(0, Math.cos(around), Math.sin(around));
    const dir = out.clone().multiplyScalar(Math.cos(lean)).add(new THREE.Vector3(Math.sin(lean), 0, 0)).normalize();
    // Width direction: perpendicular to the fibres, turned about them by `spin`.
    const side = new THREE.Vector3(1, 0, 0).cross(dir);
    if (side.lengthSq() < 1e-4) side.set(0, 1, 0);
    side.normalize().applyAxisAngle(dir, spin);
    const normal = side.clone().cross(dir).normalize();
    const root = out.clone().multiplyScalar(ropeRadius * 0.7);
    const corners: [number, number, number][] = [
      [-0.5, 0, 0],
      [0.5, 0, 0],
      [-0.75, 1, 1],
      [0.75, 1, 1],
    ];
    for (const [w, l, flutter] of corners) {
      const p = root.clone().addScaledVector(side, w * width).addScaledVector(dir, l * length);
      this.position.push(p.x, p.y, p.z);
      this.normal.push(normal.x, normal.y, normal.z);
      this.uv.push(w + 0.5 > 0.5 ? 1 : 0, l);
      this.rope.push(path, s, lane, flutter);
    }
    this.index.push(base, base + 1, base + 3, base, base + 3, base + 2);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aRope', new THREE.Float32BufferAttribute(this.rope, 4));
    g.setIndex(this.index);
    return g;
  }
}

/**
 * A rope along fixed world points (a Catmull-Rom curve through them) for tie-offs, with the texture
 * wrapped at the same helical pitch as the moving ropes.
 */
export function fixedRope(points: THREE.Vector3[], radius: number, segments: number, radial: number, closed = false): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  const g = new THREE.TubeGeometry(curve, segments, radius, radial, closed);
  const uv = g.getAttribute('uv');
  const along = curve.getLength() / (2 * Math.PI * radius);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * along, uv.getY(i));
  return g;
}

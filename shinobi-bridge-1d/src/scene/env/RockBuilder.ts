import * as THREE from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';

/**
 * Collects flat-shaded triangles for rock: slabs, fins and boulders, each the convex hull of a
 * handful of points. Every face keeps its own normal, which is what fractured slate looks like:
 * planar faces meeting in sharp edges, with no two blocks quite the same shape.
 */
export class RockBuilder {
  private pos: number[] = [];
  private nrm: number[] = [];
  private readonly hullOf = new ConvexHull();

  /** Adds the convex hull of `points` (at least four, not all coplanar). */
  hull(points: THREE.Vector3[]): void {
    const hull = this.hullOf.setFromPoints(points);
    for (const face of hull.faces) {
      const n = face.normal;
      // Faces come out as triangles; fan anything larger just in case.
      const first = face.edge;
      let edge = first.next;
      const a = first.head().point;
      while (edge.next !== first) {
        const b = edge.head().point;
        const c = edge.next.head().point;
        this.pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        for (let i = 0; i < 3; i++) this.nrm.push(n.x, n.y, n.z);
        edge = edge.next;
      }
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.computeBoundingSphere();
    this.pos = [];
    this.nrm = [];
    return g;
  }
}

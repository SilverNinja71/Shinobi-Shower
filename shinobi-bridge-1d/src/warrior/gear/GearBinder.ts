import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Skins gear to the warrior's skeleton in a relaxed standing pose rather than the T-pose the body
 * was modelled in: a poncho or cloak is built hanging around the arms at the sides, weighted to the
 * nearest bones, and from then on bends with them. Rigid pieces (hat, armour plates, scabbards)
 * simply follow one bone. All gear meshes share one skeleton, so the bones upload once a frame.
 */

/** A bone segment that pulls on nearby gear vertices: from `bone` toward `to` (or a point offset). */
export interface Segment {
  bone: string;
  to?: string;
  /** Model-space offset for the far end when there is no child bone to aim at. */
  reach?: [number, number, number];
  /** Scales this segment's pull (below 1: the cloth only half follows it). */
  gain?: number;
}

export class GearBinder {
  readonly skeleton: THREE.Skeleton;
  private readonly index = new Map<string, number>();
  private readonly rest: THREE.Matrix4[];
  private readonly a = new THREE.Vector3();
  private readonly b = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  /** Call with the rig already posed for binding and its world matrices updated (root at the origin). */
  constructor(body: THREE.SkinnedMesh) {
    const bones = body.skeleton.bones;
    bones.forEach((bone, i) => this.index.set(bone.name, i));
    this.rest = bones.map((bone) => bone.matrixWorld.clone());
    this.skeleton = new THREE.Skeleton(bones, this.rest.map((m) => m.clone().invert()));
  }

  boneIndex(name: string): number {
    const i = this.index.get(name);
    if (i === undefined) throw new Error(`No bone ${name}`);
    return i;
  }

  /** Model-space rest matrix of a bone. */
  restMatrix(name: string): THREE.Matrix4 {
    return this.rest[this.boneIndex(name)];
  }

  restPosition(name: string, out = new THREE.Vector3()): THREE.Vector3 {
    return out.setFromMatrixPosition(this.restMatrix(name));
  }

  /** Geometry modelled in the bone's own space, moved to its rest place and fixed to it. */
  rigid(geometry: THREE.BufferGeometry, bone: string, local?: THREE.Matrix4): THREE.BufferGeometry {
    if (local) geometry.applyMatrix4(local);
    geometry.applyMatrix4(this.restMatrix(bone));
    return this.fix(geometry, bone);
  }

  /** Geometry already in model space around the rest pose, fixed to one bone. */
  fix(geometry: THREE.BufferGeometry, bone: string): THREE.BufferGeometry {
    const n = geometry.getAttribute('position').count;
    const idx = new Uint16Array(n * 4);
    const wts = new Float32Array(n * 4);
    const i0 = this.boneIndex(bone);
    for (let i = 0; i < n; i++) {
      idx[i * 4] = i0;
      wts[i * 4] = 1;
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    return geometry;
  }

  /**
   * Geometry modelled in model space around the rest pose, weighted to the nearest of `segments`.
   * `sharp` sets how quickly influence falls off with distance (higher = stiffer panels).
   */
  soft(geometry: THREE.BufferGeometry, segments: Segment[], sharp = 4): THREE.BufferGeometry {
    const pos = geometry.getAttribute('position');
    const n = pos.count;
    const idx = new Uint16Array(n * 4);
    const wts = new Float32Array(n * 4);
    const ends = segments.map((s) => {
      const a = this.restPosition(s.bone, new THREE.Vector3());
      const b = s.to ? this.restPosition(s.to, new THREE.Vector3()) : a.clone().add(new THREE.Vector3(...(s.reach ?? [0, 0, 0])));
      return { a, b, i: this.boneIndex(s.bone), gain: s.gain ?? 1 };
    });
    const best: { i: number; w: number }[] = [];
    for (let v = 0; v < n; v++) {
      this.p.fromBufferAttribute(pos, v);
      best.length = 0;
      for (const e of ends) {
        const d = this.distanceToSegment(this.p, e.a, e.b);
        const w = e.gain / Math.pow(d + 0.02, sharp);
        // One bone may own several segments: keep its strongest pull.
        const found = best.find((x) => x.i === e.i);
        if (found) found.w = Math.max(found.w, w);
        else best.push({ i: e.i, w });
      }
      best.sort((x, y) => y.w - x.w);
      let sum = 0;
      for (let k = 0; k < 4 && k < best.length; k++) sum += best[k].w;
      for (let k = 0; k < 4; k++) {
        const e = best[k];
        idx[v * 4 + k] = e ? e.i : 0;
        wts[v * 4 + k] = e ? e.w / sum : 0;
      }
    }
    geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
    geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wts, 4));
    return geometry;
  }

  private distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
    this.a.subVectors(b, a);
    this.b.subVectors(p, a);
    const len = this.a.lengthSq();
    const t = len > 0 ? THREE.MathUtils.clamp(this.b.dot(this.a) / len, 0, 1) : 0;
    return this.b.addScaledVector(this.a, -t).length();
  }

  /** One skinned mesh from several bound pieces (they must share attribute sets). */
  mesh(pieces: THREE.BufferGeometry[], material: THREE.Material): THREE.SkinnedMesh {
    const geometry = pieces.length === 1 ? pieces[0] : mergeGeometries(pieces, false);
    if (!geometry) throw new Error('Gear pieces could not be merged');
    if (pieces.length > 1) for (const p of pieces) p.dispose();
    const mesh = new THREE.SkinnedMesh(geometry, material);
    mesh.bind(this.skeleton, new THREE.Matrix4());
    mesh.castShadow = true;
    mesh.frustumCulled = false;
    return mesh;
  }
}

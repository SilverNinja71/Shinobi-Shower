import * as THREE from 'three';
import fragmentShader from '../../shaders/SpiritRibbon.frag';
import vertexShader from '../../shaders/SpiritRibbon.vert';
import { additiveMaterial } from './FxMaterial.ts';
import { RibbonStrip } from './RibbonStrip.ts';
import { VerletBody } from './Verlet.ts';
import type { Capsule } from './Verlet.ts';

export interface RibbonAnchor {
  /** The bone the ribbon is knotted to, and the knot's position in that bone's space. */
  bone: THREE.Object3D;
  local: THREE.Vector3;
  length: number;
  width: number;
}

/**
 * The Armored Kenshi's spirit ribbons: light, floating chains of Verlet points knotted to the
 * headband and the sash, trailing behind every move and lifting in the wind, drawn as glowing
 * violet strips (one draw call for all of them).
 */
export class SpiritRibbons {
  readonly mesh: THREE.Mesh;
  private readonly strip: RibbonStrip;
  private readonly chains: { body: VerletBody; anchor: RibbonAnchor; seed: number }[] = [];
  private readonly at = new THREE.Vector3();
  private placed = false;
  readonly intensity = { value: 1 };

  constructor(anchors: RibbonAnchor[], low: boolean, time: { value: number }, body: Capsule) {
    const n = low ? 7 : 12;
    for (const [i, anchor] of anchors.entries()) {
      const v = new VerletBody(n, n);
      for (let k = 0; k < n; k++) v.place(k, 0, -k * (anchor.length / (n - 1)), 0);
      for (let k = 0; k < n - 1; k++) v.link(k, k + 1, anchor.length / (n - 1));
      // Ripples run from the knot to the tail, each ribbon out of step with the others.
      for (let k = 0; k < n; k++) {
        v.phase[k] = k * 0.8 + i * 1.9;
        v.flutter[k] = k / (n - 1);
      }
      // Spirit cloth barely weighs anything: it floats and streams in the wind.
      v.gravity = -3.2;
      v.windGain = 2.6;
      v.drag = 0.05;
      v.iterations = low ? 2 : 4;
      v.colliders.push(body);
      this.chains.push({ body: v, anchor, seed: i * 1.37 + 0.3 });
    }
    const material = additiveMaterial(vertexShader, fragmentShader, { uTime: time, uIntensity: this.intensity });
    this.strip = new RibbonStrip(material, anchors.length * n);
    this.mesh = this.strip.mesh;
    this.mesh.renderOrder = 6;
  }

  /** Forget the old positions (the warrior was not drawn for a while, or teleported). */
  reset(): void {
    this.placed = false;
  }

  /**
   * `side` is the rig's mirror (±1). Ribbons come in left/right pairs; when the side view mirrors
   * the body, each ribbon takes its partner's knot so it stays on its own side of the world.
   */
  update(dt: number, camera: THREE.Camera, wind: number, time: number, floor: number, side: number): void {
    this.strip.begin(camera);
    for (let i = 0; i < this.chains.length; i++) {
      const c = this.chains[i];
      const a = c.anchor;
      const knot = side > 0 ? a : this.chains[i ^ 1].anchor;
      this.at.copy(knot.local).applyMatrix4(knot.bone.matrixWorld);
      const v = c.body;
      if (!this.placed) {
        // Hang straight down from the knot, at rest.
        for (let k = 0; k < v.count; k++) v.place(k, this.at.x, this.at.y - (k * a.length) / (v.count - 1), this.at.z - k * 0.01);
      }
      v.pin(0, this.at.x, this.at.y, this.at.z);
      v.floor = floor;
      v.update(dt, wind * 0.9, 0.15, 0, time, 2.6 + Math.abs(wind) * 0.3);
      this.strip.line(v.pos, v.count, a.width, a.width * 0.35, c.seed);
    }
    this.placed = true;
    this.strip.end();
  }
}

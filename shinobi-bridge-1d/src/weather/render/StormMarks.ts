import * as THREE from 'three';
import type { Game } from '../../core/Game.ts';
import { worldX } from '../../render/RenderContext.ts';
import { DECK_HALF_WIDTH } from '../../scene/SuspensionBridge.ts';
import marksFrag from '../../shaders/StormMarks.frag';
import marksVert from '../../shaders/StormMarks.vert';
import { InstancePool, spriteQuad, stormMaterial } from './StormMaterial.ts';
import type { Shared } from './StormMaterial.ts';

/** Mark types, as StormMarks.frag numbers them. */
export const MARK = { HAIL: 0, WALL: 1, SWEET: 2, RIPPLE: 3, CROWN: 4, PUFF: 5 } as const;

/**
 * Height of the snow surface above the deck at lane x and depth z: the bridge module shapes the drift
 * into a mound across the deck, thickest down the middle; marks and splashes sit on top of it.
 */
export function snowSurface(game: Game, x: number, z: number): number {
  const u = Math.min(1, Math.abs(z) / DECK_HALF_WIDTH);
  return game.snow.depthAt(x) * Math.sqrt(Math.max(0, 1 - u ** 2.5));
}

/**
 * Every flat mark and small effect of the storm in one instanced draw (StormMarks.vert/.frag): hail
 * warnings, the sweet-spot box, ripples, crowns and snow puffs. Writers place each quad either on the
 * swaying deck or facing the camera; the shader draws it by type.
 */
export class StormMarks {
  readonly mesh: THREE.Mesh;
  private readonly pool: InstancePool;
  private readonly centre: Float32Array;
  private readonly u: Float32Array;
  private readonly v: Float32Array;
  private readonly params: Float32Array;
  private readonly camera: THREE.Camera;

  constructor(scene: THREE.Scene, camera: THREE.Camera, capacity: number, shared: { time: Shared<number>; lightning: Shared<number>; viewport: Shared<THREE.Vector2> }) {
    this.camera = camera;
    this.pool = new InstancePool(spriteQuad(), capacity, { aCenter: 3, aU: 3, aV: 3, aParams: 4 });
    this.centre = this.pool.array('aCenter');
    this.u = this.pool.array('aU');
    this.v = this.pool.array('aV');
    this.params = this.pool.array('aParams');
    const material = stormMaterial({
      vertexShader: marksVert,
      fragmentShader: marksFrag,
      uniforms: {
        uTime: shared.time,
        uLightning: shared.lightning,
        uViewport: shared.viewport,
        uWarn: { value: new THREE.Color(1.0, 0.3, 0.07).multiplyScalar(1.6) },
        uSweet: { value: new THREE.Color(1.0, 0.82, 0.5).multiplyScalar(0.7) },
        uWater: { value: new THREE.Color(0.62, 0.72, 0.88).multiplyScalar(0.9) },
        uSnowLit: { value: new THREE.Color(0.85, 0.9, 1.0) },
      },
    });
    this.mesh = new THREE.Mesh(this.pool.geometry, material);
    this.mesh.frustumCulled = false;
    // Marks lie on the deck: they draw first among the transparent things, under the falling weather.
    this.mesh.renderOrder = -1;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  begin(): void {
    this.pool.begin();
  }

  end(): void {
    this.pool.end(this.mesh);
  }

  private write(type: number, cx: number, cy: number, cz: number, ux: number, uy: number, uz: number, vx: number, vy: number, vz: number, progress: number, intensity: number, extra: number): void {
    const i = this.pool.next();
    if (i < 0) return;
    const c = this.centre;
    c[i * 3] = cx;
    c[i * 3 + 1] = cy;
    c[i * 3 + 2] = cz;
    const u = this.u;
    u[i * 3] = ux;
    u[i * 3 + 1] = uy;
    u[i * 3 + 2] = uz;
    const v = this.v;
    v[i * 3] = vx;
    v[i * 3 + 1] = vy;
    v[i * 3 + 2] = vz;
    const p = this.params;
    p[i * 4] = type;
    p[i * 4 + 1] = progress;
    p[i * 4 + 2] = intensity;
    p[i * 4 + 3] = extra;
  }

  /**
   * A mark lying on the deck at lane x, `lift` above its surface, `z` across it: halfX metres along
   * the lane and halfZ across, tilted with the deck's pitch and roll (the frame placeOnDeck uses).
   */
  onDeck(game: Game, type: number, x: number, z: number, lift: number, halfX: number, halfZ: number, progress: number, intensity: number, extra = 0): void {
    const b = game.bridge;
    const p = b.pitch(x);
    const r = b.rollAt(x);
    const cp = Math.cos(p);
    const sp = Math.sin(p);
    const cr = Math.cos(r);
    const sr = Math.sin(r);
    // Euler (roll, 0, pitch) in XYZ order: lane axis (cp, sp·cr, sp·sr), across axis (0, −sr, cr).
    this.write(type, worldX(x), b.deckY(x) + lift, b.lateral(x) + z, cp * halfX, sp * cr * halfX, sp * sr * halfX, 0, -sr * halfZ, cr * halfZ, progress, intensity, extra);
  }

  /**
   * A quad standing upright at world (x, y, z) and turned toward the camera about the vertical,
   * halfW wide and halfH tall. `base` puts its bottom edge at y instead of its centre.
   */
  upright(type: number, x: number, y: number, z: number, halfW: number, halfH: number, base: boolean, progress: number, intensity: number, extra = 0): void {
    const cam = this.camera.position;
    let tx = cam.x - x;
    let tz = cam.z - z;
    const len = Math.hypot(tx, tz) || 1;
    tx /= len;
    tz /= len;
    this.write(type, x, base ? y + halfH : y, z, tz * halfW, 0, -tx * halfW, 0, halfH, 0, progress, intensity, extra);
  }
}

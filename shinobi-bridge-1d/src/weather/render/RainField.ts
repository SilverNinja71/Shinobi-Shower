import * as THREE from 'three';
import rainFrag from '../../shaders/RainSheet.frag';
import rainVert from '../../shaders/RainSheet.vert';
import { SPAWN_Y } from '../DynamicStormSystem.ts';
import { CURTAIN_SLOTS } from './CurtainSlots.ts';
import type { CurtainSlots } from './CurtainSlots.ts';
import { particleBatches, particleDefines, stormMaterial, streakTriangle, wrapTravel } from './StormMaterial.ts';
import type { Shared } from './StormMaterial.ts';

export interface RainFieldOptions {
  /** Streak count. */
  count: number;
  /** The box: ±halfX around the camera along x, fixed y and z ranges (world metres). */
  halfX: number;
  y: [number, number];
  z: [number, number];
  /** Physical streak width (m), the narrowest it is drawn (px), and the motion blur (s). */
  width: number;
  minPixels: number;
  shutter: number;
  /** Extra pixels of width per metre a streak is nearer than the focus (out-of-focus foreground). */
  defocus: number;
  /** Linear colour of a fully lit streak. */
  color: THREE.ColorRepresentation;
  /** How much brighter the streaks get in a full lightning flash. */
  flashGain: number;
  /**
   * When set, `share` of the streaks ride the simulation's curtains instead of the steady fall, and
   * `veils` of those are drawn as wide faint smears that give a sheet its body.
   */
  curtains?: { slots: CurtainSlots; share: number; veils: number; z: [number, number]; gain: number };
}

export interface FieldShared {
  lightning: Shared<number>;
  viewport: Shared<THREE.Vector2>;
  /** This frame's projection × view matrix (one product per vertex instead of two). */
  viewProj: Shared<THREE.Matrix4>;
  /** View depth in focus (the camera's distance to the bridge). */
  focus: Shared<number>;
  /** Direction toward the moon, for backlit rain. */
  moonDir: Shared<THREE.Vector3>;
}

/**
 * A field of cosmetic streaks animated on the GPU (RainSheet.vert/.frag): the storm's rain sheets, and
 * with other settings the fine drizzle of a mist front. The CPU only integrates the field's velocity
 * and moves the box with the camera; the drops themselves never touch a buffer after creation.
 */
export class RainField {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uBoxMin: Shared<THREE.Vector3>;
    uBoxSize: Shared<THREE.Vector3>;
    uDisp: Shared<THREE.Vector2>;
    uVel: Shared<THREE.Vector2>;
    uStrength: Shared<number>;
  };
  private readonly halfX: number;
  private travelX = 0;
  private travelY = 0;

  constructor(scene: THREE.Scene, o: RainFieldOptions, shared: FieldShared) {
    this.halfX = o.halfX;
    const curtains = o.curtains;
    // The first `riders` particles ride the curtains, spread evenly over the slots; the rest keep the
    // steady fall. One rider in `veilEvery` (per slot) is a veil.
    const riders = Math.floor(o.count * (curtains?.share ?? 0));
    const veilEvery = Math.max(1, Math.round(1 / Math.max(curtains?.veils ?? 0, 1e-3)));
    const geometry = particleBatches(streakTriangle(), o.count);
    this.uniforms = {
      uBoxMin: { value: new THREE.Vector3(-o.halfX, o.y[0], o.z[0]) },
      uBoxSize: { value: new THREE.Vector3(o.halfX * 2, o.y[1] - o.y[0], o.z[1] - o.z[0]) },
      uDisp: { value: new THREE.Vector2() },
      uVel: { value: new THREE.Vector2(0, -30) },
      uStrength: { value: 0 },
    };
    const material = stormMaterial({
      vertexShader: rainVert,
      fragmentShader: rainFrag,
      defines: {
        ...particleDefines(o.count),
        CURTAIN_SLOTS: curtains ? CURTAIN_SLOTS : 0,
        RIDERS: riders.toFixed(1),
        VEIL_EVERY: veilEvery.toFixed(1),
      },
      uniforms: {
        ...this.uniforms,
        uLightning: shared.lightning,
        uViewport: shared.viewport,
        uViewProj: shared.viewProj,
        uFocus: shared.focus,
        uMoonDir: shared.moonDir,
        uFlashGain: { value: o.flashGain },
        uShutter: { value: o.shutter },
        uWidth: { value: o.width },
        uMinPixels: { value: o.minPixels },
        uDefocus: { value: o.defocus },
        uColor: { value: new THREE.Color(o.color) },
        ...(curtains
          ? {
              uCurtain: { value: curtains.slots.bands },
              uCurtainTime: { value: curtains.slots.times },
              uCurtainZ: { value: new THREE.Vector2(curtains.z[0], curtains.z[1]) },
              uSpawnY: { value: SPAWN_Y + 1 },
              uCurtainGain: { value: curtains.gain },
            }
          : {}),
      },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  /**
   * `vx`, `vy` is the field's velocity now (m/s); `strength` its opacity (0 hides the steady fall);
   * `cameraX` centres the box. `curtainsLive` keeps the mesh drawing while a sheet is still falling.
   */
  update(dt: number, vx: number, vy: number, strength: number, cameraX: number, curtainsLive = false): void {
    const u = this.uniforms;
    const size = u.uBoxSize.value;
    this.travelX = wrapTravel(this.travelX + vx * dt, size.x);
    this.travelY = wrapTravel(this.travelY + vy * dt, size.y);
    u.uDisp.value.set(this.travelX, this.travelY);
    u.uVel.value.set(vx, vy);
    u.uStrength.value = strength;
    u.uBoxMin.value.x = cameraX - this.halfX;
    this.mesh.visible = strength > 0.003 || curtainsLive;
  }
}

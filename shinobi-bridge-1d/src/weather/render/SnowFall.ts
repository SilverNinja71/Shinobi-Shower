import * as THREE from 'three';
import flakeFrag from '../../shaders/Snowflake.frag';
import flakeVert from '../../shaders/Snowflake.vert';
import { particleBatches, particleDefines, spriteQuad, stormMaterial, wrapTravel } from './StormMaterial.ts';
import type { Shared } from './StormMaterial.ts';

const HALF_X = 24;
const Y: [number, number] = [-14, 16];
const Z: [number, number] = [-22, 12];
/** Cosmetic flakes fall this fast (m/s) and drift with this share of the wind. */
const FALL = 1.35;
const DRIFT = 0.85;

/**
 * Cosmetic snowfall for snow fronts (Snowflake.vert/.frag), animated on the GPU: thousands of small
 * flakes drifting on the crosswind with their own lazy sway, thickening with uSnow.
 */
export class SnowFall {
  readonly mesh: THREE.Mesh;
  private readonly uDisp = { value: new THREE.Vector2() };
  private readonly uBoxMin = { value: new THREE.Vector3(-HALF_X, Y[0], Z[0]) };
  private readonly uBoxSize = { value: new THREE.Vector3(HALF_X * 2, Y[1] - Y[0], Z[1] - Z[0]) };
  private readonly uStrength = { value: 0 };
  private travelX = 0;
  private travelY = 0;

  constructor(scene: THREE.Scene, count: number, shared: { time: Shared<number>; lightning: Shared<number>; viewport: Shared<THREE.Vector2>; focus: Shared<number> }) {
    const geometry = particleBatches(spriteQuad(), count);
    const material = stormMaterial({
      vertexShader: flakeVert,
      fragmentShader: flakeFrag,
      defines: particleDefines(count),
      uniforms: {
        uBoxMin: this.uBoxMin,
        uBoxSize: this.uBoxSize,
        uDisp: this.uDisp,
        uStrength: this.uStrength,
        uTime: shared.time,
        uLightning: shared.lightning,
        uViewport: shared.viewport,
        uFocus: shared.focus,
        uMinPixels: { value: 2 },
        uColor: { value: new THREE.Color(0.75, 0.8, 0.9).multiplyScalar(0.85) },
        uOpacity: { value: 0.35 },
      },
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  update(dt: number, wind: number, strength: number, cameraX: number): void {
    const size = this.uBoxSize.value;
    this.travelX = wrapTravel(this.travelX + wind * DRIFT * dt, size.x);
    this.travelY = wrapTravel(this.travelY - FALL * dt, size.y);
    this.uDisp.value.set(this.travelX, this.travelY);
    this.uBoxMin.value.x = cameraX - HALF_X;
    this.uStrength.value = strength;
    this.mesh.visible = strength > 0.003;
  }
}

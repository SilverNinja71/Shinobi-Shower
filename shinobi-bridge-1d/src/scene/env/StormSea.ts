import * as THREE from 'three';
import seaFrag from '../../shaders/Sea.frag';
import seaVert from '../../shaders/Sea.vert';
import type { RenderContext } from '../../render/RenderContext.ts';
import type { EnvUniforms } from './EnvUniforms.ts';
import { PALETTE, RENDER_ORDER } from './palette.ts';

/** The storm sea's surface, far below the bridge. The far ranges rise out of it. */
export const SEA_LEVEL = -300;

/**
 * The storm sea. A plane this far below and this far out would be clipped by the camera's far
 * plane long before the horizon, so it is ray-traced instead: a camera-centred lower hemisphere,
 * pinned to the far plane, finds the water per pixel. It draws after the opaque scene, so only the
 * gaps between islands, cliffs and bridge pay for it; the fog then blends over it.
 */
export class StormSea {
  readonly mesh: THREE.Mesh;

  constructor(ctx: RenderContext, env: EnvUniforms, noise: THREE.Texture) {
    const u = ctx.uniforms;
    const material = new THREE.ShaderMaterial({
      vertexShader: seaVert,
      fragmentShader: seaFrag,
      uniforms: {
        uNoise: { value: noise },
        uTime: u.uTime,
        uLightning: u.uLightning,
        uMist: u.uMist,
        uRain: u.uRain,
        uWind: u.uWind,
        uDrift: env.uWindDrift,
        uSeaLevel: { value: SEA_LEVEL },
        uMoonDir: env.uMoonDir,
        uMoonColor: { value: PALETTE.moon },
        uFlashDir: env.uFlashDir,
        uFlashColor: { value: PALETTE.lightning },
        uHaze: { value: PALETTE.haze },
        uZenith: { value: PALETTE.zenith },
        uHorizon: { value: PALETTE.horizon },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    // Only the lower half of a sphere: the sea is never above the horizon.
    const geometry = new THREE.SphereGeometry(900, 48, 12, 0, Math.PI * 2, Math.PI / 2 - 0.02, Math.PI / 2 + 0.02);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.name = 'env-sea';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER.sea;
    ctx.scene.add(this.mesh);
  }

  update(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}

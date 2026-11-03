import * as THREE from 'three';
import skyFrag from '../../shaders/StormSky.frag';
import skyVert from '../../shaders/StormSky.vert';
import type { RenderContext } from '../../render/RenderContext.ts';
import type { EnvUniforms } from './EnvUniforms.ts';
import { PALETTE, RENDER_ORDER } from './palette.ts';

/**
 * The storm sky: a dome that follows the camera, pinned to the far plane and drawn after all other
 * opaque things, so its costly clouds are only shaded where nothing else covers the sky. It covers
 * just the upper hemisphere and a sliver below; the sea dome, drawn after it, takes everything
 * under the horizon.
 * All of its look lives in StormSky.frag.
 */
export class StormSky {
  readonly mesh: THREE.Mesh;

  constructor(ctx: RenderContext, env: EnvUniforms, noise: THREE.Texture) {
    const u = ctx.uniforms;
    const material = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      uniforms: {
        uNoise: { value: noise },
        uLightning: u.uLightning,
        uMist: u.uMist,
        uRain: u.uRain,
        uSnow: u.uSnow,
        uCloudShift: env.uCloudShift,
        uMoonDir: env.uMoonDir,
        uFlashDir: env.uFlashDir,
        uZenith: { value: PALETTE.zenith },
        uHorizon: { value: PALETTE.horizon },
        uHaze: { value: PALETTE.haze },
        uCloud: { value: PALETTE.cloud },
        uCloudLit: { value: PALETTE.cloudLit },
        uMoonColor: { value: PALETTE.moon },
        uFlashColor: { value: PALETTE.lightning },
      },
      side: THREE.BackSide,
      depthWrite: false,
    });
    const dome = new THREE.SphereGeometry(1000, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2 + 0.01);
    this.mesh = new THREE.Mesh(dome, material);
    this.mesh.name = 'env-sky';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = RENDER_ORDER.sky;
    ctx.scene.add(this.mesh);
  }

  update(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }
}

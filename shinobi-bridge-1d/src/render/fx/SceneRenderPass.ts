import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import composeFrag from '../../shaders/PostCompose.frag';
import quadVert from '../../shaders/PostQuad.vert';
import type { SoftLayer } from './SoftLayer.ts';

/**
 * The composer's first pass: the world, then the soft effects layer over it.
 *
 * 1. The main scene goes into its own HDR target with a depth texture. On 'high' that target is
 *    multisampled, so ropes, rain streaks and blade edges keep the antialiasing they had on the canvas.
 * 2. When the soft layer has anything in it, it is drawn into a second, depth-less target (half size on
 *    'low'), each particle reading the scene's depth to fade where it meets geometry and hide behind it.
 * 3. One full-screen draw lays the layer over the world into the composer's read buffer, so bloom and
 *    the lens see sparks and steam as part of the picture.
 *
 * Draw calls: the scene, the layer's meshes when active, and one composite.
 */
export class SceneRenderPass extends RenderPass {
  private readonly target: THREE.WebGLRenderTarget;
  private readonly softTarget: THREE.WebGLRenderTarget;
  private readonly layer: SoftLayer;
  /** Size of the soft target relative to the frame. */
  private readonly softScale: number;
  private readonly quad: FullScreenQuad;
  private readonly composeUniforms: {
    tScene: { value: THREE.Texture };
    tSoft: { value: THREE.Texture };
    uSoft: { value: number };
  };
  private readonly savedClear = new THREE.Color();

  constructor(scene: THREE.Scene, camera: THREE.Camera, layer: SoftLayer, samples: number, softScale: number) {
    super(scene, camera);
    this.needsSwap = false;
    this.layer = layer;
    this.softScale = softScale;
    this.target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples,
      depthTexture: new THREE.DepthTexture(1, 1, THREE.UnsignedIntType),
    });
    this.target.texture.name = 'SceneRenderPass.scene';
    this.softTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
    this.softTarget.texture.name = 'SceneRenderPass.soft';
    this.composeUniforms = {
      tScene: { value: this.target.texture },
      tSoft: { value: this.softTarget.texture },
      uSoft: { value: 0 },
    };
    this.quad = new FullScreenQuad(
      new THREE.ShaderMaterial({
        name: 'PostCompose',
        uniforms: this.composeUniforms,
        vertexShader: quadVert,
        fragmentShader: composeFrag,
        depthTest: false,
        depthWrite: false,
      }),
    );
    layer.uniforms.tSceneDepth.value = this.target.depthTexture;
  }

  setSize(width: number, height: number): void {
    this.target.setSize(width, height);
    const sw = Math.max(1, Math.round(width * this.softScale));
    const sh = Math.max(1, Math.round(height * this.softScale));
    this.softTarget.setSize(sw, sh);
    this.layer.uniforms.uSoftInvSize.value.set(1 / sw, 1 / sh);
  }

  render(renderer: THREE.WebGLRenderer, _writeBuffer: THREE.WebGLRenderTarget, readBuffer: THREE.WebGLRenderTarget): void {
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;

    // 1. The world. A colour background clears to itself; anything else is drawn by the renderer.
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    // 2. The soft layer, cleared to transparent black, then premultiplied "over" blending inside it.
    const layer = this.layer;
    const soft = layer.active;
    if (soft) {
      const cam = this.camera as THREE.PerspectiveCamera;
      layer.scene.fog = this.scene.fog;
      layer.uniforms.uCameraNear.value = cam.near;
      layer.uniforms.uCameraFar.value = cam.far;
      renderer.getClearColor(this.savedClear);
      const alpha = renderer.getClearAlpha();
      renderer.setRenderTarget(this.softTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear(true, false, false);
      renderer.render(layer.scene, this.camera);
      renderer.setClearColor(this.savedClear, alpha);
    }

    // 3. Both into the composer's buffer.
    this.composeUniforms.uSoft.value = soft ? 1 : 0;
    renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  dispose(): void {
    this.target.depthTexture?.dispose();
    this.target.dispose();
    this.softTarget.dispose();
    this.quad.material.dispose();
    this.quad.dispose();
  }
}

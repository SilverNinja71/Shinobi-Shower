import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import lensFrag from '../../shaders/LensPass.frag';
import blurFrag from '../../shaders/PostBlur.frag';
import quadVert from '../../shaders/PostQuad.vert';

/** Tap spacing of the two Gaussian rounds: together about 40 px of blur at full size. */
const BLUR_SPREADS = [1, 2.2] as const;

/**
 * Lens uniforms PostFX drives every frame (see LensPass.frag for what each does). A type alias rather
 * than an interface, so it carries the implicit index signature ShaderMaterial's `uniforms` expects.
 */
export type LensUniforms = {
  tDiffuse: { value: THREE.Texture | null };
  tBlur: { value: THREE.Texture | null };
  tGlow: { value: THREE.Texture | null };
  uResolution: { value: THREE.Vector2 };
  uTime: { value: number };
  uFog: { value: number };
  uFogDrift: { value: THREE.Vector2 };
  uDrops: { value: number };
  uRuns: { value: number };
  uLightning: { value: number };
  uPunch: { value: number };
  uDamage: { value: number };
  uHeavy: { value: number };
  uDesat: { value: number };
  uSlash: { value: number };
  uSlashY: { value: number };
  uSlashDir: { value: number };
  uCA: { value: number };
  uGrain: { value: number };
  uVignette: { value: number };
};

/**
 * The lens: a ShaderPass running LensPass.frag over the bloomed frame. When anything on the glass
 * needs a soft copy of the picture (the condensation veil, the water beads) it first makes one: a
 * quarter-size downsample blurred twice each way, five small draws in all, skipped when the lens is dry.
 */
export class LensPass extends ShaderPass {
  declare uniforms: LensUniforms & { [name: string]: { value: unknown } };
  /** Set by PostFX each frame: whether the soft copy is needed. */
  needsBlur = false;
  private readonly blurA: THREE.WebGLRenderTarget;
  private readonly blurB: THREE.WebGLRenderTarget;
  private readonly down: THREE.ShaderMaterial;
  private readonly blur: THREE.ShaderMaterial;
  private readonly blurQuad: FullScreenQuad;
  /** A black texture the blur slot shows while the lens is dry. */
  private readonly black: THREE.DataTexture;

  constructor(low: boolean) {
    const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    black.needsUpdate = true;
    const uniforms: LensUniforms = {
      tDiffuse: { value: null },
      tBlur: { value: black },
      tGlow: { value: black },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uFog: { value: 0 },
      uFogDrift: { value: new THREE.Vector2() },
      uDrops: { value: 0 },
      uRuns: { value: 0 },
      uLightning: { value: 0 },
      uPunch: { value: 0 },
      uDamage: { value: 0 },
      uHeavy: { value: 0 },
      uDesat: { value: 0 },
      uSlash: { value: 0 },
      uSlashY: { value: 0.5 },
      uSlashDir: { value: 1 },
      uCA: { value: 0.012 },
      uGrain: { value: 0.012 },
      uVignette: { value: 0.42 },
    };
    super(
      new THREE.ShaderMaterial({
        name: 'LensPass',
        defines: low ? { LENS_LOW: '' } : {},
        uniforms,
        vertexShader: quadVert,
        fragmentShader: lensFrag,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.black = black;
    const opts = { type: THREE.HalfFloatType, depthBuffer: false };
    this.blurA = new THREE.WebGLRenderTarget(1, 1, opts);
    this.blurB = new THREE.WebGLRenderTarget(1, 1, opts);
    this.blurA.texture.name = 'LensPass.blurA';
    this.blurB.texture.name = 'LensPass.blurB';
    const blurUniforms = () => ({
      tInput: { value: null as THREE.Texture | null },
      uTexel: { value: new THREE.Vector2() },
      uDirection: { value: new THREE.Vector2() },
    });
    this.down = new THREE.ShaderMaterial({
      name: 'PostBlur.down',
      defines: { DOWNSAMPLE: '' },
      uniforms: blurUniforms(),
      vertexShader: quadVert,
      fragmentShader: blurFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.blur = new THREE.ShaderMaterial({
      name: 'PostBlur.gauss',
      uniforms: blurUniforms(),
      vertexShader: quadVert,
      fragmentShader: blurFrag,
      depthTest: false,
      depthWrite: false,
    });
    this.blurQuad = new FullScreenQuad(this.down);
  }

  setSize(width: number, height: number): void {
    this.uniforms.uResolution.value.set(width, height);
    const w = Math.max(1, Math.round(width / 4));
    const h = Math.max(1, Math.round(height / 4));
    this.blurA.setSize(w, h);
    this.blurB.setSize(w, h);
  }

  render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    if (this.needsBlur) {
      this.makeSoftCopy(renderer, readBuffer);
      this.uniforms.tBlur.value = this.blurA.texture;
    } else {
      this.uniforms.tBlur.value = this.black;
    }
    super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  /** Quarter-size copy of the frame, then two Gaussian passes each way with widening taps. */
  private makeSoftCopy(renderer: THREE.WebGLRenderer, readBuffer: THREE.WebGLRenderTarget): void {
    const quad = this.blurQuad;
    const down = this.down.uniforms;
    down.tInput.value = readBuffer.texture;
    down.uTexel.value.set(1 / readBuffer.width, 1 / readBuffer.height);
    quad.material = this.down;
    renderer.setRenderTarget(this.blurA);
    quad.render(renderer);

    const b = this.blur.uniforms;
    b.uTexel.value.set(1 / this.blurA.width, 1 / this.blurA.height);
    quad.material = this.blur;
    for (let i = 0; i < BLUR_SPREADS.length; i++) {
      const spread = BLUR_SPREADS[i];
      b.tInput.value = this.blurA.texture;
      b.uDirection.value.set(spread, 0);
      renderer.setRenderTarget(this.blurB);
      quad.render(renderer);
      b.tInput.value = this.blurB.texture;
      b.uDirection.value.set(0, spread);
      renderer.setRenderTarget(this.blurA);
      quad.render(renderer);
    }
  }

  dispose(): void {
    super.dispose();
    this.blurA.dispose();
    this.blurB.dispose();
    this.down.dispose();
    this.blur.dispose();
    this.black.dispose();
  }
}

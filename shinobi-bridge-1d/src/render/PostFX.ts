import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Game, GameEvent } from '../core/Game.ts';
import { FOCUS_LIFT, FOCUS_Z } from './fx/FocusStreak.ts';
import { LensPass } from './fx/LensPass.ts';
import { SceneRenderPass } from './fx/SceneRenderPass.ts';
import { softLayerOf } from './fx/SoftLayer.ts';
import type { RenderContext, RenderModule } from './RenderContext.ts';
import { worldX } from './RenderContext.ts';

const { smoothstep } = THREE.MathUtils;

/**
 * Subtle bloom: only what is truly bright in the linear frame glows (lightning, the flame edge, the
 * lanterns, spirit light, sparks). The knee softens the threshold so glows fade in rather than pop.
 */
const BLOOM = { strength: 0.4, radius: 0.55, threshold: 0.9, knee: 0.45 };
/** Chromatic aberration at the corners, in UV (multiplied by the squared distance from the centre). */
const CA = 0.0045;
/** MSAA samples for the world on 'high' (the canvas's own antialiasing is lost once we draw offscreen). */
const SAMPLES = 4;

/** UnrealBloomPass whose whole mip chain runs at a fraction of the frame size ('low' runs it at half). */
class ScaledBloomPass extends UnrealBloomPass {
  scale = 1;

  setSize(width: number, height: number): void {
    super.setSize(Math.max(2, Math.round(width * this.scale)), Math.max(2, Math.round(height * this.scale)));
  }
}

/**
 * Draws the frame through an EffectComposer:
 *   SceneRenderPass (the world, multisampled on 'high', with VFX's soft layer laid over it using the depth)
 *   → UnrealBloomPass (subtle; half resolution on 'low')
 *   → LensPass (condensation from the mist, water on the glass in heavy rain, aberration, vignette, grain,
 *     lightning punch, hit pulse, soaked-robe desaturation, the focus cut's split frame)
 *   → OutputPass (ACES Filmic tone mapping and sRGB, as set on the renderer by GameRenderer).
 * It is the last module updated each frame, since its update draws the picture.
 */
export class PostFX implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly composer: EffectComposer;
  private readonly scenePass: SceneRenderPass;
  private readonly bloom: ScaledBloomPass;
  private readonly lens: LensPass;
  private pixelRatio: number;
  private time = 0;
  /** Condensation on the glass (0–1): builds while the mist is thick, lingers after it thins. */
  private fog = 0;
  /** Water beads on the glass (0–1): gather in heavy rain, evaporate slowly. */
  private drops = 0;
  /** The red hit pulse (0–1) and how much of it a hailstone caused. */
  private damage = 0;
  private heavy = 0;
  /** A brief extra exposure kick (perfect cuts, the focus cut). */
  private punch = 0;
  /** The focus cut's split frame, 1 at the cut, and where the cut line was drawn in the world. */
  private slash = 0;
  private slashDir = 1;
  private readonly slashAt = new THREE.Vector3();
  private readonly projected = new THREE.Vector3();

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    const low = ctx.quality === 'low';
    const renderer = ctx.renderer;
    // The composer draws many times per frame; update() resets the counters once, so
    // renderer.info describes the whole frame (the playtest tool reads it).
    renderer.info.autoReset = false;
    this.pixelRatio = renderer.getPixelRatio();
    const size = renderer.getSize(new THREE.Vector2());
    const w = Math.max(1, size.x);
    const h = Math.max(1, size.y);
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
    target.texture.name = 'PostFX.frame';
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(this.pixelRatio);

    this.scenePass = new SceneRenderPass(ctx.scene, ctx.camera, softLayerOf(ctx.scene), low ? 0 : SAMPLES, low ? 0.5 : 1);
    this.bloom = new ScaledBloomPass(new THREE.Vector2(w, h), BLOOM.strength, BLOOM.radius, BLOOM.threshold);
    this.bloom.scale = low ? 0.5 : 1;
    (this.bloom.highPassUniforms as Record<string, { value: number }>).smoothWidth.value = BLOOM.knee;
    this.lens = new LensPass(low);
    // The bloom's wide, blurred highlights double as the halos round lights seen through fogged glass.
    this.lens.uniforms.tGlow.value = this.bloom.renderTargetsVertical[3].texture;
    this.lens.uniforms.uCA.value = CA;

    this.composer.addPass(this.scenePass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.lens);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(w, h);
  }

  resize(width: number, height: number, pixelRatio: number): void {
    if (pixelRatio !== this.pixelRatio) {
      this.pixelRatio = pixelRatio;
      this.composer.setPixelRatio(pixelRatio);
    }
    this.composer.setSize(Math.max(1, width), Math.max(1, height));
  }

  handleEvent(e: GameEvent, game: Game): void {
    switch (e.type) {
      case 'hit': {
        // Hail hits hard and reaches far in from the edges; light water only tints the rim.
        const hail = e.kind === 'hail';
        const amount = hail ? 1 : THREE.MathUtils.clamp(0.12 + e.damage / 20, 0.12, 0.8);
        this.damage = Math.min(1, Math.max(this.damage, amount) + amount * 0.2);
        if (hail) this.heavy = 1;
        break;
      }
      case 'shatter':
        this.punch = Math.max(this.punch, 0.22);
        break;
      case 'perfect':
        this.punch = Math.max(this.punch, 0.16);
        break;
      case 'focus':
        this.slash = 1;
        this.slashDir = game.warrior.facing;
        this.slashAt.set(worldX(game.warrior.x), game.feetY + FOCUS_LIFT, FOCUS_Z);
        this.punch = Math.max(this.punch, 0.65);
        break;
      default:
        break;
    }
  }

  update(dt: number, game: Game): void {
    const u = this.ctx.uniforms;
    const lens = this.lens.uniforms;
    this.time += dt;

    // Condensation builds while mist is thick and lingers after it lifts; beads gather in heavy rain.
    const fogTarget = u.uMist.value;
    this.fog += (fogTarget - this.fog) * Math.min(1, dt * (fogTarget > this.fog ? 0.45 : 0.12));
    const dropTarget = smoothstep(u.uRain.value, 0.3, 0.9);
    this.drops += (dropTarget - this.drops) * Math.min(1, dt * (dropTarget > this.drops ? 0.6 : 0.06));
    if (this.fog < 1e-4) this.fog = 0;
    if (this.drops < 1e-4) this.drops = 0;
    // Drops run down the glass in heavy rain; on a fogged lens only now and then, where beads grow.
    const runs = Math.max(this.drops * 0.9, this.fog * 0.35);
    lens.uFog.value = this.fog;
    lens.uDrops.value = this.drops;
    lens.uRuns.value = runs;
    // The veil drifts with the wind across the glass.
    lens.uFogDrift.value.x += (u.uWind.value * 0.008 + 0.004) * dt;
    lens.uFogDrift.value.y += 0.005 * dt;
    lens.uTime.value = this.time;
    lens.uLightning.value = u.uLightning.value;
    this.lens.needsBlur = this.fog > 0.002 || runs > 0.002;

    // Hit pulse, punch and the colour of a soaked robe.
    this.damage = Math.max(0, this.damage - dt * (this.heavy > 0.5 ? 1.15 : 2.0));
    this.heavy = Math.max(0, this.heavy - dt * 0.9);
    lens.uDamage.value = this.damage * Math.sqrt(this.damage);
    lens.uHeavy.value = this.heavy;
    this.punch = Math.max(0, this.punch - dt * 3.5);
    lens.uPunch.value = this.punch * this.punch;
    lens.uDesat.value = game.phase === 'menu' ? 0 : 0.62 * (1 - smoothstep(game.dryness, 12, 55));

    // The focus cut splits the frame along its line, then the halves slide back together.
    if (this.slash > 0) {
      this.slash = Math.max(0, this.slash - dt / 0.5);
      this.projected.copy(this.slashAt).project(this.ctx.camera);
      lens.uSlashY.value = this.projected.y * 0.5 + 0.5;
      lens.uSlashDir.value = this.slashDir;
    }
    lens.uSlash.value = this.slash * this.slash;
    lens.uCA.value = CA * (1 + 1.5 * this.damage + 4 * this.slash * this.slash);

    this.ctx.renderer.info.reset();
    this.composer.render(dt);
  }
}

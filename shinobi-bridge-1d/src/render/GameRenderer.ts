import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import { BRIDGE_LENGTH } from '../scene/SuspensionBridge.ts';
import { BridgeRenderer } from '../scene/BridgeRenderer.ts';
import { MountainPeakScene } from '../scene/MountainPeakScene.ts';
import { CosmeticsRenderer } from '../warrior/CosmeticsRenderer.ts';
import { StormRenderer } from '../weather/StormRenderer.ts';
import type { Assets } from './Assets.ts';
import { PostFX } from './PostFX.ts';
import type { Quality, RenderContext, RenderModule, SharedUniforms } from './RenderContext.ts';
import { worldX } from './RenderContext.ts';
import { VFX } from './VFX.ts';

const FOV = 36;
/** The camera keeps at least this many metres of lane in view either side of the warrior. */
const HALF_VIEW = 11;
const MIN_DISTANCE = 18;
const MAX_DISTANCE = 40;

export function makeUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uWetness: { value: 0.35 },
    uLightning: { value: 0 },
    uWind: { value: 0 },
    uRainDir: { value: 1 },
    uRainAngle: { value: 0.6 },
    uRainSpeed: { value: 36 },
    uRain: { value: 0 },
    uMist: { value: 0 },
    uSnow: { value: 0 },
  };
}

/**
 * Owns the WebGL renderer, scene and camera, and runs each rendering module in order every frame.
 * The canvas fills `container`, which the page sizes between the cinematic letterbox bars.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(FOV, 16 / 9, 0.1, 2500);
  readonly ctx: RenderContext;
  readonly env: MountainPeakScene;
  readonly bridge: BridgeRenderer;
  readonly storm: StormRenderer;
  readonly warrior: CosmeticsRenderer;
  readonly vfx: VFX;
  readonly post: PostFX;
  /** Smoothed frames per second, for the debug hook and dynamic resolution. */
  fps = 60;
  private readonly modules: RenderModule[];
  private readonly container: HTMLElement;
  private shake = 0;
  private time = 0;
  private lead = 0;
  private readonly focus = new THREE.Vector3(0, 0, 0);
  private readonly look = new THREE.Vector3();
  private pixelRatio: number;
  private slowFrames = 0;

  constructor(container: HTMLElement, renderer: THREE.WebGLRenderer, assets: Assets, quality: Quality) {
    this.container = container;
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, quality === 'high' ? 1.5 : 1);
    renderer.setPixelRatio(this.pixelRatio);

    this.ctx = { renderer, scene: this.scene, camera: this.camera, assets, uniforms: makeUniforms(), quality };
    // Order matters: the environment sets lights, fog and the environment map the others rely on.
    this.env = new MountainPeakScene(this.ctx);
    this.bridge = new BridgeRenderer(this.ctx);
    this.warrior = new CosmeticsRenderer(this.ctx);
    this.storm = new StormRenderer(this.ctx);
    this.vfx = new VFX(this.ctx);
    this.post = new PostFX(this.ctx);
    this.modules = [this.env, this.bridge, this.warrior, this.storm, this.vfx, this.post];

    this.resize();
    new ResizeObserver(() => this.resize()).observe(container);
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.post.resize(w, h, this.renderer.getPixelRatio());
  }

  handleEvent(e: GameEvent, game: Game): void {
    switch (e.type) {
      case 'hit':
        if (e.kind === 'hail') this.addShake(0.55);
        else if (e.kind === 'snow' && e.damage > 4) this.addShake(0.15);
        break;
      case 'perfect': this.addShake(0.3); break;
      case 'plank': this.addShake(e.damage === 'break' ? 0.4 : 0.15); break;
      case 'shatter': this.addShake(0.3); break;
      case 'focus': this.addShake(0.5); break;
      case 'kick': this.addShake(0.06); break;
      case 'lightning': this.addShake(0.08 * e.power); break;
      default: break;
    }
    for (const m of this.modules) m.handleEvent?.(e, game);
  }

  addShake(amount: number): void {
    this.shake = Math.min(1, this.shake + amount);
  }

  private updateUniforms(dt: number, game: Game): void {
    const u = this.ctx.uniforms;
    const w = game.waves.weights;
    u.uTime.value = this.time;
    const target = Math.min(1, w.rain + w.drizzle * 0.7 + w.hail * 0.4 + w.snow * 0.25);
    // Surfaces soak quickly and dry slowly.
    const rate = target > u.uWetness.value ? 0.5 : 0.03;
    u.uWetness.value += (Math.max(0.25, target) - u.uWetness.value) * Math.min(1, dt * rate * 4);
    const s = game.storm;
    u.uWind.value = s.wind;
    u.uRainDir.value = s.rainDir;
    u.uRainAngle.value = s.rainAngle;
    u.uRainSpeed.value = s.rainSpeed;
    u.uRain.value += (Math.min(1, w.rain) - u.uRain.value) * Math.min(1, dt * 1.5);
    u.uSnow.value += (Math.min(1, w.snow) - u.uSnow.value) * Math.min(1, dt * 1.5);
    u.uMist.value = s.mist;
  }

  /** A cinematic side-on view: it leads the warrior a little, eases after them, and shakes on impacts. */
  private updateCamera(dt: number, game: Game): void {
    const cam = this.camera;
    const tanV = Math.tan(THREE.MathUtils.degToRad(FOV / 2));
    const distance = THREE.MathUtils.clamp(HALF_VIEW / (tanV * cam.aspect), MIN_DISTANCE, MAX_DISTANCE);
    const w = game.warrior;
    const leadTarget = w.facing * 1.4 + w.vx * 0.18;
    this.lead += (leadTarget - this.lead) * Math.min(1, dt * 1.6);
    const x = worldX(w.x) + this.lead;
    // Follow the deck's sag fully but only some of its sway, so the bridge is seen moving.
    const rest = game.bridge.restY(w.x);
    const y = rest + (game.bridge.deckY(w.x) - rest) * 0.3 + 2.2;
    const k = Math.min(1, dt * 3);
    this.focus.x += (x - this.focus.x) * k;
    this.focus.y += (y - this.focus.y) * k;
    const limit = BRIDGE_LENGTH / 2 + 4;
    this.focus.x = THREE.MathUtils.clamp(this.focus.x, -limit, limit);
    this.shake = Math.max(0, this.shake - dt * 1.4);
    const a = this.shake * this.shake;
    const t = this.time;
    const sx = (Math.sin(t * 47.3) + Math.sin(t * 31.1) * 0.6) * a * 0.35;
    const sy = (Math.cos(t * 41.7) + Math.sin(t * 27.9) * 0.6) * a * 0.3;
    cam.position.set(this.focus.x + sx, this.focus.y - 0.2 + sy, distance);
    this.look.set(this.focus.x, this.focus.y + 0.6, 0);
    cam.lookAt(this.look);
    cam.rotateZ((Math.sin(t * 23.0) * a) * 0.02);
  }

  /** Halves the resolution step by step when frames run long, and raises it again when they recover. */
  private adaptResolution(dt: number): void {
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    if (this.fps < 38) this.slowFrames++;
    else if (this.fps > 55) this.slowFrames = Math.min(0, this.slowFrames - 1);
    if (this.slowFrames > 90 && this.pixelRatio > 0.6) {
      this.pixelRatio = Math.max(0.6, this.pixelRatio - 0.15);
      this.renderer.setPixelRatio(this.pixelRatio);
      this.resize();
      this.slowFrames = 0;
    }
  }

  render(dt: number, game: Game): void {
    this.time += dt;
    this.adaptResolution(dt);
    this.updateUniforms(dt, game);
    this.updateCamera(dt, game);
    for (const m of this.modules) m.update(dt, game);
  }
}

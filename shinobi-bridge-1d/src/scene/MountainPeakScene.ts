import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import { worldX } from '../render/RenderContext.ts';
import { AnchorCliffs } from './env/AnchorCliffs.ts';
import { DistantPeaks } from './env/DistantPeaks.ts';
import { bakeEnvironment } from './env/EnvironmentMap.ts';
import { GorgeFog } from './env/GorgeFog.ts';
import { makeNoiseTexture } from './env/NoiseTexture.ts';
import { makeEnvUniforms } from './env/EnvUniforms.ts';
import type { EnvUniforms } from './env/EnvUniforms.ts';
import { LightningBolt, LightningFlash } from './env/Lightning.ts';
import { Random } from './env/noise.ts';
import { MOON_LIGHT_DIR, PALETTE } from './env/palette.ts';
import { SEA_LEVEL, StormSea } from './env/StormSea.ts';
import { StormSky } from './env/StormSky.ts';

/** Moonlight in lux-like units; the scene is tone-mapped, so this is "bright night". */
const MOON_INTENSITY = 2.4;
const HEMI_INTENSITY = 0.9;
/** Peak brightness of the lightning's directional light. */
const FLASH_INTENSITY = 9;
/** Only strong strikes show a visible bolt; weak ones are sheet lightning inside the cloud. */
const VISIBLE_BOLT_POWER = 0.55;
/** Height of the cloud base a bolt leaves from, far out over the sea. */
const STRIKE_TOP = 330;

/** The box (around the camera's focus) the moon's shadow map covers: the visible span of bridge. */
const SHADOW_BOX = { x: 17, y0: -3.4, y1: 4.8, z: 2.6 };
/** Extra depth toward the moon, so casters above the box (hail, a leaping warrior) still cast. */
const SHADOW_CASTER_MARGIN = 24;
/** How far the moon's shadow camera stands back from its target. */
const SHADOW_DISTANCE = 60;

/**
 * The mountain-top world: the storm sky, the distant snow-capped ranges, the two wet slate peaks
 * the bridge hangs between, the fog-filled gorge and the storm sea far below. It owns the moon (the
 * shadow-casting light), the hemisphere fill, the lightning light, scene.fog, scene.background and
 * scene.environment, and writes ctx.uniforms.uLightning every frame.
 */
export class MountainPeakScene implements RenderModule {
  readonly moonLight: THREE.DirectionalLight;
  private readonly ctx: RenderContext;
  private readonly env: EnvUniforms;
  private readonly hemi: THREE.HemisphereLight;
  private readonly flashLight: THREE.DirectionalLight;
  /** Where the lightning's light comes from, relative to the camera (each strike sets it). */
  private readonly flashFrom = new THREE.Vector3(0, 40, 22);
  private readonly flash = new LightningFlash();
  private readonly bolt: LightningBolt;
  private readonly sky: StormSky;
  private readonly sea: StormSea;
  private readonly fog: THREE.FogExp2;
  private readonly background = PALETTE.haze.clone();
  private readonly rng = new Random(0xe7f1);
  /** Light-space axes of the moon's shadow camera, fixed because the moon does not move. */
  private readonly shadowAxes = { x: new THREE.Vector3(), y: new THREE.Vector3(), z: new THREE.Vector3() };
  private readonly scratch = new THREE.Vector3();
  private shadowTexel = 0;

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    this.env = makeEnvUniforms();
    const scene = ctx.scene;

    // One baked noise texture feeds every environment shader: a few fetches instead of many octaves.
    const noise = makeNoiseTexture();
    this.fog = new THREE.FogExp2(PALETTE.haze.clone(), 0.0016);
    scene.fog = this.fog;
    scene.background = this.background;
    scene.environment = bakeEnvironment(ctx.renderer, noise);

    this.sky = new StormSky(ctx, this.env, noise);
    this.bolt = new LightningBolt(ctx.uniforms.uMist, PALETTE.lightning);
    scene.add(this.bolt.mesh);
    this.sea = new StormSea(ctx, this.env, noise);
    new DistantPeaks(ctx, this.env, noise);
    new AnchorCliffs(ctx, this.env);
    new GorgeFog(ctx, this.env, noise);

    // Cool skylight from above; from below, only the faint moonlit fog of the gorge.
    this.hemi = new THREE.HemisphereLight(new THREE.Color(0.42, 0.5, 0.7), new THREE.Color(0.045, 0.052, 0.07), HEMI_INTENSITY);
    scene.add(this.hemi);

    this.moonLight = new THREE.DirectionalLight(PALETTE.moon, MOON_INTENSITY);
    this.moonLight.castShadow = true;
    const shadow = this.moonLight.shadow;
    const size = ctx.quality === 'high' ? 2048 : 1024;
    shadow.mapSize.set(size, size);
    shadow.bias = -0.0004;
    shadow.normalBias = 0.025;
    this.fitShadowCamera();
    scene.add(this.moonLight, this.moonLight.target);

    this.flashLight = new THREE.DirectionalLight(PALETTE.lightning, 0);
    this.flashLight.castShadow = false;
    scene.add(this.flashLight, this.flashLight.target);
  }

  /**
   * Sizes the moon's orthographic shadow camera to the light-space bounds of the box around the
   * visible bridge. The size never changes, so the map can be snapped to whole texels as it slides.
   */
  private fitShadowCamera(): void {
    const { x: ax, y: ay, z: az } = this.shadowAxes;
    az.copy(MOON_LIGHT_DIR);
    ax.crossVectors(THREE.Object3D.DEFAULT_UP, az).normalize();
    ay.crossVectors(az, ax);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    const b = SHADOW_BOX;
    for (let i = 0; i < 8; i++) {
      this.scratch.set(i & 1 ? b.x : -b.x, i & 2 ? b.y1 : b.y0, i & 4 ? b.z : -b.z);
      const x = this.scratch.dot(ax);
      const y = this.scratch.dot(ay);
      const z = this.scratch.dot(az);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
    const cam = this.moonLight.shadow.camera;
    // Centre the box on the target, which sits at the box's centre in light space.
    const halfX = (maxX - minX) / 2;
    const halfY = (maxY - minY) / 2;
    cam.left = -halfX;
    cam.right = halfX;
    cam.bottom = -halfY;
    cam.top = halfY;
    // The light stands SHADOW_DISTANCE from the target, toward the moon.
    const depth = (maxZ - minZ) / 2;
    cam.near = Math.max(0.5, SHADOW_DISTANCE - depth - SHADOW_CASTER_MARGIN);
    cam.far = SHADOW_DISTANCE + depth;
    cam.updateProjectionMatrix();
    this.shadowTexel = (2 * halfX) / this.moonLight.shadow.mapSize.x;
  }

  /** Slides the shadow box to follow the camera, in whole shadow-map texels so edges never crawl. */
  private placeMoon(focusX: number): void {
    const { x: ax, y: ay, z: az } = this.shadowAxes;
    const b = SHADOW_BOX;
    const c = this.scratch.set(focusX, (b.y0 + b.y1) / 2, 0);
    const texel = this.shadowTexel;
    const sx = Math.round(c.dot(ax) / texel) * texel;
    const sy = Math.round(c.dot(ay) / texel) * texel;
    const sz = c.dot(az);
    const target = this.moonLight.target.position;
    target.copy(ax).multiplyScalar(sx).addScaledVector(ay, sy).addScaledVector(az, sz);
    this.moonLight.position.copy(target).addScaledVector(az, SHADOW_DISTANCE);
    this.moonLight.target.updateMatrixWorld();
  }

  update(dt: number, game: Game): void {
    if (game.phase === 'celestial') return;
    const u = this.ctx.uniforms;
    const cam = this.ctx.camera;

    // Lightning first: everything below reads its brightness.
    this.flash.update(dt);
    const f = this.flash.value;
    u.uLightning.value = f;
    this.bolt.uniforms.uChannel.value = this.flash.channel;
    this.bolt.show(this.flash.channel > 0.01);
    this.flashLight.intensity = FLASH_INTENSITY * f;

    // Clouds, fog and sea drift with the crosswind (integrated, so a wind shift never makes them jump).
    const wind = game.storm.wind;
    this.env.uCloudShift.value.x += (wind * 0.0045 + 0.004) * dt;
    this.env.uCloudShift.value.y += 0.0025 * dt;
    this.env.uWindDrift.value.x += wind * 0.6 * dt;
    this.env.uWindDrift.value.y += 0.5 * dt;

    // Old snow builds on the rock while it snows and melts away slowly (faster in rain).
    const cover = this.env.uSnowCover;
    cover.value = THREE.MathUtils.clamp(cover.value + (u.uSnow.value * 0.03 - 0.0025 - u.uRain.value * 0.01) * dt, 0.12, 1);

    // Haze thickens with mist and falling weather; the whole atmosphere lights up in a flash.
    this.fog.density = 0.0016 + 0.0062 * u.uMist.value + 0.0012 * u.uRain.value + 0.0022 * u.uSnow.value;
    this.fog.color.copy(PALETTE.haze).multiplyScalar(1 + f * 2.2);
    this.background.copy(this.fog.color);

    this.hemi.intensity = HEMI_INTENSITY * (1 + f * 3.5);
    this.moonLight.intensity = MOON_INTENSITY * (1 - 0.45 * u.uMist.value);

    this.placeMoon(cam.position.x);
    const flashAt = this.flashLight.target.position.set(cam.position.x, 0, 0);
    this.flashLight.position.copy(flashAt).add(this.flashFrom);
    this.flashLight.target.updateMatrixWorld();
    this.sky.update(cam);
    this.sea.update(cam);
  }

  handleEvent(e: GameEvent): void {
    if (e.type !== 'lightning') return;
    this.flash.strike(e.power);
    // The strike comes down far out among the islands, roughly where its lane position points.
    const fx = worldX(e.x) * 11;
    const fz = -900 - this.rng.next() * 600;
    const cam = this.ctx.camera.position;
    this.env.uFlashPos.value.set(fx, STRIKE_TOP, fz);
    this.env.uFlashDir.value.set(fx - cam.x, STRIKE_TOP - cam.y, fz - cam.z).normalize();
    // The whole cloud deck lights up, overhead and behind the camera too, so the flash reaches the
    // bridge from high on the strike's side and a little in front: the faces we see flare.
    this.flashFrom.set(this.env.uFlashDir.value.x * 30, 40, 22);
    if (e.power >= VISIBLE_BOLT_POWER) this.bolt.build(this.env.uFlashPos.value, SEA_LEVEL);
  }
}

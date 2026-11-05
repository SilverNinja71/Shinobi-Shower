import * as THREE from 'three';
import type { Game, GameEvent } from '../core/Game.ts';
import type { RenderContext, RenderModule } from '../render/RenderContext.ts';
import type { Drop } from './PrecipitationDroplet.ts';
import { CurtainSlots } from './render/CurtainSlots.ts';
import { DropFlakes } from './render/DropFlakes.ts';
import { DropStreaks } from './render/DropStreaks.ts';
import { HailStones } from './render/HailStones.ts';
import { HailWarnings } from './render/HailWarnings.ts';
import { MistBanks } from './render/MistBanks.ts';
import { RainField } from './render/RainField.ts';
import { CLUMP_R, SnowClumps } from './render/SnowClumps.ts';
import { SnowFall } from './render/SnowFall.ts';
import { Splashes } from './render/Splashes.ts';
import { StormMarks } from './render/StormMarks.ts';

/** Where the moon is when the scene has no shadow-casting directional light: high, behind the bridge. */
const DEFAULT_MOON = new THREE.Vector3(0.2, 0.75, -0.62).normalize();

/**
 * Draws all the precipitation.
 *
 * Cosmetic weather is animated on the GPU and follows the shared uniforms: rain sheets with the
 * simulation's sweeping curtains packed into them (RainSheet.vert/.frag), the fine drizzle and drifting
 * banks of a mist front, and the snowfall of a snow front. Gameplay drops are read from the simulation
 * every frame and drawn brighter and sharper so threats read: rain streaks, mist glints, snow tufts and
 * clumps, and icy hailstones, each stone with a warning mark on the deck where it will land and, when
 * one is overhead, the box where a cut breaks it. Landing rain and snow splash on the deck.
 *
 * Nine draw calls at most: rain, drizzle, snowfall, mist, streaks, flakes, clumps, hail, marks.
 */
export class StormRenderer implements RenderModule {
  private readonly ctx: RenderContext;
  private readonly viewport = { value: new THREE.Vector2(1, 1) };
  private readonly viewProj = { value: new THREE.Matrix4() };
  private readonly focus = { value: 20 };
  private readonly moonDir = { value: DEFAULT_MOON.clone() };
  private moon: THREE.DirectionalLight | null = null;
  private moonSearch = 0;
  private readonly curtains = new CurtainSlots();
  private readonly rain: RainField;
  private readonly drizzle: RainField;
  private readonly snowfall: SnowFall;
  private readonly mist: MistBanks;
  private readonly streaks: DropStreaks;
  private readonly flakes: DropFlakes;
  private readonly clumps: SnowClumps;
  private readonly hail: HailStones;
  private readonly marks: StormMarks;
  private readonly warnings = new HailWarnings();
  private readonly splashes: Splashes;
  /** This frame's hailstones, gathered for the warnings (reused, never reallocated). */
  private readonly hailNow: Drop[] = [];

  constructor(ctx: RenderContext) {
    this.ctx = ctx;
    const low = ctx.quality === 'low';
    const u = ctx.uniforms;
    const shared = { time: u.uTime, lightning: u.uLightning, viewport: this.viewport, viewProj: this.viewProj, focus: this.focus, moonDir: this.moonDir };
    const scene = ctx.scene;

    this.rain = new RainField(
      scene,
      {
        count: low ? 5000 : 12000,
        halfX: 30,
        y: [-25, 20],
        z: [-35, 10],
        width: 0.005,
        minPixels: 1.0,
        shutter: 0.026,
        defocus: 0.3,
        color: new THREE.Color(0.55, 0.62, 0.75).multiplyScalar(1.8),
        flashGain: 5,
        curtains: { slots: this.curtains, share: 0.6, veils: 1 / 120, z: [-24, 6], gain: 1.7 },
      },
      shared,
    );
    this.drizzle = new RainField(
      scene,
      {
        count: low ? 1500 : 3500,
        halfX: 18,
        y: [-12, 14],
        z: [-14, 9],
        width: 0.003,
        minPixels: 1.1,
        shutter: 0.05,
        defocus: 0.15,
        color: new THREE.Color(0.6, 0.66, 0.78).multiplyScalar(1.2),
        flashGain: 4,
      },
      shared,
    );
    this.snowfall = new SnowFall(scene, low ? 2200 : 5000, shared);
    this.mist = new MistBanks(scene, low ? 6 : 10, shared);
    this.streaks = new DropStreaks(scene, low ? 1024 : 2048, shared);
    this.flakes = new DropFlakes(scene, low ? 512 : 1024, shared);
    this.clumps = new SnowClumps(ctx, low ? 32 : 64);
    this.hail = new HailStones(ctx, 16);
    this.marks = new StormMarks(scene, ctx.camera, low ? 192 : 320, shared);
    this.splashes = new Splashes(low ? 96 : 160);
  }

  handleEvent(e: GameEvent): void {
    if (e.type === 'land') this.splashes.land(e);
  }

  /**
   * Rain glows where it is backlit, so it needs the moon: the scene's shadow-casting directional light
   * (MountainPeakScene owns it). Looked up once, and again only if it leaves the scene; without one the
   * search is retried every couple of seconds.
   */
  private findMoon(dt: number): void {
    if (this.moon?.parent) return;
    this.moonSearch -= dt;
    if (this.moonSearch > 0) return;
    this.moonSearch = 2;
    this.moon = null;
    this.ctx.scene.traverse((o) => {
      if (!this.moon && o instanceof THREE.DirectionalLight && o.castShadow) this.moon = o;
    });
  }

  update(dt: number, game: Game): void {
    // In celestial realm (Heaven), mortal weather is completely absent
    if (game.phase === 'celestial') {
      this.rain.mesh.visible = false;
      this.drizzle.mesh.visible = false;
      this.snowfall.mesh.visible = false;
      this.mist.mesh.visible = false;
      this.streaks.mesh.visible = false;
      this.flakes.mesh.visible = false;
      this.clumps.mesh.visible = false;
      this.hail.mesh.visible = false;
      this.marks.mesh.visible = false;
      return;
    }

    const camera = this.ctx.camera;
    this.ctx.renderer.getDrawingBufferSize(this.viewport.value);
    // GameRenderer has just moved the camera; its matrices catch up here rather than at render time.
    camera.updateMatrixWorld();
    this.viewProj.value.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    // The camera frames the bridge plane (z = 0), so that is the depth in focus.
    this.focus.value = Math.max(8, camera.position.z);
    this.findMoon(dt);
    if (this.moon) this.moonDir.value.subVectors(this.moon.position, this.moon.target.position).normalize();
    else this.moonDir.value.copy(DEFAULT_MOON);

    // Background effect weather is turned off so only critical, pure-white slashable drops exist
    this.rain.mesh.visible = false;
    this.drizzle.mesh.visible = false;
    this.snowfall.mesh.visible = false;
    this.mist.mesh.visible = false;

    this.streaks.begin();
    this.flakes.begin();
    this.clumps.begin();
    this.hail.begin();
    this.marks.begin();
    this.hailNow.length = 0;
    for (const d of game.storm.drops) {
      if (d.dead) continue;
      switch (d.kind) {
        case 'rain':
          this.streaks.rain(d);
          break;
        case 'drizzle':
          this.streaks.glint(d);
          break;
        case 'snow':
          if (d.r > CLUMP_R) this.clumps.add(d);
          else this.flakes.add(d);
          break;
        case 'hail':
          this.hail.add(d);
          this.streaks.trail(d);
          this.hailNow.push(d);
          break;
      }
    }
    this.warnings.update(dt, game, this.hailNow, this.marks);
    this.splashes.update(dt, game, this.marks);
    this.streaks.end();
    this.flakes.end();
    this.clumps.end();
    this.hail.end();
    this.marks.end();
  }
}
